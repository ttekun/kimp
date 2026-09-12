# 03 — API Integration Details

Verification legend:
- **[Verified live 2026-08-16]** — endpoint was called during research and returned the described data.
- **[Docs]** — taken from the official documentation (fetched 2026-08-16), not exercised.
- **[Unverified]** — stated with uncertainty; confirm at implementation time.

All market-data endpoints below are public and require **no authentication** (confirmed live for REST; confirmed in docs for WS).

---

## 1. Upbit (Criterion exchange, KRW)

Docs: https://docs.upbit.com

### REST ticker — [Verified live 2026-08-16]

```
GET https://api.upbit.com/v1/ticker?markets=KRW-BTC,KRW-ETH,KRW-XRP,KRW-SOL,KRW-DOT
```

Returns an array; fields per market (26 total), the ones we use:

| Field | Meaning |
|---|---|
| `market` | e.g. `"KRW-BTC"` |
| `trade_price` | last price (KRW) |
| `signed_change_rate` | 24h change vs prev close (fraction, signed) |
| `acc_trade_price_24h` | 24h accumulated trade value (KRW) — source for the "volume(100m)" column |
| `timestamp` | ms epoch |

Also subscribe/fetch `KRW-USDT` for the implied USDT/KRW rate shown in the FX bar.

### WebSocket — [Docs: docs.upbit.com websocket guide]

- URL: `wss://api.upbit.com/websocket/v1` (public; no auth for quotation data; private endpoint is separate).
- Request: JSON array `[{"ticket":"<uuid>"},{"type":"ticker","codes":["KRW-BTC","KRW-ETH","KRW-XRP","KRW-SOL","KRW-DOT","KRW-USDT"]},{"format":"DEFAULT"}]`.
- Response fields mirror REST ticker (`trade_price`, `signed_change_rate`, `acc_trade_price_24h`, ...). [Unverified — confirm at implementation] Keep-alive convention: send a PING frame periodically (~60 s); exact idle-timeout behavior was not on the fetched docs page.

### Rate limits — [Docs: docs.upbit.com rate-limits page, fetched 2026-08-16]

- REST quotation: **10 req/s per IP** (all quotation endpoints share the pool).
- WebSocket: connection attempts max 5/s; data request messages max 5/s and 100/min **per connection**.
- Our load: 1 WS connection + occasional REST fallback — far below limits.

---

## 2. Binance (Target exchange A, USDT)

Docs: https://developers.binance.com/docs/binance-spot-api-docs

### REST ticker — [Verified live 2026-08-16]

```
GET https://api.binance.com/api/v3/ticker/24hr?symbols=["BTCUSDT","ETHUSDT","XRPUSDT","SOLUSDT","DOTUSDT"]
```
(URL-encode the JSON array.) Fields used: `symbol`, `lastPrice`, `priceChangePercent`, `closeTime`. For price-only polling, `/api/v3/ticker/price` is cheaper (weight).

### WebSocket — [Docs: web-socket-streams page, fetched 2026-08-16]

- Base: `wss://stream.binance.com:9443` (also `:443`).
- Combined stream: `wss://stream.binance.com:9443/stream?streams=btcusdt@miniTicker/ethusdt@miniTicker/xrpusdt@miniTicker/solusdt@miniTicker/dotusdt@miniTicker`
- `@miniTicker` updates every 1000 ms; payload includes `c` (close/last price), `o/h/l`, `v/q` (volume). Wrapper: `{"stream":"...","data":{...}}`.
- [Docs: Binance REST overview, developers.binance.com/en/docs/products/spot/rest-api] Binance also lists a market-data-only REST base `data-api.binance.vision` (and a matching `data-stream.binance.vision` stream host) for public market data — useful as a deployment option where `api/stream.binance.com` is geo-restricted. [Unverified live] Confirm reachability from the actual deployment region during implementation.

### Rate limits — [Verified live 2026-08-16 via /api/v3/exchangeInfo rateLimits]

- `REQUEST_WEIGHT`: **6,000 per minute per IP**; `RAW_REQUESTS`: 300,000 per 5 min. Market data needs no key (security type NONE, [Docs]).
- WS streams: connections are long-lived; docs note 24h max connection lifetime — plan a scheduled reconnect ([Docs], detail unverified on fetched page).

---

## 3. Bitbank (Target exchange B, JPY)

Docs: https://github.com/bitbankinc/bitbank-api-docs (official)

### REST ticker — [Verified live 2026-08-16]

```
GET https://public.bitbank.cc/tickers            # all 66 pairs in one call
GET https://public.bitbank.cc/{pair}/ticker      # single pair, e.g. btc_jpy
```

All five needed pairs exist: **btc_jpy, eth_jpy, xrp_jpy, sol_jpy, dot_jpy**. Double evidence:
1. **[Verified live 2026-08-16]** all five appeared in the `/tickers` response (66 pairs total).
2. **[Docs]** the official pairs list (`bitbank-api-docs/pairs.md`, fetched 2026-08-16) includes `sol_jpy` and `dot_jpy`, and none of the five JPY pairs carries the "order suspended" flag.

Fields (note: numeric values are **strings**):

```json
{ "pair": "btc_jpy", "sell": "10048001", "buy": "10048000",
  "open": "10044207", "high": "10059552", "low": "10026037",
  "last": "10048001", "vol": "16.4829", "timestamp": 1786862979078 }
```

24h change % is not provided directly; derive from `last` vs `open` if we display it. Data contract note on 24h semantics: the three exchanges differ (Upbit `signed_change_rate` = vs previous close; Binance miniTicker = rolling 24h; Bitbank = `last` vs `open`). **v1 displays Upbit's change only** (matching the original's single change column), so no cross-exchange change comparison is implied.

**Price basis for premium (decided, see `02-architecture.md`)**: use the **midpoint `(buy + sell) / 2`**, not `last` — SOL/DOT JPY books are thin and `last` can lag minutes while quotes stay live. If the book is one-sided/crossed or the pair is in circuit break (the public API documents circuit-break status via `circuit_break_info_{pair}` and REST market status), mark the feed `down` and omit the premium. The Phase 2 checkpoint in `05-task-breakdown.md` validates this policy against live behavior; it does not re-open the choice.

### WebSocket stream — [Docs: public-stream.md, fetched 2026-08-16]

- URL: `wss://stream.bitbank.cc` — **Socket.IO 4.x** (Engine.IO v4), not a raw WebSocket; use `socket.io-client` v4.
- Channel names ([Docs]): `ticker_{pair}` (e.g. `ticker_btc_jpy`); messages carry the same ticker shape as REST. [Unverified — confirm at implementation] The subscription mechanism (commonly an emitted `join-room` event) was not detailed on the fetched page.
- No auth for public streams.

### Rate limits — [Unverified]

Bitbank's docs do not state a numeric public REST rate limit. Use the WS stream as primary and REST only for bootstrap; keep REST polling ≥ 1 s intervals if ever used as fallback.

---

## 4. FX Rates (USD/KRW, USD/JPY)

### Recommended primary: ExchangeRate-API open endpoint — [Verified live 2026-08-16]

```
GET https://open.er-api.com/v6/latest/USD
```
- No key, free, CORS-open; returned `KRW: 1414.86`, `JPY: 159.23` with explicit `time_next_update_utc` (**updates ~daily**).

### Alternative/fallback: Frankfurter — [Verified live 2026-08-16]

```
GET https://api.frankfurter.dev/v1/latest?base=USD&symbols=KRW,JPY
```
- No key, free, ECB reference rates (business days only; our fetch on Sunday 2026-08-16 returned rates dated Friday 2026-08-14 — up to ~3 days stale over weekends). Response carries an explicit `date` field; er-api carries `time_last_update_*` — the aggregator normalizes either into `Rate.ratesDate` (derived per provider, not assumed uniform).

### Terms of service & operational suitability — [Docs: provider pages fetched 2026-08-16]

| Aspect | ExchangeRate-API open endpoint (exchangerate-api.com/docs/free) | Frankfurter (frankfurter.dev) |
|---|---|---|
| Key / cost | None / free | None / free, open source |
| Commercial use | Explicitly allowed ("personal or commercial currency conversion purposes") | Explicitly allowed (FAQ: "Yes, absolutely") |
| Attribution | **Required** — a "Rates By Exchange Rate API" link on pages using the rates. This is a release-gate acceptance criterion (footer link, see `04-ui-design.md`) | Not required |
| Redistribution | **Raw-rate redistribution prohibited.** Our use (computing/displaying premiums, showing the day's rate as context) is conversion display, not a rates feed; we must not expose an endpoint that relays their raw rates | No stated restriction |
| Rate limits | Throttled against abuse; their docs state ≤ 1 request/24 h avoids restrictions entirely; 429 on excess, lifted after ~20 min. We therefore hold **this primary at ~1 scheduled fetch/day** (timed off `time_next_update_utc`, retry with backoff only on failure); the project-wide budget of **2–4 FX fetches/day total** is the sum across primary + fallback cross-check + failure retries, with cached last-good rates in between (`02-architecture.md`, task 2.4) | "No quotas"; rate-limited to prevent abuse; heavy users advised to cache or **self-host (Docker image available)** — our escape hatch if the hosted service degrades |
| Uptime / SLA | **No SLA**; public Pingdom uptime page; a `time_eol` field will pre-announce endpoint deprecation — the poller should alert if `time_eol` appears | **No SLA**; self-hosting removes the dependency |
| Sanity checks | Poller cross-checks primary vs fallback; alert (health status `stale`) if they diverge > 2% or both fail | same |

Conclusion: acceptable for v1 given no SLA is needed (staleness invariant in `02-architecture.md` covers outages: FX `stale` at 26 h, `down` at 78 h). Neither provider guarantees permanence — the connector isolates the choice behind one interface. Also record: this clone consumes **public exchange/FX APIs only; it does not scrape scolkg.com** or redistribute any provider's raw rate feed.

### Honest limitation and mitigation

Both free no-key sources are **daily** rates, while scolkg.com displays a live-ish rate (it showed USD/KRW 1,418.5 vs er-api's 1,414.9 on the same day — a 0.25% gap, which flows 1:1 into premium error; weekend staleness can be worse).

Mitigations (in order):
1. Always display the FX rate value + its `ratesDate`/fetch time in the FX bar so premium accuracy is judgeable.
2. Compute and display the **implied real-time rate from Upbit KRW-USDT** (already streamed) next to the official rate, like the original does; optionally offer a UI toggle to compute Pair A premium with the implied USDT rate instead.
3. If higher FX accuracy becomes a requirement, upgrade to a keyed free tier (e.g. Twelve Data or currencyapi) as a post-v1 task.

Note: the unofficial Dunamu endpoint (`quotation-api-cdn.dunamu.com/v1/forex/recent`) commonly used by Korean sites **failed DNS resolution from our environment** on 2026-08-16 — do not depend on it.

### KRW/JPY cross rate

Derive `krwPerJpy = usdKrw / usdJpy` from the **same source and same rates date** (consistency beats mixing sources). With verified sample values: 1414.86 / 159.23 = 8.885 KRW per JPY (the original displayed 8.9026 from its live source — same ballpark, confirming the method).

---

## 5. Aggregator-to-Frontend Contract (our own API)

```
GET /api/snapshot          -> MarketSnapshot JSON incl. per-feed/premium status (see 02-architecture.md)
GET /api/health            -> { ok, connectors: { upbit, binance, bitbank, fx }:
                               { status: "live"|"stale"|"down", lastTickAgeMs, reconnects, lastError } }
WS  /ws                    -> pushes MarketSnapshot at most 1/sec; text JSON
```

## 6. Revalidation Policy

The "[Verified live 2026-08-16]" labels are dated assertions, not guarantees. At implementation:

- **Startup check**: the aggregator validates on boot that every configured symbol exists and every response parses against its zod schema; a mismatch marks the feed `down` and logs the schema diff.
- **CI check**: a small live smoke test (one REST call per exchange + FX) runs in CI on a schedule, so API drift is detected before users see it.
- Recorded response fixtures from these live calls are stored under `server/test/fixtures/` and referenced by connector unit tests.
