// T06: lib/claudeChat.ts. SSE parsing and the fetch stream client. Offline:
// fetch is stubbed with in-memory ReadableStreams and @/lib/api is mocked.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const request = vi.fn();
vi.mock("@/lib/api", () => ({ request: (...a: unknown[]) => request(...a) }));

import { getClaudeStatus, parseSseChunk, streamClaudeChat, type ClaudeChatEvent } from "@/lib/claudeChat";

const sse = (e: object, name = (e as { type: string }).type) => `event: ${name}\ndata: ${JSON.stringify(e)}\n\n`;
const enc = new TextEncoder();

function bytesStream(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(c) {
      chunks.forEach((b) => c.enqueue(b));
      c.close();
    },
  });
}
const textStream = (chunks: string[]) => bytesStream(chunks.map((s) => enc.encode(s)));

function okResponse(body: ReadableStream<Uint8Array> | null): Response {
  return { ok: true, status: 200, body, json: async () => ({}) } as unknown as Response;
}
function errResponse(status: number, json: () => Promise<unknown>): Response {
  return { ok: false, status, body: null, json } as unknown as Response;
}

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  request.mockReset();
});
afterEach(() => vi.unstubAllGlobals());

async function run(opts: Partial<Parameters<typeof streamClaudeChat>[0]> = {}) {
  const events: ClaudeChatEvent[] = [];
  await streamClaudeChat({ message: "hi", onEvent: (e) => events.push(e), ...opts });
  return events;
}

// ── parseSseChunk ────────────────────────────────────────────────────

describe("T06 parseSseChunk", () => {
  it("returns nothing for an empty buffer", () => {
    expect(parseSseChunk("")).toEqual({ events: [], rest: "" });
  });

  it("keeps an incomplete single block entirely in rest", () => {
    const partial = 'event: text\ndata: {"type":"text","delta":"a"}\n';
    expect(parseSseChunk(partial)).toEqual({ events: [], rest: partial });
  });

  it("parses several complete blocks in order with an empty rest", () => {
    const buf = sse({ type: "session", session_id: "s" }) + sse({ type: "text", delta: "x" }) + sse({ type: "done", session_id: "s", is_error: false, cost_usd: null, duration_ms: 1 });
    const { events, rest } = parseSseChunk(buf);
    expect(events.map((e) => e.type)).toEqual(["session", "text", "done"]);
    expect(rest).toBe("");
  });

  it("accepts data lines without a space after the colon", () => {
    expect(parseSseChunk('data:{"type":"text","delta":"n"}\n\n').events).toEqual([{ type: "text", delta: "n" }]);
  });

  it("joins multi-line data fields with newlines", () => {
    const raw = 'event: text\ndata: {"type":"text",\ndata: "delta":"m"}\n\n';
    expect(parseSseChunk(raw).events).toEqual([{ type: "text", delta: "m" }]);
  });

  it("ignores comment-only and event-only blocks", () => {
    const raw = ": keepalive\n\nevent: text\n\n" + sse({ type: "text", delta: "k" });
    expect(parseSseChunk(raw).events).toEqual([{ type: "text", delta: "k" }]);
  });

  it("ignores JSON without a string type, null and arrays", () => {
    const raw = 'data: {"delta":"x"}\n\ndata: null\n\ndata: [1]\n\ndata: {"type":5}\n\ndata: "str"\n\n' + sse({ type: "text", delta: "ok" });
    expect(parseSseChunk(raw).events).toEqual([{ type: "text", delta: "ok" }]);
  });

  it("drops malformed JSON without affecting neighbours", () => {
    const raw = sse({ type: "text", delta: "a" }) + "data: {broken\n\n" + sse({ type: "text", delta: "b" });
    expect(parseSseChunk(raw).events.map((e) => (e as { delta: string }).delta)).toEqual(["a", "b"]);
  });

  it("normalises CRLF and keeps a CRLF partial in rest", () => {
    const raw = sse({ type: "text", delta: "c" }).replace(/\n/g, "\r\n") + "data: {\"ty";
    const { events, rest } = parseSseChunk(raw);
    expect(events).toEqual([{ type: "text", delta: "c" }]);
    expect(rest).toBe('data: {"ty');
  });

  it("preserves escaped newlines and unicode inside data", () => {
    const e = { type: "text", delta: "line1\nline2 ₿ é" };
    expect(parseSseChunk(sse(e)).events).toEqual([e]);
  });

  it("re-feeding rest with more data completes the block", () => {
    const full = sse({ type: "tool_use", id: "t", name: "x", input: { a: 1 } });
    const first = parseSseChunk(full.slice(0, 20));
    expect(first.events).toEqual([]);
    const second = parseSseChunk(first.rest + full.slice(20));
    expect(second.events).toEqual([{ type: "tool_use", id: "t", name: "x", input: { a: 1 } }]);
    expect(second.rest).toBe("");
  });
});

// ── getClaudeStatus ──────────────────────────────────────────────────

describe("T06 getClaudeStatus", () => {
  it("GETs /api/claude/status through the shared request helper", async () => {
    const status = { available: true, sdk_version: "0.2.172", auth: "claude_login", model: null, error: null };
    request.mockResolvedValue(status);
    await expect(getClaudeStatus()).resolves.toEqual(status);
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0][0]).toBe("/api/claude/status");
    const init = request.mock.calls[0][1] as RequestInit | undefined;
    expect(init?.method ?? "GET").toBe("GET");
  });

  it("propagates request errors", async () => {
    request.mockRejectedValue(new Error("offline"));
    await expect(getClaudeStatus()).rejects.toThrow("offline");
  });
});

// ── streamClaudeChat ─────────────────────────────────────────────────

describe("T06 streamClaudeChat", () => {
  it("POSTs JSON with null session and model by default", async () => {
    fetchMock.mockResolvedValue(okResponse(textStream([])));
    await run({ message: "List runs" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/claude/chat");
    expect(init.method).toBe("POST");
    expect(new Headers(init.headers).get("content-type")).toMatch(/application\/json/);
    expect(JSON.parse(init.body)).toEqual({ message: "List runs", session_id: null, model: null });
  });

  it("sends session id, model and the abort signal", async () => {
    fetchMock.mockResolvedValue(okResponse(textStream([])));
    const ac = new AbortController();
    await run({ sessionId: "sess-1", model: "claude-m", signal: ac.signal });
    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(init.body)).toEqual({ message: "hi", session_id: "sess-1", model: "claude-m" });
    expect(init.signal).toBe(ac.signal);
  });

  it("delivers events in order across arbitrary chunk splits", async () => {
    const all = [
      { type: "session", session_id: "s" },
      { type: "text", delta: "Hello" },
      { type: "tool_use", id: "t1", name: "list_backtest_runs", input: {} },
      { type: "tool_result", tool_use_id: "t1", is_error: false, preview: "[]" },
      { type: "done", session_id: "s", is_error: false, cost_usd: 0.01, duration_ms: 9 },
    ];
    const raw = all.map((e) => sse(e)).join("");
    for (const size of [1, 3, 7, 50, raw.length]) {
      const chunks: string[] = [];
      for (let i = 0; i < raw.length; i += size) chunks.push(raw.slice(i, i + size));
      fetchMock.mockResolvedValueOnce(okResponse(textStream(chunks)));
      expect(await run()).toEqual(all);
    }
  });

  it("decodes a multi-byte UTF-8 character split across chunks", async () => {
    const bytes = enc.encode(sse({ type: "text", delta: "₿é" }));
    const cut = bytes.indexOf(0xe2) + 1; // inside the 3-byte bitcoin sign
    fetchMock.mockResolvedValue(okResponse(bytesStream([bytes.slice(0, cut), bytes.slice(cut)])));
    expect(await run()).toEqual([{ type: "text", delta: "₿é" }]);
  });

  it("flushes a final block that lacks the trailing blank line", async () => {
    fetchMock.mockResolvedValue(okResponse(textStream([sse({ type: "text", delta: "a" }), 'event: done\ndata: {"type":"done","session_id":null,"is_error":false,"cost_usd":null,"duration_ms":null}'])));
    expect((await run()).map((e) => e.type)).toEqual(["text", "done"]);
  });

  it("resolves with no events for an empty stream", async () => {
    fetchMock.mockResolvedValue(okResponse(textStream([])));
    expect(await run()).toEqual([]);
  });

  it("throws the string detail on a non-2xx response", async () => {
    fetchMock.mockResolvedValue(errResponse(403, async () => ({ detail: "Cross-site request denied" })));
    await expect(run()).rejects.toThrow("Cross-site request denied");
  });

  it("throws the first validation message for a 422 detail array", async () => {
    fetchMock.mockResolvedValue(errResponse(422, async () => ({ detail: [{ msg: "message must not be empty" }, { msg: "other" }] })));
    await expect(run()).rejects.toThrow("message must not be empty");
  });

  it("falls back to a status message when the error body is not JSON", async () => {
    fetchMock.mockResolvedValue(errResponse(502, async () => { throw new SyntaxError("bad json"); }));
    await expect(run()).rejects.toThrow("Request failed (502)");
  });

  it("falls back to a status message when detail is missing", async () => {
    fetchMock.mockResolvedValue(errResponse(500, async () => ({ error: "x" })));
    await expect(run()).rejects.toThrow("Request failed (500)");
  });

  it("throws when the response has no body", async () => {
    fetchMock.mockResolvedValue(okResponse(null));
    await expect(run()).rejects.toThrow("Empty response from server");
  });

  it("resolves quietly when fetch rejects with AbortError", async () => {
    fetchMock.mockRejectedValue(new DOMException("aborted", "AbortError"));
    await expect(run()).resolves.toEqual([]);
  });

  it("resolves quietly when the signal is aborted mid-stream", async () => {
    const ac = new AbortController();
    const events: ClaudeChatEvent[] = [];
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(enc.encode(sse({ type: "text", delta: "partial" })));
      },
      pull() {
        return new Promise(() => { /* never resolves until cancelled */ });
      },
    });
    const reader = { read: vi.fn() };
    // Wrap the stream so the reader rejects once aborted, as the browser does.
    const realReader = body.getReader();
    reader.read.mockImplementation(() =>
      Promise.race([
        realReader.read(),
        new Promise((_, rej) => ac.signal.addEventListener("abort", () => rej(new Error("The operation was aborted")))),
      ]),
    );
    fetchMock.mockResolvedValue({ ok: true, status: 200, body: { getReader: () => reader } });
    const p = streamClaudeChat({ message: "hi", signal: ac.signal, onEvent: (e) => events.push(e) });
    await vi.waitFor(() => expect(events).toHaveLength(1));
    ac.abort();
    await expect(p).resolves.toBeUndefined();
    expect(events).toEqual([{ type: "text", delta: "partial" }]);
  });

  it("rethrows other network errors", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(run()).rejects.toThrow("Failed to fetch");
  });

  it("propagates an exception thrown by onEvent", async () => {
    fetchMock.mockResolvedValue(okResponse(textStream([sse({ type: "text", delta: "x" })])));
    await expect(
      streamClaudeChat({ message: "hi", onEvent: () => { throw new Error("handler broke"); } }),
    ).rejects.toThrow("handler broke");
  });
});
