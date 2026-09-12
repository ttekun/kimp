import {
  ER_API_ATTRIBUTION_HREF,
  ER_API_ATTRIBUTION_LABEL,
  fxAttributionKind,
} from '../lib/fxAttribution';
import type { MarketSnapshot } from '../lib/types';
import './AppFooter.css';

export interface AppFooterProps {
  snapshot: MarketSnapshot | null;
}

export function AppFooter({ snapshot }: AppFooterProps) {
  const kind = fxAttributionKind(snapshot);

  return (
    <footer className="app-footer">
      {kind === 'er-api' ? (
        <p>
          <a href={ER_API_ATTRIBUTION_HREF}>{ER_API_ATTRIBUTION_LABEL}</a>
        </p>
      ) : null}
      {kind === 'frankfurter' ? (
        <p>
          FX rates currently from <a href="https://www.frankfurter.dev">Frankfurter</a> (ECB
          reference). Exchange Rate API attribution does not apply because those rates are not in
          use.
        </p>
      ) : null}
      {kind === 'unknown' ? <p>FX source not yet available.</p> : null}
      <nav className="app-footer__docs" aria-label="Exchange documentation">
        <a href="https://docs.upbit.com">Upbit docs</a>
        <a href="https://developers.binance.com/docs/binance-spot-api-docs">Binance docs</a>
        <a href="https://github.com/bitbankinc/bitbank-api-docs">Bitbank docs</a>
      </nav>
    </footer>
  );
}
