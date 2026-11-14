import type { ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { EmptyState } from "@/components/ui";

export function terminalAvailable(): boolean {
  return false;
}

export function TerminalPanel(): ReactElement {
  const { t } = useTranslation();
  return <EmptyState title={t("terminal.comingSoon", { defaultValue: "The terminal is only available in the desktop app" })} />;
}
