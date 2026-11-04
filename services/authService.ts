import crypto from "crypto";
import { config } from "../config";
import { identity, identityHeaders } from "./identityService";
import { hashPassword, verifyPassword } from "../lib/password";
import database, { requireData, throwIfError } from "../providers/database";
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
const profileFor = async (user: any) => {
  const membership: any = requireData(
    await database
      .from("Membership")
      .select("organizationId,role")
      .eq("userId", user.id)
      .order("createdAt")
      .limit(1)
      .maybeSingle(),
  );
  const organization: any = requireData(
    await database
      .from("Organization")
      .select("*")
      .eq("id", membership.organizationId)
      .single(),
  );
  return {
    user: { id: user.id, email: user.email, name: user.name },
    organization,
    organizationId: membership.organizationId,
    role: membership.role,
  };
};
export const registerUser = async (input: {
  email: string;
  password: string;
  name?: string;
}) => {
  const auth = await identity();
  const result = await auth.api.signUpEmail({
    body: {
      email: input.email.trim().toLowerCase(),
      password: input.password,
      name: input.name?.trim() || input.email.trim(),
    },
  });
  if (!result.token) throw new Error("Unable to create session");
  return { ...(await profileFor(result.user)), token: result.token };
};
export const loginUser = async (input: { email: string; password: string }) => {
  const auth = await identity();
  const result = await auth.api.signInEmail({
    body: { email: input.email.trim().toLowerCase(), password: input.password },
  });
  return { ...(await profileFor(result.user)), token: result.token };
};
export const signOut = async (authorization?: string) => {
  const auth = await identity();
  await auth.api.signOut({ headers: identityHeaders(authorization) });
};
export const createApiKey = async (input: {
  userId: string;
  organizationId: string;
  label?: string;
  expiresAt?: Date;
}) => {
  const key = `ak_${crypto.randomBytes(24).toString("hex")}`;
  const apiKey = requireData<any>(
    await database
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
    await database
      .from("ApiKey")
      .select("*")
      .eq("keyHash", hash(key))
      .eq("revoked", false)
      .or(`expiresAt.is.null,expiresAt.gt.${new Date().toISOString()}`)
      .maybeSingle(),
  );
  if (!apiKey) return null;
  const membership: any = throwIfError(
    await database
      .from("Membership")
      .select("role")
      .eq("userId", apiKey.userId)
      .eq("organizationId", apiKey.organizationId)
      .maybeSingle(),
  );
  if (!membership) return null;
  throwIfError(
    await database
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
  if (!process.env.RESEND_API_KEY || !process.env.PASSWORD_RESET_FROM)
    throw new Error("Password recovery email is not configured");
  const auth = await identity();
  await auth.api.requestPasswordReset({
    body: {
      email: input.email.trim().toLowerCase(),
      redirectTo: `${config.frontendUrl}/#/reset-password`,
    },
  });
  return {
    message:
      "If an account exists for that email, a password reset email will be sent.",
  };
};
export const resetPasswordWithToken = async (input: {
  token: string;
  password: string;
}) => {
  const auth = await identity();
  await auth.api.resetPassword({
    body: { token: input.token, newPassword: input.password },
  });
  return {
    message: "Password reset successful. Sign in with your new password.",
  };
};
