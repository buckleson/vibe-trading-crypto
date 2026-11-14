import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router";
import { PaperTrading } from "../PaperTrading";
import { paperRunsApi, type PaperRun, type PaperRunDetail } from "@/lib/paperRuns";
import { api } from "@/lib/api";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      let s = (opts?.defaultValue as string | undefined) ?? key;
      for (const [k, v] of Object.entries(opts ?? {})) s = s.replace(`{{${k}}}`, String(v));
      return s;
    },
  }),
}));
vi.mock("@/components/charts/EquityChart", () => ({ EquityChart: () => <div data-testid="equity-chart" /> }));
vi.mock("@/lib/api", () => ({ api: { listRuns: vi.fn() }, paperApi: { list: vi.fn(), history: vi.fn() } }));
vi.mock("@/lib/paperRuns", async (orig) => ({
  ...(await orig<typeof import("@/lib/paperRuns")>()),
  paperRunsApi: { list: vi.fn(), create: vi.fn(), get: vi.fn(), refresh: vi.fn(), stop: vi.fn(), remove: vi.fn() },
}));

const fresh = new Date().toISOString();
const mkRun = (over: Partial<PaperRun> = {}): PaperRun => ({
  id: "p1", label: "BTC paper", source_run_id: "r1", codes: ["BTC-USDT"], source: "okx", interval: "4H",
  initial_cash: 10000, started_at: "2026-01-01T10:00:00+00:00", evaluation_start: "2026-01-01T12:00:00",
  warmup_start: "2025-07-01", status: "active", stopped_at: null, last_refreshed_at: fresh, state: "ok", last_error: null,
  summary: { equity: 11000, pnl: 1000, total_return: 0.1, max_drawdown: -0.02, sharpe: null, trade_count: 2, bars: 5, as_of: "x" },
  ...over,
});
const mkDetail = (run: PaperRun): PaperRunDetail => ({
  run,
  equity: [{ time: "a", equity: 1, drawdown: 0 }, { time: "b", equity: 2, drawdown: 0 }],
  trades: [{ time: "2026-01-02 00:00:00", symbol: "BTC-USDT", side: "sell", price: 110, qty: 1, pnl: 10, return_pct: 0.1, event: "exit", reason: null }],
  positions: [],
});
const Loc = () => <div data-testid="loc">{useLocation().search}</div>;
const renderAt = (url = "/paper-trading") =>
  render(<MemoryRouter initialEntries={[url]}><PaperTrading /><Loc /></MemoryRouter>);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(paperRunsApi.list).mockResolvedValue([]);
  vi.mocked(api.listRuns).mockResolvedValue([
    { run_id: "r1", status: "success", created_at: "", total_return: 0.25, codes: ["BTC-USDT"] },
    { run_id: "r2", status: "failed", created_at: "" },
  ]);
});

test("shows the empty state", async () => {
  renderAt();
  expect(await screen.findByText("No paper runs yet")).toBeInTheDocument();
});

test("lists runs with colored returns and state badges", async () => {
  vi.mocked(paperRunsApi.list).mockResolvedValue([
    mkRun(),
    mkRun({ id: "p2", label: "Loser", state: "waiting", summary: { ...mkRun().summary!, total_return: -0.05, equity: 9500 } }),
  ]);
  renderAt();
  const gain = await screen.findByText(/^\+10[.,]00%$/);
  expect(gain).toHaveClass("text-success");
  expect(screen.getByText(/-5[.,]00%/)).toHaveClass("text-danger");
  expect(screen.getByText("Waiting for data")).toBeInTheDocument();
  expect(screen.getAllByText("Active")).toHaveLength(2);
});

test("selecting a run shows stats and trades, no refresh when fresh", async () => {
  const run = mkRun();
  vi.mocked(paperRunsApi.list).mockResolvedValue([run]);
  vi.mocked(paperRunsApi.get).mockResolvedValue(mkDetail(run));
  renderAt();
  fireEvent.click(await screen.findByRole("button", { name: /BTC paper/ }));
  expect(await screen.findByText("Trade history")).toBeInTheDocument();
  expect(screen.getByTestId("equity-chart")).toBeInTheDocument();
  expect(screen.getByText("Sharpe").nextSibling).toHaveTextContent("n/a");
  expect(screen.getByText("No open positions")).toBeInTheDocument();
  expect(screen.getByTestId("loc")).toHaveTextContent("run=p1");
  expect(paperRunsApi.refresh).not.toHaveBeenCalled();
});

test("waiting state banner", async () => {
  const run = mkRun({ state: "waiting", summary: null });
  vi.mocked(paperRunsApi.list).mockResolvedValue([run]);
  vi.mocked(paperRunsApi.get).mockResolvedValue({ ...mkDetail(run), equity: [], trades: [] });
  renderAt("/paper-trading?run=p1");
  expect(await screen.findByText(/Waiting for the first bars after 2026-01-01 12:00:00/)).toBeInTheDocument();
  expect(screen.getByText("The equity curve appears after two bars.")).toBeInTheDocument();
});

test("refreshes once when stale", async () => {
  const run = mkRun({ last_refreshed_at: null, state: "waiting", summary: null });
  vi.mocked(paperRunsApi.list).mockResolvedValue([run]);
  vi.mocked(paperRunsApi.get).mockResolvedValue(mkDetail(run));
  vi.mocked(paperRunsApi.refresh).mockResolvedValue(mkDetail(mkRun()));
  renderAt("/paper-trading?run=p1");
  await waitFor(() => expect(paperRunsApi.refresh).toHaveBeenCalledTimes(1));
  expect((await screen.findAllByText(/^11[.,]000[.,]00$/)).length).toBeGreaterThan(0);
});

test("refreshes every five minutes while active and visible", async () => {
  const run = mkRun();
  vi.mocked(paperRunsApi.list).mockResolvedValue([run]);
  vi.mocked(paperRunsApi.get).mockResolvedValue(mkDetail(run));
  vi.mocked(paperRunsApi.refresh).mockResolvedValue(mkDetail(run));
  vi.useFakeTimers({ shouldAdvanceTime: true });
  try {
    renderAt("/paper-trading?run=p1");
    await screen.findByText("Trade history");
    expect(paperRunsApi.refresh).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(5 * 60_000 + 10); });
    expect(paperRunsApi.refresh).toHaveBeenCalledTimes(1);
  } finally {
    vi.useRealTimers();
  }
});

test("start dialog creates a run and selects it", async () => {
  const created = mkRun({ id: "new1", label: "Mine", last_refreshed_at: null, state: "waiting", summary: null });
  vi.mocked(paperRunsApi.create).mockResolvedValue(created);
  vi.mocked(paperRunsApi.get).mockResolvedValue(mkDetail(created));
  vi.mocked(paperRunsApi.refresh).mockResolvedValue(mkDetail(created));
  renderAt();
  fireEvent.click(await screen.findByRole("button", { name: "Start paper run" }));
  const dialog = await screen.findByRole("dialog");
  const select = within(dialog).getByLabelText("Backtest run");
  await waitFor(() => expect(within(select).getAllByRole("option")).toHaveLength(1));
  expect(within(select).getByRole("option")).toHaveTextContent(/^r1 \(BTC-USDT, 25[.,]00%\)$/);
  fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "Mine" } });
  fireEvent.change(within(dialog).getByLabelText("Starting cash"), { target: { value: "5000" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Start paper run" }));
  await waitFor(() => expect(paperRunsApi.create).toHaveBeenCalledWith({ run_id: "r1", label: "Mine", initial_cash: 5000 }));
  await waitFor(() => expect(screen.getByTestId("loc")).toHaveTextContent("run=new1"));
  await waitFor(() => expect(paperRunsApi.refresh).toHaveBeenCalledWith("new1"));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

test("from_run preselects and is removed from the URL", async () => {
  renderAt("/paper-trading?from_run=zzz");
  const dialog = await screen.findByRole("dialog");
  await waitFor(() => expect(within(dialog).getByLabelText("Backtest run")).toHaveValue("zzz"));
  expect(screen.getByTestId("loc")).not.toHaveTextContent("from_run");
});

test("stop and delete call the API after confirming", async () => {
  const run = mkRun();
  vi.mocked(paperRunsApi.list).mockResolvedValue([run]);
  vi.mocked(paperRunsApi.get).mockResolvedValue(mkDetail(run));
  vi.mocked(paperRunsApi.stop).mockResolvedValue(mkDetail(mkRun({ status: "stopped" })));
  vi.mocked(paperRunsApi.remove).mockResolvedValue({ deleted: true });
  renderAt("/paper-trading?run=p1");
  fireEvent.click(await screen.findByRole("button", { name: "Stop" }));
  expect(paperRunsApi.stop).not.toHaveBeenCalled();
  const stopDlg = await screen.findByRole("alertdialog");
  fireEvent.click(within(stopDlg).getByRole("button", { name: "Stop" }));
  await waitFor(() => expect(paperRunsApi.stop).toHaveBeenCalledWith("p1"));
  await waitFor(() => expect(screen.queryByRole("button", { name: "Stop" })).not.toBeInTheDocument());
  fireEvent.click(screen.getByRole("button", { name: "Delete" }));
  const delDlg = await screen.findByRole("alertdialog");
  fireEvent.click(within(delDlg).getByRole("button", { name: "Delete" }));
  await waitFor(() => expect(paperRunsApi.remove).toHaveBeenCalledWith("p1"));
  await waitFor(() => expect(screen.getByTestId("loc")).not.toHaveTextContent("run=p1"));
});
