import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { z } from 'zod';
import { db } from '../../database/connection';
import { config } from '../../config';
import {
  AppError,
  ErrorCode,
  ConflictError,
  UnauthorizedError,
} from '../../common/errors';
import { logger } from '../../common/logger';
import { userCache } from '../../infrastructure/redis/cache.service';

// ─────────────────────────────────────────────────────────────────
// DTOs
// ─────────────────────────────────────────────────────────────────

export const RegisterDto = z.object({
  email: z.string().email().max(255).toLowerCase(),
  username: z
    .string()
    .min(3)
    .max(50)
    .regex(/^[a-zA-Z0-9_-]+$/, 'Username can only contain letters, numbers, underscores and hyphens'),
  password: z
    .string()
    .min(8)
    .max(100)
    .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
    .regex(/[0-9]/, 'Password must contain at least one number'),
  displayName: z.string().min(1).max(100).optional(),
});

export const LoginDto = z.object({
  email: z.string().email().toLowerCase(),
  password: z.string().min(1),
});

export const RefreshTokenDto = z.object({
  refreshToken: z.string().min(1),
});

export type RegisterInput = z.infer<typeof RegisterDto>;
export type LoginInput = z.infer<typeof LoginDto>;

interface JwtPayload {
  sub: string;
  role: string;
  jti: string;
}

interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

interface AuthResult extends TokenPair {
  user: {
    id: string;
    email: string;
    username: string;
    displayName: string | null;
    role: string;
  };
}

const MAX_FAILED_ATTEMPTS = 5;
const LOCK_DURATION_MINUTES = 15;

export class AuthService {
  async register(input: RegisterInput): Promise<AuthResult> {
    const validated = RegisterDto.parse(input);

    // Check for existing user
    const existingUser = await db('users')
      .where('email', validated.email)
      .orWhere('username', validated.username)
      .first();

    if (existingUser) {
      if (existingUser.email === validated.email) {
        throw new ConflictError('Email already in use');
      }
      throw new ConflictError('Username already taken');
    }

    const passwordHash = await bcrypt.hash(validated.password, 12);

    const user = await db.transaction(async (trx) => {
      const [newUser] = await trx('users')
        .insert({
          email: validated.email,
          username: validated.username,
          password_hash: passwordHash,
          display_name: validated.displayName ?? validated.username,
          role: 'user',
          status: 'active',
        })
        .returning('*');

      // Create initial balance
      await trx('balances').insert({
        user_id: newUser.id,
        available: config.INITIAL_USER_BALANCE.toFixed(8),
        reserved: '0',
        total: config.INITIAL_USER_BALANCE.toFixed(8),
        currency: 'USD',
      });

      // Deposit transaction log
      await trx('balance_transactions').insert({
        user_id: newUser.id,
        type: 'deposit',
        amount: config.INITIAL_USER_BALANCE.toFixed(8),
        balance_before: '0',
        balance_after: config.INITIAL_USER_BALANCE.toFixed(8),
        description: 'Initial demo balance',
      });

      return newUser;
    });

    logger.info('User registered', { userId: user.id, email: user.email });

    const tokens = await this.generateTokenPair(user.id, user.role);

    return {
      ...tokens,
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        displayName: user.display_name,
        role: user.role,
      },
    };
  }

  async login(input: LoginInput, ip?: string): Promise<AuthResult> {
    const validated = LoginDto.parse(input);

    const user = await db('users').where('email', validated.email).first();

    if (!user) {
      // Timing-safe: still compute hash to prevent timing attacks
      await bcrypt.compare(validated.password, '$2b$12$invalidhashfortimingattackprevention');
      throw new AppError(ErrorCode.INVALID_CREDENTIALS, 'Invalid credentials', 401);
    }

    // Check account lock
    if (user.locked_until && new Date(user.locked_until) > new Date()) {
      const minutesLeft = Math.ceil(
        (new Date(user.locked_until).getTime() - Date.now()) / 60000
      );
      throw new AppError(
        ErrorCode.ACCOUNT_LOCKED,
        `Account locked. Try again in ${minutesLeft} minutes`,
        401
      );
    }

    if (user.status === 'suspended') {
      throw new AppError(ErrorCode.ACCOUNT_SUSPENDED, 'Account suspended', 403);
    }

    if (user.status === 'banned') {
      throw new AppError(ErrorCode.FORBIDDEN, 'Account banned', 403);
    }

    const isPasswordValid = await bcrypt.compare(validated.password, user.password_hash);

    if (!isPasswordValid) {
      const newFailedAttempts = (user.failed_login_attempts ?? 0) + 1;

      const updateData: Record<string, any> = {
        failed_login_attempts: newFailedAttempts,
        updated_at: new Date(),
      };

      if (newFailedAttempts >= MAX_FAILED_ATTEMPTS) {
        const lockedUntil = new Date(Date.now() + LOCK_DURATION_MINUTES * 60 * 1000);
        updateData.locked_until = lockedUntil;
        logger.warn('Account locked due to failed attempts', { userId: user.id, ip });
      }

      await db('users').where('id', user.id).update(updateData);

      throw new AppError(ErrorCode.INVALID_CREDENTIALS, 'Invalid credentials', 401);
    }

    // Reset failed attempts on success
    await db('users').where('id', user.id).update({
      failed_login_attempts: 0,
      locked_until: null,
      last_login_at: new Date(),
      last_login_ip: ip ?? null,
      updated_at: new Date(),
    });

    logger.info('User logged in', { userId: user.id, ip });

    const tokens = await this.generateTokenPair(user.id, user.role, ip);

    return {
      ...tokens,
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        displayName: user.display_name,
        role: user.role,
      },
    };
  }

  async refreshToken(token: string): Promise<TokenPair> {
    const tokenHash = this.hashToken(token);

    const storedToken = await db('refresh_tokens')
      .where('token_hash', tokenHash)
      .first();

    if (!storedToken) {
      throw new UnauthorizedError('Invalid refresh token');
    }

    if (storedToken.is_revoked) {
      // Token reuse detection - revoke all tokens for this user
      await db('refresh_tokens')
        .where('user_id', storedToken.user_id)
        .update({ is_revoked: true });

      logger.warn('Refresh token reuse detected - all tokens revoked', {
        userId: storedToken.user_id,
      });

      throw new UnauthorizedError('Token reuse detected');
    }

    if (new Date(storedToken.expires_at) < new Date()) {
      throw new AppError(ErrorCode.TOKEN_EXPIRED, 'Refresh token expired', 401);
    }

    // Revoke old token (token rotation)
    await db('refresh_tokens').where('id', storedToken.id).update({
      is_revoked: true,
      updated_at: new Date(),
    });

    const user = await db('users').where('id', storedToken.user_id).first();
    if (!user || user.status !== 'active') {
      throw new UnauthorizedError('User account inactive');
    }

    return this.generateTokenPair(user.id, user.role);
  }

  async logout(userId: string, refreshToken?: string): Promise<void> {
    if (refreshToken) {
      const tokenHash = this.hashToken(refreshToken);
      await db('refresh_tokens').where('token_hash', tokenHash).update({
        is_revoked: true,
        updated_at: new Date(),
      });
    } else {
      // Logout all devices
      await db('refresh_tokens')
        .where('user_id', userId)
        .update({ is_revoked: true, updated_at: new Date() });
    }

    await userCache.del(`user:${userId}`);
  }

  verifyAccessToken(token: string): JwtPayload {
    try {
      const payload = jwt.verify(token, config.JWT_ACCESS_SECRET) as JwtPayload;
      return payload;
    } catch (err) {
      if ((err as any).name === 'TokenExpiredError') {
        throw new AppError(ErrorCode.TOKEN_EXPIRED, 'Access token expired', 401);
      }
      throw new AppError(ErrorCode.TOKEN_INVALID, 'Invalid access token', 401);
    }
  }

  private async generateTokenPair(
    userId: string,
    role: string,
    ip?: string
  ): Promise<TokenPair> {
    const jti = crypto.randomUUID();

    const accessToken = jwt.sign(
      { sub: userId, role, jti } satisfies JwtPayload,
      config.JWT_ACCESS_SECRET,
      { expiresIn: config.JWT_ACCESS_EXPIRES_IN } as any
    );

    const refreshTokenValue = crypto.randomBytes(64).toString('hex');
    const tokenHash = this.hashToken(refreshTokenValue);

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7); // 7 days

    await db('refresh_tokens').insert({
      user_id: userId,
      token_hash: tokenHash,
      ip_address: ip ?? null,
      expires_at: expiresAt,
    });

    // Clean up old expired tokens periodically
    if (Math.random() < 0.05) {
      db('refresh_tokens')
        .where('expires_at', '<', new Date())
        .orWhere({ is_revoked: true })
        .delete()
        .catch((err) => logger.warn('Token cleanup failed', { error: err.message }));
    }

    return {
      accessToken,
      refreshToken: refreshTokenValue,
      expiresIn: 15 * 60, // 15 minutes in seconds
    };
  }

  private hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }
}
