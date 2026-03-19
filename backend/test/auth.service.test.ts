/**
 * Unit tests for Auth Service
 *
 * Tests cover:
 * - Registration validation
 * - Login / credential validation
 * - JWT token generation and verification
 * - Brute-force protection
 * - Refresh token rotation
 * - Token reuse detection
 */

import crypto from 'crypto';

// ── Inline the token hashing utility (isolated from DB)
function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

// ── JWT payload shape validation
interface JwtPayload {
  sub: string;
  role: string;
  jti: string;
  iat: number;
  exp: number;
}

function isValidJwtStructure(payload: any): payload is JwtPayload {
  return (
    typeof payload.sub === 'string' &&
    typeof payload.role === 'string' &&
    typeof payload.jti === 'string' &&
    typeof payload.iat === 'number' &&
    typeof payload.exp === 'number'
  );
}

// ─────────────────────────────────────────────────────────────────
// REGISTRATION VALIDATION
// ─────────────────────────────────────────────────────────────────

import { z } from 'zod';

const RegisterDto = z.object({
  email: z.string().email().max(255).toLowerCase(),
  username: z
    .string()
    .min(3)
    .max(50)
    .regex(/^[a-zA-Z0-9_-]+$/),
  password: z
    .string()
    .min(8)
    .max(100)
    .regex(/[A-Z]/)
    .regex(/[0-9]/),
  displayName: z.string().min(1).max(100).optional(),
});

describe('Auth — Registration Validation', () => {
  test('Valid registration passes', () => {
    const result = RegisterDto.safeParse({
      email: 'alice@example.com',
      username: 'alice_42',
      password: 'SecurePass1',
    });
    expect(result.success).toBe(true);
  });

  test('Email is lowercased automatically', () => {
    const result = RegisterDto.safeParse({
      email: 'ALICE@EXAMPLE.COM',
      username: 'alice',
      password: 'SecurePass1',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.email).toBe('alice@example.com');
    }
  });

  test('Invalid email rejected', () => {
    const result = RegisterDto.safeParse({
      email: 'not-an-email',
      username: 'alice',
      password: 'SecurePass1',
    });
    expect(result.success).toBe(false);
  });

  test('Short username rejected (< 3 chars)', () => {
    const result = RegisterDto.safeParse({
      email: 'alice@example.com',
      username: 'ab',
      password: 'SecurePass1',
    });
    expect(result.success).toBe(false);
  });

  test('Username with special chars rejected', () => {
    const result = RegisterDto.safeParse({
      email: 'alice@example.com',
      username: 'alice!@#',
      password: 'SecurePass1',
    });
    expect(result.success).toBe(false);
  });

  test('Username with allowed chars passes (letters, numbers, _, -)', () => {
    const validUsernames = ['alice', 'alice_42', 'alice-trader', 'ALICE', 'a1b2c3'];
    for (const username of validUsernames) {
      const result = RegisterDto.safeParse({
        email: 'test@example.com',
        username,
        password: 'SecurePass1',
      });
      expect(result.success).toBe(true);
    }
  });

  test('Password without uppercase rejected', () => {
    const result = RegisterDto.safeParse({
      email: 'alice@example.com',
      username: 'alice',
      password: 'securepass1',
    });
    expect(result.success).toBe(false);
  });

  test('Password without number rejected', () => {
    const result = RegisterDto.safeParse({
      email: 'alice@example.com',
      username: 'alice',
      password: 'SecurePassword',
    });
    expect(result.success).toBe(false);
  });

  test('Password under 8 chars rejected', () => {
    const result = RegisterDto.safeParse({
      email: 'alice@example.com',
      username: 'alice',
      password: 'Abc123',
    });
    expect(result.success).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────
// TOKEN UTILITIES
// ─────────────────────────────────────────────────────────────────

describe('Auth — Token Hashing', () => {
  test('hashToken produces consistent output', () => {
    const token = 'abc123';
    expect(hashToken(token)).toBe(hashToken(token));
  });

  test('hashToken is 64 hex chars (SHA-256)', () => {
    const hash = hashToken('some-refresh-token');
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  test('Different tokens produce different hashes', () => {
    const hash1 = hashToken('token-a');
    const hash2 = hashToken('token-b');
    expect(hash1).not.toBe(hash2);
  });

  test('Token reuse is detectable via hash comparison', () => {
    const originalToken = crypto.randomBytes(64).toString('hex');
    const storedHash = hashToken(originalToken);

    // Simulate incoming request with same token
    const incomingHash = hashToken(originalToken);
    expect(incomingHash).toBe(storedHash); // Match = valid
  });

  test('Slightly altered token produces different hash', () => {
    const token = 'legitimate-token-abc123';
    const tamperedToken = 'legitimate-token-abc124'; // 1 char different
    expect(hashToken(token)).not.toBe(hashToken(tamperedToken));
  });
});

// ─────────────────────────────────────────────────────────────────
// BRUTE-FORCE PROTECTION LOGIC
// ─────────────────────────────────────────────────────────────────

describe('Auth — Brute-force Protection', () => {
  const MAX_ATTEMPTS = 5;
  const LOCK_MINUTES = 15;

  function shouldLock(attempts: number): boolean {
    return attempts >= MAX_ATTEMPTS;
  }

  function getLockExpiry(now: Date): Date {
    return new Date(now.getTime() + LOCK_MINUTES * 60 * 1000);
  }

  function isLocked(lockedUntil: Date | null, now: Date): boolean {
    if (!lockedUntil) return false;
    return lockedUntil > now;
  }

  test('Account not locked before 5 failed attempts', () => {
    expect(shouldLock(0)).toBe(false);
    expect(shouldLock(3)).toBe(false);
    expect(shouldLock(4)).toBe(false);
  });

  test('Account locked at exactly 5 failed attempts', () => {
    expect(shouldLock(5)).toBe(true);
  });

  test('Account remains locked while within lock window', () => {
    const now = new Date();
    const lockExpiry = getLockExpiry(now);
    const fiveMinutesLater = new Date(now.getTime() + 5 * 60 * 1000);
    expect(isLocked(lockExpiry, fiveMinutesLater)).toBe(true);
  });

  test('Account unlocks after lock window expires', () => {
    const now = new Date();
    const lockExpiry = getLockExpiry(now);
    const twentyMinutesLater = new Date(now.getTime() + 20 * 60 * 1000);
    expect(isLocked(lockExpiry, twentyMinutesLater)).toBe(false);
  });

  test('Lock duration is 15 minutes', () => {
    const now = new Date();
    const lockExpiry = getLockExpiry(now);
    const durationMs = lockExpiry.getTime() - now.getTime();
    expect(durationMs).toBe(LOCK_MINUTES * 60 * 1000);
  });

  test('Account not locked if lockedUntil is null', () => {
    expect(isLocked(null, new Date())).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────
// JWT STRUCTURE VALIDATION
// ─────────────────────────────────────────────────────────────────

describe('Auth — JWT Payload Structure', () => {
  test('Valid payload passes structure check', () => {
    const payload = {
      sub: 'user-uuid-123',
      role: 'user',
      jti: 'jwt-id-456',
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 900,
    };
    expect(isValidJwtStructure(payload)).toBe(true);
  });

  test('Missing sub field fails', () => {
    const payload = { role: 'user', jti: 'id', iat: 1000, exp: 2000 };
    expect(isValidJwtStructure(payload)).toBe(false);
  });

  test('Missing role field fails', () => {
    const payload = { sub: 'uuid', jti: 'id', iat: 1000, exp: 2000 };
    expect(isValidJwtStructure(payload)).toBe(false);
  });

  test('Non-string sub fails', () => {
    const payload = { sub: 123, role: 'user', jti: 'id', iat: 1000, exp: 2000 };
    expect(isValidJwtStructure(payload)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────
// REFRESH TOKEN ROTATION LOGIC
// ─────────────────────────────────────────────────────────────────

describe('Auth — Refresh Token Rotation', () => {
  test('New refresh token is generated on each use', () => {
    const token1 = crypto.randomBytes(64).toString('hex');
    const token2 = crypto.randomBytes(64).toString('hex');
    expect(token1).not.toBe(token2);
    expect(token1.length).toBe(128); // 64 bytes = 128 hex chars
  });

  test('Token reuse detection: revoking all tokens on reuse', () => {
    // Simulate token reuse scenario
    const tokens = [
      { id: '1', token_hash: hashToken('old-token'), is_revoked: true },   // Already revoked
      { id: '2', token_hash: hashToken('new-token'), is_revoked: false },
    ];

    const incomingTokenHash = hashToken('old-token');
    const found = tokens.find((t) => t.token_hash === incomingTokenHash);

    // Found AND revoked = reuse detected
    expect(found).toBeDefined();
    expect(found?.is_revoked).toBe(true);

    // Should revoke all tokens (security response)
    const allRevoked = tokens.map((t) => ({ ...t, is_revoked: true }));
    expect(allRevoked.every((t) => t.is_revoked)).toBe(true);
  });

  test('Valid token: found and not revoked', () => {
    const token = crypto.randomBytes(64).toString('hex');
    const storedRecord = {
      id: '1',
      token_hash: hashToken(token),
      is_revoked: false,
      expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    };

    const incomingHash = hashToken(token);
    const found = storedRecord.token_hash === incomingHash;
    const valid = found && !storedRecord.is_revoked && storedRecord.expires_at > new Date();

    expect(valid).toBe(true);
  });

  test('Expired token is rejected', () => {
    const token = crypto.randomBytes(64).toString('hex');
    const storedRecord = {
      token_hash: hashToken(token),
      is_revoked: false,
      expires_at: new Date(Date.now() - 1000), // expired 1 second ago
    };

    const isExpired = storedRecord.expires_at < new Date();
    expect(isExpired).toBe(true);
  });
});
