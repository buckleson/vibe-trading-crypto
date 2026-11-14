import { describe, it, expect } from "vitest";
import {
  formatUnits, shortAddress, getChainId, getBalanceWei, getAccounts, connectWallet,
  isUserRejection, chainLabel, getProvider, type Eip1193Provider,
} from "@/lib/wallet";

const fake = (answers: Record<string, unknown>): Eip1193Provider & { calls: { method: string; params?: unknown[] }[] } => {
  const calls: { method: string; params?: unknown[] }[] = [];
  return { calls, request: async (a) => { calls.push(a); return answers[a.method]; } };
};

describe("formatUnits", () => {
  it("formats zero, tiny, fractional and large values", () => {
    expect(formatUnits(0n)).toBe("0");
    expect(formatUnits(1n)).toBe("0");
    expect(formatUnits(1500000000000000000n)).toBe("1.5");
    expect(formatUnits(1234567n * 10n ** 18n + 5n * 10n ** 17n)).toBe("1,234,567.5");
    expect(formatUnits(1_000_000_000_000_000_000_000_000n)).toBe("1,000,000");
  });
  it("rounds down, never up", () => {
    expect(formatUnits(1999999999999999999n)).toBe("1.9999");
    expect(formatUnits(1999999999999999999n, 18, 2)).toBe("1.99");
  });
});

describe("shortAddress", () => {
  it("keeps first 6 and last 4 with an ellipsis", () => {
    const s = shortAddress("0x1234567890abcdef1234567890abcdef12345678");
    expect(s).toBe("0x1234…5678");
    expect(s).not.toContain("—");
  });
});

describe("provider helpers", () => {
  it("parses hex chain id", async () => {
    expect(await getChainId(fake({ eth_chainId: "0x2105" }))).toBe(8453);
  });
  it("reads balance with latest", async () => {
    const p = fake({ eth_getBalance: "0x14d1120d7b160000" });
    expect(await getBalanceWei(p, "0xabc")).toBe(1500000000000000000n);
    expect(p.calls[0].params).toEqual(["0xabc", "latest"]);
  });
  it("uses the right account methods", async () => {
    const p = fake({ eth_accounts: ["0x1"], eth_requestAccounts: ["0x2"] });
    expect(await getAccounts(p)).toEqual(["0x1"]);
    expect(await connectWallet(p)).toEqual(["0x2"]);
  });
  it("getProvider reads window.ethereum", () => {
    expect(getProvider()).toBeNull();
    const p = fake({});
    window.ethereum = p;
    expect(getProvider()).toBe(p);
    delete window.ethereum;
  });
});

describe("misc", () => {
  it("detects rejection", () => {
    expect(isUserRejection({ code: 4001 })).toBe(true);
    expect(isUserRejection({ code: -32000 })).toBe(false);
    expect(isUserRejection(null)).toBe(false);
  });
  it("labels chains with fallback", () => {
    expect(chainLabel(137)).toEqual({ name: "Polygon", symbol: "POL" });
    expect(chainLabel(999)).toEqual({ name: "Chain 999", symbol: "ETH" });
  });
});
