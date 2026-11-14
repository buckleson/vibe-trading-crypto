// T12: read-only wallet connect in the top bar (WalletButton + WalletPopover + useWallet).
// Uses a fake EIP-1193 provider on window.ethereum; no network, no real wallet.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, fireEvent, waitFor, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import path from "node:path";

const toastError = vi.fn();
const toastSuccess = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    error: (...a: unknown[]) => toastError(...a),
    success: (...a: unknown[]) => toastSuccess(...a),
  },
}));

import { WalletButton } from "@/components/wallet/WalletButton";

const ADDR = "0x1234567890abcdef1234567890abcdef12345678";
const ADDR2 = "0xabcdef0000000000000000000000000000009999";
const FLAG = "vc-wallet-connected";
const ALLOWED = new Set(["eth_requestAccounts", "eth_accounts", "eth_chainId", "eth_getBalance"]);

type Handler = (...a: unknown[]) => void;

interface FakeOpts {
  chain?: string;
  accounts?: string[];
  requestAccounts?: string[];
  connectError?: unknown;
  balanceError?: Error;
  balance?: string;
  noEvents?: boolean;
}

function makeEthereum(opts: FakeOpts = {}) {
  const handlers: Record<string, Handler[]> = {};
  const state = {
    chain: opts.chain ?? "0x1",
    balance: opts.balance ?? "0x14d1120d7b160000", // 1.5 ETH
    balanceError: opts.balanceError as Error | undefined,
  };
  const methods: string[] = [];
  const request = vi.fn(async ({ method }: { method: string; params?: unknown[] }) => {
    methods.push(method);
    switch (method) {
      case "eth_requestAccounts":
        if (opts.connectError !== undefined) throw opts.connectError;
        return opts.requestAccounts ?? [ADDR];
      case "eth_accounts":
        return opts.accounts ?? [ADDR];
      case "eth_chainId":
        return state.chain;
      case "eth_getBalance":
        if (state.balanceError) throw state.balanceError;
        return state.balance;
      default:
        throw new Error("unexpected " + method);
    }
  });
  const base = {
    request,
    state,
    methods,
    handlers,
    isMetaMask: true,
    emit: (e: string, ...a: unknown[]) => act(() => { (handlers[e] ?? []).forEach((h) => h(...a)); }),
    count: (e: string) => (handlers[e] ?? []).length,
  };
  if (opts.noEvents) return base;
  return {
    ...base,
    on: vi.fn((e: string, h: Handler) => { (handlers[e] ??= []).push(h); }),
    removeListener: vi.fn((e: string, h: Handler) => { handlers[e] = (handlers[e] ?? []).filter((x) => x !== h); }),
  };
}

type Fake = ReturnType<typeof makeEthereum>;

function install(f: Fake) {
  window.ethereum = f as unknown as Window["ethereum"];
  return f;
}

const writeText = vi.fn(async (_: string) => {});
const fetchSpy = vi.fn(async () => new Response("{}"));

function connectBtn() {
  return screen.getByRole("button", { name: /connect wallet/i });
}

async function connect(f: Fake) {
  install(f);
  const utils = render(<WalletButton />);
  fireEvent.click(connectBtn());
  await screen.findByText("0x1234…5678");
  await waitFor(() => expect(screen.getByRole("button", { name: /0x1234/ })).not.toBeDisabled());
  return utils;
}

async function openConnected() {
  fireEvent.click(screen.getByRole("button", { name: /0x1234|0xabcd/ }));
  return screen.getByRole("dialog", { name: "Wallet details" });
}

beforeEach(() => {
  localStorage.clear();
  toastError.mockReset();
  toastSuccess.mockReset();
  writeText.mockReset();
  writeText.mockImplementation(async () => {});
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  fetchSpy.mockClear();
  vi.stubGlobal("fetch", fetchSpy);
});

afterEach(() => {
  delete window.ethereum;
  delete (window as { vibeDesktop?: unknown }).vibeDesktop;
  vi.unstubAllGlobals();
});

describe("T12 disconnected state", () => {
  it("renders a Connect wallet button with dialog popup semantics", () => {
    render(<WalletButton />);
    const btn = connectBtn();
    expect(btn).toHaveAttribute("aria-haspopup", "dialog");
    expect(btn).toHaveAttribute("aria-expanded", "false");
    expect(btn.querySelector("svg")).not.toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("does not touch the provider on mount when the flag is unset", () => {
    const f = install(makeEthereum());
    render(<WalletButton />);
    expect(f.request).not.toHaveBeenCalled();
    expect(connectBtn()).toBeInTheDocument();
  });

  it("does not restore on mount when the flag is '0'", () => {
    localStorage.setItem(FLAG, "0");
    const f = install(makeEthereum());
    render(<WalletButton />);
    expect(f.request).not.toHaveBeenCalled();
  });
});

describe("T12 no provider popover", () => {
  it("browser variant: title, text and safe MetaMask link", () => {
    render(<WalletButton />);
    fireEvent.click(connectBtn());
    const dlg = screen.getByRole("dialog", { name: "No browser wallet found" });
    expect(connectBtn()).toHaveAttribute("aria-expanded", "true");
    expect(dlg).toHaveTextContent("No browser wallet found");
    expect(dlg).toHaveTextContent("Install MetaMask to see your wallet address and balance here.");
    const link = within(dlg).getByRole("link", { name: "Get MetaMask" });
    expect(link).toHaveAttribute("href", "https://metamask.io/download/");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(within(dlg).queryByRole("button", { name: /copy link/i })).toBeNull();
  });

  it("desktop variant: explains and offers to copy the app origin", async () => {
    window.vibeDesktop = { isDesktop: true } as Window["vibeDesktop"];
    render(<WalletButton />);
    fireEvent.click(connectBtn());
    const dlg = screen.getByRole("dialog");
    const origin = window.location.origin;
    expect(dlg).toHaveTextContent(
      `Browser wallets do not run inside the desktop app. Open ${origin} in a browser with MetaMask to connect.`,
    );
    expect(dlg.textContent).not.toContain("{{url}}");
    expect(within(dlg).queryByRole("link", { name: "Get MetaMask" })).toBeNull();
    fireEvent.click(within(dlg).getByRole("button", { name: /copy link/i }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(origin));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
  });

  it("vibeDesktop present but isDesktop false uses the browser variant", () => {
    window.vibeDesktop = { isDesktop: false } as unknown as Window["vibeDesktop"];
    render(<WalletButton />);
    fireEvent.click(connectBtn());
    expect(screen.getByRole("link", { name: "Get MetaMask" })).toBeInTheDocument();
  });

  it("clicking the button again toggles the popover closed", () => {
    render(<WalletButton />);
    fireEvent.click(connectBtn());
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.click(connectBtn());
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(connectBtn()).toHaveAttribute("aria-expanded", "false");
  });

  it("moves focus into the popover, closes on Escape and outside click", () => {
    render(
      <div>
        <WalletButton />
        <p data-testid="outside">outside</p>
      </div>,
    );
    fireEvent.click(connectBtn());
    const dlg = screen.getByRole("dialog");
    expect(dlg.contains(document.activeElement)).toBe(true);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(connectBtn());
    const again = screen.getByRole("dialog");
    fireEvent.mouseDown(within(again).getByRole("link"));
    expect(screen.getByRole("dialog")).toBeInTheDocument(); // inside click keeps it open
    fireEvent.mouseDown(screen.getByTestId("outside"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("other keys do not close the popover", () => {
    render(<WalletButton />);
    fireEvent.click(connectBtn());
    fireEvent.keyDown(document, { key: "Enter" });
    fireEvent.keyDown(document, { key: "Tab" });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("copy link failure falls back to an error toast", async () => {
    window.vibeDesktop = { isDesktop: true } as Window["vibeDesktop"];
    writeText.mockImplementation(async () => { throw new Error("denied"); });
    render(<WalletButton />);
    fireEvent.click(connectBtn());
    fireEvent.click(screen.getByRole("button", { name: /copy link/i }));
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(toastSuccess).not.toHaveBeenCalled();
  });
});

describe("T12 connect flow", () => {
  it("connects, stores the flag, shows short address, chain and 1.5 ETH", async () => {
    const f = makeEthereum();
    await connect(f);
    expect(localStorage.getItem(FLAG)).toBe("1");
    expect(f.methods).toContain("eth_requestAccounts");
    const btn = screen.getByRole("button", { name: /0x1234/ });
    const mono = within(btn).getByText("0x1234…5678");
    expect(mono.className).toMatch(/font-mono/);
    expect(mono.className).toMatch(/text-\[13px\]/);
    const chainSpan = within(btn).getByText("Ethereum");
    expect(chainSpan.className).toMatch(/hidden/);
    expect(chainSpan.className).toMatch(/md:inline/);
    expect(btn.querySelector(".bg-success")).not.toBeNull();
    expect(btn.querySelector(".h-2.w-2")).not.toBeNull();

    const dlg = await openConnected();
    expect(within(dlg).getByText(ADDR)).toBeInTheDocument();
    await waitFor(() => expect(within(dlg).getByTestId("wallet-balance")).toHaveTextContent("1.5 ETH"));
    expect(within(dlg).getByTestId("wallet-balance").className).toMatch(/tabular-nums/);
    expect(dlg).toHaveTextContent("Read only. Vibe Crypto never asks your wallet to sign anything.");
    expect(dlg).toHaveTextContent("To fully disconnect, also remove this site in MetaMask.");
    expect(dlg.className).toMatch(/w-72/);
    expect(dlg.className).toMatch(/bg-popover/);
  });

  it("requests the balance of the connected address at the latest block", async () => {
    const f = makeEthereum();
    await connect(f);
    expect(f.request).toHaveBeenCalledWith({ method: "eth_getBalance", params: [ADDR, "latest"] });
  });

  it("uses the chain native symbol (BNB Smart Chain)", async () => {
    await connect(makeEthereum({ chain: "0x38" }));
    const dlg = await openConnected();
    expect(within(dlg).getByText("BNB Smart Chain")).toBeInTheDocument();
    await waitFor(() => expect(within(dlg).getByTestId("wallet-balance")).toHaveTextContent("1.5 BNB"));
  });

  it("falls back to 'Chain N' and ETH for unknown chains", async () => {
    await connect(makeEthereum({ chain: "0x539" }));
    const dlg = await openConnected();
    expect(within(dlg).getByText("Chain 1337")).toBeInTheDocument();
    await waitFor(() => expect(within(dlg).getByTestId("wallet-balance")).toHaveTextContent("1.5 ETH"));
  });

  it("shows a zero balance as '0 ETH'", async () => {
    await connect(makeEthereum({ balance: "0x0" }));
    const dlg = await openConnected();
    await waitFor(() => expect(within(dlg).getByTestId("wallet-balance")).toHaveTextContent(/^0 ETH$/));
  });

  it("user rejection (4001) toasts 'Wallet connection was declined' and stays disconnected", async () => {
    install(makeEthereum({ connectError: Object.assign(new Error("User rejected"), { code: 4001 }) }));
    render(<WalletButton />);
    fireEvent.click(connectBtn());
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Wallet connection was declined"));
    expect(localStorage.getItem(FLAG)).not.toBe("1");
    await waitFor(() => expect(connectBtn()).not.toBeDisabled());
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("other errors toast their message", async () => {
    install(makeEthereum({ connectError: Object.assign(new Error("Request already pending"), { code: -32002 }) }));
    render(<WalletButton />);
    fireEvent.click(connectBtn());
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Request already pending"));
    expect(toastError).not.toHaveBeenCalledWith("Wallet connection was declined");
    expect(localStorage.getItem(FLAG)).not.toBe("1");
  });

  it("non-Error rejections are stringified", async () => {
    install(makeEthereum({ connectError: "boom" }));
    render(<WalletButton />);
    fireEvent.click(connectBtn());
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("boom"));
  });

  it("an empty account list from eth_requestAccounts keeps the wallet disconnected", async () => {
    install(makeEthereum({ requestAccounts: [] }));
    render(<WalletButton />);
    fireEvent.click(connectBtn());
    await waitFor(() => expect(connectBtn()).not.toBeDisabled());
    expect(localStorage.getItem(FLAG)).not.toBe("1");
    expect(screen.queryByText(/0x1234/)).toBeNull();
  });

  it("does not open the no-wallet popover when a provider exists", async () => {
    install(makeEthereum({ connectError: { code: 4001 } }));
    render(<WalletButton />);
    fireEvent.click(connectBtn());
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(screen.queryByText("No browser wallet found")).toBeNull();
  });
});

describe("T12 connected popover actions", () => {
  it("Copy copies the full address and toasts 'Address copied'", async () => {
    await connect(makeEthereum());
    const dlg = await openConnected();
    fireEvent.click(within(dlg).getByRole("button", { name: "Copy address" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(ADDR));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Address copied"));
  });

  it("refresh re-reads chain and balance", async () => {
    const f = makeEthereum();
    await connect(f);
    const dlg = await openConnected();
    await waitFor(() => expect(within(dlg).getByTestId("wallet-balance")).toHaveTextContent("1.5 ETH"));
    f.state.balance = "0x1bc16d674ec80000"; // 2 ETH
    const before = f.methods.filter((m) => m === "eth_getBalance").length;
    fireEvent.click(within(dlg).getByRole("button", { name: "Refresh balance" }));
    await waitFor(() => expect(within(dlg).getByTestId("wallet-balance")).toHaveTextContent(/^2 ETH$/));
    expect(f.methods.filter((m) => m === "eth_getBalance").length).toBe(before + 1);
    expect(f.methods.filter((m) => m === "eth_requestAccounts")).toHaveLength(1);
  });

  it("a failed balance refresh shows an inline alert", async () => {
    const f = makeEthereum();
    await connect(f);
    const dlg = await openConnected();
    f.state.balanceError = new Error("RPC down");
    fireEvent.click(within(dlg).getByRole("button", { name: "Refresh balance" }));
    expect(await within(dlg).findByRole("alert")).toHaveTextContent("RPC down");
    expect(screen.getByText("0x1234…5678")).toBeInTheDocument(); // still connected
  });

  it("Forget wallet sets the flag to '0', closes the popover and clears state", async () => {
    const f = makeEthereum();
    await connect(f);
    const dlg = await openConnected();
    const callsBefore = f.request.mock.calls.length;
    fireEvent.click(within(dlg).getByRole("button", { name: "Forget wallet" }));
    expect(localStorage.getItem(FLAG)).toBe("0");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByText(/0x1234/)).toBeNull();
    expect(connectBtn()).toBeInTheDocument();
    expect(f.request.mock.calls.length).toBe(callsBefore); // no revoke / provider calls
  });

  it("after Forget, a remount does not auto-restore", async () => {
    const f = makeEthereum();
    const { unmount } = await connect(f);
    fireEvent.click(within(await openConnected()).getByRole("button", { name: "Forget wallet" }));
    unmount();
    f.request.mockClear();
    render(<WalletButton />);
    expect(f.request).not.toHaveBeenCalled();
    expect(connectBtn()).toBeInTheDocument();
  });

  it("connected popover closes on Escape", async () => {
    await connect(makeEthereum());
    await openConnected();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("button", { name: /0x1234/ })).toHaveAttribute("aria-expanded", "false");
  });
});

describe("T12 provider events", () => {
  it("accountsChanged([]) returns to disconnected and sets the flag to '0'", async () => {
    const f = makeEthereum();
    await connect(f);
    await openConnected();
    f.emit("accountsChanged", []);
    await waitFor(() => expect(connectBtn()).toBeInTheDocument());
    expect(localStorage.getItem(FLAG)).toBe("0");
    expect(screen.queryByRole("dialog", { name: "Wallet details" })).toBeNull();
  });

  it("accountsChanged with no args is treated as disconnect", async () => {
    const f = makeEthereum();
    await connect(f);
    f.emit("accountsChanged");
    await waitFor(() => expect(connectBtn()).toBeInTheDocument());
  });

  it("accountsChanged to a new account switches address and refetches balance for it", async () => {
    const f = makeEthereum();
    await connect(f);
    f.emit("accountsChanged", [ADDR2]);
    await screen.findByText("0xabcd…9999");
    expect(f.request).toHaveBeenCalledWith({ method: "eth_getBalance", params: [ADDR2, "latest"] });
  });

  it("accountsChanged while never connected does not connect", async () => {
    const f = install(makeEthereum());
    render(<WalletButton />);
    f.emit("accountsChanged", [ADDR]);
    await Promise.resolve();
    expect(screen.queryByText(/0x1234/)).toBeNull();
    expect(connectBtn()).toBeInTheDocument();
  });

  it("chainChanged updates the chain badge and symbol", async () => {
    const f = makeEthereum();
    await connect(f);
    const dlg = await openConnected();
    expect(within(dlg).getByText("Ethereum")).toBeInTheDocument();
    f.state.chain = "0x89";
    f.emit("chainChanged", "0x89");
    await waitFor(() => expect(within(dlg).getByText("Polygon")).toBeInTheDocument());
    await waitFor(() => expect(within(dlg).getByTestId("wallet-balance")).toHaveTextContent("1.5 POL"));
  });

  it("chainChanged while disconnected makes no requests", async () => {
    const f = install(makeEthereum());
    render(<WalletButton />);
    f.emit("chainChanged", "0x89");
    await Promise.resolve();
    expect(f.request).not.toHaveBeenCalled();
  });

  it("subscribes once to each event and removes listeners on unmount", async () => {
    const f = install(makeEthereum());
    const { unmount } = render(<WalletButton />);
    expect(f.count("accountsChanged")).toBe(1);
    expect(f.count("chainChanged")).toBe(1);
    unmount();
    expect(f.count("accountsChanged")).toBe(0);
    expect(f.count("chainChanged")).toBe(0);
  });

  it("works with a provider that has no on/removeListener", async () => {
    const f = makeEthereum({ noEvents: true });
    const { unmount } = await connect(f);
    expect(screen.getByText("0x1234…5678")).toBeInTheDocument();
    expect(() => unmount()).not.toThrow();
  });
});

describe("T12 auto-restore", () => {
  it("flag '1' restores via eth_accounts and never calls eth_requestAccounts", async () => {
    localStorage.setItem(FLAG, "1");
    const f = install(makeEthereum());
    render(<WalletButton />);
    await screen.findByText("0x1234…5678");
    await waitFor(() => expect(f.methods).toContain("eth_getBalance"));
    expect(f.methods).toContain("eth_accounts");
    expect(f.methods).not.toContain("eth_requestAccounts");
  });

  it("flag '1' but wallet no longer authorised: flag reset to '0', stays disconnected", async () => {
    localStorage.setItem(FLAG, "1");
    const f = install(makeEthereum({ accounts: [] }));
    render(<WalletButton />);
    await waitFor(() => expect(localStorage.getItem(FLAG)).toBe("0"));
    expect(connectBtn()).toBeInTheDocument();
    expect(f.methods).toEqual(["eth_accounts"]);
  });

  it("flag '1' with no provider does nothing and shows the no-wallet popover on click", () => {
    localStorage.setItem(FLAG, "1");
    render(<WalletButton />);
    fireEvent.click(connectBtn());
    expect(screen.getByText("No browser wallet found")).toBeInTheDocument();
  });

  it("eth_accounts failure on restore is swallowed", async () => {
    localStorage.setItem(FLAG, "1");
    const f = install(makeEthereum());
    f.request.mockImplementationOnce(async () => { throw new Error("locked"); });
    render(<WalletButton />);
    await waitFor(() => expect(f.request).toHaveBeenCalledTimes(1));
    expect(connectBtn()).toBeInTheDocument();
    expect(toastError).not.toHaveBeenCalled();
  });

  it("survives localStorage throwing (locked-down browser)", async () => {
    const getSpy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("SecurityError"); });
    const setSpy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("SecurityError"); });
    try {
      const f = makeEthereum();
      await connect(f);
      expect(f.methods).toContain("eth_requestAccounts");
    } finally {
      getSpy.mockRestore();
      setSpy.mockRestore();
    }
  });
});

describe("T12 read-only guarantees", () => {
  it("only read methods are ever requested across a full session", async () => {
    const f = makeEthereum();
    await connect(f);
    const dlg = await openConnected();
    fireEvent.click(within(dlg).getByRole("button", { name: "Refresh balance" }));
    f.state.chain = "0xa";
    f.emit("chainChanged", "0xa");
    f.emit("accountsChanged", [ADDR2]);
    await waitFor(() => expect(screen.getByText("0xabcd…9999")).toBeInTheDocument());
    // popover is still open from before; Forget from it
    fireEvent.click(within(screen.getByRole("dialog", { name: "Wallet details" })).getByRole("button", { name: "Forget wallet" }));
    expect(connectBtn()).toBeInTheDocument();
    for (const m of f.methods) expect(ALLOWED.has(m)).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rendered wallet copy contains no em dashes", async () => {
    render(<WalletButton />);
    fireEvent.click(connectBtn());
    expect(document.body.textContent).not.toContain("—");
  });

  const SRC = path.resolve(__dirname, "../..");
  const files = [
    "lib/wallet.ts",
    "components/wallet/WalletButton.tsx",
    "components/wallet/WalletPopover.tsx",
    "components/wallet/useWallet.ts",
  ];

  it.each(files)("%s has no signing, transaction or backend code", (rel) => {
    const src = readFileSync(path.join(SRC, rel), "utf8");
    for (const banned of [
      "personal_sign", "eth_sign", "eth_signTypedData", "eth_sendTransaction", "eth_sendRawTransaction",
      "wallet_switchEthereumChain", "wallet_addEthereumChain", "wallet_revokePermissions",
      "fetch(", "axios", "apiClient", "@/lib/api",
    ]) {
      expect(src, `${rel} contains ${banned}`).not.toContain(banned);
    }
    expect(src).not.toContain("—");
    expect(src).not.toMatch(/localStorage\./); // must go through safeGet/safeSet
  });

  it("adds no wallet SDK dependencies", () => {
    const pkg = JSON.parse(readFileSync(path.resolve(SRC, "../package.json"), "utf8"));
    const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
    for (const d of ["ethers", "viem", "wagmi", "web3", "@metamask/sdk", "@web3modal/wagmi", "@rainbow-me/rainbowkit", "@walletconnect/ethereum-provider"]) {
      expect(deps).not.toContain(d);
    }
  });

  it("window.ethereum is declared in lib/wallet.ts, not desktop.d.ts", () => {
    expect(readFileSync(path.join(SRC, "desktop.d.ts"), "utf8")).not.toMatch(/ethereum/);
    expect(readFileSync(path.join(SRC, "lib/wallet.ts"), "utf8")).toMatch(/ethereum\?: Eip1193Provider/);
  });

  it("TopBar still mounts WalletButton", () => {
    expect(readFileSync(path.join(SRC, "components/layout/TopBar.tsx"), "utf8")).toMatch(/<WalletButton \/>/);
  });
});
