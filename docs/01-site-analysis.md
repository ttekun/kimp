# 01 — Site Analysis: scolkg.com

Analysis date: 2026-08-16. Method: live page load in a headless Chrome session (DOM/a11y snapshot, network request inspection, in-page JS evaluation) plus a text fetch of the HTML.

Every fact below is labeled **[Observed]** (directly seen in the DOM, network log, or JS runtime) or **[Inferred]** (reasonable conclusion not directly confirmed).

## Identity

- **[Observed]** Page title (Korean): "Kimchi Premium Kimp (kimchi premium) - Cryprice". Brand is "Cryprice"; footer reads "All content (c) Cryprice. 2018. All rights reserved. contact : jkjminer@gmail.com". scolkg.com serves the Cryprice app (a second host, `ticker1.cryprice.com`, is used for data).
- **[Observed]** Primary language is Korean with mixed English labels.

## Page Layout (top to bottom)

1. **[Observed]** Navbar with hamburger toggle and logo link.
2. **[Observed]** FX/market status bar: USD/KRW `1,418.5 KRW`, JPY/KRW `8.9026 KRW`, USDT price `1,414.8 KRW` with ratio `0.9989` (Tether premium vs USD/KRW), BTC "Dominance: 58.41 %", "Coinbase Premium: -70$ / -0.11%".
   - **[Inferred]** The 8.9026 figure is KRW per 1 JPY (consistent with 1,418.5 / ~159.2).
3. **[Observed]** Ad slots (Google AdSense) and referral banners (Binance 10% fee discount, Bybit 15%).
4. **[Observed]** Featured single-coin comparison card: coin selector (BTC), 24h change %, trade value in KRW (label in Korean, "georaedaegeum", e.g. "169 eok" = 16.9B KRW), then `Upbit 89,237,000 KRW / $62,909.41` minus `Binance 89,471,689 KRW / $63,074.86` equals `Kimchi Premium -0.26% / -234,689 KRW`.
5. **[Observed]** Toolbar buttons: "Search Coin", "Alarm", "Domi & Usdt Chart"; table filter tabs "All" / "Favorite" plus a coin search textbox; sortable column links: Coin, Target(BTC), Target($), Target(KRW), Criterion(KRW), CriChg(%), CriVol(100m), BTC Diff(KRW), premium(KRW).
6. **[Observed]** Comparison table 1 — "Upbit Criterion / Binance Target". Columns: `Coin | binance($) | upbit(KRW) | change(%) | volume(100m) | Kimchi Premium(KRW)`. Premium cell shows absolute KRW diff plus % in parentheses, e.g. BTC `-234,675 (-0.26%)`. Visible rows (default set): BTC, ETH, BCH, LINK, XRP, DOT, TRX, ADA, XLM.
7. **[Observed]** Comparison table 2 — "Upbit Criterion / Bybit Target", identical column structure with `bybit($)`. **The original compares against Bybit, not Bitbank — Bitbank is our clone's substitution, not a site feature.**
8. **[Observed]** "24Hour binance accumulate liquidation - BTCUSD" widget (long/short bars).
9. **[Observed]** Live chat: channel buttons ch.1/ch.2, online counter ("158 persons (Total 590 persons)"), user messages, and controls: Alarm, Init, Clean, **Day/Night** (theme toggle), Chat off, Bot off, Font, Call Name, Help, plus emote buttons.
10. **[Observed]** Footer copyright line.

Other: **[Observed]** navigation includes links to Exchanges/Charts/CoinMarketCap/Binance/BitMex/Portfolio pages (from HTML fetch). A Korean/English language toggle was reported by the HTML text fetch but was **not** confirmed in the rendered DOM snapshot — treat as **[Inferred/unconfirmed]**.

## Data Displayed Per Coin

**[Observed]** per row: overseas price in USD, Upbit price in KRW, 24h change %, Upbit trade value in units of 100M KRW, premium as absolute KRW difference and %. The featured card additionally shows the Upbit price converted to USD.

## Real-Time Mechanism

- **[Observed]** Socket.IO (Engine.IO protocol `EIO=4`) connections to two hosts:
  - `https://scolkg.com/socket.io/` (same origin — chat and app events)
  - `https://ticker1.cryprice.com/socket.io/` (dedicated ticker/price host)
  Observed on the HTTP long-polling transport; a WebSocket upgrade was not directly observed in the capture window (Socket.IO normally upgrades, but that part is **[Inferred]**).
- **[Observed]** No direct browser calls to Upbit/Binance/Bybit APIs — prices are aggregated server-side and pushed via Socket.IO. This confirms a backend aggregator model.
- **[Observed]** `pako.min.js` (zlib inflate) is loaded — **[Inferred]** ticker payloads are compressed before being sent over Socket.IO.
- **[Observed]** REST call `GET /chat/selectLastPage/ko` for chat history; TradingView widget assets (`s3.tradingview.com/tv.js`) loaded for charts.

## Tech Stack (confirmed in JS runtime)

- **[Observed]** Vue 2.6.12 (`/javascripts/vue.min.js?v=2.6.12`, `window.Vue` present), jQuery + jQuery UI, Bootstrap, Socket.IO client (`window.io`), pako, autolink, xss.min.js, jquery.animateNumber. Custom bundles: `/my_js/allMainBody.js`, `/my_js/my_chat.js`, `/my_js/common.js`, `/javascripts/main.js`.
- **[Observed]** Google Analytics (UA + GA4), GTM, AdSense.
- **[Inferred]** Backend is Node.js (Socket.IO server on same origin, Express-style routes like `/getip/getIP`). Server-rendered page with Vue mounted over it (no SPA router observed on the main page).

## Takeaways for the Clone

1. Server-side aggregation + push (Socket.IO) is the proven pattern; the browser never talks to exchanges directly. We will replicate this (see `02-architecture.md`) — it also sidesteps CORS and per-client exchange rate limits.
2. The premium cell format `absolute diff (percent%)` with color coding is the core UX to reproduce.
3. The FX bar at the top (USD/KRW, JPY/KRW, USDT implied rate) is essential context and cheap to build.
4. Everything else (chat, ads, liquidation widget, TradingView) is out of scope for the clone.
