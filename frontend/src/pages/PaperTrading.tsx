import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import { useTranslation } from "react-i18next";
import { Button, Page, PageHeader, Tabs } from "@/components/ui";
import { ManualAccounts } from "@/components/paper/ManualAccounts";
import { PaperRunsView } from "@/components/paper/PaperRunsView";

export function PaperTrading() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") === "manual" ? "manual" : "runs";
  const [startOpen, setStartOpen] = useState(false);
  const [preset, setPreset] = useState<string | undefined>();
  const fromRun = params.get("from_run");

  useEffect(() => {
    if (!fromRun) return;
    setPreset(fromRun);
    setStartOpen(true);
    setParams((p) => {
      const next = new URLSearchParams(p);
      next.delete("from_run");
      next.delete("tab");
      return next;
    }, { replace: true });
  }, [fromRun, setParams]);

  const setTab = (id: string) =>
    setParams((p) => {
      const next = new URLSearchParams(p);
      if (id === "manual") next.set("tab", "manual");
      else next.delete("tab");
      return next;
    }, { replace: true });

  return (
    <Page width="wide">
      <PageHeader
        title={t("paper.title", { defaultValue: "Paper trading" })}
        description={t("paper.pageDescription", { defaultValue: "Test strategies on live market data without placing real orders." })}
        actions={
          <Button
            variant="primary"
            onClick={() => {
              setPreset(undefined);
              setStartOpen(true);
              if (tab !== "runs") setTab("runs");
            }}
          >
            {t("paper.startRun", { defaultValue: "Start paper run" })}
          </Button>
        }
      />
      <Tabs
        aria-label={t("paper.tabs", { defaultValue: "Paper trading views" })}
        value={tab}
        onChange={setTab}
        tabs={[
          { id: "runs", label: t("paper.tabRuns", { defaultValue: "Strategy runs" }) },
          { id: "manual", label: t("paper.tabManual", { defaultValue: "Manual accounts" }) },
        ]}
      />
      {tab === "runs" ? (
        <PaperRunsView
          startOpen={startOpen}
          presetRunId={preset}
          onOpenStart={() => {
            setPreset(undefined);
            setStartOpen(true);
          }}
          onCloseStart={() => setStartOpen(false)}
        />
      ) : (
        <ManualAccounts />
      )}
    </Page>
  );
}
