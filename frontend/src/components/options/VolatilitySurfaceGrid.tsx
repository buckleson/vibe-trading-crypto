import { useEffect, useRef, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import {
  buildVolatilitySurfaceRequest,
  DEFAULT_SURFACE_EXPIRY_DAYS,
  DEFAULT_SURFACE_OBSERVATIONS,
  DEFAULT_SURFACE_STRIKES,
  type SurfaceObservationInput,
  volatilitySurfaceIssue,
  type VolatilitySurfacePoint,
  type VolatilitySurfaceResponse,
} from "@/lib/options";
import { cn } from "@/lib/utils";
import { Button, Card, CardBody, CardHeader, Input } from "@/components/ui";

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

/** Single-hue sequential scale: primary at 0.10 (low IV) to 0.82 (high IV). */
function scaleAlpha(ratio: number): number {
  return Number((0.1 + ratio * 0.72).toFixed(3));
}

function pointKey(point: Pick<VolatilitySurfacePoint, "strike" | "time_to_expiry">): string {
  return `${point.strike}:${point.time_to_expiry}`;
}

export function VolatilitySurfaceGrid() {
  const { t } = useTranslation();
  const [spot, setSpot] = useState("100");
  const [strikes, setStrikes] = useState(DEFAULT_SURFACE_STRIKES);
  const [expiryDays, setExpiryDays] = useState(DEFAULT_SURFACE_EXPIRY_DAYS);
  const [observations, setObservations] = useState<SurfaceObservationInput[]>(
    () => DEFAULT_SURFACE_OBSERVATIONS.map((observation) => ({ ...observation })),
  );
  const [result, setResult] = useState<VolatilitySurfaceResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nextId = useRef(DEFAULT_SURFACE_OBSERVATIONS.length + 1);
  const generation = useRef(0);
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => () => {
    generation.current += 1;
    controllerRef.current?.abort();
  }, []);

  const updateObservation = (id: number, field: keyof Omit<SurfaceObservationInput, "id">, value: string) => {
    setObservations((current) => current.map((observation) => (
      observation.id === id ? { ...observation, [field]: value } : observation
    )));
  };

  const addObservation = () => {
    const id = nextId.current++;
    setObservations((current) => [...current, {
      id,
      strike: "100",
      expiryDays: "60",
      ivPct: "30",
    }]);
  };

  const compute = async (event: FormEvent) => {
    event.preventDefault();
    const currentGeneration = ++generation.current;
    controllerRef.current?.abort();
    const request = buildVolatilitySurfaceRequest(spot, observations, strikes, expiryDays);
    const issue = request ? volatilitySurfaceIssue(request) : null;
    if (!request || issue) {
      controllerRef.current = null;
      setLoading(false);
      setResult(null);
      setError(issue ? t(`options.surface.${issue.key}`, issue.values) : t("options.surface.invalid"));
      return;
    }
    const controller = new AbortController();
    controllerRef.current = controller;
    setLoading(true);
    setError(null);
    try {
      const next = await api.computeVolatilitySurface(request, controller.signal);
      if (generation.current === currentGeneration) setResult(next);
    } catch (cause) {
      if (generation.current === currentGeneration && !controller.signal.aborted) {
        setResult(null);
        setError(cause instanceof Error ? cause.message : t("options.surface.invalid"));
      }
    } finally {
      if (generation.current === currentGeneration) setLoading(false);
    }
  };

  const points = new Map(result?.points.map((point) => [pointKey(point), point]) ?? []);
  const ivValues = result?.points.map((point) => point.implied_volatility) ?? [];
  const minIv = ivValues.length ? Math.min(...ivValues) : 0;
  const maxIv = ivValues.length ? Math.max(...ivValues) : 0;

  const cellStyle = (point: VolatilitySurfacePoint) => {
    const ratio = maxIv === minIv ? 0.5 : (point.implied_volatility - minIv) / (maxIv - minIv);
    return {
      backgroundColor: `hsl(var(--primary) / ${scaleAlpha(ratio)})`,
      color: ratio > 0.62 ? "hsl(var(--primary-foreground))" : undefined,
    };
  };

  return (
    <Card>
      <CardHeader title={t("options.surface.title")} description={t("options.surface.subtitle")} />
      <CardBody>
      <form className="flex flex-col gap-3" onSubmit={compute}>
        <div className="grid gap-3 md:grid-cols-3">
          <label className="block">
            <span className="mb-1.5 block text-[13px] font-medium">{t("options.surface.spot")}</span>
            <Input aria-label={t("options.surface.spot")} inputMode="decimal" value={spot} onChange={(event) => setSpot(event.target.value)} />
            <span className="mt-1 block text-xs leading-4 text-muted-foreground">{t("options.surface.spotHint")}</span>
          </label>
          <label className="block">
            <span className="mb-1.5 block text-[13px] font-medium">{t("options.surface.gridStrikes")}</span>
            <Input value={strikes} onChange={(event) => setStrikes(event.target.value)} />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-[13px] font-medium">{t("options.surface.gridExpiries")}</span>
            <Input value={expiryDays} onChange={(event) => setExpiryDays(event.target.value)} />
          </label>
        </div>

        <div className="flex flex-col gap-2">
          <div className="hidden grid-cols-[1fr_1fr_1fr_auto] gap-2 text-xs text-muted-foreground sm:grid">
            <span>{t("options.surface.strike")}</span>
            <span>{t("options.surface.expiryDays")}</span>
            <span>{t("options.surface.ivPct")}</span>
            <span className="sr-only">{t("options.surface.remove")}</span>
          </div>
          {observations.map((observation, index) => (
            <div className="grid grid-cols-[1fr_1fr_1fr_auto] gap-2" key={observation.id}>
              <Input aria-label={`${t("options.surface.strike")} ${index + 1}`} className="min-w-0" inputMode="decimal" value={observation.strike} onChange={(event) => updateObservation(observation.id, "strike", event.target.value)} />
              <Input aria-label={`${t("options.surface.expiryDays")} ${index + 1}`} className="min-w-0" inputMode="decimal" value={observation.expiryDays} onChange={(event) => updateObservation(observation.id, "expiryDays", event.target.value)} />
              <Input aria-label={`${t("options.surface.ivPct")} ${index + 1}`} className="min-w-0" inputMode="decimal" value={observation.ivPct} onChange={(event) => updateObservation(observation.id, "ivPct", event.target.value)} />
              <Button size="icon" className="h-9 w-9 text-muted-foreground hover:text-danger" aria-label={`${t("options.surface.remove")} ${index + 1}`} disabled={observations.length === 1} onClick={() => setObservations((current) => current.filter((item) => item.id !== observation.id))}>
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={addObservation}>
            <Plus className="h-3.5 w-3.5" />{t("options.surface.addQuote")}
          </Button>
          <Button variant="primary" type="submit">
            {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {loading ? t("options.surface.computing") : t("options.surface.compute")}
          </Button>
        </div>
      </form>

      {error && <div role="alert" className="mt-3 rounded-lg border border-danger/30 bg-danger/5 p-3 text-sm text-danger">{error}</div>}
      {!result && !error && <p className="mt-3 text-xs text-muted-foreground">{t("options.surface.empty")}</p>}

      {result && (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[32rem] border-separate border-spacing-1 text-center text-xs">
            <caption className="mb-2 text-left text-xs text-muted-foreground">{t("options.surface.caption")}</caption>
            <thead>
              <tr>
                <th className="p-2 text-left text-muted-foreground">{t("options.surface.expiryDays")}</th>
                {result.strikes.map((strike) => <th className="p-2 font-medium" key={strike}>{strike}</th>)}
              </tr>
            </thead>
            <tbody>
              {result.expiries.map((expiry) => (
                <tr key={expiry}>
                  <th className="p-2 text-left font-medium text-muted-foreground">{Math.round(expiry * 365)}</th>
                  {result.strikes.map((strike) => {
                    const point = points.get(`${strike}:${expiry}`);
                    if (!point) return <td key={strike}>N/A</td>;
                    return (
                      <td className={cn("rounded-md p-2 tabular-nums", point.source === "observed" && "ring-1 ring-inset ring-primary/40")} key={strike} style={cellStyle(point)}>
                        <div className="font-semibold">{formatPercent(point.implied_volatility)}</div>
                        <div className="mt-0.5 text-xs opacity-80">{t(`options.surface.${point.source}`)}</div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground" aria-label={t("options.surface.legend", { defaultValue: "Implied volatility scale" })}>
            <span className="tabular-nums">{formatPercent(minIv)}</span>
            <span className="flex" aria-hidden="true">
              {[0, 0.25, 0.5, 0.75, 1].map((r) => <span key={r} className="h-3 w-6 border border-border" style={{ backgroundColor: `hsl(var(--primary) / ${scaleAlpha(r)})` }} />)}
            </span>
            <span className="tabular-nums">{formatPercent(maxIv)}</span>
          </div>
        </div>
      )}
      </CardBody>
    </Card>
  );
}
