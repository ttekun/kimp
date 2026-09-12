# 02 — Architecture

## Design Principles

- **Production:** a static SPA on GitHub Pages. The browser opens public exchange WebSockets and computes premiums locally (personal-scale URL).
- **Local/tests:** the Node aggregator in `server/` remains for connector unit tests and optional `pnpm --filter @kimchi/server` development.
- Data structures first: a single normalized in-memory `MarketSnapshot` is the heart of the system; everything else derives from it.

## System Diagram

```
Browser SPA (GitHub Pages: https://ttekun.github.io/kimchi-premium-clone/)
  -> wss://api.upbit.com/websocket/v1
  -> wss://stream.binance.com:443  miniTicker
  -> wss://stream.bitbank.cc      Socket.IO ticker_*_jpy
  -> https://open.er-api.com      (localStorage cache per UTC day; Frankfurter fallback)
        |
        v
  snapshot merge + premium (same pure functions as server/src/core)
  ~1 Hz UI publish
```

## Tech Stack & Rationale

| Layer | Choice | Rationale |
|---|---|---|
| Backend runtime | Node.js 22 LTS + TypeScript | Single-language stack; first-class WebSocket ecosystem; the original site is Node/Socket.IO (inferred) |
| Backend framework | Fastify (HTTP) + `ws` (server push) | Minimal; we need 2 REST routes and 1 WS endpoint. Socket.IO is unnecessary overhead when we control both ends and target modern browsers |
| Exchange clients | Native `ws` for Upbit/Binance; `socket.io-client` v4 for Bitbank (its stream is Socket.IO 4.x per docs.bitbank.cc) | Matches each exchange's protocol |
| Frontend | React 18 + Vite + TypeScript | Team-standard modern stack; the original uses Vue 2 (EOL) — no reason to copy an EOL framework |
| Styling | Plain CSS with custom properties (design tokens), no UI kit | Small surface; avoids template look; tokens drive light/dark theming |
| State | Zustand store fed by the browser aggregator | One snapshot at ~1 Hz; no `/ws` in production |
| Testing | Vitest (unit), Playwright (E2E + visual) | Per project testing rules |
| Deployment | GitHub Pages (`web/dist`, `GITHUB_PAGES=true` Vite `base`) | Free static host; browser opens exchange WebSockets |

## Data Model (core)

```ts
// One immutable snapshot, replaced (not mutated) on every update
interface MarketSnapshot {
  updatedAt: number;                       // epoch ms
  fx: {
    usdKrw: Rate;                          // { value, fetchedAt, source, ratesDate }
    usdJpy: Rate;
    krwPerJpy: number;                     // derived: usdKrw / usdJpy
    usdtKrwImplied?: Rate;                 // Upbit KRW-USDT last price (real-time cross-check)
  };
  coins: Record<CoinSymbol, {              // BTC | ETH | XRP | SOL | DOT
    upbit?: Ticker;                        // { price: KRW, change24hPct, volume24hKrw, ts, status }
    binance?: Ticker;                      // { price: USDT, ts, status }
    bitbank?: Ticker;                      // { price: JPY (mid), ts, status }
    premiumBinance?: Premium;              // { pct, diffKrw, computedAt, inputTs: {upbit, target, fx}, status }
    premiumBitbank?: Premium;
  }>;
}

type FeedStatus = 'live' | 'stale' | 'down';   // per ticker and per premium
```

The coin symbol set and per-exchange market codes live in one source-of-truth config
(`KRW-{BTC,ETH,XRP,SOL,DOT}` / `{btc,eth,xrp,sol,dot}usdt` / `{btc,eth,xrp,sol,dot}_jpy`),
with a test that fails if any other symbol or exchange is ever emitted (scope guard).

## Premium Formulas

Let `P_upbit` (KRW), `P_binance` (USDT ~ USD), `P_bitbank` (JPY), `FX_usdkrw` (KRW per USD), `FX_usdjpy` (JPY per USD).

```
Pair A (Upbit vs Binance):
  binanceKrw   = P_binance * FX_usdkrw
  premiumPct   = (P_upbit / binanceKrw - 1) * 100
  diffKrw      = P_upbit - binanceKrw

Pair B (Upbit vs Bitbank):
  krwPerJpy    = FX_usdkrw / FX_usdjpy          // cross rate from one consistent source
  bitbankKrw   = P_bitbank * krwPerJpy
  premiumPct   = (P_upbit / bitbankKrw - 1) * 100
  diffKrw      = P_upbit - bitbankKrw
```

Known approximation (documented in UI): Binance prices are quoted in USDT, not USD; USDT/USD deviates a few bps to ~0.5% in stress. This matches how kimchi-premium sites (including the original) conventionally compute it. The FX bar's implied USDT/KRW rate (Upbit KRW-USDT) makes the deviation visible. The external USD/KRW rate is the canonical input for Pair A premium (drives sorting and spot checks); the implied USDT rate is display-only context in v1.

## Price Basis, Timestamp Alignment & Staleness Invariant

This section defines when a premium may be shown as "current". It is a product contract, not a test detail.

### Price basis (v1)

| Feed | Basis | Rationale |
|---|---|---|
| Upbit | `trade_price` (last) | Deep KRW books; last trade is fresh for all 5 coins |
| Binance | miniTicker close (last) | 1 s cadence, deep books |
| Bitbank | **midpoint `(buy + sell) / 2`** | JPY books for SOL/DOT are thin; last trade can be minutes old, while quotes stay live. Mid is used consistently for all 5 Bitbank pairs. If the book is one-sided or crossed (e.g. during a Bitbank circuit break), the ticker is marked `down` and no premium is computed |

All premium math runs on unrounded raw values; rounding happens only at display time.

### Timestamp policy

- Every `Ticker` retains its **source timestamp** (`ts` from the exchange payload, not receive time); every `Premium` records `computedAt` plus the `inputTs` of all three inputs (Upbit tick, target tick, FX fetch).
- A premium is computed only from the latest tick of each side; there is no interpolation. To bound false spikes from comparing a fresh tick against an old one, a **maximum skew** applies between the two exchange ticks.

### Staleness thresholds (initial values, configurable)

| Input | `stale` after | `down` after |
|---|---|---|
| Upbit tick | 15 s | 60 s |
| Binance tick | 15 s | 60 s |
| Bitbank tick (mid) | 30 s (slower market) | 120 s |
| FX rate | 26 h since successful fetch (daily source) | 78 h (covers weekends; ECB-style sources pause) |
| Cross-exchange skew | pair marked `stale` if the two exchange ticks differ by > 30 s | — |

### Invariant

**A premium is shown as current only if both price inputs and the FX rate are `live` and within skew.** Otherwise:

- Any input `stale` → premium is still computed from last-known values but rendered in the stale style with an age tooltip; it is excluded from "current" sorting emphasis.
- Any input `down` or missing → premium is **omitted** (em dash in the UI), never frozen at an old value presented as current.
- These states live on the in-memory snapshot the SPA publishes at ~1 Hz. There is no production REST snapshot fallback.

## Real-Time Update Strategy

1. **Ingest**: each connector pushes normalized ticks into the store as they arrive (Upbit ticker stream is per-trade; Binance miniTicker is 1000 ms cadence; Bitbank ticker is per-event).
2. **Recompute**: premium recalculation is a pure function over the snapshot; runs on each ingest (trivial at n=5).
3. **Broadcast throttle**: the browser publishes at most 1 snapshot/sec to React (coalescing), matching the visual cadence of the original. Full snapshot every push.
4. **Resilience**: per-connector exponential backoff reconnect (1 s → 30 s cap) and per-feed `live/stale/down` status. There is no `/api/health` in production; the FX bar uses snapshot-derived feed status plus transport `connecting` / `live` / `reconnecting`.
5. **FX cadence:** each browser loads er-api at most once per UTC day (`localStorage` key `kimp:fx:{date}`), then Frankfurter on miss/failure. Upbit KRW-USDT implied rate still streams on the Upbit socket.
6. **Client fallback:** on all exchange sockets down the UI shows the reconnecting banner. Upbit/Bitbank REST is not used (no CORS).

## Why client-direct on GitHub Pages

A always-on Node aggregator needs a paid VM (Fly trial ended). GitHub Pages is free static hosting. FX CORS is open for er-api and Frankfurter. Trade-off: three sockets per visitor; Origin must be allowed by the exchanges (`https://ttekun.github.io`). Node connectors remain for tests.

## Directory Layout (planned)

```
kimchi-premium-clone/
├── docs/                       # these documents
├── server/
│   ├── src/
│   │   ├── connectors/         # upbit.ts, binance.ts, bitbank.ts, fx.ts
│   │   ├── core/               # snapshot.ts, premium.ts (pure), types.ts
│   │   ├── transport/          # wsServer.ts, httpApi.ts
│   │   └── index.ts
│   └── test/
└── web/
    ├── src/
    │   ├── components/         # fx-bar/, premium-table/, status/
    │   ├── hooks/              # useMarketSocket.ts, useTheme.ts
    │   ├── lib/                # format.ts (KRW/USD/JPY formatting)
    │   └── styles/             # tokens.css, global.css
    └── e2e/
```
