// T10: color scales. chartTokens helpers (token parsing, mixing, contrast),
// the CorrelationMatrix diverging scale and the VolatilitySurfaceGrid
// single-hue sequential scale with legend. Offline: api and echarts mocked.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";

const captured = vi.hoisted(() => ({ option: null as any }));
vi.mock("@/hooks/useChartLifecycle", () => ({
  useChartLifecycle: (_ref: unknown, build: () => unknown) => { captured.option = build(); },
}));
vi.mock("@/lib/api", () => ({ api: { computeVolatilitySurface: vi.fn() } }));

import { api } from "@/lib/api";
import { contrastText, luminance, mixRgb, rgbCss, tokenRgb, type RGB } from "@/components/charts/chartTokens";
import { CorrelationMatrix } from "@/components/charts/CorrelationMatrix";
import { VolatilitySurfaceGrid } from "@/components/options/VolatilitySurfaceGrid";
import type { VolatilitySurfaceResponse } from "@/lib/options";

const root = document.documentElement;
function setTokens(tokens: Record<string, string>) {
  for (const [k, v] of Object.entries(tokens)) root.style.setProperty(k, v);
}
afterEach(() => {
  cleanup();
  root.removeAttribute("style");
  captured.option = null;
});

describe("chartTokens helpers", () => {
  it("tokenRgb parses an 'H S% L%' token", () => {
    setTokens({ "--primary": "0 100% 50%" });
    expect(tokenRgb("--primary", [1, 2, 3])).toEqual([255, 0, 0]);
  });

  it("tokenRgb parses a token with an alpha suffix ('H S% L% / a')", () => {
    setTokens({ "--primary": "120 100% 50% / 0.5" });
    expect(tokenRgb("--primary", [1, 2, 3])).toEqual([0, 255, 0]);
  });

  it("tokenRgb falls back when the token is missing or malformed", () => {
    expect(tokenRgb("--does-not-exist", [9, 8, 7])).toEqual([9, 8, 7]);
    setTokens({ "--weird": "not-a-color" });
    expect(tokenRgb("--weird", [1, 1, 1])).toEqual([1, 1, 1]);
  });

  it("tokenRgb handles black, white and grey extremes", () => {
    setTokens({ "--a": "0 0% 0%", "--b": "0 0% 100%", "--c": "210 0% 50%" });
    expect(tokenRgb("--a", [5, 5, 5])).toEqual([0, 0, 0]);
    expect(tokenRgb("--b", [5, 5, 5])).toEqual([255, 255, 255]);
    expect(tokenRgb("--c", [5, 5, 5])).toEqual([128, 128, 128]);
  });

  it("rgbCss emits rgb() at alpha 1 and rgba() otherwise", () => {
    expect(rgbCss([1, 2, 3])).toBe("rgb(1,2,3)");
    expect(rgbCss([1, 2, 3], 0.1)).toBe("rgba(1,2,3,0.1)");
    expect(rgbCss([1, 2, 3], 0)).toBe("rgba(1,2,3,0)");
  });

  it("mixRgb returns the endpoints at t=0 and t=1 and rounds midpoints", () => {
    const a: RGB = [0, 100, 255];
    const b: RGB = [255, 0, 0];
    expect(mixRgb(a, b, 0)).toEqual(a);
    expect(mixRgb(a, b, 1)).toEqual(b);
    expect(mixRgb(a, b, 0.5)).toEqual([128, 50, 128]);
  });

  it("luminance is 0 for black, 1 for white and monotonic in grey", () => {
    expect(luminance([0, 0, 0])).toBe(0);
    expect(luminance([255, 255, 255])).toBeCloseTo(1, 6);
    expect(luminance([100, 100, 100])).toBeLessThan(luminance([200, 200, 200]));
  });

  it("contrastText picks dark text on light cells and white text on dark cells", () => {
    expect(contrastText([255, 255, 255])).toBe("#111111");
    expect(contrastText([237, 239, 242])).toBe("#111111");
    expect(contrastText([0, 0, 0])).toBe("#ffffff");
    expect(contrastText([21, 85, 224])).toBe("#ffffff");
    expect(contrastText([197, 32, 32])).toBe("#ffffff");
  });
});

describe("CorrelationMatrix diverging scale", () => {
  const TOKENS = { "--danger": "0 100% 40%", "--muted": "0 0% 95%", "--primary": "220 100% 40%" };
  const DANGER = "rgb(204,0,0)";
  const MUTED = "rgb(242,242,242)";
  const PRIMARY = "rgb(0,68,204)";

  it("visualMap runs danger at -1, muted at 0, primary at +1 from CSS tokens", () => {
    setTokens(TOKENS);
    render(<CorrelationMatrix labels={["A", "B"]} matrix={[[1, -1], [-1, 1]]} />);
    const vm = captured.option.visualMap;
    expect(vm.min).toBe(-1);
    expect(vm.max).toBe(1);
    expect(vm.inRange.color).toEqual([DANGER, MUTED, PRIMARY]);
    expect(vm.textStyle.fontSize).toBe(12);
  });

  it("falls back to built-in token defaults when CSS variables are absent", () => {
    render(<CorrelationMatrix labels={["A"]} matrix={[[1]]} />);
    expect(captured.option.visualMap.inRange.color).toEqual(["rgb(197,32,32)", "rgb(237,239,242)", "rgb(21,85,224)"]);
  });

  it("cell label color is contrast-aware: dark on near-zero cells, white on saturated cells", () => {
    setTokens(TOKENS);
    render(<CorrelationMatrix labels={["A", "B", "C"]} matrix={[[1, 0, -1], [0, 1, 0.05], [-1, 0.05, 1]]} />);
    const data = captured.option.series[0].data as { value: [number, number, number]; label: { color: string } }[];
    const at = (x: number, y: number) => data.find((d) => d.value[0] === x && d.value[1] === y)!;
    expect(at(1, 0).label.color).toBe("#111111"); // r = 0 on muted
    expect(at(2, 1).label.color).toBe("#111111"); // r = 0.05 still light
    expect(at(0, 0).label.color).toBe("#ffffff"); // r = +1 on primary
    expect(at(2, 0).label.color).toBe("#ffffff"); // r = -1 on danger
  });

  it("clamps out-of-range coefficients for coloring but keeps the true value", () => {
    setTokens(TOKENS);
    render(<CorrelationMatrix labels={["A", "B"]} matrix={[[1.5, -3], [-3, 1]]} />);
    const data = captured.option.series[0].data;
    expect(data[0].value[2]).toBe(1.5);
    expect(data[0].label.color).toBe("#ffffff");
    expect(data[1].value[2]).toBe(-3);
    expect(data[1].label.color).toBe("#ffffff");
  });

  it("rounds values to 4 decimals and formats labels to 2 decimals", () => {
    render(<CorrelationMatrix labels={["A", "B"]} matrix={[[1, 0.123456], [0.123456, 1]]} />);
    const series = captured.option.series[0];
    expect(series.data[1].value[2]).toBe(0.1235);
    expect(series.label.formatter({ value: series.data[1].value })).toBe("0.12");
    expect(series.label.fontSize).toBe(12);
  });

  it("shows in-cell labels up to 8 assets and hides them above 8", () => {
    const make = (n: number) => {
      const labels = Array.from({ length: n }, (_, i) => `S${i}`);
      const matrix = labels.map((_, i) => labels.map((__, j) => (i === j ? 1 : 0.2)));
      return { labels, matrix };
    };
    render(<CorrelationMatrix {...make(8)} />);
    expect(captured.option.series[0].label.show).toBe(true);
    cleanup();
    render(<CorrelationMatrix {...make(9)} />);
    expect(captured.option.series[0].label.show).toBe(false);
    expect(captured.option.series[0].data).toHaveLength(81);
  });

  it("missing rows (ragged matrix) render as muted unknown cells, not zero", () => {
    render(<CorrelationMatrix labels={["A", "B"]} matrix={[[1, 0.4]]} />);
    const data = captured.option.series[0].data;
    const missing = data.filter((d: any) => d.value[1] === 1);
    expect(missing).toHaveLength(2);
    for (const cell of missing) {
      expect(cell.itemStyle.opacity).toBeLessThan(1);
      expect(captured.option.series[0].label.formatter({ value: cell.value })).toBe("-");
    }
  });

  it("does not draw an in-canvas title and uses a borderless-glow tooltip", () => {
    render(<CorrelationMatrix labels={["A"]} matrix={[[1]]} />);
    expect(captured.option.title).toBeUndefined();
    expect(captured.option.tooltip.borderWidth).toBe(1);
    expect(captured.option.tooltip.extraCssText).toMatch(/box-shadow:\s*none/);
  });

  it("empty labels render the empty message instead of a chart canvas", () => {
    const { container } = render(<CorrelationMatrix labels={[]} matrix={[]} />);
    expect(container.textContent?.trim().length).toBeGreaterThan(0);
    expect(container.querySelector("[style*='height']")).toBeNull();
  });

  it("escapes HTML in tooltip asset names", () => {
    render(<CorrelationMatrix labels={["<img src=x>", "B"]} matrix={[[1, 0.2], [0.2, 1]]} />);
    const html = captured.option.tooltip.formatter({ data: { value: [0, 1, 0.2] } });
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });
});

describe("VolatilitySurfaceGrid sequential single-hue scale", () => {
  const response = (ivs: number[]): VolatilitySurfaceResponse => ({
    strikes: ivs.map((_, i) => 90 + i * 10),
    expiries: [0.1],
    interpolation: { strike: "linear_iv_log_moneyness", expiry: "linear_total_variance", extrapolation: "rejected" },
    points: ivs.map((iv, i) => ({
      strike: 90 + i * 10, time_to_expiry: 0.1, implied_volatility: iv, total_variance: iv * iv * 0.1,
      source: i % 2 ? "interpolated" : "observed",
    })),
  });

  beforeEach(() => vi.mocked(api.computeVolatilitySurface).mockReset());

  async function computeWith(ivs: number[]) {
    vi.mocked(api.computeVolatilitySurface).mockResolvedValue(response(ivs));
    render(<VolatilitySurfaceGrid />);
    fireEvent.click(screen.getByRole("button", { name: "Compute surface" }));
    await screen.findByRole("table");
  }

  const cellFor = (text: string) => within(screen.getByRole("table")).getByText(text).closest("td") as HTMLTableCellElement;
  const alphaOf = (el: HTMLElement) => {
    const m = /hsl\(var\(--primary\) \/ ([\d.]+)\)/.exec(el.getAttribute("style") ?? "");
    expect(m, el.getAttribute("style") ?? "").not.toBeNull();
    return Number(m![1]);
  };

  it("every cell uses the primary hue only, light (0.1) for the lowest IV to dark (0.82) for the highest", async () => {
    await computeWith([0.2, 0.3, 0.4]);
    const low = cellFor("20.00%");
    const mid = cellFor("30.00%");
    const high = cellFor("40.00%");
    for (const cell of [low, mid, high]) expect(cell.getAttribute("style")).not.toMatch(/--(danger|success|warning|info)/);
    expect(alphaOf(low)).toBeCloseTo(0.1, 3);
    expect(alphaOf(mid)).toBeCloseTo(0.46, 3);
    expect(alphaOf(high)).toBeCloseTo(0.82, 3);
    expect(alphaOf(low)).toBeLessThan(alphaOf(mid));
    expect(alphaOf(mid)).toBeLessThan(alphaOf(high));
  });

  it("switches to primary-foreground text only on dark cells (ratio > 0.62)", async () => {
    await computeWith([0.2, 0.3, 0.4]);
    expect(cellFor("40.00%").getAttribute("style")).toMatch(/primary-foreground/);
    expect(cellFor("20.00%").getAttribute("style")).not.toMatch(/primary-foreground/);
    expect(cellFor("30.00%").getAttribute("style")).not.toMatch(/primary-foreground/);
  });

  it("a flat surface (all IV equal) uses the mid tone and does not divide by zero", async () => {
    await computeWith([0.25, 0.25]);
    const cells = within(screen.getByRole("table")).getAllByText("25.00%").map((n) => n.closest("td") as HTMLElement);
    expect(cells).toHaveLength(2);
    for (const cell of cells) expect(alphaOf(cell)).toBeCloseTo(0.46, 3);
  });

  it("renders a legend from min to max IV with five monotonic primary swatches", async () => {
    await computeWith([0.15, 0.5, 0.35]);
    const legend = screen.getByLabelText("Implied volatility scale");
    expect(within(legend).getByText("15.00%")).toBeInTheDocument();
    expect(within(legend).getByText("50.00%")).toBeInTheDocument();
    const swatches = Array.from(legend.querySelectorAll<HTMLElement>("[aria-hidden='true'] > span"));
    expect(swatches).toHaveLength(5);
    const alphas = swatches.map(alphaOf);
    expect(alphas[0]).toBeCloseTo(0.1, 3);
    expect(alphas[4]).toBeCloseTo(0.82, 3);
    for (let i = 1; i < alphas.length; i++) expect(alphas[i]).toBeGreaterThan(alphas[i - 1]);
  });

  it("missing grid points render N/A instead of a colored cell", async () => {
    const r = response([0.2, 0.3]);
    r.points = r.points.slice(0, 1);
    vi.mocked(api.computeVolatilitySurface).mockResolvedValue(r);
    render(<VolatilitySurfaceGrid />);
    fireEvent.click(screen.getByRole("button", { name: "Compute surface" }));
    expect(await screen.findByText("N/A")).toBeInTheDocument();
    expect(screen.getByText("N/A").getAttribute("style")).toBeNull();
  });

  it("observed points are outlined with a primary ring, interpolated points are not", async () => {
    await computeWith([0.2, 0.3]);
    expect(cellFor("20.00%").className).toMatch(/ring-primary/);
    expect(cellFor("30.00%").className).not.toMatch(/ring-primary/);
  });

  it("no legend and no table before a computation (empty state text shown)", () => {
    render(<VolatilitySurfaceGrid />);
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Implied volatility scale")).not.toBeInTheDocument();
  });

  it("the wide grid scrolls inside its own overflow wrapper (390px safe)", async () => {
    await computeWith([0.2, 0.3, 0.4]);
    expect(screen.getByRole("table").parentElement!.className).toMatch(/overflow-x-auto/);
  });
});
