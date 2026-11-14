import { request } from "@/lib/api";

export interface ClaudeStatus {
  available: boolean;
  sdk_version: string | null;
  auth: "api_key" | "claude_login" | "unknown";
  model: string | null;
  error: string | null;
}

export type ClaudeChatEvent =
  | { type: "session"; session_id: string }
  | { type: "text"; delta: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; tool_use_id: string; is_error: boolean; preview: string }
  | { type: "done"; session_id: string | null; is_error: boolean; cost_usd: number | null; duration_ms: number | null }
  | { type: "error"; message: string };

export function getClaudeStatus(): Promise<ClaudeStatus> {
  return request<ClaudeStatus>("/api/claude/status");
}

/** Parse complete SSE blocks from `buffer`; the trailing partial block is returned in `rest`. */
export function parseSseChunk(buffer: string): { events: ClaudeChatEvent[]; rest: string } {
  const normalized = buffer.replace(/\r\n/g, "\n");
  const blocks = normalized.split("\n\n");
  const rest = blocks.pop() ?? "";
  const events: ClaudeChatEvent[] = [];
  for (const block of blocks) {
    const data = block
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).replace(/^ /, ""))
      .join("\n");
    if (!data) continue;
    try {
      const parsed = JSON.parse(data);
      if (parsed && typeof parsed.type === "string") events.push(parsed as ClaudeChatEvent);
    } catch {
      /* ignore malformed block */
    }
  }
  return { events, rest };
}

async function errorDetail(res: Response): Promise<string> {
  try {
    const body = await res.json();
    if (typeof body?.detail === "string") return body.detail;
    if (Array.isArray(body?.detail) && body.detail[0]?.msg) return String(body.detail[0].msg);
  } catch {
    /* fall through */
  }
  return `Request failed (${res.status})`;
}

export async function streamClaudeChat(opts: {
  message: string;
  sessionId?: string | null;
  model?: string | null;
  signal?: AbortSignal;
  onEvent: (e: ClaudeChatEvent) => void;
}): Promise<void> {
  try {
    const res = await fetch("/api/claude/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: opts.message, session_id: opts.sessionId ?? null, model: opts.model ?? null }),
      signal: opts.signal,
    });
    if (!res.ok) throw new Error(await errorDetail(res));
    if (!res.body) throw new Error("Empty response from server");
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const { events, rest } = parseSseChunk(buffer);
      buffer = rest;
      events.forEach(opts.onEvent);
    }
    const tail = parseSseChunk(buffer + "\n\n");
    tail.events.forEach(opts.onEvent);
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") return;
    if (opts.signal?.aborted) return;
    throw err;
  }
}
