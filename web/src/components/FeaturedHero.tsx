import { useState, type KeyboardEvent } from 'react';

import { formatHeroPremium, krwToUsd, selectHeroRows } from '../lib/featuredHero';
import { FX_EM_DASH } from '../lib/formatFx';
import { formatJpy, formatKrw, formatUsd } from '../lib/formatMoney';
import { COIN_SYMBOLS } from '../lib/premiumTable';
import type { CoinSymbol, MarketSnapshot } from '../lib/types';
import './FeaturedHero.css';

const COIN_COLORS: Record<CoinSymbol, string> = {
  BTC: '#f7931a',
  ETH: '#627eea',
  XRP: '#23292f',
  SOL: '#9945ff',
  DOT: '#e6007a',
  DOGE: '#c2a633',
};

function CoinMark({ symbol }: { symbol: CoinSymbol }) {
  return (
    <svg
      className="featured-hero__icon"
      viewBox="0 0 32 32"
      width="16"
      height="16"
      aria-hidden="true"
    >
      <circle cx="16" cy="16" r="16" fill={COIN_COLORS[symbol]} />
    </svg>
  );
}

export interface FeaturedHeroProps {
  snapshot: MarketSnapshot | null;
}

export function FeaturedHero({ snapshot }: FeaturedHeroProps) {
  const [selected, setSelected] = useState<CoinSymbol>('BTC');
  const { binance, bitbank } = selectHeroRows(snapshot, selected);
  const binancePremium = formatHeroPremium(binance);
  const bitbankPremium = formatHeroPremium(bitbank);
  const usdKrw = snapshot?.fx.usdKrw?.value;
  const upbitUsd = krwToUsd(binance.upbitPrice, usdKrw);

  function onSwitcherKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const index = COIN_SYMBOLS.indexOf(selected);
    let nextIndex = index;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      nextIndex = (index + 1) % COIN_SYMBOLS.length;
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      nextIndex = (index - 1 + COIN_SYMBOLS.length) % COIN_SYMBOLS.length;
    } else if (event.key === 'Home') {
      nextIndex = 0;
    } else if (event.key === 'End') {
      nextIndex = COIN_SYMBOLS.length - 1;
    } else {
      return;
    }
    event.preventDefault();
    const next = COIN_SYMBOLS[nextIndex];
    if (next) {
      setSelected(next);
    }
  }

  return (
    <section className="featured-hero" aria-label={`${selected} featured premium`}>
      <div
        className="featured-hero__switcher"
        role="radiogroup"
        aria-label="Featured coin"
        onKeyDown={onSwitcherKeyDown}
      >
        {COIN_SYMBOLS.map((symbol) => (
          <button
            key={symbol}
            type="button"
            className="featured-hero__coin"
            role="radio"
            aria-checked={selected === symbol}
            tabIndex={selected === symbol ? 0 : -1}
            onClick={() => {
              setSelected(symbol);
            }}
          >
            <CoinMark symbol={symbol} />
            {symbol}
          </button>
        ))}
      </div>

      <div
        className="featured-hero__statement"
        data-stale={binancePremium.stale ? 'true' : undefined}
        data-omit={binancePremium.omit ? 'true' : undefined}
        title={binancePremium.tooltip}
      >
        <p className="featured-hero__leg tabular-nums">
          Upbit KRW {formatKrw(binance.upbitPrice)} (${formatUsd(upbitUsd)})
        </p>
        <p className="featured-hero__leg tabular-nums">
          Binance ${formatUsd(binance.targetPrice)} (KRW {formatKrw(binance.targetKrw)})
        </p>
        <p
          className="featured-hero__premium tabular-nums"
          data-sign={binancePremium.sign}
          aria-label={`${selected} Binance premium`}
        >
          {binancePremium.omit ? FX_EM_DASH : binancePremium.text}
        </p>
      </div>

      <p
        className="featured-hero__bitbank tabular-nums"
        data-stale={bitbankPremium.stale ? 'true' : undefined}
        data-omit={bitbankPremium.omit ? 'true' : undefined}
        title={bitbankPremium.tooltip}
        aria-label={`${selected} Bitbank premium`}
      >
        Bitbank ¥{formatJpy(bitbank.targetPrice)} (KRW {formatKrw(bitbank.targetKrw)}) ·{' '}
        {bitbankPremium.text}
      </p>
    </section>
  );
}
