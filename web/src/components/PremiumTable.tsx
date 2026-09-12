import { useEffect, useMemo, useRef, useState } from 'react';

import { FX_EM_DASH } from '../lib/formatFx';
import {
  formatJpy,
  formatKrw,
  formatSignedPct,
  formatUsd,
  formatVolume100MKrw,
} from '../lib/formatMoney';
import {
  buildPremiumTableRows,
  rowIsStale,
  rowOmitsPremium,
  sortPremiumTableRows,
  staleAgeTooltip,
  type PremiumPair,
  type PremiumTableRow,
  type PremiumTableSortKey,
  type SortDirection,
} from '../lib/premiumTable';
import type { MarketSnapshot } from '../lib/types';
import './PremiumTable.css';

function flashDirection(
  previous: number | undefined,
  next: number | undefined,
): 'up' | 'down' | null {
  if (previous === undefined || next === undefined || previous === next) {
    return null;
  }
  return next > previous ? 'up' : 'down';
}

const SORT_COLUMNS: { key: PremiumTableSortKey; label: string; col: string }[] = [
  { key: 'coin', label: 'Coin', col: 'coin' },
  { key: 'premium', label: 'Premium', col: 'premium' },
  { key: 'target', label: 'Target', col: 'target' },
  { key: 'targetKrw', label: 'Target KRW', col: 'targetKrw' },
  { key: 'upbit', label: 'Upbit (KRW)', col: 'upbit' },
  { key: 'change', label: 'Change', col: 'change' },
  { key: 'volume', label: 'Vol (×100M KRW)', col: 'volume' },
];

export interface PremiumTableProps {
  pair: PremiumPair;
  snapshot: MarketSnapshot | null;
}

export function PremiumTable({ pair, snapshot }: PremiumTableProps) {
  const [sortKey, setSortKey] = useState<PremiumTableSortKey>('premium');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [flashes, setFlashes] = useState<Partial<Record<string, 'up' | 'down'>>>({});
  const previousUpbit = useRef<Partial<Record<string, number>>>({});

  const title = pair === 'binance' ? 'Upbit vs Binance' : 'Upbit vs Bitbank';
  const targetHeader = pair === 'binance' ? 'Binance ($)' : 'Bitbank (JPY)';

  const built = useMemo(() => buildPremiumTableRows(snapshot, pair), [snapshot, pair]);

  useEffect(() => {
    const next: Partial<Record<string, 'up' | 'down'>> = {};
    for (const row of built) {
      const direction = flashDirection(previousUpbit.current[row.symbol], row.upbitPrice);
      if (direction) {
        next[row.symbol] = direction;
      }
      previousUpbit.current[row.symbol] = row.upbitPrice;
    }
    setFlashes(next);
  }, [built]);

  const sorted = useMemo(
    () => sortPremiumTableRows(built, sortKey, sortDirection),
    [built, sortKey, sortDirection],
  );

  function onSort(key: PremiumTableSortKey) {
    if (key === sortKey) {
      setSortDirection((current) => (current === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setSortKey(key);
    setSortDirection(key === 'coin' ? 'asc' : 'desc');
  }

  return (
    <section className="premium-table" data-pair={pair}>
      <h2 className="premium-table__title">{title}</h2>
      <div
        className="premium-table__scroll"
        tabIndex={0}
        role="region"
        aria-label={`${title} table`}
      >
        <table>
          <thead>
            <tr>
              {SORT_COLUMNS.map((column) => (
                <th key={column.key} scope="col" data-col={column.col}>
                  <button
                    type="button"
                    className="premium-table__sort"
                    onClick={() => {
                      onSort(column.key);
                    }}
                    aria-pressed={sortKey === column.key}
                  >
                    {column.key === 'target' ? targetHeader : column.label}
                    {sortKey === column.key ? (sortDirection === 'asc' ? ' ↑' : ' ↓') : ''}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((row) => (
              <PremiumTableBodyRow
                key={row.symbol}
                row={row}
                pair={pair}
                flash={flashes[row.symbol] ?? null}
              />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function PremiumTableBodyRow({
  row,
  pair,
  flash,
}: {
  row: PremiumTableRow;
  pair: PremiumPair;
  flash: 'up' | 'down' | null;
}) {
  const stale = rowIsStale(row);
  const omit = rowOmitsPremium(row);
  const premiumSign =
    omit || row.premiumPct === undefined ? undefined : row.premiumPct >= 0 ? 'up' : 'down';
  const tint = !omit && row.premiumPct !== undefined && Math.abs(row.premiumPct) >= 1;

  return (
    <tr
      className="premium-table__row"
      data-stale={stale ? 'true' : undefined}
      title={staleAgeTooltip(row)}
      data-omit={omit ? 'true' : undefined}
      data-tint={tint ? 'true' : undefined}
      data-flash={flash ?? undefined}
    >
      <th scope="row" data-col="coin">
        {row.symbol}
      </th>
      <td
        data-col="premium"
        className="tabular-nums premium-table__premium"
        data-sign={premiumSign}
        aria-live="off"
        aria-label={`${row.symbol} premium`}
      >
        {omit
          ? FX_EM_DASH
          : `${formatKrw(row.premiumDiffKrw)} (${row.premiumPct === undefined ? FX_EM_DASH : `${formatSignedPct(row.premiumPct)}%`})`}
      </td>
      <td data-col="target" className="tabular-nums" aria-live="off">
        {pair === 'binance' ? formatUsd(row.targetPrice) : formatJpy(row.targetPrice)}
      </td>
      <td data-col="targetKrw" className="tabular-nums premium-table__dim" aria-live="off">
        {formatKrw(row.targetKrw)}
      </td>
      <td data-col="upbit" className="tabular-nums" aria-live="off">
        {formatKrw(row.upbitPrice)}
      </td>
      <td
        data-col="change"
        className="tabular-nums"
        data-sign={
          row.change24hPct === undefined ? undefined : row.change24hPct >= 0 ? 'up' : 'down'
        }
        aria-live="off"
      >
        {formatSignedPct(row.change24hPct)}
      </td>
      <td data-col="volume" className="tabular-nums" aria-live="off">
        {formatVolume100MKrw(row.volume24hKrw)}
      </td>
    </tr>
  );
}
