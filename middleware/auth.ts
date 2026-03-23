import { Request, Response, NextFunction } from 'express';
import { verifyJwt } from '../lib/jwt';
import { config } from '../config';
import { validateApiKey } from '../services/authService';
import logger from '../lib/logger';

export const requireAuth = async (req: Request, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  const apiKeyHeader = req.headers['x-api-key'];

  let context = null;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.replace('Bearer ', '').trim();
    const payload = verifyJwt(token, config.jwtSecret);
    if (payload) {
      context = {
        userId: payload.sub,
        organizationId: payload.orgId,
        email: payload.email,
        role: (payload as any).role
      };
    }
  }

  if (!context && typeof apiKeyHeader === 'string') {
    try {
      context = await validateApiKey(apiKeyHeader);
    } catch (err) {
      logger.warn('API key validation failed', { error: err });
    }
  }

  if (!context) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  req.user = context;
  return next();
};

export default requireAuth;

