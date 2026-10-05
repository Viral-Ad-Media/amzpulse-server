import { ensureRedis } from "../providers/redis";
import { config } from "../config";
import logger from "../lib/logger";
import supabase, { requireData, throwIfError } from "../providers/supabase";
import crypto from "crypto";

type PlanName = "free" | "pro";

type PlanConfig = {
  name: PlanName;
  monthlyAsinQuota: number;
  maxBatchSize: number;
  price: number;
  description: string;
};

const plans: Record<PlanName, PlanConfig> = {
  free: {
    name: "free",
    monthlyAsinQuota: 300,
    maxBatchSize: 20,
    price: 0,
    description: "Starter plan with limited batch analysis.",
  },
  pro: {
    name: "pro",
    monthlyAsinQuota: 5000,
    maxBatchSize: 100,
    price: 99,
    description: "Full access to batch analysis with higher limits.",
  },
};

const currentMonthKey = () => {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
};

export const getUsage = async (organizationId: string): Promise<any> => {
  const month = currentMonthKey();
  throwIfError(
    await supabase
      .from("OrganizationUsage")
      .upsert(
        { organizationId, month },
        { onConflict: "organizationId,month", ignoreDuplicates: true },
      ),
  );
  return requireData(
    await supabase
      .from("OrganizationUsage")
      .select("*")
      .eq("organizationId", organizationId)
      .eq("month", month)
      .single(),
  );
};
export const reserveUsage = async (
  organizationId: string,
  count: number,
  kind: "asin" | "ai" = "asin",
  batch = false,
): Promise<string> => {
  const id = crypto.randomUUID();
  return requireData(
    await supabase.rpc("reserve_usage", {
      p_org: organizationId,
      p_units: count,
      p_kind: kind,
      p_id: id,
      p_batch: batch,
    }),
  );
};
export const settleUsage = async (id: string, success: number) => {
  throwIfError(
    await supabase.rpc("settle_usage", { p_id: id, p_success: success }),
  );
};
export const plansPublic = () =>
  Object.values(plans).map((p) => ({
    name: p.name,
    monthlyAsinQuota: p.monthlyAsinQuota,
    maxBatchSize: p.maxBatchSize,
    price: p.price,
    description: p.description,
  }));

export const requireOwnerOrAdmin = (role?: string | null) => {
  return role === "owner" || role === "admin";
};

export const getStripeClient = () => {
  if (!config.stripeSecretKey) return null;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const Stripe = require("stripe");
  return new Stripe(config.stripeSecretKey, {
    apiVersion: "2023-10-16",
    timeout: 12000,
    maxNetworkRetries: 0,
  });
};

export const createCheckoutSession = async (opts: {
  organizationId: string;
  userEmail?: string;
}) => {
  const stripe = getStripeClient();
  if (!stripe || !config.stripePricePro)
    throw new Error("Stripe not configured");
  const org: any = requireData(
    await supabase
      .from("Organization")
      .select("id,stripeCustomerId,stripeSubscriptionId")
      .eq("id", opts.organizationId)
      .single(),
  );
  const customer =
    org.stripeCustomerId ||
    (
      await stripe.customers.create(
        {
          email: opts.userEmail,
          metadata: { organizationId: opts.organizationId },
        },
        { idempotencyKey: `customer-${opts.organizationId}` },
      )
    ).id;
  throwIfError(
    await supabase
      .from("Organization")
      .update({ stripeCustomerId: customer })
      .eq("id", org.id),
  );
  const subscriptions = await stripe.subscriptions.list({
    customer,
    status: "all",
    limit: 100,
  });
  if (
    subscriptions.data.some(
      (sub: any) => !["canceled", "incomplete_expired"].includes(sub.status),
    )
  ) {
    return stripe.billingPortal.sessions.create({
      customer,
      return_url: `${config.frontendUrl}/#/app`,
    });
  }
  const pending = await stripe.checkout.sessions.list({
    customer,
    status: "open",
    limit: 100,
  });
  const previous = pending.data.find(
    (session: any) =>
      session.mode === "subscription" &&
      session.metadata?.organizationId === org.id,
  );
  if (previous) return previous;
  // A short idempotency window covers parallel double-clicks without reusing expired sessions.
  const window = Math.floor(Date.now() / 600000);
  return stripe.checkout.sessions.create(
    {
      mode: "subscription",
      customer,
      line_items: [{ price: config.stripePricePro, quantity: 1 }],
      success_url: `${config.frontendUrl}/#/billing/success`,
      cancel_url: `${config.frontendUrl}/#/billing/cancel`,
      subscription_data: { metadata: { organizationId: org.id } },
      metadata: { organizationId: org.id },
    },
    { idempotencyKey: `checkout-${org.id}-${window}` },
  );
};
export const subscriptionEntitled = (
  subscription: any,
  priceId: string | undefined,
) =>
  Boolean(
    priceId &&
    ["active", "trialing"].includes(subscription.status) &&
    subscription.items?.data?.some((item: any) => item.price?.id === priceId) &&
    subscription.current_period_end * 1000 > Date.now(),
  );
export const handleStripeWebhook = async (event: any) => {
  const supported = [
    "checkout.session.completed",
    "checkout.session.async_payment_succeeded",
    "customer.subscription.created",
    "customer.subscription.updated",
    "customer.subscription.deleted",
    "invoice.paid",
    "invoice.payment_failed",
  ];
  if (!supported.includes(event.type)) return;
  const data = event.data.object;
  const customer =
    typeof data.customer === "string" ? data.customer : data.customer?.id;
  if (!customer) throw new Error("Missing billing customer");
  const org: any = throwIfError(
    await supabase
      .from("Organization")
      .select("id,stripeSubscriptionId")
      .eq("stripeCustomerId", customer)
      .maybeSingle(),
  );
  if (!org) return; // unrelated products in the same Stripe account
  const stripe = getStripeClient();
  if (!stripe) throw new Error("Stripe not configured");
  // Serialize fetch/apply across workers, including events created in the same second.
  const redis = await ensureRedis();
  const lock = `amzpulse:billing:${org.id}`,
    owner = crypto.randomUUID();
  if (redis && (await redis.set(lock, owner, "PX", 45000, "NX")) !== "OK")
    throw new Error("Billing update busy; retry event");
  try {
    // Re-fetch Stripe state, not the potentially stale event snapshot. Ignore an old deletion.
    const list = await stripe.subscriptions.list({
      customer,
      status: "all",
      limit: 100,
    });
    const relevant = list.data.filter(
      (sub: any) => sub.metadata?.organizationId === org.id,
    );
    const active = relevant.find((sub: any) =>
      subscriptionEntitled(sub, config.stripePricePro),
    );
    const current =
      active || relevant.sort((a: any, b: any) => b.created - a.created)[0];
    if (!current) return;
    throwIfError(
      await supabase.rpc("apply_subscription", {
        p_org: org.id,
        p_customer: customer,
        p_subscription: current.id,
        p_plan: active ? "pro" : "free",
        p_end: current.current_period_end
          ? new Date(current.current_period_end * 1000).toISOString()
          : null,
        p_event_created: event.created,
        p_event_id: event.id,
        p_is_deleted: false,
      }),
    );
  } finally {
    if (redis)
      await redis.eval(
        "if redis.call('get',KEYS[1])==ARGV[1] then return redis.call('del',KEYS[1]) else return 0 end",
        1,
        lock,
        owner,
      );
  }
};

export const effectivePlan = (org: any): PlanName =>
  org?.plan === "pro" && Date.parse(org.planRenewsAt) > Date.now()
    ? "pro"
    : "free";
