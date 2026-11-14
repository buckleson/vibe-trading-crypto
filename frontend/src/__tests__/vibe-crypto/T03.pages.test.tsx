// T03: chart color fallbacks and palette, P&L colors, the rebuilt Home (/about)
// page, router PageLoader and the stub modules later tasks replace. Offline.
import fs from "node:fs";
import path from "node:path";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import i18n from "@/i18n";
import { getChartTheme, SERIES_DARK, SERIES_LIGHT } from "@/lib/chart-theme";
import { getPnlColors } from "@/lib/pnl-colors";
import { Home } from "@/pages/Home";

const FRONTEND = path.resolve(__dirname, "../../..");
const html = document.documentElement;

beforeAll(async () => { await i18n.changeLanguage("en"); });

function setTheme({ dark = false, lang = "en" }: { dark?: boolean; lang?: string }) {
  html.className = dark ? "dark" : "";
  html.lang = lang;
}
afterEach(() => {
  setTheme({});
  for (const v of ["--success", "--danger", "--chart-grid"]) html.style.removeProperty(v);
});

// ── chart theme ──────────────────────────────────────────────────────

describe("T03 chart theme", () => {
  it("series palettes are the BRIEF categorical colors", () => {
    expect(SERIES_LIGHT).toEqual(["#1555E0", "#B36205", "#0F8A7E", "#C2417A", "#5C6370", "#7A8F0E"]);
    expect(SERIES_DARK).toEqual(["#5090F7", "#F6AA28", "#2CC5B4", "#E879A8", "#98A0AE", "#B5CC3A"]);
  });

  it("light fallbacks (no CSS loaded in jsdom) use the BRIEF light hexes", () => {
    setTheme({ dark: false });
    const t = getChartTheme();
    expect(t.seriesPalette).toEqual(SERIES_LIGHT);
    expect(t.upColor).toBe("#1D7C50");
    expect(t.downColor).toBe("#C52020");
    expect(t.gridColor).toBe("#EDEFF2");
    expect(t.textColor).toBe("#5C6370");
    expect(t.axisColor).toBe("#DCDFE5");
    expect(t.infoColor).toBe("#0A73A4");
    expect(t.warningColor).toBe("#A95C04");
    expect(t.tooltipText).toBe("#121621");
  });

  it("dark fallbacks use the BRIEF dark hexes", () => {
    setTheme({ dark: true });
    const t = getChartTheme();
    expect(t.seriesPalette).toEqual(SERIES_DARK);
    expect(t.upColor).toBe("#39C684");
    expect(t.downColor).toBe("#EE6363");
    expect(t.gridColor).toBe("#22262F");
    expect(t.textColor).toBe("#98A0AE");
    expect(t.axisColor).toBe("#303540");
    expect(t.tooltipBorder).toBe("#303540");
  });

  it.each(["zh", "zh-CN", "zh-TW"])("keeps the red-up convention for %s", (lang) => {
    setTheme({ lang });
    const t = getChartTheme();
    expect(t.upColor).toBe("#C52020");
    expect(t.downColor).toBe("#1D7C50");
    expect(t.volumeUp).toBe("#C5202066");
  });

  it("cache is invalidated when the theme class changes", () => {
    setTheme({ dark: false });
    const light = getChartTheme();
    expect(getChartTheme()).toBe(light);
    setTheme({ dark: true });
    expect(getChartTheme()).not.toBe(light);
    expect(getChartTheme().seriesPalette).toEqual(SERIES_DARK);
  });

  it("bollinger and MA colors derive from the palette, not hard-coded purples", () => {
    setTheme({});
    const t = getChartTheme();
    expect(t.bollColor).toBe("#1555E080");
    expect(t.maColors).toHaveLength(3);
    for (const c of [...t.maColors, t.bollColor, ...t.seriesPalette]) {
      expect(c).toMatch(/^#[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?$/);
      expect(c.toLowerCase()).not.toMatch(/^#(8b5cf6|a855f7|7c3aed|9333ea)/);
    }
  });

  it("reads live token values when they are set on the root", () => {
    setTheme({ lang: "en" });
    html.style.setProperty("--success", "120 100% 25%");
    html.className = "x-live"; // bust the cache
    const t = getChartTheme();
    expect(t.upColor.toLowerCase()).toBe("#008000");
  });
});

describe("T03 P&L colors", () => {
  it("light: green profit, red loss, neutral #EDEFF2", () => {
    setTheme({});
    expect(getPnlColors()).toEqual({ profit: "#1D7C50", loss: "#C52020", neutral: "#EDEFF2" });
  });

  it("dark: neutral #22262F", () => {
    setTheme({ dark: true });
    expect(getPnlColors()).toEqual({ profit: "#39C684", loss: "#EE6363", neutral: "#22262F" });
  });

  it("is not flipped by the zh red-up convention", () => {
    setTheme({ lang: "zh-CN" });
    expect(getPnlColors().profit).toBe("#1D7C50");
    expect(getPnlColors().loss).toBe("#C52020");
  });
});

// ── Home (/about) ────────────────────────────────────────────────────

describe("T03 Home page", () => {
  beforeEach(() => setTheme({}));
  const renderHome = () => render(<MemoryRouter><Home /></MemoryRouter>);

  it("has one h1 page title with a summary", () => {
    renderHome();
    const h1s = screen.getAllByRole("heading", { level: 1 });
    expect(h1s).toHaveLength(1);
    expect(h1s[0].textContent!.length).toBeGreaterThan(0);
    expect(h1s[0].className).toMatch(/text-xl/);
  });

  it("shows four feature cards in a 2x2 grid with 16px icons", () => {
    const { container } = renderHome();
    const grid = container.querySelector(".sm\\:grid-cols-2")!;
    expect(grid).not.toBeNull();
    expect(grid.children).toHaveLength(4);
    for (const card of Array.from(grid.children)) {
      expect(card.className).toMatch(/rounded-lg/);
      expect(within(card as HTMLElement).getByRole("heading")).toBeInTheDocument();
      const icon = card.querySelector("svg")!;
      expect(icon.getAttribute("class")).toMatch(/\bh-4\b.*\bw-4\b/);
      expect(card.querySelector("p")!.textContent!.length).toBeGreaterThan(10);
    }
  });

  it("'How it works' is a plain unnumbered list with icons", () => {
    const { container } = renderHome();
    const heading = screen.getByRole("heading", { name: "How it works" });
    const section = heading.closest("section")!;
    expect(section.querySelector("ol")).toBeNull();
    const items = within(section).getAllByRole("listitem");
    expect(items.length).toBeGreaterThanOrEqual(3);
    for (const li of items) {
      expect(li.querySelector("svg")).not.toBeNull();
      expect(li.textContent!.trim()).not.toMatch(/^(\d+|0\d)[.)]?\s/);
    }
    expect(container.innerHTML).not.toMatch(/list-decimal|rounded-full/);
  });

  it("has a primary action that goes to '/'", () => {
    renderHome();
    const link = screen.getByRole("link", { name: /Start researching/ });
    expect(link).toHaveAttribute("href", "/");
    const primary = Array.from(document.querySelectorAll("button")).filter((b) => b.className.includes("bg-primary"));
    expect(primary).toHaveLength(1);
  });

  it("no serif, gradient, em dash or uppercase in the rendered page", () => {
    const { container } = renderHome();
    expect(container.innerHTML).not.toMatch(/font-serif|gradient|uppercase|tracking-wide/);
    expect(container.textContent).not.toContain("—");
  });

  it("renders in another locale without crashing (defaults fill missing keys)", async () => {
    await i18n.changeLanguage("de");
    renderHome();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(document.body.textContent).not.toMatch(/about\.\w+/);
    await i18n.changeLanguage("en");
  });
});

// ── router PageLoader ───────────────────────────────────────────────

describe("T03 router PageLoader", () => {
  const SRC = fs.readFileSync(path.join(FRONTEND, "src/router.tsx"), "utf8");
  const loader = SRC.slice(SRC.indexOf("function PageLoader"), SRC.indexOf("function wrap"));

  it("is a centered Loader2 spinner with 13px muted text and role=status", () => {
    expect(loader).toMatch(/<Loader2[^>]*animate-spin/);
    expect(loader).toMatch(/items-center/);
    expect(loader).toMatch(/justify-center/);
    expect(loader).toMatch(/text-\[13px\]/);
    expect(loader).toMatch(/text-muted-foreground/);
    expect(loader).toMatch(/role="status"/);
    expect(loader).not.toContain("—");
  });

  it.each([
    "/", "/about", "/agent", "/pixel-office", "/runtime", "/scheduled", "/reports", "/research-artifacts", "/research-lab",
    "/paper-trading", "/portfolio", "/settings", "/runs/:runId", "/compare", "/correlation", "/options", "/alpha-zoo",
  ])("keeps route %s", (p) => {
    expect(SRC).toContain(`path: "${p}"`);
  });
});

// ── stubs ────────────────────────────────────────────────────────────

describe("T03 stub modules", () => {
  it("TerminalPanel renders an empty state and terminalAvailable() is false", async () => {
    const mod = await vi.importActual<typeof import("@/components/terminal/TerminalPanel")>("@/components/terminal/TerminalPanel");
    expect(mod.terminalAvailable()).toBe(false);
    expect(typeof mod.TerminalPanel).toBe("function");
    const { container } = render(<mod.TerminalPanel />);
    expect(container.textContent!.length).toBeGreaterThan(0);
    expect(container.textContent).not.toContain("—");
  });

  it("WalletButton renders nothing", async () => {
    const { WalletButton } = await vi.importActual<typeof import("@/components/wallet/WalletButton")>("@/components/wallet/WalletButton");
    const { container } = render(<WalletButton />);
    expect(container).toBeEmptyDOMElement();
  });

  it("stub files export exactly the expected names", async () => {
    expect(Object.keys(await vi.importActual("@/components/claude/ChatPanel")).sort()).toEqual(["ChatPanel"]);
    expect(Object.keys(await vi.importActual("@/components/terminal/TerminalPanel")).sort()).toEqual(["TerminalPanel", "terminalAvailable"]);
    expect(Object.keys(await vi.importActual("@/components/wallet/WalletButton")).sort()).toEqual(["WalletButton"]);
  });
});
