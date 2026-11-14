import { memo } from "react";
import i18n from "@/i18n";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui";
import { getMetricLabel, DISPLAY_ORDER, formatMetricVal, metricSentiment } from "@/lib/formatters";

const SENTIMENT = {
  positive: "text-success",
  neutral: "text-foreground",
  negative: "text-danger",
} as const;

// Verdict must never be color-only: metricSentiment is a threshold judgment
// (Sharpe +0.20 renders red, +1.50 green - identical glyphs otherwise), so a
// redundant shape + sr-only word carries it for color-blind and AT users.
const SENTIMENT_GLYPH: Partial<Record<string, string>> = { positive: "▲", negative: "▼" };
const SENTIMENT_SR_KEY: Partial<Record<string, string>> = { positive: "metrics.good", negative: "metrics.poor" };

interface Props {
  metrics: Record<string, number>;
  compact?: boolean;
}

export const MetricsCard = memo(function MetricsCard({ metrics, compact = false }: Props) {
  const entries = DISPLAY_ORDER
    .filter((k) => metrics[k] != null)
    .map((k) => ({ k, v: metrics[k] }));

  if (entries.length === 0) return null;

  const shown = compact ? entries.slice(0, 6) : entries;

  return (
    <Card className={cn(
      "grid gap-x-4 gap-y-3 p-3",
      compact ? "grid-cols-3" : "grid-cols-[repeat(auto-fit,minmax(120px,1fr))]"
    )}>
      {shown.map(({ k, v }) => (
        <div
          key={k}
          className="min-w-0"
          title={i18n.t(`metrics.gloss.${k}` as never)}
        >
          <p className="text-xs text-muted-foreground font-medium">
            {getMetricLabel(k)}
          </p>
          <p className={cn(
            "text-sm font-semibold tabular-nums",
            SENTIMENT[metricSentiment(k, v)]
          )}>
            {SENTIMENT_GLYPH[metricSentiment(k, v)] != null && (
              <span aria-hidden="true" className="me-0.5 text-xs align-middle">
                {SENTIMENT_GLYPH[metricSentiment(k, v)]}
              </span>
            )}
            {formatMetricVal(k, v)}
            {SENTIMENT_SR_KEY[metricSentiment(k, v)] != null && (
              <span className="sr-only"> {i18n.t(SENTIMENT_SR_KEY[metricSentiment(k, v)]! as never)}</span>
            )}
          </p>
        </div>
      ))}
    </Card>
  );
});
