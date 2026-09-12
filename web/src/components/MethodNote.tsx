import { formatRatesDateShort } from '../lib/formatFx';
import type { MarketSnapshot } from '../lib/types';
import './MethodNote.css';

export interface MethodNoteProps {
  snapshot: MarketSnapshot | null;
}

function formatFetchedAt(fetchedAt: number | undefined): string {
  if (fetchedAt === undefined) {
    return '—';
  }
  return new Date(fetchedAt).toISOString();
}

export function MethodNote({ snapshot }: MethodNoteProps) {
  const usdKrw = snapshot?.fx.usdKrw;
  const source = usdKrw?.source ?? 'unavailable';
  const ratesDate = usdKrw
    ? `${usdKrw.ratesDate} (${formatRatesDateShort(usdKrw.ratesDate)})`
    : '—';
  const fetchedAt = formatFetchedAt(usdKrw?.fetchedAt);

  return (
    <section className="method-note" aria-label="Method and sources">
      <details>
        <summary>Method / source note</summary>
        <div className="method-note__body">
          <p>
            Pair A (Upbit vs Binance): Upbit last KRW ÷ USD/KRW, compared with Binance USDT last
            (USDT treated as a USD proxy).
          </p>
          <p>
            Pair B (Upbit vs Bitbank): Upbit last KRW vs Bitbank mid JPY × KRW/JPY, where KRW/JPY =
            USD/KRW ÷ USD/JPY.
          </p>
          <p>
            FX source: <span data-testid="fx-source">{source}</span>; rates date {ratesDate};
            fetched at{' '}
            <time dateTime={usdKrw ? new Date(usdKrw.fetchedAt).toISOString() : undefined}>
              {fetchedAt}
            </time>
            .
          </p>
          <p>
            USDT is not USD. Pair A treats USDT as USD for the conventional kimchi premium. The
            implied Upbit KRW-USDT rate in the status bar is a live cross-check, not a substitute
            for the daily FX print.
          </p>
          <p className="method-note__links">
            <a href="https://docs.upbit.com">Upbit API docs</a>
            <a href="https://developers.binance.com/docs/binance-spot-api-docs">
              Binance spot docs
            </a>
            <a href="https://github.com/bitbankinc/bitbank-api-docs">Bitbank API docs</a>
            <a href="https://www.exchangerate-api.com/docs/free">Exchange Rate API (open)</a>
            <a href="https://www.frankfurter.dev">Frankfurter</a>
          </p>
        </div>
      </details>
    </section>
  );
}
