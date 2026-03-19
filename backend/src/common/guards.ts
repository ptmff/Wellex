import { Request, Response, NextFunction } from 'express';
import { AuthService } from '../modules/auth/auth.service';
import { db } from '../database/connection';
import { userCache } from '../infrastructure/redis/cache.service';
import { UnauthorizedError, ForbiddenError } from './errors';
import { config } from '../config';

declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        email: string;
        username: string;
        role: 'user' | 'moderator' | 'admin';
        status: string;
      };
    }
  }
}

const authService = new AuthService();

export function authenticate(required = true) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    const authHeader = req.headers.authorization;

    if (!authHeader?.startsWith('Bearer ')) {
      if (required) return next(new UnauthorizedError('No authorization token provided'));
      return next();
    }

    const token = authHeader.slice(7);

    try {
      const payload = authService.verifyAccessToken(token);

      // Try cache first
      const cacheKey = `user:${payload.sub}`;
      let user = await userCache.get<Express.Request['user']>(cacheKey);

      if (!user) {
        const dbUser = await db('users')
          .select('id', 'email', 'username', 'role', 'status')
          .where('id', payload.sub)
          .first();

        if (!dbUser) {
          return next(new UnauthorizedError('User not found'));
        }

        user = dbUser;
        await userCache.set(cacheKey, user, 60); // 1 minute cache
      }

      if (user!.status !== 'active') {
        return next(new UnauthorizedError('Account is not active'));
      }

      req.user = user!;
      next();
    } catch (err) {
      if (required) return next(err);
      next();
    }
  };
}

export function requireRole(...roles: ('user' | 'moderator' | 'admin')[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      return next(new UnauthorizedError());
    }

    const roleHierarchy = { user: 0, moderator: 1, admin: 2 };
    const userLevel = roleHierarchy[req.user.role];
    const requiredLevel = Math.min(...roles.map((r) => roleHierarchy[r]));

    if (userLevel < requiredLevel) {
      return next(new ForbiddenError('Insufficient permissions'));
    }

    next();
  };
}

export function requireOwnerOrAdmin(getResourceUserId: (req: Request) => string | Promise<string>) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    if (!req.user) return next(new UnauthorizedError());

    if (req.user.role === 'admin') return next();

    try {
      const resourceUserId = await getResourceUserId(req);
      if (req.user.id !== resourceUserId) {
        return next(new ForbiddenError());
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}

// Admin API key auth (for internal/admin endpoints)
export function requireAdminKey(req: Request, _res: Response, next: NextFunction): void {
  const key = req.headers['x-admin-key'];
  if (key !== config.ADMIN_SECRET_KEY) {
    return next(new ForbiddenError('Invalid admin key'));
  }
  next();
}
