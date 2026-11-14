import i18n from '@/i18n';
import { useEffect, useRef, useState } from "react";
import { Badge, Button, Card, CardBody, CardHeader, Input, Page, PageHeader, Tabs } from "@/components/ui";
import { CorrelationMatrix } from "@/components/charts/CorrelationMatrix";
import { RegimeTimeline } from "@/components/charts/RegimeTimeline";
import { api, type CorrelationAnalysisResponse } from "@/lib/api";
import { useAnalysisState } from "@/hooks/useAnalysisState";
import { shannon } from "@/lib/shannon";
import { ShannonPortfolio } from "@/components/charts/ShannonPortfolio";

const WINDOWS = [30, 60, 90, 180, 365] as const;

export function Correlation() {
  const [tab, setTab] = useState("correlation");
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    let controller: AbortController;
    function refresh() {
      controller?.abort();
      const signal = (controller = new AbortController()).signal;
      shannon.status(signal).then(status => update(status.configured)).catch(() => update(false));
      function update(enabled: boolean) {
        if (signal.aborted) return;
        setAvailable(enabled);
        if (!enabled) setTab("correlation");
      }
    }
    refresh();
    window.addEventListener("focus", refresh);
    return () => {
      controller.abort();
      window.removeEventListener("focus", refresh);
    };
  }, []);
  return <>
    {available && <Page className="pb-0 md:pb-0">
      <Tabs aria-label={i18n.t("correlation.title")} value={tab} onChange={setTab}
        tabs={[{ id: "correlation", label: i18n.t("correlation.title") }, { id: "shannon", label: i18n.t("gildata.shannon") }]} />
    </Page>}
    <div hidden={tab !== "correlation"}><CorrelationAnalysis /></div>
    {tab === "shannon" && <Page><ShannonPortfolio /></Page>}
  </>;
}

function CorrelationAnalysis() {
  const [draft, setDraft] = useAnalysisState("correlation", {
    codes: "000001.SZ,600519.SH,000858.SZ,601318.SH", days: 90,
    method: "pearson" as "pearson" | "spearman", showRegime: false,
    result: null as CorrelationAnalysisResponse | null, resultQuery: "", computedAt: "",
  });
  const { codes, days, method, showRegime, result, resultQuery, computedAt } = draft;
  const setCodes = (codes: string) => setDraft((d) => ({ ...d, codes }));
  const setDays = (days: number) => setDraft((d) => ({ ...d, days }));
  const setMethod = (method: "pearson" | "spearman") => setDraft((d) => ({ ...d, method }));
  const setShowRegime = (showRegime: boolean) => setDraft((d) => ({ ...d, showRegime }));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const labels = result?.correlation?.labels ?? [];
  const matrix = result?.correlation?.matrix ?? [];
  const regime = result?.regime ?? null;
  const requestGeneration = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const parsedCodes = codes.split(/[,;\s，；]+/).map((code) => code.trim().toUpperCase()).filter(Boolean);
  const uniqueCodes = new Set(parsedCodes.map((code) => code.replace(/\.US$/, "")));
  const inputValid = parsedCodes.length >= 2 && parsedCodes.length <= 20 && uniqueCodes.size === parsedCodes.length;
  const query = JSON.stringify({ codes: parsedCodes.join(","), days, method, showRegime });
  const fresh = resultQuery === query;
  useEffect(() => () => { requestGeneration.current += 1; controller.current?.abort(); }, []);

  const invalidateResult = () => {
    requestGeneration.current += 1;
    controller.current?.abort();
    setError(null);
    setLoading(false);
  };

  const compute = async () => {
    if (!inputValid) return;
    controller.current?.abort();
    const pending = new AbortController();
    controller.current = pending;
    const generation = ++requestGeneration.current;
    setError(null);
    setLoading(true);
    try {
      const response = await api.getCorrelationAnalysis(parsedCodes.join(","), days, method, showRegime, pending.signal);
      if (requestGeneration.current === generation) {
        setDraft((d) => ({ ...d, result: response, resultQuery: query, computedAt: new Date().toISOString() }));
      }
    } catch (e) {
      if (!pending.signal.aborted && requestGeneration.current === generation) {
        setError(e instanceof Error ? e.message : i18n.t("correlation.failedToCompute"));
      }
    } finally {
      if (requestGeneration.current === generation) setLoading(false);
    }
  };

  const chip = "h-8 rounded-md border px-3 text-[13px] transition-colors";
  const chipOn = "border-primary bg-primary text-primary-foreground";
  const chipOff = "border-border text-muted-foreground hover:border-primary hover:text-foreground";
  return (
    <Page>
      <PageHeader title={i18n.t("correlation.title")} />

      <Card>
        <CardBody className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="correlation-codes" className="text-[13px] font-medium">{i18n.t("correlation.assetCodes")}</label>
            <Input
              id="correlation-codes"
              type="text"
              value={codes}
              onChange={(e) => {
                invalidateResult();
                setCodes(e.target.value);
              }}
              placeholder="000001.SZ,600519.SH,000858.SZ"
            />
            {parsedCodes.length > 0 && (
              <div className="flex flex-wrap gap-1.5" aria-hidden="true">
                {parsedCodes.map((code, index) => <Badge key={`${code}-${index}`}>{code}</Badge>)}
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              {i18n.t("correlation.assetCodesHint")}
            </p>
          </div>

          <div className="flex flex-wrap gap-4">
            <div className="flex flex-col gap-1.5">
              <span className="text-[13px] font-medium">{i18n.t("analysis.windowObservations")}</span>
              <div className="flex gap-1.5">
                {WINDOWS.map((w) => (
                  <button
                    key={w}
                    onClick={() => {
                      invalidateResult();
                      setDays(w);
                    }}
                    className={`${chip} ${days === w ? chipOn : chipOff}`}
                  >
                    {w}d
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <span className="text-[13px] font-medium">{i18n.t("correlation.method")}</span>
              <div className="flex gap-1.5">
                {(["pearson", "spearman"] as const).map((m) => (
                  <button
                    key={m}
                    onClick={() => {
                      invalidateResult();
                      setMethod(m);
                    }}
                    className={`${chip} ${method === m ? chipOn : chipOff}`}
                  >
                    {i18n.t(`correlation.method_${m}`)}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="flex cursor-pointer items-center gap-2 text-[13px] font-medium">
              <input
                type="checkbox"
                checked={showRegime}
                onChange={(e) => {
                  invalidateResult();
                  setShowRegime(e.target.checked);
                }}
                className="h-4 w-4 accent-primary"
              />
              {i18n.t("correlation.regimeTimeline")}
            </label>
            {showRegime && (
              <p className="text-xs text-muted-foreground">
                {i18n.t("correlation.regimeTimelineHint")}
              </p>
            )}
          </div>

          <Button variant="primary" className="self-start" onClick={compute} disabled={loading || !inputValid}>
            {loading ? i18n.t("correlation.loading") : i18n.t("correlation.compute")}
          </Button>
          {!inputValid && <p role="alert" className="text-sm text-warning">{i18n.t("analysis.assetsValidation")}</p>}
        </CardBody>
      </Card>

      {error && (
        <div className="rounded-lg border border-danger/30 bg-danger/5 p-3 text-sm text-danger">
          {error}
        </div>
      )}

      {result && <Card><CardBody className="space-y-2 text-sm" role="status">
        <p>{fresh ? i18n.t("analysis.updated") : i18n.t("analysis.previousResult")} · {i18n.t("analysis.lastComputed", { time: new Date(computedAt).toLocaleTimeString() })}</p>
        <p className="text-muted-foreground">{i18n.t("analysis.coverage", { count: result.coverage.observations, start: result.coverage.first_date ?? "–", end: result.coverage.last_date ?? "–" })}</p>
        <p className="text-xs">{i18n.t("analysis.usedAssets", { assets: labels.join(", ") || "–" })}</p>
        {result.coverage.missing.length > 0 && <p className="text-warning">{i18n.t("analysis.missingAssets", { assets: result.coverage.missing.join(", ") })}</p>}
        {result.coverage.missing.map((code) => <p key={code} className="text-xs text-muted-foreground">{code}: {result.coverage.diagnostics[code]?.attempts.map((a) => `${a.source}: ${i18n.t(`analysis.${a.reason}`)}`).join("; ")}</p>)}
        {Object.entries(result.errors).map(([section, message]) => <p role="alert" key={section} className="text-danger">{i18n.t(section === "regime" ? "correlation.regimeTimeline" : "correlation.title")}: {message}</p>)}
        {regime && <p className="text-xs text-muted-foreground">{i18n.t("analysis.regimeMethod")}</p>}
      </CardBody></Card>}

      {regime && <Card>
        <CardHeader title={i18n.t("correlation.regimeTimeline")} />
        <CardBody><RegimeTimeline data={regime} height={260} /></CardBody>
      </Card>}

      {labels.length > 0 && <Card>
        <CardHeader title={i18n.t("correlation.title")} />
        <CardBody className="overflow-x-auto"><div className="min-w-[420px]"><CorrelationMatrix labels={labels} matrix={matrix} height={520} /></div></CardBody>
      </Card>}
    </Page>
  );
}
