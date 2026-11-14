import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { safeGet, safeSet } from "@/lib/storage";
import {
  connectWallet, getAccounts, getBalanceWei, getChainId, getProvider, isUserRejection,
  type Eip1193Provider,
} from "@/lib/wallet";

export const WALLET_FLAG = "vc-wallet-connected";

export function useWallet() {
  const { t } = useTranslation();
  const [provider] = useState<Eip1193Provider | null>(() => getProvider());
  const [accounts, setAccounts] = useState<string[]>([]);
  const [chainId, setChainId] = useState<number | null>(null);
  const [balance, setBalance] = useState<bigint | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const accountRef = useRef<string | undefined>(undefined);
  accountRef.current = accounts[0];

  const refresh = useCallback(async (address?: string) => {
    const addr = address ?? accountRef.current;
    if (!provider || !addr) return;
    setLoading(true);
    setError(null);
    try {
      const [id, bal] = await Promise.all([getChainId(provider), getBalanceWei(provider, addr)]);
      setChainId(id);
      setBalance(bal);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [provider]);

  const clear = useCallback(() => {
    setAccounts([]);
    setChainId(null);
    setBalance(null);
    setError(null);
    safeSet(WALLET_FLAG, "0");
  }, []);

  useEffect(() => {
    if (!provider) return;
    let alive = true;
    if (safeGet(WALLET_FLAG) === "1") {
      getAccounts(provider).then((accs) => {
        if (!alive) return;
        if (accs.length) {
          setAccounts(accs);
          void refresh(accs[0]);
        } else {
          safeSet(WALLET_FLAG, "0");
        }
      }).catch(() => {});
    }
    const onAccounts = (...args: unknown[]) => {
      const accs = (args[0] as string[]) ?? [];
      if (!accs.length) { clear(); return; }
      if (safeGet(WALLET_FLAG) !== "1") return;
      setAccounts(accs);
      void refresh(accs[0]);
    };
    const onChain = () => { void refresh(); };
    provider.on?.("accountsChanged", onAccounts);
    provider.on?.("chainChanged", onChain);
    return () => {
      alive = false;
      provider.removeListener?.("accountsChanged", onAccounts);
      provider.removeListener?.("chainChanged", onChain);
    };
  }, [provider, refresh, clear]);

  const connect = useCallback(async () => {
    if (!provider) return;
    setLoading(true);
    try {
      const accs = await connectWallet(provider);
      if (accs.length) {
        safeSet(WALLET_FLAG, "1");
        setAccounts(accs);
        await refresh(accs[0]);
      }
    } catch (e) {
      if (isUserRejection(e)) toast.error(t("wallet.declined", { defaultValue: "Wallet connection was declined" }));
      else toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [provider, refresh, t]);

  return { provider, address: accounts[0] ?? null, chainId, balance, loading, error, connect, refresh: () => refresh(), forget: clear };
}
