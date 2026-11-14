import { useEffect, useRef, useState } from "react";
import { Menu, X } from "lucide-react";
import { Link, useLocation } from "react-router";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { isNavigationActive, NAVIGATION_GROUPS, SETTINGS_ITEM, type NavigationItem } from "./navigation";

export function SidebarNavigation({ collapsed }: { collapsed: boolean }) {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);

  useEffect(() => { setMenuOpen(false); }, [pathname, collapsed]);
  useEffect(() => {
    if (!menuOpen) return;
    panelRef.current?.querySelector<HTMLElement>("a")?.focus();
    const close = () => setMenuOpen(false);
    const dismiss = (event: MouseEvent) => {
      if (!panelRef.current?.contains(event.target as Node)
        && !triggerRef.current?.contains(event.target as Node)) close();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        close();
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", dismiss);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("mousedown", dismiss);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", close);
    };
  }, [menuOpen]);

  const itemLink = ({ id: itemId, to, icon: Icon }: NavigationItem, compact: boolean, drawer = false) => {
    const label = t(`layout.${itemId}`);
    const active = isNavigationActive(to, pathname);
    return (
      <Link key={to} to={to} aria-label={label} aria-current={active ? "page" : undefined}
        title={`${label}: ${t(`navigation.descriptions.${itemId}`, { defaultValue: "" })}`}
        onClick={() => setMenuOpen(false)}
        className={cn("relative flex h-8 items-center rounded-md text-[13px] transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
          compact ? "justify-center px-2" : "gap-2.5 px-2.5",
          !compact && !drawer && "max-md:justify-center max-md:px-2",
          active ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground")}
      >
        {active && <span aria-hidden="true" className="absolute inset-y-1.5 start-0 w-0.5 rounded-full bg-primary" />}
        <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
        {!compact && <span className={cn("truncate", !drawer && "max-md:hidden")}>{label}</span>}
      </Link>
    );
  };

  const groups = (compact: boolean, drawer = false) => NAVIGATION_GROUPS.map(({ id, items }) => (
    <section key={id} aria-label={t(`navigation.groups.${id}`, { defaultValue: id === "trade" ? "Trade" : id })}
      className={cn(id !== "research" && "my-2 border-t border-border/60 pt-2")}>
      <div className="space-y-0.5">{items.map((item) => itemLink(item, compact, drawer))}</div>
    </section>
  ));

  return (
    <>
      <nav aria-label={t("layout.mainNavigation")}
        className={cn("shrink-0 overflow-y-auto", collapsed ? "p-2" : "p-2 max-md:p-2")}
      >
        <button ref={triggerRef} type="button" aria-label={t("navigation.menu")} title={t("navigation.menu")}
          aria-expanded={menuOpen} aria-controls="sidebar-feature-menu" onClick={() => setMenuOpen((open) => !open)}
          className={cn("mb-2 flex h-8 w-full items-center justify-center rounded-md border border-border/60 text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40", !collapsed && "md:hidden")}
        ><Menu className="h-4 w-4" aria-hidden="true" /></button>
        {groups(collapsed)}
      </nav>
      {menuOpen && (
        <nav ref={panelRef} id="sidebar-feature-menu" aria-label={t("navigation.menu")}
          className="fixed inset-y-0 start-14 z-40 w-[min(18rem,calc(100vw-3.5rem))] space-y-1 overflow-y-auto border-e border-border bg-popover p-3 shadow-lg"
        >
          <div className="flex items-center justify-between px-3 py-1 text-sm font-medium">
            {t("navigation.menu")}
            <button type="button" aria-label={t("navigation.close")} onClick={() => { setMenuOpen(false); triggerRef.current?.focus(); }} className="rounded p-1.5 hover:bg-muted"><X className="h-4 w-4" aria-hidden="true" /></button>
          </div>
          {groups(false, true)}
          <div className="my-2 border-t border-border/60 pt-2">{itemLink(SETTINGS_ITEM, false, true)}</div>
        </nav>
      )}
    </>
  );
}

/** Settings link pinned to the bottom of the sidebar. */
export function SettingsLink({ collapsed }: { collapsed: boolean }) {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const { id, to, icon: Icon } = SETTINGS_ITEM;
  const label = t(`layout.${id}`);
  const active = isNavigationActive(to, pathname);
  return (
    <Link to={to} aria-label={label} title={label} aria-current={active ? "page" : undefined}
      className={cn("relative flex h-8 items-center rounded-md text-[13px] transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
        collapsed ? "justify-center px-2" : "gap-2.5 px-2.5 max-md:justify-center max-md:px-2",
        active ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground")}
    >
      {active && <span aria-hidden="true" className="absolute inset-y-1.5 start-0 w-0.5 rounded-full bg-primary" />}
      <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
      {!collapsed && <span className="max-md:hidden">{label}</span>}
    </Link>
  );
}
