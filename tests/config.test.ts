import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../config';

test('loadConfig falls back to defaults', () => {
  const cfg = loadConfig({});
  assert.equal(cfg.port, 3001);
  assert.equal(cfg.rateLimit.max, 100);
  assert.equal(cfg.enableMetricsSync, false);
  assert.ok(cfg.jwtSecret.length > 0);
});

test('loadConfig respects environment overrides', () => {
  const cfg = loadConfig({
    PORT: '4000',
    RATE_LIMIT_MAX: '5',
    ENABLE_METRICS_SYNC: 'true',
    CACHE_TTL_SECONDS: '10',
    FRONTEND_URL: 'https://app.example.com, https://example.com/amzpulse/'
  } as any);

  assert.equal(cfg.port, 4000);
  assert.equal(cfg.rateLimit.max, 5);
  assert.equal(cfg.enableMetricsSync, true);
  assert.equal(cfg.cacheTtlSeconds, 10);
  assert.equal(cfg.frontendUrl, 'https://app.example.com');
  assert.deepEqual(cfg.frontendUrls, ['https://app.example.com', 'https://example.com/amzpulse']);
  assert.deepEqual(cfg.frontendOrigins, ['https://app.example.com', 'https://example.com']);
});
