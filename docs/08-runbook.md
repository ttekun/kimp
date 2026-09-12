# 08 — Runbook and release gate

Ops notes for **GitHub Pages production** (static SPA, browser aggregation). The Node process in `server/` is local/tests only.

## Production URL

- Site: `https://ttekun.github.io/kimp/`
- Repo: `https://github.com/ttekun/kimp`
- Deploy: push `main` → `.github/workflows/pages.yml` (Actions Pages, artifact `web/dist`)
- Repo must be **public** (free Pages)

## Health monitoring

There is no `/api/health`. Check:

- `GET https://ttekun.github.io/kimp/` → 200 HTML
- `GET …/theme-boot.js` → 200
- In the browser: FX bar transport `live`, feed dots, both premium tables populated
- Exchange sockets are per visitor; Origin is `https://ttekun.github.io`

## Restart policy

- Pages has no process to restart. Redeploy by pushing `main`.
- Hard-refresh after deploy (hashed JS). `404.html` is a copy of `index.html` for SPA fallback.

## Exchange / FX change watchlist

| Feed | What to watch |
|---|---|
| Upbit WS | Ticker field names (`code` vs `market`); KRW pair codes; Origin from github.io |
| Binance miniTicker | Combined stream; browser URL `wss://stream.binance.com:443` |
| Bitbank Socket.IO | `join-room` `ticker_*_jpy`; circuit-break rooms; no REST (no CORS) |
| er-api | `time_eol`; 429. Browser cache: one fetch per UTC day per browser (`kimp:fx:` keys) |
| Frankfurter | Weekend/ECB calendar gaps (FX 26 h / 78 h stale/down) |

## Release gate

1. **ExchangeRate-API attribution:** footer `Rates By Exchange Rate API` when FX source is `er-api`.
2. **No raw-rate redistribution:** no `/api/fx`. FX is used only in the SPA.
3. **Public APIs only.** CSP `connect-src` lists exchange + FX hosts in `web/index.html` meta.
4. **HTTPS:** GitHub Pages serves HTTPS. CSP includes `upgrade-insecure-requests`.

## Security

Meta CSP in `index.html` (Pages cannot set CSP HTTP headers). Theme bootstrap is `%BASE_URL%theme-boot.js`. `frame-ancestors` in meta CSP is ignored by browsers.
