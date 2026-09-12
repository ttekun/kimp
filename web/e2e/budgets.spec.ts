import { gzipSync } from 'node:zlib';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test } from '@playwright/test';

const DIST = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const JS_BUDGET_GZ = 200 * 1024;
const CSS_BUDGET_GZ = 30 * 1024;

function gzipSize(filePath: string): number {
  return gzipSync(readFileSync(filePath)).length;
}

function filesWithExt(dir: string, ext: string): string[] {
  if (!existsSync(dir)) {
    return [];
  }
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      out.push(...filesWithExt(full, ext));
    } else if (name.endsWith(ext)) {
      out.push(full);
    }
  }
  return out;
}

test.describe('Task 6.3 landing-page budgets (docs/04)', () => {
  test('production JS gz < 200KB and CSS gz < 30KB', () => {
    test.skip(!existsSync(DIST), 'web/dist missing — run pnpm --filter @kimchi/web build first');

    const jsBytes = filesWithExt(DIST, '.js').reduce((sum, file) => sum + gzipSize(file), 0);
    const cssBytes = filesWithExt(DIST, '.css').reduce((sum, file) => sum + gzipSize(file), 0);

    expect(jsBytes, `JS gzip ${jsBytes} bytes`).toBeLessThan(JS_BUDGET_GZ);
    expect(cssBytes, `CSS gzip ${cssBytes} bytes`).toBeLessThan(CSS_BUDGET_GZ);
  });
});
