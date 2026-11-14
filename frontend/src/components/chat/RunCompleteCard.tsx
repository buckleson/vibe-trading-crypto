import { useTranslation } from 'react-i18next';
import { lazy, memo, Suspense, useCallback, useEffect, useState } from "react";
import { Link } from "react-router";
import { LayoutDashboard, Code2, FileText, Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import { Button, Card, CardBody } from "@/components/ui";
import { AgentAvatar } from "./AgentAvatar";
import { MetricsCard } from "./MetricsCard";
import { PineScriptViewer } from "./PineScriptViewer";
import type { AgentMessage } from "@/types/agent";

const MiniEquityChart = lazy(() =>
  import("@/components/charts/MiniEquityChart").then((module) => ({
    default: module.MiniEquityChart,
  })),
);

function MiniEquityChartSkeleton() {
  return <div className="h-20 rounded-lg bg-muted" />;
}

interface Props {
  msg: AgentMessage;
}

export const RunCompleteCard = memo(function RunCompleteCard({ msg }: Props) {
  const { t } = useTranslation();
  const [curve, setCurve] = useState(msg.equityCurve);
  const [curveLoading, setCurveLoading] = useState(!msg.equityCurve && Boolean(msg.runId));
  const [pineCode, setPineCode] = useState<string | null>(null);
  const [pineLoading, setPineLoading] = useState(false);
  const [showPine, setShowPine] = useState(false);
  const [pineChecked, setPineChecked] = useState(false);
  const [pineExists, setPineExists] = useState(false);

  useEffect(() => {
    if (curve || !msg.runId) return;

    let cancelled = false;
    setCurveLoading(true);
    api.getRunPreview(msg.runId).then(r => {
      if (!cancelled) {
        setCurve(r.equity_curve.map(e => ({ time: e.time, equity: e.equity })));
      }
    }).catch(() => {}).finally(() => {
      if (!cancelled) setCurveLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [msg.runId, curve]);

  // Check if Pine Script exists for this run (skip for shadow-only cards with no runId)
  useEffect(() => {
    if (!msg.runId) {
      setPineChecked(true);
      return;
    }
    if (!pineChecked) {
      api.getRunPine(msg.runId).then(r => {
        setPineChecked(true);
        if (r.exists && r.content) {
          setPineExists(true);
          setPineCode(r.content);
        }
      }).catch(() => { setPineChecked(true); });
    }
  }, [msg.runId, pineChecked]);

  const handlePineClick = useCallback(async () => {
    if (pineCode) {
      setShowPine(true);
      return;
    }
    if (!msg.runId) return;
    setPineLoading(true);
    try {
      const r = await api.getRunPine(msg.runId);
      if (r.exists && r.content) {
        setPineCode(r.content);
        setPineExists(true);
        setShowPine(true);
      }
    } catch { /* ignore */ }
    finally { setPineLoading(false); }
  }, [pineCode, msg.runId]);

  return (
    <div className="flex gap-3">
      <AgentAvatar />
      <Card className="flex-1 min-w-0">
        <CardBody className="space-y-3">
        {msg.metrics && Object.keys(msg.metrics).length > 0 && (
          <MetricsCard metrics={msg.metrics} compact />
        )}
        {curveLoading ? (
          <MiniEquityChartSkeleton />
        ) : curve && curve.length > 1 ? (
          <Suspense fallback={<MiniEquityChartSkeleton />}>
            <MiniEquityChart data={curve} height={80} />
          </Suspense>
        ) : null}
        <div className="flex items-center gap-2 flex-wrap">
          {msg.runId && (
            <Link
              to={`/runs/${encodeURIComponent(msg.runId)}?view=dashboard`}
              className="inline-flex h-8 items-center justify-center gap-2 rounded-md bg-primary px-3 text-[13px] font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              <LayoutDashboard className="h-4 w-4" />
              {t("runComplete.fullReport")}
            </Link>
          )}
          {pineExists && (
            <Button size="sm" onClick={handlePineClick} disabled={pineLoading}>
              {pineLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Code2 className="h-4 w-4" />}
              Pine Script
            </Button>
          )}
          {msg.shadowId && (
            <a
              href={`/shadow-reports/${encodeURIComponent(msg.shadowId)}?format=html`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-8 items-center justify-center gap-2 rounded-md border border-border bg-card px-3 text-[13px] font-medium transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              <FileText className="h-4 w-4" />
              Shadow Report
            </a>
          )}
        </div>
        </CardBody>
        {showPine && pineCode && (
          <PineScriptViewer code={pineCode} onClose={() => setShowPine(false)} />
        )}
      </Card>
    </div>
  );
});
