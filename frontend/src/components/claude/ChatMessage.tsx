import type { ReactElement } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ToolCallRow } from "./ToolCallRow";
import type { ChatMsg } from "./store";

export function ChatMessage({ message }: { message: ChatMsg }): ReactElement | null {
  if (message.role === "user") {
    const text = message.parts.map((p) => (p.kind === "text" ? p.text : "")).join("");
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-lg bg-muted px-3 py-2 text-sm">{text}</div>
      </div>
    );
  }
  if (message.parts.length === 0) return null;
  return (
    <div className="space-y-2">
      {message.parts.map((p, i) =>
        p.kind === "tool" ? (
          <ToolCallRow key={p.id} part={p} />
        ) : (
          <div key={i} className="prose prose-sm dark:prose-invert max-w-none">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{p.text}</ReactMarkdown>
          </div>
        ),
      )}
    </div>
  );
}
