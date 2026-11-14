import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { ChevronRight, Loader2, Play, RefreshCw, Square } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Badge, Button, Card, CardBody, CardHeader, EmptyState, Stat, Table, TBody, TD, TH, THead, TR } from "@/components/ui";
import { ChannelConfigPanel } from "@/components/settings/ChannelConfigPanel";
import {
  api,
  type ChannelsConfigResponse,
  type ChannelRuntimeStatus,
} from "@/lib/api";

/**
 * IM channel card: runtime status table with Start/Stop/Refresh, and one
 * expandable configuration panel per channel (credentials, connection test,
 * non-destructive enable toggle) backed by GET /channels/config.
 */
export function ChannelSettings() {
  const { t } = useTranslation();
  const [channelStatus, setChannelStatus] = useState<ChannelRuntimeStatus | null>(null);
  const [channelsConfig, setChannelsConfig] = useState<ChannelsConfigResponse | null>(null);
  const [configFailed, setConfigFailed] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [channelRefreshing, setChannelRefreshing] = useState(false);
  const [channelAction, setChannelAction] = useState<"start" | "stop" | null>(null);

  useEffect(() => {
    let alive = true;

    Promise.allSettled([api.getChannelStatus(), api.getChannelsConfig()])
      .then(([statusResult, configResult]) => {
        if (!alive) return;
        if (statusResult.status === "fulfilled") {
          setChannelStatus(statusResult.value);
        } else {
          const message = statusResult.reason instanceof Error
            ? statusResult.reason.message
            : t("settings.unknownError", { defaultValue: "Unknown error" });
          toast.error(`${t("settings.channels.refreshFailed")}: ${message}`);
          setChannelStatus(null);
        }
        if (configResult.status === "fulfilled") {
          setChannelsConfig(configResult.value);
          setConfigFailed(false);
        } else {
          setChannelsConfig(null);
          setConfigFailed(true);
        }
      })
      .finally(() => {
        if (alive) setLoading(false);
      });

    return () => {
      alive = false;
    };
  }, [t]);

  const reloadConfig = useCallback(async () => {
    try {
      setChannelsConfig(await api.getChannelsConfig());
      setConfigFailed(false);
    } catch {
      setChannelsConfig(null);
      setConfigFailed(true);
    }
  }, []);

  /** Re-read runtime status + config after a panel save/toggle (hot-applied). */
  const refreshAfterChange = useCallback(async () => {
    const [statusResult, configResult] = await Promise.allSettled([
      api.getChannelStatus(),
      api.getChannelsConfig(),
    ]);
    if (statusResult.status === "fulfilled") setChannelStatus(statusResult.value);
    if (configResult.status === "fulfilled") {
      setChannelsConfig(configResult.value);
      setConfigFailed(false);
    } else {
      setConfigFailed(true);
    }
  }, []);

  const refreshChannelStatus = async () => {
    setChannelRefreshing(true);
    try {
      const [statusResult] = await Promise.allSettled([
        api.getChannelStatus(),
        reloadConfig(),
      ]);
      if (statusResult.status === "fulfilled") {
        setChannelStatus(statusResult.value);
      } else {
        throw statusResult.reason;
      }
    } catch (error) {
      toast.error(`${t("settings.channels.refreshFailed")}: ${error instanceof Error ? error.message : t("settings.unknownError", { defaultValue: "Unknown error" })}`);
    } finally {
      setChannelRefreshing(false);
    }
  };

  const setChannelsRunning = async (action: "start" | "stop") => {
    setChannelAction(action);
    try {
      const updated = action === "start" ? await api.startChannels() : await api.stopChannels();
      setChannelStatus(updated);
      toast.success(action === "start" ? t("settings.channels.started") : t("settings.channels.stoppedToast"));
    } catch (error) {
      toast.error(`${action === "start" ? t("settings.channels.startFailed") : t("settings.channels.stopFailed")}: ${error instanceof Error ? error.message : t("settings.unknownError", { defaultValue: "Unknown error" })}`);
    } finally {
      setChannelAction(null);
    }
  };

  const rows = useMemo(() => {
    const statusChannels = channelStatus?.channels ?? {};
    const configChannels = channelsConfig?.channels ?? {};
    const names = Array.from(new Set([
      ...Object.keys(statusChannels),
      ...Object.keys(configChannels),
    ])).sort((a, b) => a.localeCompare(b));
    return names.map((name) => ({
      name,
      status: statusChannels[name],
      entry: configChannels[name],
    }));
  }, [channelStatus, channelsConfig]);

  const statusChannels = Object.values(channelStatus?.channels ?? {});
  const channelEnabledCount = statusChannels.filter((item) => item.enabled).length;
  const channelLoadedCount = statusChannels.filter((item) => item.loaded).length;
  const channelUnavailableCount = statusChannels.filter((item) => item.available === false).length;
  const channelBusy = channelRefreshing || channelAction !== null;
  const writable = channelsConfig?.writable ?? false;

  const toggleExpanded = (name: string) => {
    setExpanded((current) => ({ ...current, [name]: !current[name] }));
  };

  return (
    <Card>
      <CardHeader
        title={(
          <span className="inline-flex flex-wrap items-center gap-2">
            {t("settings.channels.title")}
            {channelsConfig && !channelsConfig.writable ? (
              <Badge tone="warning">{t("settings.channels.config.notWritableChip")}</Badge>
            ) : null}
            {configFailed ? (
              <Badge tone="warning">{t("settings.channels.config.loadFailed")}</Badge>
            ) : null}
          </span>
        )}
        description={t("settings.channels.description")}
        actions={(
          <>
            <Button size="sm" onClick={() => void refreshChannelStatus()} disabled={channelBusy} loading={channelRefreshing}>
              {channelRefreshing ? null : <RefreshCw className="h-4 w-4" aria-hidden="true" />}
              {t("settings.channels.refresh")}
            </Button>
            <Button size="sm" variant="primary" onClick={() => void setChannelsRunning("start")} disabled={channelBusy || !channelStatus} loading={channelAction === "start"}>
              {channelAction === "start" ? null : <Play className="h-4 w-4" aria-hidden="true" />}
              {t("settings.channels.start")}
            </Button>
            <Button size="sm" onClick={() => void setChannelsRunning("stop")} disabled={channelBusy || !channelStatus} loading={channelAction === "stop"}>
              {channelAction === "stop" ? null : <Square className="h-4 w-4" aria-hidden="true" />}
              {t("settings.channels.stop")}
            </Button>
          </>
        )}
      />
      <CardBody className="space-y-4">
        {loading ? (
          <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            {t("settings.loading")}
          </div>
        ) : channelStatus ? (
          <>
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              <Stat label={t("settings.channels.runtime")} value={<span className="text-sm">{channelStatus.running ? t("settings.channels.running") : t("settings.channels.stopped")}</span>} />
              <Stat label={t("settings.channels.enabled")} value={<span className="text-sm">{channelEnabledCount}</span>} />
              <Stat label={t("settings.channels.loaded")} value={<span className="text-sm">{channelLoadedCount}</span>} />
              <Stat label={t("settings.channels.unavailable")} value={<span className="text-sm">{channelUnavailableCount}</span>} />
            </div>

            <Table>
              <THead>
                <tr>
                  <TH>{t("settings.channels.channel")}</TH>
                  <TH>{t("settings.channels.state")}</TH>
                  <TH>{t("settings.channels.recovery")}</TH>
                </tr>
              </THead>
              <TBody>
                {rows.map(({ name, status: item, entry }) => {
                  const displayName = item?.display_name || entry?.display_name || name;
                  const isExpanded = Boolean(expanded[name]);
                  const enabled = item?.enabled ?? Boolean(entry?.values.enabled);
                  const loaded = item?.loaded ?? entry?.loaded ?? false;
                  const running = item?.running ?? false;
                  const recovery =
                    item?.install_hint || item?.error
                    || entry?.install_hint || entry?.error
                    || t("settings.channels.noRecovery");
                  return (
                    <Fragment key={name}>
                      <TR>
                        <TD className="align-top">
                          <button
                            type="button"
                            onClick={() => toggleExpanded(name)}
                            aria-expanded={isExpanded}
                            aria-label={t("settings.channels.config.toggleConfig", { name: displayName })}
                            className="flex items-start gap-2 rounded-sm text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                          >
                            <ChevronRight
                              className={`mt-0.5 h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-150 ${isExpanded ? "rotate-90" : ""}`}
                              aria-hidden="true"
                            />
                            <span>
                              <span className="block font-medium">{displayName}</span>
                              <span className="block text-xs text-muted-foreground">{name}</span>
                            </span>
                          </button>
                        </TD>
                        <TD className="align-top">
                          <div className="flex flex-wrap gap-1.5">
                            <Badge tone={enabled ? "info" : "neutral"}>
                              {enabled ? t("settings.channels.enabled") : t("settings.channels.disabled")}
                            </Badge>
                            <Badge tone={loaded ? "success" : "neutral"}>
                              {loaded ? t("settings.channels.loaded") : t("settings.channels.notLoaded")}
                            </Badge>
                            <Badge tone={running ? "success" : "neutral"}>
                              {running ? t("settings.channels.running") : t("settings.channels.stopped")}
                            </Badge>
                          </div>
                        </TD>
                        <TD className="min-w-[200px] max-w-md align-top text-xs text-muted-foreground">
                          {recovery}
                        </TD>
                      </TR>
                      {isExpanded ? (
                        <tr className="bg-muted/30">
                          <td colSpan={3} className="px-3 py-4">
                            {entry ? (
                              <ChannelConfigPanel
                                name={name}
                                entry={entry}
                                writable={writable}
                                configPath={channelsConfig?.config_path}
                                onChanged={refreshAfterChange}
                              />
                            ) : (
                              <p className="text-[13px] text-muted-foreground">
                                {t("settings.channels.config.loadFailed")}
                              </p>
                            )}
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })}
              </TBody>
            </Table>
          </>
        ) : (
          <EmptyState title={t("settings.channels.refreshFailed")} />
        )}
      </CardBody>
    </Card>
  );
}
