import { Request, Response } from 'express';
import { config } from '../config';
import logger from '../lib/logger';
import supabase, { throwIfError } from '../providers/supabase';
import {
  plansPublic,
  getUsage,
  createCheckoutSession,
  requireOwnerOrAdmin,
  getStripeClient,
  handleStripeWebhook
} from '../services/billingService';

export const listPlans = (_req: Request, res: Response) => {
  return res.json(plansPublic());
};

export const usage = async (req: Request, res: Response) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
  const usage = await getUsage(req.user.organizationId);
  const org = throwIfError<any>(
    await supabase
      .from('Organization')
      .select('plan, planRenewsAt')
      .eq('id', req.user.organizationId)
      .maybeSingle()
  );
  return res.json({ ...usage, plan: org?.plan || 'free', planRenewsAt: org?.planRenewsAt || null });
};

export const checkoutSession = async (req: Request, res: Response) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
  if (!requireOwnerOrAdmin(req.user.role)) return res.status(403).json({ error: 'Forbidden' });
  try {
    const session = await createCheckoutSession({
      organizationId: req.user.organizationId,
      userEmail: req.user.email
    });
    return res.status(201).json({ url: session.url });
  } catch (err) {
    logger.warn('Checkout session creation failed', { error: err });
    return res.status(400).json({ error: (err as Error).message });
  }
};

export const webhook = async (req: Request, res: Response) => {
  if (!config.stripeSecretKey || !config.stripeWebhookSecret) {
    return res.status(501).json({ error: 'Stripe not configured' });
  }
  const stripe = getStripeClient();
  if (!stripe) return res.status(501).json({ error: 'Stripe not configured' });

  const sig = req.headers['stripe-signature'];
  if (!sig || typeof sig !== 'string') {
    return res.status(400).json({ error: 'Missing stripe signature' });
  }

  try {
    const event = stripe.webhooks.constructEvent(req.body, sig, config.stripeWebhookSecret);
    await handleStripeWebhook(event);
    return res.json({ received: true });
  } catch (err) {
    logger.warn('Stripe webhook error', { error: err });
    return res.status(400).json({ error: 'Webhook Error' });
  }
};
