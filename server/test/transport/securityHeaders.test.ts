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
  it('always includes CSP default-src self (no exchange origins)', () => {
    const headers = securityHeaders(false);
    expect(headers['content-security-policy']).toBe(CONTENT_SECURITY_POLICY);
    expect(headers['content-security-policy']).toContain("default-src 'self'");
    expect(headers['content-security-policy']).not.toContain('binance.com');
    expect(headers['strict-transport-security']).toBeUndefined();
  });

  it('adds HSTS only when ENABLE_HSTS=1', () => {
    vi.stubEnv('ENABLE_HSTS', '1');
    expect(securityHeaders()['strict-transport-security']).toBe(HSTS_VALUE);
    vi.stubEnv('ENABLE_HSTS', '0');
    expect(securityHeaders()['strict-transport-security']).toBeUndefined();
  });
});
