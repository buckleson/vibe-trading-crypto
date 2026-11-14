import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Loader2, RefreshCw, RotateCcw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ClaudeSettings } from "@/components/settings/ClaudeSettings";
import { SecretInput } from "@/components/settings/SecretInput";
import { Badge, Button, Card, CardBody, CardHeader, EmptyState, Field, Input, Page, PageHeader, Select } from "@/components/ui";
import { ChannelSettings } from "@/components/settings/ChannelSettings";
import { CustomProviderManager } from "@/components/settings/CustomProviderManager";
import { ModelPicker } from "@/components/settings/ModelPicker";
import { SourcePrioritySettings } from "@/components/settings/SourcePrioritySettings";
import { api, gildataFeatures, type GildataFeature, isAuthRequiredError, type DataSourceSettings, type LLMProviderOption, type LLMSettings } from "@/lib/api";
import { effortLabelKey } from "@/lib/reasoningEffort";

interface LLMFormState {
  provider: string;
  model_name: string;
  base_url: string;
  temperature: number;
  timeout_seconds: number;
  max_retries: number;
  reasoning_effort: string;
}

const SECTIONS = [
  { id: "model", key: "settings.navModel", label: "Model" },
  { id: "claude", key: "settings.navClaude", label: "Claude" },
  { id: "data", key: "settings.navData", label: "Data sources" },
  { id: "providers", key: "settings.navProviders", label: "Custom providers" },
  { id: "channels", key: "settings.navChannels", label: "Channels" },
  { id: "desktop", key: "settings.navDesktop", label: "Desktop" },
] as const;

const checkboxLabel = "flex shrink-0 items-center gap-2 text-xs text-muted-foreground";

function toForm(settings: LLMSettings): LLMFormState {
  return {
    provider: settings.provider,
    model_name: settings.model_name,
    base_url: settings.base_url,
    temperature: settings.temperature,
    timeout_seconds: settings.timeout_seconds,
    max_retries: settings.max_retries,
    reasoning_effort: settings.reasoning_effort || "",
  };
}

export function Settings() {
  const { t } = useTranslation();
  const isDesktop = window.vibeDesktop?.isDesktop === true;
  const [settings, setSettings] = useState<LLMSettings | null>(null);
  const [dataSettings, setDataSettings] = useState<DataSourceSettings | null>(null);
  const [form, setForm] = useState<LLMFormState | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [modelOptions, setModelOptions] = useState<string[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelListHint, setModelListHint] = useState<string | null>(null);
  const [effortLevelsByModel, setEffortLevelsByModel] = useState<Record<string, string[]> | null>(null);
  const [modelLabels, setModelLabels] = useState<Record<string, string>>({});
  const [defaultEffortsByModel, setDefaultEffortsByModel] = useState<Record<string, string>>({});
  const [clearApiKey, setClearApiKey] = useState(false);
  const [tushareToken, setTushareToken] = useState("");
  const [clearTushareToken, setClearTushareToken] = useState(false);
  const [features, setFeatures] = useState<GildataFeature[]>([]);
  const [gildataToken, setGildataToken] = useState("");
  const [clearGildataToken, setClearGildataToken] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dataSaving, setDataSaving] = useState(false);
  const [settingsLoadError, setSettingsLoadError] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<string>("model");

  useEffect(() => {
    let alive = true;

    Promise.allSettled([
      api.getLLMSettings(),
      api.getDataSourceSettings(),
    ])
      .then(([llmResult, dataSourceResult]) => {
        if (!alive) return;

        if (llmResult.status === "fulfilled") {
          setSettings(llmResult.value);
          setForm(toForm(llmResult.value));
          setModelOptions(Array.from(new Set([
            llmResult.value.model_name,
            llmResult.value.providers.find((provider) => provider.name === llmResult.value.provider)?.default_model ?? "",
          ].filter(Boolean))));
        } else {
          const message = llmResult.reason instanceof Error
            ? llmResult.reason.message
            : t("settings.unknownError", { defaultValue: "Unknown error" });
          setSettingsLoadError(message);
          if (isAuthRequiredError(llmResult.reason)) {
            toast.error(message);
          } else {
            toast.error(t("settings.loadLlmSettingsFailed", { message }));
          }
        }

        if (dataSourceResult.status === "fulfilled") {
          setDataSettings(dataSourceResult.value);
          setFeatures(dataSourceResult.value.gildata_features ?? []);
        } else {
          const message = dataSourceResult.reason instanceof Error
            ? dataSourceResult.reason.message
            : t("settings.unknownError", { defaultValue: "Unknown error" });
          setSettingsLoadError(message);
          if (isAuthRequiredError(dataSourceResult.reason)) {
            toast.error(message);
          } else {
            toast.error(t("settings.loadDataSourceSettingsFailed", { message }));
          }
        }
      })
      .finally(() => {
        if (alive) setLoading(false);
      });

    return () => {
      alive = false;
    };
  }, [t]);

  // Highlight the section nearest the top while scrolling.
  useEffect(() => {
    if (loading || typeof IntersectionObserver === "undefined") return;
    const nodes = SECTIONS
      .map((section) => document.getElementById(`settings-${section.id}`))
      .filter((node): node is HTMLElement => node !== null);
    const observer = new IntersectionObserver((entries) => {
      const visible = entries.filter((entry) => entry.isIntersecting);
      if (visible.length) setActiveSection(visible[0].target.id.replace("settings-", ""));
    }, { rootMargin: "0px 0px -70% 0px" });
    nodes.forEach((node) => observer.observe(node));
    return () => observer.disconnect();
  }, [loading]);

  const providers = settings?.providers ?? [];
  const selectedProvider = useMemo<LLMProviderOption | undefined>(
    () => providers.find((provider) => provider.name === form?.provider),
    [form?.provider, providers],
  );

  const applyProviderDefaults = (provider = selectedProvider) => {
    if (!provider || !form) return;
    setForm({
      ...form,
      model_name: provider.default_model,
      base_url: provider.default_base_url,
    });
    setModelOptions([provider.default_model]);
    setModelListHint(null);
    setEffortLevelsByModel(null);
    setModelLabels({});
    setDefaultEffortsByModel({});
  };

  const onProviderChange = (name: string) => {
    const provider = providers.find((item) => item.name === name);
    if (!provider || !form) return;
    setForm({
      ...form,
      provider: provider.name,
      model_name: provider.default_model,
      base_url: provider.default_base_url,
    });
    setApiKey("");
    setClearApiKey(false);
    setModelOptions([provider.default_model]);
    setModelListHint(null);
    setEffortLevelsByModel(null);
    setModelLabels({});
    setDefaultEffortsByModel({});
  };

  // The provider the form shows now; a model list answering for an earlier one
  // (the CLI can take seconds) must not overwrite the current options.
  const currentProviderRef = useRef(form?.provider);
  currentProviderRef.current = form?.provider;

  const refreshModels = async ({ refresh }: { refresh: boolean }) => {
    if (!form || !selectedProvider) return;
    const requestedProvider = form.provider;
    setModelsLoading(true);
    setModelListHint(null);
    try {
      const result = await api.listLLMModels({
        provider: form.provider,
        base_url: form.base_url,
        api_key: apiKey.trim() || undefined,
        refresh,
      });
      if (currentProviderRef.current !== requestedProvider) return;
      setModelOptions(Array.from(new Set([
        form.model_name,
        selectedProvider.default_model,
        ...result.models,
      ].filter(Boolean))));
      setEffortLevelsByModel(result.effort_levels ?? null);
      setModelLabels(result.model_labels ?? {});
      setDefaultEffortsByModel(result.default_effort_levels ?? {});
      const warningMessages = {
        oauth_discovery_unsupported: t("settings.modelDiscoveryOauthUnsupported"),
        api_key_required: t("settings.modelDiscoveryApiKeyRequired"),
        model_list_unavailable: t("settings.modelDiscoveryUnavailable"),
      };
      setModelListHint(
        result.warning_code
          ? warningMessages[result.warning_code]
          : t("settings.modelsLoaded", { count: result.models.length }),
      );
    } catch (error) {
      if (currentProviderRef.current !== requestedProvider) return;
      setModelListHint(error instanceof Error ? error.message : t("settings.modelsLoadFailed"));
    } finally {
      setModelsLoading(false);
    }
  };

  // The CLI reports which models the login can run and the levels each accepts,
  // so fetch that as soon as the provider is shown rather than on a button press.
  const hasAutomaticModelList = selectedProvider?.auth_type === "claude_cli"
    || selectedProvider?.name === "openai-codex";
  useEffect(() => {
    if (hasAutomaticModelList) void refreshModels({ refresh: false });
    // refreshModels reads the form at call time; re-run only when the provider changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasAutomaticModelList, selectedProvider?.name]);

  // A model's own levels when the provider reports them, else the provider's.
  const visibleEffortLevels =
    (form && effortLevelsByModel?.[form.model_name]) ?? selectedProvider?.reasoning_efforts ?? [];
  // A level the selected model does not accept would be saved but never take
  // effect, so it is shown and saved as the provider default, with the reason.
  const unsupportedEffort =
    form?.reasoning_effort && !visibleEffortLevels.includes(form.reasoning_effort)
      ? form.reasoning_effort
      : null;
  const unsupportedEffortKey = unsupportedEffort ? effortLabelKey(unsupportedEffort) : undefined;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!form) return;
    setSaving(true);
    try {
      const desktop = window.vibeDesktop;
      const updated = await api.updateLLMSettings({
        ...form,
        reasoning_effort: unsupportedEffort ? "" : form.reasoning_effort,
        api_key: isDesktop ? undefined : apiKey.trim() || undefined,
        clear_api_key: isDesktop ? false : clearApiKey,
      });
      if (desktop && selectedProvider?.api_key_env && (apiKey.trim() || clearApiKey)) {
        await desktop.setCredential(
          selectedProvider.api_key_env,
          clearApiKey ? null : apiKey.trim(),
        );
      }
      setSettings(updated);
      setForm(toForm(updated));
      setApiKey("");
      setClearApiKey(false);
      toast.success(t("settings.llmSettingsSaved"));
      if (desktop && selectedProvider?.api_key_env && (apiKey.trim() || clearApiKey)) {
        toast.info(t("settings.desktopCredentialRestarting"));
        await desktop.restartBackend();
      }
    } catch (error) {
      toast.error(t("settings.saveLlmSettingsFailed", {
        message: error instanceof Error
          ? error.message
          : t("settings.unknownError", { defaultValue: "Unknown error" }),
      }));
    } finally {
      setSaving(false);
    }
  };

  const submitDataSources = async (event: FormEvent) => {
    event.preventDefault();
    setDataSaving(true);
    try {
      const desktop = window.vibeDesktop;
      const updated = await api.updateDataSourceSettings({
        tushare_token: isDesktop ? undefined : tushareToken.trim() || undefined,
        clear_tushare_token: isDesktop ? false : clearTushareToken,
        gildata_features: features,
        gildata_token: isDesktop ? undefined : gildataToken.trim() || undefined,
        clear_gildata_token: isDesktop ? false : clearGildataToken,
      });
      if (desktop && (tushareToken.trim() || clearTushareToken)) {
        await desktop.setCredential(
          "TUSHARE_TOKEN",
          clearTushareToken ? null : tushareToken.trim(),
        );
      }
      if (desktop && (gildataToken.trim() || clearGildataToken)) {
        await desktop.setCredential(
          "GILDATA_TOKEN",
          clearGildataToken ? null : gildataToken.trim(),
        );
      }
      setDataSettings(updated);
      setTushareToken("");
      setClearTushareToken(false);
      setGildataToken("");
      setClearGildataToken(false);
      toast.success(t("settings.dataSourceSettingsSaved"));
      if (desktop && (tushareToken.trim() || clearTushareToken || gildataToken.trim() || clearGildataToken)) {
        toast.info(t("settings.desktopCredentialRestarting"));
        await desktop.restartBackend();
      }
    } catch (error) {
      toast.error(t("settings.saveDataSourceSettingsFailed", {
        message: error instanceof Error
          ? error.message
          : t("settings.unknownError", { defaultValue: "Unknown error" }),
      }));
    } finally {
      setDataSaving(false);
    }
  };


  const sections = SECTIONS.filter((section) => section.id !== "desktop" || isDesktop);

  const header = (
    <PageHeader
      title={t("settings.title")}
      description={t("settings.subtitle")}
    />
  );

  if (loading || !form || !settings || !dataSettings) {
    return (
      <Page width="narrow">
        {header}
        <Card>
          {settingsLoadError ? (
            <EmptyState
              title={t("settings.unavailable")}
              description={<span role="alert">{settingsLoadError}</span>}
            />
          ) : (
            <div className="flex min-h-32 items-center justify-center gap-2 text-[13px] text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              {t("settings.loading")}
            </div>
          )}
        </Card>
      </Page>
    );
  }

  const usesManagedAuth = Boolean(
    selectedProvider?.auth_type && selectedProvider.auth_type !== "api_key",
  );
  const keyStatus = settings.api_key_configured
    ? t("settings.configured")
    : settings.api_key_required
      ? t("settings.keepCurrentKey")
      : usesManagedAuth && selectedProvider?.login_command
        ? t("settings.providerUsesManagedAuth", { command: selectedProvider.login_command })
        : t("settings.noApiKeyRequired");
  const apiKeyDisabled = !selectedProvider?.api_key_required || clearApiKey;
  const tushareStatus = dataSettings.tushare_token_configured
    ? t("settings.configured")
    : t("settings.keepCurrentToken");
  const gildataStatus = dataSettings.gildata_token_configured
    ? t("settings.configured")
    : t("settings.keepCurrentToken");

  const goTo = (id: string) => {
    setActiveSection(id);
    document.getElementById(`settings-${id}`)?.scrollIntoView?.({ block: "start" });
  };

  return (
    <Page width="narrow">
      {header}

      <div className="grid gap-6 lg:grid-cols-[176px_minmax(0,1fr)]">
        <nav aria-label={t("settings.sections", { defaultValue: "Settings sections" })} className="hidden lg:block">
          <ul className="sticky top-6 space-y-0.5">
            {sections.map((section) => (
              <li key={section.id}>
                <a
                  href={`#settings-${section.id}`}
                  onClick={(event) => { event.preventDefault(); goTo(section.id); }}
                  aria-current={activeSection === section.id ? "true" : undefined}
                  className={`block rounded-md px-3 py-1.5 text-[13px] transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${
                    activeSection === section.id
                      ? "bg-muted font-medium text-foreground"
                      : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                  }`}
                >
                  {t(section.key, { defaultValue: section.label })}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="min-w-0 space-y-6">
          <section id="settings-model" className="scroll-mt-6">
            <form onSubmit={submit}>
              <Card>
                <CardHeader
                  title={t("settings.llmSettings")}
                  description={t("settings.llmSettingsDesc")}
                />
                <CardBody className="space-y-4">
                  <div className="grid gap-4 md:grid-cols-2">
                    <Field
                      label={t("settings.provider")}
                      htmlFor="llm-provider"
                      hint={t("settings.providerChangeHint", {
                        defaultValue: "Changing providers updates the recommended model and endpoint.",
                      })}
                    >
                      <Select
                        id="llm-provider"
                        value={form.provider}
                        onChange={(event) => onProviderChange(event.target.value)}
                      >
                        {providers.map((provider) => (
                          <option key={provider.name} value={provider.name}>{provider.label}</option>
                        ))}
                      </Select>
                    </Field>

                    <Field
                      label={t("settings.baseUrl")}
                      htmlFor="llm-base-url"
                    >
                      <Input
                        id="llm-base-url"
                        value={form.base_url}
                        onChange={(event) => setForm({ ...form, base_url: event.target.value })}
                        placeholder={selectedProvider?.default_base_url}
                        list={selectedProvider?.base_url_options?.length ? "llm-base-url-options" : undefined}
                        disabled={usesManagedAuth}
                      />
                      {selectedProvider?.base_url_options?.length ? (
                        <datalist id="llm-base-url-options">
                          {selectedProvider.base_url_options.map((baseUrl) => (
                            <option key={baseUrl} value={baseUrl} />
                          ))}
                        </datalist>
                      ) : null}
                    </Field>
                  </div>

                  <Field
                    label={t("settings.model")}
                    hint={modelListHint || t("settings.modelPickerHint")}
                  >
                    <div className="flex flex-wrap gap-2">
                      <ModelPicker
                        value={form.model_name}
                        options={modelOptions}
                        labels={modelLabels}
                        onChange={(modelName) => setForm({ ...form, model_name: modelName })}
                        ariaLabel={t("settings.model")}
                        optionsAriaLabel={t("settings.modelOptions")}
                      />
                      <Button
                        onClick={() => void refreshModels({ refresh: true })}
                        disabled={modelsLoading}
                        title={t("settings.loadModels")}
                      >
                        {modelsLoading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <RefreshCw className="h-4 w-4" aria-hidden="true" />}
                        <span className="hidden sm:inline">{t("settings.loadModels")}</span>
                      </Button>
                      <Button
                        onClick={() => applyProviderDefaults()}
                        title={t("settings.useProviderDefaults")}
                      >
                        <RotateCcw className="h-4 w-4" aria-hidden="true" />
                        <span className="hidden sm:inline">{t("settings.useProviderDefaults")}</span>
                      </Button>
                    </div>
                  </Field>

                  <Field
                    label={usesManagedAuth
                      ? t("settings.authentication", { defaultValue: "Authentication" })
                      : t("settings.apiKey", { defaultValue: "API key" })}
                    htmlFor="llm-api-key"
                    hint={keyStatus}
                  >
                    <SecretInput
                      id="llm-api-key"
                      value={apiKey}
                      onChange={(event) => setApiKey(event.target.value)}
                      placeholder={keyStatus}
                      disabled={apiKeyDisabled}
                    />
                    {selectedProvider?.api_key_required ? (
                      <label className={checkboxLabel}>
                        <input
                          type="checkbox"
                          checked={clearApiKey}
                          onChange={(event) => {
                            setClearApiKey(event.target.checked);
                            if (event.target.checked) setApiKey("");
                          }}
                          className="h-3.5 w-3.5 accent-primary"
                        />
                        {t("settings.clearApiKey")}
                      </label>
                    ) : null}
                  </Field>

                  <div className="grid gap-4 sm:grid-cols-3">
                    <Field label={t("settings.temperature")} htmlFor="llm-temperature" hint={t("settings.temperatureDesc")}>
                      <Input
                        id="llm-temperature"
                        type="number"
                        min={0}
                        max={2}
                        step={0.1}
                        value={form.temperature}
                        onChange={(event) => setForm({ ...form, temperature: Number(event.target.value) })}
                      />
                    </Field>
                    <Field label={t("settings.timeoutSeconds")} htmlFor="llm-timeout">
                      <Input
                        id="llm-timeout"
                        type="number"
                        min={1}
                        max={3600}
                        step={1}
                        value={form.timeout_seconds}
                        onChange={(event) => setForm({ ...form, timeout_seconds: Number(event.target.value) })}
                      />
                    </Field>
                    <Field label={t("settings.maxRetries")} htmlFor="llm-retries">
                      <Input
                        id="llm-retries"
                        type="number"
                        min={0}
                        max={20}
                        step={1}
                        value={form.max_retries}
                        onChange={(event) => setForm({ ...form, max_retries: Number(event.target.value) })}
                      />
                    </Field>
                  </div>

                  <Field
                    label={t("settings.reasoningEffort")}
                    htmlFor="llm-effort"
                    hint={(
                      <>
                        {t("settings.reasoningEffortDesc")}
                        {form.provider === "openai-codex" && defaultEffortsByModel[form.model_name] && (
                          <span className="block">
                            {t("settings.providerDefault")}:
                            {" "}{effortLabelKey(defaultEffortsByModel[form.model_name])
                              ? t(effortLabelKey(defaultEffortsByModel[form.model_name])!)
                              : defaultEffortsByModel[form.model_name]}
                          </span>
                        )}
                        {unsupportedEffort && (
                          <span className="block">
                            {t("settings.reasoningEffortReset", {
                              level: unsupportedEffortKey ? t(unsupportedEffortKey) : unsupportedEffort,
                            })}
                          </span>
                        )}
                      </>
                    )}
                  >
                    <Select
                      id="llm-effort"
                      value={unsupportedEffort ? "" : form.reasoning_effort}
                      onChange={(event) => setForm({ ...form, reasoning_effort: event.target.value })}
                    >
                      <option value="">{t("settings.providerDefault")}</option>
                      {visibleEffortLevels.map((level) => {
                        const labelKey = effortLabelKey(level);
                        return (
                          <option key={level} value={level}>
                            {labelKey ? t(labelKey) : level}
                          </option>
                        );
                      })}
                    </Select>
                  </Field>

                  <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
                    <p className="min-w-0 break-all text-xs text-muted-foreground">
                      {t("settings.saved")}: <span className="font-mono text-[13px]">{settings.env_path}</span>
                    </p>
                    <Button type="submit" variant="primary" loading={saving}>
                      {saving ? t("settings.saving") : t("settings.save")}
                    </Button>
                  </div>
                </CardBody>
              </Card>
            </form>
          </section>

          <section id="settings-claude" className="scroll-mt-6">
            <ClaudeSettings />
          </section>

          <section id="settings-data" className="scroll-mt-6 space-y-6">
            <form onSubmit={submitDataSources}>
              <Card>
                <CardHeader
                  title={t("settings.dataSourceSettings")}
                  description={t("settings.dataSourceSettingsDesc")}
                />
                <CardBody className="space-y-4">
                  <Field
                    label={t("settings.tushareToken")}
                    htmlFor="tushare-token"
                    hint={t("settings.tushareTokenDesc", {
                      defaultValue: "Used for China A-share, futures, fund, and macro data. If unset, the project falls back to AKShare where available.",
                    })}
                  >
                    <SecretInput
                      id="tushare-token"
                      value={tushareToken}
                      onChange={(event) => setTushareToken(event.target.value)}
                      placeholder={tushareStatus}
                      disabled={clearTushareToken}
                    />
                    <label className={checkboxLabel}>
                      <input
                        type="checkbox"
                        checked={clearTushareToken}
                        onChange={(event) => {
                          setClearTushareToken(event.target.checked);
                          if (event.target.checked) setTushareToken("");
                        }}
                        className="h-3.5 w-3.5 accent-primary"
                      />
                      {t("settings.clearTushareToken")}
                    </label>
                  </Field>

                  <Field
                    label={t("settings.gildataToken")}
                    htmlFor="gildata-token"
                    hint={t("settings.gildataTokenDesc", { defaultValue: "Optional Gildata data: adjusted A-share daily bars, raw HK/index bars, OTC fund NAVs, and China macro, announcement and research tools." })}
                  >
                    <SecretInput
                      id="gildata-token"
                      value={gildataToken}
                      onChange={(event) => setGildataToken(event.target.value)}
                      placeholder={gildataStatus}
                      disabled={clearGildataToken}
                    />
                    <label className={checkboxLabel}>
                      <input
                        type="checkbox"
                        checked={clearGildataToken}
                        onChange={(event) => {
                          setClearGildataToken(event.target.checked);
                          if (event.target.checked) setGildataToken("");
                        }}
                        className="h-3.5 w-3.5 accent-primary"
                      />
                      {t("settings.clearGildataToken")}
                    </label>
                  </Field>

                  <fieldset id="gildata-settings" disabled={dataSaving} className="grid gap-2 rounded-md border border-border p-3">
                    <legend className="px-1 text-[13px] font-medium">{t("gildata.features")}</legend>
                    <p className="text-[13px] text-muted-foreground">{t("gildata.optInHelp")}</p>
                    {gildataFeatures.map((feature) => (
                      <label key={feature} className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          className="accent-primary"
                          checked={features.includes(feature)}
                          onChange={(event) => setFeatures(event.target.checked
                            ? [...features, feature]
                            : features.filter((item) => item !== feature))}
                        />
                        {t(`gildata.${feature}`)}
                      </label>
                    ))}
                    <div className="flex flex-wrap gap-4 pt-1 text-[13px]">
                      <a className="text-primary hover:underline" href="https://www.gildata.com/products/datamap" target="_blank" rel="noreferrer">
                        {t("gildata.website")}
                      </a>
                      <span className="text-muted-foreground">{t("gildata.partner")}</span>
                    </div>
                  </fieldset>

                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-muted/40 px-3 py-2">
                    <span className="text-[13px] font-medium">{t("settings.baostock")}</span>
                    <Badge tone={dataSettings.baostock_supported ? "success" : "warning"}>
                      {dataSettings.baostock_supported ? t("settings.loaderAvailable") : t("settings.noProjectLoader")}
                    </Badge>
                    <div className="basis-full space-y-1 text-[13px] text-muted-foreground">
                      <p>{dataSettings.baostock_message}</p>
                      <p>
                        {dataSettings.baostock_installed
                          ? t("settings.pythonPackageInstalled")
                          : t("settings.pythonPackageNotInstalled")}
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
                    <p className="min-w-0 break-all text-xs text-muted-foreground">
                      {t("settings.saved")}: <span className="font-mono text-[13px]">{dataSettings.env_path}</span>
                    </p>
                    <Button type="submit" variant="primary" loading={dataSaving}>
                      {dataSaving ? t("settings.saving") : t("settings.saveDataSourceSettings")}
                    </Button>
                  </div>
                </CardBody>
              </Card>
            </form>

            <SourcePrioritySettings />
          </section>

          <section id="settings-providers" className="scroll-mt-6">
            <CustomProviderManager onActivated={() => {
              void api.getLLMSettings().then((value) => { setSettings(value); setForm(toForm(value)); });
            }} />
          </section>

          <section id="settings-channels" className="scroll-mt-6">
            <ChannelSettings />
          </section>

          {isDesktop && (
            <section id="settings-desktop" className="scroll-mt-6">
              <Card>
                <CardHeader
                  title={t("settings.desktopTitle", { defaultValue: "Desktop" })}
                  description={t("settings.desktopDesc", { defaultValue: "How credentials are stored in the desktop app." })}
                />
                <CardBody className="text-[13px] text-muted-foreground">
                  {t("settings.desktopCredentialNote", {
                    defaultValue: "API keys and tokens saved here are kept by the desktop app. The backend restarts when one changes.",
                  })}
                </CardBody>
              </Card>
            </section>
          )}
        </div>
      </div>
    </Page>
  );
}
