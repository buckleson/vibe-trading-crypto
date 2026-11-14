import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui";
import type { PortfolioConnectorCompatibility } from "@/lib/api";

const TONE = {
  native: "success",
  contract_tested: "info",
  experimental: "warning",
} as const;

/** Explain how far a connector has been verified for portfolio aggregation. */
export function PortfolioCompatibilityBadge({
  compatibility,
}: {
  compatibility?: PortfolioConnectorCompatibility;
}) {
  const { t } = useTranslation();
  if (!compatibility) return null;
  const label = compatibility.level === "native"
    ? t("portfolio.compatibility.native")
    : compatibility.level === "contract_tested"
      ? t("portfolio.compatibility.contractTested")
      : t("portfolio.compatibility.experimental");
  return <Badge tone={TONE[compatibility.level]} title={compatibility.note}>{label}</Badge>;
}
