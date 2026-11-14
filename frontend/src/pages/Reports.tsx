import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  FileText,
  GitCompare,
  Loader2,
  RefreshCw,
  Search,
  XCircle,
} from "lucide-react";
import { api, type RunListItem } from "@/lib/api";
import { formatMetricVal } from "@/lib/formatters";
import { Badge, Button, Card, CardBody, EmptyState, Input, Page, PageHeader, Select, Table, THead, TBody, TR, TH, TD } from "@/components/ui";
import { Skeleton } from "@/components/common/Skeleton";

const REPORT_SCAN_LIMIT = 100;

type SortMode = "created_desc" | "created_asc" | "return_desc" | "sharpe_desc";

export function Reports() {
  const { t } = useTranslation();
  const [runs, setRuns] = useState<RunListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [sortMode, setSortMode] = useState<SortMode>("created_desc");
  const [error, setError] = useState<string | null>(null);

  async function loadReports(mode: "initial" | "refresh" = "refresh") {
    if (mode === "initial") setLoading(true);
    else setRefreshing(true);
    setError(null);
    try {
      const list = await api.listRuns(REPORT_SCAN_LIMIT);
      setRuns(Array.isArray(list) ? list.filter(isBacktestReportRun) : []);
    } catch (err) {
      setRuns([]);
      setError(err instanceof Error ? err.message : t("reports.loadError"));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    void loadReports("initial");
  }, []);

  const statusOptions = useMemo(() => {
    const values = Array.from(new Set(runs.map((run) => run.status || "unknown"))).sort();
    return ["all", ...values];
  }, [runs]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const startMs = startDate ? Date.parse(startDate) : Number.NEGATIVE_INFINITY;
    const endMs = endDate ? Date.parse(`${endDate}T23:59:59`) : Number.POSITIVE_INFINITY;

    return [...runs]
      .filter((run) => {
        if (statusFilter !== "all" && (run.status || "unknown") !== statusFilter) return false;
        const created = Date.parse(run.created_at);
        if (Number.isFinite(created) && (created < startMs || created > endMs)) return false;
        if (!needle) return true;
        const haystack = [
          run.run_id,
          run.status,
          run.prompt,
          ...(run.codes || []),
          run.start_date,
          run.end_date,
        ].filter(Boolean).join(" ").toLowerCase();
        return haystack.includes(needle);
      })
      .sort((left, right) => compareRuns(left, right, sortMode));
  }, [runs, query, statusFilter, startDate, endDate, sortMode]);

  return (
    <Page width="narrow">
      <PageHeader
        title={t("reports.title")}
        description={t("reports.subtitle")}
        actions={
          <Button onClick={() => void loadReports("refresh")} disabled={refreshing}>
            {refreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            {t("reports.refresh")}
          </Button>
        }
      />

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(220px,1fr)_160px_150px_150px_170px]">
        <div className="relative sm:col-span-2 lg:col-span-1">
          <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("reports.searchPlaceholder")}
            aria-label={t("alphaZoo.search")}
            className="ps-9"
          />
        </div>
        <Select
          value={statusFilter}
          onChange={(event) => setStatusFilter(event.target.value)}
          aria-label={t("settings.status")}
        >
          {statusOptions.map((status) => (
            <option key={status} value={status}>
              {status === "all" ? t("reports.allStatuses") : status}
            </option>
          ))}
        </Select>
        <Input
          type="date"
          value={startDate}
          onChange={(event) => setStartDate(event.target.value)}
          aria-label={t("reports.startDate")}
        />
        <Input
          type="date"
          value={endDate}
          onChange={(event) => setEndDate(event.target.value)}
          aria-label={t("reports.endDate")}
        />
        <Select
          value={sortMode}
          onChange={(event) => setSortMode(event.target.value as SortMode)}
          aria-label={t("reports.sort")}
        >
          <option value="created_desc">{t("reports.sortNewest")}</option>
          <option value="created_asc">{t("reports.sortOldest")}</option>
          <option value="return_desc">{t("reports.sortReturn")}</option>
          <option value="sharpe_desc">{t("reports.sortSharpe")}</option>
        </Select>
      </section>

      <div className="text-[13px] text-muted-foreground">
        {t("reports.count", { shown: filtered.length, total: runs.length })}
      </div>

      {loading ? (
        <div className="grid gap-3">
          {[1, 2, 3, 4].map((item) => (
            <Skeleton key={item} className="h-12" />
          ))}
        </div>
      ) : null}

      {!loading && error ? (
        <Card className="border-warning/30 bg-warning/10">
          <CardBody>
            <div className="flex items-center gap-2 text-sm font-medium text-warning">
              <AlertTriangle className="h-4 w-4" />
              {t("reports.unavailable")}
            </div>
            <p className="mt-2 text-[13px] text-muted-foreground">{error}</p>
          </CardBody>
        </Card>
      ) : null}

      {!loading && !error && filtered.length === 0 ? (
        <Card>
          <EmptyState
            icon={FileText}
            title={runs.length === 0 ? t("reports.emptyTitle") : t("reports.noMatchesTitle")}
            description={runs.length === 0 ? t("reports.emptyBody") : t("reports.noMatchesBody")}
            action={runs.length === 0 ? (
              <Link to="/" className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">{t("navigation.startResearch")}</Link>
            ) : undefined}
          />
        </Card>
      ) : null}

      {!loading && !error && filtered.length > 0 ? (
        <Table>
          <THead>
            <tr>
              <TH>{t("reports.run", { defaultValue: "Run" })}</TH>
              <TH numeric>{t("reports.return")}</TH>
              <TH numeric>{t("reports.sharpe")}</TH>
              <TH><span className="sr-only">{t("reports.actions", { defaultValue: "Actions" })}</span></TH>
            </tr>
          </THead>
          <TBody>
            {filtered.map((run) => (
              <ReportRow key={run.run_id} run={run} />
            ))}
          </TBody>
        </Table>
      ) : null}
    </Page>
  );
}

function ReportRow({ run }: { run: RunListItem }) {
  const { t } = useTranslation();
  return (
    <TR>
      <TD className="min-w-[16rem] max-w-md align-top">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={run.status} />
          <Link to={`/runs/${run.run_id}`} className="truncate font-mono text-[13px] font-medium hover:text-primary">
            {run.run_id}
          </Link>
          <span className="text-xs text-muted-foreground">
            {formatRunDate(run.created_at, t("reports.unknown", { defaultValue: "Unknown" }))}
          </span>
        </div>
        <p className="mt-1 line-clamp-2 text-[13px] text-muted-foreground">{run.prompt || t("reports.noPrompt")}</p>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {(run.codes || []).slice(0, 6).map((code) => (
            <Badge key={code} className="font-mono">{code}</Badge>
          ))}
          {run.start_date || run.end_date ? (
            <Badge>
              {run.start_date || "?"} {t("reports.to")} {run.end_date || "?"}
            </Badge>
          ) : null}
        </div>
      </TD>
      <TD numeric className={`align-top ${(run.total_return ?? 0) > 0 ? "text-success" : (run.total_return ?? 0) < 0 ? "text-danger" : ""}`}>{formatOptionalMetric("total_return", run.total_return)}</TD>
      <TD numeric className="align-top">{formatOptionalMetric("sharpe", run.sharpe)}</TD>
      <TD className="align-top">
        <div className="flex flex-wrap justify-end gap-2">
          <Link
            to={`/runs/${run.run_id}`}
            className="inline-flex h-8 items-center justify-center gap-2 rounded-md bg-primary px-3 text-[13px] font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            {t("reports.fullReport")} <ArrowRight className="h-4 w-4" />
          </Link>
          <Link
            to="/compare"
            className="inline-flex h-8 items-center justify-center gap-2 rounded-md border border-border bg-card px-3 text-[13px] font-medium transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            <GitCompare className="h-4 w-4" />
            {t("reports.compare")}
          </Link>
        </div>
      </TD>
    </TR>
  );
}

function StatusBadge({ status }: { status: string }) {
  const { t } = useTranslation();
  const normalized = status.toLowerCase();
  const ok = ["success", "done", "completed", "complete"].includes(normalized);
  return (
    <Badge tone={ok ? "success" : "neutral"}>
      {ok ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
      {status || t("reports.unknown", { defaultValue: "Unknown" })}
    </Badge>
  );
}

function isBacktestReportRun(run: RunListItem): boolean {
  return Number.isFinite(run.total_return) || Number.isFinite(run.sharpe);
}

function compareRuns(left: RunListItem, right: RunListItem, mode: SortMode): number {
  if (mode === "created_asc") return dateMs(left.created_at) - dateMs(right.created_at);
  if (mode === "return_desc") return metric(right.total_return) - metric(left.total_return);
  if (mode === "sharpe_desc") return metric(right.sharpe) - metric(left.sharpe);
  return dateMs(right.created_at) - dateMs(left.created_at);
}

function metric(value: number | undefined): number {
  return Number.isFinite(value) ? Number(value) : Number.NEGATIVE_INFINITY;
}

function formatOptionalMetric(key: string, value: number | undefined): string {
  return Number.isFinite(value) ? formatMetricVal(key, value as number) : "-";
}

function dateMs(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatRunDate(value: string, unknownLabel: string): string {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return value || unknownLabel;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(parsed);
}
