import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, Field, Input } from "@/components/ui";
import { api } from "@/lib/api";

/** Explicit local export import; the user still selects it in portfolio sources. */
export function ExtraEtfImport({ onImported }: { onImported: () => Promise<void> }) {
  const { t } = useTranslation();
  const [file, setFile] = useState<File | null>(null);
  const [label, setLabel] = useState("");
  const [count, setCount] = useState("");
  const [age, setAge] = useState("7");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  return <form className="space-y-3 rounded-lg border border-border p-4" onSubmit={async (event) => {
    event.preventDefault();
    if (!file || busy) return;
    setBusy(true); setMessage("");
    try {
      if (file.size > 4 * 1024 * 1024) throw new Error(t("portfolio.imports.tooLarge"));
      await api.importExtraEtf({ csv_text: await file.text(), label, source_mtime: new Date(file.lastModified).toISOString(), expected_positions: Number(count), max_age_days: Number(age) });
      await onImported();
      setMessage(t("portfolio.imports.success"));
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }}>
    <h3 className="text-sm font-semibold">{t("portfolio.imports.title")}</h3>
    <p className="text-xs text-muted-foreground">{t("portfolio.imports.hint")}</p>
    <Field label={t("portfolio.imports.file")} htmlFor="etf-import-file"><Input id="etf-import-file" required disabled={busy} type="file" accept=".csv,text/csv" className="h-auto py-1.5" onChange={(event) => { setFile(event.target.files?.[0] ?? null); setMessage(""); }} /></Field>
    <Field label={t("portfolio.editor.accountLabel")} htmlFor="etf-import-label"><Input id="etf-import-label" required maxLength={80} disabled={busy} value={label} onChange={(event) => setLabel(event.target.value)} /></Field>
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label={t("portfolio.imports.count")} htmlFor="etf-import-count"><Input id="etf-import-count" required type="number" min="0" max="20000" step="1" disabled={busy} value={count} onChange={(event) => setCount(event.target.value)} /></Field>
      <Field label={t("portfolio.imports.age")} htmlFor="etf-import-age"><Input id="etf-import-age" required type="number" min="1" max="365" step="1" disabled={busy} value={age} onChange={(event) => setAge(event.target.value)} /></Field>
    </div>
    <p className="text-xs text-muted-foreground">{t("portfolio.imports.overlap")}</p>
    <div className="flex justify-end"><Button type="submit" variant="primary" disabled={!file} loading={busy}>{busy ? t("portfolio.imports.importing") : t("portfolio.imports.import")}</Button></div>
    {message && <p role="status" className="text-[13px]">{message}</p>}
  </form>;
}
