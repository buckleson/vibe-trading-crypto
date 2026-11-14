import { Table, TBody, TD, TH, THead, TR } from "@/components/ui";
import i18n from "@/i18n";
import type { DrawdownEpisode } from "@/lib/tearsheet";

interface Props {
  episodes: DrawdownEpisode[];
}

export function TopDrawdownsPanel({ episodes }: Props) {
  if (episodes.length === 0) {
    return <div className="text-muted-foreground text-sm p-4">{i18n.t("runDetail.noTearsheetData")}</div>;
  }
  return (
    <Table>
      <THead>
        <TR>
          <TH>{i18n.t("runDetail.ddRank")}</TH>
          <TH numeric>{i18n.t("runDetail.ddDepth")}</TH>
          <TH>{i18n.t("runDetail.ddPeak")}</TH>
          <TH>{i18n.t("runDetail.ddTrough")}</TH>
          <TH>{i18n.t("runDetail.ddRecovery")}</TH>
          <TH numeric>{i18n.t("runDetail.ddPeakToTrough")}</TH>
          <TH numeric>{i18n.t("runDetail.ddTroughToRecovery")}</TH>
        </TR>
      </THead>
      <TBody>
        {episodes.map((ep, i) => (
          <TR key={`${ep.peakTime}-${i}`}>
            <TD className="tabular-nums text-muted-foreground">{i + 1}</TD>
            <TD numeric className="text-danger">{(ep.depth * 100).toFixed(2)}%</TD>
            <TD className="text-xs">{ep.peakTime}</TD>
            <TD className="text-xs">{ep.troughTime}</TD>
            <TD className="text-xs">{ep.recoveryTime ?? i18n.t("runDetail.ddNotRecovered")}</TD>
            <TD numeric>{ep.peakToTroughDays != null ? i18n.t("runDetail.ddDays", { count: ep.peakToTroughDays }) : "-"}</TD>
            <TD numeric>{ep.troughToRecoveryDays != null ? i18n.t("runDetail.ddDays", { count: ep.troughToRecoveryDays }) : "-"}</TD>
          </TR>
        ))}
      </TBody>
    </Table>
  );
}
