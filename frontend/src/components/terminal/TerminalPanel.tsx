import { useCallback, useEffect, useRef, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { Terminal, type ITheme } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { Button, EmptyState } from "@/components/ui";

export function terminalAvailable(): boolean {
  return Boolean(window.vibeDesktop?.terminal);
}

function hslToHex(value: string, alpha?: number): string {
  const parts = value.trim().split(/[\s,/]+/u).map((p) => Number.parseFloat(p));
  const [h = 0, sPct = 0, lPct = 0] = parts;
  const s = sPct / 100;
  const l = lPct / 100;
  const a = s * Math.min(l, 1 - l);
  const channel = (n: number): string => {
    const k = (n + h / 30) % 12;
    const v = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(v * 255).toString(16).padStart(2, "0");
  };
  const alphaHex = alpha === undefined ? "" : Math.round(alpha * 255).toString(16).padStart(2, "0");
  return `#${channel(0)}${channel(8)}${channel(4)}${alphaHex}`;
}

function readTheme(): ITheme {
  const style = getComputedStyle(document.documentElement);
  const token = (name: string, fallback: string): string => style.getPropertyValue(name).trim() || fallback;
  return {
    background: hslToHex(token("--card", "222 20% 11%")),
    foreground: hslToHex(token("--foreground", "220 20% 94%")),
    cursor: hslToHex(token("--primary", "217 91% 64%")),
    selectionBackground: hslToHex(token("--primary", "217 91% 64%"), 0.3),
  };
}

export function TerminalPanel(): ReactElement {
  const { t } = useTranslation();
  if (!terminalAvailable()) {
    return <EmptyState title={t("terminal.comingSoon", { defaultValue: "The terminal is only available in the desktop app" })} />;
  }
  return <TerminalView />;
}

function TerminalView(): ReactElement {
  const { t } = useTranslation();
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);

  const startSession = useCallback(() => {
    const term = termRef.current;
    const api = window.vibeDesktop?.terminal;
    if (!term || !api) return;
    void api.start(term.cols, term.rows);
  }, []);

  useEffect(() => {
    const host = hostRef.current;
    const api = window.vibeDesktop?.terminal;
    if (!host || !api) return;

    const term = new Terminal({
      fontFamily: "JetBrains Mono, ui-monospace, monospace",
      fontSize: 13,
      cursorBlink: true,
      allowProposedApi: false,
      theme: readTheme(),
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);
    termRef.current = term;
    const refit = (): void => {
      try {
        fit.fit();
        api.resize(term.cols, term.rows);
      } catch {
        // The host is not laid out yet (hidden dock tab).
      }
    };
    try { fit.fit(); } catch { /* not laid out yet */ }
    void api.start(term.cols, term.rows);

    const inputSub = term.onData((data) => api.write(data));
    const offData = api.onData((data) => term.write(data));
    const offExit = api.onExit(() => {
      term.writeln("\r\n[Claude exited. Press Restart to start again.]");
    });
    const resizeObserver = new ResizeObserver(refit);
    resizeObserver.observe(host);
    const themeObserver = new MutationObserver(() => { term.options.theme = readTheme(); });
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });

    return () => {
      themeObserver.disconnect();
      resizeObserver.disconnect();
      offExit();
      offData();
      inputSub.dispose();
      term.dispose();
      termRef.current = null;
      // The PTY is deliberately left running: the dock keeps panels mounted.
    };
  }, []);

  const restart = useCallback(async () => {
    const api = window.vibeDesktop?.terminal;
    if (!api) return;
    await api.kill();
    termRef.current?.clear();
    startSession();
  }, [startSession]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
        <span className="text-[13px] text-muted-foreground">
          {t("terminal.title", { defaultValue: "Claude Code with Vibe Crypto tools" })}
        </span>
        <Button variant="ghost" size="sm" onClick={() => void restart()}>
          {t("terminal.restart", { defaultValue: "Restart" })}
        </Button>
      </div>
      <div ref={hostRef} className="min-h-0 flex-1 bg-card p-2" />
    </div>
  );
}
