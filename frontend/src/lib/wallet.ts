// Read-only EIP-1193 helpers. No signing, no transactions, no SDK.

export interface Eip1193Provider {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
  on?(event: string, handler: (...args: unknown[]) => void): void;
  removeListener?(event: string, handler: (...args: unknown[]) => void): void;
  isMetaMask?: boolean;
}

declare global {
  interface Window {
    ethereum?: Eip1193Provider;
  }
}

export const CHAIN_INFO: Record<number, { name: string; symbol: string }> = {
  1: { name: "Ethereum", symbol: "ETH" },
  10: { name: "Optimism", symbol: "ETH" },
  56: { name: "BNB Smart Chain", symbol: "BNB" },
  137: { name: "Polygon", symbol: "POL" },
  8453: { name: "Base", symbol: "ETH" },
  42161: { name: "Arbitrum One", symbol: "ETH" },
  43114: { name: "Avalanche C-Chain", symbol: "AVAX" },
  11155111: { name: "Sepolia", symbol: "ETH" },
};

export function chainLabel(id: number): { name: string; symbol: string } {
  return CHAIN_INFO[id] ?? { name: `Chain ${id}`, symbol: "ETH" };
}

export function getProvider(): Eip1193Provider | null {
  if (typeof window === "undefined") return null;
  return window.ethereum ?? null;
}

export async function connectWallet(p: Eip1193Provider): Promise<string[]> {
  return (await p.request({ method: "eth_requestAccounts" })) as string[];
}

export async function getAccounts(p: Eip1193Provider): Promise<string[]> {
  return (await p.request({ method: "eth_accounts" })) as string[];
}

export async function getChainId(p: Eip1193Provider): Promise<number> {
  const hex = (await p.request({ method: "eth_chainId" })) as string;
  return parseInt(hex, 16);
}

export async function getBalanceWei(p: Eip1193Provider, address: string): Promise<bigint> {
  const hex = (await p.request({ method: "eth_getBalance", params: [address, "latest"] })) as string;
  return BigInt(hex);
}

export function formatUnits(wei: bigint, decimals = 18, maxFraction = 4): string {
  if (wei === 0n) return "0";
  const neg = wei < 0n;
  const abs = neg ? -wei : wei;
  const base = 10n ** BigInt(decimals);
  const whole = abs / base;
  let frac = (abs % base).toString().padStart(decimals, "0").slice(0, maxFraction).replace(/0+$/, "");
  const wholeStr = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const out = frac ? `${wholeStr}.${frac}` : wholeStr;
  return neg ? `-${out}` : out;
}

export function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function isUserRejection(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: unknown }).code === 4001;
}
