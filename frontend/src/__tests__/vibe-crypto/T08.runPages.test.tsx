// T08: RunDetail ("Run on paper" link, header, tabs, states), Compare and
// Reports rendered with mocked api. Offline: no network, charts stubbed.
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createMemoryRouter, MemoryRouter, RouterProvider } from "react-router";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import i18n from "@/i18n";
import type { RunData } from "@/lib/api";
import { RunDetail } from "@/pages/RunDetail";
import { Compare } from "@/pages/Compare";
import { Reports } from "@/pages/Reports";

const apiMock = vi.hoisted(() => ({
  getRun: vi.fn(),
  getRunCode: vi.fn(),
  getRunFactor: vi.fn(),
  listRuns: vi.fn(),
}));
const toastMock = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));

vi.mock("@/lib/api", () => ({ api: apiMock }));
vi.mock("sonner", () => ({ toast: toastMock }));
vi.mock("@/components/charts/FactorResearchPanel", () => ({
  FactorResearchPanel: () => <div data-testid="factor-panel" />,
}));
vi.mock("@/components/charts/CandlestickChart", () => ({
  CandlestickChart: () => <div data-testid="candlestick-chart" />,
}));
vi.mock("@/components/charts/EquityChart", () => ({
  EquityChart: () => <div data-testid="equity-chart" />,
}));
vi.mock("@/components/charts/StrategyResearchDashboard", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/charts/StrategyResearchDashboard")>();
  return { ...actual, StrategyResearchDashboard: () => <div data-testid="strategy-dashboard" /> };
});

beforeAll(async () => { await i18n.changeLanguage("en"); });

function renderRun(path: string) {
  const router = createMemoryRouter(
    [
      { path: "/runs/:runId", element: <RunDetail /> },
      { path: "/paper-trading", element: <div data-testid="paper-page" /> },
    ],
    { initialEntries: [path] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

const EQUITY = [
  { time: "2024-01-01", equity: 100, drawdown: 0 },
  { time: "2024-01-02", equity: 101, drawdown: 0 },
  { time: "2024-01-03", equity: 99, drawdown: -0.02 },
];

function mockRun(run: Partial<RunData>) {
  apiMock.getRun.mockResolvedValue({ prompt: "A strategy prompt", ...run });
  apiMock.getRunCode.mockResolvedValue({});
}

describe("T08 RunDetail: Run on paper link", () => {
  beforeEach(() => {
    apiMock.getRun.mockReset();
    apiMock.getRunCode.mockReset();
    apiMock.getRunFactor.mockReset();
  });

  it("successful run links to /paper-trading?from_run=<id> with a primary style and icon", async () => {
    mockRun({ status: "success", run_id: "run-1" });
    renderRun("/runs/run-1");
    const link = await screen.findByRole("link", { name: "Run on paper" });
    expect(link).toHaveAttribute("href", "/paper-trading?from_run=run-1");
    expect(link).toHaveClass("bg-primary", "text-primary-foreground", "rounded-md");
    expect(link.querySelector("svg")).not.toBeNull();
    expect(link.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });

  it.each([
    ["a b&c?d#e", "/runs/a%20b%26c%3Fd%23e", "a%20b%26c%3Fd%23e"],
    ["ab/12", "/runs/ab%2F12", "ab%2F12"],
    ["回测-1", `/runs/${encodeURIComponent("回测-1")}`, encodeURIComponent("回测-1")],
    ["x+y=z", "/runs/x%2By%3Dz", "x%2By%3Dz"],
  ])("encodes the run id %j in the query string", async (_id, path, encoded) => {
    mockRun({ status: "success", run_id: _id });
    renderRun(path);
    const link = await screen.findByRole("link", { name: "Run on paper" });
    expect(link).toHaveAttribute("href", `/paper-trading?from_run=${encoded}`);
    expect(new URL(link.getAttribute("href")!, "http://x").searchParams.get("from_run")).toBe(_id);
  });

  it("failed run with an equity curve still offers Run on paper", async () => {
    mockRun({ status: "failed", run_id: "f1", equity_curve: EQUITY });
    renderRun("/runs/f1");
    expect(await screen.findByRole("link", { name: "Run on paper" })).toHaveAttribute("href", "/paper-trading?from_run=f1");
  });

  it("cancelled run with an equity curve offers Run on paper", async () => {
    mockRun({ status: "cancelled", run_id: "c1", equity_curve: EQUITY });
    renderRun("/runs/c1");
    expect(await screen.findByRole("link", { name: "Run on paper" })).toBeInTheDocument();
  });

  it("successful run with an empty equity curve still offers Run on paper", async () => {
    mockRun({ status: "success", run_id: "s0", equity_curve: [] });
    renderRun("/runs/s0");
    expect(await screen.findByRole("link", { name: "Run on paper" })).toBeInTheDocument();
  });

  it.each([
    ["failed", undefined],
    ["failed", []],
    ["cancelled", undefined],
    ["running", undefined],
    ["", []],
  ])("hides Run on paper for status %j with equity %j", async (status, equity) => {
    mockRun({ status: status as RunData["status"], run_id: "nope", equity_curve: equity as RunData["equity_curve"] });
    renderRun("/runs/nope");
    await screen.findByText("A strategy prompt");
    expect(screen.queryByRole("link", { name: "Run on paper" })).toBeNull();
  });

  it("clicking Run on paper navigates to the paper trading route with the query", async () => {
    mockRun({ status: "success", run_id: "nav-1" });
    const router = renderRun("/runs/nav-1");
    fireEvent.click(await screen.findByRole("link", { name: "Run on paper" }));
    await screen.findByTestId("paper-page");
    expect(router.state.location.pathname).toBe("/paper-trading");
    expect(router.state.location.search).toBe("?from_run=nav-1");
  });

  it("does not render the link while loading", async () => {
    let resolve!: (r: unknown) => void;
    apiMock.getRun.mockReturnValue(new Promise((r) => { resolve = r; }));
    apiMock.getRunCode.mockResolvedValue({});
    renderRun("/runs/slow");
    expect(screen.queryByRole("link", { name: "Run on paper" })).toBeNull();
    await act(async () => { resolve({ status: "success", run_id: "slow", prompt: "Slow" }); });
    expect(await screen.findByRole("link", { name: "Run on paper" })).toBeInTheDocument();
  });

  it("not found run shows an empty state with Go back and no paper link", async () => {
    apiMock.getRun.mockRejectedValue(new Error("404"));
    apiMock.getRunCode.mockRejectedValue(new Error("404"));
    renderRun("/runs/missing");
    expect(await screen.findByText("Run not found")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Go back/ })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Run on paper" })).toBeNull();
    expect(screen.queryByRole("tablist")).toBeNull();
  });

  it("getRun resolving null is treated as not found", async () => {
    apiMock.getRun.mockResolvedValue(null);
    apiMock.getRunCode.mockResolvedValue({});
    renderRun("/runs/null-run");
    expect(await screen.findByText("Run not found")).toBeInTheDocument();
  });
});

describe("T08 RunDetail: header, metrics and tabs", () => {
  beforeEach(() => {
    apiMock.getRun.mockReset();
    apiMock.getRunCode.mockReset();
  });

  it("renders a single h1, sentence-case run label and status text for screen readers", async () => {
    mockRun({ status: "success", run_id: "hdr-1" });
    renderRun("/runs/hdr-1");
    await screen.findByRole("link", { name: "Run on paper" });
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    const label = screen.getByText("Run hdr-1");
    expect(label).toHaveClass("font-mono");
    expect(label.className).not.toMatch(/uppercase|tracking-wide/);
    expect(screen.queryByText(/RUN hdr-1/)).toBeNull();
    expect(screen.getByText("Completed")).toHaveClass("sr-only");
  });

  it.each([
    ["failed", "Failed"],
    ["cancelled", "Cancelled"],
  ])("status %s announces %s", async (status, text) => {
    mockRun({ status: status as RunData["status"], run_id: "st" });
    renderRun("/runs/st");
    expect(await screen.findByText(text)).toHaveClass("sr-only");
  });

  it("description lists codes and date range from the run card", async () => {
    mockRun({
      status: "success",
      run_id: "desc-1",
      chart_symbols: ["BTC-USDT"],
      run_card: { backtest: { codes: ["BTC-USDT", "ETH-USDT"], start_date: "2024-01-01", end_date: "2024-06-30" } },
    } as Partial<RunData>);
    renderRun("/runs/desc-1");
    await screen.findByRole("link", { name: "Run on paper" });
    expect(screen.getByText(/2024-01-01 to 2024-06-30/)).toBeInTheDocument();
  });

  it("export buttons appear only with trades / metrics and sit beside the paper link", async () => {
    mockRun({
      status: "success",
      run_id: "exp-1",
      metrics: { total_return: 0.12, max_drawdown: -0.1 },
      trade_log: [{ timestamp: "2024-01-02", code: "BTC-USDT", side: "buy", price: 1, qty: 1 }],
    } as Partial<RunData>);
    renderRun("/runs/exp-1");
    const link = await screen.findByRole("link", { name: "Run on paper" });
    const metricsBtn = screen.getByRole("button", { name: /Download Metrics CSV/ });
    const tradesBtn = screen.getByRole("button", { name: /Download Trades CSV/ });
    const actions = link.parentElement!;
    expect(actions).toHaveClass("flex-wrap");
    expect(actions).toContainElement(metricsBtn);
    expect(actions).toContainElement(tradesBtn);
    expect(metricsBtn.className).not.toMatch(/\bbg-primary\b/);
    expect(tradesBtn.className).not.toMatch(/\bbg-primary\b/);
  });

  it("no export buttons when the run has no metrics and no trades", async () => {
    mockRun({ status: "success", run_id: "bare" });
    renderRun("/runs/bare");
    await screen.findByRole("link", { name: "Run on paper" });
    expect(screen.queryByRole("button", { name: /Download/ })).toBeNull();
  });

  it("colors total return by sign", async () => {
    mockRun({ status: "success", run_id: "m1", metrics: { total_return: 0.25, annual_return: -0.1 } } as Partial<RunData>);
    renderRun("/runs/m1");
    await screen.findByRole("link", { name: "Run on paper" });
    // MetricsCard prefixes a glyph and an sr-only verdict, so match on the <p> text.
    const valueP = (txt: string) =>
      screen.getAllByText((_c, el) => el?.tagName === "P" && (el.textContent ?? "").includes(txt))[0];
    expect(valueP("+25.00%")).toHaveClass("text-success", "tabular-nums");
    expect(valueP("-10.00%")).toHaveClass("text-danger", "tabular-nums");
  });

  it("tabs live in a labelled tablist and hide sections without data", async () => {
    mockRun({ status: "success", run_id: "t1" });
    renderRun("/runs/t1");
    await screen.findByRole("link", { name: "Run on paper" });
    const tablist = screen.getByRole("tablist", { name: "Run sections" });
    const names = within(tablist).getAllByRole("tab").map((t) => t.textContent);
    expect(names).toEqual(expect.arrayContaining(["Research dashboard", "Chart", "Trades", "Code"]));
    expect(names).not.toContain("Tearsheet");
    expect(within(tablist).getAllByRole("tab").filter((t) => t.getAttribute("aria-selected") === "true")).toHaveLength(1);
  });

  it("tearsheet tab appears when an equity curve exists", async () => {
    mockRun({ status: "success", run_id: "t2", equity_curve: EQUITY });
    renderRun("/runs/t2");
    await screen.findByRole("link", { name: "Run on paper" });
    expect(screen.getByRole("tab", { name: "Tearsheet" })).toBeInTheDocument();
  });

  it("arrow keys move between tabs and update selection", async () => {
    mockRun({ status: "success", run_id: "t3" });
    renderRun("/runs/t3");
    await screen.findByRole("link", { name: "Run on paper" });
    const tabs = screen.getAllByRole("tab");
    const selected = tabs.findIndex((t) => t.getAttribute("aria-selected") === "true");
    fireEvent.keyDown(tabs[selected], { key: "ArrowRight" });
    await waitFor(() => {
      expect(screen.getAllByRole("tab")[(selected + 1) % tabs.length]).toHaveAttribute("aria-selected", "true");
    });
    fireEvent.keyDown(screen.getAllByRole("tab")[(selected + 1) % tabs.length], { key: "Home" });
    await waitFor(() => expect(screen.getAllByRole("tab")[0]).toHaveAttribute("aria-selected", "true"));
  });

  it("Code tab with no files shows an empty state", async () => {
    mockRun({ status: "success", run_id: "code-0" });
    renderRun("/runs/code-0");
    await screen.findByRole("link", { name: "Run on paper" });
    fireEvent.click(screen.getByRole("tab", { name: "Code" }));
    expect(await screen.findByText("No code files.")).toBeInTheDocument();
  });

  it("Trades table scrolls inside its own wrapper and right-aligns nothing it should not", async () => {
    mockRun({
      status: "success",
      run_id: "tr-1",
      trade_log: [{ timestamp: "2024-01-02", code: "BTC-USDT", side: "buy", price: 42000.5, qty: 0.1 }],
    } as Partial<RunData>);
    renderRun("/runs/tr-1");
    await screen.findByRole("link", { name: "Run on paper" });
    fireEvent.click(screen.getByRole("tab", { name: "Trades" }));
    const table = await screen.findByRole("table");
    expect(table.parentElement).toHaveClass("overflow-x-auto");
  });

  it("long prompts clamp and expand without changing the rest of the page", async () => {
    mockRun({ status: "success", run_id: "p1", prompt: "line\n".repeat(20) });
    renderRun("/runs/p1");
    const toggle = await screen.findByRole("button", { name: "Show full prompt" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
  });
});

describe("T08 Compare page", () => {
  beforeEach(() => {
    apiMock.listRuns.mockReset();
    apiMock.getRun.mockReset();
    toastMock.error.mockReset();
  });

  it("renders a page heading and labelled Baseline / Compare selects", async () => {
    apiMock.listRuns.mockResolvedValue([]);
    render(<Compare />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(/compar/i);
    expect(await screen.findByLabelText("Baseline")).toHaveRole("combobox");
    expect(screen.getByLabelText("Compare")).toHaveRole("combobox");
    expect(screen.getByRole("button", { name: "Swap" })).toBeInTheDocument();
  });

  it("no runs: empty state, no table, no getRun calls", async () => {
    apiMock.listRuns.mockResolvedValue([]);
    render(<Compare />);
    expect(await screen.findByText("Select two runs to compare their metrics.")).toBeInTheDocument();
    expect(screen.queryByRole("table")).toBeNull();
    expect(apiMock.getRun).not.toHaveBeenCalled();
  });

  it("listRuns failure toasts the error and keeps the empty state", async () => {
    apiMock.listRuns.mockRejectedValue(new Error("offline"));
    render(<Compare />);
    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith("offline"));
    expect(screen.getByText("Select two runs to compare their metrics.")).toBeInTheDocument();
  });

  it("swap exchanges the two selections", async () => {
    apiMock.listRuns.mockResolvedValue([
      { run_id: "b", prompt: "B", status: "success" },
      { run_id: "a", prompt: "A", status: "success" },
    ]);
    apiMock.getRun.mockImplementation((id: string) => Promise.resolve({ status: "success", run_id: id, metrics: {} }));
    render(<Compare />);
    const left = await screen.findByLabelText("Baseline");
    await waitFor(() => expect(left).toHaveValue("a"));
    expect(screen.getByLabelText("Compare")).toHaveValue("b");
    fireEvent.click(screen.getByRole("button", { name: "Swap" }));
    expect(screen.getByLabelText("Baseline")).toHaveValue("b");
    expect(screen.getByLabelText("Compare")).toHaveValue("a");
  });

  async function renderWithMetrics(left: Record<string, number>, right: Record<string, number>) {
    apiMock.listRuns.mockResolvedValue([
      { run_id: "r", prompt: "R", status: "success" },
      { run_id: "l", prompt: "L", status: "success" },
    ]);
    apiMock.getRun.mockImplementation((id: string) =>
      Promise.resolve({ status: "success", run_id: id, metrics: id === "l" ? left : right }));
    render(<Compare />);
    return screen.findByRole("table");
  }

  it("results use the Table primitive with numeric right-aligned tabular columns", async () => {
    const table = await renderWithMetrics({ total_return: 0.1 }, { total_return: 0.3 });
    expect(table.parentElement).toHaveClass("overflow-x-auto", "rounded-lg", "border");
    const headers = within(table).getAllByRole("columnheader");
    expect(headers.map((h) => h.textContent)).toEqual(["Metric", "Baseline", "Compare", "Delta"]);
    for (const h of headers.slice(1)) expect(h).toHaveClass("text-right", "tabular-nums");
    const row = within(table).getByText("Total Return").closest("tr")!;
    const cells = within(row).getAllByRole("cell");
    expect(cells[1]).toHaveTextContent("10.00%");
    expect(cells[2]).toHaveTextContent("30.00%");
    expect(cells[3]).toHaveTextContent("+20.00%");
    expect(cells[3]).toHaveClass("text-right", "tabular-nums");
  });

  it("missing metrics render a placeholder that is not an em dash", async () => {
    const table = await renderWithMetrics({ total_return: 0.1 }, {});
    await within(table).findByText("10.00%");
    expect(table.textContent).not.toContain("—");
  });
});

describe("T08 Reports page", () => {
  beforeEach(() => { apiMock.listRuns.mockReset(); });

  const REPORTS = [
    { run_id: "up", status: "success", created_at: "2026-06-04T00:00:00Z", prompt: "Up", codes: ["BTC-USDT"], total_return: 0.12, sharpe: 1.8, start_date: "2024-01-01", end_date: "2024-12-31" },
    { run_id: "down", status: "failed", created_at: "2026-06-02T00:00:00Z", prompt: "", codes: [], total_return: -0.07 },
    { run_id: "flat", status: "success", created_at: "not-a-date", prompt: "Flat", codes: [], total_return: 0, sharpe: Number.NaN },
  ];

  it("lists reports in a Table with numeric right-aligned metrics colored by sign", async () => {
    apiMock.listRuns.mockResolvedValue(REPORTS);
    render(<Reports />, { wrapper: MemoryRouter });
    const table = await screen.findByRole("table");
    expect(table.parentElement).toHaveClass("overflow-x-auto");
    const cell = (id: string, idx: number) =>
      within(within(table).getByRole("link", { name: id }).closest("tr")!).getAllByRole("cell")[idx];
    expect(cell("up", 1)).toHaveClass("text-right", "tabular-nums", "text-success");
    expect(cell("down", 1)).toHaveClass("text-danger");
    expect(cell("flat", 1).className).not.toMatch(/text-(success|danger)/);
    expect(cell("down", 2)).toHaveTextContent("-");
    expect(cell("flat", 2)).toHaveTextContent("-");
    expect(table.textContent).not.toContain("—");
  });

  it("status Badges, unknown date fallback and no-prompt copy", async () => {
    apiMock.listRuns.mockResolvedValue(REPORTS);
    render(<Reports />, { wrapper: MemoryRouter });
    const table = await screen.findByRole("table");
    expect(within(table).getAllByText("success").length).toBe(2);
    expect(within(table).getByText("failed")).toBeInTheDocument();
    expect(screen.getByText("not-a-date")).toBeInTheDocument();
    expect(screen.getByText("No prompt recorded.")).toBeInTheDocument();
    expect(screen.getByText(/2024-01-01\s+to\s+2024-12-31/)).toBeInTheDocument();
  });

  it("status filter narrows rows and updates the count", async () => {
    apiMock.listRuns.mockResolvedValue(REPORTS);
    render(<Reports />, { wrapper: MemoryRouter });
    await screen.findByRole("table");
    expect(screen.getByText("3 of 3 reports")).toBeInTheDocument();
    fireEvent.change(screen.getByRole("combobox", { name: "Status" }), { target: { value: "failed" } });
    expect(screen.getByText("1 of 3 reports")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "down" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "up" })).toBeNull();
  });

  it("search with no matches shows the no-matches empty state without a start link", async () => {
    apiMock.listRuns.mockResolvedValue(REPORTS);
    render(<Reports />, { wrapper: MemoryRouter });
    await screen.findByRole("table");
    fireEvent.change(screen.getByRole("textbox", { name: "Search" }), { target: { value: "zzz-no-such" } });
    expect(screen.getByText("No matching reports")).toBeInTheDocument();
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.queryByRole("link", { name: "Start with the research assistant" })).toBeNull();
  });

  it("whitespace-only search matches everything", async () => {
    apiMock.listRuns.mockResolvedValue(REPORTS);
    render(<Reports />, { wrapper: MemoryRouter });
    await screen.findByRole("table");
    fireEvent.change(screen.getByRole("textbox", { name: "Search" }), { target: { value: "   " } });
    expect(screen.getByText("3 of 3 reports")).toBeInTheDocument();
  });

  it("sorting by return puts the best report first", async () => {
    apiMock.listRuns.mockResolvedValue(REPORTS);
    render(<Reports />, { wrapper: MemoryRouter });
    await screen.findByRole("table");
    fireEvent.change(screen.getByRole("combobox", { name: "Sort" }), { target: { value: "return_desc" } });
    const ids = screen.getAllByRole("link", { name: /^(up|down|flat)$/ }).map((a) => a.textContent);
    expect(ids).toEqual(["up", "flat", "down"]);
  });

  it("load error shows the warning card, not the empty state", async () => {
    apiMock.listRuns.mockImplementation(() => Promise.reject(new Error("boom")));
    render(<Reports />, { wrapper: MemoryRouter });
    expect(await screen.findByText("Report library unavailable")).toBeInTheDocument();
    expect(screen.getByText("boom")).toBeInTheDocument();
    expect(screen.queryByText("No reports yet")).toBeNull();
  });

  it("non-array listRuns result is treated as empty", async () => {
    apiMock.listRuns.mockResolvedValue({ unexpected: true });
    render(<Reports />, { wrapper: MemoryRouter });
    expect(await screen.findByText("No reports yet")).toBeInTheDocument();
  });

  it("refresh re-fetches and the page has one h1", async () => {
    apiMock.listRuns.mockResolvedValue([]);
    render(<Reports />, { wrapper: MemoryRouter });
    await screen.findByText("No reports yet");
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: /Refresh/ }));
    await waitFor(() => expect(apiMock.listRuns).toHaveBeenCalledTimes(2));
  });

  it("row actions wrap so the row survives narrow widths", async () => {
    apiMock.listRuns.mockResolvedValue(REPORTS.slice(0, 1));
    render(<Reports />, { wrapper: MemoryRouter });
    const full = await screen.findByRole("link", { name: /Full Report/ });
    expect(full).toHaveAttribute("href", "/runs/up");
    expect(full.parentElement).toHaveClass("flex-wrap");
  });
});
