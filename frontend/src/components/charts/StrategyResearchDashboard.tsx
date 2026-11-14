import { useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { CalendarRange, Database, FlaskConical } from "lucide-react";
import i18n from "@/i18n";
import { echarts } from "@/lib/echarts";
import { getChartTheme } from "@/lib/chart-theme";
import { useThemeDark } from "@/lib/theme-store";
import type { RunData } from "@/lib/api";
import { runTrades } from "@/lib/runReports";
import { getPnlColors } from "@/lib/pnl-colors";
import { Badge, Card, CardBody, CardHeader, Stat, Table, TBody, TD, TH, THead, TR } from "@/components/ui";


function num(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function fixed(value: unknown, digits = 2): string {
  const parsed = num(value);
  return parsed == null ? "-" : parsed.toFixed(digits);
}

function pct(value: unknown, digits = 1): string {
  const parsed = num(value);
  return parsed == null ? "-" : `${(parsed * 100).toFixed(digits)}%`;
}

function timestamp(row: Record<string, string>): string {
  return row.timestamp || row.time || row.date || "";
}

type ReportIdentity = {
  title: string;
  strategy: string;
  strategyInferred: boolean;
  symbols: string[];
  startDate: string;
  endDate: string;
  source: string;
  engine: string;
};

function compactPrompt(prompt: string): string {
  const firstClause = prompt.trim().split(/[。.!！?？;；\n]/, 1)[0] || "";
  return firstClause.length > 68 ? `${firstClause.slice(0, 65).trim()}…` : firstClause;
}

function inferStrategyName(prompt: string): string {
  const zhMa = prompt.match(/(\d+)\s*(?:日|天)?\s*[\/／-]\s*(\d+)\s*(?:日|天)?[^。；,，]{0,18}均线/i)
    || prompt.match(/(\d+)\s*日均线[^。；,，]{0,18}(\d+)\s*日均线/i);
  if (zhMa) return i18n.t("runDashboard.strategyMaCrossover", { fast: zhMa[1], slow: zhMa[2] });

  const enMa = prompt.match(/(\d+)\s*[\/\-]\s*(\d+)[^.!?]{0,28}(?:moving[ -]?average|\bma\b)/i)
    || prompt.match(/(?:moving[ -]?average|\bma\b)[^.!?]{0,28}(\d+)\s*[\/\-]\s*(\d+)/i);
  if (enMa) return i18n.t("runDashboard.strategyMaCrossover", { fast: enMa[1], slow: enMa[2] });

  if (/macd/i.test(prompt)) return i18n.t("runDashboard.strategyMacd");
  if (/rsi/i.test(prompt)) return i18n.t("runDashboard.strategyRsi");
  if (/动量|momentum/i.test(prompt)) return i18n.t("runDashboard.strategyMomentum");
  if (/均值回归|mean reversion/i.test(prompt)) return i18n.t("runDashboard.strategyMeanReversion");
  if (/突破|breakout/i.test(prompt)) return i18n.t("runDashboard.strategyBreakout");
  return compactPrompt(prompt) || i18n.t("runDashboard.systematicStrategy");
}

export function getStrategyReportIdentity(run: RunData): ReportIdentity {
  const backtest = (run.run_card?.backtest || {}) as Record<string, unknown>;
  const symbols = (Array.isArray(backtest.codes) ? backtest.codes : run.chart_symbols || [])
    .map(String)
    .filter(Boolean);
  const prompt = run.prompt || "";
  const strategy = inferStrategyName(prompt);
  const symbolLabel = symbols.length === 0
    ? i18n.t("runDashboard.portfolio")
    : symbols.length <= 2
      ? symbols.join(" + ")
      : `${symbols[0]} +${symbols.length - 1}`;
  const fallbackRows = run.artifacts_equity_csv || [];
  const startDate = String(backtest.start_date || (fallbackRows[0] ? timestamp(fallbackRows[0]) : ""));
  const endDate = String(backtest.end_date || (fallbackRows.length ? timestamp(fallbackRows[fallbackRows.length - 1]) : ""));
  return {
    title: `${symbolLabel} · ${strategy}`,
    strategy,
    strategyInferred: true,
    symbols,
    startDate,
    endDate,
    source: String((run.run_card?.data_sources || [])[0] || backtest.source || ""),
    engine: String(backtest.engine || ""),
  };
}

function rollingSharpe(rows: Array<Record<string, string>>, window = 20): Array<number | null> {
  const returns = rows.map((row) => num(row.ret));
  return returns.map((_, index) => {
    if (index + 1 < window) return null;
    const sample = returns
      .slice(index + 1 - window, index + 1)
      .filter((value): value is number => value != null);
    if (sample.length < window) return null;
    const mean = sample.reduce((sum, value) => sum + value, 0) / sample.length;
    const variance = sample.reduce((sum, value) => sum + (value - mean) ** 2, 0)
      / Math.max(1, sample.length - 1);
    const std = Math.sqrt(variance);
    return std > 0 ? (mean / std) * Math.sqrt(252) : 0;
  });
}

export function StrategyResearchDashboard({ run }: { run: RunData }) {
  const { t } = useTranslation();
  const navRef = useRef<HTMLDivElement>(null);
  const riskRef = useRef<HTMLDivElement>(null);
  const tradesRef = useRef<HTMLDivElement>(null);
  const dark = useThemeDark();

  const equityRows = useMemo<Array<Record<string, string>>>(() => {
    if (run.artifacts_equity_csv?.length) return run.artifacts_equity_csv;
    return (run.equity_curve || []).map((row) => ({
      timestamp: row.time,
      equity: String(row.equity),
      drawdown: String(row.drawdown ?? ""),
    }));
  }, [run.artifacts_equity_csv, run.equity_curve]);
  const trades = runTrades(run);
  const identity = useMemo(() => getStrategyReportIdentity(run), [run]);

  useEffect(() => {
    const nodes = [navRef.current, riskRef.current, tradesRef.current];
    if (nodes.some((node) => !node)) return;
    const charts = nodes.map((node) => echarts.init(node!));
    const [navChart, riskChart, tradeChart] = charts;
    const theme = getChartTheme();
    const pnl = getPnlColors();
    const [BLUE, , GREEN, , SLATE] = theme.seriesPalette;
    const tooltip = { trigger: "axis", backgroundColor: theme.tooltipBg, borderColor: theme.tooltipBorder, borderWidth: 1, extraCssText: "box-shadow:none;", textStyle: { color: theme.tooltipText, fontSize: 12 } };
    const axis = {
      axisLine: { lineStyle: { color: theme.axisColor } },
      axisLabel: { color: theme.textColor, fontSize: 12 },
      splitLine: { lineStyle: { color: theme.gridColor } },
    };
    const dates = equityRows.map(timestamp);
    const equities = equityRows.map((row) => num(row.equity));
    const benchmarks = equityRows.map((row) => num(row.benchmark_equity));
    const firstEquity = equities.find((value): value is number => value != null && value !== 0) || 1;
    const firstBenchmark = benchmarks.find((value): value is number => value != null && value !== 0) || 1;

    navChart.setOption({
      backgroundColor: "transparent",
      tooltip,
      legend: { top: 0, left: 0, textStyle: { color: theme.textColor, fontSize: 12 } },
      grid: { left: 18, right: 22, top: 32, bottom: 18, containLabel: true },
      xAxis: { ...axis, type: "category", data: dates, boundaryGap: false },
      yAxis: { ...axis, type: "value", axisLabel: { color: theme.textColor, fontSize: 12, formatter: (v: number) => `${v.toFixed(2)}x` } },
      series: [
        { name: t("runDashboard.seriesStrategy"), type: "line", showSymbol: false, data: equities.map((v) => v == null ? null : v / firstEquity), lineStyle: { color: BLUE, width: 2.5 }, itemStyle: { color: BLUE } },
        ...(benchmarks.some((value) => value != null) ? [{ name: t("runDashboard.seriesBenchmark"), type: "line", showSymbol: false, data: benchmarks.map((v) => v == null ? null : v / firstBenchmark), lineStyle: { color: SLATE, width: 1.5, type: "dashed" }, itemStyle: { color: SLATE } }] : []),
      ],
    });

    const drawdown = equityRows.map((row) => num(row.drawdown));
    const sharpe = rollingSharpe(equityRows);
    riskChart.setOption({
      backgroundColor: "transparent",
      tooltip,
      legend: { top: 0, left: 0, textStyle: { color: theme.textColor, fontSize: 12 } },
      grid: { left: 18, right: 24, top: 32, bottom: 18, containLabel: true },
      xAxis: { ...axis, type: "category", data: dates, boundaryGap: false },
      yAxis: [
        { ...axis, type: "value", axisLabel: { color: theme.textColor, fontSize: 12, formatter: (v: number) => `${(v * 100).toFixed(0)}%` } },
        { ...axis, type: "value", splitLine: { show: false }, axisLabel: { color: theme.textColor, fontSize: 12 } },
      ],
      series: [
        { name: t("runDashboard.seriesDrawdown"), type: "line", showSymbol: false, data: drawdown, lineStyle: { color: pnl.loss, width: 2 }, areaStyle: { color: pnl.loss + "1A" }, itemStyle: { color: pnl.loss } },
        { name: t("runDashboard.seriesRollingSharpe"), type: "line", yAxisIndex: 1, showSymbol: false, connectNulls: false, data: sharpe, lineStyle: { color: GREEN, width: 1.5 }, itemStyle: { color: GREEN } },
      ],
    });

    const exits = trades.filter((trade) => (num(trade.pnl) || 0) !== 0).slice(-60);
    tradeChart.setOption({
      backgroundColor: "transparent",
      tooltip: { ...tooltip, axisPointer: { type: "shadow" } },
      grid: { left: 18, right: 18, top: 14, bottom: 18, containLabel: true },
      xAxis: { ...axis, type: "category", data: exits.map((trade, index) => trade.timestamp || String(index + 1)), axisLabel: { color: theme.textColor, fontSize: 12, hideOverlap: true } },
      yAxis: { ...axis, type: "value" },
      series: [{ type: "bar", barMaxWidth: 12, data: exits.map((trade) => { const value = num(trade.pnl) || 0; return { value, itemStyle: { color: value >= 0 ? pnl.profit : pnl.loss } }; }) }],
    });

    let frame: number | null = null;
    const observer = new ResizeObserver(() => {
      if (frame != null) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => charts.forEach((chart) => chart.resize()));
    });
    nodes.forEach((node) => observer.observe(node!));
    return () => {
      observer.disconnect();
      if (frame != null) cancelAnimationFrame(frame);
      charts.forEach((chart) => chart.dispose());
    };
  }, [dark, equityRows, trades]);

  // This dashboard is built around a classic equity-curve backtest. A
  // portfolio-construction / risk-snapshot run (risk_xray, rebalance_notes)
  // has neither, so every KPI and chart here would silently render as
  // dashes/blank -- which reads as "broken", not "different run type". Point
  // to the Studio tab instead, which actually renders that run's data.
  if (equityRows.length === 0 && trades.length === 0 && (run.risk_xray || run.rebalance_notes)) {
    return (
      <div className="mx-auto max-w-[640px] rounded-lg border border-border bg-card p-8 text-center">
        <FlaskConical className="mx-auto h-8 w-8 text-muted-foreground" aria-hidden="true" />
        <p className="mt-3 text-sm font-medium text-foreground">{t("runDashboard.noBacktestData")}</p>
        <p className="mt-1 text-sm text-muted-foreground">{t("runDashboard.noBacktestDataStudioHint")}</p>
      </div>
    );
  }

  const metrics: Record<string, number> = run.metrics || {};
  const kpis: Array<[string, string, "neutral" | "success" | "danger"]> = [
    [t("runDashboard.kpiTotalReturn"), pct(metrics.total_return), (metrics.total_return ?? 0) < 0 ? "danger" : "success"],
    [t("runDashboard.kpiAnnualReturn"), pct(metrics.annual_return), (metrics.annual_return ?? 0) < 0 ? "danger" : "success"],
    ["Sharpe", fixed(metrics.sharpe), "neutral"],
    [t("runDashboard.kpiMaxDrawdown"), pct(metrics.max_drawdown), "danger"],
    [t("runDashboard.kpiWinRate"), pct(metrics.win_rate), "neutral"],
    [t("runDashboard.kpiTrades"), fixed(metrics.trade_count, 0), "neutral"],
  ];
  const chartBox = "overflow-hidden rounded-lg border border-border";
  const meta = "inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5";

  return (
    <div className="mx-auto max-w-[1180px] space-y-6">
      <Card>
        <CardBody className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-xl font-semibold tracking-tight">{identity.title}</h2>
              {identity.strategyInferred && <Badge tone="warning">{t("runDashboard.strategyInferred")}</Badge>}
            </div>
            <Badge>Run {run.run_id.slice(-8)}</Badge>
          </div>
          {run.prompt && <p className="max-w-4xl text-sm text-muted-foreground">{compactPrompt(run.prompt)}</p>}
          <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
            {(identity.startDate || identity.endDate) && <span className={meta}><CalendarRange className="h-3.5 w-3.5" aria-hidden="true" />{identity.startDate || "-"} - {identity.endDate || "-"}</span>}
            {identity.engine && <span className={meta}><FlaskConical className="h-3.5 w-3.5" aria-hidden="true" />{identity.engine.toUpperCase()} {t("runDashboard.engine")}</span>}
            {identity.source && <span className={meta}><Database className="h-3.5 w-3.5" aria-hidden="true" />{identity.source}</span>}
          </div>
        </CardBody>
      </Card>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
        {kpis.map(([label, value, tone]) => <Card key={label} className="p-4"><Stat label={label} value={value} tone={tone} /></Card>)}
      </div>

      <Card>
        <CardHeader title={t("runDashboard.figEquityTitle")} description={t("runDashboard.figEquityNote")} />
        <CardBody><div ref={navRef} className={`h-[320px] ${chartBox}`} /></CardBody>
      </Card>
      <Card>
        <CardHeader title={t("runDashboard.figRiskTitle")} description={t("runDashboard.figRiskNote")} />
        <CardBody><div ref={riskRef} className={`h-[300px] ${chartBox}`} /></CardBody>
      </Card>
      <Card>
        <CardHeader title={t("runDashboard.figPnlTitle")} description={t("runDashboard.figPnlNote")} />
        <CardBody><div ref={tradesRef} className={`h-[260px] ${chartBox}`} /></CardBody>
      </Card>
      <Card>
        <CardHeader title={t("runDashboard.figLedgerTitle")} description={t("runDashboard.figLedgerNote")} />
        <CardBody><TradeTable rows={trades.slice(-100).reverse()} /></CardBody>
      </Card>
      <Card>
        <CardHeader title={t("runDashboard.figMetricsTitle")} description={t("runDashboard.figMetricsNote")} />
        <CardBody><MetricTable metrics={metrics} /></CardBody>
      </Card>
    </div>
  );
}

function TradeTable({ rows }: { rows: Array<Record<string, string>> }) {
  const { t } = useTranslation();
  if (!rows.length) return <EmptyData text={t("runDashboard.noTrades")} />;
  return (
    <Table wrapperClassName="max-h-[440px] overflow-auto" className="min-w-[760px]">
      <THead className="sticky top-0"><TR>
        <TH>{t("runDashboard.colTime")}</TH><TH>{t("runDashboard.colSymbol")}</TH><TH>{t("runDashboard.colSide")}</TH>
        <TH numeric>{t("runDashboard.colPrice")}</TH><TH numeric>{t("runDashboard.colQty")}</TH><TH numeric>{t("runDashboard.colPnl")}</TH><TH>{t("runDashboard.colReason")}</TH>
      </TR></THead>
      <TBody>{rows.map((row, index) => {
        const pnl = num(row.pnl) || 0;
        return (
          <TR key={`${row.timestamp}-${row.code}-${index}`}>
            <TD className="tabular-nums">{row.timestamp || "-"}</TD>
            <TD>{row.code || "-"}</TD>
            <TD>{row.side || "-"}</TD>
            <TD numeric>{fixed(row.price, 4)}</TD>
            <TD numeric>{fixed(row.qty, 4)}</TD>
            <TD numeric className={pnl > 0 ? "font-semibold text-success" : pnl < 0 ? "font-semibold text-danger" : "text-muted-foreground"}>{fixed(pnl)}</TD>
            <TD className="text-muted-foreground">{row.reason || "-"}</TD>
          </TR>
        );
      })}</TBody>
    </Table>
  );
}

function MetricTable({ metrics }: { metrics: Record<string, number> }) {
  return (
    <Table>
      <TBody>{Object.entries(metrics).map(([key, value]) => (
        <TR key={key}><TD className="w-1/2 bg-muted/40 text-muted-foreground">{key}</TD><TD numeric>{fixed(value, 4)}</TD></TR>
      ))}</TBody>
    </Table>
  );
}

function EmptyData({ text }: { text: string }) {
  return <div className="rounded-lg border border-dashed border-border p-6 text-center text-xs text-muted-foreground">{text}</div>;
}
