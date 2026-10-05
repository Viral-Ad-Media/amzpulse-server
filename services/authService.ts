import crypto from "crypto";
import { config } from "../config";
import { signJwt } from "../lib/jwt";
import { hashPassword, verifyPassword } from "../lib/password";
import supabase, { requireData, throwIfError } from "../providers/supabase";
export { hashPassword, verifyPassword } from "../lib/password";
export type AuthContext = {
  userId: string;
  organizationId: string;
  email?: string;
  role?: string;
  apiKeyId?: string;
};
const hash = (raw: string) =>
  crypto.createHash("sha256").update(raw).digest("hex");
const tokenFor = (user: any, orgId: string, role: string) =>
  signJwt(
    {
      sub: user.id,
      orgId,
      email: user.email,
      role,
      version: user.tokenVersion,
    },
    config.jwtSecret,
    3600,
  );
export const registerUser = async (input: {
  email: string;
  password: string;
  name?: string;
}) => {
  const result: any = requireData(
    await supabase.rpc("register_account", {
      p_email: input.email.trim().toLowerCase(),
      p_name: input.name || null,
      p_hash: await hashPassword(input.password),
    }),
  );
  return {
    ...result,
    token: tokenFor(result.user, result.organization.id, "owner"),
  };
};
export const loginUser = async (input: { email: string; password: string }) => {
  const user: any = throwIfError(
    await supabase
      .from("User")
      .select("id,email,name,passwordHash,tokenVersion")
      .eq("email", input.email.trim().toLowerCase())
      .maybeSingle(),
  );
  if (!user || !(await verifyPassword(input.password, user.passwordHash)))
    throw new Error("Invalid credentials");
  const membership: any = requireData(
    await supabase
      .from("Membership")
      .select("organizationId,role")
      .eq("userId", user.id)
      .order("createdAt")
      .limit(1)
      .maybeSingle(),
  );
  return {
    user,
    organizationId: membership.organizationId,
    role: membership.role,
    token: tokenFor(user, membership.organizationId, membership.role),
  };
};
export const createApiKey = async (input: {
  userId: string;
  organizationId: string;
  label?: string;
  expiresAt?: Date;
}) => {
  const key = `ak_${crypto.randomBytes(24).toString("hex")}`;
  const apiKey = requireData<any>(
    await supabase
      .from("ApiKey")
      .insert({
        id: crypto.randomUUID(),
        keyHash: hash(key),
        label: input.label,
        userId: input.userId,
        organizationId: input.organizationId,
        expiresAt: input.expiresAt?.toISOString() || null,
        revoked: false,
      })
      .select()
      .single(),
  );
  return { apiKey, key };
};
export const validateApiKey = async (
  key: string,
): Promise<AuthContext | null> => {
  if (!/^ak_[a-f0-9]{48}$/.test(key)) return null;
  const apiKey: any = throwIfError(
    await supabase
      .from("ApiKey")
      .select("*")
      .eq("keyHash", hash(key))
      .eq("revoked", false)
      .or(`expiresAt.is.null,expiresAt.gt.${new Date().toISOString()}`)
      .maybeSingle(),
  );
  if (!apiKey) return null;
  const membership: any = throwIfError(
    await supabase
      .from("Membership")
      .select("role")
      .eq("userId", apiKey.userId)
      .eq("organizationId", apiKey.organizationId)
      .maybeSingle(),
  );
  if (!membership) return null;
  throwIfError(
    await supabase
      .from("ApiKey")
      .update({ lastUsedAt: new Date().toISOString() })
      .eq("id", apiKey.id),
  );
  return {
    userId: apiKey.userId,
    organizationId: apiKey.organizationId,
    apiKeyId: apiKey.id,
    role: membership.role,
  };
};
export const requestPasswordReset = async (input: { email: string }) => {
  // Never return reset credentials to the caller, including development deployments.
  if (!process.env.RESEND_API_KEY || !process.env.PASSWORD_RESET_FROM)
    throw new Error("Password recovery email is not configured");
  const message =
    "If an account exists for that email, a password reset email will be sent.";
  const user: any = throwIfError(
    await supabase
      .from("User")
      .select("id,email")
      .eq("email", input.email.trim().toLowerCase())
      .maybeSingle(),
  );
  if (!user) return { message };
  const raw = crypto.randomBytes(32).toString("hex");
  throwIfError(
    await supabase
      .from("PasswordResetToken")
      .insert({
        id: crypto.randomUUID(),
        userId: user.id,
        tokenHash: hash(raw),
        expiresAt: new Date(
          Date.now() + config.passwordResetTtlMinutes * 60000,
        ).toISOString(),
      }),
  );
  const url = `${config.frontendUrl}/#/reset-password?token=${encodeURIComponent(raw)}`;
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      signal: AbortSignal.timeout(10000),
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: process.env.PASSWORD_RESET_FROM,
        to: [user.email],
        subject: "Reset your AmzPulse password",
        text: `Open this link to reset your password: ${url}\nThis link expires in ${config.passwordResetTtlMinutes} minutes. If you did not request this, ignore this email.`,
      }),
    });
    if (!response.ok)
      throw new Error("Password recovery email could not be delivered");
  } catch (error) {
    throwIfError(
      await supabase
        .from("PasswordResetToken")
        .delete()
        .eq("tokenHash", hash(raw)),
    );
    throw error;
  }
  return { message };
};
export const resetPasswordWithToken = async (input: {
  token: string;
  password: string;
}) => {
  const ok = requireData(
    await supabase.rpc("reset_account_password", {
      p_token_hash: hash(input.token),
      p_password_hash: await hashPassword(input.password),
    }),
  );
  if (!ok) throw new Error("Reset link is invalid or expired");
  return {
    message: "Password reset successful. Sign in with your new password.",
  };
};
