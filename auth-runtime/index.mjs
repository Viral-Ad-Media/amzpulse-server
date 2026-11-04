import crypto from "node:crypto";
import { betterAuth } from "better-auth";
import { bearer } from "better-auth/plugins/bearer";
import { hashPassword, verifyPassword } from "better-auth/crypto";
import legacy from "../lib/password.js";
export const createAuth = (pool, config) =>
  betterAuth({
    appName: "AmzPulse",
    baseURL: config.authUrl,
    basePath: "/api/identity",
    secret: config.authSecret,
    database: pool,
    user: { modelName: "User" },
    session: {
      modelName: "AuthSession",
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
      cookieCache: { enabled: false },
    },
    account: { modelName: "AuthAccount", accountLinking: { enabled: false } },
    verification: { modelName: "AuthVerification" },
    trustedOrigins: config.frontendOrigins,
    advanced: { database: { generateId: () => crypto.randomUUID() } },
    plugins: [bearer()],
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 12,
      maxPasswordLength: 256,
      revokeSessionsOnPasswordReset: true,
      resetPasswordTokenExpiresIn: (config.passwordResetTtlMinutes || 60) * 60,
      password: {
        hash: hashPassword,
        verify: async ({ hash, password }) => {
          if (hash.startsWith("scrypt:"))
            return legacy.verifyPassword(password, hash);
          try {
            return await verifyPassword({ hash, password });
          } catch {
            return false;
          }
        },
      },
      sendResetPassword: async ({ user, token }) => {
        if (!process.env.RESEND_API_KEY || !process.env.PASSWORD_RESET_FROM)
          throw new Error("Password recovery email is not configured");
        const url = `${config.frontendUrl}/#/reset-password?token=${encodeURIComponent(token)}`;
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
            text: `Open this link to reset your password: ${url}\nIf you did not request this, ignore this email.`,
          }),
        });
        if (!response.ok)
          throw new Error("Password recovery email could not be delivered");
      },
    },
  });
