import { useTranslation } from "react-i18next";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, Outlet, useLocation, useSearchParams } from "react-router";
import { Plus, Trash2, Pencil, MessageSquare, ChevronsLeft, ChevronsRight, Loader2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { api, type SessionItem } from "@/lib/api";
import { safeGet, safeSet } from "@/lib/storage";
import { useAgentStore } from "@/stores/agent";
import { BrandMark } from "@/components/common/BrandMark";
import { ConnectionBanner } from "@/components/layout/ConnectionBanner";
import i18n from "@/i18n";
import { toast } from "sonner";
import { SidebarNavigation, SettingsLink } from "./SidebarNavigation";
import { TopBar } from "./TopBar";
import { AssistantDock } from "./AssistantDock";
import { Button } from "@/components/ui";
import { PageHelp } from "./PageHelp";

// APP_VERSION is sourced from i18n locale files (app.version key) to keep a
// single source of truth across the footer and every localised README.

export function Layout() {
  const { t } = useTranslation();

  const { pathname } = useLocation();
  const [searchParams] = useSearchParams();
  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [sessionsError, setSessionsError] = useState<string | null>(null);
  const sessionsLoadGeneration = useRef(0);
  const pendingSessionActions = useRef(new Set<string>());
  const sseStatus = useAgentStore(s => s.sseStatus);
  const sseRetryAttempt = useAgentStore(s => s.sseRetryAttempt);
  const [collapsed, setCollapsed] = useState(() => safeGet("qa-sidebar") === "collapsed");
  const [dockOpen, setDockOpen] = useState(() => safeGet("vc-dock-open") === "1");
  const [sessionsOpen, setSessionsOpen] = useState(false);
  const sessionsPanelRef = useRef<HTMLDivElement>(null);
  const sessionsTriggerRef = useRef<HTMLButtonElement>(null);

  const activeSessionId = searchParams.get("session");
  const streamingSessionId = useAgentStore(s => s.streamingSessionId);

  useEffect(() => {
    if (!sessionsOpen) return;
    const dismiss = (event: MouseEvent) => {
      if (!sessionsPanelRef.current?.contains(event.target as Node)
        && !sessionsTriggerRef.current?.contains(event.target as Node)) setSessionsOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSessionsOpen(false);
        sessionsTriggerRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", dismiss);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", dismiss);
      document.removeEventListener("keydown", onKey);
    };
  }, [sessionsOpen]);

  useEffect(() => { safeSet("vc-dock-open", dockOpen ? "1" : "0"); }, [dockOpen]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "j") {
        e.preventDefault();
        setDockOpen((v) => !v);
      } else if (e.key === "Escape" && window.innerWidth < 1024) {
        setDockOpen(false);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    safeSet("qa-sidebar", collapsed ? "collapsed" : "expanded");
  }, [collapsed]);

  useEffect(() => {
    const syncSidebarPreference = (event: StorageEvent) => {
      if (event.key !== null && event.key !== "qa-sidebar") return;
      setCollapsed(safeGet("qa-sidebar") === "collapsed");
    };
    window.addEventListener("storage", syncSidebarPreference);
    return () => window.removeEventListener("storage", syncSidebarPreference);
  }, []);

  const loadSessions = useCallback(() => {
    const generation = ++sessionsLoadGeneration.current;
    setSessionsLoading(true);
    api.listSessions()
      .then((list) => {
        if (generation !== sessionsLoadGeneration.current) return;
        setSessions(Array.isArray(list) ? list : []);
        setSessionsError(null);
      })
      .catch((error: unknown) => {
        if (generation === sessionsLoadGeneration.current) {
          setSessionsError(error instanceof Error ? error.message : i18n.t("settings.unknownError"));
        }
      })
      .finally(() => {
        if (generation === sessionsLoadGeneration.current) setSessionsLoading(false);
      });
  }, []);

  // Load sessions on mount. Also refresh when navigating TO /agent or when
  // the active session changes (covers new session creation from Agent).
  const isAgentPage = pathname === "/" || pathname.startsWith("/agent");
  useEffect(() => {
    loadSessions();
    return () => { sessionsLoadGeneration.current += 1; };
  }, [isAgentPage, activeSessionId, loadSessions]);

  // Re-list after out-of-band title changes (e.g. LLM auto-titling on the
  // first completed exchange).
  useEffect(() => {
    const refresh = () => loadSessions();
    window.addEventListener("vibe:sessions-refresh", refresh);
    return () => window.removeEventListener("vibe:sessions-refresh", refresh);
  }, [loadSessions]);

  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [renameTarget, setRenameTarget] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const deleteSession = async (sid: string) => {
    if (pendingSessionActions.current.has(sid)) return;
    pendingSessionActions.current.add(sid);
    try {
      await api.deleteSession(sid);
      setSessions((prev) => prev.filter((s) => s.session_id !== sid));
      setDeleteTarget(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("settings.unknownError"));
    } finally {
      pendingSessionActions.current.delete(sid);
    }
  };

  const renameSession = async (sid: string) => {
    if (!renameValue.trim()) { setRenameTarget(null); return; }
    if (pendingSessionActions.current.has(sid)) return;
    pendingSessionActions.current.add(sid);
    const title = renameValue.trim();
    try {
      await api.renameSession(sid, title);
      setSessions((prev) => prev.map((s) => s.session_id === sid ? { ...s, title } : s));
      setRenameTarget(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("settings.unknownError"));
    } finally {
      pendingSessionActions.current.delete(sid);
    }
  };

  return (
    <div className="flex h-screen bg-background rtl:flex-row-reverse">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:start-4 focus:top-4 focus:z-[70] focus:rounded-md focus:bg-background focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-foreground focus:shadow-lg focus:outline-none focus:ring-2 focus:ring-primary/40"
      >
        {t('layout.skipToMain', { defaultValue: 'Skip to main content' })}
      </a>
      {/* Sidebar */}
      <aside
        aria-label={t('layout.sidebar', { defaultValue: 'Vibe Crypto sidebar' })}
        className={cn(
          "max-md:w-14 border-e border-border bg-card flex flex-col shrink-0 transition-[width] duration-200 ease-out overflow-visible",
          collapsed ? "w-14" : "w-60"
        )}
      >
        {/* Brand */}
        <div className={cn("flex h-12 shrink-0 items-center border-b border-border", collapsed ? "justify-center px-2" : "px-4 max-md:justify-center max-md:px-2")}>
          <Link
            to="/"
            aria-label="Vibe Crypto"
            className={cn("flex items-center", collapsed ? "justify-center" : "gap-2 max-md:justify-center")}
          >
            <BrandMark className="h-6 w-6 shrink-0" />
            {!collapsed && (
              <span className="text-[15px] font-semibold tracking-tight max-md:hidden">Vibe Crypto</span>
            )}
          </Link>
        </div>

        {/* Nav */}
        <SidebarNavigation collapsed={collapsed} />

        <button
          ref={sessionsTriggerRef}
          type="button"
          aria-label={t("layout.sessions")}
          aria-expanded={sessionsOpen}
          aria-controls="sidebar-sessions"
          title={t("layout.sessions")}
          onClick={() => setSessionsOpen((open) => !open)}
          className={cn("mx-2 mt-2 flex h-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted", !collapsed && "md:hidden")}
        >
          <MessageSquare className="h-4 w-4" />
        </button>

        {/* Compact layouts keep history and new-chat actions in a disclosure. */}
        {(!collapsed || sessionsOpen) && (
          <div
            ref={sessionsPanelRef}
            id="sidebar-sessions"
            aria-label={t("layout.sessions")}
            className={cn("overflow-auto flex flex-col border-border", sessionsOpen
              ? "fixed inset-y-0 start-14 z-40 w-[min(18rem,calc(100vw-3.5rem))] border-e bg-popover shadow-lg"
              : "flex-1 border-t mt-2 max-md:hidden")}
          >
            <div className="flex items-center justify-between px-4 py-2">
              <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <MessageSquare className="h-3.5 w-3.5" />
                {t('layout.sessions')}
              </span>
              <Link
                to="/agent"
                onClick={() => setSessionsOpen(false)}
                aria-label={t('layout.newChat')}
                className="flex items-center gap-1 p-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                title={t('layout.newChat')}
              >
                <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              </Link>
              {sessionsOpen && <button type="button" aria-label={t("layout.collapse")} onClick={() => { setSessionsOpen(false); sessionsTriggerRef.current?.focus(); }} className="rounded p-1.5 text-muted-foreground hover:bg-muted"><X className="h-4 w-4" /></button>}
            </div>

            {sessionsOpen && sessionsError && (
              <div className="mx-3 mb-3 rounded-md border border-warning/30 bg-warning/10 p-3 text-xs">
                <p>{t("layout.sessionsLoadFailed")} {sessionsError}</p>
                <button type="button" onClick={loadSessions} disabled={sessionsLoading} className="mt-2 rounded-md border border-border px-2 py-1 disabled:opacity-50">{t("connection.retry")}</button>
              </div>
            )}

            <div className="px-2 pb-2 space-y-0.5 overflow-auto flex-1">
              {sessionsLoading ? (
                <div className="space-y-1.5 px-2 py-1">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="h-7 rounded-md bg-muted/50 animate-pulse" />
                  ))}
                </div>
              ) : !sessionsError && sessions.length === 0 ? (
                <p className="px-3 py-2 text-xs text-muted-foreground">{t('layout.noSessions')}</p>
              ) : null}
              {sessions.map((s) => {
                const isActive = s.session_id === activeSessionId;
                const isDeleting = deleteTarget === s.session_id;
                const isRenaming = renameTarget === s.session_id;
                return (
                  <div key={s.session_id} className="group relative flex items-center">
                    {isRenaming ? (
                      <input
                        autoFocus
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") renameSession(s.session_id); if (e.key === "Escape") setRenameTarget(null); }}
                        onBlur={() => renameSession(s.session_id)}
                        aria-label={`${t('layout.rename')}: ${s.title || s.session_id}`}
                        className="flex-1 min-w-0 ps-3 pe-2 py-1.5 rounded-md text-xs border border-primary bg-background outline-none focus:ring-2 focus:ring-primary/40"
                      />
                    ) : (
                      <Link
                        to={`/agent?session=${s.session_id}`}
                        onClick={() => setSessionsOpen(false)}
                        className={cn(
                          "flex-1 min-w-0 ps-3 pe-14 py-1.5 rounded-md text-[13px] transition-colors truncate block border-s-2",
                          isActive
                            ? "border-s-primary bg-muted text-foreground font-medium"
                            : "border-s-transparent text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                        )}
                        title={s.title || s.session_id}
                      >
                        <span className="flex min-w-0 items-center gap-1.5">
                          {streamingSessionId === s.session_id ? (
                            <Loader2 className="h-3 w-3 shrink-0 animate-spin text-primary" />
                          ) : (
                            // Transparent placeholder keeps titles aligned with
                            // spinner rows without a meaningless gray dot.
                            <span className={cn(
                              "h-1.5 w-1.5 rounded-full shrink-0",
                              isActive ? "bg-primary/70" : "bg-transparent"
                            )} />
                          )}
                          <span className="min-w-0 truncate">{s.title || s.session_id.slice(0, 16)}</span>
                        </span>
                      </Link>
                    )}
                    {!isRenaming && isDeleting ? (
                      <div className="absolute right-0.5 flex items-center gap-0.5">
                        <button onClick={() => deleteSession(s.session_id)} className="p-1.5 text-danger hover:bg-danger/10 rounded text-[10px] font-medium">{t('layout.confirm')}</button>
                        <button onClick={() => setDeleteTarget(null)} className="p-1.5 text-muted-foreground hover:bg-muted rounded text-[10px]">{t('layout.cancel')}</button>
                      </div>
                    ) : !isRenaming ? (
                      <div className="absolute right-1 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 flex items-center gap-0.5 transition-opacity">
                        <button
                          onClick={(e) => { e.preventDefault(); e.stopPropagation(); setRenameTarget(s.session_id); setRenameValue(s.title || ""); }}
                          className="p-1.5 text-muted-foreground hover:text-foreground rounded"
                          title={t('layout.rename')}
                        >
                          <Pencil className="h-3 w-3" />
                        </button>
                        <button
                          onClick={(e) => { e.preventDefault(); e.stopPropagation(); setDeleteTarget(s.session_id); }}
                          className="p-1.5 text-muted-foreground hover:text-danger rounded"
                          title={t('layout.delete')}
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Spacer when collapsed */}
        {collapsed && <div className="flex-1" />}

        {/* Footer: Settings pinned above the collapse toggle */}
        <div className={cn("mt-auto shrink-0 space-y-1 border-t border-border p-2")}>
          <SettingsLink collapsed={collapsed} />
          <div className={cn("flex items-center gap-2", collapsed ? "justify-center" : "justify-between max-md:justify-center")}>
            {!collapsed && (
              <div className="flex min-w-0 items-center gap-1.5 ps-2.5 text-xs text-muted-foreground max-md:hidden">
                <span>{t('app.version')}</span>
                <span aria-hidden="true">/</span>
                <Link to="/about" className="transition-colors hover:text-foreground">{t('layout.about')}</Link>
              </div>
            )}
            <Button
              variant="ghost"
              size="icon"
              className={cn("h-8 w-8", !collapsed && "max-md:hidden")}
              onClick={() => setCollapsed((c) => !c)}
              aria-label={collapsed ? t('layout.expand') : t('layout.collapse')}
              title={collapsed ? t('layout.expand') : t('layout.collapse')}
            >
              {collapsed ? <ChevronsRight className="h-4 w-4" /> : <ChevronsLeft className="h-4 w-4" />}
            </Button>
          </div>
        </div>
      </aside>

      {/* Main */}
      <div className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
        <TopBar dockOpen={dockOpen} onToggleDock={() => setDockOpen((v) => !v)} />
        {sessionsError ? (
          <div role="alert" className="flex flex-wrap items-center gap-2 border-b border-warning/30 bg-warning/10 px-4 py-2 text-xs">
            <span className="font-medium">{t("layout.sessionsLoadFailed")}</span>
            <span className="text-muted-foreground">{sessionsError}</span>
            <button type="button" onClick={loadSessions} disabled={sessionsLoading} className="ms-auto rounded-md border px-2 py-1 disabled:opacity-50">
              {sessionsLoading ? t("settings.loading") : t("connection.retry")}
            </button>
            <Link to="/settings" className="text-primary underline">{t("layout.settings")}</Link>
          </div>
        ) : <ConnectionBanner status={sseStatus} retryAttempt={sseRetryAttempt} />}
        <main id="main" className="min-h-0 min-w-0 flex-1 overflow-y-auto">
          <PageHelp />
          <Outlet />
        </main>
      </div>
      <AssistantDock open={dockOpen} onClose={() => setDockOpen(false)} />
    </div>
  );
}
