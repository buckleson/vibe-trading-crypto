import { useEffect, useRef, type ReactElement } from "react";
import { Copy, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { Badge, Button } from "@/components/ui";
import { chainLabel, formatUnits } from "@/lib/wallet";

const BOX = "absolute right-0 top-full z-50 mt-2 w-72 rounded-lg border bg-popover p-3 text-popover-foreground shadow-lg focus:outline-none";

async function copy(text: string, okMsg: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(okMsg);
  } catch {
    toast.error(text);
  }
}

export function NoWalletPopover({ onClose }: { onClose: () => void }): ReactElement {
  const { t } = useTranslation();
  const ref = usePopoverBehavior(onClose);
  const desktop = !!window.vibeDesktop?.isDesktop;
  const url = window.location.origin;
  return (
    <div ref={ref} role="dialog" tabIndex={-1} aria-label={t("wallet.noWalletTitle", { defaultValue: "No browser wallet found" })} className={BOX}>
      <p className="text-sm font-medium">{t("wallet.noWalletTitle", { defaultValue: "No browser wallet found" })}</p>
      {desktop ? (
        <>
          <p className="mt-1 text-[13px] text-muted-foreground">
            {t("wallet.desktopNote", { url, defaultValue: "Browser wallets do not run inside the desktop app. Open {{url}} in a browser with MetaMask to connect." })}
          </p>
          <Button size="sm" className="mt-3" onClick={() => copy(url, t("wallet.linkCopied", { defaultValue: "Link copied" }))}>
            <Copy className="h-3.5 w-3.5" aria-hidden="true" />
            {t("wallet.copyLink", { defaultValue: "Copy link" })}
          </Button>
        </>
      ) : (
        <>
          <p className="mt-1 text-[13px] text-muted-foreground">
            {t("wallet.noWalletText", { defaultValue: "Install MetaMask to see your wallet address and balance here." })}
          </p>
          <a href="https://metamask.io/download/" target="_blank" rel="noopener noreferrer" className="mt-3 inline-block text-[13px] font-medium text-primary hover:underline">
            {t("wallet.getMetaMask", { defaultValue: "Get MetaMask" })}
          </a>
        </>
      )}
    </div>
  );
}

export function ConnectedPopover(props: {
  address: string; chainId: number | null; balance: bigint | null; loading: boolean; error: string | null;
  onRefresh: () => void; onForget: () => void; onClose: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const { address, chainId, balance, loading, error, onRefresh, onForget, onClose } = props;
  const ref = usePopoverBehavior(onClose);
  const chain = chainId != null ? chainLabel(chainId) : null;
  const label = t("wallet.popoverLabel", { defaultValue: "Wallet details" });
  return (
    <div ref={ref} role="dialog" tabIndex={-1} aria-label={label} className={BOX}>
      <div className="flex items-start gap-2">
        <p className="min-w-0 flex-1 break-all font-mono text-xs">{address}</p>
        <Button size="sm" variant="ghost" className="h-7 px-2" aria-label={t("wallet.copyAddress", { defaultValue: "Copy address" })}
          onClick={() => copy(address, t("wallet.addressCopied", { defaultValue: "Address copied" }))}>
          <Copy className="h-3.5 w-3.5" aria-hidden="true" />
        </Button>
      </div>
      <div className="mt-3 flex items-center justify-between gap-2">
        {chain ? <Badge>{chain.name}</Badge> : <span />}
        <div className="flex items-center gap-1">
          <span className="text-sm font-medium tabular-nums" data-testid="wallet-balance">
            {balance != null && chain ? `${formatUnits(balance)} ${chain.symbol}` : "…"}
          </span>
          <Button size="sm" variant="ghost" className="h-7 px-2" loading={loading} aria-label={t("wallet.refresh", { defaultValue: "Refresh balance" })} onClick={onRefresh}>
            {!loading && <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />}
          </Button>
        </div>
      </div>
      {error && <p role="alert" className="mt-2 text-xs text-danger">{error}</p>}
      <p className="mt-3 text-xs text-muted-foreground">
        {t("wallet.readOnly", { defaultValue: "Read only. Vibe Crypto never asks your wallet to sign anything." })}
      </p>
      <Button size="sm" variant="ghost" className="mt-2 w-full" onClick={onForget}>
        {t("wallet.forget", { defaultValue: "Forget wallet" })}
      </Button>
      <p className="mt-1 text-xs text-muted-foreground">
        {t("wallet.forgetNote", { defaultValue: "To fully disconnect, also remove this site in MetaMask." })}
      </p>
    </div>
  );
}

function usePopoverBehavior(onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    const onDown = (e: MouseEvent) => {
      const root = ref.current?.parentElement;
      if (root && !root.contains(e.target as Node)) onClose();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [onClose]);
  return ref;
}

