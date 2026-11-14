# ADR 0006: UI design system

Status: accepted
Date: 2026-11-13

## Context

The frontend (React 19, Vite, Tailwind 3, lucide icons, ECharts) has 16 pages
and ~90 components with ad-hoc class strings per page (`rounded-2xl` here,
`rounded-lg` there, inline `field`/`button` constants). The palette is warm
beige and umber, which the Cook discipline bans, and the brand mark is an
orange gradient. There is no shared component layer.

The redesign follows `cook/BRIEF.md` (Cook skill rules: no eyebrow labels, no
monospace uppercase, no purple gradients, no beige, no glowing orbs, no
01/02/03 counters, no em dashes in UI copy, no decorative particles).

## Decision

1. **Tokens stay CSS variables** in `frontend/src/index.css`, consumed by
   `tailwind.config.ts` as today, with new cool-neutral values for light and
   dark and a single blue accent (exact values in `cook/BRIEF.md`). Semantic
   `--success`/`--danger` keep their meaning (green profit, red loss), so
   `chart-theme.ts` and `pnl-colors.ts` keep working.
2. **A small primitive layer** in `frontend/src/components/ui/`: `Button`,
   `Card` (+ `CardHeader`, `CardBody`), `Badge`, `Input`, `Select`,
   `Textarea`, `Field`, `Tabs`, `PageHeader`, `Page`, `Stat`, `EmptyState`,
   `Table` primitives. Plain function components with `cn()`; no new
   dependency, no headless UI library.
3. **App shell**: sidebar (brand, grouped nav without group labels, collapse),
   a 48px top bar (page title, wallet slot, Claude toggle, theme, language),
   and a right `AssistantDock` with Chat and Terminal tabs (`Ctrl/Cmd+J`).
4. Pages migrate to the primitives in later waves; behaviour, routes and test
   ids stay. New UI copy goes through `t(key, { defaultValue })`; one final
   task syncs locale files.

## Consequences

- One look across pages; later page work is mostly swapping class strings for
  primitives.
- Dark mode remains class-based (`.dark`), driven by the existing
  `useDarkMode` hook and `theme-boot.js`.
- Charts pick up the new palette through the same CSS variables.

## Alternatives rejected

- **shadcn/ui or Radix.** Pulls many dependencies and a generator workflow for
  ~12 simple components. Rejected.
- **Tailwind 4 migration.** Not needed for the redesign. Rejected.
- **CSS-in-JS or a theme provider.** CSS variables already do the job.
