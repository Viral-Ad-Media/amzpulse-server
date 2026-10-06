import { Request, Response, NextFunction } from "express";
import { verifyJwt } from "../lib/jwt";
import { config } from "../config";
import { validateApiKey } from "../services/authService";
import logger from "../lib/logger";
import supabase, { throwIfError } from "../providers/supabase";

export const requireAuth = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const authHeader = req.headers.authorization;
  const apiKeyHeader = req.headers["x-api-key"];

  let context = null;

  if (authHeader && authHeader.startsWith("Bearer ")) {
    const token = authHeader.replace("Bearer ", "").trim();
    const payload = verifyJwt(token, config.jwtSecret);
    if (payload) {
      const user: any = throwIfError(
        await supabase
          .from("User")
          .select("tokenVersion,email")
          .eq("id", payload.sub)
          .maybeSingle(),
      );
      const membership: any = throwIfError(
        await supabase
          .from("Membership")
          .select("role")
          .eq("userId", payload.sub)
          .eq("organizationId", payload.orgId)
          .maybeSingle(),
      );
      if (!user || !membership || payload.version !== user.tokenVersion)
        return res.status(401).json({ error: "Session expired" });
      context = {
        userId: payload.sub,
        organizationId: payload.orgId,
        email: user.email,
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
