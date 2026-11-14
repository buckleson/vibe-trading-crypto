import { Activity, BarChart3, BookOpen, Bot, Building2, CalendarClock, CandlestickChart, FileText, FlaskConical, Layers, LineChart, Settings, WalletCards } from "lucide-react";

export const NAVIGATION_GROUPS = [
  { id: "research", items: [
    { id: "agent", to: "/", icon: Bot },
    { id: "reports", to: "/reports", icon: FileText },
    { id: "researchArtifacts", to: "/research-artifacts", icon: BookOpen },
  ] },
  { id: "trade", items: [
    { id: "paperTrading", to: "/paper-trading", icon: LineChart },
    { id: "portfolio", to: "/portfolio", icon: WalletCards },
  ] },
  { id: "analysis", items: [
    { id: "alphaZoo", to: "/alpha-zoo", icon: Layers },
    { id: "researchLab", to: "/research-lab", icon: FlaskConical },
    { id: "optionsLab", to: "/options", icon: CandlestickChart },
    { id: "correlation", to: "/correlation", icon: BarChart3 },
  ] },
  { id: "automation", items: [
    { id: "scheduled", to: "/scheduled", icon: CalendarClock },
    { id: "runtime", to: "/runtime", icon: Activity },
    { id: "pixelOffice", to: "/pixel-office", icon: Building2 },
  ] },
] as const;

export const SETTINGS_ITEM = { id: "settings", to: "/settings", icon: Settings } as const;

export type NavigationItem = typeof NAVIGATION_GROUPS[number]["items"][number] | typeof SETTINGS_ITEM;

export function isNavigationActive(to: string, pathname: string): boolean {
  return to === "/" ? pathname === "/" || pathname === "/agent"
    : pathname === to || pathname.startsWith(`${to}/`);
}

export function pageTitleKey(pathname: string): { key: string; fallback: string } {
  const all = [...NAVIGATION_GROUPS.flatMap<NavigationItem>((g) => [...g.items]), SETTINGS_ITEM];
  const item = all.find((i) => isNavigationActive(i.to, pathname));
  if (item) return { key: `layout.${item.id}`, fallback: item.id };
  if (pathname.startsWith("/runs/")) return { key: "layout.run", fallback: "Run" };
  if (pathname === "/compare" || pathname.startsWith("/compare/")) return { key: "layout.compare", fallback: "Compare runs" };
  if (pathname === "/about") return { key: "layout.about", fallback: "About" };
  return { key: "layout.app", fallback: "Vibe Crypto" };
}
