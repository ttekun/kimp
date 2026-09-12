import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import { resolveStaticRoot } from '../../src/aggregator/runtime.js';

const testDir = path.dirname(fileURLToPath(import.meta.url));
/** test/aggregator/ -> test/ -> server/ */
const serverPackageRoot = path.resolve(testDir, '../..');
const repoRoot = path.resolve(serverPackageRoot, '..');

describe('resolveStaticRoot', () => {
  afterEach(() => {
    delete process.env.STATIC_ROOT;
  });

  it('resolves the built SPA outside the server package, not under it', () => {
    delete process.env.STATIC_ROOT;

    const resolved = resolveStaticRoot();

    expect(resolved).toBe(path.join(repoRoot, 'web', 'dist'));
    expect(resolved.startsWith(path.join(serverPackageRoot, path.sep))).toBe(false);
  });

  it('prefers STATIC_ROOT when set', () => {
    process.env.STATIC_ROOT = path.join(repoRoot, 'custom-dist');

    expect(resolveStaticRoot()).toBe(path.join(repoRoot, 'custom-dist'));
  });
});
