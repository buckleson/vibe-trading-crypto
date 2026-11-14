# Cook brief: Vibe Crypto UI redesign

## Target

Redesign the Vibe Crypto web and desktop UI (`frontend/`, React 19 + Tailwind 3)
into a calm, dense, professional trading and research workspace. Every page,
light and dark. Behaviour, routes and data flows stay; the look, layout,
hierarchy and copy improve.

References to hold the work against (study the real products, do not copy any
element 1:1): the density and quiet chrome of Linear, the numeric clarity of
TradingView and Coinbase Advanced, the settings and form rhythm of Stripe
Dashboard. A screen is done when it would not look out of place next to them.

Viewports for every check: 1440x900 desktop, 1024x768 laptop, 390x844 phone.
Both themes.

## Bar (per dimension, eyeballed by fresh-context critics, 0 to 10)

| Dimension | What it means here | Bar |
|---|---|---|
| Layout and spacing | grid alignment, consistent 4px rhythm, no orphan gaps, sensible max widths | 9 |
| Hierarchy | one clear page title, primary action obvious, secondary info quiet | 9 |
| Typography | Inter only, the type scale below, tabular numbers for all figures | 9 |
| Color | tokens below only, accent used sparingly, P&L colors only for P&L | 9 |
| Components | primitives from `components/ui` everywhere, consistent states (hover, focus, disabled, loading, empty, error) | 9 |
| Data density | tables and stat tiles readable at a glance, no wasted chrome | 8.5 |
| Interaction | visible focus rings, keyboard reachable, no layout shift on load, motion 150 to 200 ms, respects reduced motion | 9 |
| Accessibility | WCAG AA contrast for text, labels for every control, landmarks | 9 |

Measured checks (run them, report numbers, never claim them unrun):
`npx tsc -b`, `npx vitest run`, `npm run build` in `frontend/`.

## Rules

Slop ban list. Never use any of these:

- eyebrow labels (small uppercase or tracked label above a heading)
- monospace uppercase text, or uppercase text in general except unit symbols
- random serif fonts (drop the Georgia `font-serif` hero greeting)
- purple gradients, purple as an accent, gradients on surfaces at all
- beige, cream, umber, warm paper tones
- 01 / 02 / 03 counters or numbered step badges
- glowing orbs, blurred color blobs, glow shadows
- shockwave rings or pulsing circles
- decorative particles, grid-dot or noise backgrounds
- long thin decorative lines
- em dashes in UI copy (use a comma, colon, period or parentheses)
- emoji in UI copy
- icons floating or bouncing for no reason

Also:

- Sentence case for every label, button, title and menu item.
- One primary button per view region. Destructive actions use the danger
  variant and a confirmation.
- Numbers: `tabular-nums`, right-aligned in tables, signed with color only for
  P&L and returns (green gain, red loss in every locale). Prices and
  quantities stay neutral.
- Monospace (JetBrains Mono) only for code, logs, terminal and IDs, never
  uppercase.
- Icons: lucide-react, 16px in controls, 20px max in empty states, stroke 1.75
  to 2. No icon without a purpose.
- Empty, loading and error states for every data view, using `EmptyState`,
  `Skeleton` and an inline error `Card`.
- Do not change routes, API calls, store logic or test ids. Keep accessible
  names stable unless a test is updated in the same task.
- New copy: `t("namespace.key", { defaultValue: "English text" })`. Do not edit
  locale JSON files (a final task syncs them).

## Design tokens

Defined as HSL triplets in `frontend/src/index.css` (`:root` and `.dark`) and
consumed through `tailwind.config.ts`. Values are fixed; do not invent new
colors in components.

### Color, light (`:root`)

| Token | HSL | Hex (approx) | Use |
|---|---|---|---|
| `--background` | `220 20% 98%` | #F9FAFB | app background |
| `--foreground` | `222 30% 10%` | #121621 | primary text |
| `--card` | `0 0% 100%` | #FFFFFF | cards, sidebar, top bar |
| `--card-foreground` | `222 30% 10%` | | |
| `--popover` | `0 0% 100%` | | menus, dialogs |
| `--popover-foreground` | `222 30% 10%` | | |
| `--muted` | `220 16% 94%` | #EDEFF2 | subtle fills, table header, hover |
| `--muted-foreground` | `220 10% 40%` | #5C6370 | secondary text (6.1:1 on card) |
| `--border` | `220 14% 88%` | #DCDFE5 | hairlines, inputs |
| `--primary` | `221 83% 48%` | #1555E0 | accent, primary button, links, focus |
| `--primary-foreground` | `0 0% 100%` | | text on primary (6.2:1) |
| `--destructive` | `0 72% 45%` | #C52020 | destructive buttons |
| `--destructive-foreground` | `0 0% 100%` | | |
| `--success` | `152 62% 30%` | #1D7C50 | profit, positive status (5.2:1) |
| `--danger` | `0 72% 45%` | #C52020 | loss, errors (5.8:1) |
| `--warning` | `32 95% 34%` | #A95C04 | caution |
| `--info` | `199 89% 34%` | #0A73A4 | neutral notices |
| `--chart-grid` | `220 14% 92%` | | chart gridlines |
| `--chart-text` | `220 10% 40%` | | chart labels |
| `--chart-axis` | `220 14% 82%` | | chart axes |
| `--chart-compare-a` | `#1555E0` | | first comparison series |
| `--chart-compare-b` | `#B36205` | | second comparison series |
| `--radius` | `0.625rem` | 10px | |

### Color, dark (`.dark`)

| Token | HSL | Hex (approx) |
|---|---|---|
| `--background` | `222 24% 7%` | #0E1016 |
| `--foreground` | `220 20% 94%` | #EDEFF3 |
| `--card` | `222 20% 11%` | #161A22 |
| `--card-foreground` | `220 20% 94%` | |
| `--popover` | `222 20% 13%` | #1B1E28 |
| `--popover-foreground` | `220 20% 94%` | |
| `--muted` | `222 16% 16%` | #22262F |
| `--muted-foreground` | `220 12% 64%` | #98A0AE (6.6:1 on card) |
| `--border` | `222 14% 22%` | #303540 |
| `--primary` | `217 91% 64%` | #5090F7 |
| `--primary-foreground` | `222 47% 9%` | dark ink on primary (5.9:1) |
| `--destructive` | `0 72% 50%` | |
| `--destructive-foreground` | `0 0% 100%` | |
| `--success` | `152 55% 50%` | #39C684 |
| `--danger` | `0 80% 66%` | #EE6363 |
| `--warning` | `38 92% 56%` | #F6AA28 |
| `--info` | `199 89% 60%` | #3EBAF4 |
| `--chart-grid` | `222 16% 15%` | |
| `--chart-text` | `220 12% 60%` | |
| `--chart-axis` | `222 14% 26%` | |
| `--chart-compare-a` | `#5090F7` | |
| `--chart-compare-b` | `#F6AA28` | |

`index.html` boot background: light `hsl(220 20% 98%)`, dark `hsl(222 24% 7%)`.
Electron window `backgroundColor`: `#0E1016`.

### Type scale (Inter, `font-sans`)

| Role | Size / line height | Weight | Tailwind |
|---|---|---|---|
| Page title | 20px / 28px | 600 | `text-xl font-semibold` |
| Section title | 16px / 24px | 600 | `text-base font-semibold` |
| Card title | 14px / 20px | 600 | `text-sm font-semibold` |
| Body | 14px / 20px | 400 | `text-sm` |
| Secondary | 13px / 18px | 400 | `text-[13px] text-muted-foreground` |
| Caption | 12px / 16px | 400 or 500 | `text-xs text-muted-foreground` |
| Big number (Stat value) | 24px / 32px | 600, tabular | `text-2xl font-semibold tabular-nums` |
| Hero number (paper equity) | 32px / 40px | 600, tabular | `text-[32px] font-semibold tabular-nums` |
| Code, terminal, IDs | 13px / 20px | 400 | `font-mono text-[13px]` |

Letter spacing: default, `tracking-tight` only on page titles and the wordmark.

### Spacing (4px base)

`1 = 4px`, `2 = 8px`, `3 = 12px`, `4 = 16px`, `6 = 24px`, `8 = 32px`, `12 = 48px`.

- Page padding: 24px desktop (`px-6 py-6`), 16px under `md` (`px-4 py-4`).
- Page max width: `max-w-6xl` for forms and settings, `max-w-[1400px]` for data
  pages. Agent and chat views are full width.
- Gap between cards: 16px. Inside a card: 16px padding (`p-4`), 20px for
  feature cards (`p-5`). Field stack gap: 12px. Table cell: `px-3 py-2`.

### Radii and elevation

- `rounded-lg` = 10px: cards, dialogs, dock.
- `rounded-md` = 8px: buttons, inputs, selects, tabs.
- `rounded-sm` = 6px: badges, chips, small toggles.
- `rounded-full` only for avatars and status dots.
- Cards: `border border-border bg-card`, no shadow. Popovers and dialogs:
  `shadow-lg` plus border. No other shadows.

### Controls

- Height: `h-9` (36px) default, `h-8` small. Focus ring:
  `focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-0`.
- Button variants: primary (`bg-primary text-primary-foreground`), secondary
  (`border border-border bg-card hover:bg-muted`), ghost (`hover:bg-muted`),
  danger (`bg-destructive text-destructive-foreground`).
- Badge tones: neutral, success, danger, warning, info; text 12px 500, fill is
  the tone at 12% alpha, text the tone at full.

### Motion

150 ms for hover/press, 200 ms for panels (`ease-out`). Under
`prefers-reduced-motion: reduce` no transforms. No looping animation except
spinners and the streaming progress bar.

## App shell

- Sidebar 240px (collapsed 56px): wordmark row (mark + "Vibe Crypto"), nav
  groups separated by spacing and a hairline, no group headings, Settings
  pinned at the bottom, collapse toggle.
- Top bar 48px on `bg-card` with bottom border: page title left; right side:
  wallet button, Claude toggle (opens the dock), theme toggle, language menu.
- Assistant dock on the right, 420px, tabs Chat and Terminal (Terminal only in
  the desktop app), toggled by the top bar button and `Ctrl/Cmd+J`, full-width
  sheet under `lg`.

## Deliverable

- Wave 2: tokens, primitives, shell (task T03).
- Waves 3 and 4: every page migrated (tasks T05, T08, T09, T10).
- Each task attaches before/after screenshots when it can run the app (not
  required in CI) and lists the measured checks in its handoff note.
- Work stays inside this repository. No external assets, fonts or CDNs.
