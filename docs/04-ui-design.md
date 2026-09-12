# 04 — UI Design Plan

## Style Direction

**Swiss/International-style data dashboard with a "terminal" accent** — dense, precise, numbers-first, unapologetically a market tool. Not a generic card-grid template: hierarchy comes from typographic scale and tabular alignment, depth from layered surfaces (status bar / tables / footer on distinct elevations), and motion from value-change flashes only. The original site's information design is good; its 2018 Bootstrap visuals are what we replace.

- Typography: one variable sans for UI (e.g. Inter) + tabular numerals for all figures (IBM Plex Mono, or Inter with `font-variant-numeric: tabular-nums`). Max two families, `font-display: swap`, preload the critical weight only.
- Color semantics follow the Korean market convention (matching the original and Upbit): **red = positive/premium up, blue = negative/discount**. This is semantic use of color, not decoration; document it in a legend tooltip since Western users expect the inverse.
- Light and dark themes, both intentional (tokens below), defaulting to `prefers-color-scheme`, with a persisted toggle (the original has a Day/Night button).

## Design Tokens (draft)

```css
:root {
  --color-surface: oklch(98% 0.003 250);
  --color-surface-raised: oklch(100% 0 0);
  --color-text: oklch(20% 0.01 250);
  --color-text-dim: oklch(48% 0.01 250);
  --color-up: oklch(55% 0.19 25);      /* red: premium positive */
  --color-down: oklch(52% 0.16 250);   /* blue: premium negative */
  --color-stale: oklch(70% 0.02 250);
  --text-num: clamp(0.9rem, 0.85rem + 0.3vw, 1.05rem);
  --text-hero-num: clamp(1.6rem, 1.2rem + 1.5vw, 2.4rem);
  --space-section: clamp(1.5rem, 1rem + 2vw, 3rem);
  --duration-flash: 600ms;
}
[data-theme="dark"] {
  --color-surface: oklch(16% 0.01 250);
  --color-surface-raised: oklch(21% 0.012 250);
  --color-text: oklch(93% 0.005 250);
  --color-text-dim: oklch(65% 0.008 250);
}
```

## Page Structure (single page)

```
<header>  FX status bar (sticky)
<main>
  <section> Featured premium hero (BTC by default, coin switcher)
  <section> Table A: Upbit vs Binance
  <section> Table B: Upbit vs Bitbank
  <section> Data-source & method note (FX date, USDT caveat)
</main>
<footer>  "Rates By Exchange Rate API" link (attribution REQUIRED by provider ToS), exchange doc links
```

Semantic HTML throughout (`table/thead/tbody/th scope`), `aria-live="off"` on fast-updating cells (screen readers must not announce every tick; provide an `aria-label` summary per row instead).

### 1. FX Status Bar (sticky header)

Contents: `USD/KRW 1,414.9` (+ rates-date badge, e.g. "ECB 08-14" or "daily"), `JPY/KRW 8.885`, `USDT/KRW 1,414 (implied, live)`, connection status dot per feed (green/amber/red = live/stale/down), theme toggle. On mobile this collapses to a horizontally scrollable strip.

### 2. Featured Premium Hero

Large three-figure statement for the selected coin (default BTC):
`Upbit KRW 89,237,000 ($62,909)` minus `Binance $63,074 (KRW 89,471,689)` equals `Premium -0.26% / -KRW 234,689` — the premium figure at `--text-hero-num` scale, colored by sign. Coin switcher = 5 segmented buttons (BTC ETH XRP SOL DOT). A secondary line shows the Bitbank comparison for the same coin.

### 3. Comparison Tables (A and B — same component)

Columns (Table A shown; B swaps the target column):

| Column | Content | Alignment | Notes |
|---|---|---|---|
| Coin | icon + symbol | left | sticky first column on mobile |
| Binance ($) / Bitbank (JPY) | target price, native currency (Binance: last; Bitbank: mid `(buy+sell)/2`, per `02/03`) | right | tabular numerals |
| Target in KRW | converted price | right | dimmed; makes the FX math visible |
| Upbit (KRW) | KRW last price | right | value-change flash |
| Change (24h %) | Upbit signed change | right | red/blue |
| Volume (100M KRW) | Upbit 24h trade value | right | compact unit matching the original's "x100M KRW" convention |
| Premium | `-234,675 (-0.26%)` in KRW | right | color by sign; bold %; subtle row background tint when abs(premium) >= 1% |

Interactions: column-header sort (client-side), hover row highlight. Staleness states follow the invariant in `02-architecture.md`: cells/premiums with any `stale` input turn `--color-stale` with an age tooltip ("last update 23s ago") and are de-emphasized in sorting; premiums with a `down`/missing input render as an em dash (never a frozen number styled as current). Value changes flash background (up: red tint, down: blue tint) fading over `--duration-flash` — `opacity`/`background-color` transitions only, throttled to the 1 Hz push cadence.

### 4. Method / Source Note

One collapsible paragraph: formulas, FX source + timestamp, the USDT-approximates-USD caveat, links. This is the honesty feature the plan requires.

## Responsive Breakpoints

- **320–479**: hero stacks vertically; tables show Coin / Upbit / Premium only (other columns behind a row-expand chevron).
- **480–767**: add the target-price column.
- **768–1023**: full columns, tables stacked.
- **1024+**: tables side-by-side (2-column grid), hero left-aligned with FX bar inline.
- **1440+**: max content width ~1280 px, centered; increased table row height.

Test at 320/375/768/1024/1440/1920 per testing rules; no horizontal overflow at any width.

## Accessibility & Motion

- Contrast >= 4.5:1 for all numbers/text on both themes (verify red/blue on dark).
- `prefers-reduced-motion`: disable flash animations; values still update.
- Full keyboard operability: sort headers are buttons, coin switcher is a radiogroup, theme toggle a switch.

## Performance Budget

Landing-page budget per project rules: JS < 200 KB gz (React + Zustand + socket.io-client + app), CSS < 30 KB. No raster images; inline SVG coin icons only (self-hosted, from the open-source `cryptocurrency-icons` set the original also uses). LCP target < 2.5 s via a **fast client bootstrap** (no SSR): exchange WebSockets connect from the browser after GitHub Pages serves the SPA. Table skeleton renders instantly from static HTML/CSS.
