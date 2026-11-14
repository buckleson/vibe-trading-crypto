import { useEffect, useRef, useState, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { Bot } from "lucide-react";
import { Button, EmptyState } from "@/components/ui";
import { getClaudeStatus, type ClaudeStatus } from "@/lib/claudeChat";
import { ChatComposer } from "./ChatComposer";
import { ChatMessage } from "./ChatMessage";
import { useClaudeChatStore } from "./store";

const SUGGESTIONS: Array<[string, string]> = [
  ["claude.suggestRuns", "List my latest backtest runs"],
  ["claude.suggestPaper", "Start a paper run from my best backtest"],
  ["claude.suggestCheck", "How are my paper runs doing?"],
];

export function ChatPanel(): ReactElement {
  const { t } = useTranslation();
  const { messages, streaming, error, lastPrompt, send, stop, reset } = useClaudeChatStore();
  const [status, setStatus] = useState<ClaudeStatus | null>(null);
  const [statusFailed, setStatusFailed] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);

  useEffect(() => {
    let alive = true;
    getClaudeStatus().then((s) => alive && setStatus(s), () => alive && setStatusFailed(true));
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    const el = logRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [messages, error]);

  if (statusFailed || (status && !status.available)) {
    return (
      <EmptyState
        icon={Bot}
        title={t("claude.notConnected", { defaultValue: "Claude is not connected" })}
        description={t("claude.notConnectedHint", { defaultValue: "Set ANTHROPIC_API_KEY in agent/.env, or run claude once in a terminal to log in, then reopen this panel." })}
      />
    );
  }
  if (!status) return <div className="p-4 text-[13px] text-muted-foreground" role="status">{t("claude.loading", { defaultValue: "Loading" })}</div>;

  const authHint = status.auth === "api_key"
    ? t("claude.authKey", { defaultValue: "Using API key" })
    : status.auth === "claude_login" ? t("claude.authLogin", { defaultValue: "Using your Claude login" }) : null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <span className="text-sm font-semibold">{t("claude.title", { defaultValue: "Claude" })}</span>
        {authHint && <span className="text-xs text-muted-foreground">{authHint}</span>}
        <Button variant="ghost" size="sm" className="ml-auto" disabled={streaming} onClick={reset}>
          {t("claude.newChat", { defaultValue: "New chat" })}
        </Button>
      </div>
      <div
        ref={logRef}
        role="log"
        aria-live="polite"
        onScroll={(e) => {
          const el = e.currentTarget;
          stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight <= 80;
        }}
        className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3"
      >
        {messages.length === 0 && (
          <div className="space-y-1.5">
            {SUGGESTIONS.map(([key, text]) => (
              <Button key={key} variant="ghost" className="h-auto w-full justify-start py-2 text-left text-sm font-normal" onClick={() => void send(t(key, { defaultValue: text }))}>
                {t(key, { defaultValue: text })}
              </Button>
            ))}
          </div>
        )}
        {messages.map((m) => <ChatMessage key={m.id} message={m} />)}
        {error && (
          <div className="flex items-center gap-2 text-[13px] text-destructive" role="alert">
            <span className="min-w-0 flex-1 break-words">{error}</span>
            {lastPrompt && !streaming && (
              <Button variant="secondary" size="sm" onClick={() => void send(lastPrompt)}>
                {t("claude.retry", { defaultValue: "Retry" })}
              </Button>
            )}
          </div>
        )}
      </div>
      <ChatComposer streaming={streaming} onSend={(text) => void send(text)} onStop={stop} />
    </div>
  );
}
