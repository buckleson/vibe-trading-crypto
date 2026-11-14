import { Suspense, lazy, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { safeGet, safeSet } from "@/lib/storage";
import { Button, Tabs } from "@/components/ui";
import { terminalAvailable } from "@/components/terminal/TerminalPanel";

const ChatPanel = lazy(() => import("@/components/claude/ChatPanel").then((m) => ({ default: m.ChatPanel })));
const TerminalPanel = lazy(() => import("@/components/terminal/TerminalPanel").then((m) => ({ default: m.TerminalPanel })));

type DockTab = "chat" | "terminal";

function Panel({ id, active, children }: { id: DockTab; active: boolean; children: React.ReactNode }) {
  return (
    <div
      role="tabpanel"
      aria-labelledby={`tab-${id}`}
      data-testid={`dock-panel-${id}`}
      hidden={!active}
      className={cn("min-h-0 flex-1", active ? "flex flex-col overflow-y-auto" : "hidden")}
    >
      <Suspense fallback={<div className="flex flex-1 items-center justify-center"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden="true" /></div>}>
        {children}
      </Suspense>
    </div>
  );
}

export function AssistantDock({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const hasTerminal = terminalAvailable();
  const [mounted, setMounted] = useState(open);
  const [tab, setTab] = useState<DockTab>(() => (safeGet("vc-dock-tab") === "terminal" ? "terminal" : "chat"));
  const activeTab: DockTab = tab === "terminal" && !hasTerminal ? "chat" : tab;
  // A panel stays mounted once shown so chat streams and terminal sessions survive tab switches and closing.
  const [shown, setShown] = useState<Set<DockTab>>(() => new Set([activeTab]));

  useEffect(() => { if (open) setMounted(true); }, [open]);
  useEffect(() => {
    setShown((prev) => (prev.has(activeTab) ? prev : new Set(prev).add(activeTab)));
  }, [activeTab]);

  const selectTab = (id: string) => {
    const next: DockTab = id === "terminal" ? "terminal" : "chat";
    setTab(next);
    safeSet("vc-dock-tab", next);
  };

  if (!mounted) return null;

  const tabs = [
    { id: "chat", label: t("claude.chat", { defaultValue: "Chat" }) },
    ...(hasTerminal ? [{ id: "terminal", label: t("claude.terminal", { defaultValue: "Terminal" }) }] : []),
  ];

  return (
    <>
      {open && (
        <div aria-hidden="true" data-testid="dock-backdrop" onClick={onClose} className="fixed inset-0 z-30 bg-foreground/20 lg:hidden" />
      )}
      <aside
        aria-label={t("claude.dock", { defaultValue: "Claude assistant" })}
        hidden={!open}
        className={cn(
          "flex-col border-s border-border bg-card",
          open
            ? "fixed inset-y-0 end-0 z-40 flex w-full shadow-lg sm:w-[420px] lg:static lg:z-auto lg:w-[420px] lg:shrink-0 lg:shadow-none"
            : "hidden",
        )}
      >
        <div className="flex h-12 shrink-0 items-end justify-between gap-2 border-b border-border px-4">
          <Tabs aria-label={t("claude.dock", { defaultValue: "Claude assistant" })} tabs={tabs} value={activeTab} onChange={selectTab} className="border-b-0" />
          <Button variant="ghost" size="icon" aria-label={t("claude.closeDock", { defaultValue: "Close assistant" })} onClick={onClose} className="mb-1.5 h-8 w-8">
            <X className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
        {shown.has("chat") && <Panel id="chat" active={activeTab === "chat"}><ChatPanel /></Panel>}
        {hasTerminal && shown.has("terminal") && <Panel id="terminal" active={activeTab === "terminal"}><TerminalPanel /></Panel>}
      </aside>
    </>
  );
}
