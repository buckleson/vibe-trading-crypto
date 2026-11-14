import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getClaudeStatus = vi.fn();
const streamClaudeChat = vi.fn();
vi.mock("@/lib/claudeChat", () => ({
  getClaudeStatus: (...a: unknown[]) => getClaudeStatus(...a),
  streamClaudeChat: (...a: unknown[]) => streamClaudeChat(...a),
}));

import { ChatPanel } from "../ChatPanel";
import { useClaudeChatStore, SESSION_KEY } from "../store";

const ok = { available: true, sdk_version: "0.2.172", auth: "api_key", model: null, error: null };

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  useClaudeChatStore.setState({ messages: [], sessionId: null, streaming: false, error: null, lastPrompt: null });
  getClaudeStatus.mockResolvedValue(ok);
});

describe("ChatPanel", () => {
  it("shows the unavailable state", async () => {
    getClaudeStatus.mockResolvedValue({ ...ok, available: false });
    render(<ChatPanel />);
    expect(await screen.findByText("Claude is not connected")).toBeTruthy();
  });

  it("streams text and completes a tool row", async () => {
    streamClaudeChat.mockImplementation(async ({ onEvent }) => {
      onEvent({ type: "session", session_id: "sess-1" });
      onEvent({ type: "text", delta: "Hello " });
      onEvent({ type: "text", delta: "there" });
      onEvent({ type: "tool_use", id: "t1", name: "list_backtest_runs", input: { limit: 3 } });
      onEvent({ type: "tool_result", tool_use_id: "t1", is_error: false, preview: "2 runs" });
      onEvent({ type: "done", session_id: "sess-1", is_error: false, cost_usd: null, duration_ms: 1 });
    });
    render(<ChatPanel />);
    const box = await screen.findByPlaceholderText("Ask Claude about your strategies");
    fireEvent.change(box, { target: { value: "hi" } });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(await screen.findByText("Hello there")).toBeTruthy();
    expect(screen.getByText("Used list backtest runs")).toBeTruthy();
    expect(screen.getByLabelText("Done")).toBeTruthy();
    expect(window.localStorage.getItem(SESSION_KEY)).toBe("sess-1");
  });

  it("Stop aborts the stream", async () => {
    let signal: AbortSignal | undefined;
    streamClaudeChat.mockImplementation(({ signal: s }) => {
      signal = s;
      return new Promise<void>((resolve) => s.addEventListener("abort", () => resolve()));
    });
    render(<ChatPanel />);
    const box = await screen.findByPlaceholderText("Ask Claude about your strategies");
    fireEvent.change(box, { target: { value: "hi" } });
    fireEvent.keyDown(box, { key: "Enter" });
    fireEvent.click(await screen.findByText("Stop"));
    await waitFor(() => expect(signal?.aborted).toBe(true));
    await waitFor(() => expect(useClaudeChatStore.getState().streaming).toBe(false));
  });

  it("New chat clears messages and the stored session", async () => {
    window.localStorage.setItem(SESSION_KEY, "old");
    useClaudeChatStore.setState({
      sessionId: "old",
      messages: [{ id: "1", role: "user", parts: [{ kind: "text", text: "earlier question" }] }],
    });
    render(<ChatPanel />);
    expect(await screen.findByText("earlier question")).toBeTruthy();
    fireEvent.click(screen.getByText("New chat"));
    expect(screen.queryByText("earlier question")).toBeNull();
    expect(window.localStorage.getItem(SESSION_KEY)).toBeNull();
  });

  it("clicking a suggestion sends it", async () => {
    streamClaudeChat.mockResolvedValue(undefined);
    render(<ChatPanel />);
    fireEvent.click(await screen.findByText("How are my paper runs doing?"));
    await waitFor(() => expect(streamClaudeChat).toHaveBeenCalled());
    expect(streamClaudeChat.mock.calls[0][0].message).toBe("How are my paper runs doing?");
  });
});
