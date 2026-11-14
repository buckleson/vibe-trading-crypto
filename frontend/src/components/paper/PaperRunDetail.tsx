import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Info, RefreshCw, Square, Trash2 } from "lucide-react";
import {
  Badge, Button, Card, CardBody, CardHeader, EmptyState, Stat,
  Table, TBody, TD, TH, THead, TR,
} from "@/components/ui";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { Skeleton } from "@/components/common/Skeleton";
import { EquityChart } from "@/components/charts/EquityChart";
import {
  formatNumber, formatPercent, formatSigned, paperRunsApi, toneClass, tone,
  type PaperRun, type PaperRunDetail as Detail,
} from "@/lib/paperRuns";

export const STALE_MS = 60_000;
export const AUTO_REFRESH_MS = 5 * 60_000;
const TRADE_PAGE = 50;

const qtyFmt = new Intl.NumberFormat(undefined, { maximumFractionDigits: 6 });
const plain = (iso: string) => iso.replace("T", " ");

export function PaperRunDetail({ runId, onRun, onDeleted }: {
  runId: string;
  onRun: (run: PaperRun) => void;
  onDeleted: (id: string) => void;
}) {
  const { t } = useTranslation();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [confirm, setConfirm] = useState<"stop" | "delete" | null>(null);
  const [showAll, setShowAll] = useState(false);
  const idRef = useRef(runId);
  const detailRef = useRef<Detail | null>(null);
  const onRunRef = useRef(onRun);
  onRunRef.current = onRun;

  const apply = useCallback((id: string, d: Detail) => {
    if (idRef.current !== id) return;
    detailRef.current = d;
    setDetail(d);
    onRunRef.current(d.run);
  }, []);

  const doRefresh = useCallback(async (id: string) => {
    setRefreshing(true);
    setError("");
    try {
      apply(id, await paperRunsApi.refresh(id));
    } catch (e) {
      if (idRef.current === id) setError((e as Error).message);
    } finally {
      if (idRef.current === id) setRefreshing(false);
    }
  }, [apply]);

  useEffect(() => {
    idRef.current = runId;
    detailRef.current = null;
    setDetail(null);
    setLoading(true);
    setRefreshing(false);
    setError("");
    setShowAll(false);
    setConfirm(null);
    paperRunsApi
      .get(runId)
      .then((d) => {
        if (idRef.current !== runId) return;
        apply(runId, d);
        const last = d.run.last_refreshed_at ? new Date(d.run.last_refreshed_at).getTime() : 0;
        if (d.run.status === "active" && (!last || Date.now() - last > STALE_MS)) void doRefresh(runId);
      })
      .catch((e: Error) => {
        if (idRef.current === runId) setError(e.message);
      })
      .finally(() => {
        if (idRef.current === runId) setLoading(false);
      });
    const timer = setInterval(() => {
      if (detailRef.current?.run.status === "active" && document.visibilityState === "visible") {
        void doRefresh(runId);
      }
    }, AUTO_REFRESH_MS);
    return () => clearInterval(timer);
  }, [runId, apply, doRefresh]);

  async function stop() {
    setConfirm(null);
    setError("");
    try {
      apply(runId, await paperRunsApi.stop(runId));
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function remove() {
    setConfirm(null);
    setError("");
    try {
      await paperRunsApi.remove(runId);
      onDeleted(runId);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  if (!detail) {
    return (
      <div className="space-y-4">
        {error && <p role="alert" className="text-[13px] text-danger">{error}</p>}
        {loading && (
          <div className="space-y-3" aria-busy="true">
            <Skeleton className="h-6 w-64" />
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-64 w-full" />
          </div>
        )}
      </div>
    );
  }

  const { run, equity, trades, positions } = detail;
  const s = run.summary;
  const shownTrades = showAll ? trades : trades.slice(0, TRADE_PAGE);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-lg font-semibold">{run.label}</h2>
          <p className="text-[13px] text-muted-foreground">
            {run.codes.join(", ")} {t("paper.on", { defaultValue: "on" })} {run.interval}
          </p>
          <p className="text-[13px] text-muted-foreground">
            {t("paper.startedAt", { defaultValue: "Started {{date}}", date: new Date(run.started_at).toLocaleString() })}
            {" · "}
            {t("paper.countsFrom", { defaultValue: "Counts from {{date}}", date: plain(run.evaluation_start) })}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button loading={refreshing} onClick={() => void doRefresh(runId)}>
            {!refreshing && <RefreshCw className="h-4 w-4" aria-hidden="true" />}
            {t("paper.refresh", { defaultValue: "Refresh" })}
          </Button>
          {run.status === "active" && (
            <Button onClick={() => setConfirm("stop")}>
              <Square className="h-4 w-4" aria-hidden="true" />
              {t("paper.stop", { defaultValue: "Stop" })}
            </Button>
          )}
          <Button variant="danger" onClick={() => setConfirm("delete")}>
            <Trash2 className="h-4 w-4" aria-hidden="true" />
            {t("paper.delete", { defaultValue: "Delete" })}
          </Button>
        </div>
      </div>

      {error && <p role="alert" className="text-[13px] text-danger">{error}</p>}

      {run.state === "waiting" && (
        <Card>
          <CardBody className="flex items-start gap-2 text-[13px]">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-info" aria-hidden="true" />
            <p>
              {t("paper.waitingBanner", {
                defaultValue: "Waiting for the first bars after {{date}}. Paper results start with the first bar after you pressed start.",
                date: plain(run.evaluation_start),
              })}
            </p>
          </CardBody>
        </Card>
      )}
      {run.state === "error" && (
        <Card className="border-danger/30 bg-danger/10">
          <CardBody className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-[13px] text-danger">{run.last_error ?? t("paper.unknownError", { defaultValue: "Refresh failed." })}</p>
            <Button size="sm" loading={refreshing} onClick={() => void doRefresh(runId)}>
              {t("paper.refresh", { defaultValue: "Refresh" })}
            </Button>
          </CardBody>
        </Card>
      )}

      <Card>
        <CardBody className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
          <Stat label={t("paper.equity", { defaultValue: "Equity" })} value={s ? formatNumber(s.equity) : "n/a"} />
          <Stat label={t("paper.pnl", { defaultValue: "P&L" })} value={s ? formatSigned(s.pnl) : "n/a"} tone={tone(s?.pnl)} />
          <Stat label={t("paper.return", { defaultValue: "Return" })} value={s ? formatPercent(s.total_return, true) : "n/a"} tone={tone(s?.total_return)} />
          <Stat label={t("paper.maxDrawdown", { defaultValue: "Max drawdown" })} value={s ? formatPercent(s.max_drawdown) : "n/a"} />
          <Stat label={t("paper.sharpe", { defaultValue: "Sharpe" })} value={s?.sharpe != null ? formatNumber(s.sharpe) : "n/a"} />
          <Stat label={t("paper.trades", { defaultValue: "Trades" })} value={s ? String(s.trade_count) : "n/a"} />
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t("paper.equityCurve", { defaultValue: "Equity curve" })} />
        <CardBody>
          {equity.length >= 2 ? (
            <EquityChart data={equity} height={280} />
          ) : (
            <EmptyState title={t("paper.noCurve", { defaultValue: "The equity curve appears after two bars." })} />
          )}
        </CardBody>
      </Card>

      <div className="grid gap-4 xl:grid-cols-[minmax(220px,1fr)_2fr]">
        <Card>
          <CardHeader title={t("paper.positions", { defaultValue: "Positions" })} />
          <CardBody>
            {positions.length === 0 ? (
              <p className="text-[13px] text-muted-foreground">{t("paper.noPositions", { defaultValue: "No open positions" })}</p>
            ) : (
              <Table>
                <THead>
                  <TR>
                    <TH>{t("paper.symbol", { defaultValue: "Symbol" })}</TH>
                    <TH numeric>{t("paper.weight", { defaultValue: "Weight" })}</TH>
                  </TR>
                </THead>
                <TBody>
                  {positions.map((p) => (
                    <TR key={p.symbol}>
                      <TD>{p.symbol}</TD>
                      <TD numeric>{formatPercent(p.weight)}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title={t("paper.tradeHistory", { defaultValue: "Trade history" })} />
          <CardBody className="space-y-3">
            {trades.length === 0 ? (
              <p className="text-[13px] text-muted-foreground">{t("paper.noTrades", { defaultValue: "No trades yet" })}</p>
            ) : (
              <>
                <Table>
                  <THead>
                    <TR>
                      <TH>{t("paper.time", { defaultValue: "Time" })}</TH>
                      <TH>{t("paper.symbol", { defaultValue: "Symbol" })}</TH>
                      <TH>{t("paper.side", { defaultValue: "Side" })}</TH>
                      <TH numeric>{t("paper.quantity", { defaultValue: "Qty" })}</TH>
                      <TH numeric>{t("paper.price", { defaultValue: "Price" })}</TH>
                      <TH numeric>{t("paper.pnl", { defaultValue: "P&L" })}</TH>
                      <TH numeric>{t("paper.returnPct", { defaultValue: "Return" })}</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {shownTrades.map((tr, i) => (
                      <TR key={`${tr.time}-${tr.symbol}-${i}`}>
                        <TD className="whitespace-nowrap">{tr.time}</TD>
                        <TD>{tr.symbol}</TD>
                        <TD>
                          <Badge tone={tr.side === "buy" ? "info" : "neutral"}>
                            {tr.side === "buy" ? t("paper.buy", { defaultValue: "Buy" }) : t("paper.sell", { defaultValue: "Sell" })}
                          </Badge>
                        </TD>
                        <TD numeric>{qtyFmt.format(tr.qty)}</TD>
                        <TD numeric>{formatNumber(tr.price)}</TD>
                        <TD numeric className={toneClass(tr.pnl)}>{tr.pnl == null ? "" : formatSigned(tr.pnl)}</TD>
                        <TD numeric className={toneClass(tr.return_pct)}>{tr.return_pct == null ? "" : formatPercent(tr.return_pct, true)}</TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
                {!showAll && trades.length > TRADE_PAGE && (
                  <Button size="sm" onClick={() => setShowAll(true)}>
                    {t("paper.showAll", { defaultValue: "Show all {{count}}", count: trades.length })}
                  </Button>
                )}
              </>
            )}
          </CardBody>
        </Card>
      </div>

      <p className="text-[13px] text-muted-foreground">
        {t("paper.footnote", {
          defaultValue: "Paper runs replay the backtested strategy on fresh data each refresh. If a data vendor revises past bars, history can shift slightly. No orders are sent to any exchange.",
        })}
      </p>

      <ConfirmDialog
        open={confirm === "stop"}
        title={t("paper.stopTitle", { defaultValue: "Stop this paper run? It keeps its history and stops counting new bars." })}
        confirmLabel={t("paper.stop", { defaultValue: "Stop" })}
        cancelLabel={t("paper.cancel", { defaultValue: "Cancel" })}
        onConfirm={() => void stop()}
        onCancel={() => setConfirm(null)}
      />
      <ConfirmDialog
        open={confirm === "delete"}
        title={t("paper.deleteTitle", { defaultValue: "Delete this paper run?" })}
        description={t("paper.deleteBody", { defaultValue: "Its history and results are removed for good." })}
        tone="destructive"
        confirmLabel={t("paper.delete", { defaultValue: "Delete" })}
        cancelLabel={t("paper.cancel", { defaultValue: "Cancel" })}
        onConfirm={() => void remove()}
        onCancel={() => setConfirm(null)}
      />
    </div>
  );
}
