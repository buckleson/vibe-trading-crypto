import { useCallback, useState, type ReactElement } from "react";
import { Wallet } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui";
import { chainLabel, shortAddress } from "@/lib/wallet";
import { ConnectedPopover, NoWalletPopover } from "./WalletPopover";
import { useWallet } from "./useWallet";

export function WalletButton(): ReactElement {
  const { t } = useTranslation();
  const w = useWallet();
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);

  const onClick = () => {
    if (w.address) setOpen((o) => !o);
    else if (!w.provider) setOpen((o) => !o);
    else void w.connect();
  };

  return (
    <div className="relative">
      <Button variant="ghost" size="sm" onClick={onClick} loading={w.loading && !w.address}
        aria-haspopup="dialog" aria-expanded={open}>
        {w.address ? (
          <>
            <span className="h-2 w-2 rounded-full bg-success" aria-hidden="true" />
            <span className="font-mono text-[13px]">{shortAddress(w.address)}</span>
            {w.chainId != null && <span className="hidden text-muted-foreground md:inline">{chainLabel(w.chainId).name}</span>}
          </>
        ) : (
          <>
            <Wallet className="h-4 w-4" aria-hidden="true" />
            {t("wallet.connect", { defaultValue: "Connect wallet" })}
          </>
        )}
      </Button>
      {open && w.address && (
        <ConnectedPopover address={w.address} chainId={w.chainId} balance={w.balance} loading={w.loading} error={w.error}
          onRefresh={w.refresh} onForget={() => { w.forget(); setOpen(false); }} onClose={close} />
      )}
      {open && !w.address && !w.provider && <NoWalletPopover onClose={close} />}
    </div>
  );
}
