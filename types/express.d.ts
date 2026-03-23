import { AuthContext } from '../services/authService';

declare global {
  namespace Express {
    interface Request {
      user?: AuthContext;
    }
  }
}

export {};

