import type { ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { AlertCircle, Check, Loader2, Wrench } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ChatPart } from "./store";

type ToolPart = Extract<ChatPart, { kind: "tool" }>;

export function ToolCallRow({ part }: { part: ToolPart }): ReactElement {
  const { t } = useTranslation();
  const label = part.name.replace(/_/g, " ");
  const result = part.result;
  return (
    <details className="group rounded-md border border-border text-[13px]">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-2.5 py-1.5 text-muted-foreground">
        <Wrench className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate">{t("claude.usedTool", { defaultValue: "Used {{name}}", name: label })}</span>
        {!result && <Loader2 className="h-4 w-4 animate-spin" role="status" aria-label={t("claude.toolRunning", { defaultValue: "Running" })} />}
        {result && !result.isError && <Check className="h-4 w-4 text-success" aria-label={t("claude.toolDone", { defaultValue: "Done" })} />}
        {result?.isError && <AlertCircle className="h-4 w-4 text-destructive" aria-label={t("claude.toolFailed", { defaultValue: "Failed" })} />}
      </summary>
      <div className="space-y-2 border-t border-border px-2.5 py-2 font-mono text-xs">
        <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words">{JSON.stringify(part.input, null, 2)}</pre>
        {result && (
          <pre className={cn("max-h-48 overflow-auto whitespace-pre-wrap break-words rounded px-2 py-1", result.isError ? "bg-destructive/10 text-destructive" : "bg-muted")}>
            {result.preview}
          </pre>
        )}
      </div>
    </details>
  );
}
