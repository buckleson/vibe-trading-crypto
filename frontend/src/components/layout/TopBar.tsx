import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router";
import { useTranslation } from "react-i18next";
import { Check, Languages, MessagesSquare, Moon, Sun } from "lucide-react";
import { cn } from "@/lib/utils";
import { useDarkMode } from "@/hooks/useDarkMode";
import { SUPPORTED_LANGUAGES } from "@/i18n";
import { WalletButton } from "@/components/wallet/WalletButton";
import { Button } from "@/components/ui";
import { pageTitleKey } from "./navigation";

function isMac(): boolean {
  return typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || "");
}

export function TopBar({ dockOpen, onToggleDock }: { dockOpen: boolean; onToggleDock: () => void }) {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const { dark, toggle } = useDarkMode();
  const { key, fallback } = pageTitleKey(pathname);
  const title = t(key as string, { defaultValue: fallback });
  const shortcut = isMac() ? "Cmd+J" : "Ctrl+J";

  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border bg-card px-4">
      <h2 className="min-w-0 flex-1 truncate text-sm font-semibold">{title}</h2>
      <WalletButton />
      <Button
        variant="ghost"
        size="sm"
        aria-pressed={dockOpen}
        title={dockOpen ? t("claude.close", { defaultValue: `Close Claude (${shortcut})`, shortcut }) : t("claude.open", { defaultValue: `Open Claude (${shortcut})`, shortcut })}
        onClick={onToggleDock}
        className={cn(dockOpen && "bg-muted")}
      >
        <MessagesSquare className="h-4 w-4" aria-hidden="true" />
        <span className="max-sm:hidden">Claude</span>
      </Button>
      <Button
        variant="ghost"
        size="icon"
        onClick={toggle}
        aria-label={dark ? t("layout.light") : t("layout.dark")}
        title={dark ? t("layout.light") : t("layout.dark")}
      >
        {dark ? <Sun className="h-4 w-4" aria-hidden="true" /> : <Moon className="h-4 w-4" aria-hidden="true" />}
      </Button>
      <LanguageMenu />
    </header>
  );
}

// Language menu: lists every language registered in src/i18n/index.ts.
// i18n.language is matched first; i18n.languages (which always contains the
// fallback "en") is only a secondary match so regional variants still resolve.
function LanguageMenu() {
  const { i18n, t } = useTranslation();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent | TouchEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("touchstart", onClick, { passive: true });
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("touchstart", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const current =
    SUPPORTED_LANGUAGES.find((l) => l.code === i18n.language) ??
    SUPPORTED_LANGUAGES.find((l) => i18n.languages?.includes(l.code)) ??
    SUPPORTED_LANGUAGES[0];

  return (
    <div ref={wrapRef} className="relative">
      <Button
        variant="ghost"
        size="icon"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={t("layout.language")}
        title={`${t("layout.language")}: ${current.label}`}
      >
        <Languages className="h-4 w-4" aria-hidden="true" />
      </Button>
      {open && (
        <ul
          data-lang-menu
          aria-label={t("layout.selectLanguage", { defaultValue: "Select language" })}
          className="absolute end-0 top-full z-50 mt-1 min-w-[160px] rounded-lg border border-border bg-popover py-1 text-popover-foreground shadow-lg"
        >
          {SUPPORTED_LANGUAGES.map((lang) => {
            const active = lang.code === current.code;
            return (
              <li key={lang.code}>
                <button
                  type="button"
                  onClick={() => { i18n.changeLanguage(lang.code).catch(console.error); setOpen(false); }}
                  aria-current={active || undefined}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-[13px] transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
                >
                  <span className="flex-1 whitespace-nowrap text-start">{lang.label}</span>
                  {active && <Check className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
