import { Cpu } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { LLMSettings } from "@/lib/api";
import { effortLabelKey } from "@/lib/reasoningEffort";

interface Props {
  settings: LLMSettings | null;
  runtimeProvider?: string;
  runtimeModel?: string;
  runtimeReasoningEffort?: string;
}

export function ModelRuntimeBar({
  settings,
  runtimeProvider,
  runtimeModel,
  runtimeReasoningEffort,
}: Props) {
  const { t } = useTranslation();
  if (!settings) return null;

  const providerId = runtimeProvider || settings.provider;
  const provider = settings.providers.find((item) => item.name === providerId);
  const providerLabel = provider?.label || providerId || t("agent.unknownProvider");
  const model = runtimeModel || settings.model_name || t("agent.unknownModel");
  const reasoningEffort = runtimeReasoningEffort !== undefined
    ? runtimeReasoningEffort
    : settings.reasoning_effort;
  const effortKey = effortLabelKey(reasoningEffort);
  const effortLabel = effortKey ? t(effortKey) : t("settings.providerDefault");

  return (
    <div className="shrink-0 border-b border-border bg-background px-4 py-2">
      <div className="mx-auto flex max-w-3xl items-center gap-2 overflow-hidden text-xs">
        <span className="inline-flex h-2 w-2 shrink-0 rounded-full bg-success" aria-hidden="true" />
        <span className="shrink-0 font-medium text-foreground">{providerLabel}</span>
        <span className="text-muted-foreground">·</span>
        <span className="truncate font-mono text-xs text-muted-foreground" title={model}>{model}</span>
        <span className="ml-auto inline-flex shrink-0 items-center gap-1.5 rounded-md bg-muted px-2 py-0.5 text-xs text-muted-foreground">
          <Cpu className="h-4 w-4" aria-hidden="true" />
          {t("agent.reasoningStrength")}: {effortLabel}
        </span>
      </div>
    </div>
  );
}
