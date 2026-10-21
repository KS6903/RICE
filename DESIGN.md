---
name: Oraiza
description: Books for Philippine rice mills, from weigh-in to the office.
colors:
  app-brand-emerald: "#10b981"
  app-brand-emerald-deep: "#059669"
  app-brand-cyan: "#06b6d4"
  app-brand-violet: "#8b5cf6"
  hp-ground: "#e3e4df"
  hp-board: "#fbfbf7"
  hp-ink: "#16150f"
  hp-ink-2: "#45443d"
  hp-red: "#c1271b"
  hp-red-press: "#9e1f15"
  hp-gold: "#edbe2f"
  hp-bolt-steel: "#b9bab3"
typography:
  app-body:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "15px"
    lineHeight: 1.55
  hp-display:
    fontFamily: "Archivo, ui-sans-serif, system-ui, sans-serif"
    fontSize: "clamp(2.05rem, 3.75vw, 3.85rem)"
    fontWeight: 900
    lineHeight: 0.98
    letterSpacing: "-0.01em"
    fontVariation: "'wdth' 118"
  hp-headline:
    fontFamily: "Archivo, ui-sans-serif, system-ui, sans-serif"
    fontSize: "clamp(2rem, 4.6vw, 3.6rem)"
    fontWeight: 900
    lineHeight: 0.95
    letterSpacing: "-0.01em"
    fontVariation: "'wdth' 112"
  hp-body:
    fontFamily: "Archivo, ui-sans-serif, system-ui, sans-serif"
    fontSize: "19px"
    fontWeight: 400
    lineHeight: 1.55
  hp-plate-number:
    fontFamily: "Archivo, ui-sans-serif, system-ui, sans-serif"
    fontSize: "clamp(1.7rem, 2.9vw, 2.3rem)"
    fontWeight: 800
    lineHeight: 1
    fontFeature: "'tnum', 'lnum'"
    fontVariation: "'wdth' 72"
  hp-control:
    fontFamily: "Archivo, ui-sans-serif, system-ui, sans-serif"
    fontSize: "17px"
    fontWeight: 800
    letterSpacing: "0.01em"
rounded:
  hp-plate: "3px"
  hp-board: "4px"
spacing:
  hp-gutter-sm: "16px"
  hp-gutter: "28px"
components:
  hp-plate-red:
    backgroundColor: "{colors.hp-red}"
    textColor: "#ffffff"
    typography: "{typography.hp-control}"
    rounded: "{rounded.hp-plate}"
    padding: "0 26px"
    height: "60px"
  hp-plate-red-hover:
    backgroundColor: "{colors.hp-red-press}"
  hp-plate-ink:
    backgroundColor: "{colors.hp-board}"
    textColor: "{colors.hp-ink}"
    typography: "{typography.hp-control}"
    rounded: "{rounded.hp-plate}"
    padding: "0 18px"
    height: "48px"
  hp-plate-ink-hover:
    backgroundColor: "{colors.hp-ink}"
    textColor: "{colors.hp-board}"
  hp-numplate:
    backgroundColor: "{colors.hp-gold}"
    textColor: "{colors.hp-ink}"
    typography: "{typography.hp-plate-number}"
    rounded: "{rounded.hp-plate}"
    padding: "8px 12px 6px"
  hp-board:
    backgroundColor: "{colors.hp-board}"
    textColor: "{colors.hp-ink}"
    rounded: "{rounded.hp-board}"
    padding: "54px 58px 50px"
---

# Design

Captures the committed visual system in `packages/web/src/index.css` + `tailwind.config.ts`.
This is the source of truth for keeping the app (tenant, `/admin`, and the auth and legal pages)
on-brand. The signed-out front page `/` has its own system, scoped under `.hp`: see
[Front page](#front-page-signed-out-) at the end.

## Theme

Applies to the app (tenant, admin, auth pages), not the front page.

Light and dark, class-based (`.dark`), driven by `themeStore`. Both share token names defined as
`R G B` triples so `rgb(var(--token) / <alpha>)` works. A fixed mesh gradient (emerald/violet/cyan
radial blobs over a slate base) lives on `body`; surfaces are translucent glass layered over it.

## Color

Applies to the app (tenant, admin, auth pages). The front page uses its own enamel palette below.

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

- The app (tenant, admin, auth pages) uses one family: **Inter** (display + body + UI), with
  `font-feature-settings` stylistic sets. The front page adds Archivo for its lettering (below).
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
  (`w-60`). Content max-width `7xl`, `px-6 py-6` (`lg:px-8 lg:py-8`).
- Responsive grids via `repeat(auto-fit, minmax(...))` or breakpoint columns; sidebar collapses
  structurally (not fluid type).

## Motion

- Keyframes: `gradient-shift` (8s), `shimmer` (2s), `float`, `fade-up`. Page entrance uses
  `animate-grad-fade-up`.
- Durations 150–250ms, ease-out. Press feedback `scale(0.97–0.98)`. All gated behind
  `prefers-reduced-motion: reduce`.

## Front page (signed-out "/")

Captures `packages/web/src/pages/HomePage.tsx` + `HomePage.css`. Everything lives under the `.hp`
class and its `--hp-*` variables; none of it leaks into the app, and none of the app's gradient,
glass or mesh comes in. Light only.

### Overview

**Creative North Star: "The Mill's Painted Palay Board"**

- The page is the enamel signboard out front of a rice mill; Oraiza is the books behind it.
- Flat painted enamel on a concrete wall: white boards, sign-black capitals, one red plate for
  the action, gold hook-on number plates.
- Hardware (bolts, hooks, brackets) is authored inline SVG in the same black stroke and steel
  fill (`hp-bolt-steel`). No icon set, no illustrations.
- The real app appears only as framed sample screens, in Inter, each labeled "Sample data".

### Colors

- **Concrete Wall** (`hp-ground`): page background the boards are bolted to.
- **White Enamel** (`hp-board`): boards, station signs, header and footer strips.
- **Sign Black** (`hp-ink`): lettering, frames, divider bar, route post, rules, focus outline.
- **Weathered Black** (`hp-ink-2`): body copy, fine print, units, sub-labels.
- **Enamel Red** (`hp-red`, press `hp-red-press`): the primary plate's fill; also the BUYING PALAY
  title lettering.
- **Plate Gold** (`hp-gold`): hook-on number plates only.

**The One Red Plate Rule.** Red fill appears once per screen, on the one primary action. The
header's account plate is ink-outline, so the hero's red plate stands alone.

**The Bare Enamel Rule.** No gradients, glass, blur or mesh on this page. Color is flat paint.

### Typography

- **Lettering:** Archivo variable (`wdth` 62–125, `wght` 400–900), loaded in `index.css`.
- **Painted capitals** (`.hp-caps`): weight 900, stretch 112%, uppercase, `-0.01em`, line-height
  0.95. The hero headline stretches to 118% and paints each sentence as its own block line.
- **Number plates** (`.hp-cond`): weight 800, stretch 72%, tabular lining figures.
- **Body and controls:** Archivo at 100% width; base 18px/1.55, ledes and station copy 19px
  (20px from 1280px), max 34–40em. Controls 17px/800, the red plate 19px.
- **Sample screens:** Inter 15px/1.5, tabular figures, small labels 12.5px uppercase tracked.

**The Two Hands Rule.** Archivo is the sign painter's hand; Inter is the app's. Inter appears
only inside sample screens, Archivo never inside them.

### Layout

- Container max 1240px, gutters 16px (28px from 640px).
- Header strip 68px with a 3px ink bottom rule: logo (stalk mark painted black), Log in text link,
  ink account plate. Under 480px the header plate hides; the hero's red plate is right below.
- **Hero board:** from 960px a two-panel grid `1.16fr | 6px painted bar | 0.84fr`: headline,
  lede and red plate left; BUYING PALAY price list right. Stacked below 960px with the bar as a
  6px horizontal rule. The whole board sits above the fold at 1536x742.
- **Route post:** an ordered list hung off one ink post (6px wide, 8px from 640px). Each station
  sign hangs on an SVG bracket reaching to the post; from 960px the sign and its copy sit side by
  side (`17rem | 1fr`). Station proofs vary in width (600px, 780px, full, or a split) so the route
  never reads as a repeated grid.
- Closing board: centered, same frame and bolts, one red plate.
- Mobile: the red plate goes full width and may wrap; price plates stack over their unit under
  420px; the Paid column hides in sample tables under 560px.

### Elevation & Depth

Flat paint, with soft hanging shadows only for things that hang off the wall: boards
(`0 26px 40px -30px`), station signs, number plates, the red plate and sample screens, all tinted
sign black (the red plate's is tinted red). No hard offset shadows.

### Shapes

Nearly square. Plates 3px, boards 4px, frame keyline 2px. Sample screens keep the app's 10px.
Borders are heavy and painted: plates 3px, number plates 2px, price and role rules 2px.

### Components

- **Board:** white enamel, 4px radius, a painted double frame (6px outer line, 2px keyline 8px
  inside), SVG bolts at the corners, each turned to a different angle. Frames are plain CSS
  borders.
- **Plates (controls):** 3px ink border, 3px radius, min height 48px. Red (60px, white text,
  arrow nudges 3px on hover) is the one primary action; ink-outline inverts to black on hover and
  is the secondary. Press drops 1px. Tertiary is an underlined text link (2px, red underline on
  hover). Focus: 3px ink outline, 3px offset.
- **Number plates:** gold, 2px ink border, hung from two SVG wire hooks at 16% from each edge,
  peso sign at 0.62em.
- **Station signs:** small boards (4px frame, 1.5px keyline) with a bolt at each side, on an SVG
  bracket bolted to the route post. The sign is the station's heading.
- **Sample screens:** white, 1px slate border, 10px radius, a title bar with a dashed "Sample
  data" tag. Contents mirror app records (fields, totals, tables, status pills).
- **Motion:** one only. Every 3.8s one number plate swings up on its hooks (`rotateX`, 760ms) and
  falls back showing the next figure. Off for reduced motion, while the tab is hidden, and while
  the board is off screen. Plate hovers 120–180ms ease-out.

### Do's and Don'ts

- **Do** keep every figure on the page sample-labeled: "Sample prices" on the board, "Sample
  data" on every screen.
- **Do** draw hardware as inline SVG in `hp-ink` stroke and `hp-bolt-steel` fill.
- **Do** use the enamel tokens through `--hp-*` variables; add new front-page rules under `.hp`.
- **Don't** put a second red fill on a screen, or make the header plate red.
- **Don't** bring the app's gradient, glass, mesh or icon chips onto this page, and don't use
  icon-card grids or a browser-framed dashboard hero.
- **Don't** use Archivo inside sample screens, or Inter on the board.
