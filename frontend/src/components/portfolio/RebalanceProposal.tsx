import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, Card, CardBody, CardHeader, Input, Table, TBody, TD, TH, THead, TR } from "@/components/ui";
import { api, type PortfolioSnapshot, type RebalanceProposal as Proposal } from "@/lib/api";

/** Value-only drift analysis against the exact snapshot shown to the user. */
export function RebalanceProposal({ snapshot }: { snapshot: PortfolioSnapshot }) {
  const { t, i18n } = useTranslation();
  const [targets, setTargets] = useState<Record<string, string>>({});
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { setTargets({}); setProposal(null); setError(""); }, [snapshot.snapshot_id]);
  const ids = [...(snapshot.combined_holdings ?? []).flatMap((row) => row.canonical_id ? [row.canonical_id] : []), "CASH"];
  const money = (value: number) => new Intl.NumberFormat(i18n.language, { style: "currency", currency: proposal?.currency ?? (snapshot.display_currency ?? "USD"), maximumFractionDigits: 2 }).format(value);
  return <Card>
    <details>
      <summary className="cursor-pointer list-none rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 [&::-webkit-details-marker]:hidden">
        <CardHeader title={t("portfolio.rebalance.title")} description={t("portfolio.rebalance.hint")} />
      </summary>
      <CardBody className="space-y-4">
        <form className="space-y-4" onSubmit={async (event) => {
          event.preventDefault(); setBusy(true); setError(""); setProposal(null);
          try {
            const response = await api.proposePortfolioRebalance(snapshot.snapshot_id, Object.fromEntries(ids.map((id) => [id, Number(targets[id] || 0) / 100])));
            setProposal(response.proposal);
          } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
          finally { setBusy(false); }
        }}>
          <div className="grid max-h-80 gap-2 overflow-y-auto sm:grid-cols-2 lg:grid-cols-3">{ids.map((id) => <label key={id} className="flex items-center justify-between gap-2 rounded-md border border-border p-2 text-[13px]"><span className="break-all" dir="ltr">{id}</span><Input aria-label={t("portfolio.rebalance.target", { id })} type="number" min="0" max="100" step="any" value={targets[id] ?? ""} disabled={busy} onChange={(event) => { setTargets({ ...targets, [id]: event.target.value }); setProposal(null); }} className="w-24 tabular-nums" placeholder="0 %" /></label>)}</div>
          <div className="flex justify-end">
            <Button type="submit" variant="primary" loading={busy} disabled={!snapshot.complete || !snapshot.combined_holdings}>{t("portfolio.rebalance.generate")}</Button>
          </div>
        </form>
        {error && <p role="alert" className="text-[13px] text-danger">{error}</p>}
        {proposal && <div className="space-y-2">
          <Table>
            <THead><tr><TH>{t("portfolio.holdings.colSymbol")}</TH><TH numeric>{t("portfolio.rebalance.current")}</TH><TH numeric>{t("portfolio.rebalance.targetValue")}</TH><TH numeric>{t("portfolio.rebalance.change")}</TH></tr></THead>
            <TBody>{proposal.rows.map((row) => <TR key={row.canonical_id}><TD dir="ltr">{row.canonical_id}</TD><TD numeric>{money(row.current_value)}</TD><TD numeric>{money(row.target_value)}</TD><TD numeric>{money(row.change_value)}</TD></TR>)}</TBody>
          </Table>
          <p className="text-xs text-muted-foreground">{t("portfolio.rebalance.hint")}</p>
        </div>}
      </CardBody>
    </details>
  </Card>;
}
