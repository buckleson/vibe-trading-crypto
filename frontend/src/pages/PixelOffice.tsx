import { useCallback, useEffect, useState, type CSSProperties, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { api, type OfficeSnapshot } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Badge, Button, Card, CardBody, CardHeader, EmptyState, Input, Page, PageHeader, Select, Textarea } from "@/components/ui";

export function PixelOffice() {
  const { t } = useTranslation();
  const [snapshot, setSnapshot] = useState<OfficeSnapshot | null>(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [agentId, setAgentId] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState("normal");
  const [results, setResults] = useState<Record<string, string>>({});
  const refresh = useCallback(async () => {
    setPending(true);
    try {
      const value = await api.getPixelOffice();
      setSnapshot(value);
      setAgentId((current) => current || value.agents[0]?.id || "");
      setError("");
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setPending(false); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  async function mutate(action: "create" | "assign" | "complete" | "rank", arguments_: Record<string, unknown>) {
    setPending(true);
    try {
      setSnapshot(await api.updatePixelOffice(action, arguments_));
      setError("");
      return true;
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); return false; }
    finally { setPending(false); }
  }
  async function create(event: FormEvent) {
    event.preventDefault();
    if (await mutate("create", { task_id: crypto.randomUUID(), title, description, priority, assigned_to: agentId || null })) {
      setTitle(""); setDescription("");
    }
  }
  const agents = snapshot?.agents ?? [];
  const agentName = (id: string | null) => agents.find((agent) => agent.id === id)?.name ?? t("pixelOffice.unassigned");
  const label = "block space-y-1.5 text-[13px] font-medium";
  return (
    <Page>
      <PageHeader title={t("pixelOffice.title")} description={t("pixelOffice.description")}
        actions={<Button disabled={pending} onClick={() => void refresh()}>{t("pixelOffice.refresh")}</Button>} />
      {error && <p role="alert" className="rounded-lg border border-danger/30 p-3 text-sm text-danger">{error}</p>}
      {!snapshot && <p role="status" className="text-sm text-muted-foreground">{t(pending ? "pixelOffice.loading" : "pixelOffice.unavailable")}</p>}
      {snapshot && <>
        <section className="pixel-office-floor rounded-lg border border-border p-4 sm:p-6" aria-label={t("pixelOffice.floor")}>
          <h2 className="mb-4 text-sm font-semibold">{t("pixelOffice.floor")}</h2>
          <div className="grid gap-4 md:grid-cols-3">{agents.map((agent) => (
            <button type="button" key={agent.id} onClick={() => setAgentId(agent.id)}
              className={cn("pixel-desk rounded-lg border p-4 text-start", agentId === agent.id ? "border-primary ring-2 ring-primary/30" : "border-border")}>
              <div className="flex items-start justify-between gap-3">
                <div className="pixel-character" style={{ "--pixel-color": agent.color } as CSSProperties} aria-hidden="true">
                  <div className="pixel-character__shadow" />{agent.load > 0 && <span className="pixel-character__typing">...</span>}<div className="pixel-character__body">
                    <span className="pixel-character__head" /><span className="pixel-character__torso" />
                    <span className="pixel-character__arm pixel-character__arm--left" /><span className="pixel-character__arm pixel-character__arm--right" />
                    <span className="pixel-character__leg pixel-character__leg--left" /><span className="pixel-character__leg pixel-character__leg--right" />
                  </div>
                </div>
                <Badge>{t("pixelOffice.taskCount", { count: agent.load })}</Badge>
              </div>
              <p className="mt-3 text-sm font-semibold">{agent.name}</p><p className="text-xs text-muted-foreground">{t(`pixelOffice.ranks.${agent.rank}`)}</p>
            </button>
          ))}</div>
        </section>
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
          <Card>
            <CardHeader title={t("pixelOffice.board")} />
            <CardBody className="space-y-3">
              {!snapshot.tasks.length && <EmptyState title={t("pixelOffice.empty")} />}
              {snapshot.tasks.map((task) => (
                <article key={task.id} className="rounded-lg border border-border p-3">
                  <div className="flex flex-wrap justify-between gap-2"><h3 className="break-words text-sm font-medium">{task.title}</h3><span className="text-xs text-muted-foreground">{t(`pixelOffice.priorities.${task.priority}`)} · {t(`pixelOffice.statuses.${task.status}`)}</span></div>
                  <p className="mt-1 whitespace-pre-wrap break-words text-sm text-muted-foreground">{task.description}</p>
                  <p className="mt-2 text-xs text-primary">{agentName(task.assigned_to)}</p>
                  {task.status === "completed" ? <p className="mt-2 whitespace-pre-wrap break-words text-sm">{task.result}</p> : (
                    <fieldset disabled={pending} className="mt-3 space-y-3 disabled:opacity-50">
                      <label className={label}>{t("pixelOffice.assignee")}
                        <Select value={task.assigned_to ?? ""} onChange={(event) => void mutate("assign", { task_id: task.id, agent_id: event.target.value })}>
                          <option value="" disabled>{t("pixelOffice.unassigned")}</option>{agents.map((agent) => <option value={agent.id} key={agent.id}>{agent.name}</option>)}
                        </Select>
                      </label>
                      <form className="space-y-2" onSubmit={(event) => { event.preventDefault(); void mutate("complete", { task_id: task.id, result: results[task.id] ?? "" }); }}>
                        <label className={label}>{t("pixelOffice.result")}
                          <Textarea rows={2} required maxLength={2000} value={results[task.id] ?? ""} onChange={(event) => setResults((current) => ({ ...current, [task.id]: event.target.value }))} />
                        </label>
                        <Button type="submit" size="sm" disabled={!results[task.id]?.trim()}>{t("pixelOffice.complete")}</Button>
                      </form>
                    </fieldset>
                  )}
                </article>
              ))}
            </CardBody>
          </Card>
          <Card className="h-fit">
            <CardHeader title={t("pixelOffice.create")} />
            <CardBody>
              <form onSubmit={(event) => void create(event)}><fieldset disabled={pending} className="space-y-3 disabled:opacity-50">
                <label className={label}>{t("pixelOffice.assignee")}<Select value={agentId} onChange={(event) => setAgentId(event.target.value)}><option value="">{t("pixelOffice.unassigned")}</option>{agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}</Select></label>
                <label className={label}>{t("pixelOffice.taskTitle")}<Input required maxLength={200} value={title} onChange={(event) => setTitle(event.target.value)} /></label>
                <label className={label}>{t("pixelOffice.instructions")}<Textarea rows={3} maxLength={2000} value={description} onChange={(event) => setDescription(event.target.value)} /></label>
                <label className={label}>{t("pixelOffice.priority")}<Select value={priority} onChange={(event) => setPriority(event.target.value)}>{(["low", "normal", "high"] as const).map((value) => <option key={value} value={value}>{t(`pixelOffice.priorities.${value}`)}</option>)}</Select></label>
                <Button type="submit" variant="primary" className="w-full" disabled={!title.trim()}>{t("pixelOffice.create")}</Button>
              </fieldset></form>
            </CardBody>
          </Card>
        </div>
        <Card>
          <CardHeader title={t("pixelOffice.ranksTitle")} />
          <CardBody className="grid gap-3 md:grid-cols-3">{agents.map((agent) => <label key={agent.id} className={label}>{agent.name}
            <Select disabled={pending} value={agent.rank} onChange={(event) => void mutate("rank", { agent_id: agent.id, rank: event.target.value })}>{(["Operator", "Senior", "Lead"] as const).map((rank) => <option key={rank} value={rank}>{t(`pixelOffice.ranks.${rank}`)}</option>)}</Select>
          </label>)}</CardBody>
        </Card>
      </>}
    </Page>
  );
}
