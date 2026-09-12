import { z } from 'zod';

/**
 * Minimal Upbit REST/WS ticker wire shape (docs/03-api-integration.md).
 * REST uses `market`; live WS (format DEFAULT) uses `code` for the same identifier.
 * Kept separate from core/schemas.ts, which validates internal normalized shapes.
 */
export const upbitWireTickerSchema = z
  .object({
    market: z.string().min(1).optional(),
    code: z.string().min(1).optional(),
    trade_price: z.number(),
    signed_change_rate: z.number(),
    acc_trade_price_24h: z.number(),
    timestamp: z.number().int().nonnegative(),
    trade_date: z.string().optional(),
  })
  .refine((wire) => wire.market !== undefined || wire.code !== undefined, {
    message: 'Upbit ticker wire payload must include market (REST) or code (WS)',
  });

export type UpbitWireTicker = z.infer<typeof upbitWireTickerSchema>;

/** Resolves KRW-XXX market code from either REST (`market`) or WS (`code`) wire fields. */
export function resolveUpbitWireMarketCode(wire: UpbitWireTicker): string {
  return wire.market ?? wire.code!;
}

export const upbitRestTickerArraySchema = z.array(upbitWireTickerSchema);
