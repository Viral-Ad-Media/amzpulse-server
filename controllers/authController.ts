import { Request, Response } from 'express';
import { registerUser, loginUser, createApiKey } from '../services/authService';
import logger from '../lib/logger';
import supabase, { throwIfError } from '../providers/supabase';

const isValidEmail = (email?: string) => !!email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

export const register = async (req: Request, res: Response) => {
  try {
    const { email, password, name } = req.body;
    if (!isValidEmail(email) || typeof password !== 'string' || password.length < 8) {
      return res.status(400).json({ error: 'Email and password are required (password min 8 chars)' });
    }
    const result = await registerUser({ email, password, name });
    return res.status(201).json({
      token: result.token,
      user: { id: result.user.id, email: result.user.email, name: result.user.name },
      organization: result.organization,
      plan: result.organization.plan || 'free',
      planRenewsAt: result.organization.planRenewsAt || null
    });
  } catch (err) {
    logger.warn('Registration failed', { error: err });
    return res.status(400).json({ error: (err as Error).message });
  }
};

export const login = async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;
    if (!isValidEmail(email) || typeof password !== 'string') {
      return res.status(400).json({ error: 'Invalid credentials' });
    }
    const result = await loginUser({ email, password });
    const org = throwIfError<any>(
      await supabase
        .from('Organization')
        .select('plan, planRenewsAt')
        .eq('id', result.organizationId)
        .maybeSingle()
    );
    return res.json({
      token: result.token,
      user: { id: result.user.id, email: result.user.email, name: result.user.name },
      organizationId: result.organizationId,
      role: result.role,
      plan: org?.plan || 'free',
      planRenewsAt: org?.planRenewsAt || null
    });
  } catch (err) {
    logger.warn('Login failed', { error: err });
    return res.status(401).json({ error: 'Invalid credentials' });
  }
};

export const me = async (req: Request, res: Response) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const user = throwIfError<any>(
    await supabase.from('User').select('id, email, name').eq('id', req.user.userId).maybeSingle()
  );
  const org = throwIfError<any>(
    await supabase.from('Organization').select('plan, planRenewsAt').eq('id', req.user.organizationId).maybeSingle()
  );
  return res.json({ user, organizationId: req.user.organizationId, role: req.user.role, plan: org?.plan || 'free', planRenewsAt: org?.planRenewsAt || null });
};

export const listApiKeys = async (req: Request, res: Response) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
  const keys = throwIfError<any[]>(
    await supabase
      .from('ApiKey')
      .select('id, label, createdAt, lastUsedAt, expiresAt, revoked')
      .eq('organizationId', req.user.organizationId)
  ) || [];
  return res.json(keys);
};

export const createApiKeyHandler = async (req: Request, res: Response) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const { label, expiresAt } = req.body;
    const expiryDate = expiresAt ? new Date(expiresAt) : undefined;
    const result = await createApiKey({
      label,
      organizationId: req.user.organizationId,
      userId: req.user.userId,
      expiresAt: expiryDate
    });
    return res.status(201).json({
      key: result.key,
      apiKey: {
        id: result.apiKey.id,
        label: result.apiKey.label,
        createdAt: result.apiKey.createdAt,
        expiresAt: result.apiKey.expiresAt,
        revoked: result.apiKey.revoked
      }
    });
  } catch (err) {
    logger.warn('API key creation failed', { error: err });
    return res.status(400).json({ error: (err as Error).message });
  }
};
