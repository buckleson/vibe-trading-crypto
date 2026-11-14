import { useTranslation } from "react-i18next";
import { Coins, Hash } from "lucide-react";
import type { LlmUsage } from "@/lib/api";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui";
import { KeyValueTable, RunCardPanel } from "@/components/run/RunCard";

// A missing cache key means the provider never reported a cache event for
// that scope - never "0 tokens". Totals rows render only when their key is
// present; the per-iteration table only gains a cache column when at least
// one iteration reported it, and unreported cells show this marker.
const NOT_REPORTED = "-";

function cacheCell(value: number | undefined): string {
  return value === undefined ? NOT_REPORTED : String(value);
}

export function LlmUsagePanel({ usage }: { usage: LlmUsage }) {
  const { t } = useTranslation();
  const { totals } = usage;

  const summary: Record<string, unknown> = {
    [t("runDetail.llmUsage.provider")]: usage.provider,
    [t("runDetail.llmUsage.model")]: usage.model,
    [t("runDetail.llmUsage.inputTokens")]: totals.input_tokens,
    [t("runDetail.llmUsage.outputTokens")]: totals.output_tokens,
    [t("runDetail.llmUsage.totalTokens")]: totals.total_tokens,
    [t("runDetail.llmUsage.calls")]: totals.calls,
  };
  if (totals.cache_read_tokens !== undefined) {
    summary[t("runDetail.llmUsage.cacheRead")] = totals.cache_read_tokens;
  }
  if (totals.cache_creation_tokens !== undefined) {
    summary[t("runDetail.llmUsage.cacheCreation")] = totals.cache_creation_tokens;
  }

  const calls = usage.per_iteration;
  const hasCacheRead = calls.some((call) => call.cache_read_tokens !== undefined);
  const hasCacheCreation = calls.some((call) => call.cache_creation_tokens !== undefined);

  return (
    <div className="p-4 space-y-4">
      <div data-testid="llm-usage-summary">
        <RunCardPanel title={t("runDetail.llmUsage.tab")} icon={Coins}>
          <KeyValueTable data={summary} empty={t("runDetail.noneRecorded")} />
        </RunCardPanel>
      </div>
      {calls.length > 0 && (
        <div data-testid="llm-usage-iterations">
          <RunCardPanel title={t("runDetail.llmUsage.perIteration")} icon={Hash}>
            <div className="overflow-x-auto">
              <Table>
                <THead>
                  <tr>
                    <TH className="ps-4">{t("runDetail.llmUsage.iteration")}</TH>
                    <TH numeric>{t("runDetail.llmUsage.inputTokens")}</TH>
                    <TH numeric>{t("runDetail.llmUsage.outputTokens")}</TH>
                    <TH numeric>{t("runDetail.llmUsage.totalTokens")}</TH>
                    {hasCacheRead && <TH numeric>{t("runDetail.llmUsage.cacheRead")}</TH>}
                    {hasCacheCreation && <TH numeric>{t("runDetail.llmUsage.cacheCreation")}</TH>}
                  </tr>
                </THead>
                <TBody>
                  {calls.map((call, index) => (
                    <TR key={`${index}-${call.iter}`}>
                      <TD className="ps-4 ">{call.iter}</TD>
                      <TD numeric>{call.input_tokens}</TD>
                      <TD numeric>{call.output_tokens}</TD>
                      <TD numeric>{call.total_tokens}</TD>
                      {hasCacheRead && <TD numeric>{cacheCell(call.cache_read_tokens)}</TD>}
                      {hasCacheCreation && <TD numeric>{cacheCell(call.cache_creation_tokens)}</TD>}
                    </TR>
                  ))}
                </TBody>
              </Table>
            </div>
          </RunCardPanel>
        </div>
      )}
    </div>
  );
}
