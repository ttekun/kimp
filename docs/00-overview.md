# 00 — Project Overview

## Goal

Build a real-time "kimchi premium" (Korea premium) dashboard, modeled on https://scolkg.com/ (branded "Cryprice"), that shows live price differences for a fixed set of cryptocurrencies between the Korean exchange Upbit and two overseas exchanges: Binance (USD/USDT market) and Bitbank (JPY market).

The premium is the percentage by which the Upbit KRW price exceeds (or falls below) the equivalent overseas price, after converting through a live-ish fiat FX rate.

## Scope (hard requirements)

| Item | Value |
|---|---|
| Exchange pair A | Upbit (KRW) vs Binance (USDT, treated as USD proxy) |
| Exchange pair B | Upbit (KRW) vs Bitbank (JPY) |
| Coins | BTC, ETH, XRP, SOL, DOT (exactly these 5) |
| Premium A | Upbit KRW price ÷ FX(USD/KRW) vs Binance USDT price |
| Premium B | Upbit KRW price vs Bitbank JPY price × cross rate KRW/JPY (derived from USD/KRW ÷ USD/JPY) |
| FX source | Free public forex API — primary polled ~1×/day, within a total budget of **2–4 FX fetches/day** (incl. fallback cross-check and retries), cached; see `03-api-integration.md` — plus optional Upbit KRW-USDT implied rate as a real-time cross-check |
| Real-time | Live-updating table; WebSocket-fed prices from all three exchanges |

Note: the original site's second comparison table is Upbit vs **Bybit**. Our substitution of **Bitbank** is a deliberate scope decision, not a feature of the original.

## Non-Goals / Explicitly Excluded

These exist on scolkg.com but are out of scope for the clone:

- Any coins beyond the 5 listed; any exchanges beyond the 2 pairs (no Bybit, BitMEX, Coinbase, etc.)
- Live community chat, chat bots, polls
- Price alert system / Telegram notifications
- TradingView chart embeds and chart pages
- Binance liquidation (long/short) widget
- BTC dominance and Coinbase Premium indicators
- Ads, referral/affiliate links
- User accounts, portfolios
- Historical premium charts (possible future enhancement, not v1)

## Success Criteria

1. Both comparison tables render all 5 coins with prices updating in near real time: ≤ 2 s from the **exchange-provided tick timestamp** to browser render, covering connector, aggregation, the 1 Hz broadcast throttle, and network. FX-rate freshness is explicitly excluded from this latency claim (the FX source is daily; its age is displayed separately).
2. Premium % and absolute KRW difference are mathematically correct against manual spot-checks **when all inputs are live**; under partial outage the staleness invariant in `02-architecture.md` applies (stale-styled or omitted, never silently wrong).
3. FX rate, its rates date, and its age are displayed so users can judge premium accuracy. Daily-updated free FX is **accepted for v1** (decision recorded in `03-api-integration.md`); FX freshness follows the thresholds in `02-architecture.md` (stale at 26 h, down at 78 h), separate from the per-exchange feed rules.
4. Graceful degradation: if one exchange feed drops, the other table remains live; affected premiums follow the stale/omit rules rather than freezing as current.
5. Responsive layout (mobile 320 px through desktop 1440 px+), light/dark themes.

## Document Map

- `01-site-analysis.md` — what scolkg.com actually does (observed vs inferred)
- `02-architecture.md` — tech stack, data flow, real-time strategy
- `03-api-integration.md` — verified endpoints, auth, rate limits, response shapes, FX source
- `04-ui-design.md` — layout, table columns, color/theming conventions
- `05-task-breakdown.md` — phased tasks, estimates, dependencies
