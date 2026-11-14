import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, fireEvent, waitFor, within } from "@testing-library/react";

const toastError = vi.fn();
vi.mock("sonner", () => ({ toast: { error: (...a: unknown[]) => toastError(...a), success: vi.fn() } }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (_k: string, o?: { defaultValue?: string; [k: string]: unknown }) =>
      (o?.defaultValue ?? _k).replace(/\{\{(\w+)\}\}/g, (_m, n) => String(o?.[n] ?? "")),
  }),
}));

import { WalletButton } from "../WalletButton";

const ADDR = "0x1234567890abcdef1234567890abcdef12345678";

function makeEthereum(opts: { chain?: string; reject?: boolean } = {}) {
  const handlers: Record<string, ((...a: unknown[]) => void)[]> = {};
  const state = { chain: opts.chain ?? "0x1" };
  const request = vi.fn(async ({ method }: { method: string }) => {
    switch (method) {
      case "eth_requestAccounts":
        if (opts.reject) throw Object.assign(new Error("rejected"), { code: 4001 });
        return [ADDR];
      case "eth_accounts": return [ADDR];
      case "eth_chainId": return state.chain;
      case "eth_getBalance": return "0x14d1120d7b160000";
      default: throw new Error("unexpected " + method);
    }
  });
  return {
    request, state,
    on: (e: string, h: (...a: unknown[]) => void) => { (handlers[e] ??= []).push(h); },
    removeListener: (e: string, h: (...a: unknown[]) => void) => { handlers[e] = (handlers[e] ?? []).filter((x) => x !== h); },
    emit: (e: string, ...a: unknown[]) => (handlers[e] ?? []).forEach((h) => h(...a)),
    handlers,
  };
}

beforeEach(() => { localStorage.clear(); toastError.mockClear(); });
afterEach(() => { delete window.ethereum; delete window.vibeDesktop; });

describe("WalletButton", () => {
  it("no provider: browser popover with MetaMask link", () => {
    render(<WalletButton />);
    fireEvent.click(screen.getByRole("button", { name: /connect wallet/i }));
    expect(screen.getByRole("dialog")).toHaveTextContent("No browser wallet found");
    const link = screen.getByRole("link", { name: "Get MetaMask" });
    expect(link).toHaveAttribute("href", "https://metamask.io/download/");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("no provider: desktop variant shows origin and copy link", () => {
    window.vibeDesktop = { isDesktop: true } as Window["vibeDesktop"];
    render(<WalletButton />);
    fireEvent.click(screen.getByRole("button", { name: /connect wallet/i }));
    expect(screen.getByRole("dialog")).toHaveTextContent(window.location.origin);
    expect(screen.getByRole("button", { name: /copy link/i })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Get MetaMask" })).toBeNull();
  });

  it("connect flow stores flag, shows short address and balance", async () => {
    window.ethereum = makeEthereum();
    render(<WalletButton />);
    fireEvent.click(screen.getByRole("button", { name: /connect wallet/i }));
    await screen.findByText("0x1234…5678");
    expect(localStorage.getItem("vc-wallet-connected")).toBe("1");
    const btn = screen.getByRole("button", { name: /0x1234/ });
    expect(btn).toHaveAttribute("aria-haspopup", "dialog");
    fireEvent.click(btn);
    expect(screen.getByRole("dialog", { name: "Wallet details" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("wallet-balance")).toHaveTextContent("1.5 ETH"));
    expect(within(screen.getByRole("dialog")).getByText("Ethereum")).toBeInTheDocument();
  });

  it("rejection shows a toast", async () => {
    window.ethereum = makeEthereum({ reject: true });
    render(<WalletButton />);
    fireEvent.click(screen.getByRole("button", { name: /connect wallet/i }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Wallet connection was declined"));
    expect(localStorage.getItem("vc-wallet-connected")).toBeNull();
  });

  it("auto-restores with eth_accounts only", async () => {
    localStorage.setItem("vc-wallet-connected", "1");
    const eth = makeEthereum();
    window.ethereum = eth;
    render(<WalletButton />);
    await screen.findByText("0x1234…5678");
    const methods = eth.request.mock.calls.map((c) => c[0].method);
    expect(methods).toContain("eth_accounts");
    expect(methods).not.toContain("eth_requestAccounts");
  });

  it("accountsChanged [] disconnects; chainChanged updates badge; listeners removed", async () => {
    localStorage.setItem("vc-wallet-connected", "1");
    const eth = makeEthereum();
    window.ethereum = eth;
    const { unmount } = render(<WalletButton />);
    fireEvent.click(await screen.findByRole("button", { name: /0x1234/ }));
    await waitFor(() => expect(within(screen.getByRole("dialog")).getByText("Ethereum")).toBeInTheDocument());
    eth.state.chain = "0x89";
    await act(async () => { eth.emit("chainChanged", "0x89"); });
    await waitFor(() => expect(within(screen.getByRole("dialog")).getByText("Polygon")).toBeInTheDocument());
    await act(async () => { eth.emit("accountsChanged", []); });
    expect(await screen.findByRole("button", { name: /connect wallet/i })).toBeInTheDocument();
    expect(localStorage.getItem("vc-wallet-connected")).toBe("0");
    unmount();
    expect(eth.handlers.accountsChanged).toHaveLength(0);
    expect(eth.handlers.chainChanged).toHaveLength(0);
  });

  it("Forget wallet clears state", async () => {
    localStorage.setItem("vc-wallet-connected", "1");
    window.ethereum = makeEthereum();
    render(<WalletButton />);
    fireEvent.click(await screen.findByRole("button", { name: /0x1234/ }));
    fireEvent.click(screen.getByRole("button", { name: "Forget wallet" }));
    expect(await screen.findByRole("button", { name: /connect wallet/i })).toBeInTheDocument();
    expect(localStorage.getItem("vc-wallet-connected")).toBe("0");
  });

  it("Escape closes the popover", async () => {
    window.ethereum = makeEthereum();
    render(<WalletButton />);
    fireEvent.click(screen.getByRole("button", { name: /connect wallet/i }));
    fireEvent.click(await screen.findByRole("button", { name: /0x1234/ }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
