import test from 'node:test';
import assert from 'node:assert/strict';
import { signJwt, verifyJwt } from '../lib/jwt';

test('jwt sign and verify round trip', () => {
  const token = signJwt({ sub: 'user-1', orgId: 'org-1', email: 'a@example.com' }, 'secret', 60);
  const payload = verifyJwt(token, 'secret');
  assert(payload);
  assert.equal(payload?.sub, 'user-1');
  assert.equal(payload?.orgId, 'org-1');
});

test('jwt verification fails with wrong secret', () => {
  const token = signJwt({ sub: 'user-1', orgId: 'org-1' }, 'secret', 60);
  const payload = verifyJwt(token, 'other');
  assert.equal(payload, null);
});

