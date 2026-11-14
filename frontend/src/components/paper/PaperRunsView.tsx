import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import { useTranslation } from "react-i18next";
import { LineChart } from "lucide-react";
import { Badge, Button, Card, EmptyState } from "@/components/ui";
import { Skeleton } from "@/components/common/Skeleton";
import { cn } from "@/lib/utils";
import {
  formatNumber, formatPercent, paperRunsApi, relativeTime, toneClass, type PaperRun,
} from "@/lib/paperRuns";
import { PaperRunDetail } from "./PaperRunDetail";
import { StartPaperRunDialog } from "./StartPaperRunDialog";

export function PaperRunsView({ startOpen, presetRunId, onOpenStart, onCloseStart }: {
  startOpen: boolean;
  presetRunId?: string;
  onOpenStart: () => void;
  onCloseStart: () => void;
}) {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const [runs, setRuns] = useState<PaperRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const selected = params.get("run") ?? "";

  const select = useCallback((id: string | null) => {
    setParams((p) => {
      const next = new URLSearchParams(p);
      if (id) next.set("run", id);
      else next.delete("run");
      return next;
    }, { replace: true });
  }, [setParams]);

  useEffect(() => {
    let active = true;
    paperRunsApi
      .list()
      .then((items) => {
        if (active) setRuns(items);
      })
      .catch((e: Error) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const updateRun = useCallback((run: PaperRun) => {
    setRuns((items) => items.map((r) => (r.id === run.id ? run : r)));
  }, []);

  const startButton = (
    <Button variant="primary" onClick={onOpenStart}>
      {t("paper.startRun", { defaultValue: "Start paper run" })}
    </Button>
  );

  return (
    <div>
      {error && <p role="alert" className="mb-3 text-[13px] text-danger">{error}</p>}
      {!loading && runs.length === 0 ? (
        <Card>
          <EmptyState
            icon={LineChart}
            title={t("paper.noRuns", { defaultValue: "No paper runs yet" })}
            description={t("paper.noRunsBody", { defaultValue: "Start one from any finished backtest. Results count only from the moment you start." })}
            action={startButton}
          />
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[360px_minmax(0,1fr)]">
          <ul className="space-y-2" aria-label={t("paper.runsList", { defaultValue: "Paper runs" })}>
            {loading
              ? [0, 1, 2].map((i) => (
                  <li key={i}><Skeleton className="h-20 w-full" /></li>
                ))
              : runs.map((r) => {
                  const s = r.summary;
                  return (
                    <li key={r.id}>
                      <button
                        type="button"
                        onClick={() => select(r.id)}
                        aria-current={selected === r.id ? "true" : undefined}
                        className={cn(
                          "w-full rounded-lg border bg-card p-3 text-left transition-colors duration-150",
                          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
                          selected === r.id ? "border-primary" : "border-border hover:bg-muted/40",
                        )}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold">{r.label}</p>
                            <p className="truncate text-[13px] text-muted-foreground">
                              {r.codes.join(", ")} {t("paper.on", { defaultValue: "on" })} {r.interval}
                            </p>
                          </div>
                          <div className="flex shrink-0 flex-wrap justify-end gap-1">
                            <Badge tone={r.status === "active" ? "info" : "neutral"}>
                              {r.status === "active" ? t("paper.active", { defaultValue: "Active" }) : t("paper.stopped", { defaultValue: "Stopped" })}
                            </Badge>
                            {r.state === "waiting" && <Badge tone="warning">{t("paper.waiting", { defaultValue: "Waiting for data" })}</Badge>}
                            {r.state === "error" && <Badge tone="danger">{t("paper.error", { defaultValue: "Error" })}</Badge>}
                          </div>
                        </div>
                        <div className="mt-2 flex items-baseline justify-between gap-2 text-[13px]">
                          <span className="tabular-nums">{s ? formatNumber(s.equity) : "n/a"}</span>
                          {s && (
                            <span className={cn("tabular-nums", toneClass(s.total_return))}>
                              {formatPercent(s.total_return, true)}
                            </span>
                          )}
                        </div>
                        {r.last_refreshed_at && (
                          <p className="mt-1 text-xs text-muted-foreground">
                            {t("paper.updated", { defaultValue: "Updated {{when}}", when: relativeTime(r.last_refreshed_at) })}
                          </p>
                        )}
                      </button>
                    </li>
                  );
                })}
          </ul>
          <div className="min-w-0">
            {selected ? (
              <PaperRunDetail
                runId={selected}
                onRun={updateRun}
                onDeleted={(id) => {
                  setRuns((items) => items.filter((r) => r.id !== id));
                  select(null);
                }}
              />
            ) : (
              !loading && (
                <Card>
                  <EmptyState title={t("paper.pickRun", { defaultValue: "Select a paper run to see its results" })} />
                </Card>
              )
            )}
          </div>
        </div>
      )}
      {startOpen && (
        <StartPaperRunDialog
          presetRunId={presetRunId}
          onClose={onCloseStart}
          onCreated={(run) => {
            setRuns((items) => [run, ...items]);
            select(run.id);
            onCloseStart();
          }}
        />
      )}
    </div>
  );
}
