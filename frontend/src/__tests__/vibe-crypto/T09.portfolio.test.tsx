// T09: Portfolio page (header actions, Stat row, holdings Table, EmptyState,
// errors) and portfolio components (compatibility Badge tones, extraETF
// import form, rebalance proposal). Offline: api and echarts are mocked.
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import i18n from "@/i18n";
import { api } from "@/lib/api";
import { Portfolio } from "@/pages/Portfolio";
import { PortfolioCompatibilityBadge } from "@/components/portfolio/PortfolioCompatibilityBadge";
import { ExtraEtfImport } from "@/components/portfolio/ExtraEtfImport";
import { RebalanceProposal } from "@/components/portfolio/RebalanceProposal";

vi.mock("@/lib/echarts", () => ({
  echarts: { init: () => ({ setOption: vi.fn(), on: vi.fn(), off: vi.fn(), resize: vi.fn(), dispose: vi.fn() }) },
}));

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    api: {
      ...actual.api,
      getPortfolio: vi.fn(),
      getPortfolioHistory: vi.fn(),
      getPortfolioSettings: vi.fn(),
      getPortfolioRefreshStatus: vi.fn(),
      refreshPortfolio: vi.fn(),
      updatePortfolioSettings: vi.fn(),
      getConnections: vi.fn(),
      importExtraEtf: vi.fn(),
      proposePortfolioRebalance: vi.fn(),
      downloadPortfolioCsv: vi.fn(),
      getPortfolioAnalysisContext: vi.fn(),
    },
  };
});

type Fn = ReturnType<typeof vi.fn>;
const mocked = api as unknown as Record<string, Fn>;

const compat = { level: "native" as const, contract_version: 1, asset_scope: "stocks_etfs", note: "Dedicated mapping." };

const position = (over: Record<string, unknown> = {}) => ({
  broker: "ibkr", symbol: "AAPL", name: "Apple", asset_type: "stock", market: "US", currency: "USD",
  quantity: 2, cost_price: 100, market_price: 150, market_value_usd: 300, market_value_cny: 2160,
  unrealized_pnl_usd: 100, priced: true, updated_at: "2026-08-09T00:00:00Z", ...over,
});

const snapshot = (over: Record<string, unknown> = {}) => ({
  snapshot_id: "snap-1",
  created_at: "2026-08-09T12:00:00Z",
  complete: true,
  totals: { usd: 1000, cny: 7200 },
  valuation: { priced_usd: 800, cash_usd: 200, unpriced_or_other_usd: 0, identified_coverage: 1 },
  fx: { usd_cny: 7.2, usd_hkd: 7.8, fetched_at: "2026-08-09T00:00:00Z", stale: false },
  accounts: [
    { broker: "ibkr", status: "ok" as const, total_usd: 1000, total_cny: 7200, position_count: 2, last_success_at: "2026-08-09T00:00:00Z", portfolio_compatibility: compat },
  ],
  positions: [
    position(),
    position({ symbol: "TSLA", name: "Tesla", unrealized_pnl_usd: -50, market_value_usd: 200, market_value_cny: 1440 }),
  ],
  warnings: [],
  ...over,
});

const configuration = {
  status: "ok",
  settings: {
    display_currency: "USD" as const,
    sources: [{ connection_id: "ibkr", label: "IBKR", enabled: true, order: 0, include_cash: true }],
  },
  catalog: [],
};

beforeAll(async () => { await i18n.changeLanguage("en"); });
beforeEach(() => {
  vi.clearAllMocks();
  mocked.getPortfolio.mockResolvedValue({ status: "ok", snapshot: snapshot() });
  mocked.getPortfolioHistory.mockResolvedValue({ status: "ok", history: [] });
  mocked.getPortfolioSettings.mockResolvedValue(configuration);
  mocked.getPortfolioRefreshStatus.mockResolvedValue({ status: "ok", refresh: { running: false } });
  mocked.getConnections.mockResolvedValue({ connections: [] });
  mocked.getPortfolioAnalysisContext.mockResolvedValue({ status: "ok", context: {} });
});

async function renderLoaded() {
  render(<Portfolio />);
  await screen.findByRole("heading", { name: "Holdings" });
}

describe("Portfolio page header", () => {
  it("renders a Portfolio h1", async () => {
    await renderLoaded();
    expect(screen.getByRole("heading", { level: 1, name: "Portfolio" })).toBeInTheDocument();
  });

  it("has exactly one primary action (Refresh all); the rest are secondary", async () => {
    await renderLoaded();
    const h1 = screen.getByRole("heading", { level: 1, name: "Portfolio" });
    const header = h1.closest("header") ?? h1.parentElement!.parentElement!;
    const buttons = within(header as HTMLElement).getAllByRole("button");
    const primary = buttons.filter((b) => /\bbg-primary\b/.test(b.className));
    expect(primary).toHaveLength(1);
    expect(primary[0]).toHaveTextContent("Refresh all");
    for (const name of ["Manage accounts", "Export CSV", "Export research snapshot"]) {
      const button = within(header as HTMLElement).getByRole("button", { name });
      expect(button.className).toMatch(/border-border/);
    }
  });

  it("export buttons are disabled when there is no snapshot", async () => {
    mocked.getPortfolio.mockResolvedValue({ status: "ok", snapshot: null });
    render(<Portfolio />);
    await screen.findByText("No portfolio snapshot yet");
    expect(screen.getByRole("button", { name: "Export CSV" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Export research snapshot" })).toBeDisabled();
  });
});

describe("Portfolio states", () => {
  it("shows skeletons with aria-busy while loading", () => {
    mocked.getPortfolio.mockReturnValue(new Promise(() => {}));
    const { container } = render(<Portfolio />);
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(screen.queryByRole("heading", { name: "Holdings" })).not.toBeInTheDocument();
  });

  it("shows the EmptyState with an Add account primary action when there is no snapshot", async () => {
    mocked.getPortfolio.mockResolvedValue({ status: "ok", snapshot: null });
    render(<Portfolio />);
    expect(await screen.findByText("No portfolio snapshot yet")).toBeInTheDocument();
    expect(screen.getByText("Add at least one read-only account to begin.")).toBeInTheDocument();
    const add = screen.getByRole("button", { name: "Add account" });
    expect(add.className).toMatch(/bg-primary/);
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("shows an alert with the error message when loading fails", async () => {
    mocked.getPortfolio.mockRejectedValue(new Error("portfolio backend down"));
    render(<Portfolio />);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("portfolio backend down");
    expect(alert.className).toMatch(/text-danger/);
  });

  it("falls back to a generic message for non-Error rejections", async () => {
    mocked.getPortfolio.mockRejectedValue("nope");
    render(<Portfolio />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Portfolio unavailable");
  });

  it("lists snapshot warnings", async () => {
    mocked.getPortfolio.mockResolvedValue({ status: "ok", snapshot: snapshot({ warnings: ["IBKR quote delayed"] }) });
    await renderLoaded();
    expect(screen.getByText("Data notes")).toBeInTheDocument();
    expect(screen.getByText("IBKR quote delayed")).toBeInTheDocument();
  });
});

describe("Portfolio Stat row", () => {
  it("shows the four summary stats", async () => {
    await renderLoaded();
    for (const label of ["Total assets", "Today's asset change", "Valuation coverage", "Last complete update"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  const changeValue = () => screen.getByText("Today's asset change").nextElementSibling as HTMLElement;

  it("day change is '-' and neutral without same-day history", async () => {
    await renderLoaded();
    expect(changeValue()).toHaveTextContent(/^-$/);
    expect(changeValue().className).not.toMatch(/text-(success|danger)/);
  });

  it("positive day change is prefixed with + and colored success", async () => {
    mocked.getPortfolioHistory.mockResolvedValue({ status: "ok", history: [
      { created_at: "2026-08-09T01:00:00Z", total_usd: 900, total_cny: 6480 },
    ] });
    await renderLoaded();
    expect(changeValue().textContent).toMatch(/^\+/);
    expect(changeValue().textContent).toContain("100");
    expect(changeValue().className).toMatch(/text-success/);
  });

  it("negative day change is colored danger", async () => {
    mocked.getPortfolioHistory.mockResolvedValue({ status: "ok", history: [
      { created_at: "2026-08-09T01:00:00Z", total_usd: 1100, total_cny: 7920 },
    ] });
    await renderLoaded();
    expect(changeValue().textContent).not.toMatch(/^\+/);
    expect(changeValue().className).toMatch(/text-danger/);
  });

  it("zero day change counts as success (not danger)", async () => {
    mocked.getPortfolioHistory.mockResolvedValue({ status: "ok", history: [
      { created_at: "2026-08-09T01:00:00Z", total_usd: 1000, total_cny: 7200 },
    ] });
    await renderLoaded();
    expect(changeValue().className).toMatch(/text-success/);
  });

  it("warns that failed accounts are excluded from the total", async () => {
    mocked.getPortfolio.mockResolvedValue({ status: "ok", snapshot: snapshot({
      complete: false,
      accounts: [
        ...snapshot().accounts,
        { source_id: "b2", broker: "binance", label: "Binance", status: "error", error: "timeout", failure_kind: "transient", reconnect_required: false },
      ],
    }) });
    await renderLoaded();
    expect(screen.getByText(/could not be read and are excluded/)).toBeInTheDocument();
  });
});

describe("Portfolio holdings Table", () => {
  it("is wrapped in a horizontal scroll container so the page does not scroll at 390px", async () => {
    await renderLoaded();
    const table = screen.getAllByRole("table")[0];
    expect(table.parentElement!.className).toMatch(/overflow-x-auto/);
  });

  it("right-aligns numeric column headers", async () => {
    await renderLoaded();
    const table = screen.getAllByRole("table")[0];
    for (const name of ["Quantity", "Cost / Price", "Value", "Weight", "Unrealized P/L"]) {
      const th = within(table).getByRole("columnheader", { name });
      expect(th.className).toMatch(/text-right/);
      expect(th.className).toMatch(/tabular-nums/);
    }
    for (const name of ["Broker", "Symbol", "Type", "Data"]) {
      expect(within(table).getByRole("columnheader", { name }).className).toMatch(/text-left/);
    }
  });

  it("colors positive P&L success and negative P&L danger", async () => {
    await renderLoaded();
    const table = screen.getAllByRole("table")[0];
    const rows = within(table).getAllByRole("row").slice(1);
    const pnlOf = (symbol: string) => {
      const row = rows.find((r) => within(r).queryByText(symbol))!;
      const cells = within(row).getAllByRole("cell");
      return cells[7].querySelector("span")!;
    };
    expect(pnlOf("AAPL").className).toMatch(/text-success/);
    expect(pnlOf("TSLA").className).toMatch(/text-danger/);
  });

  it("shows '-' (not an em dash) for unpriced value and weight", async () => {
    mocked.getPortfolio.mockResolvedValue({ status: "ok", snapshot: snapshot({
      positions: [position({ symbol: "XYZ", priced: false, unrealized_pnl_usd: null })],
    }) });
    await renderLoaded();
    const table = screen.getAllByRole("table")[0];
    const row = within(table).getAllByRole("row")[1];
    const cells = within(row).getAllByRole("cell");
    expect(cells[6]).toHaveTextContent(/^-$/);
    expect(row.textContent).not.toContain("—");
    expect(within(row).getAllByText("Unpriced").length).toBeGreaterThan(0);
  });

  it("search filters rows by symbol", async () => {
    await renderLoaded();
    fireEvent.change(screen.getByLabelText("Search broker, symbol or market"), { target: { value: "tsla" } });
    const table = screen.getAllByRole("table")[0];
    await waitFor(() => expect(within(table).queryByText("AAPL")).not.toBeInTheDocument());
    expect(within(table).getByText("TSLA")).toBeInTheDocument();
  });

  it("search with no match leaves only the header row", async () => {
    await renderLoaded();
    fireEvent.change(screen.getByLabelText("Search broker, symbol or market"), { target: { value: "zzzz-none" } });
    const table = screen.getAllByRole("table")[0];
    await waitFor(() => expect(within(table).getAllByRole("row")).toHaveLength(1));
  });
});

describe("PortfolioCompatibilityBadge", () => {
  it.each([
    ["native", "Native adapter", /text-success/],
    ["contract_tested", "Contract-tested", /text-info/],
    ["experimental", "Experimental", /text-warning/],
  ] as const)("%s uses the Badge tone", (level, label, tone) => {
    render(<PortfolioCompatibilityBadge compatibility={{ ...compat, level, note: `note-${level}` }} />);
    const badge = screen.getByText(label);
    expect(badge.className).toMatch(tone);
    expect(badge).toHaveAttribute("title", `note-${level}`);
  });

  it("renders nothing without compatibility info", () => {
    const { container } = render(<PortfolioCompatibilityBadge />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("ExtraEtfImport", () => {
  function file(content: string, size?: number) {
    const f = new File([content], "investments.csv", { type: "text/csv", lastModified: Date.UTC(2026, 7, 1) });
    if (size !== undefined) Object.defineProperty(f, "size", { value: size });
    if (!("text" in f)) Object.defineProperty(f, "text", { value: () => Promise.resolve(content) });
    return f;
  }

  it("labels every field and keeps the submit disabled until a file is chosen", () => {
    render(<ExtraEtfImport onImported={vi.fn()} />);
    for (const label of ["Investments CSV", "Expected holdings count (confirm in extraETF)", "Maximum file age (days)"]) {
      expect(screen.getByLabelText(label)).toBeInTheDocument();
    }
    expect(screen.getByLabelText("Maximum file age (days)")).toHaveValue(7);
    const submit = screen.getByRole("button", { name: "Import file" });
    expect(submit).toBeDisabled();
    expect(submit.className).toMatch(/bg-primary/);
  });

  it("rejects files over 4 MiB without calling the API", async () => {
    const onImported = vi.fn();
    render(<ExtraEtfImport onImported={onImported} />);
    fireEvent.change(screen.getByLabelText("Investments CSV"), { target: { files: [file("x", 4 * 1024 * 1024 + 1)] } });
    fireEvent.change(screen.getByLabelText(/Account label|Label/i), { target: { value: "Depot" } });
    fireEvent.change(screen.getByLabelText("Expected holdings count (confirm in extraETF)"), { target: { value: "3" } });
    fireEvent.submit(screen.getByRole("button", { name: "Import file" }).closest("form")!);
    expect(await screen.findByRole("status")).toHaveTextContent("The import limit is 4 MiB.");
    expect(mocked.importExtraEtf).not.toHaveBeenCalled();
    expect(onImported).not.toHaveBeenCalled();
  });

  it("imports a valid file with numeric fields and reports success", async () => {
    mocked.importExtraEtf.mockResolvedValue({ status: "ok" });
    const onImported = vi.fn().mockResolvedValue(undefined);
    render(<ExtraEtfImport onImported={onImported} />);
    fireEvent.change(screen.getByLabelText("Investments CSV"), { target: { files: [file("isin,qty\nX,1")] } });
    fireEvent.change(screen.getByLabelText(/Account label|Label/i), { target: { value: "Depot" } });
    fireEvent.change(screen.getByLabelText("Expected holdings count (confirm in extraETF)"), { target: { value: "3" } });
    fireEvent.change(screen.getByLabelText("Maximum file age (days)"), { target: { value: "30" } });
    fireEvent.submit(screen.getByRole("button", { name: "Import file" }).closest("form")!);
    await waitFor(() => expect(onImported).toHaveBeenCalled());
    expect(mocked.importExtraEtf).toHaveBeenCalledWith(expect.objectContaining({
      csv_text: "isin,qty\nX,1", label: "Depot", expected_positions: 3, max_age_days: 30,
      source_mtime: new Date(Date.UTC(2026, 7, 1)).toISOString(),
    }));
    expect(await screen.findByRole("status")).toHaveTextContent(/^Imported\./);
  });

  it("surfaces an API error message", async () => {
    mocked.importExtraEtf.mockRejectedValue(new Error("count mismatch"));
    render(<ExtraEtfImport onImported={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Investments CSV"), { target: { files: [file("a")] } });
    fireEvent.submit(screen.getByRole("button", { name: "Import file" }).closest("form")!);
    expect(await screen.findByRole("status")).toHaveTextContent("count mismatch");
  });
});

describe("RebalanceProposal", () => {
  const withHoldings = (over: Record<string, unknown> = {}) => snapshot({
    combined_holdings: [{ canonical_id: "US:AAPL", value_usd: 800 }],
    ...over,
  }) as unknown as Parameters<typeof RebalanceProposal>[0]["snapshot"];

  it("renders as a Card with a target input per holding plus CASH", () => {
    render(<RebalanceProposal snapshot={withHoldings()} />);
    expect(screen.getByRole("heading", { name: "Allocation proposal" })).toBeInTheDocument();
    expect(screen.getByLabelText("US:AAPL target (%)")).toBeInTheDocument();
    expect(screen.getByLabelText("CASH target (%)")).toBeInTheDocument();
  });

  it("disables generation for an incomplete snapshot", () => {
    render(<RebalanceProposal snapshot={withHoldings({ complete: false })} />);
    expect(screen.getByRole("button", { name: "Calculate proposal" })).toBeDisabled();
  });

  it("disables generation without combined holdings", () => {
    render(<RebalanceProposal snapshot={snapshot() as never} />);
    expect(screen.getByRole("button", { name: "Calculate proposal" })).toBeDisabled();
  });

  it("sends percentages as fractions (blank = 0) and renders a right-aligned result table", async () => {
    mocked.proposePortfolioRebalance.mockResolvedValue({ proposal: { currency: "USD", rows: [
      { canonical_id: "US:AAPL", current_value: 800, target_value: 600, change_value: -200 },
    ] } });
    render(<RebalanceProposal snapshot={withHoldings()} />);
    fireEvent.change(screen.getByLabelText("US:AAPL target (%)"), { target: { value: "60" } });
    await act(async () => { fireEvent.submit(screen.getByRole("button", { name: "Calculate proposal" }).closest("form")!); });
    expect(mocked.proposePortfolioRebalance).toHaveBeenCalledWith("snap-1", { "US:AAPL": 0.6, CASH: 0 });
    const table = await screen.findByRole("table");
    expect(within(table).getByRole("columnheader", { name: "Value change" }).className).toMatch(/text-right/);
    expect(within(table).getByText("US:AAPL")).toBeInTheDocument();
  });

  it("shows API failures inline with role=alert", async () => {
    mocked.proposePortfolioRebalance.mockRejectedValue(new Error("weights must sum to 1"));
    render(<RebalanceProposal snapshot={withHoldings()} />);
    await act(async () => { fireEvent.submit(screen.getByRole("button", { name: "Calculate proposal" }).closest("form")!); });
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("weights must sum to 1");
    expect(alert.className).toMatch(/text-danger/);
  });
});
