import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { FastifyInstance } from 'fastify';

import { BinanceConnector } from '../connectors/binance.js';
import { BitbankConnector } from '../connectors/bitbank.js';
import { FxPoller } from '../connectors/fx.js';
import { UpbitConnector } from '../connectors/upbit.js';
import { COIN_SYMBOLS } from '../core/symbols.js';
import { buildHttpApi } from '../transport/httpApi.js';
import { registerFaultInjectionRoutes } from '../transport/faultInjection.js';
import {
  createAggregatorSnapshotStore,
  getAggregatorHealth,
  type AggregatorConnectors,
  type AggregatorSnapshotStore,
} from './state.js';

const DEFAULT_PORT = 3000;

export function isFaultInjectionEnabled(): boolean {
  return process.env.FAULT_INJECTION === '1';
}

/**
 * This module lives one directory below the server package's src/ (and dist/) root,
 * so the SPA is three levels up: aggregator/ -> src|dist/ -> server/ -> repo root.
 */
export function resolveStaticRoot(): string {
  if (process.env.STATIC_ROOT) {
    return path.resolve(process.env.STATIC_ROOT);
  }

  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(moduleDir, '../../../web/dist');
}

function resolvePort(): number {
  const raw = process.env.PORT;
  if (!raw) {
    return DEFAULT_PORT;
  }

  const port = /^\d+$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isFinite(port) || port <= 0 || port > 65_535) {
    throw new Error(`Invalid PORT: ${raw}`);
  }

  return port;
}

function logStartupConfig(): void {
  console.log(
    `[aggregator] starting with ${COIN_SYMBOLS.length} coins (${COIN_SYMBOLS.join(', ')})`,
  );
}

export interface AggregatorRuntime {
  app: FastifyInstance;
  connectors: AggregatorConnectors;
  store: AggregatorSnapshotStore;
  shutdown: () => Promise<void>;
}

export interface CreateAggregatorRuntimeOptions {
  port?: number;
  staticRoot?: string;
  host?: string;
  /** When true, registers POST /api/dev/fault. Default: FAULT_INJECTION=1. */
  enableFaultInjection?: boolean;
}

/** Wires real connectors, snapshot store, and HTTP API. Used by the process entry point. */
export async function createAggregatorRuntime(
  options?: CreateAggregatorRuntimeOptions,
): Promise<AggregatorRuntime> {
  logStartupConfig();

  const store = createAggregatorSnapshotStore();

  const upbit = new UpbitConnector({
    onTicker: store.onUpbitTicker,
    onUsdtRate: store.onUpbitUsdtRate,
  });

  const binance = new BinanceConnector({
    onTicker: store.onBinanceTicker,
  });

  const bitbank = new BitbankConnector({
    onTicker: store.onBitbankTicker,
  });

  const fx = new FxPoller({
    onRates: store.onFxRates,
  });

  const connectors: AggregatorConnectors = { upbit, binance, bitbank, fx };

  let app: FastifyInstance | undefined;
  try {
    await Promise.all([upbit.start(), binance.start(), bitbank.start(), fx.start()]);

    const enableFaultInjection = options?.enableFaultInjection ?? isFaultInjectionEnabled();

    app = await buildHttpApi({
      getSnapshot: () => store.getSnapshot(),
      getHealth: () => getAggregatorHealth(connectors),
      staticRoot: options?.staticRoot ?? resolveStaticRoot(),
      registerExtraRoutes: enableFaultInjection
        ? (instance) => {
            registerFaultInjectionRoutes(instance, { connectors, store });
          }
        : undefined,
    });

    const port = options?.port ?? resolvePort();
    const host = options?.host ?? '0.0.0.0';

    await app.listen({ port, host });
    console.log(`[aggregator] listening on http://${host}:${port}`);
    if (enableFaultInjection) {
      console.log('[aggregator] FAULT_INJECTION enabled: POST /api/dev/fault');
    }

    const shutdown = async (): Promise<void> => {
      console.log('[aggregator] shutting down');
      upbit.stop();
      binance.stop();
      bitbank.stop();
      fx.stop();
      await app!.close();
    };

    return { app, connectors, store, shutdown };
  } catch (error) {
    for (const connector of Object.values(connectors)) connector.stop();
    await app?.close();
    throw error;
  }
}
