// T06: Claude chat panel (ChatPanel, ChatMessage, ToolCallRow, ChatComposer)
// and its zustand store. Offline: @/lib/claudeChat is mocked.
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const getClaudeStatus = vi.fn();
const streamClaudeChat = vi.fn();
vi.mock("@/lib/claudeChat", () => ({
  getClaudeStatus: (...a: unknown[]) => getClaudeStatus(...a),
  streamClaudeChat: (...a: unknown[]) => streamClaudeChat(...a),
}));

import i18n from "@/i18n";
import { ChatPanel } from "@/components/claude/ChatPanel";
import { ChatComposer } from "@/components/claude/ChatComposer";
import { ToolCallRow } from "@/components/claude/ToolCallRow";
import { SESSION_KEY, useClaudeChatStore } from "@/components/claude/store";

type Ev = Record<string, unknown>;
type StreamOpts = { message: string; sessionId?: string | null; signal: AbortSignal; onEvent: (e: Ev) => void };

const ok = { available: true, sdk_version: "0.2.172", auth: "api_key", model: null, error: null };
const PLACEHOLDER = "Ask Claude about your strategies";
const SUGGESTIONS = ["List my latest backtest runs", "Start a paper run from my best backtest", "How are my paper runs doing?"];

beforeAll(async () => { await i18n.changeLanguage("en"); });

beforeEach(() => {
  getClaudeStatus.mockReset();
  streamClaudeChat.mockReset();
  window.localStorage.clear();
  useClaudeChatStore.setState({ messages: [], sessionId: null, streaming: false, error: null, lastPrompt: null });
  getClaudeStatus.mockResolvedValue(ok);
});

/** A stream the test drives by hand: push events, then finish or fail. */
function controlledStream() {
  let opts!: StreamOpts;
  let finish!: () => void;
  let fail!: (e: unknown) => void;
  streamClaudeChat.mockImplementation((o: StreamOpts) => {
    opts = o;
    return new Promise<void>((res, rej) => {
      finish = res;
      fail = rej;
      o.signal.addEventListener("abort", () => res());
    });
  });
  return {
    emit: (e: Ev) => act(() => { opts.onEvent(e); }),
    finish: async () => { await act(async () => { finish(); }); },
    fail: async (e: unknown) => { await act(async () => { fail(e); }); },
    get opts() { return opts; },
  };
}

async function typeAndSend(text: string) {
  const box = await screen.findByPlaceholderText(PLACEHOLDER);
  fireEvent.change(box, { target: { value: text } });
  fireEvent.keyDown(box, { key: "Enter" });
  return box as HTMLTextAreaElement;
}

// ── status gate ──────────────────────────────────────────────────────

describe("T06 ChatPanel status", () => {
  it("shows a loading line before status resolves", () => {
    getClaudeStatus.mockReturnValue(new Promise(() => {}));
    render(<ChatPanel />);
    expect(screen.getByRole("status").textContent).toBe("Loading");
    expect(screen.queryByPlaceholderText(PLACEHOLDER)).toBeNull();
  });

  it("shows the not connected state with the setup hint when unavailable", async () => {
    getClaudeStatus.mockResolvedValue({ ...ok, available: false, error: "x" });
    render(<ChatPanel />);
    expect(await screen.findByText("Claude is not connected")).toBeTruthy();
    expect(screen.getByText("Set ANTHROPIC_API_KEY in agent/.env, or run claude once in a terminal to log in, then reopen this panel.")).toBeTruthy();
    expect(screen.queryByPlaceholderText(PLACEHOLDER)).toBeNull();
    expect(screen.queryByText(SUGGESTIONS[0])).toBeNull();
  });

  it("treats a failed status request as not connected", async () => {
    getClaudeStatus.mockRejectedValue(new Error("network"));
    render(<ChatPanel />);
    expect(await screen.findByText("Claude is not connected")).toBeTruthy();
  });

  it.each([
    ["api_key", "Using API key"],
    ["claude_login", "Using your Claude login"],
  ])("shows the auth hint for %s", async (auth, hint) => {
    getClaudeStatus.mockResolvedValue({ ...ok, auth });
    render(<ChatPanel />);
    expect(await screen.findByText(hint)).toBeTruthy();
  });

  it("shows no auth hint when auth is unknown", async () => {
    getClaudeStatus.mockResolvedValue({ ...ok, auth: "unknown" });
    render(<ChatPanel />);
    await screen.findByPlaceholderText(PLACEHOLDER);
    expect(screen.queryByText("Using API key")).toBeNull();
    expect(screen.queryByText("Using your Claude login")).toBeNull();
  });

  it("calls getClaudeStatus once per mount and ignores a late result after unmount", async () => {
    let resolve!: (v: unknown) => void;
    getClaudeStatus.mockReturnValue(new Promise((r) => { resolve = r; }));
    const { unmount } = render(<ChatPanel />);
    unmount();
    await act(async () => { resolve(ok); });
    expect(getClaudeStatus).toHaveBeenCalledTimes(1);
  });
});

// ── layout and empty conversation ────────────────────────────────────

describe("T06 ChatPanel layout", () => {
  it("renders header, log region and composer", async () => {
    render(<ChatPanel />);
    const title = await screen.findByText("Claude");
    expect(title.className).toMatch(/text-sm/);
    expect(title.className).toMatch(/font-semibold/);
    const log = screen.getByRole("log");
    expect(log.getAttribute("aria-live")).toBe("polite");
    expect(screen.getByRole("button", { name: "Send" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "New chat" })).toBeTruthy();
  });

  it("shows exactly the three suggestions in order when empty", async () => {
    render(<ChatPanel />);
    const log = await screen.findByRole("log");
    const labels = within(log).getAllByRole("button").map((b) => b.textContent);
    expect(labels).toEqual(SUGGESTIONS);
  });

  it.each(SUGGESTIONS)("clicking suggestion %s sends it", async (s) => {
    streamClaudeChat.mockResolvedValue(undefined);
    render(<ChatPanel />);
    fireEvent.click(await screen.findByText(s));
    await waitFor(() => expect(streamClaudeChat).toHaveBeenCalledTimes(1));
    expect(streamClaudeChat.mock.calls[0][0].message).toBe(s);
  });

  it("hides suggestions once a conversation exists", async () => {
    useClaudeChatStore.setState({ messages: [{ id: "u", role: "user", parts: [{ kind: "text", text: "q" }] }] });
    render(<ChatPanel />);
    await screen.findByText("q");
    for (const s of SUGGESTIONS) expect(screen.queryByText(s)).toBeNull();
  });

  it("uses no em dashes in visible UI copy", async () => {
    const { container } = render(<ChatPanel />);
    await screen.findByPlaceholderText(PLACEHOLDER);
    expect(container.textContent).not.toMatch(/[—–]/);
  });
});

// ── streaming ────────────────────────────────────────────────────────

describe("T06 ChatPanel streaming", () => {
  it("renders the user bubble, streams text and finishes", async () => {
    const s = controlledStream();
    render(<ChatPanel />);
    const box = await typeAndSend("  What runs do I have?  ");
    expect(box.value).toBe("");
    const bubble = await screen.findByText("What runs do I have?");
    expect(bubble.className).toMatch(/bg-muted/);
    expect(bubble.className).toMatch(/rounded-lg/);
    expect(bubble.parentElement?.className).toMatch(/justify-end/);
    expect(s.opts.message).toBe("What runs do I have?");

    expect(screen.getByText("Stop")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Send" })).toBeNull();
    expect((screen.getByRole("button", { name: "New chat" }) as HTMLButtonElement).disabled).toBe(true);

    s.emit({ type: "text", delta: "You have " });
    s.emit({ type: "text", delta: "**two** runs" });
    const strong = await screen.findByText("two");
    expect(strong.tagName).toBe("STRONG");
    expect(strong.closest(".prose")?.className).toMatch(/prose-sm/);
    await s.finish();
    expect(useClaudeChatStore.getState().streaming).toBe(false);
    expect(screen.getByRole("button", { name: "Send" })).toBeTruthy();
  });

  it("renders GFM tables in assistant text", async () => {
    const s = controlledStream();
    const { container } = render(<ChatPanel />);
    await typeAndSend("table");
    s.emit({ type: "text", delta: "| run | return |\n|---|---|\n| a | 5% |\n" });
    await waitFor(() => expect(container.querySelector("table")).toBeTruthy());
    await s.finish();
  });

  it("keeps text, tool rows and later text in order as separate parts", async () => {
    const s = controlledStream();
    render(<ChatPanel />);
    await typeAndSend("go");
    s.emit({ type: "text", delta: "Checking." });
    s.emit({ type: "tool_use", id: "t1", name: "list_backtest_runs", input: { limit: 5 } });
    s.emit({ type: "text", delta: "Found 2." });
    await s.finish();
    const parts = useClaudeChatStore.getState().messages[1].parts;
    expect(parts.map((p) => p.kind)).toEqual(["text", "tool", "text"]);
    expect(screen.getByText("Checking.")).toBeTruthy();
    expect(screen.getByText("Found 2.")).toBeTruthy();
  });

  it("shows a running tool row that completes with a result", async () => {
    const s = controlledStream();
    render(<ChatPanel />);
    await typeAndSend("go");
    s.emit({ type: "tool_use", id: "t1", name: "get_paper_run_status", input: { run_id: "abc" } });
    expect(await screen.findByText("Used get paper run status")).toBeTruthy();
    expect(screen.getByLabelText("Running")).toBeTruthy();
    s.emit({ type: "tool_result", tool_use_id: "t1", is_error: false, preview: "equity 10500 USD" });
    expect(await screen.findByLabelText("Done")).toBeTruthy();
    expect(screen.queryByLabelText("Running")).toBeNull();
    expect(screen.getByText("equity 10500 USD")).toBeTruthy();
    await s.finish();
  });

  it("ignores a tool_result for an unknown tool id", async () => {
    const s = controlledStream();
    render(<ChatPanel />);
    await typeAndSend("go");
    s.emit({ type: "tool_use", id: "t1", name: "x", input: {} });
    s.emit({ type: "tool_result", tool_use_id: "nope", is_error: false, preview: "stray" });
    expect(screen.getByLabelText("Running")).toBeTruthy();
    expect(screen.queryByText("stray")).toBeNull();
    await s.finish();
  });

  it("stores the session id from session and done events, ignoring null", async () => {
    const s = controlledStream();
    render(<ChatPanel />);
    await typeAndSend("go");
    s.emit({ type: "session", session_id: "sess-a" });
    expect(window.localStorage.getItem(SESSION_KEY)).toBe("sess-a");
    s.emit({ type: "done", session_id: null, is_error: false, cost_usd: null, duration_ms: null });
    expect(useClaudeChatStore.getState().sessionId).toBe("sess-a");
    s.emit({ type: "done", session_id: "sess-b", is_error: false, cost_usd: null, duration_ms: 1 });
    expect(useClaudeChatStore.getState().sessionId).toBe("sess-b");
    expect(window.localStorage.getItem(SESSION_KEY)).toBe("sess-b");
    await s.finish();
  });

  it("resumes the stored session on the next message", async () => {
    useClaudeChatStore.setState({ sessionId: "sess-keep" });
    streamClaudeChat.mockResolvedValue(undefined);
    render(<ChatPanel />);
    await typeAndSend("again");
    await waitFor(() => expect(streamClaudeChat).toHaveBeenCalled());
    expect(streamClaudeChat.mock.calls[0][0].sessionId).toBe("sess-keep");
  });

  it("Stop aborts the signal and returns to idle without an error", async () => {
    const s = controlledStream();
    render(<ChatPanel />);
    await typeAndSend("long job");
    fireEvent.click(await screen.findByText("Stop"));
    await waitFor(() => expect(s.opts.signal.aborted).toBe(true));
    await waitFor(() => expect(useClaudeChatStore.getState().streaming).toBe(false));
    expect(useClaudeChatStore.getState().error).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("does not start a second stream while one is running", async () => {
    const s = controlledStream();
    render(<ChatPanel />);
    await typeAndSend("first");
    await act(async () => { await useClaudeChatStore.getState().send("second"); });
    expect(streamClaudeChat).toHaveBeenCalledTimes(1);
    await s.finish();
  });

  it("store.send ignores blank input", async () => {
    await act(async () => { await useClaudeChatStore.getState().send("   \n "); });
    expect(streamClaudeChat).not.toHaveBeenCalled();
    expect(useClaudeChatStore.getState().messages).toEqual([]);
  });
});

// ── errors and retry ─────────────────────────────────────────────────

describe("T06 ChatPanel errors", () => {
  it("shows an error event as a danger alert with Retry that resends", async () => {
    streamClaudeChat.mockImplementationOnce(async ({ onEvent }: StreamOpts) => {
      onEvent({ type: "error", message: "Rate limited" });
    });
    render(<ChatPanel />);
    await typeAndSend("try me");
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Rate limited");
    expect(alert.className).toMatch(/text-destructive/);
    streamClaudeChat.mockResolvedValueOnce(undefined);
    fireEvent.click(within(alert).getByText("Retry"));
    await waitFor(() => expect(streamClaudeChat).toHaveBeenCalledTimes(2));
    expect(streamClaudeChat.mock.calls[1][0].message).toBe("try me");
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  });

  it("shows a thrown stream error and resets streaming", async () => {
    streamClaudeChat.mockRejectedValueOnce(new Error("Cross-site request denied"));
    render(<ChatPanel />);
    await typeAndSend("x");
    expect((await screen.findByRole("alert")).textContent).toContain("Cross-site request denied");
    expect(useClaudeChatStore.getState().streaming).toBe(false);
  });

  it("stringifies non-Error rejections", async () => {
    streamClaudeChat.mockRejectedValueOnce("plain failure");
    render(<ChatPanel />);
    await typeAndSend("x");
    expect((await screen.findByRole("alert")).textContent).toContain("plain failure");
  });

  it("hides Retry while a stream is running", async () => {
    const s = controlledStream();
    render(<ChatPanel />);
    await typeAndSend("x");
    s.emit({ type: "error", message: "partial failure" });
    expect((await screen.findByRole("alert")).textContent).toContain("partial failure");
    expect(screen.queryByText("Retry")).toBeNull();
    await s.finish();
    expect(await screen.findByText("Retry")).toBeTruthy();
  });

  it("a new send clears the previous error", async () => {
    useClaudeChatStore.setState({ error: "old", lastPrompt: "p" });
    streamClaudeChat.mockResolvedValue(undefined);
    render(<ChatPanel />);
    expect(await screen.findByRole("alert")).toBeTruthy();
    await typeAndSend("new");
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  });
});

// ── new chat and persistence ─────────────────────────────────────────

describe("T06 ChatPanel new chat and persistence", () => {
  it("New chat clears messages, error and the stored session id", async () => {
    window.localStorage.setItem(SESSION_KEY, "old");
    useClaudeChatStore.setState({
      sessionId: "old",
      error: "boom",
      lastPrompt: "q",
      messages: [{ id: "1", role: "user", parts: [{ kind: "text", text: "earlier" }] }],
    });
    render(<ChatPanel />);
    fireEvent.click(await screen.findByRole("button", { name: "New chat" }));
    expect(screen.queryByText("earlier")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(window.localStorage.getItem(SESSION_KEY)).toBeNull();
    const st = useClaudeChatStore.getState();
    expect([st.sessionId, st.error, st.lastPrompt, st.messages.length]).toEqual([null, null, null, 0]);
    expect(screen.getByText(SUGGESTIONS[0])).toBeTruthy();
  });

  it("store.reset is a no-op while streaming", () => {
    window.localStorage.setItem(SESSION_KEY, "keep");
    useClaudeChatStore.setState({ streaming: true, sessionId: "keep", messages: [{ id: "1", role: "user", parts: [] }] });
    useClaudeChatStore.getState().reset();
    expect(useClaudeChatStore.getState().messages).toHaveLength(1);
    expect(window.localStorage.getItem(SESSION_KEY)).toBe("keep");
  });

  it("the conversation survives the panel unmounting (dock closed)", async () => {
    streamClaudeChat.mockImplementation(async ({ onEvent }: StreamOpts) => {
      onEvent({ type: "text", delta: "Persisted answer" });
    });
    const first = render(<ChatPanel />);
    await typeAndSend("remember me");
    await screen.findByText("Persisted answer");
    first.unmount();
    render(<ChatPanel />);
    expect(await screen.findByText("remember me")).toBeTruthy();
    expect(screen.getByText("Persisted answer")).toBeTruthy();
  });

  it("the store reads the persisted session id at load", async () => {
    window.localStorage.setItem(SESSION_KEY, "from-disk");
    vi.resetModules();
    const mod = await import("@/components/claude/store");
    expect(mod.useClaudeChatStore.getState().sessionId).toBe("from-disk");
    expect(mod.SESSION_KEY).toBe("vc-claude-session");
  });

  it("the store survives localStorage throwing", async () => {
    const spy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("SecurityError"); });
    vi.resetModules();
    const mod = await import("@/components/claude/store");
    expect(mod.useClaudeChatStore.getState().sessionId).toBeNull();
    spy.mockRestore();
  });
});

// ── auto-scroll ──────────────────────────────────────────────────────

describe("T06 ChatPanel auto-scroll", () => {
  function fakeLayout(el: HTMLElement, scrollHeight: number, clientHeight: number) {
    Object.defineProperty(el, "scrollHeight", { configurable: true, get: () => scrollHeight });
    Object.defineProperty(el, "clientHeight", { configurable: true, get: () => clientHeight });
  }

  it("sticks to the bottom on new content", async () => {
    const s = controlledStream();
    render(<ChatPanel />);
    const log = await screen.findByRole("log");
    fakeLayout(log, 1000, 300);
    await typeAndSend("x");
    s.emit({ type: "text", delta: "more" });
    expect(log.scrollTop).toBe(1000);
    await s.finish();
  });

  it("does not jump when the user scrolled up more than 80px", async () => {
    const s = controlledStream();
    render(<ChatPanel />);
    const log = await screen.findByRole("log");
    fakeLayout(log, 1000, 300);
    await typeAndSend("x");
    log.scrollTop = 500; // 200px from the bottom
    fireEvent.scroll(log);
    fakeLayout(log, 1200, 300);
    s.emit({ type: "text", delta: "more" });
    expect(log.scrollTop).toBe(500);
    // Back within 80px of the bottom re-enables sticking.
    log.scrollTop = 830;
    fireEvent.scroll(log);
    fakeLayout(log, 1400, 300);
    s.emit({ type: "text", delta: " again" });
    expect(log.scrollTop).toBe(1400);
    await s.finish();
  });
});

// ── composer ─────────────────────────────────────────────────────────

describe("T06 ChatComposer", () => {
  function setup(streaming = false) {
    const onSend = vi.fn();
    const onStop = vi.fn();
    render(<ChatComposer streaming={streaming} onSend={onSend} onStop={onStop} />);
    const box = screen.getByPlaceholderText(PLACEHOLDER) as HTMLTextAreaElement;
    return { onSend, onStop, box };
  }

  it("has an accessible label and Send is disabled while empty or blank", () => {
    const { box } = setup();
    expect(screen.getByLabelText(PLACEHOLDER)).toBe(box);
    const send = screen.getByRole("button", { name: "Send" }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    fireEvent.change(box, { target: { value: "   " } });
    expect(send.disabled).toBe(true);
    fireEvent.change(box, { target: { value: "a" } });
    expect(send.disabled).toBe(false);
  });

  it("Enter sends the raw text and clears; Shift+Enter does not send", () => {
    const { box, onSend } = setup();
    fireEvent.change(box, { target: { value: "line one" } });
    fireEvent.keyDown(box, { key: "Enter", shiftKey: true });
    expect(onSend).not.toHaveBeenCalled();
    expect(box.value).toBe("line one");
    fireEvent.keyDown(box, { key: "Enter" });
    expect(onSend).toHaveBeenCalledWith("line one");
    expect(box.value).toBe("");
  });

  it("Enter on blank text does nothing", () => {
    const { box, onSend } = setup();
    fireEvent.change(box, { target: { value: "  " } });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(onSend).not.toHaveBeenCalled();
  });

  it("Enter during IME composition does not send", () => {
    const { box, onSend } = setup();
    fireEvent.change(box, { target: { value: "kana" } });
    fireEvent.keyDown(box, { key: "Enter", isComposing: true });
    expect(onSend).not.toHaveBeenCalled();
  });

  it("clicking Send sends", () => {
    const { box, onSend } = setup();
    fireEvent.change(box, { target: { value: "click" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(onSend).toHaveBeenCalledWith("click");
  });

  it("while streaming shows Stop, hides Send and Enter does not send", () => {
    const { box, onSend, onStop } = setup(true);
    expect(screen.queryByRole("button", { name: "Send" })).toBeNull();
    fireEvent.change(box, { target: { value: "queued" } });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(onSend).not.toHaveBeenCalled();
    expect(box.value).toBe("queued");
    fireEvent.click(screen.getByText("Stop"));
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it("autosizes and caps the height at 8 rows", () => {
    const { box } = setup();
    Object.defineProperty(box, "scrollHeight", { configurable: true, get: () => 2000 });
    fireEvent.change(box, { target: { value: "a\n".repeat(50) } });
    const px = parseFloat(box.style.height);
    expect(px).toBeGreaterThan(0);
    expect(px).toBeLessThan(2000);
    Object.defineProperty(box, "scrollHeight", { configurable: true, get: () => 40 });
    fireEvent.change(box, { target: { value: "short" } });
    expect(box.style.height).toBe("40px");
  });
});

// ── tool row ─────────────────────────────────────────────────────────

describe("T06 ToolCallRow", () => {
  it("is a collapsed details row with the tool name and the input JSON", () => {
    const { container } = render(<ToolCallRow part={{ kind: "tool", id: "t", name: "run_backtest_now", input: { symbol: "BTC-USDT", days: 30 } }} />);
    const details = container.querySelector("details")!;
    expect(details).toBeTruthy();
    expect(details.open).toBe(false);
    expect(screen.getByText("Used run backtest now")).toBeTruthy();
    expect(container.querySelector("svg.lucide-wrench")?.getAttribute("class")).toMatch(/h-4 w-4/);
    const pre = container.querySelector("pre")!;
    expect(JSON.parse(pre.textContent!)).toEqual({ symbol: "BTC-USDT", days: 30 });
    expect(pre.closest(".font-mono")?.className).toMatch(/text-xs/);
    expect(pre.className).toMatch(/max-h-/);
    expect(pre.className).toMatch(/overflow-auto/);
  });

  it("shows a spinner and no result block while running", () => {
    const { container } = render(<ToolCallRow part={{ kind: "tool", id: "t", name: "x", input: {} }} />);
    expect(screen.getByLabelText("Running")).toBeTruthy();
    expect(container.querySelectorAll("pre")).toHaveLength(1);
  });

  it("tints error results with the danger color and shows the failed icon", () => {
    const { container } = render(<ToolCallRow part={{ kind: "tool", id: "t", name: "x", input: {}, result: { isError: true, preview: "Run not found" } }} />);
    expect(screen.getByLabelText("Failed")).toBeTruthy();
    expect(screen.queryByLabelText("Done")).toBeNull();
    const out = screen.getByText("Run not found");
    expect(out.className).toMatch(/text-destructive/);
    expect(container.querySelectorAll("pre")).toHaveLength(2);
  });

  it("shows a done icon and a neutral result for success", () => {
    render(<ToolCallRow part={{ kind: "tool", id: "t", name: "x", input: {}, result: { isError: false, preview: "fine" } }} />);
    expect(screen.getByLabelText("Done")).toBeTruthy();
    expect(screen.getByText("fine").className).not.toMatch(/text-destructive/);
  });

  it("handles undefined input and an empty preview without crashing", () => {
    render(<ToolCallRow part={{ kind: "tool", id: "t", name: "", input: undefined, result: { isError: false, preview: "" } }} />);
    expect(screen.getByLabelText("Done")).toBeTruthy();
  });
});
