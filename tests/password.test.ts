import test from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword } from '../services/authService';

test('password hashing and verification works', async () => {
  const hash = await hashPassword('P@ssword1234');
  const ok = await verifyPassword('P@ssword1234', hash);
  assert.equal(ok, true);
  const bad = await verifyPassword('wrong', hash);
  assert.equal(bad, false);
});

