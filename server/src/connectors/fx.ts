import {
  ER_API_URL,
  FRANKFURTER_URL,
  normalizeErApiResponse,
  normalizeFrankfurterResponse,
  type FxRates,
} from './fxNormalize.js';

/** Docs/03: alert when primary vs fallback diverge by more than 2%. */
export const FX_DIVERGENCE_THRESHOLD_PCT = 2;

/**
 * Minimum interval between scheduled primary polls.
 * er-api ToS: ≤1 request/24h avoids restrictions; we schedule off time_next_update_utc
 * but never sooner than this floor.
 */
export const FX_MIN_PRIMARY_INTERVAL_MS = 23 * 60 * 60 * 1_000;

/** Delay before Frankfurter cross-check after a successful primary fetch. */
export const FX_CROSS_CHECK_DELAY_MS = 5_000;

/** er-api 429 lockout duration per docs/03. */
export const FX_429_RETRY_DELAY_MS = 20 * 60 * 1_000;

/** Project-wide daily FX fetch budget (primary + cross-check + retries). */
export const FX_DAILY_FETCH_BUDGET = { min: 2, max: 4 } as const;

export {
  ER_API_SOURCE,
  ER_API_URL,
  FRANKFURTER_SOURCE,
  FRANKFURTER_URL,
  normalizeErApiResponse,
  normalizeFrankfurterResponse,
} from './fxNormalize.js';
export type { FxRates, NormalizedErApiResult } from './fxNormalize.js';

export type FetchFn = typeof fetch;

export type FxConnectorErrorKind =
  'dns_tls' | 'http_error' | 'rate_limited' | 'malformed_payload' | 'divergence';

export interface FxConnectorError {
  kind: FxConnectorErrorKind;
  message: string;
  at: number;
}

export interface FxDivergenceCheckResult {
  at: number;
  krwDivergencePct: number;
  jpyDivergencePct: number;
  diverged: boolean;
}

export type FxConnectorStatus = 'idle' | 'polling' | 'ok' | 'stale' | 'error';

export interface FxConnectorHealth {
  status: FxConnectorStatus;
  lastError: FxConnectorError | null;
  lastSuccessfulFetchAt: {
    erApi: number | null;
    frankfurter: number | null;
  };
  lastDivergenceCheck: FxDivergenceCheckResult | null;
  /** True when er-api ever returned a non-zero time_eol_unix or a time_eol string. */
  timeEolDetected: boolean;
  timeEolUnix: number | null;
  /** Fetches in the current UTC calendar day (resets at midnight UTC). */
  fetchCountToday: number;
  totalFetches: number;
}

export interface FxPollerCallbacks {
  onRates?: (rates: FxRates) => void;
}

export interface FxPollerOptions extends FxPollerCallbacks {
  fetchFn?: FetchFn;
  now?: () => number;
}

export function computeDivergencePct(primary: number, fallback: number): number {
  if (!Number.isFinite(primary) || !Number.isFinite(fallback) || primary <= 0) {
    return Infinity;
  }

  return (Math.abs(primary - fallback) / primary) * 100;
}

export function checkRatesDivergence(primary: FxRates, fallback: FxRates): FxDivergenceCheckResult {
  const krwDivergencePct = computeDivergencePct(primary.usdKrw.value, fallback.usdKrw.value);
  const jpyDivergencePct = computeDivergencePct(primary.usdJpy.value, fallback.usdJpy.value);
  const diverged =
    krwDivergencePct > FX_DIVERGENCE_THRESHOLD_PCT ||
    jpyDivergencePct > FX_DIVERGENCE_THRESHOLD_PCT;

  return {
    at: Date.now(),
    krwDivergencePct,
    jpyDivergencePct,
    diverged,
  };
}

export function classifyFxNetworkError(error: unknown): FxConnectorError {
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();

  const dnsTls =
    lower.includes('enotfound') ||
    lower.includes('econnrefused') ||
    lower.includes('getaddrinfo') ||
    lower.includes('certificate') ||
    lower.includes('tls') ||
    lower.includes('ssl') ||
    lower.includes('unable to verify');

  return {
    kind: dnsTls ? 'dns_tls' : 'http_error',
    message,
    at: Date.now(),
  };
}

export function classifyFxHttpError(status: number, body: string): FxConnectorError {
  if (status === 429) {
    return {
      kind: 'rate_limited',
      message: `HTTP 429: ${body.slice(0, 200)}`,
      at: Date.now(),
    };
  }

  return {
    kind: 'http_error',
    message: `HTTP ${status}: ${body.slice(0, 200)}`,
    at: Date.now(),
  };
}

function utcDayKey(epochMs: number): string {
  return new Date(epochMs).toISOString().slice(0, 10);
}

export class FxPoller {
  private readonly fetchFn: FetchFn;
  private readonly now: () => number;
  private readonly callbacks: FxPollerCallbacks;

  private stopped = true;
  private primaryTimer: ReturnType<typeof setTimeout> | null = null;
  private crossCheckTimer: ReturnType<typeof setTimeout> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;

  private lastGoodRates: FxRates | null = null;
  private lastPrimaryRates: FxRates | null = null;
  private nextPrimaryPollAt: number | null = null;

  private fetchDayKey = '';
  private fetchCountToday = 0;
  private totalFetches = 0;

  private healthState: FxConnectorHealth = {
    status: 'idle',
    lastError: null,
    lastSuccessfulFetchAt: { erApi: null, frankfurter: null },
    lastDivergenceCheck: null,
    timeEolDetected: false,
    timeEolUnix: null,
    fetchCountToday: 0,
    totalFetches: 0,
  };

  constructor(options: FxPollerOptions = {}) {
    this.fetchFn = options.fetchFn ?? fetch;
    this.now = options.now ?? Date.now;
    this.callbacks = {
      onRates: options.onRates,
    };
  }

  /** Last successfully fetched normalized rates (never raw provider payloads). */
  getRates(): FxRates | null {
    if (!this.lastGoodRates) {
      return null;
    }

    return {
      usdKrw: { ...this.lastGoodRates.usdKrw },
      usdJpy: { ...this.lastGoodRates.usdJpy },
    };
  }

  getHealth(): FxConnectorHealth {
    this.maybeResetDailyFetchCount();
    return {
      ...this.healthState,
      lastSuccessfulFetchAt: { ...this.healthState.lastSuccessfulFetchAt },
      lastDivergenceCheck: this.healthState.lastDivergenceCheck
        ? { ...this.healthState.lastDivergenceCheck }
        : null,
      fetchCountToday: this.fetchCountToday,
      totalFetches: this.totalFetches,
    };
  }

  async start(): Promise<void> {
    this.stopped = false;
    this.healthState = { ...this.healthState, status: 'polling' };
    await this.runPrimaryPoll();
  }

  stop(): void {
    this.stopped = true;
    this.clearTimers();
    this.healthState = { ...this.healthState, status: 'idle' };
  }

  private clearTimers(): void {
    for (const timer of [this.primaryTimer, this.crossCheckTimer, this.retryTimer]) {
      if (timer) {
        clearTimeout(timer);
      }
    }

    this.primaryTimer = null;
    this.crossCheckTimer = null;
    this.retryTimer = null;
  }

  /** Resets the UTC-day fetch counter when the calendar day changes. */
  private maybeResetDailyFetchCount(): void {
    const dayKey = utcDayKey(this.now());
    if (dayKey !== this.fetchDayKey) {
      this.fetchDayKey = dayKey;
      this.fetchCountToday = 0;
      this.healthState = {
        ...this.healthState,
        fetchCountToday: 0,
      };
    }
  }

  private recordFetch(): void {
    this.maybeResetDailyFetchCount();

    this.fetchCountToday += 1;
    this.totalFetches += 1;
    this.healthState = {
      ...this.healthState,
      fetchCountToday: this.fetchCountToday,
      totalFetches: this.totalFetches,
    };
  }

  private canFetch(): boolean {
    this.maybeResetDailyFetchCount();
    return this.fetchCountToday < FX_DAILY_FETCH_BUDGET.max;
  }

  private setError(error: FxConnectorError): void {
    this.healthState = {
      ...this.healthState,
      lastError: error,
      status: this.lastGoodRates ? 'stale' : 'error',
    };
  }

  /** Cross-check-only failure: primary data remains valid; do not mark stale. */
  private setCrossCheckUnavailable(error: FxConnectorError): void {
    this.healthState = {
      ...this.healthState,
      lastError: {
        ...error,
        message: `cross-check unavailable: ${error.message}`,
      },
    };
  }

  private applyRates(rates: FxRates): void {
    this.lastGoodRates = {
      usdKrw: { ...rates.usdKrw },
      usdJpy: { ...rates.usdJpy },
    };
    this.callbacks.onRates?.(this.getRates()!);
  }

  private schedulePrimaryPoll(at: number): void {
    if (this.stopped) {
      return;
    }

    if (this.primaryTimer) {
      clearTimeout(this.primaryTimer);
    }

    const effectiveAt = Math.max(at, this.now());
    const delay = Math.max(0, effectiveAt - this.now());
    this.nextPrimaryPollAt = effectiveAt;
    this.primaryTimer = setTimeout(() => {
      this.primaryTimer = null;
      void this.runPrimaryPoll();
    }, delay);
  }

  private schedulePrimaryPollAfterFailure(): void {
    this.schedulePrimaryPoll(this.now() + FX_MIN_PRIMARY_INTERVAL_MS);
  }

  private scheduleCrossCheck(): void {
    if (this.stopped || !this.canFetch()) {
      return;
    }

    if (this.crossCheckTimer) {
      clearTimeout(this.crossCheckTimer);
    }

    this.crossCheckTimer = setTimeout(() => {
      this.crossCheckTimer = null;
      void this.runCrossCheck();
    }, FX_CROSS_CHECK_DELAY_MS);
  }

  private schedule429Retry(): void {
    if (this.stopped || !this.canFetch()) {
      return;
    }

    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
    }

    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.runPrimaryPoll();
    }, FX_429_RETRY_DELAY_MS);
  }

  private computeNextPrimaryPollTime(nextUpdateUnix: number): number {
    const nextUpdateMs = nextUpdateUnix * 1_000;
    const minNext = this.now() + FX_MIN_PRIMARY_INTERVAL_MS;
    return Math.max(nextUpdateMs, minNext);
  }

  private async fetchJson(
    url: string,
  ): Promise<{ ok: true; data: unknown } | { ok: false; error: FxConnectorError }> {
    if (!this.canFetch()) {
      return {
        ok: false,
        error: {
          kind: 'rate_limited',
          message: `Daily FX fetch budget exhausted (${FX_DAILY_FETCH_BUDGET.max}/day)`,
          at: this.now(),
        },
      };
    }

    this.recordFetch();

    let response: Response;
    try {
      response = await this.fetchFn(url);
    } catch (error) {
      return { ok: false, error: classifyFxNetworkError(error) };
    }

    if (!response) {
      return {
        ok: false,
        error: {
          kind: 'http_error',
          message: 'Empty fetch response',
          at: this.now(),
        },
      };
    }

    if (!response.ok) {
      let body = '';
      try {
        body = await response.text();
      } catch {
        return {
          ok: false,
          error: classifyFxHttpError(response.status, ''),
        };
      }

      return {
        ok: false,
        error: classifyFxHttpError(response.status, body),
      };
    }

    try {
      const data = (await response.json()) as unknown;
      return { ok: true, data };
    } catch (error) {
      return {
        ok: false,
        error: {
          kind: 'malformed_payload',
          message: error instanceof Error ? error.message : String(error),
          at: this.now(),
        },
      };
    }
  }

  private noteTimeEol(detected: boolean, unix: number | null): void {
    if (!detected) {
      return;
    }

    this.healthState = {
      ...this.healthState,
      timeEolDetected: true,
      timeEolUnix: unix ?? this.healthState.timeEolUnix,
    };
  }

  private async runPrimaryPoll(): Promise<void> {
    if (this.stopped) {
      return;
    }

    this.healthState = { ...this.healthState, status: 'polling' };

    const fetchedAt = this.now();
    const result = await this.fetchJson(ER_API_URL);

    if (!result.ok) {
      this.setError(result.error);
      if (result.error.kind === 'rate_limited') {
        this.schedule429Retry();
      }
      // Lesson #3: primary failure must not prevent trying fallback.
      await this.runFallbackPoll();
      return;
    }

    const normalized = normalizeErApiResponse(result.data, fetchedAt);
    if (!normalized) {
      const error: FxConnectorError = {
        kind: 'malformed_payload',
        message: 'Malformed er-api FX response',
        at: fetchedAt,
      };
      this.setError(error);
      await this.runFallbackPoll();
      return;
    }

    this.noteTimeEol(normalized.timeEolDetected, normalized.timeEolUnix);

    this.lastPrimaryRates = {
      usdKrw: { ...normalized.usdKrw },
      usdJpy: { ...normalized.usdJpy },
    };
    this.applyRates(normalized);

    this.healthState = {
      ...this.healthState,
      status: 'ok',
      lastError: null,
      lastSuccessfulFetchAt: {
        ...this.healthState.lastSuccessfulFetchAt,
        erApi: fetchedAt,
      },
    };

    this.schedulePrimaryPoll(this.computeNextPrimaryPollTime(normalized.nextUpdateUnix));
    this.scheduleCrossCheck();
  }

  private async runFallbackPoll(): Promise<void> {
    if (this.stopped) {
      return;
    }

    const fetchedAt = this.now();
    const result = await this.fetchJson(FRANKFURTER_URL);

    if (!result.ok) {
      this.setError(result.error);
      if (!this.lastGoodRates) {
        this.healthState = { ...this.healthState, status: 'error' };
      }
      this.schedulePrimaryPollAfterFailure();
      return;
    }

    const normalized = normalizeFrankfurterResponse(result.data, fetchedAt);
    if (!normalized) {
      const error: FxConnectorError = {
        kind: 'malformed_payload',
        message: 'Malformed Frankfurter FX response',
        at: fetchedAt,
      };
      this.setError(error);
      if (!this.lastGoodRates) {
        this.healthState = { ...this.healthState, status: 'error' };
      }
      this.schedulePrimaryPollAfterFailure();
      return;
    }

    this.applyRates(normalized);

    this.healthState = {
      ...this.healthState,
      status: this.lastPrimaryRates ? 'stale' : 'ok',
      lastSuccessfulFetchAt: {
        ...this.healthState.lastSuccessfulFetchAt,
        frankfurter: fetchedAt,
      },
    };

    this.schedulePrimaryPollAfterFailure();
  }

  private async runCrossCheck(): Promise<void> {
    if (this.stopped || !this.lastPrimaryRates) {
      return;
    }

    const fetchedAt = this.now();
    const result = await this.fetchJson(FRANKFURTER_URL);

    if (!result.ok) {
      this.setCrossCheckUnavailable(result.error);
      return;
    }

    const fallback = normalizeFrankfurterResponse(result.data, fetchedAt);
    if (!fallback) {
      const error: FxConnectorError = {
        kind: 'malformed_payload',
        message: 'Malformed Frankfurter cross-check response',
        at: fetchedAt,
      };
      this.setCrossCheckUnavailable(error);
      return;
    }

    const divergence = checkRatesDivergence(this.lastPrimaryRates, fallback);
    divergence.at = fetchedAt;

    this.healthState = {
      ...this.healthState,
      lastDivergenceCheck: divergence,
      lastSuccessfulFetchAt: {
        ...this.healthState.lastSuccessfulFetchAt,
        frankfurter: fetchedAt,
      },
      status: divergence.diverged ? 'stale' : this.healthState.status,
      lastError: divergence.diverged
        ? {
            kind: 'divergence',
            message: `FX divergence >${FX_DIVERGENCE_THRESHOLD_PCT}%: KRW ${divergence.krwDivergencePct.toFixed(2)}%, JPY ${divergence.jpyDivergencePct.toFixed(2)}%`,
            at: fetchedAt,
          }
        : this.healthState.lastError,
    };
  }
}
