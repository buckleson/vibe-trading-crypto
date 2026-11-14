// T12: read-only EIP-1193 helpers in lib/wallet.ts.
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  CHAIN_INFO,
  chainLabel,
  connectWallet,
  formatUnits,
  getAccounts,
  getBalanceWei,
  getChainId,
  getProvider,
  isUserRejection,
  shortAddress,
  type Eip1193Provider,
} from "@/lib/wallet";

const ADDR = "0x1234567890abcdef1234567890abcdef12345678";
const ETH = 10n ** 18n;

function fake(result: unknown): Eip1193Provider & { request: ReturnType<typeof vi.fn> } {
  return { request: vi.fn(async () => result) } as unknown as Eip1193Provider & { request: ReturnType<typeof vi.fn> };
}

afterEach(() => {
  delete window.ethereum;
});

describe("formatUnits", () => {
  it.each([
    [0n, "0"],
    [1n, "0"], // 1 wei truncates to zero at 4 fraction digits
    [ETH / 10000n, "0.0001"],
    [ETH / 10000n - 1n, "0"], // 0.00009999... rounds down, never up
    [ETH, "1"],
    [ETH + ETH / 2n, "1.5"],
    [ETH * 2n + 10n ** 13n, "2"], // 2.00001 truncates to 2, no trailing zeros or dot
    [(ETH * 19999n) / 10000n, "1.9999"],
    [ETH * 2n - 1n, "1.9999"], // 1.999999999999999999 rounds down, not to 2
    [ETH * 999n, "999"],
    [ETH * 1000n, "1,000"],
    [ETH * 1234567n + (ETH * 8912n) / 10000n + 34n, "1,234,567.8912"],
    [ETH * 1_000_000_000n, "1,000,000,000"],
  ])("formats %s wei as %s", (wei, out) => {
    expect(formatUnits(wei)).toBe(out);
  });

  it("keeps exact precision far above Number.MAX_SAFE_INTEGER", () => {
    // 123456789012345678901234567 ETH + 0.1234 ETH, impossible to represent as a float
    const wei = 123456789012345678901234567n * ETH + (ETH * 1234n) / 10000n;
    expect(formatUnits(wei)).toBe("123,456,789,012,345,678,901,234,567.1234");
  });

  it("trims trailing zeros in the fraction", () => {
    expect(formatUnits(ETH + ETH / 10n)).toBe("1.1");
    expect(formatUnits(ETH + ETH / 100n)).toBe("1.01");
  });

  it("honours custom decimals (USDC style 6)", () => {
    expect(formatUnits(1_500_000n, 6)).toBe("1.5");
    expect(formatUnits(1n, 6)).toBe("0");
    expect(formatUnits(123_456_789n, 6)).toBe("123.4567");
  });

  it("honours maxFraction", () => {
    expect(formatUnits(ETH + ETH / 3n, 18, 2)).toBe("1.33");
    expect(formatUnits(ETH + ETH / 3n, 18, 8)).toBe("1.33333333");
    expect(formatUnits(ETH + ETH / 2n, 18, 0)).toBe("1");
  });

  it("handles decimals = 0", () => {
    expect(formatUnits(1234n, 0)).toBe("1,234");
  });

  it("formats negative values with a leading minus", () => {
    expect(formatUnits(-(ETH + ETH / 2n))).toBe("-1.5");
  });

  it("uses default args of 18 decimals and 4 fraction digits", () => {
    expect(formatUnits(ETH + 123456789n * 10n ** 9n)).toBe(formatUnits(ETH + 123456789n * 10n ** 9n, 18, 4));
    expect(formatUnits(ETH + 123456789n * 10n ** 9n)).toBe("1.1234");
  });

  it("never emits scientific notation or NaN", () => {
    const out = formatUnits(10n ** 40n);
    expect(out).not.toMatch(/e|NaN|Infinity/i);
    expect(out.replace(/,/g, "")).toBe("1" + "0".repeat(22));
  });
});

describe("shortAddress", () => {
  it("keeps the first 6 and last 4 characters joined by U+2026", () => {
    expect(shortAddress(ADDR)).toBe("0x1234…5678");
    expect(shortAddress(ADDR)).toHaveLength(11);
  });

  it("never uses an em dash or three dots", () => {
    const s = shortAddress(ADDR);
    expect(s).not.toContain("—");
    expect(s).not.toContain("...");
  });

  it("preserves checksum casing", () => {
    expect(shortAddress("0xAbCdEf0000000000000000000000000000Fe12")).toBe("0xAbCd…Fe12");
  });
});

describe("CHAIN_INFO and chainLabel", () => {
  it("contains exactly the specified chains", () => {
    expect(CHAIN_INFO).toEqual({
      1: { name: "Ethereum", symbol: "ETH" },
      10: { name: "Optimism", symbol: "ETH" },
      56: { name: "BNB Smart Chain", symbol: "BNB" },
      137: { name: "Polygon", symbol: "POL" },
      8453: { name: "Base", symbol: "ETH" },
      42161: { name: "Arbitrum One", symbol: "ETH" },
      43114: { name: "Avalanche C-Chain", symbol: "AVAX" },
      11155111: { name: "Sepolia", symbol: "ETH" },
    });
  });

  it("labels known chains", () => {
    expect(chainLabel(137)).toEqual({ name: "Polygon", symbol: "POL" });
    expect(chainLabel(43114)).toEqual({ name: "Avalanche C-Chain", symbol: "AVAX" });
  });

  it.each([1337, 31337, 0, 999999])("falls back for unknown chain %i", (id) => {
    expect(chainLabel(id)).toEqual({ name: `Chain ${id}`, symbol: "ETH" });
  });
});

describe("getProvider", () => {
  it("returns null when no wallet is injected", () => {
    delete window.ethereum;
    expect(getProvider()).toBeNull();
  });

  it("returns the injected provider", () => {
    const p = fake(null);
    window.ethereum = p;
    expect(getProvider()).toBe(p);
  });
});

describe("request wrappers", () => {
  it("connectWallet uses eth_requestAccounts", async () => {
    const p = fake([ADDR]);
    await expect(connectWallet(p)).resolves.toEqual([ADDR]);
    expect(p.request).toHaveBeenCalledWith({ method: "eth_requestAccounts" });
    expect(p.request).toHaveBeenCalledTimes(1);
  });

  it("getAccounts uses eth_accounts (no prompt) and may return []", async () => {
    const p = fake([]);
    await expect(getAccounts(p)).resolves.toEqual([]);
    expect(p.request).toHaveBeenCalledWith({ method: "eth_accounts" });
  });

  it.each([
    ["0x1", 1],
    ["0xa", 10],
    ["0x38", 56],
    ["0x89", 137],
    ["0x2105", 8453],
    ["0xa4b1", 42161],
    ["0xA4B1", 42161],
    ["0xa86a", 43114],
    ["0xaa36a7", 11155111],
  ])("getChainId parses %s as %i", async (hex, id) => {
    const p = fake(hex);
    await expect(getChainId(p)).resolves.toBe(id);
    expect(p.request).toHaveBeenCalledWith({ method: "eth_chainId" });
  });

  it("getBalanceWei requests the latest block and returns an exact bigint", async () => {
    const p = fake("0x14d1120d7b160000");
    const bal = await getBalanceWei(p, ADDR);
    expect(typeof bal).toBe("bigint");
    expect(bal).toBe(ETH + ETH / 2n);
    expect(p.request).toHaveBeenCalledWith({ method: "eth_getBalance", params: [ADDR, "latest"] });
  });

  it("getBalanceWei handles 0x0 and huge balances", async () => {
    await expect(getBalanceWei(fake("0x0"), ADDR)).resolves.toBe(0n);
    const huge = "0x" + "f".repeat(64);
    await expect(getBalanceWei(fake(huge), ADDR)).resolves.toBe(2n ** 256n - 1n);
  });

  it("propagates provider errors", async () => {
    const err = Object.assign(new Error("User rejected"), { code: 4001 });
    const p = { request: vi.fn(async () => { throw err; }) } as Eip1193Provider;
    await expect(connectWallet(p)).rejects.toBe(err);
    await expect(getChainId(p)).rejects.toBe(err);
    await expect(getBalanceWei(p, ADDR)).rejects.toBe(err);
  });
});

describe("isUserRejection", () => {
  it.each([
    [{ code: 4001 }, true],
    [Object.assign(new Error("rejected"), { code: 4001 }), true],
    [{ code: 4001, message: "User rejected the request." }, true],
    [{ code: "4001" }, false],
    [{ code: 4100 }, false],
    [{ code: -32002 }, false],
    [{ code: -32603 }, false],
    [new Error("rejected"), false],
    [{}, false],
    [null, false],
    [undefined, false],
    ["4001", false],
    [4001, false],
  ])("isUserRejection(%o) === %s", (err, expected) => {
    expect(isUserRejection(err)).toBe(expected);
  });
});
