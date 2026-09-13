/**
 * Browser-facing security headers for the aggregator (serves API + SPA).
 * CSP permits the public feeds used by the browser aggregator.
 */
export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "font-src 'self'",
  "img-src 'self' data:",
  "connect-src 'self' wss://api.upbit.com https://api.upbit.com wss://stream.binance.com wss://stream.binance.com:443 https://api.binance.com wss://stream.bitbank.cc https://stream.bitbank.cc https://open.er-api.com https://api.frankfurter.dev",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
  'upgrade-insecure-requests',
].join('; ');

export const REFERRER_POLICY = 'strict-origin-when-cross-origin';
export const PERMISSIONS_POLICY = 'camera=(), microphone=(), geolocation=()';
export const HSTS_VALUE = 'max-age=31536000; includeSubDomains';

export function hstsEnabled(): boolean {
  return process.env.ENABLE_HSTS === '1';
}

export interface SecurityHeaderMap {
  'content-security-policy': string;
  'x-content-type-options': string;
  'x-frame-options': string;
  'referrer-policy': string;
  'permissions-policy': string;
  'strict-transport-security'?: string;
}

export function securityHeaders(enableHsts = hstsEnabled()): SecurityHeaderMap {
  const headers: SecurityHeaderMap = {
    'content-security-policy': CONTENT_SECURITY_POLICY,
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'referrer-policy': REFERRER_POLICY,
    'permissions-policy': PERMISSIONS_POLICY,
  };

  if (enableHsts) {
    headers['strict-transport-security'] = HSTS_VALUE;
  }

  return headers;
}
