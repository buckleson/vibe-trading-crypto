import i18n from '@/i18n';
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams, useNavigate, useSearchParams } from "react-router";
import {
  AlertTriangle,
  ArrowDown,
  ArrowLeft,
  ArrowLeftRight,
  ArrowUp,
  BarChart3,
  Braces,
  CalendarRange,
  CheckCircle2,
  Code2,
  Coins,
  Copy,
  Database,
  Download,
  FileCheck2,
  Fingerprint,
  Gauge,
  List,
  LayoutDashboard,
  Loader2,
  LineChart,
  PieChart,
  ShieldCheck,
  Sigma,
  XCircle,
  CircleSlash,
} from "lucide-react";
import { toast } from "sonner";
import { Badge, Button, Card, EmptyState, Page, PageHeader, Table, THead, TBody, TR, TH, TD, Tabs } from "@/components/ui";
import { cn } from "@/lib/utils";
import { api, type BacktestMetrics, type EquityPoint, type FactorReportPayload, type RebalanceNotesPayload, type RiskXRayPayload, type RunCard, type RunData, type ValidationData } from "@/lib/api";
import {
  computeAnnualReturns,
  computeMonthlyReturns,
  computeTopDrawdowns,
  normalizeEquitySeries,
  toDrawdownZones,
} from "@/lib/tearsheet";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import { AnnualReturnsChart } from "@/components/charts/AnnualReturnsChart";
import { CandlestickChart } from "@/components/charts/CandlestickChart";
import { EquityChart } from "@/components/charts/EquityChart";
import { MonthlyReturnsHeatmap } from "@/components/charts/MonthlyReturnsHeatmap";
import { TopDrawdownsPanel } from "@/components/charts/TopDrawdownsPanel";
import { MetricsCard } from "@/components/chat/MetricsCard";
import { ValidationPanel } from "@/components/charts/ValidationPanel";
import { Skeleton, SkeletonMetrics, SkeletonChart } from "@/components/common/Skeleton";
import { ErrorBoundary } from "@/components/common/ErrorBoundary";
import { getStrategyReportIdentity, StrategyResearchDashboard } from "@/components/charts/StrategyResearchDashboard";
import { FactorResearchPanel } from "@/components/charts/FactorResearchPanel";
import { AttributionTab } from "@/components/charts/AttributionTab";
import { LlmUsagePanel } from "@/components/run/LlmUsagePanel";
import { PositionsTab } from "@/components/run/PositionsTab";
import { KeyValueTable, RunCardPanel, RunCardStat, formatRunCardValue } from "@/components/run/RunCard";
import { isDateColumn } from "@/lib/positions";
import { runTrades } from "@/lib/runReports";

const rehypePlugins = [rehypeHighlight];

type Tab = "dashboard" | "chart" | "tearsheet" | "trades" | "positions" | "attribution" | "runCard" | "llmUsage" | "code" | "validation" | "studio" | "factor";
type ChartPayload = Pick<RunData, "price_series" | "indicator_series" | "trade_markers">;
type ChartCache = Record<string, ChartPayload>;
type ChartLoadProgress = { done: number; total: number };

function downloadCsv(filename: string, csvContent: string) {
  const blob = new Blob(["\uFEFF" + csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function escapeCsvField(value: unknown): string {
  const str = String(value ?? "");
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function buildTradesCsv(trades: Array<Record<string, string>>): string {
  if (trades.length === 0) return "";
  const keys = [...new Set(trades.flatMap(Object.keys))];
  const header = keys.map(escapeCsvField).join(",");
  const rows = trades.map(tr => keys.map(k => escapeCsvField(tr[k])).join(","));
  return [header, ...rows].join("\n");
}

function buildMetricsCsv(metrics: BacktestMetrics): string {
  const header = "metric,value";
  const rows = Object.entries(metrics).map(([k, v]) => `${escapeCsvField(k)},${escapeCsvField(v)}`);
  return [header, ...rows].join("\n");
}

function cacheFromRun(run: RunData | null, requestedSymbol?: string): ChartCache {
  if (!run?.price_series) return {};
  const cache: ChartCache = {};
  const markerRows = run.trade_markers || [];
  for (const [symbol, bars] of Object.entries(run.price_series)) {
    cache[symbol] = {
      price_series: { [symbol]: bars },
      indicator_series: run.indicator_series?.[symbol] ? { [symbol]: run.indicator_series[symbol] } : {},
      trade_markers: markerRows.filter((marker) => !marker.code || marker.code === symbol),
    };
  }
  if (requestedSymbol && !cache[requestedSymbol]) {
    cache[requestedSymbol] = { price_series: {}, indicator_series: {}, trade_markers: [] };
  }
  return cache;
}

function yieldToBrowser(): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, 0);
  });
}

export function RunDetail() {
  const { runId } = useParams<{ runId: string }>();
  const [searchParams] = useSearchParams();
  const requestedInitialTab: Tab = searchParams.get("view") === "dashboard" ? "dashboard" : "chart";
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [run, setRun] = useState<RunData | null>(null);
  const [code, setCode] = useState<Record<string, string>>({});
  // The prompt header sits above the scrollable body (flex-1 min-h-0
  // overflow-auto), so an unclamped multi-paragraph prompt eats most of the
  // viewport and leaves almost no room for the tabs/dashboard below it.
  const [promptExpanded, setPromptExpanded] = useState(false);
  const [tab, setTab] = useState<Tab>(requestedInitialTab);
  const [loading, setLoading] = useState(true);
  const [selectedSymbol, setSelectedSymbol] = useState("");
  const [chartPickerSymbol, setChartPickerSymbol] = useState("");
  const [selectedSymbols, setSelectedSymbols] = useState<string[]>([]);
  const [chartCache, setChartCache] = useState<ChartCache>({});
  const [chartLoadingSymbols, setChartLoadingSymbols] = useState<Record<string, boolean>>({});
  const [bulkChartLoading, setBulkChartLoading] = useState(false);
  const [bulkChartProgress, setBulkChartProgress] = useState<ChartLoadProgress>({ done: 0, total: 0 });
  const chartCacheRef = useRef<ChartCache>({});
  const cancelBulkChartLoadRef = useRef(false);
  const runGenerationRef = useRef(0);

  const hasValidation = !!run?.validation;
  const hasRunCard = !!run?.run_card;
  const hasStudio = !!run?.risk_xray || !!run?.rebalance_notes;
  const hasTearsheet = (run?.artifacts_equity_csv?.length ?? 0) > 0 || (run?.equity_curve?.length ?? 0) > 0;
  const hasFactor = !!run?.has_factor_artifacts;
  const hasAttribution = (run?.artifacts_equity_csv?.length ?? 0) > 0;
  const hasPositions = !!run?.artifacts_positions_csv?.some(
    (row) => Object.keys(row).some((key) => !isDateColumn(key)),
  );
  const hasLlmUsage = !!run?.llm_usage?.totals;
  const TABS: { id: Tab; label: string; icon: typeof BarChart3; hidden?: boolean }[] = [
    { id: "dashboard", label: i18n.t("runDetail.dashboard"), icon: LayoutDashboard },
    { id: "chart", label: i18n.t("runDetail.chart"), icon: BarChart3 },
    { id: "tearsheet", label: i18n.t("runDetail.tearsheet"), icon: CalendarRange, hidden: !hasTearsheet },
    { id: "trades", label: i18n.t("runDetail.trades"), icon: List },
    { id: "positions", label: i18n.t("runDetail.positions.tab"), icon: PieChart, hidden: !hasPositions },
    { id: "attribution", label: i18n.t("runDetail.attribution"), icon: ArrowLeftRight, hidden: !hasAttribution },
    { id: "factor", label: i18n.t("runDetail.factor"), icon: Sigma, hidden: !hasFactor },
    { id: "studio", label: i18n.t("runDetail.studio"), icon: Gauge, hidden: !hasStudio },
    { id: "validation", label: i18n.t("runDetail.validation"), icon: ShieldCheck, hidden: !hasValidation },
    { id: "runCard", label: i18n.t("runDetail.runCard"), icon: FileCheck2, hidden: !hasRunCard },
    { id: "llmUsage", label: i18n.t("runDetail.llmUsage.tab"), icon: Coins, hidden: !hasLlmUsage },
    { id: "code", label: i18n.t("runDetail.code"), icon: Code2 },
  ];

  useEffect(() => {
    const generation = ++runGenerationRef.current;
    cancelBulkChartLoadRef.current = true;
    setRun(null);
    setCode({});
    setPromptExpanded(false);
    setTab(requestedInitialTab);
    setLoading(true);
    setSelectedSymbol("");
    setChartPickerSymbol("");
    setSelectedSymbols([]);
    chartCacheRef.current = {};
    setChartCache({});
    setChartLoadingSymbols({});
    setBulkChartLoading(false);
    setBulkChartProgress({ done: 0, total: 0 });

    if (!runId) {
      setLoading(false);
      return;
    }

    const requestedRunId = runId;
    Promise.all([
      api.getRun(requestedRunId, { chart_payload: "summary" }).catch(() => null),
      api.getRunCode(requestedRunId).catch(() => ({})),
    ]).then(([r, c]) => {
      if (runGenerationRef.current !== generation) return;
      setRun(r);
      setCode(c || {});
      const firstSymbol = r?.chart_symbols?.[0] || Object.keys(r?.price_series || {})[0] || "";
      setSelectedSymbol(firstSymbol);
      setChartPickerSymbol(firstSymbol);
      setSelectedSymbols(firstSymbol ? [firstSymbol] : []);
      const initialCache = cacheFromRun(r, firstSymbol);
      chartCacheRef.current = initialCache;
      setChartCache(initialCache);
      if (firstSymbol && !initialCache[firstSymbol]?.price_series?.[firstSymbol]?.length) {
        void loadChartSymbol(firstSymbol, requestedRunId, generation);
      }
    }).finally(() => {
      if (runGenerationRef.current === generation) setLoading(false);
    });

    return () => {
      cancelBulkChartLoadRef.current = true;
      if (runGenerationRef.current === generation) runGenerationRef.current += 1;
    };
  }, [runId, requestedInitialTab]);

  if (loading) {
    return (
      <Page width="wide">
        <Skeleton className="h-6 w-48" />
        <SkeletonMetrics />
        <SkeletonChart height={400} />
      </Page>
    );
  }
  if (!run) return (
    <Page width="wide">
      <Card>
        <EmptyState
          icon={XCircle}
          title={i18n.t("runDetail.runNotFound")}
          description={i18n.t("runDetail.runNotFoundDesc")}
          action={
            <Button onClick={() => navigate(-1)}>
              <ArrowLeft className="h-4 w-4" /> {i18n.t("runDetail.goBack")}
            </Button>
          }
        />
      </Card>
    </Page>
  );

  const ok = run.status === "success";
  const cancelled = run.status === "cancelled";
  const reportIdentity = getStrategyReportIdentity(run);
  const allTrades = runTrades(run);

  async function loadChartSymbol(
    symbol: string,
    requestedRunId = runId,
    generation = runGenerationRef.current,
  ) {
    if (!requestedRunId || !symbol || runGenerationRef.current !== generation) return;
    if (chartCacheRef.current[symbol]?.price_series?.[symbol]?.length) return;
    setChartLoadingSymbols((prev) => ({ ...prev, [symbol]: true }));
    try {
      const nextRun = await api.getRun(requestedRunId, { chart_symbol: symbol });
      if (runGenerationRef.current !== generation) return;
      const nextCache = cacheFromRun(nextRun, symbol);
      const mergedCache = { ...chartCacheRef.current, ...nextCache };
      chartCacheRef.current = mergedCache;
      setChartCache(mergedCache);
      setRun((prev) => prev ? {
        ...prev,
        chart_symbols: nextRun.chart_symbols?.length ? nextRun.chart_symbols : prev.chart_symbols,
        equity_curve: nextRun.equity_curve?.length ? nextRun.equity_curve : prev.equity_curve,
        trade_log: nextRun.trade_log?.length ? nextRun.trade_log : prev.trade_log,
      } : nextRun);
    } finally {
      if (runGenerationRef.current === generation) {
        setChartLoadingSymbols((prev) => {
          const next = { ...prev };
          delete next[symbol];
          return next;
        });
      }
    }
  }

  async function handleAddChartSymbol(symbol: string) {
    if (!symbol) return;
    setSelectedSymbol(symbol);
    setChartPickerSymbol(symbol);
    setSelectedSymbols((prev) => prev.includes(symbol) ? prev : [...prev, symbol]);
    await loadChartSymbol(symbol);
  }

  async function handleCurrentChartOnly(symbol: string) {
    if (!symbol) return;
    setSelectedSymbol(symbol);
    setChartPickerSymbol(symbol);
    setSelectedSymbols([symbol]);
    await loadChartSymbol(symbol);
  }

  function handleRemoveChartSymbol(symbol: string) {
    const nextSymbols = selectedSymbols.filter((item) => item !== symbol);
    setSelectedSymbols(nextSymbols);
    if (selectedSymbol === symbol) {
      const fallback = nextSymbols[0] || run?.chart_symbols?.[0] || "";
      setSelectedSymbol(fallback);
      setChartPickerSymbol(fallback);
    }
  }

  async function handleLoadAllChartSymbols() {
    const symbols = run?.chart_symbols || [];
    if (symbols.length === 0 || bulkChartLoading) return;
    const generation = runGenerationRef.current;
    const requestedRunId = runId;
    cancelBulkChartLoadRef.current = false;
    setBulkChartLoading(true);
    setBulkChartProgress({ done: 0, total: symbols.length });
    try {
      for (let index = 0; index < symbols.length; index += 1) {
        if (cancelBulkChartLoadRef.current || runGenerationRef.current !== generation) break;
        const symbol = symbols[index];
        setSelectedSymbol(symbol);
        setChartPickerSymbol(symbol);
        setSelectedSymbols((prev) => prev.includes(symbol) ? prev : [...prev, symbol]);
        await loadChartSymbol(symbol, requestedRunId, generation);
        if (runGenerationRef.current !== generation) break;
        setBulkChartProgress({ done: index + 1, total: symbols.length });
        await yieldToBrowser();
      }
    } finally {
      if (runGenerationRef.current === generation) setBulkChartLoading(false);
    }
  }

  function handleCancelLoadAllCharts() {
    cancelBulkChartLoadRef.current = true;
  }

  const visibleTabs = TABS.filter((tabItem) => !tabItem.hidden);
  const description = [
    reportIdentity.symbols.join(", "),
    reportIdentity.startDate && reportIdentity.endDate ? `${reportIdentity.startDate} to ${reportIdentity.endDate}` : "",
  ].filter(Boolean).join(" · ");
  const canRunOnPaper = ok || (run.equity_curve?.length ?? 0) > 0;

  return (
    <Page width="wide">
      <div>
        <Button variant="ghost" size="sm" onClick={() => navigate(-1)} title={i18n.t("runDetail.goBack")} aria-label={i18n.t("runDetail.goBack")}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
      </div>
      <PageHeader
        title={reportIdentity.title}
        description={
          <>
            {description && <span className="block">{description}</span>}
            <span className="flex flex-wrap items-center gap-2">
              {ok ? (
                <>
                  <CheckCircle2 className="h-4 w-4 text-success" aria-hidden="true" />
                  <span className="sr-only">{t("swarm.status.completed")}</span>
                </>
              ) : cancelled ? (
                <>
                  <CircleSlash className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                  <span className="sr-only">{t("swarm.status.cancelled")}</span>
                </>
              ) : (
                <>
                  <XCircle className="h-4 w-4 text-danger" aria-hidden="true" />
                  <span className="sr-only">{t("swarm.status.failed")}</span>
                </>
              )}
              <span className="font-mono text-xs">Run {runId}</span>
              {reportIdentity.strategyInferred && (
                <Badge tone="info">{t("runDashboard.strategyInferred")}</Badge>
              )}
              {run.elapsed_seconds ? <span className="text-xs tabular-nums">{run.elapsed_seconds.toFixed(1)}s</span> : null}
            </span>
          </>
        }
        actions={
          <>
            {canRunOnPaper && runId && (
              <Link
                to={`/paper-trading?from_run=${encodeURIComponent(runId)}`}
                className="inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors duration-150 hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              >
                <LineChart className="h-4 w-4" aria-hidden="true" />
                {t("runDetail.runOnPaper", { defaultValue: "Run on paper" })}
              </Link>
            )}
            {allTrades.length > 0 && (
              <Button
                onClick={() => downloadCsv(`trades_${runId}.csv`, buildTradesCsv(allTrades))}
                title={i18n.t("runDetail.downloadTradesCsv")}
              >
                <Download className="h-4 w-4" /> {i18n.t("runDetail.downloadTradesCsv")}
              </Button>
            )}
            {run.metrics && (
              <Button
                onClick={() => downloadCsv(`metrics_${runId}.csv`, buildMetricsCsv(run.metrics!))}
                title={i18n.t("runDetail.downloadMetricsCsv")}
              >
                <Download className="h-4 w-4" /> {i18n.t("runDetail.downloadMetricsCsv")}
              </Button>
            )}
          </>
        }
      />
      {run.prompt && (
        <div>
          <p className={cn("text-sm text-muted-foreground whitespace-pre-wrap", !promptExpanded && "line-clamp-3")}>
            {run.prompt}
          </p>
          <button
            type="button"
            aria-expanded={promptExpanded}
            onClick={() => setPromptExpanded((v) => !v)}
            className="mt-1 text-[13px] text-primary hover:underline"
          >
            {promptExpanded ? t("runDetail.showLessPrompt") : t("runDetail.showFullPrompt")}
          </button>
        </div>
      )}
      {run.metrics && <MetricsCard metrics={run.metrics as Record<string, number>} />}

      <Tabs
        aria-label={i18n.t("runDetail.sections", { defaultValue: "Run sections" })}
        tabs={visibleTabs.map(({ id, label }) => ({ id, label }))}
        value={tab}
        onChange={(id) => setTab(id as Tab)}
        className="overflow-x-auto"
      />

      <div>
        <ErrorBoundary>
          {tab === "dashboard" && <div className="p-4"><StrategyResearchDashboard run={run} /></div>}
          {tab === "chart" && (
            <ChartTab
              run={run}
              chartPickerSymbol={chartPickerSymbol}
              selectedSymbols={selectedSymbols}
              chartCache={chartCache}
              loadingSymbols={chartLoadingSymbols}
              bulkLoading={bulkChartLoading}
              bulkProgress={bulkChartProgress}
              onPickSymbol={setChartPickerSymbol}
              onAddSymbol={handleAddChartSymbol}
              onCurrentOnly={handleCurrentChartOnly}
              onRemoveSymbol={handleRemoveChartSymbol}
              onLoadAll={handleLoadAllChartSymbols}
              onCancelLoadAll={handleCancelLoadAllCharts}
            />
          )}
          {tab === "tearsheet" && hasTearsheet && <TearsheetTab run={run} />}
          {tab === "trades" && <TradesTab run={run} />}
          {tab === "positions" && hasPositions && <PositionsTab run={run} />}
          {tab === "attribution" && hasAttribution && runId && <AttributionTab runId={runId} run={run} />}
          {tab === "factor" && run.has_factor_artifacts && runId && <FactorTab runId={runId} />}
          {tab === "validation" && run.validation && <ValidationPanel data={run.validation} />}
          {tab === "studio" && hasStudio && (
            <StudioTab xray={run.risk_xray} notes={run.rebalance_notes} />
          )}
          {tab === "runCard" && run.run_card && <RunCardTab card={run.run_card} />}
          {tab === "llmUsage" && run.llm_usage && <LlmUsagePanel usage={run.llm_usage} />}
          {tab === "code" && <CodeTab code={code} />}
        </ErrorBoundary>
      </div>
    </Page>
  );
}

function RunCardTab({ card }: { card: RunCard }) {
  const { t } = useTranslation();
  const backtest = card.backtest || {};
  const reproducibility = card.reproducibility || {};
  const metrics = card.metrics || {};
  // Rendered as JSON: a dict or list value would otherwise collapse - an empty
  // list formats as a blank cell, which reads as "missing" rather than "none".
  const structuredMetrics = Object.fromEntries(
    Object.entries(card.structured_metrics || {}).map(([key, value]) => [key, JSON.stringify(value)]),
  );
  const artifacts = card.artifacts || [];
  const warnings = card.warnings || [];
  const dataSources = card.data_sources || [];

  return (
    <div className="p-4 space-y-4">
      <div className="grid gap-3 md:grid-cols-4">
        <RunCardStat label={i18n.t("runDetail.schema")} value={card.schema_version || i18n.t("runDetail.unknown" as any)} />
        <RunCardStat label={i18n.t("runDetail.generated")} value={formatRunCardValue(card.generated_at)} />
        <RunCardStat label={i18n.t("runDetail.dataSources")} value={dataSources.length ? dataSources.join(", ") : i18n.t("runDetail.noneRecorded" as any)} />
        <RunCardStat label={i18n.t("runDetail.warnings")} value={String(warnings.length)} tone={warnings.length ? "warning" : "normal"} />
      </div>

      {warnings.length > 0 && (
        <section className="rounded-lg border border-warning/30 bg-warning/10 p-4">
          <div className="mb-2 flex items-center gap-2 text-sm font-medium text-warning">
            <AlertTriangle className="h-4 w-4" />
            {i18n.t("runDetail.warnings")}
          </div>
          <ul className="space-y-1 text-xs text-muted-foreground">
            {warnings.map((warning, index) => <li key={index}>{warning}</li>)}
          </ul>
        </section>
      )}

      <div className="grid gap-4 xl:grid-cols-2">
        <RunCardPanel title={i18n.t("runDetail.backtestSummary")} icon={Database}>
          <KeyValueTable data={backtest} empty={i18n.t("runDetail.noBacktestSummary")} />
        </RunCardPanel>
        <RunCardPanel title={i18n.t("runDetail.reproducibility")} icon={Fingerprint}>
          <KeyValueTable data={reproducibility} empty={i18n.t("runDetail.noReproducibilityHashes")} monospaceValues />
        </RunCardPanel>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <RunCardPanel title={i18n.t("runDetail.metrics")} icon={BarChart3}>
          <KeyValueTable data={metrics} empty={i18n.t("runDetail.noScalarMetrics")} />
        </RunCardPanel>
        <RunCardPanel title={i18n.t("runDetail.validationPayload")} icon={ShieldCheck}>
          {card.validation ? (
            hasStructuredValidation(card.validation) ? (
              <ValidationPanel data={card.validation as unknown as ValidationData} compact />
            ) : (
              <pre className="max-h-80 overflow-auto rounded-md bg-muted/40 p-3 text-xs leading-relaxed">
                {JSON.stringify(card.validation, null, 2)}
              </pre>
            )
          ) : (
            <p className="text-sm text-muted-foreground">{i18n.t("runDetail.noValidationPayload")}</p>
          )}
        </RunCardPanel>
      </div>

      <RunCardPanel title={i18n.t("runDetail.structuredMetrics")} icon={Braces}>
        <KeyValueTable data={structuredMetrics} empty={i18n.t("runDetail.noStructuredMetrics")} monospaceValues />
      </RunCardPanel>

      <RunCardPanel title={t("runDetail.trust.executionRecords")} icon={List}>
        <p className="mb-3 text-xs text-muted-foreground">{t("runDetail.trust.executionDescription")}</p>
        {card.tool_traces?.length ? (
          <ol className="space-y-3">
            {card.tool_traces.map((trace, index) => (
              <li key={`${index}-${trace.started_at}`} className="rounded-lg border border-border p-3">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-medium">{t(`runDetail.trust.tools.${trace.tool}`)}</span>
                  <span className={cn("rounded-sm px-1.5 py-0.5 text-xs", trace.status === "ok" ? "bg-success/10 text-success" : trace.status === "error" ? "bg-danger/10 text-danger" : "bg-muted text-muted-foreground")}>
                    {t(`runDetail.trust.status.${trace.status}`)}
                  </span>
                </div>
                <dl className="grid gap-3 text-xs sm:grid-cols-2">
                  <div><dt className="text-muted-foreground">{t("runDetail.trust.startedAt")}</dt><dd className="mt-1 break-all"><time dateTime={trace.started_at}>{trace.started_at || t("runDetail.noneRecorded")}</time></dd></div>
                  <div><dt className="text-muted-foreground">{t("runDetail.trust.endedAt")}</dt><dd className="mt-1 break-all"><time dateTime={trace.ended_at}>{trace.ended_at || t("runDetail.noneRecorded")}</time></dd></div>
                  <div><dt className="text-muted-foreground">{t("runDetail.trust.argsHash")}</dt><dd className="mt-1 break-all font-mono" dir="ltr">{trace.args_hash || t("runDetail.noneRecorded")}</dd></div>
                  <div><dt className="text-muted-foreground">{t("runDetail.trust.resultHash")}</dt><dd className="mt-1 break-all font-mono" dir="ltr">{trace.result_hash || t("runDetail.noneRecorded")}</dd></div>
                </dl>
              </li>
            ))}
          </ol>
        ) : <p className="text-sm text-muted-foreground">{t("runDetail.trust.noExecutionRecords")}</p>}
      </RunCardPanel>

      <RunCardPanel title={t("runDetail.trust.metricEvidence")} icon={FileCheck2}>
        <p className="mb-3 text-xs text-muted-foreground">{t("runDetail.trust.evidenceDescription")}</p>
        {card.citations?.length ? (
          <ul className="space-y-3">
            {card.citations.map((citation, index) => (
              <li key={`${index}-${citation.metric}`} className="rounded-lg border border-border p-3">
                <dl className="grid gap-3 text-xs sm:grid-cols-2">
                  <div><dt className="text-muted-foreground">{t("runDetail.trust.metric")}</dt><dd className="mt-1 break-all font-mono">{citation.metric}</dd></div>
                  <div><dt className="text-muted-foreground">{t("runDetail.trust.artifact")}</dt><dd className="mt-1 break-all font-mono" dir="ltr">{citation.artifact_id}</dd></div>
                  <div><dt className="text-muted-foreground">{t("runDetail.trust.column")}</dt><dd className="mt-1 break-all font-mono">{citation.column}</dd></div>
                  <div><dt className="text-muted-foreground">{t("runDetail.trust.row")}</dt><dd className="mt-1 font-mono">{citation.row}</dd></div>
                  <div className="sm:col-span-2"><dt className="text-muted-foreground">{t("runDetail.trust.artifactHash")}</dt><dd className="mt-1 break-all font-mono" dir="ltr">{citation.sha256 || t("runDetail.noneRecorded")}</dd></div>
                </dl>
              </li>
            ))}
          </ul>
        ) : <p className="text-sm text-muted-foreground">{t("runDetail.trust.noMetricEvidence")}</p>}
      </RunCardPanel>

      <RunCardPanel title={i18n.t("runDetail.artifactChecksums")} icon={FileCheck2}>
        {artifacts.length > 0 ? (
          <div className="overflow-x-auto">
            <Table>
              <THead>
                <tr>
                  <TH className="ps-4">{i18n.t("runDetail.path")}</TH>
                  <TH>{i18n.t("runDetail.size")}</TH>
                  <TH>{i18n.t("runDetail.sha256")}</TH>
                </tr>
              </THead>
              <TBody>
                {artifacts.map((artifact) => (
                  <TR key={`${artifact.path}-${artifact.sha256}`}>
                    <TD className="ps-4 font-mono text-xs">{artifact.path}</TD>
                    <TD className="tabular-nums text-muted-foreground">{formatBytes(artifact.size_bytes)}</TD>
                    <TD className="font-mono text-xs text-muted-foreground">{shortHash(artifact.sha256)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{i18n.t("runDetail.noArtifactChecksums")}</p>
        )}
      </RunCardPanel>
    </div>
  );
}

function fmtPct(v: number | undefined, digits = 1): string {
  if (v === undefined || Number.isNaN(v)) return "-";
  return `${(v * 100).toFixed(digits)}%`;
}

function StudioTab({ xray, notes }: { xray?: RiskXRayPayload; notes?: RebalanceNotesPayload }) {
  const concentration = xray?.concentration || {};
  const volatility = xray?.volatility || {};
  const drawdown = xray?.drawdown || {};
  const weights = xray?.inputs?.weights || {};
  const weightEntries = Object.entries(weights).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
  const summary = notes?.summary;
  const rebalances = notes?.rebalances || [];

  return (
    <div className="space-y-4">
      {xray && (
        <RunCardPanel title={i18n.t("runDetail.riskXray")} icon={Gauge}>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <RunCardStat label={i18n.t("runDetail.hhi")} value={concentration.hhi !== undefined ? concentration.hhi.toFixed(3) : "-"} />
            <RunCardStat label={i18n.t("runDetail.effectiveN")} value={concentration.effective_n !== undefined ? concentration.effective_n.toFixed(1) : "-"} />
            <RunCardStat label={i18n.t("runDetail.annualizedVol")} value={fmtPct(volatility.annualized_vol)} />
            <RunCardStat label={i18n.t("runDetail.maxDrawdown")} value={fmtPct(drawdown.max_drawdown)} />
          </div>
          {weightEntries.length > 0 && (
            <div className="mt-3 overflow-x-auto">
              <Table>
                <THead>
                  <tr>
                    <TH className="ps-4">{i18n.t("runDetail.symbol")}</TH>
                    <TH>{i18n.t("runDetail.weight")}</TH>
                  </tr>
                </THead>
                <TBody>
                  {weightEntries.map(([sym, w]) => (
                    <TR key={sym}>
                      <TD className="ps-4 font-mono text-xs">{sym}</TD>
                      <TD className="tabular-nums">{fmtPct(w)}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </div>
          )}
          {(xray.warnings || []).length > 0 && (
            <p className="mt-2 text-xs text-warning">{(xray.warnings || []).join("; ")}</p>
          )}
        </RunCardPanel>
      )}

      {notes && summary && (
        <RunCardPanel title={i18n.t("runDetail.rebalanceNotes")} icon={Gauge}>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <RunCardStat label={i18n.t("runDetail.rebalanceCount")} value={String(summary.target_change_count ?? summary.rebalance_count ?? 0)} />
            <RunCardStat label={i18n.t("runDetail.rebalanceExecuted")} value={String(summary.rebalance_executed_fills ?? "-")} />
            <RunCardStat label={i18n.t("runDetail.rebalanceRealizedTurnover")} value={fmtPct(summary.rebalance_realized_turnover ?? 0)} />
            <RunCardStat label={i18n.t("runDetail.turnoverMean")} value={fmtPct(summary.turnover_mean)} />
            <RunCardStat label={i18n.t("runDetail.turnoverMax")} value={fmtPct(summary.turnover_max)} />
            <RunCardStat label={i18n.t("runDetail.largestRebalance")} value={summary.largest_rebalance_date || "-"} />
          </div>
          {rebalances.length > 0 && (
            <div className="mt-3 overflow-x-auto">
              <Table>
                <THead>
                  <tr>
                    <TH className="ps-4">{i18n.t("runDetail.date")}</TH>
                    <TH>{i18n.t("runDetail.turnover")}</TH>
                    <TH>{i18n.t("runDetail.entries")}</TH>
                    <TH>{i18n.t("runDetail.exits")}</TH>
                  </tr>
                </THead>
                <TBody>
                  {rebalances.map((r) => (
                    <TR key={r.date}>
                      <TD className="ps-4 font-mono text-xs">{r.date}</TD>
                      <TD className="tabular-nums">{fmtPct(r.turnover)}</TD>
                      <TD className="text-xs">{(r.entries || []).map((e) => e.code).join(", ") || "-"}</TD>
                      <TD className="text-xs">{(r.exits || []).map((e) => e.code).join(", ") || "-"}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </div>
          )}
        </RunCardPanel>
      )}
    </div>
  );
}

function TearsheetTab({ run }: { run: RunData }) {
  const equityPoints = useMemo(
    () => normalizeEquitySeries(run.artifacts_equity_csv ?? run.equity_curve),
    [run.artifacts_equity_csv, run.equity_curve],
  );
  const monthly = useMemo(() => computeMonthlyReturns(equityPoints), [equityPoints]);
  const annual = useMemo(() => computeAnnualReturns(equityPoints), [equityPoints]);
  const drawdowns = useMemo(() => computeTopDrawdowns(equityPoints, 5), [equityPoints]);
  const zones = useMemo(() => {
    const lastTime = equityPoints.length > 0 ? equityPoints[equityPoints.length - 1].time : "";
    return toDrawdownZones(drawdowns, lastTime);
  }, [drawdowns, equityPoints]);
  const chartData = useMemo<EquityPoint[]>(
    () => equityPoints.map((p) => ({ time: p.time, equity: p.equity, drawdown: p.drawdown })),
    [equityPoints],
  );

  if (equityPoints.length < 2) {
    return <div className="p-8 text-muted-foreground text-sm">{i18n.t("runDetail.noTearsheetData")}</div>;
  }

  const yearCount = new Set(monthly.map((m) => m.year)).size;
  const heatmapHeight = Math.min(420, Math.max(200, 40 + 34 * yearCount));

  return (
    <div className="p-4 space-y-4">
      <RunCardPanel title={i18n.t("runDetail.equityDrawdown")} icon={BarChart3}>
        <EquityChart data={chartData} drawdownZones={zones} height={300} />
      </RunCardPanel>
      <RunCardPanel title={i18n.t("runDetail.monthlyReturns")} icon={CalendarRange}>
        <MonthlyReturnsHeatmap data={monthly} annual={annual} height={heatmapHeight} />
      </RunCardPanel>
      <div className="grid gap-4 xl:grid-cols-2">
        <RunCardPanel title={i18n.t("runDetail.annualReturns")} icon={BarChart3}>
          <AnnualReturnsChart data={annual} height={260} />
        </RunCardPanel>
        <RunCardPanel title={i18n.t("runDetail.topDrawdowns")} icon={AlertTriangle}>
          <TopDrawdownsPanel episodes={drawdowns} />
        </RunCardPanel>
      </div>
    </div>
  );
}

function FactorTab({ runId }: { runId: string }) {
  const [data, setData] = useState<FactorReportPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const generationRef = useRef(0);

  useEffect(() => {
    const generation = ++generationRef.current;
    setLoading(true);
    setError("");
    setData(null);
    api.getRunFactor(runId)
      .then((payload) => {
        if (generationRef.current !== generation) return;
        setData(payload);
      })
      .catch((err: unknown) => {
        if (generationRef.current !== generation) return;
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (generationRef.current === generation) setLoading(false);
      });
    return () => {
      if (generationRef.current === generation) generationRef.current += 1;
    };
  }, [runId]);

  if (loading) {
    return (
      <div className="p-4 space-y-4">
        <Skeleton className="h-6 w-48" />
        <p className="text-xs text-muted-foreground">{i18n.t("factor.loading")}</p>
        <SkeletonMetrics />
        <SkeletonChart height={320} />
        <SkeletonChart height={320} />
      </div>
    );
  }
  if (error) {
    return (
      <div className="p-8 space-y-1">
        <p className="text-sm font-medium text-danger">{i18n.t("factor.error")}</p>
        <p className="text-xs text-muted-foreground">{error}</p>
      </div>
    );
  }
  if (!data || !data.exists || data.factors.length === 0) {
    return <div className="p-8 text-muted-foreground text-sm">{i18n.t("factor.noFactorData")}</div>;
  }
  return (
    <div className="p-4">
      <FactorResearchPanel report={data} />
    </div>
  );
}

function hasStructuredValidation(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return Boolean(v.monte_carlo || v.bootstrap || v.walk_forward);
}

function formatBytes(value: number): string {
  if (!Number.isFinite(value)) return "-";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function shortHash(value: string): string {
  return value.length > 16 ? `${value.slice(0, 12)}...${value.slice(-6)}` : value;
}

function ChartTab({
  run,
  chartPickerSymbol,
  selectedSymbols,
  chartCache,
  loadingSymbols,
  bulkLoading,
  bulkProgress,
  onPickSymbol,
  onAddSymbol,
  onCurrentOnly,
  onRemoveSymbol,
  onLoadAll,
  onCancelLoadAll,
}: {
  run: RunData;
  chartPickerSymbol: string;
  selectedSymbols: string[];
  chartCache: ChartCache;
  loadingSymbols: Record<string, boolean>;
  bulkLoading: boolean;
  bulkProgress: ChartLoadProgress;
  onPickSymbol: (symbol: string) => void;
  onAddSymbol: (symbol: string) => void | Promise<void>;
  onCurrentOnly: (symbol: string) => void | Promise<void>;
  onRemoveSymbol: (symbol: string) => void;
  onLoadAll: () => void | Promise<void>;
  onCancelLoadAll: () => void;
}) {
  const chartSymbols = run.chart_symbols || Object.keys(run.price_series || {});
  const entries = selectedSymbols
    .map((symbol) => [symbol, chartCache[symbol]?.price_series?.[symbol] || []] as const)
    .filter(([, bars]) => bars.length > 0);
  const hasEquity = run.equity_curve && run.equity_curve.length > 0;
  const progressPercent = bulkProgress.total > 0 ? Math.round((bulkProgress.done / bulkProgress.total) * 100) : 0;

  if (chartSymbols.length === 0 && entries.length === 0 && !hasEquity) {
    return (
      <Card>
        <EmptyState icon={BarChart3} title={i18n.t("runDetail.noChartData")} description={i18n.t("runDetail.noChartDataDesc")} />
      </Card>
    );
  }

  return (
    <div className="p-4 space-y-4">
      {chartSymbols.length > 0 && (
        <Card className="p-4">
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-xs font-medium text-muted-foreground" htmlFor="chart-symbol-select">
              {i18n.t("runDetail.symbol")}
            </label>
            <select
              id="chart-symbol-select"
              value={chartPickerSymbol}
              onChange={(event) => onPickSymbol(event.target.value)}
              className="h-8 rounded-md border border-border bg-card px-2 text-[13px]"
            >
              {chartSymbols.map((symbol) => (
                <option key={symbol} value={symbol}>{symbol}</option>
              ))}
            </select>
            <Button size="sm"
              onClick={() => onCurrentOnly(chartPickerSymbol)}
                            disabled={!chartPickerSymbol || !!loadingSymbols[chartPickerSymbol]}
            >
              {loadingSymbols[chartPickerSymbol] ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {i18n.t("runDetail.showOnly")}
            </Button>
            <Button size="sm"
              onClick={() => onAddSymbol(chartPickerSymbol)}
                            disabled={!chartPickerSymbol || !!loadingSymbols[chartPickerSymbol]}
            >
              {i18n.t("runDetail.addSymbol")}
            </Button>
            <Button size="sm"
              onClick={() => void onLoadAll()}
                            disabled={bulkLoading}
            >
              {bulkLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {i18n.t("runDetail.loadAll")}
            </Button>
            {bulkLoading && (
              <Button size="sm"
                onClick={onCancelLoadAll}
                              >
                {i18n.t("runDetail.cancelLoad")}
              </Button>
            )}
          </div>
          {selectedSymbols.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {selectedSymbols.map((symbol) => (
                <button
                  key={symbol}
                  onClick={() => onRemoveSymbol(symbol)}
                  className="rounded-md bg-muted px-2 py-1 text-xs hover:bg-muted/70"
                >
                  {symbol} x
                </button>
              ))}
            </div>
          )}
          {bulkLoading && (
            <div className="mt-3 space-y-1">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>{i18n.t("runDetail.loadingCharts")}</span>
                <span>{bulkProgress.done}/{bulkProgress.total}</span>
              </div>
              <div className="h-0.5 overflow-hidden rounded-full bg-muted">
                <div className="h-full bg-primary transition-all" style={{ width: `${progressPercent}%` }} />
              </div>
            </div>
          )}
        </Card>
      )}
      {entries.length === 0 && (
        <Card>
          <EmptyState icon={BarChart3} title={Object.keys(loadingSymbols).length > 0 ? i18n.t("runDetail.loadingSelectedChart") : i18n.t("runDetail.pickSymbolToLoad")} />
        </Card>
      )}
      {entries.map(([sym, bars]) => (
        <div key={sym}>
          <h3 className="text-sm font-semibold text-muted-foreground mb-1">{sym}</h3>
          <CandlestickChart data={bars} markers={chartCache[sym]?.trade_markers?.filter(m => m.code === sym)} indicators={chartCache[sym]?.indicator_series?.[sym]} height={500} />
        </div>
      ))}
      {hasEquity && (
        <div>
          <h3 className="text-sm font-semibold text-muted-foreground mb-1">{i18n.t("runDetail.equityDrawdown")}</h3>
          <EquityChart data={run.equity_curve!} height={280} />
        </div>
      )}
    </div>
  );
}

const TRADES_PAGE_SIZE = 100;

function tradeTime(tr: Record<string, string>): string {
  return tr.time || tr.timestamp || "";
}

// The engine writes ISO-shaped times ("YYYY-MM-DD[ HH:MM:SS]"), which order
// correctly as strings; Date.parse would return NaN for the spaced form on Safari.
function compareTradeTime(a: Record<string, string>, b: Record<string, string>): number {
  return tradeTime(a).localeCompare(tradeTime(b));
}

function normalizeSide(value?: string): "BUY" | "SELL" | "" {
  const side = (value || "").trim().toUpperCase();
  if (side.startsWith("B")) return "BUY";
  if (side.startsWith("S")) return "SELL";
  return "";
}

function parseTradeNumber(value?: string): number | null {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function signedNumberClass(value: number | null): string {
  if (value == null || value === 0) return "text-muted-foreground";
  return value > 0 ? "text-success" : "text-danger";
}

function formatSigned(value: number, suffix = ""): string {
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}${suffix}`;
}

function TradesTab({ run }: { run: RunData }) {
  const [sideFilter, setSideFilter] = useState<"" | "BUY" | "SELL">("");
  const [symbolFilter, setSymbolFilter] = useState("");
  const [visibleCount, setVisibleCount] = useState(TRADES_PAGE_SIZE);
  const [sortDesc, setSortDesc] = useState(true);
  const source = runTrades(run);
  // Stable sorting preserves engine order for fills sharing a timestamp.
  const trades = useMemo(() => [...source].sort(
    (a, b) => sortDesc ? compareTradeTime(b, a) : compareTradeTime(a, b),
  ), [source, sortDesc]);
  if (trades.length === 0) return <div className="p-8 text-muted-foreground text-sm">{i18n.t("runDetail.noTrades")}</div>;

  // Same code order as the Chart tab's symbol list, so a symbol sits in the
  // same place on both tabs and does not move when the time order flips.
  const symbols = [...new Set(trades.map((tr) => tr.code).filter(Boolean))].sort();
  const hasPnl = trades.some((tr) => parseTradeNumber(tr.pnl) != null);
  const hasReturnPct = trades.some((tr) => parseTradeNumber(tr.return_pct) != null);
  const hasHoldingDays = trades.some((tr) => (tr.holding_days ?? "") !== "");

  const filtered = trades.filter((tr) => (
    (!sideFilter || normalizeSide(tr.side) === sideFilter)
    && (!symbolFilter || tr.code === symbolFilter)
  ));
  const buys = filtered.filter((tr) => normalizeSide(tr.side) === "BUY").length;
  const sells = filtered.filter((tr) => normalizeSide(tr.side) === "SELL").length;
  const totalPnl = hasPnl
    ? filtered.reduce((sum, tr) => sum + (parseTradeNumber(tr.pnl) ?? 0), 0)
    : null;
  const visible = filtered.slice(0, visibleCount);
  const remaining = filtered.length - visible.length;

  const sideChips: { id: "" | "BUY" | "SELL"; label: string }[] = [
    { id: "", label: i18n.t("runDetail.sideAll") },
    { id: "BUY", label: i18n.t("runDetail.sideBuy") },
    { id: "SELL", label: i18n.t("runDetail.sideSell") },
  ];

  return (
    <div className="p-4 space-y-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">{i18n.t("runDetail.tradesCount", { count: filtered.length })}</span>
        <span>{i18n.t("runDetail.sideSummary", { buy: buys, sell: sells })}</span>
        {totalPnl != null && (
          <span className="inline-flex items-center gap-1">
            {i18n.t("runDetail.totalPnl")}
            <span className={cn("font-medium tabular-nums", signedNumberClass(totalPnl))}>
              {formatSigned(totalPnl)}
            </span>
          </span>
        )}
        <div className="ms-auto flex flex-wrap items-center gap-1.5">
          <div className="flex gap-1" role="group">
            {sideChips.map((chip) => (
              <button
                key={chip.id || "all"}
                type="button"
                onClick={() => { setSideFilter(chip.id); setVisibleCount(TRADES_PAGE_SIZE); }}
                className={cn(
                  "rounded-md border px-2.5 py-1 transition-colors",
                  sideFilter === chip.id
                    ? "border-primary/30 bg-primary/10 font-medium text-primary"
                    : "border-border hover:bg-muted",
                )}
              >
                {chip.label}
              </button>
            ))}
          </div>
          {symbols.length > 1 && (
            <select
              value={symbolFilter}
              onChange={(event) => { setSymbolFilter(event.target.value); setVisibleCount(TRADES_PAGE_SIZE); }}
              className="h-8 rounded-md border border-border bg-card px-2 text-[13px]"
              aria-label={i18n.t("runDetail.symbol")}
            >
              <option value="">{i18n.t("runDetail.allSymbols")}</option>
              {symbols.map((symbol) => (
                <option key={symbol} value={symbol}>{symbol}</option>
              ))}
            </select>
          )}
        </div>
      </div>

      <div>
        <Table>
          <THead>
            <tr>
              <TH className="ps-4" aria-sort={sortDesc ? "descending" : "ascending"}>
                <button
                  type="button"
                  onClick={() => { setSortDesc((desc) => !desc); setVisibleCount(TRADES_PAGE_SIZE); }}
                  className="inline-flex items-center gap-1 hover:text-foreground"
                >
                  {i18n.t("runDetail.time")}
                  {sortDesc
                    ? <ArrowDown className="h-4 w-4" aria-hidden="true" />
                    : <ArrowUp className="h-4 w-4" aria-hidden="true" />}
                </button>
              </TH>
              <TH>{i18n.t("runDetail.code2")}</TH>
              <TH>{i18n.t("runDetail.side")}</TH>
              <TH className="text-right">{i18n.t("runDetail.price")}</TH>
              <TH className="text-right">{i18n.t("runDetail.qty")}</TH>
              {hasPnl && <TH className="text-right">{i18n.t("runDetail.pnl")}</TH>}
              {hasReturnPct && <TH className="text-right">{i18n.t("runDetail.returnPct")}</TH>}
              {hasHoldingDays && <TH className="text-right">{i18n.t("runDetail.holdingDays")}</TH>}
              <TH>{i18n.t("runDetail.reason")}</TH>
            </tr>
          </THead>
          <TBody>
            {visible.map((tr, i) => {
              const side = normalizeSide(tr.side);
              const pnl = parseTradeNumber(tr.pnl);
              const returnPct = parseTradeNumber(tr.return_pct);
              return (
                <TR key={i}>
                  <TD className="ps-4 font-mono text-xs">{tradeTime(tr)}</TD>
                  <TD className="font-mono text-xs">{tr.code}</TD>
                  <TD>
                    <span className={cn(
                      "inline-block rounded-sm px-1.5 py-0.5 text-xs font-medium",
                      side === "BUY" && "bg-success/10 text-success",
                      side === "SELL" && "bg-danger/10 text-danger",
                      side === "" && "bg-muted text-muted-foreground",
                    )}>
                      {side === "BUY" ? i18n.t("runDetail.sideBuy") : side === "SELL" ? i18n.t("runDetail.sideSell") : tr.side}
                    </span>
                  </TD>
                  <TD className="text-right tabular-nums">{tr.price}</TD>
                  <TD className="text-right tabular-nums">{tr.qty}</TD>
                  {hasPnl && (
                    <TD className={cn("py-2 pr-4 text-right font-mono tabular-nums", signedNumberClass(pnl))}>
                      {pnl != null ? formatSigned(pnl) : "-"}
                    </TD>
                  )}
                  {hasReturnPct && (
                    <TD className={cn("py-2 pr-4 text-right font-mono tabular-nums", signedNumberClass(returnPct))}>
                      {returnPct != null ? formatSigned(returnPct, "%") : "-"}
                    </TD>
                  )}
                  {hasHoldingDays && (
                    <TD className="text-right tabular-nums text-muted-foreground">{tr.holding_days ?? "-"}</TD>
                  )}
                  <TD className="text-xs text-muted-foreground">{tr.reason}</TD>
                </TR>
              );
            })}
          </TBody>
        </Table>
      </div>

      {remaining > 0 && (
        <div className="flex justify-center">
          <Button onClick={() => setVisibleCount((count) => count + TRADES_PAGE_SIZE)}>
            {i18n.t("runDetail.showMore", { count: Math.min(remaining, TRADES_PAGE_SIZE) })}
          </Button>
        </div>
      )}
    </div>
  );
}

function CodeTab({ code }: { code: Record<string, string> }) {
  const files = Object.entries(code);
  const [active, setActive] = useState(files[0]?.[0] || "");
  if (files.length === 0) return <Card><EmptyState icon={Code2} title={i18n.t("runDetail.noCodeFiles")} /></Card>;

  const activeCode = code[active] || "";
  const lineCount = activeCode ? activeCode.split("\n").length : 0;
  const copyActive = () => {
    navigator.clipboard.writeText(activeCode).then(
      () => toast.success(i18n.t("runDetail.codeCopied")),
      () => {},
    );
  };

  return (
    <Card className="flex flex-col overflow-hidden">
      <div className="flex items-center gap-2 p-2 border-b border-border">
        <div className="flex min-w-0 flex-wrap gap-1">
          {files.map(([name]) => (
            <button key={name} onClick={() => setActive(name)} className={cn("px-3 py-1 rounded-md text-[13px] font-mono", active === name ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted")}>{name}</button>
          ))}
        </div>
        <div className="ms-auto flex shrink-0 items-center gap-2">
          <span className="text-xs tabular-nums text-muted-foreground">
            {i18n.t("runDetail.codeLines", { count: lineCount })}
          </span>
          <Button size="sm" onClick={copyActive}>
            <Copy className="h-4 w-4" /> {i18n.t("runDetail.copyCode")}
          </Button>
        </div>
      </div>
      <div className="max-h-[70vh] overflow-auto p-3 text-xs leading-relaxed bg-muted/50 [&_pre]:m-0 [&_pre]:bg-transparent [&_code]:text-xs">
        <ReactMarkdown rehypePlugins={rehypePlugins}>
          {`\`\`\`python\n${activeCode}\n\`\`\``}
        </ReactMarkdown>
      </div>
    </Card>
  );
}
