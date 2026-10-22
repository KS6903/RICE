# Design

Captures the committed visual system in `packages/web/src/index.css` + `tailwind.config.ts`.
This is the source of truth for keeping every surface (including `/admin`) on-brand.

## Theme

Light and dark, class-based (`.dark`), driven by `themeStore`. Both share token names defined as
`R G B` triples so `rgb(var(--token) / <alpha>)` works. A fixed mesh gradient (emerald/violet/cyan
radial blobs over a slate base) lives on `body`; surfaces are translucent glass layered over it.

## Color

OKLCH-adjacent hex brand ramp; surfaces via CSS variables.

- **Brand gradient:** `linear-gradient(135deg, #10b981 0%, #06b6d4 55%, #8b5cf6 100%)`
  (emerald → cyan → violet). Used for primary buttons, logo chip, avatar, active-nav indicator.
- **Primary accent (single color):** emerald `#10b981` / `#059669`. Focus rings, links, current
  selection. **Admin must use this, not indigo.**
- **Tokens:** `--surface`, `--surface-muted`, `--surface-raised`, `--ink` / `--ink-muted` /
  `--ink-subtle`, `--line` / `--line-strong`, plus `--glass-*`.
- **Status:** `.badge-green|yellow|red|gray|violet|cyan` (opaque white-on-color in light, soft
  tint in dark). Semantic only.

## Typography

- One family: **Inter** (display + body + UI), with `font-feature-settings` stylistic sets.
- Base `15px`, line-height `1.55` (senior-friendly). Fixed rem scale, not fluid.
- Page title `text-2xl font-bold`; section title `font-semibold`; labels via `.form-label`
  (uppercase, tracked, `0.8rem`).

## Components (shared classes in index.css)

- **Surfaces:** `.glass`, `.glass-strong`, `.card` (padded glass), `.panel` (glass container
  for tables, no padding).
- **Buttons:** `.btn-primary` (brand gradient, scale-on-press), `.btn-secondary` (glass),
  `.btn-ghost`.
- **Inputs:** `.input` (emerald focus ring), `.form-label`.
- **Nav:** `.nav-link` / `.nav-link.is-active` (brand gradient left indicator).
- **Data:** `.data-table` (dark-aware head), `.skeleton` (shimmer, reduced-motion safe),
  `.seg` / `.seg-btn` (segmented control), `.link` (emerald), `.icon-chip` (neutral/brand
  square for stat icons).
- **Badges:** `.badge-*` tone set above.

## Layout

- App shell: glass sidebar (`w-64`) + `glass-strong` header + mesh body. Admin shell mirrors it
  (`w-60`). Content max-width `7xl`, `px-4 py-5` on phones, `sm:px-6 sm:py-6`, `lg:px-8 lg:py-8`.
- Below `lg` the sidebar is a slide-in drawer (`NavDrawer`) opened from a menu button in the
  header; header pop-ups pin full-width under the header on phones. Tables inside a clipped
  `.card`/`.panel` scroll sideways, with one-line cells under `sm`. Touch screens get 16px fields
  so iOS doesn't zoom in on focus. The frame uses `.app-viewport` (`100dvh`), not `h-screen`.
- Responsive grids via `repeat(auto-fit, minmax(...))` or breakpoint columns; sidebar collapses
  structurally (not fluid type).

## Motion

- Keyframes: `gradient-shift` (8s), `shimmer` (2s), `float`, `fade-up`. Page entrance uses
  `animate-grad-fade-up`.
- Durations 150–250ms, ease-out. Press feedback `scale(0.97–0.98)`. All gated behind
  `prefers-reduced-motion: reduce`.
