// T10: behaviour of the redesigned analysis pages. Every api function is a
// vi.fn (via a Proxy) that by default never resolves, so nothing reaches the
// network; individual tests set the replies they need.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";

const apiFns = vi.hoisted(() => new Map<string, any>());
vi.mock("@/lib/api", () => ({
  api: new Proxy({}, {
    get(_t, key: string) {
      if (!apiFns.has(key)) apiFns.set(key, vi.fn(() => new Promise(() => {})));
      return apiFns.get(key);
    },
  }),
}));
vi.mock("@/lib/shannon", () => ({ shannon: { status: vi.fn().mockResolvedValue({ configured: false }) } }));
vi.mock("@/hooks/useChartLifecycle", () => ({ useChartLifecycle: vi.fn() }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));

import { api } from "@/lib/api";
import { toast } from "sonner";
import i18n from "@/i18n";
import { clearAnalysisState } from "@/hooks/useAnalysisState";
import { AlphaZoo } from "@/pages/AlphaZoo";
import { Correlation } from "@/pages/Correlation";
import { OptionsLab } from "@/pages/OptionsLab";
import { PixelOffice } from "@/pages/PixelOffice";
import { ResearchArtifacts } from "@/pages/ResearchArtifacts";
import { ResearchLab } from "@/pages/ResearchLab";
import type { OfficeSnapshot } from "@/lib/api";

const fn = (name: string) => (api as unknown as Record<string, ReturnType<typeof vi.fn>>)[name];

beforeEach(async () => {
  apiFns.clear();
  await i18n.changeLanguage("en");
  clearAnalysisState("alpha-browse");
  clearAnalysisState("correlation");
  clearAnalysisState("options");
});
afterEach(() => cleanup());

const h1 = () => screen.getByRole("heading", { level: 1 });

describe("page headers (PageHeader renders the single h1)", () => {
  it("AlphaZoo browse view: 'Alpha zoo'", () => {
    render(<MemoryRouter initialEntries={["/alpha-zoo"]}><AlphaZoo /></MemoryRouter>);
    expect(h1()).toHaveTextContent(/^alpha zoo$/i);
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });

  it("ResearchLab: 'Research lab'", () => {
    render(<MemoryRouter><ResearchLab /></MemoryRouter>);
    expect(h1()).toHaveTextContent(/^research lab$/i);
  });

  it("ResearchArtifacts: 'Research artifacts'", () => {
    render(<MemoryRouter><ResearchArtifacts /></MemoryRouter>);
    expect(h1()).toHaveTextContent(/^research artifacts$/i);
  });

  it("OptionsLab: 'Options lab'", () => {
    render(<MemoryRouter><OptionsLab /></MemoryRouter>);
    expect(h1()).toHaveTextContent(/^options lab$/i);
  });

  it("Correlation: correlation title", () => {
    render(<MemoryRouter><Correlation /></MemoryRouter>);
    expect(h1()).toHaveTextContent(/correlation/i);
  });

  it("PixelOffice: 'Pixel office'", () => {
    render(<PixelOffice />);
    expect(h1()).toHaveTextContent(/^pixel office$/i);
  });
});

describe("AlphaZoo browse: search, filters, empty state and compare URLs", () => {
  const alphas = [
    { id: "alpha101_001", zoo: "alpha101", theme: ["momentum"], universe: ["equity_us"], nickname: "Rank reversal", decay_horizon: 5 },
    { id: "alpha101_002", zoo: "alpha101", theme: ["volume"], universe: ["equity_us"], decay_horizon: null },
    { id: "gtja191_010", zoo: "gtja191", theme: ["momentum"], universe: ["equity_cn"] },
  ];
  const renderBrowse = async () => {
    fn("listAlphas").mockResolvedValue({ status: "ok", alphas, total: alphas.length, returned: alphas.length });
    render(<MemoryRouter initialEntries={["/alpha-zoo"]}><AlphaZoo /></MemoryRouter>);
    await screen.findByRole("link", { name: "alpha101_001" });
  };
  const table = () => screen.getByRole("table", { name: /alpha/i });
  const rowIds = () => within(table()).queryAllByRole("link").map((a) => a.textContent);

  it("lists every alpha with detail links and '-' for a missing decay", async () => {
    await renderBrowse();
    expect(rowIds()).toEqual(["alpha101_001", "alpha101_002", "gtja191_010"]);
    expect(screen.getByRole("link", { name: "alpha101_001" })).toHaveAttribute("href", "/alpha-zoo/alpha101_001");
    expect(fn("listAlphas")).toHaveBeenCalledWith({ limit: 1000 });
  });

  it("search matches id and nickname case-insensitively, trimming whitespace", async () => {
    await renderBrowse();
    fireEvent.change(screen.getByLabelText(/search/i), { target: { value: "  RANK " } });
    expect(rowIds()).toEqual(["alpha101_001"]);
    fireEvent.change(screen.getByLabelText(/search/i), { target: { value: "gtja" } });
    expect(rowIds()).toEqual(["gtja191_010"]);
  });

  it("zoo filter Select narrows the list; a no-match search shows the empty row", async () => {
    await renderBrowse();
    const zooSelect = screen.getAllByRole("combobox")[0];
    fireEvent.change(zooSelect, { target: { value: "gtja191" } });
    expect(rowIds()).toEqual(["gtja191_010"]);
    fireEvent.change(zooSelect, { target: { value: "" } });
    fireEvent.change(screen.getByLabelText(/search/i), { target: { value: "zzz-nothing" } });
    expect(rowIds()).toEqual([]);
    expect(within(table()).getAllByRole("row")).toHaveLength(2); // header + empty-state row
  });

  it("selecting two alphas builds the compare URL with both ids", async () => {
    await renderBrowse();
    const boxes = within(table()).getAllByRole("checkbox");
    fireEvent.click(boxes[0]);
    fireEvent.click(boxes[2]);
    const compare = screen.getAllByRole("link").find((a) => a.getAttribute("href")?.startsWith("/alpha-zoo/compare?ids="));
    expect(compare).toBeDefined();
    expect(compare!.getAttribute("href")).toBe("/alpha-zoo/compare?ids=alpha101_001,gtja191_010");
  });

  it("selecting one US alpha links straight to the bench sub-route with sp500", async () => {
    await renderBrowse();
    fireEvent.click(within(table()).getAllByRole("checkbox")[0]);
    const bench = screen.getAllByRole("link").find((a) => a.getAttribute("href")?.startsWith("/alpha-zoo/bench?"));
    expect(bench!.getAttribute("href")).toBe("/alpha-zoo/bench?alpha_id=alpha101_001&zoo=alpha101&universe=sp500");
  });

  it("load failure toasts the error and leaves an empty table instead of crashing", async () => {
    fn("listAlphas").mockRejectedValue(new Error("catalog offline"));
    render(<MemoryRouter initialEntries={["/alpha-zoo"]}><AlphaZoo /></MemoryRouter>);
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("catalog offline"));
    expect(rowIds()).toEqual([]);
  });

  it("the catalogue table scrolls inside its own wrapper (390px safe)", async () => {
    await renderBrowse();
    expect(table().parentElement!.className).toMatch(/overflow-x-auto/);
  });

  it("the bench and compare sub-routes still resolve to their own views", () => {
    render(<MemoryRouter initialEntries={["/alpha-zoo/compare"]}><AlphaZoo /></MemoryRouter>);
    expect(h1()).not.toHaveTextContent(/^alpha zoo$/i);
    cleanup();
    render(<MemoryRouter initialEntries={["/alpha-zoo/bench"]}><AlphaZoo /></MemoryRouter>);
    expect(screen.getAllByRole("heading").length).toBeGreaterThan(0);
  });
});

describe("ResearchArtifacts empty and error states", () => {
  it("shows the EmptyState when the search returns no artifacts", async () => {
    fn("searchResearchArtifacts").mockResolvedValue({ count: 0, artifacts: [] });
    render(<MemoryRouter><ResearchArtifacts /></MemoryRouter>);
    expect(await screen.findByText("No research artifacts yet")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows an alert when loading fails", async () => {
    fn("searchResearchArtifacts").mockRejectedValue(new Error("index unavailable"));
    render(<MemoryRouter><ResearchArtifacts /></MemoryRouter>);
    expect(await screen.findByRole("alert")).toHaveTextContent("index unavailable");
  });
});

describe("PixelOffice restyle", () => {
  const snapshot = (loads: number[]): OfficeSnapshot => ({
    mode: "manual_planning",
    agents: loads.map((load, i) => ({ id: `a${i}`, name: `Agent ${i}`, role: "research", rank: "Operator", color: ["#c59259", "#4f7cff", "#2cc5b4"][i % 3], load })),
    tasks: [],
  });
  const renderOffice = async (loads: number[]) => {
    fn("getPixelOffice").mockResolvedValue(snapshot(loads));
    const view = render(<PixelOffice />);
    await screen.findByRole("region", { name: "Office floor" });
    return view;
  };

  it("typing indicator renders only for agents with load > 0", async () => {
    const { container } = await renderOffice([0, 2, 1]);
    const desks = container.querySelectorAll(".pixel-desk");
    expect(desks).toHaveLength(3);
    expect(desks[0].querySelector(".pixel-character__typing")).toBeNull();
    expect(desks[1].querySelector(".pixel-character__typing")).not.toBeNull();
    expect(desks[2].querySelector(".pixel-character__typing")).not.toBeNull();
  });

  it("no agent active means no animated element at all", async () => {
    const { container } = await renderOffice([0, 0]);
    expect(container.querySelector(".pixel-character__typing")).toBeNull();
  });

  it("characters keep their sprite color through --pixel-color and are hidden from assistive tech", async () => {
    const { container } = await renderOffice([0, 1]);
    const chars = container.querySelectorAll<HTMLElement>(".pixel-character");
    expect(chars[0].style.getPropertyValue("--pixel-color")).toBe("#c59259");
    expect(chars[1].style.getPropertyValue("--pixel-color")).toBe("#4f7cff");
    for (const c of chars) expect(c).toHaveAttribute("aria-hidden", "true");
    for (const c of chars) expect(c.getAttribute("style") ?? "").not.toMatch(/filter|drop-shadow/);
  });

  it("floor section uses the pixel-office-floor class with a token border", async () => {
    await renderOffice([0]);
    const floor = screen.getByRole("region", { name: "Office floor" });
    expect(floor.className).toMatch(/pixel-office-floor/);
    expect(floor.className).toMatch(/border-border/);
    expect(floor.className).not.toMatch(/shadow|gradient|rounded-(xl|2xl|3xl)/);
  });

  it("clicking a desk selects that agent as the new-task assignee and marks it with a primary ring", async () => {
    const { container } = await renderOffice([0, 0]);
    const desks = container.querySelectorAll<HTMLButtonElement>(".pixel-desk");
    expect(desks[0].className).toMatch(/border-primary/);
    fireEvent.click(desks[1]);
    expect(desks[1].className).toMatch(/border-primary/);
    expect(desks[0].className).not.toMatch(/border-primary/);
    fireEvent.change(screen.getByLabelText("Task title"), { target: { value: "Check filings" } });
    fn("updatePixelOffice").mockResolvedValue(snapshot([0, 1]));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Create task" })); });
    expect(fn("updatePixelOffice")).toHaveBeenCalledWith("create", expect.objectContaining({ assigned_to: "a1", title: "Check filings" }));
  });

  it("zero agents still renders the floor and the empty task board", async () => {
    fn("getPixelOffice").mockResolvedValue({ mode: "manual_planning", agents: [], tasks: [] });
    const { container } = render(<PixelOffice />);
    await screen.findByText("No tasks yet.");
    expect(container.querySelectorAll(".pixel-desk")).toHaveLength(0);
  });

  it("while loading shows a status line, not a fabricated office", () => {
    render(<PixelOffice />);
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Office floor" })).not.toBeInTheDocument();
  });
});
