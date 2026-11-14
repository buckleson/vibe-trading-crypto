import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

const TONES = { neutral: "text-foreground", success: "text-success", danger: "text-danger" } as const;

export function Stat({ label, value, hint, tone = "neutral", className }: {
  label: ReactNode; value: ReactNode; hint?: ReactNode; tone?: keyof typeof TONES; className?: string;
}) {
  return (
    <div className={className}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={cn("text-2xl font-semibold tabular-nums", TONES[tone])}>{value}</div>
      {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}
