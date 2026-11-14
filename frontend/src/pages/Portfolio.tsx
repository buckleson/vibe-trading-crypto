import { useEffect, useMemo, useRef, useState } from "react";
import { RebalanceProposal } from "@/components/portfolio/RebalanceProposal";
import { useTranslation } from "react-i18next";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  Loader2,
  RefreshCw,
  Search,
  Settings2,
  WalletCards,
  WifiOff,
} from "lucide-react";
import { Badge, Button, Card, CardBody, CardHeader, EmptyState, Input, Page, PageHeader, Stat, Table, TBody, TD, TH, THead, TR } from "@/components/ui";
import { Skeleton } from "@/components/common/Skeleton";
import { PortfolioSourceEditor } from "@/components/portfolio/PortfolioSourceEditor";
import { PortfolioCompatibilityBadge } from "@/components/portfolio/PortfolioCompatibilityBadge";
import {
  api,
  type PortfolioAccount,
  type PortfolioHistoryPoint,
  type PortfolioRefreshState,
  type PortfolioSettings,
  type PortfolioSnapshot,
  type PortfolioSourceCatalogItem,
} from "@/lib/api";
import { echarts } from "@/lib/echarts";
import { getChartTheme } from "@/lib/chart-theme";
import { useThemeDark } from "@/lib/theme-store";
import i18n from "@/i18n";

// Backend OAuth workers time out after 330 seconds. Keep a slightly longer
// client-side guard so a lost polling response can never spin forever.
const PORTFOLIO_RECONNECT_DEADLINE_MS = 360_000;

/**
 * Locale used by every Intl formatter on this page. The formatters live at
 * module scope (chart option builders need them outside React), so they read
 * the language off the i18n singleton rather than through a hook; components
 * that render them subscribe to `useTranslation()` and therefore re-render
 * whenever the language changes.
 */
function uiLocale(): string {
  return i18n.language || "en";
}

function money(value: number | null | undefined, currency: string = "USD") {
  if (value == null || !Number.isFinite(value)) return "-";
  return new Intl.NumberFormat(uiLocale(), {
    style: "currency",
    currency,
    maximumFractionDigits: currency === "CNY" ? 0 : 2,
  }).format(value);
}

/** Convert only with the FX observation stored on this snapshot. */
function displayValue(
  usd: number | null | undefined, cny: number | null | undefined,
  currency: string, fx: PortfolioSnapshot["fx"] | undefined,
): number | null {
  if (currency === "CNY" && cny != null && Number.isFinite(cny)) return cny;
  if (usd == null || !Number.isFinite(usd)) return null;
  if (currency === "USD") return usd;
  const rate = currency === "CNY" ? fx?.usd_cny : currency === "HKD" ? fx?.usd_hkd : fx?.rates?.[currency];
  return rate != null && Number.isFinite(rate) && rate > 0 ? usd * rate : null;
}

function quantity(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "-";
  return new Intl.NumberFormat(uiLocale(), { maximumFractionDigits: 8 }).format(value);
}

function price(value: number | undefined | null) {
  if (value == null || !Number.isFinite(value)) return "-";
  return new Intl.NumberFormat(uiLocale(), {
    minimumFractionDigits: value >= 1 ? 2 : 4,
    maximumFractionDigits: value >= 100 ? 2 : value >= 1 ? 4 : 8,
  }).format(value);
}

function percentage(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "-";
  return new Intl.NumberFormat(uiLocale(), {
    style: "percent",
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(value);
}

/** ECharts reports slice shares as 0-100; `percentage` expects a 0-1 ratio. */
function slicePercentage(percent: number) {
  return percentage(percent / 100);
}

/** Compact tick label for the history axis, e.g. "$120K" / "¥12万". */
function compactMoney(value: number, currency: string = "USD") {
  return new Intl.NumberFormat(uiLocale(), {
    style: "currency",
    currency,
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

function dateTime(value: string | undefined) {
  return value ? new Date(value).toLocaleString(uiLocale()) : "-";
}

function dayKey(value: string) {
  const date = new Date(value);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

/**
 * Multi-account portfolio overview built from local read-only connections.
 *
 * An account the backend could not read arrives with `status === "error"` and
 * no totals; it contributes nothing to the headline figures and is rendered as
 * a failure card so the totals are never read as if those holdings counted.
 */
export function Portfolio() {
  const { t } = useTranslation();
  const [snapshot, setSnapshot] = useState<PortfolioSnapshot | null>(null);
  const [history, setHistory] = useState<PortfolioHistoryPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [reconnectingSource, setReconnectingSource] = useState<string | null>(null);
  const [refreshState, setRefreshState] = useState<PortfolioRefreshState | null>(null);
  const [portfolioSettings, setPortfolioSettings] = useState<PortfolioSettings | null>(null);
  const [sourceCatalog, setSourceCatalog] = useState<PortfolioSourceCatalogItem[]>([]);
  const [editorOpen, setEditorOpen] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [sourceFilter, setSourceFilter] = useState<string>("all");

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [current, points, configuration] = await Promise.all([
        api.getPortfolio(),
        api.getPortfolioHistory(),
        api.getPortfolioSettings(),
      ]);
      setSnapshot(current.snapshot);
      setHistory(points.history ?? []);
      setPortfolioSettings(configuration.settings);
      setSourceCatalog(configuration.catalog);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("portfolio.page.errorLoad"));
    } finally {
      setLoading(false);
    }
  }

  async function refresh(settingsOverride?: PortfolioSettings) {
    const activeSettings = settingsOverride ?? portfolioSettings;
    const enabledSources = activeSettings?.sources.filter((source) => source.enabled) ?? [];
    if (!enabledSources.length) {
      setEditorOpen(true);
      return;
    }
    setRefreshing(true);
    setError(null);
    setRefreshState({
      running: true,
      current: null,
      sources: Object.fromEntries(enabledSources.map((source) => [source.connection_id, { status: "pending" as const }])),
    });
    const timer = window.setInterval(() => {
      void api.getPortfolioRefreshStatus()
        .then((result) => setRefreshState(normalizeRefreshState(result.refresh)))
        .catch(() => undefined);
    }, 500);
    try {
      const result = await api.refreshPortfolio();
      setSnapshot(result.snapshot);
      const points = await api.getPortfolioHistory();
      setHistory(points.history ?? []);
      const status = await api.getPortfolioRefreshStatus();
      setRefreshState(normalizeRefreshState(status.refresh));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("portfolio.page.errorRefresh"));
    } finally {
      window.clearInterval(timer);
      setRefreshing(false);
    }
  }

  async function reconnectSource(sourceId: string) {
    setReconnectingSource(sourceId);
    setError(null);
    try {
      await api.reconnectPortfolioSource(sourceId);
      const deadline = Date.now() + PORTFOLIO_RECONNECT_DEADLINE_MS;
      for (;;) {
        await new Promise((resolve) => window.setTimeout(resolve, 1_000));
        if (Date.now() >= deadline) {
          throw new Error(t("portfolio.page.errorReconnectTimeout"));
        }
        const result = await api.getPortfolioReconnectStatus();
        if (result.reconnect.running) continue;
        if (result.reconnect.status !== "authorized") {
          throw new Error(result.reconnect.error ?? "Account reconnect failed");
        }
        break;
      }
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("portfolio.page.errorReconnect"));
    } finally {
      setReconnectingSource(null);
    }
  }

  async function savePortfolioSettings(settings: PortfolioSettings) {
    setSavingSettings(true);
    setError(null);
    try {
      const result = await api.updatePortfolioSettings(settings);
      setPortfolioSettings(result.settings);
      setSourceCatalog(result.catalog);
      setEditorOpen(false);
      setSourceFilter("all");
      if (result.settings.sources.some((source) => source.enabled)) {
        await refresh(result.settings);
      } else {
        setSnapshot(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t("portfolio.page.errorSaveSettings"));
    } finally {
      setSavingSettings(false);
    }
  }

  async function reloadConnections() {
    const configuration = await api.getPortfolioSettings();
    setPortfolioSettings(configuration.settings);
    setSourceCatalog(configuration.catalog);
  }

  async function download() {
    try {
      const blob = await api.downloadPortfolioCsv();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `portfolio-${new Date().toISOString().slice(0, 10)}.csv`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("portfolio.page.errorExport"));
    }
  }

  async function downloadResearchSnapshot() {
    if (!snapshot) return;
    try {
      const result = await api.getPortfolioAnalysisContext(snapshot.snapshot_id);
      const blob = new Blob([JSON.stringify(result.context, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `portfolio-research-${snapshot.snapshot_id}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("portfolio.page.errorExport"));
    }
  }

  useEffect(() => { void load(); }, []);

  const positions = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return [...(snapshot?.positions ?? [])]
      .filter((row) => sourceFilter === "all" || (row.source_id ?? row.broker) === sourceFilter)
      .filter((row) => !needle || [row.broker, row.symbol, row.name, row.asset_type, row.market]
        .join(" ").toLowerCase().includes(needle))
      .sort((a, b) => (b.market_value_usd ?? 0) - (a.market_value_usd ?? 0));
  }, [snapshot, query, sourceFilter]);

  const failedAccounts = useMemo(
    () => (snapshot?.accounts ?? []).filter((row) => row.status === "error"),
    [snapshot],
  );

  const brokerAllocation = useMemo(() => (snapshot?.accounts ?? [])
    .filter((row) => row.status !== "error" && (row.total_usd ?? 0) > 0)
    .map((row) => ({
      id: row.source_id ?? row.broker,
      name: row.label ?? row.broker.toUpperCase(),
      value: row.total_usd ?? 0,
      connector: row.broker,
    })), [snapshot]);

  const holdingAllocation = useMemo(() => {
    const rows = [...(snapshot?.combined_holdings ?? [])]
      .filter((row) => row.market_value_usd > 0)
      .sort((a, b) => b.market_value_usd - a.market_value_usd);
    const shown = rows.slice(0, 7).map((row) => ({ name: row.symbol, value: row.market_value_usd }));
    const other = rows.slice(7).reduce((sum, row) => sum + row.market_value_usd, 0);
    if (other > 0) shown.push({ name: t("portfolio.allocation.other"), value: other });
    const valuation = snapshot?.valuation;
    if ((valuation?.cash_usd ?? 0) > 0.01) shown.push({ name: t("portfolio.allocation.cash"), value: valuation?.cash_usd ?? 0 });
    if ((valuation?.unpriced_or_other_usd ?? 0) > 0.01) shown.push({ name: t("portfolio.allocation.unpriced"), value: valuation?.unpriced_or_other_usd ?? 0 });
    if (!valuation && snapshot) {
      const priced = rows.reduce((sum, row) => sum + row.market_value_usd, 0);
      const residual = Math.max(0, snapshot.totals.usd - priced);
      if (residual > 0.01) shown.push({ name: t("portfolio.allocation.cashUnpriced"), value: residual });
    }
    return shown;
  }, [snapshot, t]);

  const dailyChange = useMemo(() => {
    if (!snapshot || !history.length) return null;
    const sameDay = history.filter((row) => dayKey(row.created_at) === dayKey(snapshot.created_at));
    if (!sameDay.length) return null;
    return snapshot.totals.usd - Number(sameDay[0].total_usd);
  }, [snapshot, history]);

  const latestCompleteAt = history.length ? history[history.length - 1].created_at : undefined;
  const coverage = snapshot?.valuation?.identified_coverage ?? (() => {
    if (!snapshot?.totals.usd) return 0;
    return (snapshot.positions ?? []).reduce((sum, row) => sum + (row.priced ? row.market_value_usd : 0), 0) / snapshot.totals.usd;
  })();
  const displayCurrency = portfolioSettings?.display_currency ?? snapshot?.display_currency ?? "USD";
  const totalDisplay = displayValue(snapshot?.totals.usd, snapshot?.totals.cny, displayCurrency, snapshot?.fx);

  return (
    <Page width="wide">
      <PageHeader
        title={t("portfolio.page.title")}
        description={(
          <>
            {t("portfolio.page.subtitle")}
            {snapshot?.fx && Number.isFinite(snapshot.fx.usd_cny) ? (
              <span className="mt-1 block text-xs">
                {t(snapshot.fx.stale ? "portfolio.page.fxCached" : "portfolio.page.fxFresh", { rate: snapshot.fx.usd_cny.toFixed(4) })}{snapshot.fx.as_of ? ` · ${snapshot.fx.as_of}` : ""}
              </span>
            ) : null}
          </>
        )}
        actions={(
          <>
            <Button onClick={() => setEditorOpen(true)}>
              <Settings2 className="h-4 w-4" aria-hidden="true" />{t("portfolio.page.manageAccounts")}
            </Button>
            <Button onClick={() => void download()} disabled={!snapshot}>
              <Download className="h-4 w-4" aria-hidden="true" />{t("portfolio.page.exportCsv")}
            </Button>
            <Button onClick={() => void downloadResearchSnapshot()} disabled={!snapshot} title={t("portfolio.page.researchSnapshotHint")}>
              <Download className="h-4 w-4" aria-hidden="true" />{t("portfolio.page.exportResearch")}
            </Button>
            <Button variant="primary" onClick={() => void refresh()} disabled={reconnectingSource !== null} loading={refreshing}>
              {refreshing ? null : <RefreshCw className="h-4 w-4" aria-hidden="true" />}
              {refreshing ? t("portfolio.page.refreshing") : t("portfolio.page.refreshAll")}
            </Button>
          </>
        )}
      />

      {error ? <div role="alert" className="flex items-start gap-2 rounded-lg border border-danger/30 bg-danger/10 p-4 text-sm text-danger"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />{error}</div> : null}
      {refreshing && refreshState ? <RefreshProgress state={refreshState} settings={portfolioSettings} /> : null}
      {loading ? (
        <div className="space-y-4" aria-busy="true">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {[0, 1, 2, 3].map((item) => <Skeleton key={item} className="h-24 w-full" />)}
          </div>
          <Skeleton className="h-64 w-full" />
        </div>
      ) : null}

      {!loading && !snapshot ? (
        <Card>
          <EmptyState
            icon={WalletCards}
            title={t("portfolio.page.emptyTitle")}
            description={t("portfolio.page.emptyBody")}
            action={<Button variant="primary" onClick={() => setEditorOpen(true)}><Settings2 className="h-4 w-4" aria-hidden="true" />{t("portfolio.page.emptyAction")}</Button>}
          />
        </Card>
      ) : null}

      {snapshot ? (
        <>
          <Card>
            <CardBody className="grid gap-x-6 gap-y-4 sm:grid-cols-2 xl:grid-cols-4">
              <Stat
                label={t("portfolio.metrics.total")}
                value={money(totalDisplay, displayCurrency)}
                hint={(
                  <>
                    {displayCurrency === "USD" ? money(snapshot.totals.cny, "CNY") : money(snapshot.totals.usd)}
                    {failedAccounts.length ? <span className="block text-warning">{t("portfolio.metrics.excluded", { count: failedAccounts.length })}</span> : null}
                  </>
                )}
              />
              <Stat
                label={t("portfolio.metrics.change")}
                value={dailyChange == null ? "-" : `${dailyChange >= 0 ? "+" : ""}${money(dailyChange)}`}
                hint={t("portfolio.metrics.changeNote")}
                tone={dailyChange == null ? "neutral" : dailyChange >= 0 ? "success" : "danger"}
              />
              <Stat
                label={t("portfolio.metrics.coverage")}
                value={percentage(coverage)}
                hint={t("portfolio.metrics.coverageNote", { priced: money(snapshot.valuation?.priced_usd), cash: money(snapshot.valuation?.cash_usd) })}
              />
              <Stat
                label={t("portfolio.metrics.lastComplete")}
                value={latestCompleteAt ? new Date(latestCompleteAt).toLocaleTimeString(uiLocale(), { hour: "2-digit", minute: "2-digit" }) : "-"}
                hint={(
                  <span className={snapshot.complete ? undefined : "text-warning"}>{dateTime(latestCompleteAt)}</span>
                )}
              />
            </CardBody>
          </Card>

          <section className="grid gap-4 xl:grid-cols-2">
            <AllocationPie title={t("portfolio.allocation.byAccount")} data={brokerAllocation} centerLabel={money(totalDisplay, displayCurrency)} onSelect={(id) => setSourceFilter(id)} />
            <AllocationPie title={t("portfolio.allocation.byHolding")} data={holdingAllocation} centerLabel={t("portfolio.allocation.center")} />
          </section>

          {snapshot.warnings.length ? (
            <section className="rounded-lg border border-warning/30 bg-warning/10 p-4 text-sm">
              <div className="mb-2 font-medium text-warning">{t("portfolio.page.warningsTitle")}</div>
              <div className="space-y-1.5">{snapshot.warnings.map((warning) => <div key={warning} className="flex gap-2"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" /><span>{warning}</span></div>)}</div>
            </section>
          ) : null}

          <section className="space-y-3">
            <div className="flex items-end justify-between gap-3">
              <div><h2 className="text-base font-semibold">{t("portfolio.accounts.title")}</h2><p className="text-[13px] text-muted-foreground">{t("portfolio.accounts.hint")}</p></div>
              {sourceFilter !== "all" ? <Button variant="ghost" size="sm" onClick={() => setSourceFilter("all")}>{t("portfolio.accounts.clearFilter")}</Button> : null}
            </div>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {snapshot.accounts.map((account) => (
                <AccountCard key={account.source_id ?? account.broker} account={account} active={sourceFilter === (account.source_id ?? account.broker)} displayCurrency={displayCurrency} fx={snapshot.fx} onClick={() => { const id = account.source_id ?? account.broker; setSourceFilter((current) => current === id ? "all" : id); }} onReconnect={account.reconnect_required && account.source_id ? () => void reconnectSource(account.source_id!) : undefined} onRetry={!account.reconnect_required ? () => void refresh() : undefined} busy={refreshing || reconnectingSource === (account.source_id ?? account.broker)} actionsDisabled={refreshing || reconnectingSource !== null} />
              ))}
            </div>
          </section>

          <Card>
            <CardHeader
              title={t("portfolio.holdings.title")}
              description={t("portfolio.holdings.count", { count: positions.length })}
              actions={(
                <div className="relative w-full sm:w-64">
                  <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden="true" />
                  <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("portfolio.holdings.search")} aria-label={t("portfolio.holdings.search")} className="pl-9" />
                </div>
              )}
            />
            <CardBody>
              <Table className="min-w-[960px]">
                <THead>
                  <tr>
                    <TH>{t("portfolio.holdings.colBroker")}</TH>
                    <TH>{t("portfolio.holdings.colSymbol")}</TH>
                    <TH>{t("portfolio.holdings.colType")}</TH>
                    <TH numeric>{t("portfolio.holdings.colQuantity")}</TH>
                    <TH numeric>{t("portfolio.holdings.colCostPrice")}</TH>
                    <TH numeric>{t("portfolio.holdings.colValue")}</TH>
                    <TH numeric>{t("portfolio.holdings.colWeight")}</TH>
                    <TH numeric>{t("portfolio.holdings.colPnl")}</TH>
                    <TH>{t("portfolio.holdings.colData")}</TH>
                  </tr>
                </THead>
                <TBody>
                  {positions.map((row) => {
                    const weight = snapshot.totals.usd > 0 ? row.market_value_usd / snapshot.totals.usd : 0;
                    const valueMain = row.priced ? money(displayValue(row.market_value_usd, row.market_value_cny, displayCurrency, snapshot.fx), displayCurrency) : "-";
                    const valueAlt = row.priced ? (displayCurrency === "USD" ? money(row.market_value_cny, "CNY") : money(row.market_value_usd)) : t("portfolio.holdings.unpriced");
                    const pnlDisplay = displayValue(row.unrealized_pnl_usd, undefined, displayCurrency, snapshot.fx);
                    return (
                      <TR key={`${row.source_id ?? row.broker}-${row.portfolio_id ?? ""}-${row.symbol}`}>
                        <TD className="align-top"><div className="font-medium">{row.source_label ?? row.broker.toUpperCase()}</div><div className="text-xs text-muted-foreground">{row.broker}</div></TD>
                        <TD className="align-top"><div className="font-medium">{row.symbol}</div><div className="max-w-52 truncate text-xs text-muted-foreground">{row.name}</div>{row.portfolio_id && <div className="text-xs text-muted-foreground">{row.portfolio_name} · {row.portfolio_id}</div>}{row.source_mtime && <div className="text-xs text-muted-foreground">{t("portfolio.imports.mtime", { time: dateTime(row.source_mtime) })}</div>}</TD>
                        <TD className="align-top"><span className="capitalize text-muted-foreground">{row.asset_type}</span></TD>
                        <TD numeric className="align-top">{quantity(row.quantity)}</TD>
                        <TD numeric className="align-top"><div>{price(row.cost_price)}</div><div className="text-xs text-muted-foreground">{price(row.market_price)}</div>{row.price_as_of && <div className="text-xs text-muted-foreground">{t("portfolio.quoteAsOf", { time: dateTime(row.price_as_of) })}</div>}{row.price_error && <div className="ml-auto max-w-52 text-xs text-danger">{row.price_error}</div>}</TD>
                        <TD numeric className="align-top"><div className="font-medium">{valueMain}</div><div className="text-xs text-muted-foreground">{valueAlt}</div></TD>
                        <TD numeric className="align-top">{row.priced ? percentage(weight) : "-"}</TD>
                        <TD numeric className="align-top"><span className={pnlDisplay == null ? "text-muted-foreground" : pnlDisplay >= 0 ? "text-success" : "text-danger"}>{pnlDisplay == null ? "-" : money(pnlDisplay, displayCurrency)}</span></TD>
                        <TD className="align-top"><DataBadge priced={row.priced} /></TD>
                      </TR>
                    );
                  })}
                </TBody>
              </Table>
            </CardBody>
          </Card>

          <RebalanceProposal key={snapshot.snapshot_id} snapshot={snapshot} />
          <HistoryChart history={history} currency={displayCurrency} />

          <Card>
            <CardHeader title={t("portfolio.credentials.title")} />
            <CardBody className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {snapshot.accounts.map((account) => <CredentialCard key={account.source_id ?? account.broker} account={account} />)}
            </CardBody>
          </Card>
        </>
      ) : null}
      <PortfolioSourceEditor open={editorOpen} settings={portfolioSettings} catalog={sourceCatalog} saving={savingSettings} onClose={() => setEditorOpen(false)} onSave={savePortfolioSettings} onConnectionsChanged={reloadConnections} />
    </Page>
  );
}

/**
 * Coerce a refresh payload into the shape the progress panel renders.
 *
 * Older backends reported per-source progress under `brokers`, and a source
 * entry can arrive as null; both are normalized here so a malformed payload
 * cannot take the page down mid-refresh.
 */
function normalizeRefreshState(state: PortfolioRefreshState | null | undefined): PortfolioRefreshState {
  const candidate = state?.sources ?? state?.brokers;
  const sources = candidate && typeof candidate === "object" && !Array.isArray(candidate)
    ? Object.fromEntries(Object.entries(candidate).map(([sourceId, item]) => [
        sourceId,
        item && typeof item === "object" ? item : { status: "pending" as const },
      ]))
    : {};
  return {
    running: Boolean(state?.running),
    current: typeof state?.current === "string" ? state.current : null,
    sources,
    brokers: sources,
  };
}

function RefreshProgress({ state, settings }: { state: PortfolioRefreshState; settings: PortfolioSettings | null }) {
  const { t } = useTranslation();
  const labels = new Map(settings?.sources.map((source) => [source.connection_id, source.label]) ?? []);
  const entries = Object.entries(normalizeRefreshState(state).sources ?? {});
  const statusLabel = (status: string) => status === "refreshing"
    ? t("portfolio.status.reading")
    : status === "ok"
      ? t("portfolio.status.done")
      : status === "error"
        ? t("portfolio.status.failed")
        : t("portfolio.status.waiting");
  return <Card role="status">
    <CardBody>
      <div className="mb-3 flex items-center gap-2 text-sm font-medium"><Loader2 className="h-4 w-4 animate-spin text-primary" aria-hidden="true" />{t("portfolio.status.title")}</div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{entries.map(([sourceId, item]) => {
        const status = item.status ?? "pending";
        return <div key={sourceId} className="flex items-center justify-between gap-3 rounded-md bg-muted px-3 py-2 text-[13px]">
          <span className="truncate font-medium" title={labels.get(sourceId) ?? sourceId}>{labels.get(sourceId) ?? sourceId}</span>
          <Badge tone={status === "ok" ? "success" : status === "error" ? "danger" : "neutral"}>{statusLabel(status)}</Badge>
        </div>;
      })}</div>
    </CardBody>
  </Card>;
}

/**
 * One account tile. A source with `status === "error"` has no totals at all:
 * it renders the failure, the error text and the last successful read time
 * instead of a value, so nothing on the card suggests it is part of the total.
 */
function AccountCard({ account, active, displayCurrency, fx, onClick, onReconnect, onRetry, busy, actionsDisabled }: { account: PortfolioAccount; active: boolean; displayCurrency: string; fx: PortfolioSnapshot["fx"]; onClick: () => void; onReconnect?: () => void; onRetry?: () => void; busy: boolean; actionsDisabled: boolean }) {
  const { t } = useTranslation();
  const failed = account.status === "error";
  const accountDisplay = displayValue(account.total_usd, account.total_cny, displayCurrency, fx);
  const accountError = account.error_code === "binance_restricted_location"
    ? t("portfolio.accounts.binanceRestrictedLocation")
    : account.error;
  return <div role="button" tabIndex={0} onClick={onClick} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") onClick(); }} className={`cursor-pointer rounded-lg border bg-card p-4 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${active ? "border-primary" : "border-border hover:bg-muted/40"}`}>
    <div className="flex items-center justify-between gap-3">
      <div><div className="text-sm font-medium">{account.label ?? account.broker.toUpperCase()}</div><div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground"><span>{account.broker}</span><PortfolioCompatibilityBadge compatibility={account.portfolio_compatibility} /></div></div>
      {failed ? <WifiOff className="h-4 w-4 text-danger" aria-hidden="true" /> : <CheckCircle2 className="h-4 w-4 text-success" aria-hidden="true" />}
    </div>
    {failed ? (
      <>
        <p className="mt-4 text-sm text-danger">{t("portfolio.accounts.failed")}</p>
        <p className="mt-2 text-xs text-muted-foreground">{account.last_success_at ? t("portfolio.accounts.lastSuccess", { time: dateTime(account.last_success_at) }) : t("portfolio.accounts.noSuccess")}</p>
      </>
    ) : (
      <>
        <div className="mt-4 text-2xl font-semibold tabular-nums">{money(accountDisplay, displayCurrency)}</div>
        <div className="mt-1 text-xs text-muted-foreground">{displayCurrency === "USD" ? money(account.total_cny, "CNY") : money(account.total_usd)} · {t("portfolio.accounts.positions", { count: account.position_count ?? 0 })}</div>
        <AccountBalanceDetails balances={account.balance_details} />
        <div className="mt-4 flex items-center justify-between gap-2 border-t border-border pt-3 text-xs"><span className="text-muted-foreground">{account.source_kind === "extraetf" ? t("portfolio.imports.source") : t("portfolio.accounts.fresh")}</span><span className="text-muted-foreground">{dateTime(account.import_metadata?.source_mtime ?? account.last_success_at)}</span></div>
      </>
    )}
    {failed && accountError ? <p className="mt-3 line-clamp-2 text-xs text-muted-foreground" title={accountError}>{accountError}</p> : null}
    {failed && onReconnect ? <Button size="sm" className="mt-3" onClick={(event) => { event.stopPropagation(); onReconnect(); }} disabled={actionsDisabled} loading={busy}>{busy ? null : <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />}{t("portfolio.accounts.reconnect")}</Button> : null}
    {failed && onRetry ? <Button size="sm" className="mt-3" onClick={(event) => { event.stopPropagation(); onRetry(); }} disabled={actionsDisabled} loading={busy}>{busy ? null : <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />}{t("portfolio.accounts.retryRead")}</Button> : null}
  </div>;
}

function AccountBalanceDetails({ balances }: { balances: PortfolioAccount["balance_details"] }) {
  const { t } = useTranslation();
  const visible = balances?.filter((balance) => balance.cash_infos.length || balance.max_finance_amount != null || balance.remaining_finance_amount != null);
  if (!visible?.length) return null;
  const amount = (value: number | null, currency: string | null) => value == null ? "-" : currency ? money(value, currency) : value.toLocaleString();
  return <details className="mt-4 border-t border-border pt-3 text-xs" onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
    <summary className="cursor-pointer font-medium">{t("portfolio.accounts.cashDetails")}</summary>
    {visible.map((balance, index) => <div key={index} className="mt-3 space-y-3">
      <div className="text-muted-foreground">{t("portfolio.accounts.reportingCurrency")}: {balance.currency ?? "-"}</div>
      <dl className="grid grid-cols-2 gap-2">
        <div><dt className="text-muted-foreground">{t("portfolio.accounts.financingLimit")}</dt><dd className="tabular-nums">{amount(balance.max_finance_amount, balance.currency)}</dd></div>
        <div><dt className="text-muted-foreground">{t("portfolio.accounts.financingRemaining")}</dt><dd className="tabular-nums">{amount(balance.remaining_finance_amount, balance.currency)}</dd></div>
      </dl>
      {balance.cash_infos.map((cash, cashIndex) => <div key={cashIndex} className="rounded-md bg-muted p-3">
        <div className="mb-2 font-medium">{cash.currency ?? "-"}</div>
        <dl className="grid grid-cols-2 gap-2">
          {([
            ["cashAvailable", cash.available_cash], ["cashWithdrawable", cash.withdraw_cash],
            ["cashFrozen", cash.frozen_cash], ["cashSettling", cash.settling_cash],
          ] as const).map(([key, value]) => <div key={key}>
            <dt className="text-muted-foreground">{t(`portfolio.accounts.${key}`)}</dt>
            <dd className={`tabular-nums ${value != null && value < 0 ? "text-danger" : ""}`}>{amount(value, cash.currency)}</dd>
          </div>)}
        </dl>
      </div>)}
    </div>)}
  </details>;
}

function DataBadge({ priced }: { priced: boolean }) {
  const { t } = useTranslation();
  if (!priced) return <Badge>{t("portfolio.holdings.unpriced")}</Badge>;
  return <Badge tone="success">{t("portfolio.holdings.priced")}</Badge>;
}

function CredentialCard({ account }: { account: PortfolioAccount }) {
  const { t } = useTranslation();
  const auth = account.auth;
  if (account.source_kind === "extraetf") return <div className="rounded-lg border border-border p-4"><div className="text-sm font-medium">{account.label}</div><p className="mt-2 text-[13px]">{t("portfolio.imports.hint")}</p>{account.import_metadata && <><p className="mt-2 text-xs text-muted-foreground">{t("portfolio.imports.mtime", { time: dateTime(account.import_metadata.source_mtime) })}</p><p className="text-xs text-muted-foreground">{t("portfolio.imports.expires", { time: dateTime(account.import_metadata.expires_at) })}</p></>}</div>;
  const renewal = auth?.renewal === "automatic"
    ? t("portfolio.credentials.renewalAutomatic")
    : auth?.renewal === "session"
      ? t("portfolio.credentials.renewalSession")
      : t("portfolio.credentials.renewalProvider");
  return <div className="rounded-lg border border-border p-4">
    <div className="flex items-center justify-between gap-3">
      <div><span className="text-sm font-medium">{account.label ?? account.broker.toUpperCase()}</span><div className="mt-1 text-xs text-muted-foreground">{account.broker}</div></div>
      <Badge tone={auth?.readonly ? "success" : "warning"} className="shrink-0">{auth?.readonly ? t("portfolio.credentials.readOnlyProfile") : t("portfolio.credentials.writableProfile")}</Badge>
    </div>
    <div className="mt-3 text-sm">{auth?.method ?? "-"} · {renewal}</div>
    <p className="mt-1 text-xs text-muted-foreground">{auth?.detail ?? "-"}</p>
  </div>;
}

type AllocationDatum = { id?: string; name: string; value: number; connector?: string };

function AllocationPie({ title, data, centerLabel, onSelect }: { title: string; data: AllocationDatum[]; centerLabel: string; onSelect?: (id: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const { i18n: instance } = useTranslation();
  const dark = useThemeDark();
  useEffect(() => {
    if (!ref.current || ref.current.clientWidth === 0) return;
    const theme = getChartTheme();
    const chart = echarts.init(ref.current);
    chart.setOption({
      backgroundColor: "transparent",
      color: theme.seriesPalette,
      tooltip: {
        trigger: "item",
        backgroundColor: theme.tooltipBg,
        borderColor: theme.tooltipBorder,
        textStyle: { color: theme.tooltipText },
        formatter: (params: { name: string; value: number; percent: number }) => `${params.name}<br/>${money(params.value)} · ${slicePercentage(params.percent)}`,
      },
      legend: { type: "scroll", bottom: 0, left: "center", textStyle: { color: theme.textColor }, pageTextStyle: { color: theme.textColor } },
      series: [{ type: "pie", radius: ["46%", "70%"], center: ["50%", "43%"], avoidLabelOverlap: true, padAngle: 2, itemStyle: { borderRadius: 5 }, label: { show: true, color: theme.textColor, formatter: (params: { name: string; percent: number }) => params.percent >= 2 ? `${params.name}\n${slicePercentage(params.percent)}` : "", fontSize: 12 }, labelLine: { length: 10, length2: 7, lineStyle: { color: theme.gridColor } }, labelLayout: { hideOverlap: true }, data }],
      graphic: [{ type: "text", left: "center", top: "39%", style: { text: centerLabel, textAlign: "center", fill: theme.textColor, fontSize: 12, fontWeight: 600 } }],
    });
    const resize = () => chart.resize();
    const select = (params: { dataIndex?: number }) => { const item = params.dataIndex == null ? undefined : data[params.dataIndex]; if (item && onSelect) onSelect(item.id ?? item.name); };
    chart.on("click", select);
    window.addEventListener("resize", resize);
    return () => { window.removeEventListener("resize", resize); chart.off("click", select); chart.dispose(); };
  }, [data, centerLabel, onSelect, dark, instance.language]);
  return <Card><CardHeader title={title} /><CardBody><div ref={ref} className="h-72 w-full" /></CardBody></Card>;
}

function HistoryChart({ history, currency = "USD" }: { history: PortfolioHistoryPoint[]; currency?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const { t, i18n: instance } = useTranslation();
  const dark = useThemeDark();
  useEffect(() => {
    if (!ref.current || ref.current.clientWidth === 0) return;
    const theme = getChartTheme();
    const lineColor = theme.seriesPalette[0];
    const chart = echarts.init(ref.current);
    const rows = history.slice(-180);
    chart.setOption({
      backgroundColor: "transparent",
      grid: { left: 18, right: 18, top: 25, bottom: 28, containLabel: true },
      tooltip: {
        trigger: "axis",
        backgroundColor: theme.tooltipBg,
        borderColor: theme.tooltipBorder,
        textStyle: { color: theme.tooltipText },
        formatter: (items: Array<{ dataIndex: number; value: number }>) => { const item = items[0]; const row = rows[item.dataIndex]; return `${dateTime(row?.created_at)}<br/>${money(item?.value == null ? null : Number(item.value), currency)}`; },
      },
      xAxis: { type: "category", boundaryGap: false, data: rows.map((row) => new Date(row.created_at).toLocaleString(uiLocale(), { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })), axisLabel: { color: theme.textColor, hideOverlap: true }, axisLine: { lineStyle: { color: theme.gridColor } } },
      yAxis: { type: "value", scale: true, axisLabel: { color: theme.textColor, formatter: (v: number) => compactMoney(v, currency) }, splitLine: { lineStyle: { color: theme.gridColor, opacity: 0.45 } } },
      series: [{ type: "line", data: rows.map((row) => { const value = currency === "USD" ? row.total_usd : currency === "CNY" ? row.total_cny : currency === "HKD" ? row.total_hkd : currency === "EUR" ? row.total_eur : null; return value == null ? null : Number(value); }), smooth: true, symbol: rows.length < 30 ? "circle" : "none", lineStyle: { width: 2, color: lineColor }, itemStyle: { color: lineColor }, areaStyle: { color: lineColor + "1A" } }],
    });
    const resize = () => chart.resize();
    window.addEventListener("resize", resize);
    return () => { window.removeEventListener("resize", resize); chart.dispose(); };
  }, [history, dark, instance.language, currency]);
  return <Card>
    <CardHeader
      title={t("portfolio.history.title")}
      description={t("portfolio.history.hint")}
      actions={<Badge>{t("portfolio.history.count", { count: history.length })}</Badge>}
    />
    <CardBody>
      {history.length ? <div ref={ref} className="h-64 w-full" /> : <EmptyState title={t("portfolio.history.empty")} />}
    </CardBody>
  </Card>;
}
