import { pathToFileURL } from 'node:url';

import { createAggregatorRuntime } from './aggregator/runtime.js';

export type { AggregatorRuntime } from './aggregator/runtime.js';
export { createAggregatorRuntime } from './aggregator/runtime.js';

export async function main(): Promise<void> {
  const { shutdown } = await createAggregatorRuntime();

  const handleSignal = (signal: string): void => {
    console.log(`[aggregator] received ${signal}`);
    void shutdown()
      .then(() => {
        process.exit(0);
      })
      .catch((error: unknown) => {
        console.error('[aggregator] shutdown failed', error);
        process.exit(1);
      });
  };

  process.on('SIGINT', () => handleSignal('SIGINT'));
  process.on('SIGTERM', () => handleSignal('SIGTERM'));
}

function isExecutedAsEntry(): boolean {
  const entry = process.argv[1];
  if (!entry) {
    return false;
  }
  return import.meta.url === pathToFileURL(entry).href;
}

if (isExecutedAsEntry()) {
  main().catch((error: unknown) => {
    console.error('[aggregator] fatal startup error', error);
    process.exit(1);
  });
}
