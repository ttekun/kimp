import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  CONTENT_SECURITY_POLICY,
  HSTS_VALUE,
  securityHeaders,
} from '../../src/transport/securityHeaders.js';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('securityHeaders', () => {
  it('allows browser market feeds while restricting other resources to self', () => {
    const headers = securityHeaders(false);
    expect(headers['content-security-policy']).toBe(CONTENT_SECURITY_POLICY);
    expect(headers['content-security-policy']).toContain("default-src 'self'");
    expect(headers['content-security-policy']).toContain('wss://stream.binance.com:443');
    expect(headers['content-security-policy']).toContain('https://open.er-api.com');
    expect(headers['strict-transport-security']).toBeUndefined();
  });

  it('adds HSTS only when ENABLE_HSTS=1', () => {
    vi.stubEnv('ENABLE_HSTS', '1');
    expect(securityHeaders()['strict-transport-security']).toBe(HSTS_VALUE);
    vi.stubEnv('ENABLE_HSTS', '0');
    expect(securityHeaders()['strict-transport-security']).toBeUndefined();
  });
});

it('keeps browser feed CSP consistent between static and Node hosting', () => {
  const html = readFileSync(new URL('../../../web/index.html', import.meta.url), 'utf8');
  const connectSrc = CONTENT_SECURITY_POLICY.split('; ').find((value) =>
    value.startsWith('connect-src'),
  )!;
  expect(html).toContain(connectSrc);
});
