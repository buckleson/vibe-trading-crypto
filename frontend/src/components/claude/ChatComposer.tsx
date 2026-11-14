import { useEffect, useRef, useState, type KeyboardEvent, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { ArrowUp, Square } from "lucide-react";
import { Button, Textarea } from "@/components/ui";

const MAX_ROWS = 8;

export function ChatComposer({ streaming, onSend, onStop }: {
  streaming: boolean;
  onSend: (text: string) => void;
  onStop: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const [text, setText] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    const line = parseFloat(getComputedStyle(el).lineHeight) || 20;
    el.style.height = `${Math.min(el.scrollHeight, line * MAX_ROWS + 16)}px`;
  }, [text]);

  const submit = () => {
    if (!text.trim() || streaming) return;
    onSend(text);
    setText("");
  };
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div className="flex items-end gap-2 border-t border-border p-3">
      <Textarea
        ref={ref}
        rows={1}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={t("claude.placeholder", { defaultValue: "Ask Claude about your strategies" })}
        aria-label={t("claude.placeholder", { defaultValue: "Ask Claude about your strategies" })}
        className="min-h-9 flex-1 resize-none"
      />
      {streaming ? (
        <Button variant="secondary" size="sm" onClick={onStop} className="h-9">
          <Square className="h-3.5 w-3.5" aria-hidden="true" />
          {t("claude.stop", { defaultValue: "Stop" })}
        </Button>
      ) : (
        <Button variant="primary" size="icon" onClick={submit} disabled={!text.trim()} aria-label={t("claude.send", { defaultValue: "Send" })}>
          <ArrowUp className="h-4 w-4" aria-hidden="true" />
        </Button>
      )}
    </div>
  );
}
