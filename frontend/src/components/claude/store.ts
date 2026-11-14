import { create } from "zustand";
import { streamClaudeChat, type ClaudeChatEvent } from "@/lib/claudeChat";
import { safeGet, safeRemove, safeSet } from "@/lib/storage";

export const SESSION_KEY = "vc-claude-session";

export type ChatPart =
  | { kind: "text"; text: string }
  | { kind: "tool"; id: string; name: string; input: unknown; result?: { isError: boolean; preview: string } };

export interface ChatMsg {
  id: string;
  role: "user" | "assistant";
  parts: ChatPart[];
}

interface State {
  messages: ChatMsg[];
  sessionId: string | null;
  streaming: boolean;
  error: string | null;
  lastPrompt: string | null;
  send: (text: string) => Promise<void>;
  stop: () => void;
  reset: () => void;
}

let controller: AbortController | null = null;
let seq = 0;
const nextId = () => `m${Date.now()}-${seq++}`;

export const useClaudeChatStore = create<State>((set, get) => ({
  messages: [],
  sessionId: safeGet(SESSION_KEY),
  streaming: false,
  error: null,
  lastPrompt: null,

  async send(text) {
    const prompt = text.trim();
    if (!prompt || get().streaming) return;
    const assistantId = nextId();
    set((s) => ({
      messages: [...s.messages, { id: nextId(), role: "user", parts: [{ kind: "text", text: prompt }] }, { id: assistantId, role: "assistant", parts: [] }],
      streaming: true,
      error: null,
      lastPrompt: prompt,
    }));
    const patch = (fn: (parts: ChatPart[]) => ChatPart[]) =>
      set((s) => ({ messages: s.messages.map((m) => (m.id === assistantId ? { ...m, parts: fn(m.parts) } : m)) }));
    const setSession = (id: string | null) => {
      if (!id) return;
      safeSet(SESSION_KEY, id);
      set({ sessionId: id });
    };
    const onEvent = (e: ClaudeChatEvent) => {
      switch (e.type) {
        case "session": setSession(e.session_id); break;
        case "text":
          patch((parts) => {
            const last = parts[parts.length - 1];
            if (last?.kind === "text") return [...parts.slice(0, -1), { kind: "text", text: last.text + e.delta }];
            return [...parts, { kind: "text", text: e.delta }];
          });
          break;
        case "tool_use":
          patch((parts) => [...parts, { kind: "tool", id: e.id, name: e.name, input: e.input }]);
          break;
        case "tool_result":
          patch((parts) => parts.map((p) => (p.kind === "tool" && p.id === e.tool_use_id ? { ...p, result: { isError: e.is_error, preview: e.preview } } : p)));
          break;
        case "done": setSession(e.session_id); break;
        case "error": set({ error: e.message }); break;
      }
    };
    controller = new AbortController();
    try {
      await streamClaudeChat({ message: prompt, sessionId: get().sessionId, signal: controller.signal, onEvent });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
    } finally {
      controller = null;
      set({ streaming: false });
    }
  },

  stop() {
    controller?.abort();
  },

  reset() {
    if (get().streaming) return;
    safeRemove(SESSION_KEY);
    set({ messages: [], sessionId: null, error: null, lastPrompt: null });
  },
}));
