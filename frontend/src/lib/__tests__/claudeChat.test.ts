import { afterEach, describe, expect, it, vi } from "vitest";
import { parseSseChunk, streamClaudeChat, type ClaudeChatEvent } from "../claudeChat";

const ev = (e: object) => `event: x\ndata: ${JSON.stringify(e)}\n\n`;

function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(c) {
      chunks.forEach((s) => c.enqueue(enc.encode(s)));
      c.close();
    },
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("parseSseChunk", () => {
  it("keeps a trailing partial block", () => {
    const a = ev({ type: "text", delta: "a" });
    const { events, rest } = parseSseChunk(a + 'event: text\ndata: {"type":"te');
    expect(events).toEqual([{ type: "text", delta: "a" }]);
    expect(rest).toBe('event: text\ndata: {"type":"te');
  });
  it("handles CRLF and ignores malformed blocks", () => {
    const raw = ev({ type: "text", delta: "b" }).replace(/\n/g, "\r\n") + "data: {nope\n\n";
    expect(parseSseChunk(raw).events).toEqual([{ type: "text", delta: "b" }]);
  });
});

describe("streamClaudeChat", () => {
  it("delivers events split mid-event", async () => {
    const full = ev({ type: "text", delta: "hi" }) + ev({ type: "done", session_id: "s", is_error: false, cost_usd: null, duration_ms: 1 });
    const cut = 20;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(streamOf([full.slice(0, cut), full.slice(cut)]), { status: 200 })));
    const got: ClaudeChatEvent[] = [];
    await streamClaudeChat({ message: "x", onEvent: (e) => got.push(e) });
    expect(got.map((e) => e.type)).toEqual(["text", "done"]);
  });
  it("throws the server detail on error status", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ detail: "bad thing" }), { status: 422 })));
    await expect(streamClaudeChat({ message: "x", onEvent: () => {} })).rejects.toThrow("bad thing");
  });
  it("resolves quietly on abort", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new DOMException("aborted", "AbortError")));
    await expect(streamClaudeChat({ message: "x", onEvent: () => {} })).resolves.toBeUndefined();
  });
});
