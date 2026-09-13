import { deriveFeedStatus, STALENESS_THRESHOLDS } from '@kimchi/core/snapshot';

import { ThemeToggle } from './ui/ThemeToggle';
import { deriveExchangeFeedStatus, deriveFxFeedStatus } from '../lib/feedStatus';
import {
  formatFxSourceBadge,
  formatJpyKrw,
  formatUsdKrw,
  formatUsdtKrw,
  FX_EM_DASH,
} from '../lib/formatFx';
import type { FeedStatus, MarketSnapshot } from '../lib/types';
import type { ConnectionStatus } from '../store/marketStore';
import './FxStatusBar.css';

const FEED_LABELS = {
  upbit: 'Upbit',
  binance: 'Binance',
  bitbank: 'Bitbank',
  fx: 'FX',
} as const;

function transportCopy(status: ConnectionStatus): string {
  switch (status) {
    case 'connecting':
      return 'Connecting';
    case 'live':
      return 'Live';
    case 'reconnecting':
      return 'Reconnecting';
    case 'polling':
      return 'Polling — socket down';
  }
}

function FeedDot({ label, status }: { label: string; status: FeedStatus }) {
  return (
    <span className="fx-bar__feed" data-status={status} title={`${label} ${status}`}>
      <span className="fx-bar__dot" aria-hidden="true" />
      <span className="fx-bar__feed-label" aria-hidden="true">
        {label}
      </span>
      <span className="fx-bar__sr-only">{`${label} ${status}`}</span>
    </span>
  );
}

export interface FxStatusBarProps {
  snapshot: MarketSnapshot | null;
  connectionStatus: ConnectionStatus;
}

export function FxStatusBar({ snapshot, connectionStatus }: FxStatusBarProps) {
  const usdKrw = snapshot?.fx.usdKrw;
  const usdt = snapshot?.fx.usdtKrwImplied;
  const krwPerJpy = snapshot?.fx.krwPerJpy;
  const fxStatus = deriveFxFeedStatus(snapshot);
  const badge = formatFxSourceBadge(usdKrw);
  const showTransportBanner = connectionStatus === 'reconnecting' || connectionStatus === 'polling';

  const fxIsDown = fxStatus === 'down';
  const fxIsStale = fxStatus === 'stale';
  const usdDisplay = fxIsDown ? FX_EM_DASH : formatUsdKrw(usdKrw?.value);
  const jpyDisplay = fxIsDown ? FX_EM_DASH : formatJpyKrw(krwPerJpy);
  const usdtStatus =
    usdt && snapshot
      ? deriveFeedStatus(
          usdt.fetchedAt,
          snapshot.updatedAt,
          STALENESS_THRESHOLDS.upbit.staleAfterMs,
          STALENESS_THRESHOLDS.upbit.downAfterMs,
        )
      : 'down';
  const usdtDisplay = usdtStatus === 'down' ? FX_EM_DASH : formatUsdtKrw(usdt?.value);
  const fiatMissing = fxIsDown || fxIsStale || usdDisplay === FX_EM_DASH;
  const jpyMissing = fxIsDown || fxIsStale || jpyDisplay === FX_EM_DASH;

  return (
    <header className="fx-bar">
      <div className="fx-bar__strip">
        <div className="fx-bar__rates" aria-label="FX rates">
          <span className="fx-bar__rate" data-missing={fiatMissing ? 'true' : undefined}>
            <span className="fx-bar__pair">USD/KRW</span>
            <span className="fx-bar__value tabular-nums">{usdDisplay}</span>
            {badge ? <span className="fx-bar__badge">{badge}</span> : null}
          </span>
          <span className="fx-bar__rate" data-missing={jpyMissing ? 'true' : undefined}>
            <span className="fx-bar__pair">JPY/KRW</span>
            <span className="fx-bar__value tabular-nums">{jpyDisplay}</span>
          </span>
          <span className="fx-bar__rate" data-missing={usdtStatus !== 'live' ? 'true' : undefined}>
            <span className="fx-bar__pair">USDT/KRW</span>
            <span className="fx-bar__value tabular-nums">{usdtDisplay}</span>
            <span className="fx-bar__hint">implied</span>
          </span>
        </div>

        <div className="fx-bar__feeds" aria-label="Feed status">
          <FeedDot label={FEED_LABELS.upbit} status={deriveExchangeFeedStatus(snapshot, 'upbit')} />
          <FeedDot
            label={FEED_LABELS.binance}
            status={deriveExchangeFeedStatus(snapshot, 'binance')}
          />
          <FeedDot
            label={FEED_LABELS.bitbank}
            status={deriveExchangeFeedStatus(snapshot, 'bitbank')}
          />
          <FeedDot label={FEED_LABELS.fx} status={fxStatus} />
        </div>

        <p className="fx-bar__transport" data-status={connectionStatus} aria-live="polite">
          {transportCopy(connectionStatus)}
        </p>

        <div className="fx-bar__toggle">
          <ThemeToggle />
        </div>
      </div>

      {showTransportBanner ? (
        <p className="fx-bar__banner" role="status">
          {connectionStatus === 'reconnecting'
            ? 'Reconnecting to the market feed…'
            : 'Socket down — polling snapshot every 5s'}
        </p>
      ) : null}
    </header>
  );
}
