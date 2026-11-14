import { request } from "@/lib/api";

export type PaperRunStatus = "active" | "stopped";
export type PaperRunState = "waiting" | "ok" | "error";

export interface PaperRunSummary {
  equity: number;
  pnl: number;
  total_return: number;
  max_drawdown: number;
  sharpe: number | null;
  trade_count: number;
  bars: number;
  as_of: string;
}

export interface PaperRun {
  id: string;
  label: string;
  source_run_id: string;
  codes: string[];
  source: string;
  interval: string;
  initial_cash: number;
  started_at: string;
  evaluation_start: string;
  warmup_start: string;
  status: PaperRunStatus;
  stopped_at: string | null;
  last_refreshed_at: string | null;
  state: PaperRunState;
  last_error: string | null;
  summary: PaperRunSummary | null;
}

export interface PaperRunTrade {
  time: string;
  symbol: string;
  side: "buy" | "sell";
  price: number;
  qty: number;
  pnl: number | null;
  return_pct: number | null;
  event: "entry" | "exit";
  reason: string | null;
}

export interface PaperRunDetail {
  run: PaperRun;
  equity: { time: string; equity: number; drawdown: number }[];
  trades: PaperRunTrade[];
  positions: { symbol: string; weight: number }[];
}

const base = "/api/paper-runs";
const one = (id: string) => `${base}/${encodeURIComponent(id)}`;
const REFRESH_TIMEOUT_MS = 180_000;

export const paperRunsApi = {
  list: () => request<PaperRun[]>(base),
  create: (body: { run_id: string; label?: string; initial_cash?: number }) =>
    request<PaperRun>(base, { method: "POST", body: JSON.stringify(body) }),
  get: (id: string) => request<PaperRunDetail>(one(id)),
  refresh: (id: string) =>
    request<PaperRunDetail>(`${one(id)}/refresh`, { method: "POST" }, REFRESH_TIMEOUT_MS),
  stop: (id: string) => request<PaperRunDetail>(`${one(id)}/stop`, { method: "POST" }),
  remove: (id: string) => request<{ deleted: boolean }>(one(id), { method: "DELETE" }),
};

const nf = new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const formatNumber = (v: number) => nf.format(v);
export const formatPercent = (v: number, signed = false) =>
  `${signed && v > 0 ? "+" : ""}${nf.format(v * 100)}%`;
export const formatSigned = (v: number) => `${v > 0 ? "+" : ""}${nf.format(v)}`;
export const tone = (v: number | null | undefined): "neutral" | "success" | "danger" =>
  !v ? "neutral" : v > 0 ? "success" : "danger";
export const toneClass = (v: number | null | undefined) =>
  tone(v) === "success" ? "text-success" : tone(v) === "danger" ? "text-danger" : "";

export function relativeTime(iso: string | null, now = Date.now()): string | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime();
  if (Number.isNaN(ms)) return null;
  const min = Math.max(0, Math.round((now - ms) / 60000));
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}
