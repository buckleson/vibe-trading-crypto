import { useEffect, useId, useState } from "react";
import { ArrowDown, ArrowUp, Loader2, RotateCcw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Badge, Button, Card, CardBody, CardHeader, EmptyState, Field, Select } from "@/components/ui";
import { api, type SourceOrderEntry, type SourceOrderUpdate } from "@/lib/api";

type Drafts = Record<string, string[]>;

function draftsFromEntries(entries: SourceOrderEntry[]): Drafts {
  return Object.fromEntries(
    entries.map((entry) => [entry.market, [...entry.effective_order]]),
  );
}

/**
 * Card that shows every market's data-source fallback order and lets the user
 * reorder it in-page. Saving PUTs all markets at once (order = draft when it
 * differs from the default, null otherwise so a reset also clears residue in
 * ~/.vibe-trading/.env); the backend hot-applies without a restart.
 */
export function SourcePrioritySettings() {
  const { t } = useTranslation();
  const idPrefix = useId();
  // Literal keys per market (typed i18n rejects interpolated keys); unknown
  // markets from a newer backend fall back to their raw key.
  const labels: Record<string, string> = {
    a_share: t("settings.sourcePriority.markets.a_share"),
    us_equity: t("settings.sourcePriority.markets.us_equity"),
    hk_equity: t("settings.sourcePriority.markets.hk_equity"),
    india_equity: t("settings.sourcePriority.markets.india_equity"),
    kr_equity: t("settings.sourcePriority.markets.kr_equity"),
    ca_equity: t("settings.sourcePriority.markets.ca_equity"),
    vietnam_equity: t("settings.sourcePriority.markets.vietnam_equity"),
    ar_equity: t("settings.sourcePriority.markets.ar_equity"),
    br_equity: t("settings.sourcePriority.markets.br_equity"),
    uk_equity: t("settings.sourcePriority.markets.uk_equity"),
    index: t("settings.sourcePriority.markets.index"),
    crypto: t("settings.sourcePriority.markets.crypto"),
    futures: t("settings.sourcePriority.markets.futures"),
    fund: t("settings.sourcePriority.markets.fund"),
    macro: t("settings.sourcePriority.markets.macro"),
    forex: t("settings.sourcePriority.markets.forex"),
  };
  const [entries, setEntries] = useState<SourceOrderEntry[] | null>(null);
  const [drafts, setDrafts] = useState<Drafts>({});
  const [activeMarket, setActiveMarket] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);

    api.getDataSourceSettings()
      .then((settings) => {
        if (!alive) return;
        const nextEntries = settings.source_orders ?? [];
        setEntries(nextEntries);
        setDrafts(draftsFromEntries(nextEntries));
        setActiveMarket((current) =>
          current && nextEntries.some((entry) => entry.market === current)
            ? current
            : (nextEntries[0]?.market ?? ""),
        );
      })
      .catch((loadError) => {
        if (!alive) return;
        setError(
          loadError instanceof Error
            ? loadError.message
            : t("settings.loadDataSourceSettingsFailed", { message: "" }),
        );
      })
      .finally(() => {
        if (alive) setLoading(false);
      });

    return () => {
      alive = false;
    };
  }, [t]);

  const activeEntry = entries?.find((entry) => entry.market === activeMarket) ?? null;
  const activeDraft = drafts[activeMarket] ?? [];
  const isDefaultOrder =
    !!activeEntry && activeDraft.join(",") === activeEntry.default_order.join(",");
  const customCount = (entries ?? []).filter(
    (entry) =>
      (drafts[entry.market] ?? entry.effective_order).join(",")
      !== entry.default_order.join(","),
  ).length;

  const move = (market: string, index: number, direction: -1 | 1) => {
    setDrafts((current) => {
      const order = [...(current[market] ?? [])];
      const target = index + direction;
      if (target < 0 || target >= order.length) return current;
      [order[index], order[target]] = [order[target], order[index]];
      return { ...current, [market]: order };
    });
  };

  const resetActive = () => {
    if (!activeEntry) return;
    setDrafts((current) => ({
      ...current,
      [activeEntry.market]: [...activeEntry.default_order],
    }));
  };

  const submit = async () => {
    if (!entries) return;
    setSaving(true);
    setError(null);
    // Always send every market: a non-default draft persists its order, a
    // default-equal draft sends null to clear any previously saved override.
    const sourceOrders: SourceOrderUpdate[] = entries.map((entry) => {
      const draft = drafts[entry.market] ?? entry.effective_order;
      const defaultOrder = draft.join(",") === entry.default_order.join(",");
      return { market: entry.market, order: defaultOrder ? null : draft };
    });
    try {
      const next = await api.updateDataSourceSettings({ source_orders: sourceOrders });
      const nextEntries = next.source_orders ?? [];
      setEntries(nextEntries);
      setDrafts(draftsFromEntries(nextEntries));
      toast.success(t("settings.save"));
    } catch (saveError) {
      const message = saveError instanceof Error
        ? saveError.message
        : t("settings.saveFailed");
      setError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader
        title={(
          <span className="inline-flex flex-wrap items-center gap-2">
            {t("settings.sourcePriority.title")}
            {customCount > 0 ? (
              <Badge tone="info">{t("settings.sourcePriority.customMarkets", { count: customCount })}</Badge>
            ) : null}
          </span>
        )}
        description={t("settings.sourcePriority.description")}
      />
      <CardBody className="space-y-4">
        {error ? (
          <div role="alert" className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-[13px] text-danger">
            {error}
          </div>
        ) : null}

        {loading ? (
          <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            {t("settings.loading")}
          </div>
        ) : !entries?.length ? (
          <EmptyState title={t("settings.sourcePriority.noMarkets")} />
        ) : (
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1.1fr)_minmax(240px,0.9fr)]">
            <div className="grid gap-4">
              <Field label={t("settings.sourcePriority.marketLabel")} htmlFor={`${idPrefix}-market`}>
                <Select
                  id={`${idPrefix}-market`}
                  value={activeMarket}
                  onChange={(event) => setActiveMarket(event.target.value)}
                  disabled={saving}
                >
                  {entries.map((entry) => (
                    <option key={entry.market} value={entry.market}>
                      {labels[entry.market] ?? entry.market}
                      {(drafts[entry.market] ?? entry.effective_order).join(",")
                      !== entry.default_order.join(",")
                        ? ` · ${t("settings.sourcePriority.badgeCustom")}`
                        : ""}
                    </option>
                  ))}
                </Select>
              </Field>

              {activeEntry?.override_invalid ? (
                <div className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-[13px] text-warning">
                  {t("settings.sourcePriority.invalidOverrideWarning", {
                    envVar: activeEntry.env_var,
                  })}
                </div>
              ) : null}

              <ol className="grid gap-2">
                {activeDraft.map((source, index) => (
                  <li
                    key={source}
                    className="flex items-center gap-3 rounded-md border border-border bg-background px-3 py-1.5"
                  >
                    <span className="w-5 text-right text-xs tabular-nums text-muted-foreground">{index + 1}</span>
                    <span className="min-w-0 flex-1 truncate font-mono text-[13px]">{source}</span>
                    <div className="flex gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => move(activeMarket, index, -1)}
                        disabled={index === 0 || saving}
                        aria-label={`${t("settings.sourcePriority.moveUp")}: ${source}`}
                      >
                        <ArrowUp className="h-4 w-4" aria-hidden="true" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => move(activeMarket, index, 1)}
                        disabled={index === activeDraft.length - 1 || saving}
                        aria-label={`${t("settings.sourcePriority.moveDown")}: ${source}`}
                      >
                        <ArrowDown className="h-4 w-4" aria-hidden="true" />
                      </Button>
                    </div>
                  </li>
                ))}
              </ol>

              <div className="flex flex-wrap items-center justify-end gap-3">
                {!isDefaultOrder ? (
                  <Badge tone="info">{t("settings.sourcePriority.badgeCustom")}</Badge>
                ) : (
                  <Badge>{t("settings.sourcePriority.badgeDefault")}</Badge>
                )}
                <Button onClick={resetActive} disabled={isDefaultOrder || saving}>
                  <RotateCcw className="h-4 w-4" aria-hidden="true" />
                  {t("settings.sourcePriority.resetToDefault")}
                </Button>
                <Button variant="primary" onClick={submit} disabled={loading} loading={saving}>
                  {saving ? t("settings.saving") : t("settings.save")}
                </Button>
              </div>
            </div>

            <div className="space-y-3 rounded-md border border-border bg-muted/40 p-4 text-[13px] text-muted-foreground">
              <div className="text-sm font-medium text-foreground">
                {t("settings.sourcePriority.howItWorksTitle")}
              </div>
              <p>{t("settings.sourcePriority.howItWorks")}</p>
              <p className="rounded-md border border-warning/40 bg-warning/10 px-2 py-1.5 text-xs text-warning">
                {t("settings.sourcePriority.caliberCaveat")}
              </p>
              {activeEntry ? (
                <p className="break-all font-mono text-[13px]">{activeEntry.env_var}</p>
              ) : null}
            </div>
          </div>
        )}
      </CardBody>
    </Card>
  );
}
