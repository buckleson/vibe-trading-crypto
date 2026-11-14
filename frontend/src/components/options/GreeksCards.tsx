import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { Card, CardBody, CardHeader, Stat } from "@/components/ui";
import type { OptionsGreeks } from "@/lib/options";

type Tone = "positive" | "negative" | "warning" | "neutral";

const STAT_TONE = { positive: "success", negative: "danger", warning: "neutral", neutral: "neutral" } as const;

function GreekCard({ label, value, desc, tone }: { label: string; value: string; desc: string; tone: Tone }) {
  return (
    <Stat label={label} value={<span className={cn("block truncate text-lg", tone === "warning" && "text-warning")}>{value}</span>}
      hint={desc} tone={STAT_TONE[tone]} />
  );
}

interface Props {
  greeks: OptionsGreeks;
}

export function GreeksCards({ greeks }: Props) {
  const { t } = useTranslation();

  const signTone = (v: number): Tone => (v > 0 ? "positive" : v < 0 ? "negative" : "neutral");

  return (
    <Card>
      <CardHeader title={t("options.greeks.title")} />
      <CardBody className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
        <GreekCard
          label={t("options.greeks.delta")}
          value={greeks.delta.toLocaleString(undefined, { maximumFractionDigits: 2 })}
          desc={t("options.greeks.deltaDesc")}
          tone={signTone(greeks.delta)}
        />
        <GreekCard
          label={t("options.greeks.gamma")}
          value={greeks.gamma.toLocaleString(undefined, { maximumFractionDigits: 4 })}
          desc={t("options.greeks.gammaDesc")}
          tone="neutral"
        />
        <GreekCard
          label={t("options.greeks.theta")}
          value={greeks.theta.toLocaleString(undefined, { maximumFractionDigits: 2 })}
          desc={t("options.greeks.thetaDesc")}
          tone={greeks.theta < 0 ? "warning" : signTone(greeks.theta)}
        />
        <GreekCard
          label={t("options.greeks.vega")}
          value={greeks.vega.toLocaleString(undefined, { maximumFractionDigits: 2 })}
          desc={t("options.greeks.vegaDesc")}
          tone={signTone(greeks.vega)}
        />
        <GreekCard
          label={t("options.greeks.rho")}
          value={greeks.rho.toLocaleString(undefined, { maximumFractionDigits: 2 })}
          desc={t("options.greeks.rhoDesc")}
          tone="neutral"
        />
      </CardBody>
    </Card>
  );
}
