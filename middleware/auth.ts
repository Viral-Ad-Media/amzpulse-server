import { Request, Response, NextFunction } from "express";
import { identity, identityHeaders } from "../services/identityService";
import { validateApiKey } from "../services/authService";
import logger from "../lib/logger";
import database, { throwIfError } from "../providers/database";

export const requireAuth = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const authHeader = req.headers.authorization;
  const apiKeyHeader = req.headers["x-api-key"];

  let context = null;

  if (authHeader && authHeader.startsWith("Bearer ")) {
    const auth = await identity();
    const session = await auth.api.getSession({
      headers: identityHeaders(authHeader),
    });
    if (session?.user) {
      const membership: any = throwIfError(
        await database
          .from("Membership")
          .select("organizationId,role")
          .eq("userId", session.user.id)
          .order("createdAt")
          .limit(1)
          .maybeSingle(),
      );
      if (!membership)
        return res.status(401).json({ error: "Session expired" });
      context = {
        userId: session.user.id,
        organizationId: membership.organizationId,
        email: session.user.email,
        role: membership.role,
      };
    }
  }

  if (!context && typeof apiKeyHeader === "string") {
    try {
      context = await validateApiKey(apiKeyHeader);
    } catch (err) {
      logger.warn("API key validation failed", { error: err });
    }
  }

  if (!context) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  req.user = context;
  return next();
};

export default requireAuth;
