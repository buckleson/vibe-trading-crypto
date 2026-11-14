// T10: runtime audit of every ECharts option built by components/charts/**.
// echarts.init is replaced with a fake that records setOption, so nothing is
// drawn and no network is touched. Each chart is rendered with small synthetic
// fixtures and the captured option is checked against the BRIEF chart rules:
// no gradient fills, no in-canvas titles, tooltips with a 1px border and no
// glow, 11 to 12px axis labels, legends top-left at 12px, solid translucent
// area fills, and colors taken from the chart theme.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import type { Mock } from "vitest";
import type { ReactElement } from "react";

vi.mock("@/lib/echarts", () => ({
  echarts: { init: vi.fn(), connect: vi.fn() },
  CHART_GROUP: "quant-charts",
  connectCharts: vi.fn(),
}));

import { echarts } from "@/lib/echarts";
import { getChartTheme, SERIES_DARK, SERIES_LIGHT } from "@/lib/chart-theme";
import { getPnlColors } from "@/lib/pnl-colors";
import { AnnualReturnsChart } from "@/components/charts/AnnualReturnsChart";
import { AttributionCumulativeChart } from "@/components/charts/AttributionCumulativeChart";
import { AttributionWaterfallChart } from "@/components/charts/AttributionWaterfallChart";
import { CandlestickChart } from "@/components/charts/CandlestickChart";
import { CorrelationMatrix } from "@/components/charts/CorrelationMatrix";
import { DistributionChart } from "@/components/charts/DistributionChart";
import { EquityChart } from "@/components/charts/EquityChart";
import { MiniEquityChart } from "@/components/charts/MiniEquityChart";
import { MonteCarloPathsChart } from "@/components/charts/MonteCarloPathsChart";
import { MonthlyReturnsHeatmap } from "@/components/charts/MonthlyReturnsHeatmap";
import { OptionsPayoffChart } from "@/components/charts/OptionsPayoffChart";
import { OptionsScenarioMatrix } from "@/components/charts/OptionsScenarioMatrix";
import { RegimeTimeline } from "@/components/charts/RegimeTimeline";
import { RollingBetaAlphaChart } from "@/components/charts/RollingBetaAlphaChart";
import { WalkForwardChart } from "@/components/charts/WalkForwardChart";

interface FakeChart { setOption: Mock; resize: Mock; dispose: Mock; on: Mock; off: Mock; getZr: Mock; dispatchAction: Mock; group: string }
const charts: FakeChart[] = [];

beforeEach(() => {
  charts.length = 0;
  document.documentElement.className = "";
  document.documentElement.lang = "en";
  vi.mocked(echarts.init).mockImplementation((() => {
    const chart: FakeChart = {
      setOption: vi.fn(), resize: vi.fn(), dispose: vi.fn(), on: vi.fn(), off: vi.fn(),
      getZr: vi.fn(() => ({ on: vi.fn(), off: vi.fn() })), dispatchAction: vi.fn(), group: "",
    };
    charts.push(chart);
    return chart;
  }) as unknown as typeof echarts.init);
});
afterEach(() => cleanup());

type Opt = Record<string, any>;

function optionsOf(el: ReactElement): Opt[] {
  render(el);
  return charts.flatMap((c) => c.setOption.mock.calls.map((call) => call[0] as Opt));
}

const lastOption = (el: ReactElement): Opt => {
  const all = optionsOf(el);
  expect(all.length).toBeGreaterThan(0);
  return all[all.length - 1];
};

/** Walk any JSON-ish value, yielding [path, key, value]. Functions are skipped. */
function* walk(v: unknown, path = "$"): Generator<[string, string, unknown]> {
  if (v === null || typeof v !== "object") return;
  for (const [k, child] of Object.entries(v as Record<string, unknown>)) {
    const p = `${path}.${k}`;
    yield [p, k, child];
    if (typeof child === "object" && child !== null) yield* walk(child, p);
  }
}

const asArray = <T,>(v: T | T[] | undefined): T[] => (v === undefined ? [] : Array.isArray(v) ? v : [v]);

function hexAlpha(color: string): number | null {
  const m8 = /^#[0-9a-f]{6}([0-9a-f]{2})$/i.exec(color);
  if (m8) return parseInt(m8[1], 16) / 255;
  const rgba = /^rgba\([^)]*,\s*([\d.]+)\)$/i.exec(color);
  if (rgba) return parseFloat(rgba[1]);
  return null;
}

// --- synthetic fixtures -----------------------------------------------------
const dates = ["2024-01-01", "2024-01-02", "2024-01-03", "2024-01-04"];
const bars = dates.map((time, i) => ({ time, open: 100 + i, high: 103 + i, low: 98 + i, close: 101 + i, volume: 1000 + i }));
const equity = dates.map((time, i) => ({ time, equity: 10000 + i * 50, drawdown: -i * 0.5 }));
const mc = {
  steps: [0, 1, 2], initial_capital: 1000, actual: [1000, 1010, 1020],
  band_p5: [1000, 980, 970], band_p25: [1000, 995, 990], band_p50: [1000, 1005, 1010],
  band_p75: [1000, 1015, 1030], band_p95: [1000, 1030, 1050], samples: [[1000, 1001, 1002], [1000, 999, 998]],
};
const brinson = { mode: "symbol" as const, portfolio_return: 0.1, benchmark_return: 0.07, active_return: 0.03, allocation: 0.01, selection: 0.015, interaction: 0.005, sectors: [] };
const regime = {
  labels: ["BTC", "ETH"], dates, density: [0.2, 0.4, null, 0.6], smoothed: [0.2, 0.3, 0.4, 0.5], fused: [0, 1, 1, 0],
  episodes: [{ start: "2024-01-02", end: null }],
  params: { days: 90, corr_window: 20, edge_threshold: 0.5, smooth_window: 5, enter_threshold: 0.6, exit_threshold: 0.4 },
};
const windows = [1, 2, 3].map((w) => ({ window: w, start: dates[0], end: dates[3], return: w % 2 ? 0.05 : -0.02, sharpe: 1.1, max_dd: -0.1, trades: 5, win_rate: 0.5 }));

const CASES: [string, () => ReactElement][] = [
  ["AnnualReturnsChart", () => <AnnualReturnsChart data={[{ year: 2023, ret: 0.12 }, { year: 2024, ret: -0.04 }]} />],
  ["AttributionCumulativeChart", () => <AttributionCumulativeChart data={dates.map((date, i) => ({ date, portfolio: i * 0.01, benchmark: i * 0.008, active: i * 0.002 }))} />],
  ["AttributionWaterfallChart", () => <AttributionWaterfallChart brinson={brinson} />],
  ["CandlestickChart", () => <CandlestickChart data={bars} markers={[{ time: dates[1], side: "BUY", price: 101 }, { time: dates[2], side: "SELL", price: 103 }]} />],
  ["CorrelationMatrix", () => <CorrelationMatrix labels={["A", "B"]} matrix={[[1, 0.3], [0.3, 1]]} />],
  ["DistributionChart", () => <DistributionChart samples={[0.1, 0.4, 0.5, 0.9, 1.2, 1.3]} markerValue={0.8} markerLabel="Actual" bandFrom={0.2} bandTo={1.1} bandLabel="P5-P95" />],
  ["EquityChart", () => <EquityChart data={equity} drawdownZones={[{ startTime: dates[1], endTime: dates[2], rank: 1 }]} />],
  ["MiniEquityChart", () => <MiniEquityChart data={equity} />],
  ["MonteCarloPathsChart", () => <MonteCarloPathsChart paths={mc} />],
  ["MonthlyReturnsHeatmap", () => <MonthlyReturnsHeatmap data={[{ year: 2024, month: 1, ret: 0.02 }, { year: 2024, month: 2, ret: -0.01 }, { year: 2024, month: 3, ret: null }]} annual={[{ year: 2024, ret: 0.01 }]} />],
  ["OptionsPayoffChart", () => <OptionsPayoffChart curve={{ spot: [80, 90, 100, 110, 120], pnl: [-120, -60, 40, 140, 240] }} entrySpot={100} breakevens={[96]} />],
  ["OptionsScenarioMatrix", () => <OptionsScenarioMatrix grid={{ iv_values: [0.2, 0.3], spot: [90, 100, 110], pnl: [[-5, 0, 5], [-3, 1, 7]] }} />],
  ["RegimeTimeline", () => <RegimeTimeline data={regime} />],
  ["RollingBetaAlphaChart", () => <RollingBetaAlphaChart data={dates.map((date, i) => ({ date, beta: 0.2 + i * 0.1, alpha_annualized: -0.04 + i * 0.01 }))} />],
  ["WalkForwardChart", () => <WalkForwardChart windows={windows} />],
];

describe("T10 chart option rules (every chart in components/charts)", () => {
  it.each(CASES)("%s builds at least one option", (_name, make) => {
    expect(optionsOf(make()).length).toBeGreaterThan(0);
  });

  it.each(CASES)("%s has no gradient fills (LinearGradient / RadialGradient / colorStops)", (_name, make) => {
    for (const option of optionsOf(make())) {
      for (const [path, key, value] of walk(option)) {
        expect(key, path).not.toBe("colorStops");
        if (value && typeof value === "object" && !Array.isArray(value)) {
          expect(["linear", "radial"], `${path} is a gradient object`).not.toContain((value as Opt).type);
        }
        if (typeof value === "string") expect(value, path).not.toMatch(/gradient\(/i);
      }
    }
  });

  it.each(CASES)("%s draws no in-canvas title", (_name, make) => {
    for (const option of optionsOf(make())) {
      const titles = asArray(option.title as Opt | Opt[] | undefined);
      for (const title of titles) {
        // An empty or hidden title component is allowed; visible text is not.
        expect(title.show === false || !title.text, JSON.stringify(title)).toBe(true);
      }
    }
  });

  it.each(CASES)("%s tooltip, when present, uses theme popover colors with a 1px border and no glow", (_name, make) => {
    const t = getChartTheme();
    for (const option of optionsOf(make())) {
      if (!option.tooltip || option.tooltip.show === false) continue;
      const tip = option.tooltip as Opt;
      expect(tip.backgroundColor).toBe(t.tooltipBg);
      expect(tip.borderColor).toBe(t.tooltipBorder);
      expect(tip.borderWidth).toBe(1);
      expect(String(tip.extraCssText ?? "")).toMatch(/box-shadow:\s*none/);
      expect(String(tip.extraCssText ?? "")).not.toMatch(/box-shadow:\s*[^n]/);
      if (tip.textStyle?.fontSize !== undefined) expect(tip.textStyle.fontSize).toBe(12);
    }
  });

  it.each(CASES)("%s visible axis labels are 11 to 12px in the theme text color", (_name, make) => {
    const t = getChartTheme();
    for (const option of optionsOf(make())) {
      for (const axis of [...asArray(option.xAxis as Opt | Opt[]), ...asArray(option.yAxis as Opt | Opt[])]) {
        if (axis.show === false || axis.axisLabel?.show === false || !axis.axisLabel) continue;
        expect(axis.axisLabel.fontSize, JSON.stringify(axis.axisLabel)).toBeGreaterThanOrEqual(11);
        expect(axis.axisLabel.fontSize).toBeLessThanOrEqual(12);
        if (axis.axisLabel.color !== undefined) expect(axis.axisLabel.color).toBe(t.textColor);
      }
    }
  });

  it.each(CASES)("%s split lines use the theme grid color", (_name, make) => {
    const t = getChartTheme();
    for (const option of optionsOf(make())) {
      for (const axis of [...asArray(option.xAxis as Opt | Opt[]), ...asArray(option.yAxis as Opt | Opt[])]) {
        const color = axis.splitLine?.lineStyle?.color;
        if (axis.splitLine?.show === false || color === undefined) continue;
        expect(color).toBe(t.gridColor);
      }
    }
  });

  it.each(CASES)("%s legend, when shown, sits top-left with 12px text", (_name, make) => {
    for (const option of optionsOf(make())) {
      for (const legend of asArray(option.legend as Opt | Opt[] | undefined)) {
        if (legend.show === false) continue;
        expect([0, "0", "left", "0%", 8, 4], `left=${legend.left}`).toContain(legend.left ?? "left");
        expect([0, "0", "top", "0%", 4, 8], `top=${legend.top}`).toContain(legend.top ?? "top");
        expect(legend.textStyle?.fontSize).toBe(12);
      }
    }
  });

  it.each(CASES)("%s area fills are solid translucent colors (alpha 0.08 to 0.125, envelopes up to 0.2)", (_name, make) => {
    for (const option of optionsOf(make())) {
      for (const series of asArray(option.series as Opt | Opt[])) {
        if (!series.areaStyle) continue;
        const color = series.areaStyle.color;
        expect(typeof color, `${series.name} area color must be a string, not a gradient object`).toBe("string");
        const alpha = hexAlpha(color);
        expect(alpha, `${series.name} area color ${color} needs an explicit alpha`).not.toBeNull();
        // Stacked percentile envelopes (Monte Carlo P25-P75) may go up to 0.2.
        const max = series.stack ? 0.2 : 0.125;
        expect(alpha!).toBeGreaterThanOrEqual(0.08);
        expect(alpha!).toBeLessThanOrEqual(max + 1e-9);
      }
    }
  });
});

describe("T10 chart colors come from the theme", () => {
  it("chart theme exposes a 6-color series palette for light and dark and switches with the class", () => {
    expect(SERIES_LIGHT).toHaveLength(6);
    expect(SERIES_DARK).toHaveLength(6);
    expect(getChartTheme().seriesPalette).toEqual(SERIES_LIGHT);
    document.documentElement.className = "dark";
    expect(getChartTheme().seriesPalette).toEqual(SERIES_DARK);
  });

  it("EquityChart draws equity in seriesPalette[0] and the drawdown fill from the down color", () => {
    const t = getChartTheme();
    const series = lastOption(<EquityChart data={equity} />).series as Opt[];
    const colors = JSON.stringify(series);
    expect(colors).toContain(t.seriesPalette[0]);
    expect(series.some((s) => s.areaStyle?.color === t.downColor + "1A")).toBe(true);
  });

  it("MiniEquityChart uses the up color for a rising curve and down color for a falling one", () => {
    const t = getChartTheme();
    const up = lastOption(<MiniEquityChart data={equity} />).series[0];
    expect(up.lineStyle.color).toBe(t.upColor);
    cleanup(); charts.length = 0;
    const falling = equity.map((p, i) => ({ ...p, equity: 10000 - i * 50 }));
    const down = lastOption(<MiniEquityChart data={falling} />).series[0];
    expect(down.lineStyle.color).toBe(t.downColor);
  });

  it("MiniEquityChart edge case: fewer than 2 points builds no chart", () => {
    expect(optionsOf(<MiniEquityChart data={[equity[0]]} />)).toHaveLength(0);
  });

  it("OptionsPayoffChart keeps P&L green/red semantics from pnl-colors even under zh locale", () => {
    document.documentElement.lang = "zh-CN";
    const pnl = getPnlColors();
    const option = lastOption(<OptionsPayoffChart curve={{ spot: [80, 100, 120], pnl: [-50, 0, 50] }} entrySpot={100} breakevens={[100]} />);
    const text = JSON.stringify(option.series);
    expect(text).toContain(pnl.profit);
    expect(text).toContain(pnl.loss);
  });

  it("CandlestickChart follows the locale-aware up/down convention (en: green up, zh: red up)", () => {
    const en = getChartTheme();
    const enOpt = lastOption(<CandlestickChart data={bars} />);
    const enK = (enOpt.series as Opt[]).find((s) => s.type === "candlestick")!;
    expect(enK.itemStyle.color).toBe(en.upColor);
    expect(enK.itemStyle.color0).toBe(en.downColor);

    cleanup(); charts.length = 0;
    document.documentElement.lang = "zh-CN";
    const zh = getChartTheme();
    expect(zh.upColor).toBe(en.downColor);
    expect(zh.downColor).toBe(en.upColor);
    const zhK = (lastOption(<CandlestickChart data={bars} />).series as Opt[]).find((s) => s.type === "candlestick")!;
    expect(zhK.itemStyle.color).toBe(zh.upColor);
  });

  it("no chart option contains a hard-coded hex that is not a theme, palette or pnl color", () => {
    const t = getChartTheme();
    const pnl = getPnlColors();
    const allowed = new Set<string>(
      [
        ...t.seriesPalette, ...t.maColors, t.gridColor, t.textColor, t.axisColor, t.upColor, t.downColor,
        t.bollColor, t.volumeUp, t.volumeDown, t.infoColor, t.warningColor, t.tooltipBorder, t.tooltipText,
        pnl.profit, pnl.loss, pnl.neutral, "#111111", "#ffffff",
      ].map((c) => c.toLowerCase().slice(0, 7)),
    );
    for (const [name, make] of CASES) {
      cleanup(); charts.length = 0;
      for (const option of optionsOf(make())) {
        for (const [path, , value] of walk(option)) {
          if (typeof value !== "string") continue;
          for (const hex of value.match(/#[0-9a-f]{6}(?:[0-9a-f]{2})?\b/gi) ?? []) {
            expect(allowed.has(hex.toLowerCase().slice(0, 7)), `${name} ${path} uses ${hex}`).toBe(true);
          }
        }
      }
    }
  });
});

describe("T10 chart edge cases (empty inputs never crash)", () => {
  const EMPTY: [string, () => ReactElement][] = [
    ["AnnualReturnsChart", () => <AnnualReturnsChart data={[]} />],
    ["AttributionCumulativeChart", () => <AttributionCumulativeChart data={[]} />],
    ["CandlestickChart", () => <CandlestickChart data={[]} />],
    ["CorrelationMatrix", () => <CorrelationMatrix labels={[]} matrix={[]} />],
    ["DistributionChart", () => <DistributionChart samples={[]} markerValue={0} markerLabel="x" />],
    ["EquityChart", () => <EquityChart data={[]} />],
    ["MiniEquityChart", () => <MiniEquityChart data={[]} />],
    ["MonthlyReturnsHeatmap", () => <MonthlyReturnsHeatmap data={[]} annual={[]} />],
    ["RegimeTimeline", () => <RegimeTimeline data={{ ...regime, dates: [], density: [], smoothed: [], fused: [], episodes: [] }} />],
    ["RollingBetaAlphaChart", () => <RollingBetaAlphaChart data={[]} />],
    ["WalkForwardChart", () => <WalkForwardChart windows={[]} />],
  ];
  it.each(EMPTY)("%s renders with empty data", (_name, make) => {
    expect(() => render(make())).not.toThrow();
  });

  it("CorrelationMatrix with no labels shows the empty message instead of a canvas", () => {
    const { container } = render(<CorrelationMatrix labels={[]} matrix={[]} />);
    expect(container.textContent).toMatch(/\S/);
    expect(charts).toHaveLength(0);
  });

  it("charts dispose their echarts instance on unmount", () => {
    const { unmount } = render(<AnnualReturnsChart data={[{ year: 2024, ret: 0.1 }]} />);
    expect(charts.length).toBeGreaterThan(0);
    unmount();
    for (const chart of charts) expect(chart.dispose).toHaveBeenCalled();
  });
});
