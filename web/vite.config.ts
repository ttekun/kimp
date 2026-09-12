import path from 'node:path';
import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const webRoot = path.dirname(fileURLToPath(import.meta.url));
const serverSrc = path.resolve(webRoot, '../server/src');

export const kimchiAliases = {
  '@kimchi/server-types': path.join(serverSrc, 'core/types.ts'),
  '@kimchi/server-symbols': path.join(serverSrc, 'core/symbols.ts'),
  '@kimchi/core/snapshot': path.join(serverSrc, 'core/snapshot.ts'),
  '@kimchi/core/premium': path.join(serverSrc, 'core/premium.ts'),
  '@kimchi/core/symbols': path.join(serverSrc, 'core/symbols.ts'),
  '@kimchi/upbit-wire': path.join(serverSrc, 'connectors/upbitWire.ts'),
  '@kimchi/binance-wire': path.join(serverSrc, 'connectors/binanceWire.ts'),
  '@kimchi/bitbank-wire': path.join(serverSrc, 'connectors/bitbankWire.ts'),
  '@kimchi/fx-normalize': path.join(serverSrc, 'connectors/fxNormalize.ts'),
};

export default defineConfig({
  base: process.env.GITHUB_PAGES === 'true' ? '/kimp/' : '/',
  plugins: [
    react(),
    {
      name: 'strip-csp-in-dev',
      transformIndexHtml(html, ctx) {
        if (ctx.server) {
          return html.replace(/<meta\s+http-equiv="Content-Security-Policy"[^>]*>\s*/i, '');
        }
        return html;
      },
    },
  ],
  resolve: {
    alias: kimchiAliases,
  },
});
