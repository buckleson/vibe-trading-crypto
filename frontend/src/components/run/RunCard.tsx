import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Card, Table, TBody, TR, TD } from "@/components/ui";

/**
 * Shared Run-Card building blocks. Extracted from pages/RunDetail.tsx so that
 * FactorResearchPanel can reuse them without importing the page module (which
 * imports FactorResearchPanel back, creating a circular import).
 */
export function RunCardStat({ label, value, tone = "normal" }: { label: string; value: string; tone?: "normal" | "warning" | "positive" | "negative" }) {
  return (
    <Card className="p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={cn(
        "mt-1 truncate text-sm font-medium tabular-nums",
        tone === "warning" && "text-warning",
        tone === "positive" && "text-success",
        tone === "negative" && "text-danger",
      )}>{value}</div>
    </Card>
  );
}

export function RunCardPanel({ title, icon: Icon, children }: { title: string; icon: LucideIcon; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-border bg-card p-4 text-card-foreground">
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
        <Icon className="h-4 w-4 text-muted-foreground" />
        {title}
      </div>
      {children}
    </section>
  );
}

export function formatRunCardValue(value: unknown): string {
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : value.toFixed(4);
  if (typeof value === "object" && value !== null) return JSON.stringify(value);
  return String(value ?? "");
}

/**
 * Key/value table used by the Run-Card panels and the token-usage panel.
 * Lives here (not in pages/RunDetail.tsx) so components can reuse it without
 * importing the page module, which imports them back.
 */
export function KeyValueTable({ data, empty, monospaceValues = false }: { data: Record<string, unknown>; empty: string; monospaceValues?: boolean }) {
  const entries = Object.entries(data).filter(([, value]) => value !== undefined && value !== null && value !== "");
  if (entries.length === 0) {
    return <p className="text-sm text-muted-foreground">{empty}</p>;
  }
  return (
    <div>
      <Table className="table-fixed">
        <TBody>
          {entries.map(([key, value]) => (
            <TR key={key}>
              <TD className="w-36 break-words ps-4 align-top text-muted-foreground">{key}</TD>
              <TD className={cn("align-top", monospaceValues ? "break-all font-mono text-xs" : "break-words text-right tabular-nums")}>{formatRunCardValue(value)}</TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </div>
  );
}
