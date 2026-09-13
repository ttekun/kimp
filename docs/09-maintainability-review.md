# Maintainability review and proposed next changes

Review date: 2026-09-13. Scope: the current `server/` and `web/` implementation, shared wire/core modules, tests, build and deployment configuration, UI styles, operational scripts, and project documentation.

## Review result (Fact)

No known blocking findings remain in the reviewed paths after fixes and re-review. This is a scoped review result, not proof that every possible defect is absent. Live exchange availability, provider policy changes, and a new 24-hour production soak were not verified in this review. Existing Playwright market tests inject snapshots directly into the store; they do not establish that real exchange connections work.

The initial unit/integration suite passed 298 tests. Added regression coverage brings it to 327 tests (237 server, 90 web). The original green suite did not cover several production-browser failure paths.

## Fixed findings (Fact)

| Area | Trigger and previous effect | Result after correction | Regression evidence |
| --- | --- | --- | --- |
| Exchange input | Partial numeric strings such as `12junk`, non-positive Upbit prices, inherited object keys, invalid date/base/amount metadata | Reject malformed input instead of silently using an altered price or unexpected symbol; pure premium functions also reject non-positive prices | `server/test/connectors/reviewRegression.test.ts`, existing normalizer/core tests |
| Bitbank availability | A valid tick followed by a one-sided/crossed book or circuit break left the previous price available for premiums | Explicit invalidation survives periodic recomputation; affected premium and displayed target price disappear; recovery requires usable data and circuit-break ordering is checked | `web/src/lib/reviewRegression.test.ts`, Bitbank connector/normalizer tests |
| Browser FX | Initial failure never retried; a long-running tab never refreshed; blocked storage prevented fetching; incomplete cache objects were accepted | Bounded fetch timeout, safe storage access, complete cache checks, UTC-day refresh and bounded retry scheduling | `web/src/lib/reviewRegression.test.ts` |
| Connection lifetime | Duplicate starts or responses from stopped sessions could leave timers/sockets or update a later session | Idempotent starts, session checks on async completion, cleanup on stop and failed server startup | `web/src/lib/browserLifecycle.test.ts`, browser aggregator regressions, server lifecycle tests |
| Local hosting | Node CSP permitted only same-origin connections even though the SPA now connects directly to exchanges | Node hosting permits the same feed origins as the static SPA | `server/test/transport/securityHeaders.test.ts` |
| Implied FX display | Silent Upbit USDT feed retained its displayed rate indefinitely | Implied rate uses the Upbit age thresholds independently of daily fiat rates | `web/src/components/FxStatusBar.test.tsx` |

Browser FX scheduling permits two load attempts per UTC day during uninterrupted operation of an aggregator instance; each attempt may use primary and fallback. This is not a cross-tab or cross-reload global request quota. Successful results remain cached by UTC date. Fiat freshness still uses `fetchedAt` under the existing project contract.

## Recommended changes (Opinion)

The aim is to reduce how many independently maintained places must change for one feature. No speedup estimate is justified by this review. Keep the small immutable snapshot and straightforward full recomputation until profiling demonstrates a bottleneck.

### 1. Establish an explicit shared package boundary

**Evidence:** `web/vite.config.ts` and `web/tsconfig.json` map eight aliases directly into `server/src`. Browser production depends on files physically owned by the optional local server. `web/src/lib/types.ts` already notes this compromise.

**Proposal:** create a workspace package, for example `packages/market`, with explicit exports for core types, schemas, symbols, premium math, snapshot transitions and pure exchange normalization. Keep Node sockets, Fastify, filesystem code and browser storage outside it. Move files without changing their behavior first, update imports, then remove the aliases. Add import restrictions preventing browser/shared modules from importing Node runtime modules.

**Acceptance:** browser and server consume package exports; adding or moving a shared module does not require synchronized Vite and TypeScript path edits; both builds and existing contract tests pass. Confirm browser output contains no Node transport code.

### 2. Centralize domain configuration and derive types from contracts

**Evidence:** coin lists exist in `server/src/core/symbols.ts`, `web/src/lib/feedStatus.ts` and `web/src/lib/premiumTable.ts`; FX thresholds and age derivation are repeated in the browser. Core interfaces and schemas separately describe similar objects, and `StoredFxRates` repeats rate fields.

**Proposal:** import one symbol/threshold definition, derive schema-backed boundary types where practical, and represent coin display metadata separately from market codes. Tighten ticker ingestion with an exchange-to-ticker type mapping so an Upbit callback cannot accept a ticker missing Upbit-specific fields. Follow with a dedicated invalidation event type instead of spreading knowledge of an unavailable ticker's placeholder price.

**Acceptance:** a coin addition changes one domain registry and its display metadata, not multiple literal symbol lists; an invalid exchange/ticker pairing fails typechecking. Preserve the explicit distinction between age-derived status and provider-declared unavailability.

### 3. Separate connection ownership from exchange semantics

**Evidence:** the three browser clients each manage start/stop, reconnect timers and socket identity. Upbit and Binance repeat much of the same native WebSocket lifecycle. Node connectors independently implement similar rules. This review fixed lifecycle behavior in several files.

**Proposal:** extract a small native-browser WebSocket lifecycle helper for Upbit and Binance, with decode/subscribe callbacks. Keep Bitbank Socket.IO as a separate adapter. Use shared lifecycle contract tests across adapters instead of forcing all protocols into a large base class. Extract FX scheduling from `clientAggregator.ts` into an independently testable component with an injected clock and loader. Keep provider-specific parsing and availability rules explicit.

**Acceptance:** duplicate start, stop during decoding/fetch, disconnect/error ordering, reconnect backoff and timer cleanup are tested consistently; changing reconnect policy requires one change per transport family. No new general-purpose plugin framework.

### 4. Make tests exercise the production ingestion path

**Evidence:** `web/e2e/mockMarket.ts` sets `window.__KIMP_E2E__` store values directly. Its `closeSockets` helper changes connection status without closing a socket. This is useful for UI tests but bypasses normalization, client aggregation and reconnect logic.

**Proposal:** retain these fast UI/visual tests and name them accurately. Add a small deterministic browser integration suite that supplies recorded raw exchange messages through mocked WebSocket/Socket.IO boundaries and a fake FX response, then asserts rendered premiums. Include valid tick → unusable book → recovery, out-of-order messages, offline → retry and UTC-day rollover. Share fixture builders rather than hand-maintaining many complete snapshots.

**Acceptance:** breaking an adapter callback or normalization path fails a browser integration test; pure UI tests remain independent of networking. Keep live-provider smoke/soak checks separate and explicitly optional.

### 5. Give maintainers one current guide and one verification entry point

**Evidence:** `docs/00-overview.md` still specifies exactly five coins while the implementation contains six. The task breakdown describes server-mediated browser transport and VM deployment, while `docs/02-architecture.md` and `docs/08-runbook.md` describe GitHub Pages and browser aggregation. `scripts/soak-5.2.mjs` contains a historical default PID/start time. CI and deployment are separate workflows triggered on `main`, so deployment is not gated by completion of the CI workflow.

**Proposal:** add a short root README with the current architecture, commands and a change-location map. Mark historical plans as historical and keep current contracts in a small maintained document. Add a `check` script for lint, typecheck, unit tests and formatting, plus an explicit release check for build and E2E. Make release deployment depend on successful validation of the same commit and deploy the tested artifact. Move old soak evidence to an archive; require explicit PID/start time for a reusable Node-only soak command.

**Acceptance:** a new maintainer can identify where to change a coin, formula, transport or column without interpreting project history; a failed required check prevents deployment of that commit.

## Suggested implementation order (Opinion)

1. Current README/change map and verification commands: small, reviewable entry point.
2. Shared package extraction with behavior preserved.
3. Single domain registry, shared boundary types and import restrictions.
4. Production-ingestion integration tests before transport extraction.
5. Native WebSocket lifecycle and FX scheduler extraction; then release workflow consolidation.

Use separate pull requests for these steps. The blocker fixes in this review are implemented; the structural proposals above are not yet implemented. Avoid simultaneous package moves, algorithm changes and UI redesigns, which would make regressions harder to isolate.

## Validation

- `pnpm test`: 327 passing tests.
- `pnpm typecheck`, `pnpm lint`, `pnpm format:check`: pass.
- `GITHUB_PAGES=true pnpm build`: server and production SPA build pass.
- `pnpm --filter @kimchi/web test:e2e`: UI, accessibility, visual and bundle-budget checks.
- `pnpm --filter @kimchi/web test:e2e:pages`: built `/kimp/` path smoke check.
- Local port binding requires execution outside the restricted sandbox; an `EPERM` during binding was an environment limitation, not a product assertion failure.
