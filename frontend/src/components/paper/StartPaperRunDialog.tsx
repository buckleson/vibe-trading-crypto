import { useEffect, useRef, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Button, Card, CardBody, CardHeader, Field, Input, Select } from "@/components/ui";
import { api, type RunListItem } from "@/lib/api";
import { formatPercent, paperRunsApi, type PaperRun } from "@/lib/paperRuns";

export function StartPaperRunDialog({ presetRunId, onClose, onCreated }: {
  presetRunId?: string;
  onClose: () => void;
  onCreated: (run: PaperRun) => void;
}) {
  const { t } = useTranslation();
  const [runs, setRuns] = useState<RunListItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [runId, setRunId] = useState(presetRunId ?? "");
  const [label, setLabel] = useState("");
  const [cash, setCash] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const firstRef = useRef<HTMLSelectElement>(null);

  useEffect(() => {
    firstRef.current?.focus();
    let active = true;
    api
      .listRuns(50)
      .then((items) => {
        if (!active) return;
        const usable = items.filter((r) => r.status === "success" || r.total_return != null);
        setRuns(usable);
        setRunId((cur) => cur || usable[0]?.run_id || "");
      })
      .catch((e: Error) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoaded(true);
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const options = runs.some((r) => r.run_id === presetRunId) || !presetRunId
    ? runs
    : [{ run_id: presetRunId } as RunListItem, ...runs];
  const picked = options.find((r) => r.run_id === runId);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!runId) return;
    setBusy(true);
    setError("");
    try {
      const body: { run_id: string; label?: string; initial_cash?: number } = { run_id: runId };
      const name = label.trim() || (picked?.codes?.length ? `${picked.codes.join(", ")} paper` : "");
      if (name) body.label = name;
      if (cash.trim()) body.initial_cash = Number(cash);
      onCreated(await paperRunsApi.create(body));
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  const optionText = (r: RunListItem) =>
    r.codes || r.total_return != null
      ? `${r.run_id} (${(r.codes ?? []).join(", ")}${r.total_return != null ? `${r.codes?.length ? ", " : ""}${formatPercent(r.total_return)}` : ""})`
      : r.run_id;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/20 p-4"
      onClick={onClose}
    >
      <Card
        role="dialog"
        aria-modal="true"
        aria-labelledby="start-paper-title"
        className="w-full max-w-md shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <form onSubmit={submit}>
          <CardHeader
            title={<span id="start-paper-title">{t("paper.startRun", { defaultValue: "Start paper run" })}</span>}
            description={t("paper.startDesc", { defaultValue: "Replays a finished backtest forward on fresh data. Results count only from now." })}
          />
          <CardBody className="space-y-4">
            <Field
              label={t("paper.backtestRun", { defaultValue: "Backtest run" })}
              htmlFor="paper-start-run"
              hint={loaded && options.length === 0 ? t("paper.noBacktests", { defaultValue: "No finished backtests found. Run a backtest first." }) : undefined}
            >
              <Select
                id="paper-start-run"
                ref={firstRef}
                value={runId}
                onChange={(e) => setRunId(e.target.value)}
                disabled={busy}
              >
                {options.map((r) => (
                  <option key={r.run_id} value={r.run_id}>
                    {optionText(r)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t("paper.name", { defaultValue: "Name" })} htmlFor="paper-start-name">
              <Input
                id="paper-start-name"
                maxLength={80}
                value={label}
                placeholder={picked?.codes?.length ? `${picked.codes.join(", ")} paper` : ""}
                onChange={(e) => setLabel(e.target.value)}
              />
            </Field>
            <Field
              label={t("paper.startingCash", { defaultValue: "Starting cash" })}
              htmlFor="paper-start-cash"
              hint={t("paper.cashHint", { defaultValue: "Leave empty to use the backtest setting" })}
            >
              <Input
                id="paper-start-cash"
                type="number"
                min="0"
                step="any"
                value={cash}
                onChange={(e) => setCash(e.target.value)}
              />
            </Field>
            {error && <p role="alert" className="text-[13px] text-danger">{error}</p>}
            <div className="flex justify-end gap-2">
              <Button onClick={onClose}>{t("paper.cancel", { defaultValue: "Cancel" })}</Button>
              <Button type="submit" variant="primary" loading={busy} disabled={!runId}>
                {t("paper.startRun", { defaultValue: "Start paper run" })}
              </Button>
            </div>
          </CardBody>
        </form>
      </Card>
    </div>
  );
}
