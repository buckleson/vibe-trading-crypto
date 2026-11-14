import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";
import { Badge, Button, Card, CardBody, CardHeader, Page, PageHeader, Stat, Table, TBody, TD, TH, THead, TR } from "@/components/ui";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";
import {
  buildPayoffRequest,
  buildPresetLegs,
  DEFAULT_PARAMS,
  type OptionLeg,
  type PayoffAlternative,
  type OptionsLabParams,
  type OptionsPayoffRequest,
  type OptionsPayoffResponse,
} from "@/lib/options";
import { StrategyBuilder } from "@/components/options/StrategyBuilder";
import { PayoffComparisons } from "@/components/options/PayoffComparisons";
import { GreeksCards } from "@/components/options/GreeksCards";
import { OptionsChainTable } from "@/components/options/OptionsChainTable";
import { OptionsPayoffChart } from "@/components/charts/OptionsPayoffChart";
import { OptionsScenarioMatrix } from "@/components/charts/OptionsScenarioMatrix";
import { VolatilitySurfaceGrid } from "@/components/options/VolatilitySurfaceGrid";
import { useAnalysisState } from "@/hooks/useAnalysisState";

const ANALYZE_DEBOUNCE_MS = 250;

function MetricCard({
  label,
  value,
  badge,
  badgeTone = "neutral",
  valueTone = "neutral",
}: {
  label: string;
  value: string;
  badge?: string;
  badgeTone?: "debit" | "credit" | "neutral";
  valueTone?: "positive" | "negative" | "neutral";
}) {
  const tone = valueTone === "positive" ? "success" : valueTone === "negative" ? "danger" : "neutral";
  const badgeTn = badgeTone === "debit" ? "danger" : badgeTone === "credit" ? "success" : "neutral";
  return (
    <Card className="p-4">
      <Stat label={<span className="flex items-center justify-between gap-2">{label}{badge && <Badge tone={badgeTn}>{badge}</Badge>}</span>}
        value={<span className="block truncate text-lg">{value}</span>} tone={tone} />
    </Card>
  );
}

export function OptionsLab() {
  const { t } = useTranslation();

  const [draft, setDraft] = useAnalysisState("options", {
    label: null as string | null,
    alternatives: null as PayoffAlternative[] | null,
    params: DEFAULT_PARAMS as OptionsLabParams,
    legs: buildPresetLegs("long_call", DEFAULT_PARAMS.entry_spot) ?? [],
    activePresetId: "long_call" as string | null,
    result: null as OptionsPayoffResponse | null,
    resultRequest: null as OptionsPayoffRequest | null,
    updatedAt: "",
  });
  const { params, legs, activePresetId, result, resultRequest, updatedAt } = draft;
  const label = draft.label ?? t("options.comparison.current");
  const alternatives = draft.alternatives ?? [];
  const setParams = (params: OptionsLabParams) => setDraft((d) => ({ ...d, params }));
  const [retry, setRetry] = useState(0);
  const [chainOpen, setChainOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);
  const req = useMemo(() => {
    const primary = buildPayoffRequest(legs, params);
    return primary ? { ...primary, label, alternatives } : null;
  }, [legs, params, label, alternatives]);
  const signature = req ? JSON.stringify(req) : null;
  const currentSignature = useRef(signature);
  currentSignature.current = signature;
  const fresh = signature !== null && signature === JSON.stringify(resultRequest);

  useEffect(() => {
    const gen = ++generation.current;
    const controller = new AbortController();
    setError(null);
    if (!req || (fresh && retry === 0)) { setLoading(false); return; }
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const res = await api.analyzeOptionsPayoff(req, controller.signal);
        if (generation.current === gen && currentSignature.current === signature) {
          setDraft((d) => ({ ...d, result: res, resultRequest: req, updatedAt: new Date().toISOString() }));
        }
      } catch (e) {
        if (!controller.signal.aborted && generation.current === gen) setError(e instanceof Error ? e.message : t("options.errorGeneric"));
      } finally {
        if (generation.current === gen) setLoading(false);
      }
    }, ANALYZE_DEBOUNCE_MS);
    return () => { clearTimeout(timer); generation.current += 1; controller.abort(); };
    // A completed result must not dispatch its own calculation again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, retry]);

  const applyPreset = (presetId: string) => {
    const presetLegs = buildPresetLegs(presetId, params.entry_spot);
    if (!presetLegs) return;
    setDraft((d) => ({ ...d, activePresetId: presetId, legs: presetLegs }));
  };

  const handleLegsChange = (next: OptionLeg[]) => {
    setDraft((d) => ({ ...d, activePresetId: null, legs: next }));
  };

  const summary = result?.summary ?? null;
  const dash = "–";

  const breakevensText = summary
    ? summary.breakevens.length > 0
      ? summary.breakevens.map((be) => be.toLocaleString()).join(", ")
      : t("options.metrics.none")
    : dash;

  const maxProfitText = summary
    ? summary.profit_unbounded
      ? t("options.metrics.unlimited")
      : summary.max_profit !== null
        ? summary.max_profit.toLocaleString(undefined, { maximumFractionDigits: 2 })
        : t("options.metrics.none")
    : dash;

  const maxLossText = summary
    ? summary.loss_unbounded
      ? t("options.metrics.unlimited")
      : summary.max_loss !== null
        ? summary.max_loss.toLocaleString(undefined, { maximumFractionDigits: 2 })
        : t("options.metrics.none")
    : dash;

  return (
    <Page>
      <PageHeader title={t("options.title")} description={t("options.subtitle")} />

      {/* Builder + results */}
      <div role="status" aria-live="polite" className="rounded-lg border border-border bg-card px-3 py-2 text-sm">
        {!req ? t("analysis.invalid") : loading ? t("analysis.updating") : error ? t("analysis.failed") : fresh ? t("analysis.updated") : t("analysis.editing")}
        {result && !fresh && <span className="ms-2 text-warning">{t("analysis.previousResult")}</span>}
        {updatedAt && <span className="ms-2 text-xs text-muted-foreground">{t("analysis.lastComputed", { time: new Date(updatedAt).toLocaleTimeString() })}</span>}
      </div>
      <div className="grid gap-6 xl:grid-cols-[minmax(26rem,2fr)_minmax(0,3fr)]">
        <div className="min-w-0">
          <StrategyBuilder
            legs={legs}
            params={params}
            activePresetId={activePresetId}
            onApplyPreset={applyPreset}
            onLegsChange={handleLegsChange}
            onParamsChange={setParams}
          />
        </div>

        <div className="flex min-w-0 flex-col gap-6">
          {/* Key-metrics strip */}
          <div className={cn("grid grid-cols-2 gap-3 2xl:grid-cols-4", (loading || !fresh) && "opacity-60")}>
            <MetricCard
              label={t("options.metrics.entryCost")}
              value={
                summary
                  ? summary.entry_cost.toLocaleString(undefined, { maximumFractionDigits: 2 })
                  : dash
              }
              badge={summary ? t(`options.metrics.${summary.entry_side}`) : undefined}
              badgeTone={
                summary ? (summary.entry_side === "flat" ? "neutral" : summary.entry_side) : "neutral"
              }
            />
            <MetricCard label={t("options.metrics.breakevens")} value={breakevensText} />
            <MetricCard
              label={t("options.metrics.maxProfit")}
              value={maxProfitText}
              valueTone={summary && !summary.profit_unbounded && (summary.max_profit ?? 0) > 0 ? "positive" : "neutral"}
            />
            <MetricCard
              label={t("options.metrics.maxLoss")}
              value={maxLossText}
              valueTone={summary && !summary.loss_unbounded && (summary.max_loss ?? 0) < 0 ? "negative" : "neutral"}
            />
          </div>

          {/* Backend error banner */}
          {error && (
            <div role="alert" className="flex items-center justify-between rounded-lg border border-danger/30 bg-danger/5 p-3 text-sm text-danger">{error}<Button size="sm" onClick={() => setRetry((n) => n + 1)}>{t("connection.retry")}</Button></div>
          )}

          {/* Payoff diagram */}
          <Card>
            <CardHeader title={t("options.payoff.title")} actions={loading ? (
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                {t("options.builder.analyzing")}
              </span>
            ) : undefined} />
            <CardBody>
            <OptionsPayoffChart
              curve={result?.expiry_curve ?? { spot: [], pnl: [] }}
              entrySpot={resultRequest?.entry_spot ?? params.entry_spot}
              breakevens={summary?.breakevens ?? []}
            />
            </CardBody>
          </Card>
        </div>
      </div>

      {!!result?.expiry_scenarios?.length && (
        <Card>
          <CardHeader title={t("options.expiryScenarios.title")} />
          <CardBody>
            <Table>
              <THead><TR>
                <TH>{t("options.expiryScenarios.spot")}</TH>
                <TH numeric>{t("options.expiryScenarios.pnl")}</TH>
                <TH numeric>{t("options.expiryScenarios.return")}</TH>
              </TR></THead>
              <TBody>{result.expiry_scenarios.map((row, index) => (
                <TR key={index}>
                  <TD numeric>{row.spot.toLocaleString()}</TD>
                  <TD numeric>{row.pnl.toLocaleString(undefined, { maximumFractionDigits: 2 })}</TD>
                  <TD numeric>{row.return_percent == null ? "-" : `${row.return_percent.toFixed(2)}%`}</TD>
                </TR>
              ))}</TBody>
            </Table>
          </CardBody>
        </Card>
      )}

      <PayoffComparisons
        label={label} alternatives={alternatives} legs={legs} comparisons={result?.comparisons}
        onChange={(label, alternatives) => setDraft((d) => ({ ...d, label, alternatives }))}
      />

      {/* Portfolio Greeks */}
      {result && <GreeksCards greeks={result.greeks} />}

      {/* Spot x IV scenario matrix */}
      <Card>
        <CardHeader title={t("options.scenario.title")} />
        <CardBody>
        <OptionsScenarioMatrix
          grid={result?.scenario_grid ?? { iv_values: [], spot: [], pnl: [] }}
        />
        {result && result.limitations.length > 0 && (
          <ul className="mt-2 list-disc ps-5 text-xs text-muted-foreground">
            {result.limitations.map((lim, i) => (
              <li key={i}>{lim}</li>
            ))}
          </ul>
        )}
        </CardBody>
      </Card>

      {/* Observed and interpolated volatility surface */}
      <VolatilitySurfaceGrid />

      {/* Live US options chain */}
      <details className="rounded-lg border border-border bg-card p-4" onToggle={(e) => setChainOpen(e.currentTarget.open)}>
        <summary className="cursor-pointer text-sm font-semibold">{t("options.chain.title")}</summary>
        <p className="my-2 text-xs text-muted-foreground">{t("analysis.chainOnDemand")}</p>
        {chainOpen && <OptionsChainTable />}
      </details>

      <p className="pb-2 text-xs text-muted-foreground">{t("options.disclaimer")}</p>
    </Page>
  );
}
