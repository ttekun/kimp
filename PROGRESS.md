# Progress — kimp implementation

## Currently working on

**How to start:** follow [`docs/07-implementation-kickoff-prompt.md`](docs/07-implementation-kickoff-prompt.md). Resume lives **only** in this block — do not ask the user to paste a prompt.

**Remaining queue:** **none** — `docs/05` checklist is finished (5.2 soak waived; 7.1 deploy close-out recorded below).

**Now:** GitHub Pages + browser aggregation. Public URL: `https://ttekun.github.io/kimp/` (repo `ttekun/kimp`). Fly/Docker deploy files removed.

**Status:** Production is static Pages. Node aggregator remains for unit tests. Deploy: push `main` (Actions Pages). Subpath smoke (`GITHUB_PAGES=true` preview) and Playwright e2e (store injection, no Engine.IO mock) are green locally. JS gzip ~89 KB (budget 200 KB).

**Forward context / LOW accepted:** Lighthouse SEO 60 (no meta description). Debug JSON panel removed (user 2026-09-05).

**Workflow:** single-agent loop in `docs/07`.

## Workflow (from 2026-09-05)

Single agent in one session: implement (TDD where `docs/05` requires it), self-check against `docs/02` invariants, mutation-gate new regression tests (guard deleted => test fails), run `pnpm lint` / `pnpm -r typecheck` / `pnpm -r test` / `pnpm -r build` / `pnpm format:check`, and for I/O or UI tasks record live evidence before checking the box. The retired process is the four-role factory (Implementation / Review / Review-fix / Verification on composer-2.5 / fable / sonnet). Search/explore helpers are allowed. Historical log entries below still name those models because that loop ran through Task 4.1 and the first two review rounds of 4.2. Workflow details: `docs/07-implementation-kickoff-prompt.md`.

## Checklist (mirrors 05-task-breakdown.md)

### Phase 0 — Setup (2 pt)

- [x] 0.1 Repo scaffold: pnpm workspace (server/, web/), TypeScript strict, ESLint/Prettier, Vitest
- [x] 0.2 CI (lint + typecheck + test) and Dockerfile skeleton

### Phase 1 — Core Data Layer (4 pt)

- [x] 1.1 core/types.ts: MarketSnapshot/Ticker/Rate/Premium types + zod schemas + scope-guard test
- [x] 1.2 core/premium.ts: premium formulas + boundary-case tests
- [x] 1.3 core/snapshot.ts: immutable snapshot update/merge + staleness/skew invariant

### Phase 2 — Exchange & FX Connectors (7 pt)

- [x] 2.1 Upbit WS connector + REST bootstrap (required 2 implementation rounds — round 1 verification caught a real-vs-mocked wire-shape bug; see log)
- [x] 2.2 Binance WS connector + REST bootstrap + 24h reconnect (1 review round, clean — Task 2.1's lessons applied proactively paid off)
- [x] 2.3 Bitbank Socket.IO connector (mid-price, circuit-break handling) — caught & fixed a real HIGH prod bug (batch REST validation silently zeroing out on unrelated pairs' null quotes)
- [x] 2.4 FX poller (er-api primary, Frankfurter fallback, 2-4 fetches/day budget) — caught & fixed a real HIGH bug (daily fetch cap causing permanent starvation after any ordinary busy day)
- [x] Phase 2 risk checkpoint: run all connectors live for an hour, validate Bitbank mid-price policy — CONCERN noted (DOT low liquidity across all 3 exchanges, not just Bitbank), no code change needed since the staleness invariant already handles it correctly by design

### Phase 3 — Aggregator Service (3 pt)

- [x] 3.1 Fastify app: GET /api/snapshot, GET /api/health, static serving — first full-system boot; caught & fixed a real HIGH Docker regression (devDep leak) + added a mutation-tested staleness-decay regression test
- [x] 3.2 WS broadcaster: 1Hz coalesced push + integration test — caught & fixed a real MEDIUM bug (permanent client starvation; 64KB backpressure threshold was unreachable dead code)

### Phase 4 — Frontend UI (7 pt)

- [x] 4.1 Design tokens, global styles, light/dark theming + toggle — took 3 review rounds (contrast/color-scheme, then a localStorage-crash bug that escaped fix attempt 1 before being properly closed)
- [x] 4.2 useMarketSocket hook + Zustand store + REST fallback polling
- [x] 4.3 FX status bar with feed-status dots
- [x] 4.4 Premium table component (sort, flash, stale styling, responsive collapse)
- [x] 4.5 Featured hero + coin switcher; method/source note; footer attribution
- [x] 4.6 Number/currency formatting lib + unit tests

### Phase 5 — Real-Time Wiring & Hardening (2 pt)

- [x] 5.1 Fault injection: kill/throttle feeds, malformed payloads, 429s, clock skew
- [x] 5.2 End-to-end soak: **waived** (user 2026-09-05 — 24 h wall-clock not required); t0 was sampled, 24 h not waited

### Phase 6 — Testing & QA (3 pt)

- [x] 6.1 Playwright E2E: load, sort, theme persist, reconnect banner
- [x] 6.2 Visual regression screenshots (320/768/1024/1440, both themes)
- [x] 6.3 Accessibility pass (axe, keyboard nav, reduced motion) + Lighthouse

### Phase 7 — Deployment (3 pt)

- [x] 7.1 Production Docker image, env config, HTTPS headers/CSP + Fly HTTPS deploy (nrt)
- [x] 7.2 Release gate: provider terms & attribution
- [x] 7.3 Runbook: health monitoring, restart policy, API change watchlist

## Log

### 2026-09-05 — Post-deploy fix: SPA served 404 at `/` (real regression)

User hit `404 Not Found` on the deployed root. `/api/*` was fine, so the first close-out's health-only evidence missed it — same failure class as Upbit `code` vs `market`: the probe never exercised the broken surface.

**Cause:** Task 5.1 moved `main()` from `src/index.ts` into `src/aggregator/runtime.ts`, one directory deeper, but `resolveStaticRoot()` kept `../../web/dist`. From `dist/aggregator/` that resolves to `server/web/dist` (nonexistent) instead of `<repo>/web/dist`. Every `@fastify/static` route missed, so the SPA fallback returned plain-text 404. Docker `HEALTHCHECK` stayed green because it only probes `/api/health`.

**Fix:** `resolveStaticRoot()` now uses `../../../web/dist` (exported, with a comment on the src/ vs dist/ symmetry). New `server/test/aggregator/runtime.test.ts` (2 tests): resolved path equals `<repo>/web/dist` and is not under the server package; `STATIC_ROOT` override still wins.

**Mutation gate:** restoring `../../web/dist` failed the new test (`expected …/web/dist, received …/server/web/dist`); restored and green.

**Live evidence:** local image `7.1-fix` on :13000 → `GET /` 200 `text/html` with the real `index.html`, `/theme-boot.js` 200. `fly deploy --ha=false` (machine `d897125c716438`, version 2, nrt) → `GET /` 200 html, `/theme-boot.js` 200, `/api/health` `ok: true` all connectors live. Browser: hero BTC **+1.40% / KRW +1,507,527**, Bitbank +1.12%, both tables populated, FX bar `USD/KRW 1,349.0 er-api 09-05`, connection `live`.

**Validation:** `pnpm lint`, `pnpm -r typecheck`, `pnpm -r test` (server 219, web 94), `pnpm -r build`, `pnpm format:check` — all green.

### 2026-09-05 — Task 7.1 deploy close-out complete

Docker + Fly live evidence (no unit-test-only close). Mutation gate N/A (no new production guards this session).

**Docker** `kimchi-premium-clone:7.1` on host port 13000 (local `:3000` leftover left running): `User=app` uid 999; HEALTHCHECK `GET /api/health`; health `ok: true` all connectors live; CSP `default-src 'self'`; `POST /api/dev/fault` → 404 `{"error":"Not Found"}`. Local HSTS off (no TLS). Container removed after checks.

**Fly:** `flyctl` 0.4.99; logged in as `tacksangkim@gmail.com`; created `kimchi-premium-clone`; `fly deploy` region **nrt**, `ENABLE_HSTS=1`, `force_https`. First deploy spawned 2 HA machines — scaled to **1** (`6837e40f31d918` destroyed) so FX stays 2–4 fetches/day. Runbook note + next `fly deploy --ha=false`.

**Live:** https://kimchi-premium-clone.fly.dev/ `GET /api/health` 200 `ok: true` upbit/binance/bitbank/fx `live` reconnects 0. Headers include CSP `default-src 'self'` and `strict-transport-security: max-age=31536000; includeSubDomains`. Hostname `kimchi-premium-clone.fly.dev`, remaining machine `d897125c716438` nrt started.

**7.1 marked complete. 05 checklist finished.**

**Rename (2026-09-05, user request):** Fly has no app rename, so the app was recreated as **`kimp`** (Korean slang for kimchi premium) and `fly.toml` `app` updated. `fly deploy --ha=false` → 1 machine `8654144fee45e8` nrt. https://kimp.fly.dev/ `GET /` 200 `text/html`, `GET /api/health` `ok: true` all four connectors `live`, CSP + HSTS present. Old app `kimchi-premium-clone` destroyed, so that hostname is gone.

### 2026-09-05 — Add DOGE

Coin universe is now BTC/ETH/XRP/SOL/DOT/DOGE. Markets: Upbit `KRW-DOGE`, Binance `dogeusdt`, Bitbank `doge_jpy` (mid). Unknown-market fixtures moved to ADA so they stay unknown. Live `/api/snapshot` on https://kimp.fly.dev/ includes DOGE (Upbit 118, Binance 0.08596, Bitbank mid 13.4445). Playwright E2E 16 passed; visual snapshots regenerated.

### 2026-09-05 — Handoff: next session closes 7.1 deploy

Refreshed "Currently working on" for a new session. Remaining work is Docker image evidence + Fly HTTPS deploy (already approved). Do not re-do CSP/runbook. 5.2 soak stays waived. Workflow: `docs/07` (Start now no longer treats 24 h soak as an automatic gate). Resume only in this file.

### 2026-09-05 — User waived 5.2 24 h soak; Tasks 7.1 (code) / 7.2 / 7.3

User said the 24 h soak is not required. 5.2 marked complete as waived (t0 had been sampled; 24 h not waited). 7.x started the same day.

**7.1:** CSP (`default-src 'self'`), nosniff, DENY framing, Referrer-Policy, Permissions-Policy; HSTS only if `ENABLE_HSTS=1`. Theme boot moved to `/theme-boot.js` so CSP needs no `unsafe-inline`. Env: `.env.example`, `BINANCE_WS_BASE_URL` / `BINANCE_REST_TICKER_URL`, `fly.toml` (nrt, force_https). Dockerfile HEALTHCHECK. Mutation: empty CSP header failed httpApi + securityHeaders tests; restored. Validation: lint/typecheck/test (server 217, web 94)/build/format:check green.

**Deploy not executed:** Docker daemon not running; `flyctl` not installed. User had approved a real production deploy.

**7.2:** ER-API footer tests remain; `/api/fx` 404 test; CSP blocks browser-side provider calls; nrt + public-API-only + no scolkg scrape recorded in `docs/08-runbook.md`.

**7.3:** `docs/08-runbook.md` — health probe, restart, watchlist including er-api `time_eol` surfaced on `connectors.fx.lastError`.

### 2026-09-05 — User approved real production deploy for 7.1

Recorded in "Currently working on": Fly.io/VM/production endpoint is allowed **after** Task 5.2 is checked off. 7.x still blocked on the 24 h soak (`t0` 2026-09-05T07:14:45.523Z). No deploy this session.

### 2026-09-05 — Tasks 6.1–6.3 complete (single agent); 5.2 t0 claimed, 24 h still open

**5.2 t0 attached** (not a leftover unsampled process): PID 16892 `PORT=3000 node dist/index.js`, `POST /api/dev/fault` → 404. Sample 2026-09-05T07:14:45.523Z: RSS 40528 KB; health ok, upbit/binance/bitbank live reconnects 0; BTC/ETH/SOL live both premiums; DOT upbit `down` premiums omitted; FX er-api fetchedAt 1788587970450 (~75 min age, no extra primary fetch). Sampler `scripts/soak-5.2.mjs` (PID 80789) → `logs/soak-5.2.jsonl`. **5.2 left unchecked** until t12h/t24h.

**6.1** Playwright mocked `routeWebSocket('**/ws')` + REST fixture: load, premium sort live-before-omit (`XRP ETH BTC SOL DOT`), theme persist (`kimchi-theme`), reconnect banner. Mutation: `showTransportBanner = false` → E2E + FxStatusBar unit test failed; restored.

**6.2** Full-page screenshots 320/768/1024/1440 × light/dark (`web/e2e/visual.spec.ts-snapshots/`, Arial forced). Snapshot path omits OS.

**6.3** axe no serious/critical both themes; keyboard coin/sort/theme; reduced-motion flash. Mutation: table `animation: none` → `premium-flash-up` made flash test fail; restored. Budgets: JS 53.27 KB gz / CSS 3.45 KB gz. Live Lighthouse snapshot a11y/best-practices 100; LCP **655 ms** on `:5173` (budget < 2.5 s). SEO 60 (no meta description) accepted LOW.

Also: tint 8%→4% + `--color-up` light 52% for 4.5:1 on tinted rows; debug `<pre tabIndex={0}>`; table scroll `role="region"`; theme-toggle contrast.

Validation: `pnpm lint`, `pnpm -r typecheck`, `pnpm -r test` (server 211, web 94), `pnpm -r build`, `pnpm format:check`, `pnpm --filter @kimchi/web test:e2e` (16 passed). CI now installs Chromium and runs e2e after build.

**Next:** close 5.2 after 24 h, then 7.1 (ask before real production deploy).

### 2026-09-05 — Handoff: next session runs remaining queue through 7.3

User asked to run multiple tasks / through the last task. "Currently working on" now lists **5.2 → 6.1–6.3 (after t0) → close 5.2 at 24 h → 7.1–7.3**. 6.1 depends on 4.x so QA can proceed during soak. 7.1 still needs 5.x+6.x; ask before a real production deploy. `docs/07` Start now / handoff wording updated to match (no stop-after-one-task). Resume still only in this file.

### 2026-09-05 — Handoff: next session starts Task 5.2

Refreshed "Currently working on" for a new session: 5.2 done-criteria (claim t0 in this file — leftover `:3000` process is not a sampled start; 24 h wall-clock; RSS; reconnects; Bitbank SOL/DOT honesty; no extra FX primary fetches), starting surfaces, out of scope (6.x / 7.x / `FAULT_INJECTION` on the soak process). 5.1 is complete. `docs/07-implementation-kickoff-prompt.md` is the executable workflow (no paste prompt). Resume lives only in this file's "Currently working on".

### 2026-09-05 — Task 5.1 complete (single agent)

Full-stack fault injection: kill/throttle each feed, malformed Upbit WS, 429s (mocked, no real FX budget burn), clock skew > 30 s. Stale still computes; down/missing omits (em dash).

- Runtime extracted to `server/src/aggregator/runtime.ts`. `index.ts` now has an entry-point guard (Task 3.2 watch item). `POST /api/dev/fault` only when `FAULT_INJECTION=1`.
- New tests: `server/test/hardening/faultInjection.test.ts` (11) + `web/src/components/faultInjectionRender.test.tsx` (4).
- Mutation: `isSkewExceeded` → `return false` made skew test expect `stale` get `live`. `if (statuses.some(down))` → `if (false && …)` made kill-Binance test receive a frozen Pair A premium instead of `undefined`. Restored; suite green.
- Live (`FAULT_INJECTION=1` on :3000, UI :5173, BTC):
  - Baseline: health all live; BTC premiums live.
  - Kill Binance T+17s: snapshot `binance=stale`, `premiumBinance=stale`, `premiumBitbank=live`. UI: hero `data-stale`, premium still `+1.37%`; Bitbank `+1.13%`; dots Binance down / Bitbank live.
  - Kill Binance T+62s: snapshot `binance=down`, `premiumBinance` omitted, `premiumBitbank=live`. UI: hero `data-omit`, premium `—`; Bitbank table still `1,212,711 (+1.13%)`.
  - Malformed Upbit: health `lastError` `Invalid JSON in Upbit WebSocket message`; process stayed up.
  - Skew (future target ts): BTC both legs `live`, both premiums `stale`.
  - Kill Bitbank T+32s: `bitbank=stale`, Pair B stale, Pair A live.
  - Kill Upbit T+16s: `upbit=stale`, both premiums stale.
  - Age FX 26 h+1 then 78 h+1 (no wall-clock wait): 78 h omitted both premiums. UI: USD/KRW `—`, FX dot `down`, hero `—`.
  - 429: Upbit REST + FX poller test doubles (`rate_limited` / `HTTP 429`); WS still connects after Upbit 429.
- Aggregator restarted **without** `FAULT_INJECTION` (`POST /api/dev/fault` → 404).
- Validation: `pnpm lint`, `pnpm -r typecheck`, `pnpm -r test` (server 211, web 94), `pnpm -r build`, `pnpm format:check`.

**LOW accepted:** `/api/health` maps a stopped connector to `down` immediately while snapshot tickers follow TTL; `age-fx` rewrites snapshot `fetchedAt` only (poller `lastSuccessfulFetchAt` stays fresh). DOT can yellow the Upbit dot during otherwise-live kills (Phase 2). Debug JSON panel still on the page.

**Task 5.1 marked complete.** Next: 5.2 24 h soak.

### 2026-09-05 — Handoff: next session starts Task 5.1

Refreshed "Currently working on" for a new session: 5.1 done-criteria (kill/throttle each feed, malformed, 429, skew; UI + health evidence), starting files, DOT-already-down caveat, FX 26 h not wall-clock, out of scope (5.2 soak / 6.x / 7.x). Phase 4 is complete (4.1–4.6). `docs/07-implementation-kickoff-prompt.md` is the executable workflow (no paste prompt). Resume lives only in this file's "Currently working on".

### 2026-09-05 — Task 4.6 complete (single agent)

Shared `formatMoney.ts`: KRW, USD, JPY, signed %, volume ×100M KRW (`/ 1e8`). Wired into `PremiumTable`, `FeaturedHero`, and `formatHeroPremium`. `formatFx.ts` unchanged (FX-bar digits).

- Mutation: volume divisor `/ 1e8` → `/ 1e6` made `128,942,127,870.82` render `128,942.13` instead of `1,289.42`; restored.
- Live Binance table volumes on :5173: BTC `1,289.42`, ETH `938.44`, XRP `1,921.27`, SOL `364.25`, DOT `13.85` (matches ×100M, not millions).
- Validation: `pnpm lint`, `pnpm -r typecheck`, `pnpm -r test` (server 200, web 90), `pnpm -r build`, `pnpm format:check`.

**LOW accepted:** table premium KRW diffs stay unsigned (hero diffs stay signed via `formatKrw(..., true)`).

**Task 4.6 marked complete. Phase 4 (Frontend UI) is fully done.** Next: 5.1.

### 2026-09-05 — Task 4.5 complete (single agent)

Featured hero + radiogroup coin switcher, collapsible method note, semantic footer with er-api ToS wording.

- Hero reuses `buildPremiumTableRows` / `rowOmitsPremium` (no second math path). Default BTC; switcher BTC ETH XRP SOL DOT (`role="radiogroup"`, arrows/Home/End). Missing/`down` premium is `—` (DOT live Upbit `down` showed `—`, never leftover `-0.26%`). Stale uses `--color-stale` + `last update Ns ago` (unit-tested on ETH fixture).
- Method note: Pair A/B formulas, FX `source` + `ratesDate`/`fetchedAt`, USDT≠USD caveat, doc links.
- Footer: **Rates By Exchange Rate API** when snapshot FX is `er-api`; frankfurter stays honest (no ER-API claim); Upbit/Binance/Bitbank public docs.
- Mutation: `if (rowOmitsPremium(row))` → `if (false && …)` made DOT render `-0.26% / KRW -260`; restored; tests failed as required.
- Live (:5173 + aggregator :3000): BTC Upbit KRW 108,867,000 ($80,702.58) / Binance $79,578.98 / **+1.41% / KRW +1,515,720**; Bitbank secondary +1.19%. Click ETH → hero +1.45% while both tables still listed all five coins. Click DOT → premium `—` (`data-omit=true`). Method note opened with `er-api` / `2026-09-05` / `fetched at 2026-09-05T05:03:33.971Z`. Footer link present.
- Validation: `pnpm lint`, `pnpm -r typecheck`, `pnpm -r test` (server 200, web 86), `pnpm -r build`, `pnpm format:check`. ctx history search was unavailable (index not set up).

**LOW accepted:** coin marks are colored circles, not full `cryptocurrency-icons` SVGs; debug JSON panel still on the page; USD uses `maximumFractionDigits: 2` (DOT $0.89 vs rounded $1); MCP viewport unchanged from 4.4.

**Task 4.5 marked complete.** Next: 4.6.

### 2026-09-05 — Handoff: next session starts Task 4.5

Updated "Currently working on" with 4.5 done-criteria, starting files (`App.tsx` placeholder hero; reuse `premiumTable.ts`), ToS attribution, and out-of-scope (4.6). `docs/07-implementation-kickoff-prompt.md` is the executable workflow (no paste prompt). Resume lives only in this file's "Currently working on".

### 2026-09-05 — Task 4.4 complete (single agent)

Shared `PremiumTable` for Binance and Bitbank: sort, stale/omit, flash CSS, mobile column collapse + chevron.

- `rowOmitsPremium` → em dash only (mutation: always `false` produced `— (—%)` instead of `—`). Live-before-stale premium sort mutation inverted rank → DOT/ETH bubbled first; restored.
- Live: both tables on :5173 with real snapshot. DOT omitted as `—` while Upbit was `down`; later DOT `stale` showed premium + `title="last update 55s ago"`. Clicked Premium ↓ — Binance order live-first (XRP/BTC/…/DOT last). Chevron visible at ~500px MCP viewport (480–767 band). Volume uses local `/ 1e8` until 4.6.
- Validation: `pnpm lint`, `pnpm -r typecheck`, `pnpm -r test` (server 200, web 72), `pnpm -r build`, `pnpm format:check`.

**LOW accepted:** still-screenshot did not capture flash; MCP not a true 320px; no coin icons yet (4.5/later); inline 100M volume not the 4.6 lib; hero placeholder remains for 4.5.

**Task 4.4 marked complete.** Next: 4.5.

### 2026-09-05 — Task 4.3 complete (single agent)

Sticky FX bar + feed dots + transport banner. Theme toggle moved into the bar.

- Derivation in `web/src/lib/feedStatus.ts`: exclusive 26h/78h FX ages locked to server `STALENESS_THRESHOLDS.fx`; missing FX → `down`; per-exchange worst-of five coins (missing ticker = `down`). DOT-down reddens that exchange only.
- Down daily FX omits USD/KRW and JPY/KRW (em dash); stale FX still shows numbers in `--color-stale`. USDT implied is separate (Upbit).
- Mutation: `>` → `>=` on FX boundaries → exact-threshold tests failed; missing-FX `down` → `live` → missing-FX test failed; inverted STATUS_RANK → DOT-down / worst-of tests failed. Restored; suite green.
- Live (Vite :5173 + aggregator :3000, real connectors): USD/KRW `1,349.0` + `er-api 09-05`, JPY/KRW `8.6387`, USDT/KRW implied; dots **Upbit down** (DOT upbit `down` as designed) / Binance live / Bitbank live / FX live; theme toggle `Dark mode` → `aria-checked` + `data-theme=dark`. Kill aggregator → banner "Reconnecting to the market feed…" and transport `RECONNECTING`; Binance worst-of went `stale` via DOT while Bitbank stayed `live`. Rates strip `scrollWidth` 513 vs `clientWidth` 113 with page `scrollWidth === clientWidth` (no document overflow). Chrome MCP `resize_page` did not change `innerWidth` from ~500px — overflow judged from those measurements, not a true 320 CSS px viewport. Favicon 404 ignored (LOW).
- Validation: `pnpm lint`, `pnpm -r typecheck`, `pnpm -r test` (server 200, web 63), `pnpm -r build`, `pnpm format:check`.

**LOW accepted:** MCP viewport stuck ~500px; 404 favicon; `data-missing` also styles stale FX (color is stale, not “current”).

**Task 4.3 marked complete.** Next: 4.4.

### 2026-09-05 — Handoff: next session starts Task 4.3

Updated "Currently working on" with 4.3 done-criteria, plan pointers, and out-of-scope (4.4–4.6). `docs/07-implementation-kickoff-prompt.md` resume line now says 4.2 is complete and 4.3 is next.

### 2026-09-05 — Task 4.2 close-out (single agent)

Closed H-1/H-2/M-1/M-2/M-3. Client wire contract unchanged; prior live WS/REST evidence still applies.

- **H-1:** backoff test now closes a fifth socket and advances only 8000ms (uncapped would be 16000ms). Mutation: remove `Math.min` cap → length 6 assertion failed (got 5). Restored.
- **H-2:** overlapping abort-ignoring REST (newest resolved first) plus WS-vs-late-REST; `drainMicrotasks` so late payloads reach `acceptSnapshot`. See adversarial review below — sequential REST was insufficient.
- **M-1:** `stop()` then `start()` accepts an older `updatedAt`. Mutation: delete `lastAcceptedUpdatedAt = -Infinity` in `start()` → waitFor older snapshot timed out. Restored.
- **M-2:** bidirectional `Exclude<...> extends never` so web `COIN_SYMBOLS` cannot drift from server `CoinSymbol` (type-only import; no Vite alias). Extra-coin typecheck fails (`true` not assignable to `never`).
- **M-3:** abort-ignoring fetch; `stop()` then resolve; `drainMicrotasks`. Mutation: delete both post-await `stopped` guards → `onSnapshot` called once. Restored. Abort-aware stop still rejects in `catch`.
- Validation: `pnpm lint`, `pnpm -r typecheck`, `pnpm -r test` (server 200, web 43), `pnpm -r build`, `pnpm format:check`.
- LOW L-1..L-3 and L1–L5 remain accepted.

**Task 4.2 marked complete.** Next: 4.3.

### 2026-09-05 — Task 4.2 adversarial review (blocking 0)

Round 1 blocking, then fixed:

- **H-2:** sequential REST did not keep three in-flight requests, and post-await `aborted` returned before `acceptSnapshot`, so abort-ignoring overlapping REST could not prove `lastAcceptedUpdatedAt`. Fix: post-await recheck is `stopped` only (abort-aware still returns in `catch`); three abort-ignoring pending fetches; resolve 3000 first, then 2000/1000. Mutation: delete monotonicity guard → both H-2 tests failed. Restored.
- **Parser:** `fx: []` passed `typeof === 'object'`. Reject arrays; test added.

Re-mutation after the fix: H-1 cap (expect 6 sockets, got 5); M-1 missing `-Infinity` reset; M-3 delete both post-await `stopped` guards → abort-ignoring stop test failed; M-2 extra `ADA` → `tsc` `true` not assignable to `never`. All restored.

Non-blocking: abort-aware overlapping REST still never reaches `acceptSnapshot` (reject-on-abort). LOW L-1..L-3 / L1–L5 unchanged.

Validation after review: `pnpm lint`, `pnpm -r typecheck`, `pnpm -r test` (server 200, web 43), `pnpm -r build`, `pnpm format:check`.

Prior four-role review notes for 4.2 (history, not a current blocker):

Review round 2 (fable, retired factory) — was NOT APPROVED because H-1/H-2 tests were vacuous and M-1..M-3 were untested; the close-out above is that work list.

Review round 1 findings (fable, used mutation testing + race reproduction, not just static read):

- **H1 (test vacuity)**: existing "cleanup" tests are tautological (assert 0 timers when 0 timers were ever pending); core behaviors — backoff 1s→2s→4s→...→30s cap+reset, `'polling'` vs `'reconnecting'` status distinction, `onerror` recovery path, fetch-failure resilience — have zero real test coverage despite 27/27 passing. Same failure mode as Task 2.1's wire-shape bug: green suite, untested behavior.
- **H2**: `parseMarketSnapshot` accepts `coins: {}` or `coins: []` as valid despite the `MarketSnapshot` type promising all 5 `CoinSymbol` keys present — downstream code (Task 4.3/4.4) indexing `snapshot.coins.BTC.upbit` would then throw on `undefined.upbit`. Not yet triggered (App.tsx only does `JSON.stringify` today) but is a ticking bug for the very next tasks. Later close-out: parser now rejects missing coin keys.
- **H3 (race, real)**: no monotonicity guard on accepted snapshots — a slower in-flight REST response can overwrite a newer WS-pushed snapshot (or vice versa on poll→live transition), since the server pushes a snapshot immediately on WS connect while the bootstrap REST fetch is also in flight. Reproduced via probe. No visible symptom yet, but will cause a visible "flash-back" bug once Task 4.4 adds price-change flash animations.
- **M1**: in-flight fetch has no post-await `stopped` recheck and no AbortController/timeout — stop()-during-fetch can still call `onSnapshot` once, and a hung server response leaves poll-interval fetches accumulating unbounded.
- **M2**: hook tests don't register `afterEach(cleanup)` / `vi.useRealTimers()` — RTL auto-cleanup is off (no `globals: true`), leaving unmounted renderHook instances and fake-timer state potentially leaking across tests (not yet causing failures, but fragile).
- **M3**: `resolveMarketEndpoints` (https→wss mapping) has zero direct tests.
- **L1–L5**: backoff reset should arguably happen on first live message not `onopen`; reconnect timer's `new WebSocketCtor()` throw isn't caught; `'connecting'` status emitted twice (harmless); hook's effect deps include function-identity props (safe today, caller passes none); mock `close()` firing `onclose` synchronously vs real browser's async (traced, no actual bug).
- Confirmed clean: wire-shape matches real server output exactly (both WS and REST), StrictMode double-mount doesn't create duplicate live connections, no unguarded `.parse()`-style throws, no `any` usage, Zustand store itself is correctly minimal/untested-by-design.

Task 4.2 connects the frontend to the live backend: a WS client hook consuming Task 3.2's `/ws` broadcaster, a Zustand store holding the current `MarketSnapshot`, and REST fallback polling against Task 3.1's `GET /api/snapshot` per docs/02's "on WS disconnect, poll every 5s until the socket recovers" design.

> Watch item (non-blocking, noted by Task 3.2's verification): `server/src/index.ts` runs `main()` unconditionally at module load with no `import.meta.url === process.argv[1]`-style entry guard — importing the module for testing/tooling purposes starts a second real server instance on the default port as a side effect. Worth a one-line guard whenever `index.ts` is next touched (e.g. Task 7.x).

> Watch item (closed by Task 3.1): the Task 0.2 note that the Dockerfile runtime stage copied no prod deps is obsolete — Task 3.1 added a fresh `prod-deps` stage (`pnpm install --prod`). Revisit only if that stage regresses.

### 2026-09-05 — Workflow change: single agent

- Retired the four-role factory (Implementation / Review / Review-fix / Verification with composer-2.5, fable, sonnet). Search/explore helpers remain allowed; same-session self-review is required.
- Per-task gate now includes TDD where `docs/05` requires it, a mutation check (new guard deleted => test fails), exact validation commands, and no I/O/UI complete without live evidence in this file.
- Kickoff prompt: `docs/07-implementation-kickoff-prompt.md` (workflow SoT). `docs/05-task-breakdown.md` "parallel agents" line is effort estimate only and points at 07.
- Task 4.2 remains in progress. Done-criteria: H-1, H-2, M-1, M-2, M-3 + mutation gate + validation. LOW L-1..L-3 and round-1 L1–L5 explicitly accepted (not silently dropped). Historical four-role entries below are unchanged.
- 2026-09-05 adversarial review of the first single-agent doc pass: NOT APPROVED (weak self-check, mixed resume signal, over-broad subagent ban, missing TDD/mutation, stale Dockerfile watch). Those findings are the edits in this log entry.

### 2026-08-16 — Orchestrator session start

- Read all docs 00-06 + kickoff prompt 07. Plan is approved (zero findings, round 5).
- Confirmed role/model mapping with user: composer-2.5 via Cursor CLI (`cursor-agent`) only;
  claude-fable-5 via Claude Agent tool (`model: fable`); verification via `model: sonnet`.
- Verified `cursor-agent --model composer-2.5 --print --force` works non-interactively.
- Created this PROGRESS.md. Starting task 0.1.

### 2026-08-16 — Task 0.1 implementation (round 1)

- pnpm workspace (`server/`, `web/`), shared `tsconfig.base.json` (strict), ESLint flat config, Prettier.
- Server: placeholder `src/index.ts`, planned subdirs (`connectors/`, `core/`, `transport/`), Vitest (`passWithNoTests`).
- Web: minimal Vite React-TS scaffold, planned subdirs + `e2e/`.
- Web Vitest deferred (format lib tests in 4.6, Playwright in 6.1); web `test` script is a no-op message.
- Verified by implementation agent: `pnpm install`, `pnpm -r typecheck`, `pnpm -r test`, `pnpm -r build`, `pnpm lint`. Git initialized on `main` (no commits yet).

### 2026-08-16 — Task 0.1 review round 1 (fable)

- 0 CRITICAL/HIGH. 2 MEDIUM: (a) `pnpm format:check` fails on 8 files (eslint.config.js, PROGRESS.md, docs/00-05); (b) `server/tsconfig.json` excludes `test/` from typecheck, so TDD test files never hit the strict TS gate.
- 3 LOW: web test script is a vacuous no-op with no explanation; no `packageManager` field pinning pnpm version; debug print left in placeholder `server/src/index.ts`.

### 2026-08-16 — Task 0.1 review-fix round 1 (composer-2.5)

- Added `docs/` to `.prettierignore` (frozen planning docs, not code); formatted `eslint.config.js` and `PROGRESS.md`; kept PROGRESS.md under Prettier (live doc, not ignored).
- Added `server/tsconfig.test.json` (src + test + vitest.config.ts, noEmit) and wired `typecheck` script to it; verified by injecting a deliberate type error into a test file, confirming typecheck failed, then removing it.
- web test script now logs an explicit `[no-op]` deferral message instead of silent no-op.
- Added `"packageManager": "pnpm@11.0.9"` to root package.json.
- Removed the debug print from `server/src/index.ts`, replaced with an empty `main()` placeholder.
- Re-verified: install/typecheck/test/build/lint/format:check all pass per the fix agent's own run.

### 2026-08-16 — Task 0.1 review round 2 (fable) — APPROVED, zero findings

- Independently re-verified all 5 review-fix claims against actual files + re-ran full validation suite.
- Empirically re-confirmed the test-typecheck gate works (injected a deliberate type error into server/test/, confirmed typecheck failed, removed it, tree left clean).

### 2026-08-16 — Task 0.1 verification (sonnet) — PASS

- Actually ran install/typecheck/test/build/lint/format:check — all green with real command output as evidence.
- Started server placeholder (`node server/dist/index.js`) — exits cleanly, no crash.
- Started Vite dev server, confirmed it serves real HTML on :5173, stopped cleanly.
- Confirmed directory structure matches docs/02-architecture.md plan.
- Informational: git initialized (`main` branch) but zero commits yet — not required by the Task 0.1 row, no action needed.
- **Task 0.1 marked complete.** Total round-trips: Implementation x1, Review x2 (1 with findings, 1 clean), Review-fix x1, Verification x1 (pass first try).

### 2026-08-16 — Task 0.2 implementation (composer-2.5)

- Added `.github/workflows/ci.yml` (single job: checkout, pnpm via packageManager field + Node 22, install --frozen-lockfile, lint, -r typecheck, -r test, -r build, format:check).
- Added root `Dockerfile` (multi-stage: deps -> build -> runtime, Node 22, non-root user) and `.dockerignore`.
- Docker daemon wasn't running in the implementation environment, so `docker build` itself was never executed there — flagged as an open gap for review/verification to close, not silently accepted.

### 2026-08-16 — Task 0.2 review round 1 (fable) — 0 CRITICAL/HIGH/MEDIUM

- Reviewer started the Docker daemon itself and actually ran `docker build` + `docker run`: non-root confirmed (uid 999), no devDependencies leaked into the runtime image, workspace manifest files copied before install (correct layer caching + resolution) — closed the Docker-unverified gap with real evidence.
- 4 LOW/INFO notes, none requiring a code change now (see watch item above re: Dockerfile + future prod deps; others were expected-behavior confirmations).

### 2026-08-16 — Task 0.2 verification (sonnet) — PASS

- Re-ran the full CI command sequence locally (install/lint/typecheck/test/build/format:check) — all exit 0.
- Ran a from-scratch `docker build --no-cache` (not just cached) — succeeded end-to-end.
- Ran the built image, confirmed clean exit (code 0), confirmed non-root (uid 999), confirmed no node_modules/devDependencies in the runtime layer, confirmed compiled server/dist + web/dist present.
- Cleaned up verify image and dangling containers afterward.
- **Task 0.2 marked complete. Phase 0 (Setup) is now fully done.** Round-trips: Implementation x1, Review x1 (clean, LOW/INFO only), Verification x1 (pass first try).

### 2026-08-16 — Task 1.1 implementation (composer-2.5)

- `server/src/core/symbols.ts`: COIN_SYMBOLS (BTC/ETH/XRP/SOL/DOT), per-exchange market-code maps (Upbit KRW-*, Binance lowercase *usdt, Bitbank *_jpy), TARGET_EXCHANGES (binance/bitbank). `satisfies Record<CoinSymbol, string>` gives compile-time scope guard in addition to the runtime test.
- `server/src/core/types.ts`: FeedStatus, TickerBase + UpbitTicker (extra change24hPct/volume24hKrw per docs/03's "v1 displays Upbit's change only"), BinanceTicker/BitbankTicker, Rate, Premium, MarketSnapshot — matches docs/02's verbatim Data Model block field-for-field.
- `server/src/core/schemas.ts`: zod schemas mirroring the types, kept separate from types.ts so pure functions (1.2/1.3) don't need to depend on zod. `MarketSnapshot.coins` schema built from COIN_SYMBOLS so all 5 keys are required at runtime.
- Tests: `server/test/core/symbols.test.ts` (4, scope-guard) + `server/test/core/schemas.test.ts` (24, valid+3-invalid per schema) — 28 total, TDD (written before implementation).
- Added `zod` as a server dependency.
- Design notes for 1.2/1.3: `Premium.inputTs.fx` holds just the FX fetch timestamp (not the whole Rate); `krwPerJpy` computed at snapshot-build time in 1.3; per-coin snapshot fields stay optional for down/omit handling.

### 2026-08-16 — Task 1.1 review round 1 (fable) — APPROVED, zero blocking findings

- Mutation-tested the scope guard directly (added a 6th coin, added a 3rd target exchange, confirmed the guard test fails each time, reverted).
- Ran 14 adversarial zod probes beyond the shipped tests: NaN/Infinity prices rejected, invalid FeedStatus strings rejected, a MarketSnapshot missing the DOT coin key rejected at runtime, unknown keys stripped, negative ts rejected.
- Confirmed field-for-field fidelity to docs/02's verbatim Data Model block; confirmed the Binance/Bitbank change24hPct omission correctly reflects docs/03's "v1 displays Upbit's change only" line.
- 2 optional LOW notes, explicitly non-blocking: (a) ticker price schema permits negative/zero price (asymmetric vs volume24hKrw's `.nonnegative()`); (b) the `Ticker` union type structurally collapses to `TickerBase` (cosmetic). Left as-is per reviewer's own "optional improvement" framing.

### 2026-08-16 — Task 1.1 verification (sonnet) — PASS

- Re-ran typecheck/test(28 passing)/lint/format/build — all green with real output.
- Grepped core/*.ts for I/O primitives (fetch/http/net/fs/ws/socket.io/axios) — zero matches, confirming pure/no-I/O.
- Independently re-derived the scope-guard result via a throwaway Vitest file (5 coins, 2 target exchanges, correct key sets) and the DOT-key-omission adversarial zod case (`safeParse` → `success: false`) — both reproduced independently, then cleaned up.
- Working tree left clean, no stray probe files.
- **Task 1.1 marked complete.** Round-trips: Implementation x1, Review x1 (clean), Verification x1 (pass first try).

### 2026-08-16 — Task 1.2 implementation (composer-2.5)

- `server/src/core/premium.ts`: `computeKrwPerJpy`, `computePremiumBinance`, `computePremiumBitbank` — pure functions, `Premium | null` return. `null` on missing/invalid FX, zero/near-zero denominator (`MIN_DENOMINATOR = 1e-9` applied to the post-multiplication KRW-equivalent, not the raw price), or a `down` input ticker. Non-live-non-down inputs still compute a value with `status: 'stale'`. `usdtKrwImplied` accepted as a parameter but never enters the Pair A math (docs/02's display-only decision, locked in by a test with an extreme divergent value).
- `computedAt` is caller-injected — no `Date.now()` inside, keeping functions pure.
- 14 new tests in `server/test/core/premium.test.ts` (42 total), covering all docs/05 Task 1.2 boundary cases.
- Caught and fixed an arithmetic error in the orchestrator's own task-prompt example fixture (conflated an Upbit USD-equivalent display figure with the actual Binance price); rebuilt the end-to-end fixtures from docs/03's actual verified 2026-08-16 values instead.

### 2026-08-16 — Task 1.2 review round 1 (fable)

- APPROVED with non-blocking notes. Independently re-derived both end-to-end fixtures bit-for-bit and confirmed the implementer's fixture correction was right (the original scolkg.com example only reconciles under its own live FX ~1,418.5, not er-api's 1,414.86).
- 3 LOW findings: Pair B's `inputTs.fx` dropped `usdJpy.fetchedAt` (only recorded `usdKrw.fetchedAt`); `computeKrwPerJpy`'s guard didn't reject negative `usdJpy`; tests lacked explicit NaN/Infinity/negative-FX cases. Plus 2 INFO notes (MIN_DENOMINATOR can't catch semantically-nonsensical-but-technically-valid extreme inputs; Task 1.3 must independently own FX age-based stale/down since `Rate` has no `status` field).
- Orchestrator decision: ran a review-fix round on the 3 LOW items given Task 1.3 builds directly on this code (cheap now, expensive to unwind later).

### 2026-08-16 — Task 1.2 review-fix round 1 (composer-2.5)

- Pair B's `inputTs.fx` now uses `Math.min(usdKrw.fetchedAt, usdJpy.fetchedAt)` (the older/more conservative of the two FX inputs actually used).
- `computeKrwPerJpy`'s guard now rejects non-positive/non-finite `usdJpy` and `usdKrw` (previously only had a near-zero-magnitude check that let negatives through).
- +5 tests (42→47; premium.test.ts 14→19) covering NaN/Infinity/negative FX directly.

### 2026-08-16 — Task 1.2 review round 2 (fable) — APPROVED, zero findings

- Independently proved the `Math.min` timestamp fix and the negative-FX rejection via live probes in both directions; confirmed 47/19 test counts; confirmed the `fxForInputTs` spread object doesn't leak corrupted fields downstream (module-private `buildPremium` only ever reads `.fetchedAt` off it).

### 2026-08-16 — Task 1.2 verification (sonnet) — PASS

- Re-ran the full pipeline (typecheck/test/lint/format/build) — all green, 47 tests (19 in premium.test.ts).
- Independently reproduced both fixtures bit-for-bit by calling the real functions from a throwaway script (not re-deriving by hand only).
- Independently re-confirmed all guard behaviors (missing FX, zero price, negative FX) and the min-timestamp fix in both directions via live calls.
- Confirmed zero `Math.round`/`.toFixed(` in premium.ts. Cleaned up scratch files.
- **Task 1.2 marked complete.** Round-trips: Implementation x1, Review x2 (1 with LOW findings, 1 clean), Review-fix x1, Verification x1 (pass first try).

### 2026-08-16 — Task 1.3 implementation (composer-2.5)

- New `server/src/core/snapshot.ts`: `STALENESS_THRESHOLDS` (upbit 15s/60s, binance 15s/60s, bitbank 30s/120s, fx 26h/78h, cross-exchange skew 30s — all cross-checked against docs/02's table), `deriveFeedStatus(tickTs, now, staleAfterMs, downAfterMs)` (exclusive boundaries), `createEmptySnapshot(now)`, `mergeTicker`, `mergeFxRate`.
- Resolved the open Task-1.2-flagged contract question: FX down (>78h) → pass `undefined` to premium.ts so it self-omits the premium; FX stale (26h-78h, not down) → compute normally, then downgrade the resulting `Premium.status` to `'stale'` if premium.ts returned `'live'`.
- Cross-task change to already-approved Task 1.1 code: `MarketSnapshot.fx.krwPerJpy` changed from required `number` to optional in `types.ts`/`schemas.ts`, to represent missing-FX-input without a sentinel value.
- `Ticker.status` is overwritten at merge time with the age-derived value (raw status passed by a future connector is not preserved).
- 62 tests total (34 new in snapshot.test.ts).

### 2026-08-16 — Task 1.3 review round 1 (fable)

- No Task 1.1 regression: all 48 pre-existing tests re-run individually and pass; scope-guard and zod-boundary tests confirmed to retain original intent (krwPerJpy is the only field loosened, not a broader over-relaxation).
- Threshold arithmetic, exclusive-boundary semantics, immutability (including nested objects), FX-down-omit, FX-stale-downgrade, and independent Pair A/B skew — all independently verified via executed probes.
- 1 MEDIUM finding: no pure "recompute at read time" API. If every feed for a coin goes silent simultaneously, no further merge call ever happens, so status/premium freeze at stale last-merge values instead of decaying to stale/down by wall-clock age — a direct violation of docs/02's staleness invariant. Task 3.2's 1Hz broadcaster needs a way to re-derive status from elapsed time alone.
- 1 optional LOW: add a clarifying comment on the skew-while-both-live edge case.
- Orchestrator decision: ran a review-fix round given this is a correctness gap in the core invariant, not a cosmetic note.

### 2026-08-16 — Task 1.3 review-fix round 1 (composer-2.5)

- Added `recomputeSnapshot(snapshot, now)`: pure, immutable, re-derives every ticker/FX status, both pairs' skew, and all 5 premiums from elapsed time alone (no merge needed).
- Refactored `mergeTicker`/`mergeFxRate` to call `recomputeSnapshot` internally after applying their update — single code path for "derive + recompute," eliminating merge-time-vs-read-time logic drift risk.
- +3 tests (62→65; snapshot.test.ts 14→17): decay-without-merge bug-fix proof, idempotence (safe to call every second in a broadcast loop), immutability.
- Added the LOW clarifying comment on the skew check.

### 2026-08-16 — Task 1.3 review round 2 (fable) — APPROVED, zero findings

- Independently re-executed the decay-without-merge fix end-to-end (live data at T, `recomputeSnapshot` at T+61s with no merge call, confirmed down status + omitted premium), idempotence, and immutability via live probes.
- Confirmed `mergeTicker`/`mergeFxRate` and `recomputeSnapshot` genuinely share one code path (no duplicated logic).
- Full Phase 1 sanity pass across all 5 core files: no TODOs, no leftover gaps, clean for Phase 2 connectors to consume.

### 2026-08-16 — Task 1.3 verification (sonnet) — PASS

- Re-ran typecheck/test(65 passing)/lint/format/build — all green.
- Independently reproduced the core fix end-to-end via a throwaway script calling the real exported functions: live data at T → down status + omitted premium at T+61s with no merge.
- Independently re-confirmed immutability (including nested object references), FX-stale downgrade (30h old FX → `'stale'` not `'live'`), and FX-down omission (80h old FX → premium absent).
- Confirmed zero `Date.now()` in snapshot.ts.
- **Task 1.3 marked complete. Phase 1 (Core Data Layer) is now fully done.** Round-trips: Implementation x1, Review x2 (1 with a MEDIUM finding, 1 clean), Review-fix x1, Verification x1 (pass first try).

### 2026-08-16 — Task 2.1 (Upbit WS connector) — full history

Phase 2 (Exchange & FX Connectors) begins here — first task involving real I/O. Prompt mandated a clean split: pure normalizer (zero I/O, fixture-tested) vs. I/O wiring layer (WS lifecycle, DI-injectable `WebSocketCtor`/`fetchFn` for testing without real network calls). Adds `ws`/`@types/ws` as the server's first real runtime dependency — exactly the scenario the Task 0.2 Dockerfile watch item warned about; not fixed here, deferred to 3.1/7.1.

**Implementation round 1 (composer-2.5):** `server/src/connectors/{upbit,upbitSchemas}.ts` (pure normalizer + `UpbitConnector` I/O class), fixtures captured from a real live REST call, 19 new tests (84 total).

**Review round 1 (fable) — NOT approved: 1 HIGH + 2 MEDIUM + 2 LOW.**

- HIGH: `normalizeUpbitWireTicker`'s "no throw" contract was violated — the wire zod schema didn't reject negative `acc_trade_price_24h` but the internal `upbitTickerSchema` did, so a message with negative volume passed wire validation then threw a ZodError inside `.parse()`, escaping the try/catch in `handleMessage` (only the raw-payload parse step was wrapped) — a real process-crash bug, proven via probe.
- MEDIUM 1: `ws`'s real error→close event pairing double-fired `handleDisconnect` (no idempotency guard), double-counting `reconnectAttempts` and skipping a backoff step (1 failure → attempts=2, first reconnect at 2s not 1s; sequence became 2s/8s/30s instead of docs/02's 1/2/4/8/16/30s).
- MEDIUM 2 (non-blocking): a REST-bootstrap failure (e.g. one 429) permanently prevented `start()` from ever opening the WS connection.
- 2 LOW: `reconnectAttempts` never reset on successful `'open'`; pong-liveness gap (self-reported, judged an acceptable v1 gap given `lastTickAt`-based staleness compensates).

**Review-fix round 1 (composer-2.5):** HIGH fixed via `.safeParse()` + widened try/catch around the full parse+normalize pipeline in `handleMessage`. MEDIUM 1 fixed via a `ws !== this.ws` staleness guard in both `error`/`close` handlers. MEDIUM 2 fixed by making REST bootstrap failures (429/reject/bad-JSON) non-fatal. +5 tests (84→89).

**Review round 2 (fable):** all 3 fixes independently confirmed real via own probes, but found 1 residual MEDIUM of the same failure class — `bootstrapFromRest`'s non-ok-response branch read `response.text()` unguarded; if that await rejected, `start()` still rejected and WS was never attempted.

**Review-fix round 2 (composer-2.5):** wrapped `response.text()` in try/catch, classified via `classifyUpbitHttpError(status, '')`, recorded `lastError` without throwing. +1 test (89→90).

**Review round 3 (fable) — APPROVED, zero findings.** Independently probed 429/503 `.text()`-reject cases, confirmed all 3 REST-failure paths are now non-fatal, re-confirmed no regression on earlier fixes. 90/90 tests green.

**Verification (sonnet) — FAIL.** REST bootstrap worked against the real API (5 coins + USDT, plausible prices). But the real WS stream was 100% broken: **Upbit's live ticker payload identifies the market via field `code`, not `market`** — `market` only appears on the REST response shape. `upbitWireTickerSchema` required `market`, so every real WS tick was rejected as `malformed_payload` (60+ consecutive real rejections observed over 20s; `getHealth()` falsely reported `status: 'connected'` while `lastTickAt` never advanced past the REST-bootstrap value). All 90 mocked unit tests passed because the fake WS messages in the test suite also used `market` (mirroring REST shape) — never exercising the real WS wire shape. Per the orchestrator loop, a verification failure goes back to Implementation, not Review-fix.

**Implementation round 2 (composer-2.5):** `upbitWireTickerSchema` now accepts optional `market` OR `code` (refine requires at least one); new `resolveUpbitWireMarketCode()` helper (`wire.market ?? wire.code`); wired through normalizer + `classifyUpbitParseFailure`; split fixture builders (REST uses `market`, new `buildUpbitWsTickerFixture()` uses `code`, no `market`) so this divergence can't silently recur. +2 tests (90→92). Implementer's own live smoke test: all 6 markets normalizing correctly (40 messages/20s, zero malformed, lastTickAt advancing).

**Review round 1-after-fix (fable) — APPROVED, zero findings**, via its OWN independent live-network smoke test (24 coin ticks across all 5 coins + 10 USDT rates in 20s, zero malformed, lastTickAt advancing; live REST bootstrap re-confirmed; neither-market-nor-code payload still correctly rejected). Flagged a lesson for Tasks 2.2/2.3: capture a live raw WS sample BEFORE writing fixtures, don't derive WS fixtures from REST samples — Binance's WS uses abbreviated keys (`s`/`c`/`P`) vs REST's full keys, a bigger divergence than Upbit's market/code gap.

**Verification re-run (sonnet) — PASS.** Own fresh independent live WS test: 5/5 coins ticked, USDT rate received, zero malformed, `lastTickAt` genuinely advancing across the observation window. Own live REST bootstrap re-confirmed. Neither-field payload still rejected (no regression from the fix).

**Task 2.1 marked complete.** Round-trips: Implementation x2 (round 2 triggered by a verification failure), Review x4 (2 with findings, 2 clean), Review-fix x2, Verification x2 (1 fail, 1 pass). This is the most round-trips of any task so far, and the first real-world bug that automated mocked tests could not catch — validates the orchestrator's requirement that Verification always exercises the real system, not just the test suite.

### 2026-08-16 — Task 2.2 (Binance WS connector) — full history

Prompt proactively required: live-capturing real REST + WS samples FIRST (before writing any fixtures/normalizer), and applying all 3 lessons from Task 2.1's findings from day one (`.safeParse()` never `.parse()`, active-socket staleness guard against error+close double-firing, REST-bootstrap-failure-must-never-block-WS-connect), plus the implementer's own live smoke test before declaring done.

**Implementation round 1 (composer-2.5):** live capture confirmed docs/03's WS wrapper shape (`{"stream":...,"data":{...}}`) and revealed price fields are JSON strings on the wire — both REST `lastPrice` and WS `c/o/h/l/v/q` — normalizer parses these to numbers. All 3 Task 2.1 lessons applied proactively. 24h scheduled reconnect via a named constant (`BINANCE_MAX_CONNECTION_LIFETIME_MS`) + fake-timer test, distinct from the failure-driven backoff reconnect (doesn't increment `reconnectAttempts`). Own live smoke test: 36 messages/15s, all 5 coins ticked with plausible prices. 120 tests total (92→120).

**Review round 1 (fable) — APPROVED, zero blocking findings, 1 non-blocking LOW** (error-path socket cleanup relies on `ws` always emitting `close` after `error` rather than explicit `close()`/`removeAllListeners()` — confirmed safe via probe, defensive-only suggestion, not fixed). Independently re-captured live REST/WS wire shapes (matched fixtures field-for-field), re-probed all 3 proactively-applied lessons, the 24h reconnect via fake timers, 9 adversarial malformed-message cases, and ran its own live smoke test (50 messages/18s, all 5 coins). Confirmed a `format:check` failure the implementer saw was pre-existing PROGRESS.md trailing-newline noise from orchestrator concurrent edits, not this task's fault.

**Verification (sonnet) — PASS.** Own independent live WS smoke test: REST bootstrap returned real numeric (not string) prices for all 5 coins; ~18s of live WS observation ticked all 5 coins repeatedly with prices moving plausibly tick-to-tick, `lastTickAt` advancing, zero malformed rejections. Confirmed the 24h reconnect mechanism is real (named constant, fake-timer test genuinely exercises the boundary just before/at the threshold, distinct from the error-backoff path).

**Task 2.2 marked complete.** Round-trips: Implementation x1, Review x1 (clean, 1 non-blocking LOW), Verification x1 (pass first try) — proactively applying Task 2.1's lessons from day one cut this task's round-trips from 2.1's 9 total (2 impl + 4 review + 2 fix + 2 verify) down to 3.

### 2026-08-16 — Task 2.3 (Bitbank Socket.IO connector) — full history

**Implementation round 1 (composer-2.5):** live investigation confirmed the subscription mechanism (`join-room` event, room names `ticker_{pair}` + `circuit_break_info_{pair}`), confirmed REST/WS data shape is identical (string numerics, differ only in envelope/pair-field presence), found and wired in circuit-break detection via both the WS room and a REST `spot/status` check (a docs/03-flagged unknown, resolved live). One-sided/crossed-book detection via `evaluateBitbankBook()`. Custom backoff (Socket.IO's built-in reconnect disabled). Own live smoke test: all 5 pairs ticked within ~4s. 149 tests (120→149).

**Review round 1 (fable) — NOT approved: 1 HIGH + 1 MEDIUM + 4 LOW.**

- HIGH: live `/tickers` (62 rows) contains pairs with null bid/ask (thin/no-book pairs like `mkr_jpy`); `bitbankRestTickersResponseSchema` validated the ENTIRE array in one `safeParse` with non-nullable `buy`/`sell`, so ANY row with a null quote failed the whole batch parse → `normalizeBitbankRestTickersResponse` silently returned `{tickers: []}` → REST bootstrap emitted ZERO tickers in production, with no error/callback (asymptomatic failure) — same failure class as Task 2.1's bug. The 5-target-pair filter happened AFTER validation, which was the structural cause; the implementer's own live smoke test only "passed" because it was entirely WS-driven, masking the dead REST path.
- MEDIUM: a real one-sided pair's null bid/ask would also arrive via WS with the same null shape, but the wire schema rejected it as `malformed_payload` instead of routing to the `one_sided`/`onBookUnusable` path.
- 4 LOW: inaccurate claim about reusing `STALENESS_THRESHOLDS` (staleness is entirely downstream in `mergeTicker`, same as Upbit/Binance — wording issue, not a defect); unused exported `bitbankRestCircuitBreakResponseSchema`; docs/03's `down`-on-book-issue contract only partially met (a future aggregator task must consume `onBookUnusable`); `/spot/status` shares the same whole-array-validation pattern (works today, same latent risk, left as a disclosed judgment call).

**Review-fix round 1 (composer-2.5):** filter-then-per-row-validate for REST `/tickers` (envelope-only validation first, filter to 5 target pairs by name, then individual `safeParse` per row so one bad/irrelevant row can't poison the batch); null buy/sell now accepted at the wire-schema level and routed to `evaluateBitbankBook()`'s one-sided path (both REST and WS). +7 tests (150→157). Own live re-check: real `/tickers` has 62 pairs, 18 with null quotes — fixed normalizer now correctly returns exactly 5 target tickers with plausible prices (previously 0).

**Review round 2 (fable) — APPROVED, zero blocking findings, 2 informational observations** (REST bootstrap silently drops one-sided rows rather than routing to a callback like WS does — not a real problem since WS resolves it shortly after; a null+garbage-string quote combo classifies as `one_sided` rather than `malformed`, harmless since no price is ever emitted either way). Independently re-fetched live `/tickers` and confirmed the fix against real data, confirmed per-row validation genuinely isolates a malformed row from its siblings via own probe, confirmed `/spot/status`'s un-fixed same-pattern risk is currently dormant.

**Verification (sonnet) — PASS.** Own independent live REST check: 62 pairs, 18 with null quotes, fixed normalizer returned exactly 5 tickers with plausible JPY prices. Own live Socket.IO smoke test: ~18s observation, BTC/ETH/XRP/SOL all ticked ≥20 times, DOT 6 times (quieter but live, not forced), zero malformed messages, `lastTickAt` advancing. Synthetic probes confirmed null-quote → `one_sided` and crossed-book → `crossed`, both correctly routed to `book_unusable` rather than dropped/misclassified.

**Task 2.3 marked complete. Phase 2's third and final target-exchange connector is done.** Round-trips: Implementation x1, Review x2 (1 with a real HIGH prod bug, 1 clean), Review-fix x1, Verification x1 (pass first try). This is the second task (after 2.1) where a live-network check caught a genuine production bug that all mocked unit tests missed — reinforces that connector tasks specifically need real-network verification, not just green test suites.

### 2026-08-17 — Task 2.4 (FX poller) — full history

**Implementation round 1 (composer-2.5):** live capture found docs/03 said `time_eol` but the real field is `time_eol_unix` (numeric, 0 = no deprecation pending) — a docs-vs-reality gap of the same kind that caused real bugs in 2.1/2.3. Budget logic: startup fetch (1) + 5s-later cross-check (2), next primary at max(time_next_update_utc, now+23h), 429 retries after 20min, hard cap 4/UTC-day. Divergence >2% on either KRW/JPY sets status stale. 180 tests (157→180).

**Review round 1 (fable) — NOT approved: 1 HIGH + 1 LOW.**

- HIGH: the daily fetch-budget cap's UTC-day rollover reset lived only inside `recordFetch()`, which only runs AFTER `canFetch()` already allowed the call through — so once `fetchCountToday` hit 4 (an ordinary day per docs/03's own example: 429→fallback→retry→cross-check), `canFetch()` permanently blocked every future call and the rollover code could never execute again. Proven via probe: zero fetches over the following 3 simulated days after hitting the cap once — required a process restart to recover.
- LOW: a cross-check-only failure (primary fine, Frankfurter hiccup) incorrectly degraded health to `'stale'` for ~23h even though fresh valid primary data existed — docs/03 only specifies `'stale'` for >2% divergence or BOTH providers failing.
- All other claims (live wire shapes incl. the `time_eol_unix` vs docs' `time_eol` naming gap, divergence boundary at exactly >2%, all 4 fallback failure modes, no raw-rate redistribution, last-good retention, no threshold duplication) independently verified correct.

**Review-fix round 1 (composer-2.5):** new `maybeResetDailyFetchCount()` called at 3 sites (`canFetch()`, `getHealth()`, `recordFetch()`) so the UTC-day rollover is checked on every access, not just inside the gated `recordFetch()` path. New `setCrossCheckUnavailable()` records cross-check failures in `lastError` without degrading `status` to stale. +3 tests (180→183).

**Review round 2 (fable) — APPROVED, zero code findings.** Independently traced the fix (runs before the cap check, not gated behind it); own fake-timer probe with strong per-day assertions (4 consecutive days, each independently confirmed to have fetches occur, not just count≤4) confirmed the starvation fix holds; confirmed `getHealth()` alone triggers the rollover too; confirmed the LOW fix doesn't silence real stale triggers. Only finding was a `format:check` failure in PROGRESS.md itself (orchestrator's file, fixed directly).

**Verification (sonnet) — PASS.** Own live check against both real providers through the actual normalizer (KRW ~1415/1411, JPY ~159.2/159.0, correct source/ratesDate tags). Own fake-timer regression probe went further than the shipped tests: asserted the real mock call count strictly increases each new day (not just count≤4), then deliberately reintroduced the original bug to confirm the test would have caught it (it failed as expected), then restored the fix and re-confirmed green — the strongest possible confirmation that this regression test has teeth. Confirmed the LOW fix doesn't silence real divergence/both-fail stale triggers.

**Task 2.4 marked complete. Phase 2's connector tasks (2.1-2.4) are all done** — only the Phase 2 risk checkpoint remains before Phase 3. Round-trips: Implementation x1, Review x2 (1 with a real HIGH bug, 1 clean), Review-fix x1, Verification x1 (pass first try). This is the third of four Phase 2 tasks where live-network verification caught a genuine bug mocked tests missed (2.1, 2.3, 2.4 — only 2.2 was clean on the first pass, after applying the accumulated lessons proactively).

### 2026-08-17 — Phase 2 risk checkpoint: 1-hour live multi-connector run

Ran all 3 exchange connectors (real `ws`/`socket.io-client`, no mocks) simultaneously for a full 60 minutes (06:35:43–07:35:43 UTC), subscribing to all 5 coins each, per docs/05's explicit checkpoint requirement. This is the longest and first multi-connector-concurrent live check in the project.

**Connection stability: clean.** Zero reconnects, zero errors, zero malformed messages, zero Bitbank book-unusable events across all three connectors for the full hour. Memory stayed stable/trended down (no leak symptom).

**Tick rates / gap data (actual, from the collected summary):**

- Upbit: BTC/ETH/XRP/SOL ticked normally (avg gaps 1.2s–3.8s, well within the 15s stale threshold). **DOT ticked only 55 times in 60 minutes — avg gap 62.6s, MAX GAP 762,893ms (12.7 minutes)** — far beyond Upbit's own 60s down threshold.
- Binance: BTC/ETH/XRP/SOL fine (avg gaps 1.1s–2.7s, within the 15s stale threshold, miniTicker's 1s cadence holding). **DOT: avg gap 11.5s, MAX GAP 101,000ms (101s)** — exceeds Binance's 60s down threshold.
- Bitbank: BTC/ETH/XRP/SOL all healthy (tick gaps ~1s avg, spreads 0.06%-0.25% avg, well within the 30s stale threshold). DOT: avg gap 1.14s (fine on average) but spread averaged **0.25%, ~100x wider than BTC's 0.0025%**, with an occasional 32.3s max gap slightly over the 30s stale threshold.

**Finding: DOT has genuinely thin liquidity across ALL THREE exchanges, not just Bitbank.** This contradicts docs/02-architecture.md's price-basis table claim that "Upbit: trade_price — Deep KRW books; last trade is fresh for all 5 coins" — that assumption does not hold for DOT specifically, based on this hour of real observation.

**Resolution (minimal, per the orchestrator's mandate not to re-open the architecture over a documented contradiction):** No code change is needed. The staleness invariant built in Task 1.3 (`recomputeSnapshot`, age-based `live`/`stale`/`down` transitions, premium omission on `down`) is EXACTLY the mechanism designed to handle this honestly — when DOT's Upbit or Binance feed goes quiet for 60-100+ seconds, the system will correctly transition it to `down` and omit the DOT premium rather than showing a stale number as current. This was verified as working correctly in Task 1.3's own tests and the connector verifications. The checkpoint's job ("confirm thresholds, don't re-open the choice" per docs/05) is satisfied: the thresholds are doing their job — DOT will just visibly be `stale`/`down` more often than the other 4 coins in the live UI, which is correct, honest behavior, not a bug.

**Verdict: CONCERN (operational note, not a blocker).** Flagging for Phase 4 (UI) and Phase 6 (QA) awareness: DOT will likely show stale/omitted premium noticeably more often than BTC/ETH/XRP/SOL in normal operation — this is expected given real DOT liquidity on Upbit/Binance, not a connector defect. No task is being reopened or blocked by this; it's forward context for whoever builds/tests the UI's stale-state styling (task 4.4) to make sure it looks correct/acceptable when DOT is showing that state often.

Raw checkpoint data preserved (implementer's judgment call) — not present in the repo since it was written under `server/scripts/` and cleaned up per the throwaway-script convention; the numbers above are transcribed from the collected summary before cleanup.

**Phase 2 (Exchange & FX Connectors) is now fully complete**, including its risk checkpoint. Moving to Phase 3 (Aggregator Service).

### 2026-08-17 — Task 3.1 (Fastify aggregator app) — full history

First task where all 4 connectors and `core/snapshot.ts`'s merge/staleness logic run together in one real Node process for the first time.

**Implementation round 1 (composer-2.5):** new `server/src/transport/{httpApi,health}.ts` (pure, testable via `fastify.inject()` with injected fake providers), `server/src/aggregator/state.ts` (snapshot store, `getSnapshot()` calls `recomputeSnapshot(snapshot, Date.now())` at read time per Task 1.3's contract), new `server/src/index.ts` entry point (constructs+starts all 4 connectors, wires callbacks to merge functions, builds the Fastify app, PORT/STATIC_ROOT env vars, SIGINT/SIGTERM graceful shutdown). Dockerfile updated with a `prod-deps` stage (the Task 0.2 watch item, now due since server has real runtime deps). Live-verified locally and via Docker. 190 tests (183→190).

**Review round 1 (fable) — NOT approved: 1 HIGH + 1 MEDIUM + 2 LOW.**

- HIGH: the Dockerfile's `prod-deps` stage inherited the fully-installed `deps` stage then ran `pnpm install --prod`, which only re-links top-level manifests without purging orphaned dev packages from pnpm's `.pnpm` virtual store — runtime image leaked typescript/vitest/eslint/prettier (290 packages, 136MB, 376MB total image). Regressed the exact devDependency-leak hygiene Task 0.2 had carefully verified.
- MEDIUM: read-time staleness decay (the safety-critical guarantee of this task) worked correctly (reviewer independently verified live→stale→down decay + premium omission via fake timers) but had no permanent regression test in the shipped suite.
- 2 LOW: stale Dockerfile header comment; SPA fallback returns 200+index.html for missing asset-like paths (standard tradeoff, noted only).
- All core functional claims (recompute-at-read-time, health ok-rule, route-shadowing, SPA fallback, sync-merge race safety, graceful shutdown, Docker Cannot-find-module absence, fail-fast startup) independently verified correct.

**Review-fix round 1 (composer-2.5):** `prod-deps` stage rebuilt as a fresh `node:22-bookworm-slim` stage (manifests-only copy + clean `pnpm install --prod`, never installing dev deps in the first place) instead of inheriting the fully-installed `deps` stage — image 376MB→290MB, `.pnpm` packages 290→99, typescript/vitest/eslint/prettier confirmed absent. New `server/test/aggregator/state.test.ts` regression test for read-time staleness decay (fake timers, references the real exported `STALENESS_THRESHOLDS`). +1 test (190→191).

**Review round 2 (fable) — APPROVED, zero findings.** Independent no-cache Docker rebuild confirmed 290MB/99 packages/no dev deps and the app still works correctly. Mutation-tested the new regression test by temporarily removing the `recomputeSnapshot` call — test caught it — then restored and confirmed shasum-identical + green.

**Verification (sonnet) — PASS.** Own live local-server check: real curl evidence including **DOT's upbit feed showing `down` with `premiumBinance`/`premiumBitbank` correctly omitted in live production traffic** — direct confirmation that the Phase 2 checkpoint's DOT-liquidity concern is handled exactly as designed (honest staleness, not a bug). SOL showed the intermediate `stale` state too. Confirmed API routes aren't shadowed by static serving, SPA fallback works, graceful SIGTERM shutdown is clean. Own independent Docker rebuild re-confirmed 290MB image with devDependencies absent. Own mutation test (breaking `core/premium.ts`'s down-guard) confirmed the staleness regression tests have real teeth.

**Task 3.1 marked complete. This is the first task where the entire system ran together as one real process, live-verified end-to-end.** Round-trips: Implementation x1, Review x2 (1 with a real HIGH Docker regression + MEDIUM test gap, 1 clean), Review-fix x1, Verification x1 (pass first try).

### 2026-08-17/18 — Task 3.2 (WS broadcaster) — full history

Last Aggregator Service task, completing Phase 3.

**Implementation round 1 (composer-2.5):** new `server/src/transport/wsServer.ts` (`createWsBroadcaster` — shared 1Hz timer, single serialization fan-out to all clients, immediate push on connect, backpressure handling via `bufferedAmount`/64KB disconnect threshold; `registerWsBroadcaster` wires `@fastify/websocket` + `/ws` into the Task 3.1 Fastify app). 195 tests (191→195). Notably, the implementer's own final report was unusually terse (no design writeup, no live-verification evidence) — the orchestrator independently ran the full validation suite and flagged a plausible starvation bug to Review before proceeding, given the lack of a normal detailed report to cross-check.

**Review round 1 (fable) — NOT approved: 1 MEDIUM + 1 LOW.**

- MEDIUM (confirmed the flagged concern): sends only happen when `bufferedAmount === 0`, so the buffer can never exceed one payload (~3.2KB live) — meaning the `bufferedAmount > 64KB → disconnect` branch was unreachable dead code. Proven via probe: a client stuck at a small nonzero `bufferedAmount` received zero pushes over 3600 simulated ticks (~1hr) and was never disconnected — permanent silent starvation with a zombie client-set entry.
- LOW: lifecycle edge-case test gaps (error-only cleanup, timer stop/restart across a zero-client gap, the 64KB path) — all confirmed working via reviewer probes, just no permanent regression test.
- All 5 required task-row scenarios were confirmed covered by the 4 shipped tests. Live 1Hz cadence independently verified by the reviewer against real connectors.

**Review-fix round 1 (composer-2.5):** `WS_MAX_CONSECUTIVE_SKIPS = 30` + per-client `WeakMap<WebSocket, number>` skip counter — disconnects a client after 30 consecutive skipped ticks (~30s at 1Hz), resets on any successful send; existing 64KB immediate-disconnect path preserved via a shared helper. +5 tests (195→200).

**Review round 2 (fable, retried once after an API session-limit interruption mid-review) — APPROVED, zero findings.** Independently probed the exact disconnect boundary (fires on the 30th consecutive skip specifically, not 29th/31st), confirmed the reset-on-recovery path, confirmed the 64KB path survived the refactor, verified all 5 new tests are genuine. Also found and cleaned up a leftover probe file from the interrupted first review attempt.

**Verification (sonnet) — PASS.** Own live WS check: real aggregator + real WS client, immediate push on connect, ~1000ms cadence over 6 pushes with real BTC/binance price changes, payload shape matched `GET /api/snapshot` exactly. Own independent reproduction of the starvation fix (disconnects at the 30th skip, not before) and the 64KB path. Own reproduction of coalescing (multiple rapid changes within 1s → exactly one push per client reflecting the latest value) and shared-serialization (two simultaneous clients receive byte-identical payloads). Noted (non-blocking): `server/src/index.ts` runs `main()` unconditionally on module load with no entry-point guard, so importing it for any purpose (e.g. verification tooling) starts a second real server as a side effect — flagged as a watch item, not fixed in this task's scope.

**Task 3.2 marked complete. Phase 3 (Aggregator Service) is now fully complete** — the entire backend runs end-to-end as one real process with live HTTP + WS surfaces. Round-trips: Implementation x1, Review x2 (1 with a real MEDIUM starvation bug, 1 clean after one interrupted attempt), Review-fix x1, Verification x1 (pass first try).

### 2026-08-18 — Task 4.1 (design tokens, global styles, light/dark theming + toggle) — full history

First Phase 4 (Frontend UI) task. This orchestrator session was interrupted mid-task by a process restart before Implementation's final report; the orchestrator independently confirmed all files existed and the full validation suite passed before proceeding to Review.

**Implementation (composer-2.5):** new `web/src/styles/{tokens,global,App}.css`, `web/src/hooks/useTheme.ts` + test, `web/src/lib/theme.ts` + test, `web/src/components/ui/ThemeToggle.tsx` + css. First real web unit tests since Task 0.1 deferred them (10 tests; `web/package.json`'s `test` script upgraded from no-op to `vitest run`). Uses `@fontsource/inter` with proper `unicode-range`-split subsets (only the Latin file actually downloads at runtime — confirmed live; the many extra font files in the build output are harmless bytes-at-rest, not a real perf issue).

**Review round 1 (fable) — 2 MEDIUM + 6 LOW.**

- MEDIUM 1: `--color-stale` (copied verbatim from docs/04's own DRAFT token block) failed WCAG contrast in both themes (light 2.52:1, dark 3.66:1, vs. the doc's own ≥4.5:1 requirement) — a genuine internal contradiction in docs/04's draft section; adjusting the CSS value (not editing docs/) was the minimal fix, same pattern as the Phase 2 DOT-liquidity doc contradiction.
- MEDIUM 2: `color-scheme: light dark` didn't follow `data-theme`, so native form controls/scrollbars could mismatch the chosen theme.
- LOW findings included two with real risk: unguarded `localStorage` access could throw `SecurityError` and blank the entire React tree; `ThemeToggle`'s `aria-pressed` + state-dependent `aria-label` produced confusing screen-reader announcements.
- Reviewer did extensive live verification (real Chrome, WCAG contrast math, live font network trace, 5 adversarial hook probes).

**Review-fix round 1 (composer-2.5):** `--color-stale` retuned (light `oklch(55% 0.02 250)`, dark `oklch(62% 0.02 250)`, contrast math shown, 4.57-5.34:1 across all 4 combos); `color-scheme` now theme-aware; `localStorage` reads/writes wrapped in try/catch (+3 tests); `ThemeToggle` switched to `role="switch"` + fixed `aria-label` + `aria-checked`. Web tests 10→13.

**Review round 2 (fable) — NOT approved: the localStorage fix was incomplete.** The try/catch only wrapped `getItem`/`setItem` method CALLS, but the bare `localStorage` identifier itself (a property GETTER per spec) was evaluated outside any guard — reviewer proved live that a throwing `window.localStorage` getter (via `Object.defineProperty`, the real-world mechanism browsers use when blocking site storage) still blanked the entire React tree. Also found a dead `[aria-pressed='true']` CSS selector left over from the ARIA pattern change, silently disabling the dark-mode "on" tint.

**Review-fix round 2 (composer-2.5):** new `getSafeStorage()` helper wraps the `window.localStorage` property access itself in try/catch, not just its methods; `readStoredTheme()`/`persistTheme()` no longer take a storage parameter, call `getSafeStorage()` internally. +3 tests using the exact `Object.defineProperty`-throwing-getter attack vector with manual descriptor save/restore (`vi.stubGlobal` doesn't properly restore a replaced getter). CSS selector fixed. Web tests 13→16 (216 total incl. server).

**Review round 3 (fable) — APPROVED, zero findings.** This bug class had escaped 2 prior fix attempts, so the reviewer was instructed to be maximally adversarial: grepped every `localStorage` occurrence individually (only 2 remain, both correctly guarded), reproduced the fix against a REAL Chrome live attack (not just jsdom) plus 5 jsdom variants (getter always-throws, throws-once-then-bad-storage, returns undefined/empty object, full throwing Proxy) — all passed, app never blanked. Confirmed the CSS tint fix applies live and zero regression on rounds 1-2's other fixes. Ran the full suite twice clean.

**Verification (sonnet) — PASS.** Own live Chrome verification (via chrome-devtools MCP): theme toggle correctly flips `data-theme`/`color-scheme`/`aria-checked`/localStorage and persists across reload, with a screenshot confirming the visible color change. Own independent reproduction of the localStorage-crash fix using the real `Object.defineProperty` attack vector, including the worst case (throwing getter installed via init script BEFORE the app's first script runs, simulating Safari private-mode/sandboxed-iframe boot) — app still rendered fully, fell back to system-preference detection, zero console errors. Confirmed full accessibility (native `role="switch"`, fixed `aria-label`, correct `aria-checked`, no `aria-pressed`, Enter/Space keyboard operability).

**Task 4.1 marked complete.** Round-trips: Implementation x1, Review x3 (1 with 2 MEDIUM+6 LOW, 1 with a fix that was still incomplete, 1 clean), Review-fix x2, Verification x1 (pass first try). The localStorage property-getter-vs-method-call distinction was a genuinely subtle bug that took 3 total review rounds to fully close — a good illustration of why this project's "verify against the real attack surface, not just the obvious code path" discipline matters even for frontend code, not just backend connectors.
