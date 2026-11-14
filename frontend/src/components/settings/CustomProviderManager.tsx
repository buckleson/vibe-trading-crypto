import { CheckCircle2, KeyRound, TestTube2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { SecretInput } from "@/components/settings/SecretInput";
import { Badge, Button, Card, CardBody, CardHeader, Field, Input } from "@/components/ui";
import { api, type CustomProviderProfile } from "@/lib/api";

interface Draft {
  id: string;
  label: string;
  base_url: string;
  model: string;
  api_key: string;
}

const emptyDraft: Draft = { id: "", label: "", base_url: "", model: "", api_key: "" };

export function CustomProviderManager({ onActivated }: { onActivated?: () => void }) {
  const { t } = useTranslation();
  const [profiles, setProfiles] = useState<CustomProviderProfile[]>([]);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [testId, setTestId] = useState<string | null>(null);
  const [testPreview, setTestPreview] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [testElapsed, setTestElapsed] = useState(0);
  const [testError, setTestError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [activating, setActivating] = useState<string | null>(null);

  const refresh = async () => {
    const result = await api.listCustomProviders();
    setProfiles(result.providers);
  };

  useEffect(() => {
    void refresh().catch((error: unknown) => {
      toast.error(error instanceof Error ? error.message : t("customProviders.loadFailed"));
    });
  }, []);

  const update = (key: keyof Draft, value: string) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setTestId(null);
    setTestPreview(null);
  };

  const testProvider = async () => {
    setTesting(true);
    setTestElapsed(0);
    setTestError(null);
    setTestId(null);
    setTestPreview(null);
    try {
      const result = await api.testCustomProvider({
        base_url: draft.base_url,
        model: draft.model,
        api_key: draft.api_key,
      });
      setTestId(result.test_id);
      setTestPreview(`${result.response_preview} · ${result.latency_ms} ms`);
      toast.success(t("customProviders.testPassed"));
    } catch (error: unknown) {
      setTestError(error instanceof Error ? error.message : t("customProviders.testFailed"));
      toast.error(error instanceof Error ? error.message : t("customProviders.testFailed"));
    } finally {
      setTesting(false);
      setTestElapsed(0);
    }
  };

  useEffect(() => {
    if (!testing) return;
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      setTestElapsed(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [testing]);

  const saveProvider = async () => {
    if (!testId) return;
    setSaving(true);
    try {
      await api.saveCustomProvider({ ...draft, test_id: testId });
      setDraft(emptyDraft);
      setTestId(null);
      setTestPreview(null);
      await refresh();
      toast.success(t("customProviders.saved"));
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : t("customProviders.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  const activateProvider = async (profile: CustomProviderProfile) => {
    if (!window.confirm(t("customProviders.confirm", {label: profile.label}))) return;
    setActivating(profile.id);
    try {
      await api.activateCustomProvider(profile.id);
      onActivated?.();
      await refresh();
      toast.success(t("customProviders.activated", {label: profile.label}));
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : t("customProviders.activationFailed"));
    } finally {
      setActivating(null);
    }
  };

  const busy = testing || saving;
  return (
    <Card dir="auto">
      <CardHeader
        title={t("customProviders.title")}
        description={t("customProviders.description")}
        actions={(
          <Badge>
            <KeyRound className="h-3 w-3" aria-hidden="true" /> {t("customProviders.keyPrivate")}
          </Badge>
        )}
      />
      <CardBody className="space-y-4">
        {profiles.length > 0 ? (
          <ul className="space-y-2" aria-live="polite">
            {profiles.map((profile) => (
              <li key={profile.id} className="flex flex-col gap-3 rounded-md border border-border p-3 md:flex-row md:items-center md:justify-between">
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">{profile.label}</span>
                    {profile.active ? <Badge tone="success">{t("customProviders.active")}</Badge> : null}
                    {profile.api_key_configured ? <Badge>{t("customProviders.keyStored")}</Badge> : null}
                  </div>
                  <div className="break-all font-mono text-[13px] text-muted-foreground">{profile.model} · {profile.base_url}</div>
                </div>
                <Button
                  size="sm"
                  onClick={() => void activateProvider(profile)}
                  disabled={profile.active}
                  loading={activating === profile.id}
                >
                  {activating === profile.id ? null : <CheckCircle2 className="h-4 w-4" aria-hidden="true" />}
                  {profile.active ? t("customProviders.active") : t("customProviders.activate")}
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded-md border border-dashed border-border px-4 py-4 text-[13px] text-muted-foreground">{t("customProviders.empty")}</p>
        )}

        <h3 className="border-t border-border pt-4 text-sm font-semibold">{t("customProviders.add")}</h3>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label={t("customProviders.id")} htmlFor="custom-provider-id" hint={t("customProviders.idHint")}>
            <Input id="custom-provider-id" disabled={busy} value={draft.id} onChange={(event) => update("id", event.target.value)} placeholder="hilinkup" autoComplete="off" />
          </Field>
          <Field label={t("customProviders.label")} htmlFor="custom-provider-label">
            <Input id="custom-provider-label" disabled={busy} value={draft.label} onChange={(event) => update("label", event.target.value)} placeholder={t("customProviders.labelPlaceholder")} autoComplete="off" />
          </Field>
          <Field label={t("customProviders.baseUrl")} htmlFor="custom-provider-base-url" hint={t("customProviders.urlHint")} className="md:col-span-2">
            <Input id="custom-provider-base-url" disabled={busy} value={draft.base_url} onChange={(event) => update("base_url", event.target.value)} className="font-mono text-[13px]" placeholder="https://api.example.com/v1" type="url" autoComplete="url" />
          </Field>
          <Field label={t("customProviders.model")} htmlFor="custom-provider-model">
            <Input id="custom-provider-model" disabled={busy} value={draft.model} onChange={(event) => update("model", event.target.value)} className="font-mono text-[13px]" placeholder="glm-5.3-flash" autoComplete="off" />
          </Field>
          <Field label={t("customProviders.key")} htmlFor="custom-provider-api-key">
            <SecretInput id="custom-provider-api-key" disabled={busy} value={draft.api_key} onChange={(event) => update("api_key", event.target.value)} className="font-mono text-[13px]" placeholder={t("customProviders.keyPlaceholder")} autoComplete="new-password" />
          </Field>
        </div>

        {testPreview ? <div className="rounded-md border border-success/30 bg-success/10 px-3 py-2 text-[13px] text-success" role="status"><CheckCircle2 className="me-1 inline h-4 w-4" aria-hidden="true" />{t("customProviders.preview", {preview: testPreview})}</div> : null}
        {testError ? <div className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-[13px] text-danger" role="alert">{t("customProviders.error", {error: testError})}</div> : null}
        {testing && testElapsed >= 8 ? <div className="rounded-md border border-border bg-muted px-3 py-2 text-[13px] text-muted-foreground" role="status">{t("customProviders.waiting", {seconds: testElapsed})}</div> : null}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="min-w-0 text-xs text-muted-foreground">{t("customProviders.saveHint")}</span>
          <div className="flex gap-2">
            <Button onClick={() => void testProvider()} disabled={saving || !draft.base_url || !draft.model || !draft.api_key} loading={testing}>
              {testing ? null : <TestTube2 className="h-4 w-4" aria-hidden="true" />}
              {testing ? t("customProviders.testing") : t("customProviders.test")}
            </Button>
            <Button variant="primary" onClick={() => void saveProvider()} disabled={!testId || testing || !draft.id || !draft.label} loading={saving}>
              {saving ? t("customProviders.saving") : t("customProviders.save")}
            </Button>
          </div>
        </div>
      </CardBody>
    </Card>
  );
}
