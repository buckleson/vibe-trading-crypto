// T05: Paper trading page. Tabs, strategy run list, run detail, auto refresh,
// start dialog, ?from_run handling and slop checks. All APIs are mocked.
import fs from "node:fs";
import path from "node:path";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PaperTrading } from "@/pages/PaperTrading";
import { paperRunsApi, type PaperRun, type PaperRunDetail, type PaperRunTrade } from "@/lib/paperRuns";
import { api, paperApi } from "@/lib/api";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      let s = (opts?.defaultValue as string | undefined) ?? key;
      for (const [k, v] of Object.entries(opts ?? {})) s = s.replace(`{{${k}}}`, String(v));
      return s;
    },
  }),
}));
const chartProps = vi.fn();
vi.mock("@/components/charts/EquityChart", () => ({
  EquityChart: (p: unknown) => {
    chartProps(p);
    return <div data-testid="equity-chart" />;
  },
}));
vi.mock("@/lib/api", () => ({
  api: { listRuns: vi.fn() },
  paperApi: { list: vi.fn(), create: vi.fn(), advance: vi.fn(), history: vi.fn() },
}));
vi.mock("@/lib/paperRuns", async (orig) => ({
  ...(await orig<typeof import("@/lib/paperRuns")>()),
  paperRunsApi: { list: vi.fn(), create: vi.fn(), get: vi.fn(), refresh: vi.fn(), stop: vi.fn(), remove: vi.fn() },
}));

const P = vi.mocked(paperRunsApi);
const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();
const summary = (over: Partial<NonNullable<PaperRun["summary"]>> = {}) => ({
  equity: 11000, pnl: 1000, total_return: 0.1, max_drawdown: -0.025, sharpe: 1.234, trade_count: 3, bars: 5, as_of: "x", ...over,
});
const mkRun = (over: Partial<PaperRun> = {}): PaperRun => ({
  id: "p1", label: "BTC paper", source_run_id: "r1", codes: ["BTC-USDT"], source: "okx", interval: "4H",
  initial_cash: 10000, started_at: "2026-01-01T10:00:00+00:00", evaluation_start: "2026-01-01T12:00:00",
  warmup_start: "2025-07-01", status: "active", stopped_at: null, last_refreshed_at: iso(1000), state: "ok",
  last_error: null, summary: summary(), ...over,
});
const trade = (i: number, over: Partial<PaperRunTrade> = {}): PaperRunTrade => ({
  time: `2026-01-02 ${String(i).padStart(2, "0")}:00:00`, symbol: "BTC-USDT", side: i % 2 ? "sell" : "buy",
  price: 100 + i, qty: 0.5, pnl: i % 2 ? 10 : null, return_pct: i % 2 ? 0.02 : null, event: i % 2 ? "exit" : "entry",
  reason: null, ...over,
});
const mkDetail = (run: PaperRun, over: Partial<PaperRunDetail> = {}): PaperRunDetail => ({
  run,
  equity: [{ time: "a", equity: 10000, drawdown: 0 }, { time: "b", equity: 11000, drawdown: 0 }],
  trades: [trade(1)],
  positions: [{ symbol: "BTC-USDT", weight: 0.5 }],
  ...over,
});

const Loc = () => <div data-testid="loc">{useLocation().search}</div>;
const renderAt = (url = "/paper-trading") =>
  render(<MemoryRouter initialEntries={[url]}><PaperTrading /><Loc /></MemoryRouter>);
const loc = () => screen.getByTestId("loc").textContent ?? "";
const statValue = (label: string) =>
  screen.getByText(label, { selector: "div.text-xs" }).nextElementSibling as HTMLElement;
const list = () => screen.getByRole("list", { name: "Paper runs" });

let visibility: DocumentVisibilityState = "visible";
beforeEach(() => {
  vi.clearAllMocks();
  visibility = "visible";
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibility });
  P.list.mockResolvedValue([]);
  vi.mocked(api.listRuns).mockResolvedValue([
    { run_id: "r1", status: "success", created_at: "", total_return: 0.25, codes: ["BTC-USDT", "ETH-USDT"] },
    { run_id: "r2", status: "failed", created_at: "" },
    { run_id: "r3", status: "failed", created_at: "", total_return: -0.1, codes: ["AAPL.US"] },
  ] as never);
  vi.mocked(paperApi.list).mockResolvedValue([]);
  vi.mocked(paperApi.history).mockResolvedValue([]);
});
afterEach(() => {
  vi.useRealTimers();
});

// ── page shell and tabs ─────────────────────────────────────────────

describe("T05 page shell and tabs", () => {
  it("renders title, description and the header action", async () => {
    renderAt();
    expect(screen.getByRole("heading", { name: "Paper trading" })).toBeInTheDocument();
    expect(screen.getByText("Test strategies on live market data without placing real orders.")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Start paper run" }).length).toBeGreaterThan(0);
    await screen.findByText("No paper runs yet");
  });

  it("defaults to the Strategy runs tab", async () => {
    renderAt();
    expect(screen.getByRole("tab", { name: "Strategy runs" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Manual accounts" })).toHaveAttribute("aria-selected", "false");
    await waitFor(() => expect(P.list).toHaveBeenCalledTimes(1));
    expect(paperApi.list).not.toHaveBeenCalled();
  });

  it.each(["/paper-trading?tab=bogus", "/paper-trading?tab=", "/paper-trading?tab=MANUAL"])(
    "unknown tab value %s falls back to Strategy runs", async (url) => {
      renderAt(url);
      expect(screen.getByRole("tab", { name: "Strategy runs" })).toHaveAttribute("aria-selected", "true");
      await screen.findByText("No paper runs yet");
    });

  it("clicking Manual accounts writes ?tab=manual and shows the manual UI; back again clears it", async () => {
    P.get.mockReturnValue(new Promise(() => {}));
    renderAt("/paper-trading?run=keep");
    fireEvent.click(screen.getByRole("tab", { name: "Manual accounts" }));
    await waitFor(() => expect(loc()).toContain("tab=manual"));
    expect(loc()).toContain("run=keep");
    await waitFor(() => expect(paperApi.list).toHaveBeenCalled());
    expect(screen.getByRole("tab", { name: "Manual accounts" })).toHaveAttribute("aria-selected", "true");
    fireEvent.click(screen.getByRole("tab", { name: "Strategy runs" }));
    await waitFor(() => expect(loc()).not.toContain("tab="));
  });

  it("?tab=manual renders manual accounts and does not load paper runs", async () => {
    renderAt("/paper-trading?tab=manual");
    await waitFor(() => expect(paperApi.list).toHaveBeenCalled());
    expect(P.list).not.toHaveBeenCalled();
    expect(screen.queryByText("No paper runs yet")).not.toBeInTheDocument();
  });

  it("header Start paper run on the manual tab switches to runs and opens the dialog", async () => {
    renderAt("/paper-trading?tab=manual");
    fireEvent.click(screen.getByRole("button", { name: "Start paper run" }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    await waitFor(() => expect(loc()).not.toContain("tab=manual"));
    expect(screen.getByRole("tab", { name: "Strategy runs" })).toHaveAttribute("aria-selected", "true");
  });
});

// ── run list ────────────────────────────────────────────────────────

describe("T05 run list", () => {
  it("shows skeleton rows while loading and no empty state yet", async () => {
    let resolve!: (v: PaperRun[]) => void;
    P.list.mockReturnValue(new Promise((r) => (resolve = r)));
    const { container } = renderAt();
    expect(container.querySelectorAll(".animate-pulse").length).toBeGreaterThanOrEqual(3);
    expect(screen.queryByText("No paper runs yet")).not.toBeInTheDocument();
    await act(async () => resolve([]));
    expect(await screen.findByText("No paper runs yet")).toBeInTheDocument();
    expect(container.querySelectorAll(".animate-pulse")).toHaveLength(0);
  });

  it("empty state has the spec copy and its action opens the start dialog", async () => {
    renderAt();
    expect(await screen.findByText("No paper runs yet")).toBeInTheDocument();
    expect(screen.getByText("Start one from any finished backtest. Results count only from the moment you start.")).toBeInTheDocument();
    const buttons = screen.getAllByRole("button", { name: "Start paper run" });
    expect(buttons).toHaveLength(2);
    fireEvent.click(buttons[1]);
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  it("list load failure shows an inline alert", async () => {
    P.list.mockRejectedValue(new Error("backend down"));
    renderAt();
    expect(await screen.findByRole("alert")).toHaveTextContent("backend down");
  });

  it("row shows codes joined with ', ', ' on ' interval, equity and relative update time", async () => {
    P.list.mockResolvedValue([mkRun({ codes: ["BTC-USDT", "ETH-USDT"], interval: "1D", last_refreshed_at: iso(3 * 60_000) })]);
    renderAt();
    const row = await screen.findByRole("button", { name: /BTC paper/ });
    expect(row).toHaveTextContent("BTC-USDT, ETH-USDT on 1D");
    expect(within(row).getByText(/^11[.,\s ]?000[.,]00$/)).toBeInTheDocument();
    expect(within(row).getByText("Updated 3 min ago")).toBeInTheDocument();
  });

  it("status and state badges use the right tones; ok state has no state badge", async () => {
    P.list.mockResolvedValue([
      mkRun({ id: "a", label: "Alpha" }),
      mkRun({ id: "b", label: "Beta", status: "stopped", stopped_at: iso(0) }),
      mkRun({ id: "c", label: "Gamma", state: "waiting" }),
      mkRun({ id: "d", label: "Delta", state: "error", last_error: "boom" }),
    ]);
    renderAt();
    const alpha = await screen.findByRole("button", { name: /Alpha/ });
    expect(within(alpha).getByText("Active")).toHaveClass("text-info");
    expect(within(alpha).queryByText("Waiting for data")).toBeNull();
    expect(within(alpha).queryByText("Error")).toBeNull();
    const beta = screen.getByRole("button", { name: /Beta/ });
    expect(within(beta).getByText("Stopped")).toHaveClass("text-muted-foreground");
    expect(within(screen.getByRole("button", { name: /Gamma/ })).getByText("Waiting for data")).toHaveClass("text-warning");
    expect(within(screen.getByRole("button", { name: /Delta/ })).getByText("Error")).toHaveClass("text-danger");
  });

  it("return colors: gain green with +, loss red, zero uncolored without sign", async () => {
    P.list.mockResolvedValue([
      mkRun({ id: "g", label: "Gain", summary: summary({ total_return: 0.0123 }) }),
      mkRun({ id: "l", label: "Loss", summary: summary({ total_return: -0.5 }) }),
      mkRun({ id: "z", label: "Flat", summary: summary({ total_return: 0 }) }),
    ]);
    renderAt();
    const gain = within(await screen.findByRole("button", { name: /Gain/ })).getByText(/%$/);
    expect(gain.textContent).toMatch(/^\+1[.,]23%$/);
    expect(gain).toHaveClass("text-success");
    const loss = within(screen.getByRole("button", { name: /Loss/ })).getByText(/%$/);
    expect(loss.textContent).toMatch(/^-50[.,]00%$/);
    expect(loss).toHaveClass("text-danger");
    const flat = within(screen.getByRole("button", { name: /Flat/ })).getByText(/%$/);
    expect(flat.textContent).toMatch(/^0[.,]00%$/);
    expect(flat).not.toHaveClass("text-success");
    expect(flat).not.toHaveClass("text-danger");
  });

  it("a run without summary shows n/a equity and no return; no refresh time shows no Updated line", async () => {
    P.list.mockResolvedValue([mkRun({ summary: null, last_refreshed_at: null })]);
    renderAt();
    const row = await screen.findByRole("button", { name: /BTC paper/ });
    expect(within(row).getByText("n/a")).toBeInTheDocument();
    expect(within(row).queryByText(/%$/)).toBeNull();
    expect(within(row).queryByText(/Updated/)).toBeNull();
  });

  it("without a selected run the detail pane prompts to pick one", async () => {
    P.list.mockResolvedValue([mkRun()]);
    renderAt();
    expect(await screen.findByText("Select a paper run to see its results")).toBeInTheDocument();
    expect(P.get).not.toHaveBeenCalled();
  });

  it("marks the selected row with aria-current", async () => {
    P.list.mockResolvedValue([mkRun(), mkRun({ id: "p2", label: "Other" })]);
    P.get.mockImplementation(async (id) => mkDetail(mkRun({ id })));
    renderAt("/paper-trading?run=p2");
    const other = await screen.findByRole("button", { name: /Other/ });
    expect(other).toHaveAttribute("aria-current", "true");
    expect(screen.getByRole("button", { name: /BTC paper/ })).not.toHaveAttribute("aria-current");
  });
});

// ── run detail ──────────────────────────────────────────────────────

describe("T05 run detail", () => {
  it("shows the header, six stats with formatting and tones, chart, positions and footnote", async () => {
    const run = mkRun({ summary: summary({ pnl: -250.5, total_return: -0.025, sharpe: 1.234, trade_count: 7 }) });
    P.list.mockResolvedValue([run]);
    P.get.mockResolvedValue(mkDetail(run));
    renderAt("/paper-trading?run=p1");
    expect(await screen.findByRole("heading", { name: "BTC paper" })).toBeInTheDocument();
    expect(screen.getByText(/Counts from 2026-01-01 12:00:00/)).toBeInTheDocument();
    expect(screen.getByText(/^Started /)).toHaveTextContent(new Date(run.started_at).toLocaleString());
    expect(statValue("Equity").textContent).toMatch(/^11[.,\s ]?000[.,]00$/);
    expect(statValue("P&L").textContent).toMatch(/^-250[.,]50$/);
    expect(statValue("P&L")).toHaveClass("text-danger");
    expect(statValue("Return").textContent).toMatch(/^-2[.,]50%$/);
    expect(statValue("Return")).toHaveClass("text-danger");
    expect(statValue("Max drawdown").textContent).toMatch(/^-2[.,]50%$/);
    expect(statValue("Sharpe").textContent).toMatch(/^1[.,]23$/);
    expect(statValue("Trades")).toHaveTextContent("7");
    expect(screen.getByTestId("equity-chart")).toBeInTheDocument();
    expect(chartProps).toHaveBeenLastCalledWith(expect.objectContaining({ data: mkDetail(run).equity }));
    const positions = screen.getByText("Positions").closest("div")!.parentElement!.parentElement!;
    expect(within(positions).getByText("Weight")).toBeInTheDocument();
    expect(within(positions).getByText(/^50[.,]00%$/)).toBeInTheDocument();
    expect(screen.getByText(/No orders are sent to any exchange\./)).toBeInTheDocument();
  });

  it("equity uses the BRIEF hero number style (32px semibold tabular)", async () => {
    const run = mkRun();
    P.list.mockResolvedValue([run]);
    P.get.mockResolvedValue(mkDetail(run));
    renderAt("/paper-trading?run=p1");
    await screen.findByText("Trade history");
    const eq = statValue("Equity");
    const heroed = eq.matches(".text-\\[32px\\]") || !!eq.querySelector(".text-\\[32px\\]");
    expect(heroed).toBe(true);
    expect(eq.closest(".tabular-nums") ?? eq.querySelector(".tabular-nums")).not.toBeNull();
  });

  it("positive P&L stat is green with a + sign", async () => {
    const run = mkRun();
    P.list.mockResolvedValue([run]);
    P.get.mockResolvedValue(mkDetail(run));
    renderAt("/paper-trading?run=p1");
    await screen.findByText("Trade history");
    expect(statValue("P&L").textContent).toMatch(/^\+1[.,\s ]?000[.,]00$/);
    expect(statValue("P&L")).toHaveClass("text-success");
    expect(statValue("Return")).toHaveClass("text-success");
  });

  it("no summary yet: every stat reads n/a and nothing crashes", async () => {
    const run = mkRun({ summary: null, state: "waiting" });
    P.list.mockResolvedValue([run]);
    P.get.mockResolvedValue(mkDetail(run, { equity: [], trades: [], positions: [] }));
    renderAt("/paper-trading?run=p1");
    await screen.findByText("Trade history");
    for (const l of ["Equity", "P&L", "Return", "Max drawdown", "Sharpe", "Trades"]) {
      expect(statValue(l)).toHaveTextContent("n/a");
    }
    expect(screen.getByText("No open positions")).toBeInTheDocument();
    expect(screen.getByText("No trades yet")).toBeInTheDocument();
  });

  it("one equity point shows the empty curve message instead of the chart", async () => {
    const run = mkRun();
    P.list.mockResolvedValue([run]);
    P.get.mockResolvedValue(mkDetail(run, { equity: [{ time: "a", equity: 1, drawdown: 0 }] }));
    renderAt("/paper-trading?run=p1");
    expect(await screen.findByText("The equity curve appears after two bars.")).toBeInTheDocument();
    expect(screen.queryByTestId("equity-chart")).toBeNull();
  });

  it("waiting banner names evaluation_start", async () => {
    const run = mkRun({ state: "waiting", evaluation_start: "2026-03-04T05:06:07" });
    P.list.mockResolvedValue([run]);
    P.get.mockResolvedValue(mkDetail(run));
    renderAt("/paper-trading?run=p1");
    expect(await screen.findByText(
      "Waiting for the first bars after 2026-03-04 05:06:07. Paper results start with the first bar after you pressed start.",
    )).toBeInTheDocument();
  });

  it("error banner shows last_error and its Refresh button refreshes", async () => {
    const run = mkRun({ state: "error", last_error: "No data from vendor" });
    P.list.mockResolvedValue([run]);
    P.get.mockResolvedValue(mkDetail(run));
    P.refresh.mockResolvedValue(mkDetail(mkRun()));
    renderAt("/paper-trading?run=p1");
    const msg = await screen.findByText("No data from vendor");
    expect(msg).toHaveClass("text-danger");
    const banner = msg.parentElement!;
    fireEvent.click(within(banner).getByRole("button", { name: "Refresh" }));
    await waitFor(() => expect(P.refresh).toHaveBeenCalledWith("p1"));
    await waitFor(() => expect(screen.queryByText("No data from vendor")).toBeNull());
  });

  it("error banner falls back to generic copy when last_error is null", async () => {
    const run = mkRun({ state: "error", last_error: null });
    P.list.mockResolvedValue([run]);
    P.get.mockResolvedValue(mkDetail(run));
    renderAt("/paper-trading?run=p1");
    expect(await screen.findByText("Refresh failed.")).toBeInTheDocument();
  });

  it("detail load failure shows an alert", async () => {
    P.list.mockResolvedValue([mkRun()]);
    P.get.mockRejectedValue(new Error("Paper run not found"));
    renderAt("/paper-trading?run=p1");
    expect(await screen.findByRole("alert")).toHaveTextContent("Paper run not found");
  });

  it("trades: newest first as given, side badges, empty P&L for entries, colored P&L", async () => {
    const run = mkRun();
    P.list.mockResolvedValue([run]);
    P.get.mockResolvedValue(mkDetail(run, {
      trades: [trade(3, { pnl: -4, return_pct: -0.01 }), trade(2), trade(1)],
    }));
    renderAt("/paper-trading?run=p1");
    const history = (await screen.findByText("Trade history")).closest("div")!.parentElement!.parentElement!;
    const rows = within(history).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent("2026-01-02 03:00:00");
    expect(within(rows[0]).getByText("Sell")).toBeInTheDocument();
    expect(within(rows[1]).getByText("Buy")).toBeInTheDocument();
    const loss = within(rows[0]).getByText(/^-4[.,]00$/);
    expect(loss).toHaveClass("text-danger");
    expect(within(rows[0]).getByText(/^-1[.,]00%$/)).toHaveClass("text-danger");
    const gain = within(rows[2]).getByText(/^\+10[.,]00$/);
    expect(gain).toHaveClass("text-success");
    // entry row: empty pnl cells, no "null"/"NaN"
    expect(rows[1].textContent).not.toMatch(/null|NaN|undefined/);
  });

  it("trades: exactly 50 shows all without a Show all button", async () => {
    const run = mkRun();
    P.list.mockResolvedValue([run]);
    P.get.mockResolvedValue(mkDetail(run, { trades: Array.from({ length: 50 }, (_, i) => trade(i)) }));
    renderAt("/paper-trading?run=p1");
    const history = (await screen.findByText("Trade history")).closest("div")!.parentElement!.parentElement!;
    expect(within(history).getAllByRole("row")).toHaveLength(51);
    expect(screen.queryByRole("button", { name: /Show all/ })).toBeNull();
  });

  it("trades: 51 shows 50 rows then Show all 51 expands", async () => {
    const run = mkRun();
    P.list.mockResolvedValue([run]);
    P.get.mockResolvedValue(mkDetail(run, { trades: Array.from({ length: 51 }, (_, i) => trade(i)) }));
    renderAt("/paper-trading?run=p1");
    const history = (await screen.findByText("Trade history")).closest("div")!.parentElement!.parentElement!;
    expect(within(history).getAllByRole("row")).toHaveLength(51);
    fireEvent.click(screen.getByRole("button", { name: "Show all 51" }));
    expect(within(history).getAllByRole("row")).toHaveLength(52);
    expect(screen.queryByRole("button", { name: /Show all/ })).toBeNull();
  });

  it("stopped run: no Stop button, Delete still available", async () => {
    const run = mkRun({ status: "stopped", stopped_at: iso(0) });
    P.list.mockResolvedValue([run]);
    P.get.mockResolvedValue(mkDetail(run));
    renderAt("/paper-trading?run=p1");
    await screen.findByText("Trade history");
    expect(screen.queryByRole("button", { name: "Stop" })).toBeNull();
    expect(screen.getByRole("button", { name: "Delete" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Refresh" })).toBeInTheDocument();
  });
});

// ── refresh behaviour ───────────────────────────────────────────────

describe("T05 refresh behaviour", () => {
  const setup = (run: PaperRun) => {
    P.list.mockResolvedValue([run]);
    P.get.mockResolvedValue(mkDetail(run));
    P.refresh.mockResolvedValue(mkDetail(run));
  };

  it("fresh (30 s old) active run is not refreshed on open", async () => {
    setup(mkRun({ last_refreshed_at: iso(30_000) }));
    renderAt("/paper-trading?run=p1");
    await screen.findByText("Trade history");
    await new Promise((r) => setTimeout(r, 20));
    expect(P.refresh).not.toHaveBeenCalled();
  });

  it("stale (2 min old) active run is refreshed exactly once on open", async () => {
    setup(mkRun({ last_refreshed_at: iso(120_000) }));
    renderAt("/paper-trading?run=p1");
    await waitFor(() => expect(P.refresh).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 20));
    expect(P.refresh).toHaveBeenCalledTimes(1);
    expect(P.refresh).toHaveBeenCalledWith("p1");
  });

  it("stopped run that is stale is not refreshed on open", async () => {
    setup(mkRun({ status: "stopped", last_refreshed_at: null }));
    renderAt("/paper-trading?run=p1");
    await screen.findByText("Trade history");
    await new Promise((r) => setTimeout(r, 20));
    expect(P.refresh).not.toHaveBeenCalled();
  });

  it("refreshed run updates the list entry", async () => {
    const run = mkRun({ last_refreshed_at: null, summary: null });
    P.list.mockResolvedValue([run]);
    P.get.mockResolvedValue(mkDetail(run));
    P.refresh.mockResolvedValue(mkDetail(mkRun({ summary: summary({ equity: 12345, total_return: 0.2345 }) })));
    renderAt("/paper-trading?run=p1");
    await waitFor(() => expect(within(list()).getByText(/^\+23[.,]45%$/)).toBeInTheDocument());
    expect(within(list()).getByText(/^12[.,\s ]?345[.,]00$/)).toBeInTheDocument();
  });

  it("manual refresh failure shows inline error and keeps previous data", async () => {
    const run = mkRun();
    setup(run);
    P.refresh.mockRejectedValue(new Error("vendor timeout"));
    renderAt("/paper-trading?run=p1");
    await screen.findByText("Trade history");
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("vendor timeout");
    expect(statValue("Equity").textContent).toMatch(/^11[.,\s ]?000[.,]00$/);
    expect(screen.getByTestId("equity-chart")).toBeInTheDocument();
  });

  it("every 5 minutes while active and visible; not before", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    setup(mkRun());
    renderAt("/paper-trading?run=p1");
    await screen.findByText("Trade history");
    await act(async () => { await vi.advanceTimersByTimeAsync(4 * 60_000 + 59_000); });
    expect(P.refresh).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });
    expect(P.refresh).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(5 * 60_000); });
    expect(P.refresh).toHaveBeenCalledTimes(2);
  });

  it("no interval refresh while the tab is hidden; resumes when visible", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    setup(mkRun());
    renderAt("/paper-trading?run=p1");
    await screen.findByText("Trade history");
    visibility = "hidden";
    await act(async () => { await vi.advanceTimersByTimeAsync(10 * 60_000 + 10); });
    expect(P.refresh).not.toHaveBeenCalled();
    visibility = "visible";
    await act(async () => { await vi.advanceTimersByTimeAsync(5 * 60_000); });
    expect(P.refresh).toHaveBeenCalledTimes(1);
  });

  it("no interval refresh for a stopped run", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    setup(mkRun({ status: "stopped" }));
    renderAt("/paper-trading?run=p1");
    await screen.findByText("Trade history");
    await act(async () => { await vi.advanceTimersByTimeAsync(15 * 60_000); });
    expect(P.refresh).not.toHaveBeenCalled();
  });

  it("interval is cleared on unmount", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    setup(mkRun());
    const { unmount } = renderAt("/paper-trading?run=p1");
    await screen.findByText("Trade history");
    unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(15 * 60_000); });
    expect(P.refresh).not.toHaveBeenCalled();
  });

  it("changing selection reloads detail and the old run's interval stops", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const a = mkRun();
    const b = mkRun({ id: "p2", label: "Second run" });
    P.list.mockResolvedValue([a, b]);
    // last_refreshed_at is stamped at fetch time so neither run is stale on open.
    const now = (r: PaperRun) => ({ ...r, last_refreshed_at: new Date().toISOString() });
    P.get.mockImplementation(async (id) => mkDetail(now(id === "p2" ? b : a)));
    P.refresh.mockImplementation(async (id) => mkDetail(now(id === "p2" ? b : a)));
    renderAt("/paper-trading?run=p1");
    await screen.findByRole("heading", { name: "BTC paper" });
    await act(async () => { await vi.advanceTimersByTimeAsync(3 * 60_000); });
    fireEvent.click(screen.getByRole("button", { name: /Second run/ }));
    expect(await screen.findByRole("heading", { name: "Second run" })).toBeInTheDocument();
    expect(P.get).toHaveBeenLastCalledWith("p2");
    expect(loc()).toContain("run=p2");
    await act(async () => { await vi.advanceTimersByTimeAsync(5 * 60_000 + 10); });
    expect(P.refresh.mock.calls.map((c) => c[0])).toEqual(["p2"]);
  });
});

// ── stop / delete ───────────────────────────────────────────────────

describe("T05 stop and delete", () => {
  const setup = () => {
    const run = mkRun();
    P.list.mockResolvedValue([run, mkRun({ id: "p2", label: "Keep me" })]);
    P.get.mockResolvedValue(mkDetail(run));
  };

  it("stop confirm uses the spec copy; cancel does not call the API", async () => {
    setup();
    renderAt("/paper-trading?run=p1");
    fireEvent.click(await screen.findByRole("button", { name: "Stop" }));
    const dlg = await screen.findByRole("alertdialog");
    expect(dlg).toHaveTextContent("Stop this paper run? It keeps its history and stops counting new bars.");
    fireEvent.click(within(dlg).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(P.stop).not.toHaveBeenCalled();
  });

  it("stop updates the list badge to Stopped", async () => {
    setup();
    P.stop.mockResolvedValue(mkDetail(mkRun({ status: "stopped", stopped_at: iso(0) })));
    renderAt("/paper-trading?run=p1");
    fireEvent.click(await screen.findByRole("button", { name: "Stop" }));
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Stop" }));
    await waitFor(() => expect(P.stop).toHaveBeenCalledWith("p1"));
    await waitFor(() =>
      expect(within(screen.getByRole("button", { name: /BTC paper/ })).getByText("Stopped")).toBeInTheDocument());
  });

  it("stop failure shows an alert and keeps the Stop button", async () => {
    setup();
    P.stop.mockRejectedValue(new Error("cannot stop"));
    renderAt("/paper-trading?run=p1");
    fireEvent.click(await screen.findByRole("button", { name: "Stop" }));
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Stop" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("cannot stop");
    expect(screen.getByRole("button", { name: "Stop" })).toBeInTheDocument();
  });

  it("delete cancel does nothing; Escape also cancels", async () => {
    setup();
    renderAt("/paper-trading?run=p1");
    fireEvent.click(await screen.findByRole("button", { name: "Delete" }));
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await screen.findByRole("alertdialog");
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(P.remove).not.toHaveBeenCalled();
  });

  it("delete removes the run from the list, clears ?run and keeps other runs", async () => {
    setup();
    P.remove.mockResolvedValue({ deleted: true });
    renderAt("/paper-trading?run=p1");
    fireEvent.click(await screen.findByRole("button", { name: "Delete" }));
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(P.remove).toHaveBeenCalledWith("p1"));
    await waitFor(() => expect(loc()).not.toContain("run="));
    expect(screen.queryByRole("button", { name: /BTC paper/ })).toBeNull();
    expect(screen.getByRole("button", { name: /Keep me/ })).toBeInTheDocument();
  });

  it("deleting the last run shows the empty state", async () => {
    const run = mkRun();
    P.list.mockResolvedValue([run]);
    P.get.mockResolvedValue(mkDetail(run));
    P.remove.mockResolvedValue({ deleted: true });
    renderAt("/paper-trading?run=p1");
    fireEvent.click(await screen.findByRole("button", { name: "Delete" }));
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Delete" }));
    expect(await screen.findByText("No paper runs yet")).toBeInTheDocument();
  });

  it("delete failure shows an alert and keeps the run", async () => {
    setup();
    P.remove.mockRejectedValue(new Error("locked"));
    renderAt("/paper-trading?run=p1");
    fireEvent.click(await screen.findByRole("button", { name: "Delete" }));
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Delete" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("locked");
    expect(loc()).toContain("run=p1");
  });
});

// ── start dialog ────────────────────────────────────────────────────

describe("T05 start dialog", () => {
  const open = async (url = "/paper-trading") => {
    renderAt(url);
    fireEvent.click(screen.getAllByRole("button", { name: "Start paper run" })[0]);
    const dialog = await screen.findByRole("dialog");
    const select = within(dialog).getByLabelText("Backtest run") as HTMLSelectElement;
    return { dialog, select };
  };

  it("is a modal dialog with the first field focused", async () => {
    const { dialog, select } = await open();
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAccessibleName("Start paper run");
    expect(document.activeElement).toBe(select);
    expect(dialog.parentElement).toHaveClass("bg-foreground/20");
  });

  it("lists success runs and runs with total_return; option text format", async () => {
    const { select } = await open();
    await waitFor(() => expect(within(select).getAllByRole("option")).toHaveLength(2));
    const opts = within(select).getAllByRole("option").map((o) => o.textContent);
    expect(opts[0]).toMatch(/^r1 \(BTC-USDT, ETH-USDT, 25[.,]00%\)$/);
    expect(opts[1]).toMatch(/^r3 \(AAPL\.US, -10[.,]00%\)$/);
    expect(opts.join()).not.toContain("r2");
    expect(api.listRuns).toHaveBeenCalledWith(50);
    expect(select).toHaveValue("r1");
  });

  it("name placeholder comes from the selected run's codes and follows the selection", async () => {
    const { dialog, select } = await open();
    await waitFor(() => expect(select).toHaveValue("r1"));
    const name = within(dialog).getByLabelText("Name");
    expect(name).toHaveAttribute("placeholder", "BTC-USDT, ETH-USDT paper");
    fireEvent.change(select, { target: { value: "r3" } });
    expect(name).toHaveAttribute("placeholder", "AAPL.US paper");
  });

  it("starting cash is a number input with the hint", async () => {
    const { dialog } = await open();
    expect(within(dialog).getByLabelText("Starting cash")).toHaveAttribute("type", "number");
    expect(within(dialog).getByText("Leave empty to use the backtest setting")).toBeInTheDocument();
  });

  it("no usable backtests: hint shown and submit disabled", async () => {
    vi.mocked(api.listRuns).mockResolvedValue([{ run_id: "x", status: "failed", created_at: "" }] as never);
    const { dialog, select } = await open();
    expect(await within(dialog).findByText("No finished backtests found. Run a backtest first.")).toBeInTheDocument();
    expect(within(select).queryAllByRole("option")).toHaveLength(0);
    expect(within(dialog).getByRole("button", { name: "Start paper run" })).toBeDisabled();
  });

  it("listRuns failure shows an alert inside the dialog", async () => {
    vi.mocked(api.listRuns).mockRejectedValue(new Error("runs unavailable"));
    const { dialog } = await open();
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("runs unavailable");
  });

  it("Escape closes without creating", async () => {
    await open();
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(P.create).not.toHaveBeenCalled();
  });

  it("backdrop click closes; click inside the card does not", async () => {
    const { dialog } = await open();
    fireEvent.click(dialog);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.click(dialog.parentElement!);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("Cancel closes the dialog", async () => {
    const { dialog } = await open();
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("empty name and cash: sends no initial_cash and the codes based default label", async () => {
    P.create.mockResolvedValue(mkRun({ id: "n1" }));
    P.get.mockReturnValue(new Promise(() => {}));
    const { dialog, select } = await open();
    await waitFor(() => expect(select).toHaveValue("r1"));
    fireEvent.click(within(dialog).getByRole("button", { name: "Start paper run" }));
    await waitFor(() => expect(P.create).toHaveBeenCalledTimes(1));
    const body = P.create.mock.calls[0][0];
    expect(body.run_id).toBe("r1");
    expect(body).not.toHaveProperty("initial_cash");
    expect(body.label).toBe("BTC-USDT, ETH-USDT paper");
  });

  it("whitespace name is trimmed; numeric cash is sent as a number", async () => {
    P.create.mockResolvedValue(mkRun({ id: "n1" }));
    P.get.mockReturnValue(new Promise(() => {}));
    const { dialog, select } = await open();
    await waitFor(() => expect(select).toHaveValue("r1"));
    fireEvent.change(select, { target: { value: "r3" } });
    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "  Apple test  " } });
    fireEvent.change(within(dialog).getByLabelText("Starting cash"), { target: { value: "1234.5" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Start paper run" }));
    await waitFor(() => expect(P.create).toHaveBeenCalledWith({ run_id: "r3", label: "Apple test", initial_cash: 1234.5 }));
  });

  it("success: closes, prepends to the list, selects it and refreshes", async () => {
    P.list.mockResolvedValue([mkRun({ id: "old", label: "Old run" })]);
    const created = mkRun({ id: "new1", label: "Fresh", last_refreshed_at: null, state: "waiting", summary: null });
    P.create.mockResolvedValue(created);
    P.get.mockResolvedValue(mkDetail(created));
    P.refresh.mockResolvedValue(mkDetail(created));
    const { dialog, select } = await open();
    await waitFor(() => expect(select).toHaveValue("r1"));
    fireEvent.click(within(dialog).getByRole("button", { name: "Start paper run" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(loc()).toContain("run=new1"));
    const rows = within(list()).getAllByRole("button");
    expect(rows[0]).toHaveTextContent("Fresh");
    expect(rows[1]).toHaveTextContent("Old run");
    await waitFor(() => expect(P.refresh).toHaveBeenCalledWith("new1"));
  });

  it("422 from the API is shown in the dialog; dialog stays open and nothing is added", async () => {
    P.list.mockResolvedValue([mkRun({ id: "old", label: "Old run" })]);
    P.create.mockRejectedValue(Object.assign(new Error("initial_cash: must be greater than 0"), { status: 422 }));
    const { dialog, select } = await open();
    await waitFor(() => expect(select).toHaveValue("r1"));
    fireEvent.change(within(dialog).getByLabelText("Starting cash"), { target: { value: "0" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Start paper run" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("initial_cash: must be greater than 0");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(within(list()).getAllByRole("button")).toHaveLength(1);
    expect(loc()).not.toContain("run=");
    // can retry after the failure
    expect(within(dialog).getByRole("button", { name: "Start paper run" })).not.toBeDisabled();
  });
});

// ── ?from_run ───────────────────────────────────────────────────────

describe("T05 ?from_run", () => {
  it("preselects a run that is in the list without duplicating it", async () => {
    renderAt("/paper-trading?from_run=r3");
    const dialog = await screen.findByRole("dialog");
    const select = within(dialog).getByLabelText("Backtest run");
    await waitFor(() => expect(within(select).getAllByRole("option")).toHaveLength(2));
    expect(select).toHaveValue("r3");
    await waitFor(() => expect(loc()).not.toContain("from_run"));
  });

  it("an unknown id is still added as an option and preselected", async () => {
    renderAt("/paper-trading?from_run=missing-123");
    const dialog = await screen.findByRole("dialog");
    const select = within(dialog).getByLabelText("Backtest run");
    await waitFor(() => expect(within(select).getAllByRole("option")).toHaveLength(3));
    expect(select).toHaveValue("missing-123");
    expect(within(select).getAllByRole("option")[0]).toHaveTextContent(/^missing-123$/);
  });

  it("works from the manual tab: switches to runs and removes from_run", async () => {
    renderAt("/paper-trading?tab=manual&from_run=r1");
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    await waitFor(() => expect(loc()).not.toContain("from_run"));
    expect(loc()).not.toContain("tab=manual");
    expect(screen.getByRole("tab", { name: "Strategy runs" })).toHaveAttribute("aria-selected", "true");
  });

  it("keeps an existing ?run selection while removing from_run", async () => {
    P.list.mockResolvedValue([mkRun()]);
    P.get.mockResolvedValue(mkDetail(mkRun()));
    renderAt("/paper-trading?run=p1&from_run=r1");
    await screen.findByRole("dialog");
    await waitFor(() => expect(loc()).not.toContain("from_run"));
    expect(loc()).toContain("run=p1");
  });

  it("submitting from a from_run preset sends that run_id", async () => {
    P.create.mockResolvedValue(mkRun({ id: "n1" }));
    P.get.mockReturnValue(new Promise(() => {}));
    renderAt("/paper-trading?from_run=missing-123");
    const dialog = await screen.findByRole("dialog");
    await waitFor(() => expect(within(dialog).getByLabelText("Backtest run")).toHaveValue("missing-123"));
    fireEvent.click(within(dialog).getByRole("button", { name: "Start paper run" }));
    await waitFor(() => expect(P.create).toHaveBeenCalledWith({ run_id: "missing-123" }));
  });
});

// ── slop ban list (static) ──────────────────────────────────────────

describe("T05 slop ban list", () => {
  const SRC = path.resolve(__dirname, "../..");
  const files = [
    "pages/PaperTrading.tsx",
    "components/paper/PaperRunsView.tsx",
    "components/paper/PaperRunDetail.tsx",
    "components/paper/StartPaperRunDialog.tsx",
    "components/paper/ManualAccounts.tsx",
    "lib/paperRuns.ts",
  ];

  it.each(files)("%s has no em dashes, uppercase or mono-uppercase labels, gradients or counters", (f) => {
    const src = fs.readFileSync(path.join(SRC, f), "utf8");
    expect(src).not.toContain("—");
    expect(src).not.toMatch(/\buppercase\b/);
    expect(src).not.toMatch(/tracking-widest/);
    expect(src).not.toMatch(/bg-gradient|from-purple|via-purple|to-purple/);
    expect(src).not.toMatch(/animate-ping/);
    expect(src).not.toMatch(/["'>]0[1-9]["'<]/);
  });

  it("uses react-router (installed) rather than react-router-dom", () => {
    for (const f of files) {
      expect(fs.readFileSync(path.join(SRC, f), "utf8")).not.toContain("react-router-dom");
    }
  });

  it("rendered detail copy has no em dashes", async () => {
    const run = mkRun({ state: "waiting" });
    P.list.mockResolvedValue([run]);
    P.get.mockResolvedValue(mkDetail(run));
    const { container } = renderAt("/paper-trading?run=p1");
    await screen.findByText("Trade history");
    expect(container.textContent).not.toContain("—");
  });
});
