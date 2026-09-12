# 05 — Task Breakdown

Effort unit: 1 pt ≈ half a focused day. Total = 31 pt (~3 weeks single developer; "parallel agents" here is only an effort estimate, not the workflow — implementation is sequential, one agent per session, per `07-implementation-kickoff-prompt.md`; the 24 h soak in 5.2 is elapsed wall-clock, not effort). TDD applies throughout (tests first for `core/` and connectors; 80% coverage target per project rules).

## Phase 0 — Setup (2 pt)

| # | Task | Est | Depends on |
|---|---|---|---|
| 0.1 | Repo scaffold: pnpm workspace (`server/`, `web/`), TypeScript strict, ESLint/Prettier, Vitest | 1 | — |
| 0.2 | CI (lint + typecheck + test) and Dockerfile skeleton | 1 | 0.1 |

## Phase 1 — Core Data Layer (pure, no I/O) (4 pt)

| # | Task | Est | Depends on |
|---|---|---|---|
| 1.1 | `core/types.ts`: MarketSnapshot, Ticker, Rate, Premium types + zod schemas for boundary validation; source-of-truth symbol config with a scope-guard test (fails on any 6th coin / 3rd target exchange) | 1 | 0.1 |
| 1.2 | `core/premium.ts`: premium formulas (Pair A, Pair B cross rate) — tests first with hand-computed fixtures (incl. the verified 2026-08-16 sample values from `03-api-integration.md`) plus boundary cases: zero/near-zero denominators, missing FX, extreme USDT/USD divergence, display rounding vs raw-value math, KRW/JPY cross-rate precision | 2 | 1.1 |
| 1.3 | `core/snapshot.ts`: immutable snapshot update/merge + the staleness/skew invariant from `02-architecture.md` (live/stale/down transitions, max-skew marking, omit-on-down); unit tests per state transition | 1 | 1.1 |

## Phase 2 — Exchange & FX Connectors (7 pt)

Each connector: connect, subscribe, normalize to `Ticker`, reconnect with backoff, heartbeat, stale TTL. Test with recorded fixture messages (no live calls in unit tests).

| # | Task | Est | Depends on |
|---|---|---|---|
| 2.1 | Upbit WS connector (ticker for 5 KRW pairs + KRW-USDT); REST bootstrap | 2 | 1.3 |
| 2.2 | Binance WS connector (combined miniTicker stream); REST bootstrap; 24h scheduled reconnect | 2 | 1.3 |
| 2.3 | Bitbank Socket.IO connector (`ticker_{pair}` rooms, string-to-number parsing, **mid-price basis + one-sided/crossed-book and circuit-break handling** per `03-api-integration.md`); REST bootstrap | 2 | 1.3 |
| 2.4 | FX poller (open.er-api.com primary at ~1 scheduled fetch/day, Frankfurter fallback; total budget **2–4 FX fetches/day** incl. cross-check/retries, cached, per the ToS table in `03-api-integration.md`; persists last-good in memory; failure alerting via health status) | 1 | 1.3 |

Risk checkpoint after Phase 2: run all connectors live for an hour; verify tick rates, reconnect behavior, and **validate** the decided Bitbank mid-price policy (spread width, quote freshness on SOL/DOT) — the price basis is already decided in `02/03`; this checkpoint confirms thresholds, it does not re-open the choice.

## Phase 3 — Aggregator Service (3 pt)

| # | Task | Est | Depends on |
|---|---|---|---|
| 3.1 | Fastify app: `GET /api/snapshot`, `GET /api/health`, static serving of `web/dist` | 1 | 2.x |
| 3.2 | WS broadcaster: 1 Hz coalesced snapshot push, client lifecycle, integration test with mock connectors | 2 | 3.1 |

## Phase 4 — Frontend UI (7 pt)

| # | Task | Est | Depends on |
|---|---|---|---|
| 4.1 | Design tokens, global styles, light/dark theming + toggle (`04-ui-design.md`) | 1 | 0.1 |
| 4.2 | `useMarketSocket` hook + Zustand store + REST fallback polling | 1 | 3.2 |
| 4.3 | FX status bar with feed-status dots | 1 | 4.1, 4.2 |
| 4.4 | Premium table component (shared by A/B): sort, flash animation, stale styling, responsive column collapse | 2 | 4.1, 4.2 |
| 4.5 | Featured hero + coin switcher; method/source note; footer attribution | 1 | 4.4 |
| 4.6 | Number/currency formatting lib (KRW compact 100M-unit, JPY, USD, signed %) with unit tests | 1 | 0.1 |

## Phase 5 — Real-Time Wiring & Hardening (2 pt)

| # | Task | Est | Depends on |
|---|---|---|---|
| 5.1 | Fault injection first: kill/throttle each feed and simulate malformed payloads, 429s, and clock skew; confirm stale/omit/down states render per the invariant | 1 | 3.x, 4.x |
| 5.2 | End-to-end soak: all feeds live for 24 h **wall-clock elapsed** (effort ~1 pt of active work); verify no drift, memory stable, reconnects clean, Bitbank thresholds hold | 1 | 5.1 |

## Phase 6 — Testing & QA (3 pt)

| # | Task | Est | Depends on |
|---|---|---|---|
| 6.1 | Playwright E2E: page loads with data (mocked WS), sort works, theme toggle persists, reconnect banner | 1 | 4.x |
| 6.2 | Visual regression screenshots at 320/768/1024/1440, both themes | 1 | 6.1 |
| 6.3 | Accessibility pass (axe, keyboard nav, reduced motion) + Lighthouse (budgets in `04-ui-design.md`) | 1 | 6.1 |

## Phase 7 — Deployment (3 pt)

| # | Task | Est | Depends on |
|---|---|---|---|
| 7.1 | Production Docker image, env config (ports, FX API choice), deploy to small VM/Fly.io; HTTPS + security headers/CSP per web security rules | 1 | 5.x, 6.x |
| 7.2 | **Release gate — provider terms & attribution**: verify ExchangeRate-API attribution link renders (ToS requirement), confirm no raw-rate redistribution path exists, re-read exchange/FX ToS for the chosen deployment region (incl. Binance geo policy), record that only public APIs are consumed (no scolkg.com scraping) | 1 | 7.1 |
| 7.3 | Runbook: health endpoint monitoring, restart policy, exchange-API change watchlist (incl. er-api `time_eol` deprecation field alert) | 1 | 7.1 |

## Open Questions / Risks

1. **FX freshness**: free daily FX introduces up to ~0.5% premium error (worse on weekends with Frankfurter). **Decision (final, recorded in `03-api-integration.md`): daily FX is accepted for v1**, mitigated by displaying the rate date and the live Upbit KRW-USDT implied rate, and by the FX stale/down thresholds (26 h / 78 h) in `02-architecture.md`. A keyed real-time FX API remains the post-v1 upgrade path.
2. **Bitbank thin liquidity** on SOL/DOT JPY pairs — mitigated by the decided mid-price basis + stale/omit invariant (`02/03`); the Phase 2 checkpoint tunes thresholds only.
3. **USDT vs USD**: Pair A premium conventionally treats USDT as USD; deviations are visible via the implied-rate display. Accept as convention (documented in UI).
4. **Binance geo-restrictions**: `stream.binance.com` may be blocked in some regions (e.g. US); Binance docs list market-data-only hosts `data-api.binance.vision` / `data-stream.binance.vision` as the alternative (see `03-api-integration.md`) — confirm reachability during Phase 2.2 and fix the deployment-region policy at the 7.2 release gate.
5. **Bitbank public REST rate limit is undocumented** — WS-primary design avoids the question, but confirm behavior during the soak test.
