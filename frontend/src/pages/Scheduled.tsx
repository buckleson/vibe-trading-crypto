import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, Pencil, Plus, Trash2, X } from "lucide-react";
import { Badge, Button, Card, CardBody, CardHeader, EmptyState, Field, Input, Page, PageHeader, Select, Table, TBody, TD, TH, THead, TR, Textarea } from "@/components/ui";
import { api, ApiError, type ChannelAdapterStatus, type ScheduledRun } from "@/lib/api";
import {
  describeCadence,
  formatIntervalMs,
  formatWallTime,
  formatWeekdays,
} from "@/lib/cadence";

const hintClass = "text-xs text-muted-foreground";

const POLL_MS = 15_000;

type DaysChoice = "every" | "weekdays";
type ComposerMode = "time" | "advanced";
type EmailDeliveryFormat = "" | "html" | "pdf";

function isWeekdayCadence(weekdays: number[]): boolean {
  return (
    weekdays.length === 5 &&
    weekdays.every((day, index) => day === index + 1)
  );
}

function browserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

function maskDeliveryTarget(target: string): string {
  if (target.length <= 2) return "•".repeat(target.length);
  if (target.length <= 6) {
    return `${target.slice(0, 1)}${"•".repeat(target.length - 2)}${target.slice(-1)}`;
  }
  const prefixLength = target.startsWith("-100") ? 4 : 3;
  return `${target.slice(0, prefixLength)}••••${target.slice(-2)}`;
}

function timezoneOptions(): string[] {
  // Not yet in the project's TS lib target, hence the local type.
  const supported = (Intl as { supportedValuesOf?: (key: "timeZone") => string[] })
    .supportedValuesOf;
  const zones = typeof supported === "function" ? supported("timeZone") : [browserTimezone()];
  return zones.includes("UTC") ? zones : ["UTC", ...zones];
}

// Jobs created before timezone support have timezone=null and keep their
// original UTC semantics; render them as UTC without converting anything.
function displayZone(run: ScheduledRun): string {
  return run.timezone ?? "UTC";
}

function formatInZone(epochMs: number, zone: string, locale: string): string {
  const date = new Date(epochMs);
  if (Number.isNaN(date.getTime())) return "-";
  try {
    return new Intl.DateTimeFormat(locale, {
      timeZone: zone,
      dateStyle: "medium",
      timeStyle: "short",
    }).format(date);
  } catch {
    return date.toISOString();
  }
}

function StatusPill({ label, tone }: { label: string; tone: "success" | "danger" | "warning" | "neutral" }) {
  return <Badge tone={tone}>{label}</Badge>;
}

export function Scheduled() {
  const { t, i18n } = useTranslation();
  const locale = i18n.language;

  const [runs, setRuns] = useState<ScheduledRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [channelStatus, setChannelStatus] = useState<Record<string, ChannelAdapterStatus>>({});
  const [channelLoadError, setChannelLoadError] = useState(false);

  const promptRef = useRef<HTMLTextAreaElement>(null);
  const [prompt, setPrompt] = useState("");
  const [mode, setMode] = useState<ComposerMode>("time");
  const [time, setTime] = useState("09:00");
  const [days, setDays] = useState<DaysChoice>("weekdays");
  const [advanced, setAdvanced] = useState("");
  const [timezone, setTimezone] = useState(() => browserTimezone());
  // Delivery is opt-in: an empty channel is what every monitor had before, and
  // it means the briefing stays in the app.
  const [deliveryChannel, setDeliveryChannel] = useState("");
  const [deliveryTarget, setDeliveryTarget] = useState("");
  const [deliveryTargetRef, setDeliveryTargetRef] = useState<string | null>(null);
  const [deliveryFormat, setDeliveryFormat] = useState<EmailDeliveryFormat>("");
  const [protectPdf, setProtectPdf] = useState(false);
  const [emailPdfPasswordConfigured, setEmailPdfPasswordConfigured] = useState(false);
  const [saving, setSaving] = useState(false);
  const [composerError, setComposerError] = useState<string | null>(null);

  const zonesRef = useRef<string[] | null>(null);
  if (zonesRef.current === null) zonesRef.current = timezoneOptions();

  // Stale-response guard: each refresh aborts the previous request and only
  // the newest sequence number may write state, so a slow 15s poll can never
  // overwrite the list a create/delete just updated.
  const refreshSeq = useRef(0);
  const refreshController = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    refreshController.current?.abort();
    const controller = new AbortController();
    refreshController.current = controller;
    const seq = ++refreshSeq.current;
    try {
      const rows = await api.listScheduledRuns(controller.signal);
      if (seq !== refreshSeq.current) return;
      setRuns(rows);
      setListError(null);
    } catch (error) {
      if (seq !== refreshSeq.current || controller.signal.aborted) return;
      setListError(error instanceof ApiError ? error.message : String(error));
    } finally {
      if (seq === refreshSeq.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), POLL_MS);
    return () => {
      refreshSeq.current++; // invalidate any in-flight response
      refreshController.current?.abort();
      clearInterval(timer);
    };
  }, [refresh]);

  useEffect(() => {
    let cancelled = false;
    void api.getChannelStatus()
      .then((status) => {
        if (cancelled) return;
        setChannelStatus(status.channels ?? {});
        setChannelLoadError(false);
      })
      .catch(() => {
        if (cancelled) return;
        setChannelStatus({});
        setChannelLoadError(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void api.getChannelsConfig()
      .then((config) => {
        if (!cancelled) {
          setEmailPdfPasswordConfigured(config.channels.email?.pdf_password_configured === true);
        }
      })
      .catch(() => {
        if (!cancelled) setEmailPdfPasswordConfigured(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Auto-disarm an armed delete after a few seconds (blur is unreliable on
  // Safari/iOS, where buttons do not take focus on click).
  useEffect(() => {
    if (pendingDelete === null) return;
    const timer = setTimeout(() => setPendingDelete(null), 5_000);
    return () => clearTimeout(timer);
  }, [pendingDelete]);

  function composedSchedule(): string | null {
    if (mode === "advanced") {
      const spec = advanced.trim();
      return spec ? spec : null;
    }
    const match = /^(\d{1,2}):(\d{2})$/.exec(time);
    if (!match) return null;
    return `${Number(match[2])} ${Number(match[1])} * * ${days === "every" ? "*" : "1-5"}`;
  }

  function resetComposer() {
    setEditingId(null);
    setPrompt("");
    setMode("time");
    setTime("09:00");
    setDays("weekdays");
    setAdvanced("");
    setTimezone(browserTimezone());
    setDeliveryChannel("");
    setDeliveryTarget("");
    setDeliveryTargetRef(null);
    setDeliveryFormat("");
    setProtectPdf(false);
    setComposerError(null);
  }

  function beginEdit(run: ScheduledRun) {
    const cadence = describeCadence(run.schedule);
    setPendingDelete(null);
    setEditingId(run.id);
    setPrompt(run.prompt);
    setTimezone(displayZone(run));
    setDeliveryChannel(run.delivery_channel ?? "");
    setDeliveryTarget(run.delivery_target ?? "");
    setDeliveryTargetRef(run.delivery_target_ref);
    setDeliveryFormat(run.delivery_format === "html" || run.delivery_format === "pdf" ? run.delivery_format : "");
    setProtectPdf(run.protect_pdf === true);
    setComposerError(null);

    if (cadence.kind === "daily") {
      setMode("time");
      setDays("every");
      setTime(formatWallTime(cadence.hour, cadence.minute));
      setAdvanced("");
    } else if (cadence.kind === "weekly" && isWeekdayCadence(cadence.weekdays)) {
      setMode("time");
      setDays("weekdays");
      setTime(formatWallTime(cadence.hour, cadence.minute));
      setAdvanced("");
    } else {
      setMode("advanced");
      setAdvanced(run.schedule);
    }

  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setComposerError(null);
    if (!prompt.trim()) {
      setComposerError(t("scheduled.promptRequired"));
      return;
    }
    const schedule = composedSchedule();
    if (schedule === null) {
      setComposerError(t("scheduled.invalidTime"));
      return;
    }
    setSaving(true);
    try {
      const channel = deliveryChannel.trim();
      const target = deliveryTarget.trim();
      if (channel && !target) {
        setComposerError(t("scheduled.deliveryTargetRequired"));
        return;
      }
      const payload = {
        prompt: prompt.trim(),
        schedule,
        timezone,
        delivery_channel: channel || null,
        delivery_target: channel ? target : null,
        delivery_format: channel === "email" && deliveryFormat ? deliveryFormat : null,
        protect_pdf: channel === "email" && deliveryFormat === "pdf" && protectPdf,
        delivery_target_ref: channel ? deliveryTargetRef : null,
      };
      if (editingId) {
        await api.updateScheduledRun(editingId, payload);
      } else {
        await api.createScheduledRun(payload);
      }
      resetComposer();
      await refresh();
    } catch (error) {
      setComposerError(error instanceof ApiError ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  }

  async function handleConfirmedDelete(id: string) {
    setPendingDelete(null);
    try {
      await api.deleteScheduledRun(id);
      if (editingId === id) resetComposer();
      await refresh();
    } catch (error) {
      setListError(error instanceof ApiError ? error.message : String(error));
    }
  }

  function cadenceLabel(run: ScheduledRun): string {
    const cadence = describeCadence(run.schedule);
    switch (cadence.kind) {
      case "interval":
        return t("scheduled.cadenceEvery", { interval: formatIntervalMs(cadence.ms) });
      case "daily":
        return t("scheduled.cadenceDaily", { time: formatWallTime(cadence.hour, cadence.minute) });
      case "weekly":
        return t("scheduled.cadenceWeekly", {
          days: formatWeekdays(cadence.weekdays, locale),
          time: formatWallTime(cadence.hour, cadence.minute),
        });
      default:
        return cadence.expression;
    }
  }

  function verdictCell(run: ScheduledRun): ReactNode {
    const verdict = run.last_verdict;
    if (verdict === null) {
      return (
        <p className={hintClass} data-testid={`verdict-empty-${run.id}`}>
          {t("scheduled.verdictEmpty")}
        </p>
      );
    }
    // A monitor built from an ad-hoc prompt never produces a verdict section,
    // and that is its correct permanent state: render nothing, not a warning.
    if (verdict.parse === "no_verdict_section") {
      return null;
    }
    if (verdict.parse === "contract_violation") {
      // Never show a wrong verdict: the malformed run reads as unreadable, and
      // the prior good one is still visible through `previous` next release.
      return (
        <p className={hintClass} data-testid={`verdict-unreadable-${run.id}`}>
          {t("scheduled.verdictUnreadable")}
        </p>
      );
    }
    const when = formatInZone(verdict.recorded_at, displayZone(run), locale);
    if (verdict.items.length === 0) {
      return (
        <p className={hintClass} data-testid={`verdict-nocalls-${run.id}`}>
          {t("scheduled.verdictNoCalls")} · {t("scheduled.verdictRecorded", { when })}
        </p>
      );
    }
    const delta =
      verdict.previous && verdict.previous.outcome !== verdict.outcome
        ? t("scheduled.verdictDelta", { was: verdict.previous.outcome, now: verdict.outcome })
        : null;
    return (
      <p className="break-words text-xs text-muted-foreground" data-testid={`verdict-line-${run.id}`}>
        <span className="font-medium text-foreground">
          {verdict.items.map((item) => `${item.symbol} ${item.state}`).join(" · ")}
        </span>
        {" · "}
        {delta ? <span>{delta} · </span> : null}
        {t("scheduled.verdictRecorded", { when })}
      </p>
    );
  }

  function statusLabel(run: ScheduledRun): { label: string; tone: "success" | "danger" | "warning" | "neutral" } {
    switch (run.status) {
      case "completed":
        return { label: t("scheduled.statusCompleted"), tone: "success" };
      case "failed":
        return { label: t("scheduled.statusFailed"), tone: "danger" };
      case "running":
        return { label: t("scheduled.statusRunning"), tone: "warning" };
      case "cancelled":
        return { label: t("scheduled.statusCancelled"), tone: "neutral" };
      case "expired":
        return { label: t("scheduled.statusExpired", { defaultValue: "Expired" }), tone: "neutral" };
      default:
        return { label: t("scheduled.statusPending"), tone: "neutral" };
    }
  }

  const configuredDeliveryChannels = Object.values(channelStatus)
    .filter((channel) => channel.configured && channel.enabled && channel.available)
    .sort((a, b) => a.display_name.localeCompare(b.display_name));

  const selectedChannel = deliveryChannel ? channelStatus[deliveryChannel] : undefined;
  const selectedChannelIsAvailable = configuredDeliveryChannels.some(
    (channel) => channel.name === deliveryChannel,
  );
  const targetLabel = t(`scheduled.deliveryTargetKind_${selectedChannel?.delivery_target_kind || "destination"}`, {
    defaultValue: selectedChannel?.delivery_target_label || t("scheduled.deliveryTargetLabel"),
  });
  const targetPlaceholder = t(`scheduled.deliveryTargetPlaceholder_${selectedChannel?.delivery_target_kind || "destination"}`, {
    defaultValue: selectedChannel?.delivery_target_placeholder || t("scheduled.deliveryTargetPlaceholder"),
  });
  const targetInputType =
    selectedChannel?.delivery_target_input_type === "email" ? "email" : "text";
  const targetSuggestions = selectedChannel?.delivery_target_suggestions ?? [];

  return (
    <Page width="wide">
      <PageHeader
        title={t("scheduled.title")}
        description={t("scheduled.subtitle")}
        actions={(
          <Button
            variant="primary"
            onClick={() => {
              resetComposer();
              promptRef.current?.focus();
            }}
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            {t("scheduled.newSchedule", { defaultValue: "New schedule" })}
          </Button>
        )}
      />

      <Card>
        <form onSubmit={handleSubmit}>
          <CardBody className="space-y-4">
            {editingId && (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-muted px-3 py-2">
                <p className="text-[13px]">{t("scheduled.editingHint")}</p>
                <Button variant="ghost" size="sm" onClick={resetComposer}>
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                  {t("scheduled.cancelEdit")}
                </Button>
              </div>
            )}
            <Field label={t("scheduled.promptLabel")} htmlFor="scheduled-prompt">
              <Textarea
                id="scheduled-prompt"
                ref={promptRef}
                required
                rows={2}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder={t("scheduled.promptPlaceholder")}
              />
            </Field>

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Field label={t("scheduled.modeLabel")} htmlFor="scheduled-mode">
                <Select
                  id="scheduled-mode"
                  value={mode}
                  onChange={(e) => setMode(e.target.value as ComposerMode)}
                >
                  <option value="time">{t("scheduled.modeTime")}</option>
                  <option value="advanced">{t("scheduled.modeAdvanced")}</option>
                </Select>
              </Field>

              {mode === "time" ? (
                <>
                  <Field label={t("scheduled.timeLabel")} htmlFor="scheduled-time">
                    <Input
                      id="scheduled-time"
                      type="time"
                      required
                      value={time}
                      onChange={(e) => setTime(e.target.value)}
                    />
                  </Field>
                  <Field label={t("scheduled.daysLabel")} htmlFor="scheduled-days">
                    <Select
                      id="scheduled-days"
                      value={days}
                      onChange={(e) => setDays(e.target.value as DaysChoice)}
                    >
                      <option value="weekdays">{t("scheduled.daysWeekdays")}</option>
                      <option value="every">{t("scheduled.daysEveryDay")}</option>
                    </Select>
                  </Field>
                </>
              ) : (
                <Field
                  label={t("scheduled.scheduleLabel")}
                  htmlFor="scheduled-advanced"
                  hint={t("scheduled.advancedHint")}
                  className="sm:col-span-2"
                >
                  <Input
                    id="scheduled-advanced"
                    required
                    value={advanced}
                    onChange={(e) => setAdvanced(e.target.value)}
                    placeholder="30 23 * * 1-5"
                    className="font-mono text-[13px]"
                  />
                </Field>
              )}

              <Field label={t("scheduled.timezoneLabel")} htmlFor="scheduled-timezone">
                <Select
                  id="scheduled-timezone"
                  value={timezone}
                  onChange={(e) => setTimezone(e.target.value)}
                >
                  {zonesRef.current.map((zone) => (
                    <option key={zone} value={zone}>
                      {zone}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label={t("scheduled.deliveryChannelLabel")}
                htmlFor="scheduled-delivery-channel"
                hint={channelLoadError
                  ? undefined
                  : configuredDeliveryChannels.length === 0 && !deliveryChannel
                    ? t("scheduled.deliveryNoChannels")
                    : t("scheduled.deliveryHint")}
                error={channelLoadError ? t("scheduled.deliveryChannelsLoadFailed") : undefined}
              >
                <Select
                  id="scheduled-delivery-channel"
                  value={deliveryChannel}
                  onChange={(e) => {
                    const nextChannel = e.target.value;
                    if (nextChannel !== deliveryChannel) {
                      setDeliveryTarget("");
                      setDeliveryTargetRef(null);
                    }
                    setDeliveryChannel(nextChannel);
                    if (nextChannel !== "email") {
                      setDeliveryFormat("");
                      setProtectPdf(false);
                    }
                  }}
                >
                  <option value="">{t("scheduled.deliveryInApp")}</option>
                  {deliveryChannel && !selectedChannelIsAvailable && (
                    <option value={deliveryChannel}>
                      {t("scheduled.deliveryChannelUnavailable", {
                        channel: selectedChannel?.display_name || deliveryChannel,
                      })}
                    </option>
                  )}
                  {configuredDeliveryChannels.map((channel) => (
                    <option key={channel.name} value={channel.name}>
                      {channel.display_name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={targetLabel} htmlFor="scheduled-delivery-target">
                <Input
                  id="scheduled-delivery-target"
                  type={targetInputType}
                  disabled={!deliveryChannel}
                  value={deliveryTarget}
                  onChange={(e) => {
                    setDeliveryTarget(e.target.value);
                    setDeliveryTargetRef(null);
                  }}
                  placeholder={
                    deliveryChannel
                      ? targetPlaceholder
                      : t("scheduled.deliveryTargetDisabled")
                  }
                />
                {deliveryChannel && targetSuggestions.length > 0 && (
                  <Select
                    aria-label={t("scheduled.deliveryKnownTargetLabel")}
                    value=""
                    onChange={(e) => {
                      if (!e.target.value) return;
                      setDeliveryTarget(e.target.value);
                      setDeliveryTargetRef(null);
                    }}
                  >
                    <option value="">{t("scheduled.deliveryKnownTargetPlaceholder")}</option>
                    {targetSuggestions.map((suggestion) => {
                      const label = suggestion.kind
                        ? t(`scheduled.deliverySuggestionKind_${suggestion.kind}`, {
                            defaultValue: suggestion.label || suggestion.target,
                          })
                        : suggestion.label || suggestion.target;
                      return (
                        <option
                          key={`${suggestion.kind || "target"}:${suggestion.target}`}
                          value={suggestion.target}
                        >
                          {label} · {maskDeliveryTarget(suggestion.target)}
                        </option>
                      );
                    })}
                  </Select>
                )}
              </Field>
              {deliveryChannel.trim() === "email" && (
                <Field
                  label={t("scheduled.deliveryFormatLabel")}
                  htmlFor="scheduled-delivery-format"
                  hint={deliveryFormat === "html"
                    ? t("scheduled.deliveryFormatHtmlHint")
                    : deliveryFormat === "pdf"
                      ? t("scheduled.deliveryFormatPdfHint")
                      : t("scheduled.deliveryFormatDefaultHint")}
                  className="sm:col-span-2"
                >
                  <Select
                    id="scheduled-delivery-format"
                    value={deliveryFormat}
                    onChange={(e) => {
                      const nextFormat = e.target.value as EmailDeliveryFormat;
                      setDeliveryFormat(nextFormat);
                      if (nextFormat !== "pdf") setProtectPdf(false);
                    }}
                  >
                    <option value="">{t("scheduled.deliveryFormatDefault")}</option>
                    <option value="html">{t("scheduled.deliveryFormatHtml")}</option>
                    <option value="pdf">{t("scheduled.deliveryFormatPdf")}</option>
                  </Select>
                  {deliveryFormat === "pdf" && (
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        className="accent-primary"
                        checked={protectPdf}
                        disabled={!emailPdfPasswordConfigured && !protectPdf}
                        onChange={(e) => setProtectPdf(e.target.checked)}
                      />
                      <span>{t("scheduled.deliveryProtectPdf")}</span>
                    </label>
                  )}
                  {deliveryFormat === "pdf" && !emailPdfPasswordConfigured && !protectPdf && (
                    <p className={hintClass}>{t("scheduled.deliveryProtectPdfUnavailable")}</p>
                  )}
                </Field>
              )}
            </div>

            {composerError && (
              <p role="alert" className="text-[13px] text-danger">
                {composerError}
              </p>
            )}

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
              <p className={hintClass}>{t("scheduled.executorHint")}</p>
              <div className="flex items-center gap-2">
                {editingId && (
                  <Button disabled={saving} onClick={resetComposer}>
                    {t("scheduled.cancelEdit")}
                  </Button>
                )}
                <Button type="submit" variant="primary" loading={saving}>
                  {editingId ? t("scheduled.saveChanges") : t("scheduled.create")}
                </Button>
              </div>
            </div>
          </CardBody>
        </form>
      </Card>

      <Card aria-label={t("scheduled.listTitle")} role="region">
        <CardHeader title={t("scheduled.listTitle")} />
        <CardBody>
          {loading ? (
            <div className="flex items-center justify-center gap-2 p-8 text-[13px] text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              {t("scheduled.loading")}
            </div>
          ) : listError && runs.length === 0 ? (
            <div className="space-y-2 text-sm">
              <p role="alert" className="text-danger">{listError}</p>
              <Button size="sm" onClick={() => void refresh()}>
                {t("scheduled.retry")}
              </Button>
            </div>
          ) : runs.length === 0 ? (
            <EmptyState title={t("scheduled.empty")} />
          ) : (
            <div className="space-y-3">
              {listError && (
                <p role="alert" className="text-xs text-danger">
                  {listError}
                </p>
              )}
              <Table className="min-w-[860px]">
                <THead>
                  <tr>
                    <TH>{t("scheduled.colSchedule", { defaultValue: "Schedule" })}</TH>
                    <TH>{t("scheduled.colNextRun", { defaultValue: "Next run" })}</TH>
                    <TH>{t("scheduled.colStatus", { defaultValue: "Last status" })}</TH>
                    <TH align="right">{t("scheduled.colActions", { defaultValue: "Actions" })}</TH>
                  </tr>
                </THead>
                <TBody>
                  {runs.map((run) => {
                    const status = statusLabel(run);
                    const zone = displayZone(run);
                    const deliveryName = run.delivery_channel
                      ? channelStatus[run.delivery_channel]?.display_name || run.delivery_channel
                      : "";
                    const editDisabled = run.status === "running" || run.delivery_status === "sending";
                    return (
                      <TR key={run.id} className="align-top">
                        <TD className="min-w-0 max-w-md space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            {run.title && <span className="font-semibold">{run.title}</span>}
                            <span className="font-medium">{cadenceLabel(run)}</span>
                            <span className={hintClass}>{zone}</span>
                          </div>
                          <p className="line-clamp-2 break-words text-[13px] text-muted-foreground">{run.prompt}</p>
                          {run.delivery_channel && (
                            <>
                              <p className={hintClass}>
                                {t("scheduled.deliverySummary", {
                                  channel: deliveryName,
                                  target:
                                    run.delivery_target_label ||
                                    run.delivery_target ||
                                    t("scheduled.deliveryUnknownTarget"),
                                })}
                              </p>
                              <p
                                className={
                                  run.delivery_status === "failed"
                                    ? "break-words text-xs text-danger"
                                    : hintClass
                                }
                              >
                                {t(`scheduled.delivery_${run.delivery_status}`, {
                                  channel: deliveryName,
                                  defaultValue: t("scheduled.delivery_none", {
                                    channel: deliveryName,
                                  }),
                                })}
                                {run.delivery_status === "failed" && run.delivery_error
                                  ? `: ${run.delivery_error}`
                                  : ""}
                              </p>
                            </>
                          )}
                        </TD>
                        <TD className="whitespace-nowrap text-[13px]">
                          <p>
                            {run.status === "expired"
                              ? t("scheduled.noFurtherRuns", { defaultValue: "No further runs" })
                              : t("scheduled.nextRun", {
                                  when: formatInZone(run.next_run_at, zone, locale),
                                })}
                          </p>
                          {run.end_at && (
                            <p className={hintClass}>
                              {t("scheduled.endsAt", {
                                defaultValue: "Ends {{when}}",
                                when: formatInZone(run.end_at, zone, locale),
                              })}
                            </p>
                          )}
                        </TD>
                        <TD className="max-w-xs space-y-1">
                          <StatusPill label={status.label} tone={status.tone} />
                          {run.last_error && (
                            <p className="break-words text-xs text-danger">
                              {t("scheduled.lastError", { error: run.last_error })}
                            </p>
                          )}
                          {verdictCell(run)}
                        </TD>
                        <TD align="right">
                          <div className="flex items-center justify-end gap-1.5">
                            <Button
                              size="sm"
                              onClick={() => beginEdit(run)}
                              disabled={editDisabled}
                              aria-label={t("scheduled.editAria", { prompt: run.prompt })}
                              title={editDisabled ? t("scheduled.editRunningDisabled") : undefined}
                            >
                              <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                              {t("scheduled.edit")}
                            </Button>
                            {pendingDelete === run.id ? (
                              <>
                                {/* Cancel first so an accidental double-click disarms instead of destroying. */}
                                <Button size="sm" onClick={() => setPendingDelete(null)}>
                                  {t("layout.cancel")}
                                </Button>
                                <Button
                                  size="sm"
                                  variant="danger"
                                  onClick={() => void handleConfirmedDelete(run.id)}
                                  aria-label={t("scheduled.confirmDeleteAria", { prompt: run.prompt })}
                                >
                                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                                  {t("scheduled.confirmDelete")}
                                </Button>
                              </>
                            ) : (
                              <Button
                                size="sm"
                                onClick={() => setPendingDelete(run.id)}
                                aria-label={t("scheduled.deleteAria", { prompt: run.prompt })}
                              >
                                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                                {t("scheduled.delete")}
                              </Button>
                            )}
                          </div>
                        </TD>
                      </TR>
                    );
                  })}
                </TBody>
              </Table>
            </div>
          )}
        </CardBody>
      </Card>
    </Page>
  );
}
