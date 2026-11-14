// T03: app shell. Navigation model, sidebar, top bar, assistant dock and the
// Layout wiring between them. Offline: the API, agent store, theme hook and
// the lazy dock panels are mocked; i18n is the real English instance.
import fs from "node:fs";
import path from "node:path";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { LineChart, Settings } from "lucide-react";

const toggleTheme = vi.fn();
let darkState = false;

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@/hooks/useDarkMode", () => ({ useDarkMode: () => ({ dark: darkState, toggle: toggleTheme }) }));
vi.mock("@/lib/api", () => ({
  api: {
    listSessions: vi.fn(),
    deleteSession: vi.fn().mockResolvedValue(undefined),
    renameSession: vi.fn().mockResolvedValue(undefined),
  },
}));
vi.mock("@/stores/agent", () => ({
  useAgentStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ sseStatus: "connected", sseRetryAttempt: 0, streamingSessionId: null }),
}));
vi.mock("@/components/claude/ChatPanel", () => ({ ChatPanel: () => <div data-testid="chat-body">chat panel</div> }));
vi.mock("@/components/terminal/TerminalPanel", () => ({
  terminalAvailable: vi.fn(() => false),
  TerminalPanel: () => <div data-testid="terminal-body">terminal panel</div>,
}));
vi.mock("@/components/wallet/WalletButton", () => ({ WalletButton: () => <span data-testid="wallet-slot">wallet</span> }));

import i18n from "@/i18n";
import en from "@/i18n/locales/en.json";
import { api } from "@/lib/api";
import { terminalAvailable } from "@/components/terminal/TerminalPanel";
import { Layout } from "@/components/layout/Layout";
import { TopBar } from "@/components/layout/TopBar";
import { AssistantDock } from "@/components/layout/AssistantDock";
import { isNavigationActive, NAVIGATION_GROUPS, pageTitleKey, SETTINGS_ITEM } from "@/components/layout/navigation";

const FRONTEND = path.resolve(__dirname, "../../..");
const ROUTER_SRC = fs.readFileSync(path.join(FRONTEND, "src/router.tsx"), "utf8");
const listSessions = vi.mocked(api.listSessions);

beforeAll(async () => { await i18n.changeLanguage("en"); });
beforeEach(() => {
  window.localStorage.clear();
  vi.mocked(terminalAvailable).mockReturnValue(false);
  listSessions.mockResolvedValue([]);
  darkState = false;
  toggleTheme.mockClear();
  Object.defineProperty(window, "innerWidth", { configurable: true, writable: true, value: 1440 });
});
afterEach(() => { vi.mocked(api.renameSession).mockClear(); vi.mocked(api.deleteSession).mockClear(); });

function renderLayout(at = "/about") {
  return render(
    <MemoryRouter initialEntries={[at]}>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<div>agent page</div>} />
          <Route path="/about" element={<div>about page</div>} />
          <Route path="/paper-trading" element={<div>paper page</div>} />
          <Route path="/settings" element={<div>settings page</div>} />
          <Route path="/runs/:id" element={<div>run page</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}
const sidebar = () => screen.getByRole("complementary", { name: "Vibe Crypto sidebar" });
const claudeToggle = () => screen.getByRole("button", { name: /Claude/ });

// ── navigation model ─────────────────────────────────────────────────

describe("T03 navigation model", () => {
  it("groups are research, trade, analysis, automation in order", () => {
    expect(NAVIGATION_GROUPS.map((g) => g.id)).toEqual(["research", "trade", "analysis", "automation"]);
  });

  it("group items and routes are exactly as specified", () => {
    const shape = Object.fromEntries(NAVIGATION_GROUPS.map((g) => [g.id, g.items.map((i) => [i.id, i.to])]));
    expect(shape).toEqual({
      research: [["agent", "/"], ["reports", "/reports"], ["researchArtifacts", "/research-artifacts"]],
      trade: [["paperTrading", "/paper-trading"], ["portfolio", "/portfolio"]],
      analysis: [["alphaZoo", "/alpha-zoo"], ["researchLab", "/research-lab"], ["optionsLab", "/options"], ["correlation", "/correlation"]],
      automation: [["scheduled", "/scheduled"], ["runtime", "/runtime"], ["pixelOffice", "/pixel-office"]],
    });
  });

  it("paper trading uses the LineChart icon", () => {
    expect(NAVIGATION_GROUPS[1].items[0].icon).toBe(LineChart);
  });

  it("settings is exported separately and is not inside any group", () => {
    expect(SETTINGS_ITEM).toEqual({ id: "settings", to: "/settings", icon: Settings });
    expect(NAVIGATION_GROUPS.flatMap((g) => g.items.map((i) => i.id))).not.toContain("settings");
  });

  it("item ids are unique and every route exists in router.tsx", () => {
    const items = [...NAVIGATION_GROUPS.flatMap((g) => [...g.items]), SETTINGS_ITEM];
    expect(new Set(items.map((i) => i.id)).size).toBe(items.length);
    for (const { to } of items) expect(ROUTER_SRC).toContain(`path: "${to}"`);
  });

  it("every item has an English label and description key", () => {
    const layout = (en as unknown as { layout: Record<string, string> }).layout;
    const desc = (en as unknown as { navigation: { descriptions: Record<string, string> } }).navigation.descriptions;
    for (const g of NAVIGATION_GROUPS) for (const i of g.items) {
      expect(layout[i.id], i.id).toBeTruthy();
      expect(desc[i.id], i.id).toBeTruthy();
    }
    expect(layout.settings).toBeTruthy();
  });

  it.each([
    ["/", "/", true], ["/", "/agent", true], ["/", "/reports", false], ["/", "/agent/x", false],
    ["/paper-trading", "/paper-trading", true], ["/paper-trading", "/paper-trading/run/1", true],
    ["/paper-trading", "/paper-tradingx", false], ["/settings", "/settings/", true], ["/alpha-zoo", "/alpha", false],
  ])("isNavigationActive(%s, %s) = %s", (to, pathname, expected) => {
    expect(isNavigationActive(to, pathname)).toBe(expected);
  });
});

describe("T03 pageTitleKey", () => {
  it.each([
    ["/", "layout.agent"], ["/agent", "layout.agent"], ["/paper-trading", "layout.paperTrading"],
    ["/paper-trading/abc", "layout.paperTrading"], ["/portfolio", "layout.portfolio"], ["/options", "layout.optionsLab"],
    ["/alpha-zoo/bench", "layout.alphaZoo"], ["/pixel-office", "layout.pixelOffice"], ["/settings", "layout.settings"],
  ])("%s -> %s", (p, key) => {
    expect(pageTitleKey(p).key).toBe(key);
  });

  it.each([
    ["/runs/abc", { key: "layout.run", fallback: "Run" }],
    ["/runs/abc/trades", { key: "layout.run", fallback: "Run" }],
    ["/compare", { key: "layout.compare", fallback: "Compare runs" }],
    ["/about", { key: "layout.about", fallback: "About" }],
    ["/nowhere", { key: "layout.app", fallback: "Vibe Crypto" }],
    ["", { key: "layout.app", fallback: "Vibe Crypto" }],
    ["/runs", { key: "layout.app", fallback: "Vibe Crypto" }],
    ["/settingsx", { key: "layout.app", fallback: "Vibe Crypto" }],
    ["/about/team", { key: "layout.app", fallback: "Vibe Crypto" }],
  ])("%s -> %j", (p, expected) => {
    expect(pageTitleKey(p)).toEqual(expected);
  });

  it("returns a key for every nav item route", () => {
    for (const g of NAVIGATION_GROUPS) for (const i of g.items) expect(pageTitleKey(i.to).key).toBe(`layout.${i.id}`);
  });
});

// ── sidebar ──────────────────────────────────────────────────────────

describe("T03 sidebar", () => {
  it("shows the wordmark when expanded and is w-60", () => {
    renderLayout();
    expect(within(sidebar()).getByText("Vibe Crypto")).toBeInTheDocument();
    expect(sidebar().className).toMatch(/\bw-60\b/);
    expect(within(sidebar()).getByRole("link", { name: "Vibe Crypto" })).toHaveAttribute("href", "/");
  });

  it("has no visible group headings and labels each group section", () => {
    renderLayout();
    const nav = within(sidebar()).getByRole("navigation", { name: "Main navigation" });
    expect(within(nav).queryAllByRole("heading")).toHaveLength(0);
    expect(within(sidebar()).queryAllByRole("heading")).toHaveLength(0);
    const sections = nav.querySelectorAll("section[aria-label]");
    expect(sections).toHaveLength(4);
    expect(Array.from(sections).map((s) => s.getAttribute("aria-label"))).toEqual([
      "Everyday research", "Trade", "Specialized analysis", "Automation & setup",
    ]);
    // groups after the first are separated by a hairline
    expect(Array.from(sections).slice(1).every((s) => /border-t/.test(s.className))).toBe(true);
    expect(sections[0].className).not.toMatch(/border-t/);
  });

  it("the trade group holds paper trading and holdings", () => {
    renderLayout();
    const trade = sidebar().querySelector('section[aria-label="Trade"]') as HTMLElement;
    expect(within(trade).getAllByRole("link").map((a) => a.getAttribute("href"))).toEqual(["/paper-trading", "/portfolio"]);
  });

  it("settings is pinned at the bottom, outside the main nav, before the collapse toggle", () => {
    renderLayout();
    const nav = within(sidebar()).getByRole("navigation", { name: "Main navigation" });
    const settings = within(sidebar()).getByRole("link", { name: "Settings" });
    expect(nav.contains(settings)).toBe(false);
    const collapse = within(sidebar()).getByRole("button", { name: "Collapse" });
    expect(settings.compareDocumentPosition(collapse) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(nav.compareDocumentPosition(settings) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("marks the active item with aria-current and a primary bar", () => {
    renderLayout("/paper-trading");
    const link = within(sidebar()).getByRole("link", { name: "Paper trading" });
    expect(link).toHaveAttribute("aria-current", "page");
    expect(link.className).toMatch(/\bbg-muted\b/);
    expect(link.className).toMatch(/font-medium/);
    expect(link.querySelector("span.bg-primary")).not.toBeNull();
    const other = within(sidebar()).getByRole("link", { name: "Account holdings" });
    expect(other).not.toHaveAttribute("aria-current");
    expect(other.querySelector("span.bg-primary")).toBeNull();
    expect(other.className).toMatch(/text-muted-foreground/);
  });

  it("settings link is active on /settings", () => {
    renderLayout("/settings");
    expect(within(sidebar()).getByRole("link", { name: "Settings" })).toHaveAttribute("aria-current", "page");
  });

  it("nav items use the compact item geometry", () => {
    renderLayout();
    const link = within(sidebar()).getByRole("link", { name: "Backtest reports" });
    for (const c of ["h-8", "rounded-md", "text-[13px]", "px-2.5", "gap-2.5"]) expect(link.className.split(/\s+/)).toContain(c);
  });

  it("collapse toggles to w-14, hides the wordmark and persists qa-sidebar", () => {
    renderLayout();
    fireEvent.click(within(sidebar()).getByRole("button", { name: "Collapse" }));
    expect(sidebar().className).toMatch(/\bw-14\b/);
    expect(within(sidebar()).queryByText("Vibe Crypto")).toBeNull();
    expect(window.localStorage.getItem("qa-sidebar")).toBe("collapsed");
    fireEvent.click(within(sidebar()).getByRole("button", { name: "Expand" }));
    expect(window.localStorage.getItem("qa-sidebar")).toBe("expanded");
    expect(sidebar().className).toMatch(/\bw-60\b/);
  });

  it("starts collapsed from storage and still shows the brand mark", () => {
    window.localStorage.setItem("qa-sidebar", "collapsed");
    renderLayout();
    expect(sidebar().className).toMatch(/\bw-14\b/);
    expect(within(sidebar()).getByRole("link", { name: "Vibe Crypto" }).querySelector("svg")).not.toBeNull();
    expect(within(sidebar()).getByRole("link", { name: "Settings" })).toBeInTheDocument();
  });

  it("an unknown qa-sidebar value means expanded", () => {
    window.localStorage.setItem("qa-sidebar", "garbage");
    renderLayout();
    expect(sidebar().className).toMatch(/\bw-60\b/);
  });

  it("theme toggle and language menu are not in the sidebar", () => {
    renderLayout();
    expect(within(sidebar()).queryByRole("button", { name: "Language" })).toBeNull();
    expect(within(sidebar()).queryByRole("button", { name: /^(Dark|Light)$/ })).toBeNull();
  });

  it("the mobile feature drawer opens with every group plus settings and closes on Escape", () => {
    renderLayout();
    fireEvent.click(within(sidebar()).getByRole("button", { name: "Browse features" }));
    const drawer = document.getElementById("sidebar-feature-menu")!;
    expect(drawer).not.toBeNull();
    const hrefs = within(drawer).getAllByRole("link").map((a) => a.getAttribute("href"));
    expect(hrefs).toContain("/paper-trading");
    expect(hrefs).toContain("/settings");
    expect(hrefs).toHaveLength(13);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(document.getElementById("sidebar-feature-menu")).toBeNull();
  });
});

describe("T03 sidebar sessions panel", () => {
  it("shows a loading skeleton then the empty state", async () => {
    let resolve: (v: unknown[]) => void = () => {};
    listSessions.mockReturnValue(new Promise((r) => { resolve = r as typeof resolve; }) as never);
    renderLayout();
    const panel = document.getElementById("sidebar-sessions")!;
    expect(panel.querySelectorAll(".animate-pulse").length).toBeGreaterThan(0);
    await act(async () => { resolve([]); });
    expect(within(panel).getByText(en.layout.noSessions)).toBeInTheDocument();
  });

  it("lists sessions, links them, and falls back to the id when untitled", async () => {
    listSessions.mockResolvedValue([
      { session_id: "s-1", title: "BTC momentum" },
      { session_id: "abcdefghijklmnopqrstuvwxyz", title: "" },
    ] as never);
    renderLayout();
    const link = await screen.findByRole("link", { name: /BTC momentum/ });
    expect(link).toHaveAttribute("href", "/agent?session=s-1");
    expect(screen.getByText("abcdefghijklmnop")).toBeInTheDocument();
  });

  it("renames a session with Enter", async () => {
    listSessions.mockResolvedValue([{ session_id: "s-1", title: "Old" }] as never);
    renderLayout();
    await screen.findByRole("link", { name: /Old/ });
    fireEvent.click(screen.getByTitle("Rename"));
    const input = screen.getByRole("textbox", { name: "Rename: Old" });
    fireEvent.change(input, { target: { value: "  New name " } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(api.renameSession).toHaveBeenCalledWith("s-1", "New name"));
    expect(await screen.findByRole("link", { name: /New name/ })).toBeInTheDocument();
  });

  it("an empty rename is cancelled without an API call", async () => {
    listSessions.mockResolvedValue([{ session_id: "s-1", title: "Keep" }] as never);
    renderLayout();
    await screen.findByRole("link", { name: /Keep/ });
    fireEvent.click(screen.getByTitle("Rename"));
    const input = screen.getByRole("textbox", { name: "Rename: Keep" });
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(api.renameSession).not.toHaveBeenCalled();
    expect(await screen.findByRole("link", { name: /Keep/ })).toBeInTheDocument();
  });

  it("delete needs confirmation, cancel keeps the session", async () => {
    listSessions.mockResolvedValue([{ session_id: "s-1", title: "Gone" }] as never);
    renderLayout();
    await screen.findByRole("link", { name: /Gone/ });
    fireEvent.click(screen.getByTitle("Delete"));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(api.deleteSession).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTitle("Delete"));
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(api.deleteSession).toHaveBeenCalledWith("s-1"));
    await waitFor(() => expect(screen.queryByRole("link", { name: /Gone/ })).toBeNull());
  });

  it("a load failure shows an alert with retry that reloads", async () => {
    listSessions.mockRejectedValueOnce(new Error("backend down"));
    renderLayout();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("backend down");
    listSessions.mockResolvedValue([{ session_id: "s-9", title: "Recovered" }] as never);
    fireEvent.click(within(alert).getByRole("button"));
    expect(await screen.findByRole("link", { name: /Recovered/ })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("new chat links to /agent", () => {
    renderLayout();
    expect(screen.getAllByRole("link", { name: "New Chat" })[0]).toHaveAttribute("href", "/agent");
  });
});

// ── top bar ──────────────────────────────────────────────────────────

function renderTopBar(at: string, dockOpen = false, onToggleDock = vi.fn()) {
  return render(<MemoryRouter initialEntries={[at]}><TopBar dockOpen={dockOpen} onToggleDock={onToggleDock} /></MemoryRouter>);
}

describe("T03 top bar", () => {
  it.each([
    ["/", "Research assistant"],
    ["/paper-trading", "Paper trading"],
    ["/runs/abc", "Run"],
    ["/compare", "Compare runs"],
    ["/about", "About"],
    ["/unknown/route", "Vibe Crypto"],
  ])("title for %s is %s", (at, title) => {
    renderTopBar(at);
    expect(screen.getByRole("heading", { name: title })).toHaveClass("text-sm", "font-semibold");
  });

  it("is a 48px card bar with a bottom border", () => {
    const { container } = renderTopBar("/");
    const header = container.querySelector("header")!;
    for (const c of ["h-12", "border-b", "bg-card", "px-4", "flex", "items-center", "gap-2"]) expect(header.className.split(/\s+/)).toContain(c);
  });

  it("right side order: wallet, Claude, theme, language", () => {
    const { container } = renderTopBar("/");
    const header = container.querySelector("header")!;
    const order = [
      screen.getByTestId("wallet-slot"),
      screen.getByRole("button", { name: /Claude/ }),
      screen.getByRole("button", { name: "Dark" }),
      screen.getByRole("button", { name: "Language" }),
    ];
    for (const el of order) expect(header.contains(el)).toBe(true);
    for (let i = 1; i < order.length; i++) {
      expect(order[i - 1].compareDocumentPosition(order[i]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
  });

  it("Claude toggle reflects dock state and calls onToggleDock", () => {
    const onToggle = vi.fn();
    const { unmount } = renderTopBar("/", false, onToggle);
    const b = claudeToggle();
    expect(b).toHaveAttribute("aria-pressed", "false");
    expect(b).toHaveAttribute("title", "Open Claude (Ctrl+J)");
    expect(b).toHaveTextContent("Claude");
    expect(b.querySelector("svg")).not.toBeNull();
    fireEvent.click(b);
    expect(onToggle).toHaveBeenCalledTimes(1);
    unmount();
    renderTopBar("/", true);
    expect(claudeToggle()).toHaveAttribute("aria-pressed", "true");
    expect(claudeToggle().getAttribute("title")).toMatch(/Claude \(Ctrl\+J\)/);
  });

  it("shows Cmd+J on macOS", () => {
    const spy = vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
    renderTopBar("/");
    expect(claudeToggle()).toHaveAttribute("title", "Open Claude (Cmd+J)");
    spy.mockRestore();
  });

  it("theme toggle label follows the theme and calls toggle", () => {
    const { unmount } = renderTopBar("/");
    fireEvent.click(screen.getByRole("button", { name: "Dark" }));
    expect(toggleTheme).toHaveBeenCalledTimes(1);
    unmount();
    darkState = true;
    renderTopBar("/");
    expect(screen.getByRole("button", { name: "Light" })).toBeInTheDocument();
  });

  it("language menu lists every supported language on popover tokens and switches", async () => {
    const { SUPPORTED_LANGUAGES } = await import("@/i18n");
    const spy = vi.spyOn(i18n, "changeLanguage").mockResolvedValue((() => "") as never);
    renderTopBar("/");
    const trigger = screen.getByRole("button", { name: "Language" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    const menu = document.querySelector("[data-lang-menu]") as HTMLElement;
    expect(menu.className).toMatch(/bg-popover/);
    expect(menu.className).toMatch(/text-popover-foreground/);
    const buttons = within(menu).getAllByRole("button");
    expect(buttons.map((b) => b.textContent)).toEqual(SUPPORTED_LANGUAGES.map((l) => l.label));
    expect(within(menu).getByRole("button", { name: "English" })).toHaveAttribute("aria-current", "true");
    fireEvent.click(within(menu).getByRole("button", { name: "Deutsch" }));
    expect(spy).toHaveBeenCalledWith("de");
    expect(document.querySelector("[data-lang-menu]")).toBeNull();
    spy.mockRestore();
  });

  it("language menu closes on Escape and outside click", () => {
    renderTopBar("/");
    const trigger = screen.getByRole("button", { name: "Language" });
    fireEvent.click(trigger);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(document.querySelector("[data-lang-menu]")).toBeNull();
    fireEvent.click(trigger);
    fireEvent.mouseDown(document.body);
    expect(document.querySelector("[data-lang-menu]")).toBeNull();
  });
});

// ── assistant dock ───────────────────────────────────────────────────

describe("T03 assistant dock in the layout", () => {
  it("is not mounted until first opened", () => {
    renderLayout();
    expect(screen.queryByRole("complementary", { name: "Claude assistant", hidden: true } as never)).toBeNull();
    expect(screen.queryByTestId("dock-panel-chat")).toBeNull();
  });

  it("opens from storage (vc-dock-open=1)", async () => {
    window.localStorage.setItem("vc-dock-open", "1");
    renderLayout();
    expect(claudeToggle()).toHaveAttribute("aria-pressed", "true");
    expect(await screen.findByTestId("chat-body")).toBeInTheDocument();
  });

  it.each(["0", "true", "", "yes"])("vc-dock-open=%j starts closed", (v) => {
    window.localStorage.setItem("vc-dock-open", v);
    renderLayout();
    expect(claudeToggle()).toHaveAttribute("aria-pressed", "false");
  });

  it("opens on a vc:open-dock event (Settings Open chat)", async () => {
    renderLayout();
    expect(claudeToggle()).toHaveAttribute("aria-pressed", "false");
    act(() => { window.dispatchEvent(new CustomEvent("vc:open-dock", { detail: { tab: "chat" } })); });
    expect(claudeToggle()).toHaveAttribute("aria-pressed", "true");
    expect(await screen.findByTestId("chat-body")).toBeInTheDocument();
  });

  it("button toggles and persists 1/0", async () => {
    renderLayout();
    fireEvent.click(claudeToggle());
    expect(window.localStorage.getItem("vc-dock-open")).toBe("1");
    await screen.findByTestId("chat-body");
    fireEvent.click(claudeToggle());
    expect(window.localStorage.getItem("vc-dock-open")).toBe("0");
    expect(claudeToggle()).toHaveAttribute("aria-pressed", "false");
  });

  it("Ctrl+J and Cmd+J toggle and prevent the browser default", () => {
    renderLayout();
    const ev = new KeyboardEvent("keydown", { key: "j", ctrlKey: true, bubbles: true, cancelable: true });
    act(() => { document.dispatchEvent(ev); });
    expect(ev.defaultPrevented).toBe(true);
    expect(claudeToggle()).toHaveAttribute("aria-pressed", "true");
    act(() => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "J", metaKey: true, bubbles: true, cancelable: true })); });
    expect(claudeToggle()).toHaveAttribute("aria-pressed", "false");
  });

  it.each([
    [{ key: "j" }],
    [{ key: "j", shiftKey: true }],
    [{ key: "j", altKey: true }],
    [{ key: "k", ctrlKey: true }],
  ])("ignores %j", (init) => {
    renderLayout();
    fireEvent.keyDown(document, init);
    expect(claudeToggle()).toHaveAttribute("aria-pressed", "false");
  });

  it("Escape closes the sheet below lg", () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, writable: true, value: 800 });
    window.localStorage.setItem("vc-dock-open", "1");
    renderLayout();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(claudeToggle()).toHaveAttribute("aria-pressed", "false");
  });

  it("Escape does not close the docked column at lg and above", () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, writable: true, value: 1024 });
    window.localStorage.setItem("vc-dock-open", "1");
    renderLayout();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(claudeToggle()).toHaveAttribute("aria-pressed", "true");
  });

  it("keeps the dock and chat panel mounted (hidden) after closing, and reuses the same node on reopen", async () => {
    renderLayout();
    fireEvent.click(claudeToggle());
    const body = await screen.findByTestId("chat-body");
    fireEvent.click(claudeToggle());
    const panel = screen.getByTestId("dock-panel-chat");
    expect(panel.closest("aside")).toHaveAttribute("hidden");
    expect(screen.getByTestId("chat-body")).toBe(body);
    fireEvent.click(claudeToggle());
    expect(screen.getByTestId("chat-body")).toBe(body);
    expect(panel.closest("aside")).not.toHaveAttribute("hidden");
  });

  it("the dock sits beside main, not inside it", async () => {
    renderLayout();
    fireEvent.click(claudeToggle());
    await screen.findByTestId("chat-body");
    const main = document.getElementById("main")!;
    const dock = screen.getByTestId("dock-panel-chat").closest("aside")!;
    expect(main.contains(dock)).toBe(false);
    expect(main.className).toMatch(/flex-1/);
    expect(main.className).toMatch(/min-w-0/);
    expect(main.className).toMatch(/overflow-y-auto/);
    expect(main.className).not.toMatch(/\bp[xy]?-\d/);
  });

  it("closing from the dock close button updates the toggle", async () => {
    renderLayout();
    fireEvent.click(claudeToggle());
    await screen.findByTestId("chat-body");
    fireEvent.click(screen.getByRole("button", { name: "Close assistant" }));
    expect(claudeToggle()).toHaveAttribute("aria-pressed", "false");
  });

  it("the connection banner slot is directly under the top bar", () => {
    renderLayout();
    const header = document.querySelector("header")!;
    const main = document.getElementById("main")!;
    expect(header.parentElement).toBe(main.parentElement);
    expect(header.compareDocumentPosition(main) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("survives blocked localStorage", () => {
    const get = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("SecurityError"); });
    const set = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("SecurityError"); });
    renderLayout();
    fireEvent.click(claudeToggle());
    expect(claudeToggle()).toHaveAttribute("aria-pressed", "true");
    get.mockRestore(); set.mockRestore();
  });
});

describe("T03 assistant dock component", () => {
  it("renders nothing when first rendered closed", () => {
    const { container } = render(<AssistantDock open={false} onClose={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("open: labelled aside with responsive sheet and column classes", () => {
    render(<AssistantDock open onClose={() => {}} />);
    const aside = screen.getByRole("complementary", { name: "Claude assistant" });
    const c = aside.className.split(/\s+/);
    for (const k of ["fixed", "inset-y-0", "end-0", "z-40", "w-full", "sm:w-[420px]", "shadow-lg", "lg:static", "lg:w-[420px]", "border-s", "bg-card", "flex-col"]) {
      expect(c, k).toContain(k);
    }
  });

  it("backdrop is shown only while open, is lg:hidden and closes on click", () => {
    const onClose = vi.fn();
    const { rerender } = render(<AssistantDock open onClose={onClose} />);
    const backdrop = screen.getByTestId("dock-backdrop");
    expect(backdrop.className).toMatch(/bg-foreground\/20/);
    expect(backdrop.className).toMatch(/lg:hidden/);
    fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalledTimes(1);
    rerender(<AssistantDock open={false} onClose={onClose} />);
    expect(screen.queryByTestId("dock-backdrop")).toBeNull();
    expect(screen.getByTestId("dock-panel-chat")).toBeInTheDocument();
  });

  it("only the Chat tab when the terminal is unavailable, and no terminal panel", async () => {
    render(<AssistantDock open onClose={() => {}} />);
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Chat"]);
    expect(await screen.findByTestId("chat-body")).toBeInTheDocument();
    expect(screen.queryByTestId("dock-panel-terminal")).toBeNull();
  });

  it("a stored terminal tab falls back to Chat when the terminal is unavailable", async () => {
    window.localStorage.setItem("vc-dock-tab", "terminal");
    render(<AssistantDock open onClose={() => {}} />);
    expect(screen.getByRole("tab", { name: "Chat" })).toHaveAttribute("aria-selected", "true");
    expect(await screen.findByTestId("chat-body")).toBeInTheDocument();
  });

  it("with a terminal: both tabs, terminal panel is lazily mounted on first view", async () => {
    vi.mocked(terminalAvailable).mockReturnValue(true);
    render(<AssistantDock open onClose={() => {}} />);
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Chat", "Terminal"]);
    await screen.findByTestId("chat-body");
    expect(screen.queryByTestId("dock-panel-terminal")).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "Terminal" }));
    expect(window.localStorage.getItem("vc-dock-tab")).toBe("terminal");
    expect(await screen.findByTestId("terminal-body")).toBeInTheDocument();
    expect(screen.getByTestId("dock-panel-chat")).toHaveAttribute("hidden");
    expect(screen.getByTestId("dock-panel-terminal")).not.toHaveAttribute("hidden");
  });

  it("restores the stored terminal tab when available", async () => {
    vi.mocked(terminalAvailable).mockReturnValue(true);
    window.localStorage.setItem("vc-dock-tab", "terminal");
    render(<AssistantDock open onClose={() => {}} />);
    expect(screen.getByRole("tab", { name: "Terminal" })).toHaveAttribute("aria-selected", "true");
    expect(await screen.findByTestId("terminal-body")).toBeInTheDocument();
    expect(screen.queryByTestId("dock-panel-chat")).toBeNull();
  });

  it("panels stay mounted across tab switches and closing", async () => {
    vi.mocked(terminalAvailable).mockReturnValue(true);
    const { rerender } = render(<AssistantDock open onClose={() => {}} />);
    const chat = await screen.findByTestId("chat-body");
    fireEvent.click(screen.getByRole("tab", { name: "Terminal" }));
    const term = await screen.findByTestId("terminal-body");
    rerender(<AssistantDock open={false} onClose={() => {}} />);
    expect(screen.getByTestId("chat-body")).toBe(chat);
    expect(screen.getByTestId("terminal-body")).toBe(term);
    expect(screen.getByTestId("dock-panel-terminal").closest("aside")).toHaveAttribute("hidden");
  });

  it("arrow keys switch dock tabs", async () => {
    vi.mocked(terminalAvailable).mockReturnValue(true);
    render(<AssistantDock open onClose={() => {}} />);
    fireEvent.keyDown(screen.getByRole("tab", { name: "Chat" }), { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: "Terminal" })).toHaveAttribute("aria-selected", "true");
    expect(await screen.findByTestId("terminal-body")).toBeInTheDocument();
  });

  it("an unknown stored tab value falls back to Chat", () => {
    vi.mocked(terminalAvailable).mockReturnValue(true);
    window.localStorage.setItem("vc-dock-tab", "nonsense");
    render(<AssistantDock open onClose={() => {}} />);
    expect(screen.getByRole("tab", { name: "Chat" })).toHaveAttribute("aria-selected", "true");
  });

  it("panels are tabpanels labelled by their tab", async () => {
    render(<AssistantDock open onClose={() => {}} />);
    const panel = screen.getByTestId("dock-panel-chat");
    expect(panel).toHaveAttribute("role", "tabpanel");
    expect(panel.getAttribute("aria-labelledby")).toBe(screen.getByRole("tab", { name: "Chat" }).id);
  });
});
