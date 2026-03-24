import crypto from 'crypto';
import { config } from '../config';
import { signJwt } from '../lib/jwt';
import logger from '../lib/logger';
import supabase, { requireData, throwIfError } from '../providers/supabase';

const HASH_ALGO = 'scrypt';
const PASSWORD_RESET_TOKEN_BYTES = 32;
const PASSWORD_RESET_MESSAGE = 'If an account exists for that email, a reset link has been generated.';

export type AuthContext = {
  userId: string;
  organizationId: string;
  email?: string;
  role?: string;
  apiKeyId?: string;
};

export const hashPassword = (password: string): Promise<string> => {
  return new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(16);
    crypto.scrypt(password, salt, 64, (err, derivedKey) => {
      if (err) return reject(err);
      resolve(`${HASH_ALGO}:${salt.toString('hex')}:${derivedKey.toString('hex')}`);
    });
  });
};

export const verifyPassword = (password: string, storedHash?: string | null): Promise<boolean> => {
  return new Promise((resolve, reject) => {
    if (!storedHash) return resolve(false);
    const [algo, saltHex, hashHex] = storedHash.split(':');
    if (algo !== HASH_ALGO || !saltHex || !hashHex) return resolve(false);
    const salt = Buffer.from(saltHex, 'hex');
    const hash = Buffer.from(hashHex, 'hex');
    crypto.scrypt(password, salt, hash.length, (err, derivedKey) => {
      if (err) return reject(err);
      resolve(crypto.timingSafeEqual(hash, derivedKey));
    });
  });
};

const hashApiKey = (raw: string) => crypto.createHash('sha256').update(raw).digest('hex');
const hashPasswordResetToken = (raw: string) => crypto.createHash('sha256').update(raw).digest('hex');

const buildPasswordResetUrl = (token: string) =>
  `${config.frontendUrl}/#/reset-password?token=${encodeURIComponent(token)}`;

export const registerUser = async (
  input: { email: string; password: string; name?: string }
): Promise<{ user: any; organization: any; token: string }> => {
  const email = input.email.toLowerCase();
  const existing = throwIfError<any>(
    await supabase.from('User').select('id').eq('email', email).maybeSingle()
  );
  if (existing) {
    throw new Error('User already exists');
  }

  const orgId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  const membershipId = crypto.randomUUID();

  const passwordHash = await hashPassword(input.password);
  const org = requireData<any>(
    await supabase
      .from('Organization')
      .insert({ id: orgId, name: `${input.name || email}'s Workspace` })
      .select()
      .single()
  );

  const user = requireData<any>(
    await supabase
      .from('User')
      .insert({ id: userId, email, name: input.name, passwordHash })
      .select()
      .single()
  );

  throwIfError(
    await supabase
      .from('Membership')
      .insert({ id: membershipId, organizationId: orgId, userId, role: 'owner' })
  );

  const token = signJwt(
    { sub: user.id, orgId: org.id, email: user.email, role: 'owner' },
    config.jwtSecret,
    60 * 60 * 24 * 7
  );

  return { user, organization: org, token };
};

export const loginUser = async (
  input: { email: string; password: string }
): Promise<{ user: any; organizationId: string; role: string; token: string }> => {
  const email = input.email.toLowerCase();
  const user = requireData<any>(
    await supabase
      .from('User')
      .select('id, email, name, passwordHash')
      .eq('email', email)
      .maybeSingle()
  );
  if (!user || !user.passwordHash) {
    throw new Error('Invalid credentials');
  }

  const valid = await verifyPassword(input.password, user.passwordHash);
  if (!valid) {
    throw new Error('Invalid credentials');
  }

  const membership = requireData<any>(
    await supabase
      .from('Membership')
      .select('organizationId, role')
      .eq('userId', user.id)
      .limit(1)
      .maybeSingle()
  );
  if (!membership) {
    throw new Error('No organization assigned');
  }

  const token = signJwt(
    { sub: user.id, orgId: membership.organizationId, email: user.email, role: membership.role },
    config.jwtSecret,
    60 * 60 * 24 * 7
  );

  return { user, organizationId: membership.organizationId, role: membership.role, token };
};

export const createApiKey = async (input: {
  userId: string;
  organizationId: string;
  label?: string;
  expiresAt?: Date;
}): Promise<{ apiKey: any; key: string }> => {
  const rawKey = `ak_${crypto.randomBytes(24).toString('hex')}`;
  const keyHash = hashApiKey(rawKey);
  const id = crypto.randomUUID();

  const apiKey = requireData<any>(
    await supabase
      .from('ApiKey')
      .insert({
        id,
        keyHash,
        label: input.label,
        userId: input.userId,
        organizationId: input.organizationId,
        expiresAt: input.expiresAt ? input.expiresAt.toISOString() : null,
        revoked: false
      })
      .select()
      .single()
  );

  return { apiKey, key: rawKey };
};

export const validateApiKey = async (key: string): Promise<AuthContext | null> => {
  const keyHash = hashApiKey(key);
  const apiKey = throwIfError<any>(
    await supabase
      .from('ApiKey')
      .select('*')
      .eq('keyHash', keyHash)
      .eq('revoked', false)
      .or(`expiresAt.is.null,expiresAt.gt.${new Date().toISOString()}`)
      .maybeSingle()
  );

  if (!apiKey) return null;

  await supabase.from('ApiKey').update({ lastUsedAt: new Date().toISOString() }).eq('id', apiKey.id);

  const membership = throwIfError<any>(
    await supabase
      .from('Membership')
      .select('role')
      .eq('userId', apiKey.userId)
      .eq('organizationId', apiKey.organizationId)
      .maybeSingle()
  );

  return {
    userId: apiKey.userId,
    organizationId: apiKey.organizationId,
    apiKeyId: apiKey.id,
    role: membership?.role
  };
};

export const requestPasswordReset = async (
  input: { email: string }
): Promise<{ message: string; resetToken?: string; resetUrl?: string }> => {
  const email = input.email.toLowerCase();
  const user = throwIfError<any>(
    await supabase.from('User').select('id, email').eq('email', email).maybeSingle()
  );

  if (!user) {
    return { message: PASSWORD_RESET_MESSAGE };
  }

  const rawToken = crypto.randomBytes(PASSWORD_RESET_TOKEN_BYTES).toString('hex');
  const tokenHash = hashPasswordResetToken(rawToken);
  const expiresAt = new Date(Date.now() + config.passwordResetTtlMinutes * 60 * 1000).toISOString();

  await supabase.from('PasswordResetToken').delete().eq('userId', user.id);

  requireData<any>(
    await supabase
      .from('PasswordResetToken')
      .insert({
        id: crypto.randomUUID(),
        userId: user.id,
        tokenHash,
        expiresAt
      })
      .select()
      .single()
  );

  const resetUrl = buildPasswordResetUrl(rawToken);
  if (config.nodeEnv === 'production') {
    logger.info('Password reset requested', { userId: user.id, email: user.email });
    return { message: PASSWORD_RESET_MESSAGE };
  }

  return {
    message: PASSWORD_RESET_MESSAGE,
    resetToken: rawToken,
    resetUrl
  };
};

export const resetPasswordWithToken = async (
  input: { token: string; password: string }
): Promise<{ message: string }> => {
  const tokenHash = hashPasswordResetToken(input.token);
  const resetEntry = throwIfError<any>(
    await supabase
      .from('PasswordResetToken')
      .select('id, userId, expiresAt, usedAt')
      .eq('tokenHash', tokenHash)
      .is('usedAt', null)
      .gt('expiresAt', new Date().toISOString())
      .maybeSingle()
  );

  if (!resetEntry) {
    throw new Error('Reset link is invalid or expired');
  }

  const passwordHash = await hashPassword(input.password);

  throwIfError(
    await supabase
      .from('User')
      .update({ passwordHash })
      .eq('id', resetEntry.userId)
  );

  const usedAt = new Date().toISOString();
  throwIfError(
    await supabase
      .from('PasswordResetToken')
      .update({ usedAt })
      .eq('id', resetEntry.id)
  );

  await supabase
    .from('PasswordResetToken')
    .delete()
    .eq('userId', resetEntry.userId)
    .neq('id', resetEntry.id);

  return { message: 'Password reset successful. You can now sign in with your new password.' };
};
