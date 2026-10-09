import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { env } from '../config/env';
import { ConflictError } from '../utils/errors';
import {
  BCRYPT_ROUNDS,
  PASSWORD_MIN_LENGTH,
  PASSWORD_HISTORY_SIZE,
  MAX_CONCURRENT_SESSIONS,
  LOGIN_LOCKOUT_ATTEMPTS_TIER1,
  LOGIN_LOCKOUT_DURATION_TIER1_MS,
  LOGIN_LOCKOUT_ATTEMPTS_TIER2,
  LOGIN_LOCKOUT_DURATION_TIER2_MS,
} from '../config/constants';
import type { SignupRequest, LoginRequest, TokenPair, JwtPayload, AuthResult } from '../../shared/authTypes';

export class AuthService {
  constructor(private readonly prisma: PrismaClient) {}

  async signup(data: SignupRequest): Promise<AuthResult> {
    this.validatePassword(data.adminPassword);

    const existingUser = await this.prisma.user.findUnique({
      where: { email: data.adminEmail.toLowerCase() },
    });
    if (existingUser) {
      throw new ConflictError('A user with this email address already exists');
    }

    const bpoAdminRole = await this.prisma.role.findFirst({
      where: { name: 'BPO_ADMIN', isSystem: true },
    });
    if (!bpoAdminRole) {
      throw new Error('BPO_ADMIN role not found. Run database seed first.');
    }

    const passwordHash = await bcrypt.hash(data.adminPassword, BCRYPT_ROUNDS);

    const org = await this.prisma.organisation.create({
      data: {
        name: data.organisationName,
        type: data.organisationType,
        fcaNumber: data.fcaNumber,
      },
    });

    const user = await this.prisma.user.create({
      data: {
        orgId: org.id,
        email: data.adminEmail.toLowerCase(),
        passwordHash,
        name: data.adminName,
        roleId: bpoAdminRole.id,
        status: 'ACTIVE',
        emailVerified: true, // Auto-verify for now; will add OTP later
        passwordHistory: [passwordHash],
        passwordChangedAt: new Date(),
      },
    });

    const permissions = bpoAdminRole.permissions as string[];
    const tokens = await this.createSession(user.id, user.orgId, bpoAdminRole.name, permissions);

    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: bpoAdminRole.name,
        orgId: org.id,
      },
      tokens,
      requiresMfa: false,
    };
  }

  async login(data: LoginRequest): Promise<AuthResult> {
    const user = await this.prisma.user.findUnique({
      where: { email: data.email.toLowerCase() },
      include: { role: true },
    });

    if (!user) {
      throw new Error('Invalid email or password');
    }

    // Check lockout
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw new Error('Account is locked. Try again later.');
    }

    // If lockout has expired, reset counters
    if (user.lockedUntil && user.lockedUntil <= new Date()) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { failedLoginCount: 0, lockedUntil: null },
      });
    }

    const passwordValid = await bcrypt.compare(data.password, user.passwordHash);
    if (!passwordValid) {
      const newCount = user.failedLoginCount + 1;
      const updateData: Record<string, unknown> = { failedLoginCount: newCount };

      if (newCount >= LOGIN_LOCKOUT_ATTEMPTS_TIER2) {
        updateData.lockedUntil = new Date(Date.now() + LOGIN_LOCKOUT_DURATION_TIER2_MS);
        updateData.status = 'LOCKED';
      } else if (newCount >= LOGIN_LOCKOUT_ATTEMPTS_TIER1) {
        updateData.lockedUntil = new Date(Date.now() + LOGIN_LOCKOUT_DURATION_TIER1_MS);
      }

      await this.prisma.user.update({
        where: { id: user.id },
        data: updateData as any,
      });

      throw new Error('Invalid email or password');
    }

    if (user.status === 'INACTIVE') {
      throw new Error('Account is deactivated');
    }

    // Check MFA
    if (user.mfaEnabled && !data.mfaCode) {
      return {
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role.name,
          orgId: user.orgId,
        },
        tokens: { accessToken: '', refreshToken: '' },
        requiresMfa: true,
      };
    }

    // Reset failed login count on success
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        failedLoginCount: 0,
        lockedUntil: null,
        lastLoginAt: new Date(),
        status: 'ACTIVE',
      },
    });

    const permissions = user.role.permissions as string[];
    const tokens = await this.createSession(user.id, user.orgId, user.role.name, permissions);

    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role.name,
        orgId: user.orgId,
      },
      tokens,
      requiresMfa: false,
    };
  }

  async refreshTokens(refreshToken: string): Promise<TokenPair> {
    const session = await this.prisma.session.findUnique({
      where: { refreshToken },
      include: { user: { include: { role: true } } },
    });

    if (!session) {
      throw new Error('Invalid refresh token');
    }

    if (session.expiresAt < new Date()) {
      await this.prisma.session.deleteMany({ where: { id: session.id } });
      throw new Error('Refresh token expired');
    }

    // Rotate: delete old session, create new one
    const { count } = await this.prisma.session.deleteMany({ where: { id: session.id } });
    if (count === 0) {
      throw new Error('Invalid refresh token');
    }

    const permissions = session.user.role.permissions as string[];
    return this.createSession(
      session.user.id,
      session.user.orgId,
      session.user.role.name,
      permissions
    );
  }

  async logout(userId: string, refreshToken: string): Promise<void> {
    await this.prisma.session.deleteMany({
      where: { userId, refreshToken },
    });
  }

  async logoutAll(userId: string): Promise<void> {
    await this.prisma.session.deleteMany({
      where: { userId },
    });
  }

  async changePassword(userId: string, data: { current: string; next: string }): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) throw new Error('User not found');

    const passwordValid = await bcrypt.compare(data.current, user.passwordHash);
    if (!passwordValid) throw new Error('Current password is incorrect');

    this.validatePassword(data.next);

    // Check password history
    for (const historicHash of user.passwordHistory as string[]) {
      const isMatch = await bcrypt.compare(data.next, historicHash);
      if (isMatch) throw new Error('Cannot reuse recently used passwords');
    }

    const nextHash = await bcrypt.hash(data.next, BCRYPT_ROUNDS);
    const updatedHistory = [nextHash, ...((user.passwordHistory as string[]) || [])].slice(0, PASSWORD_HISTORY_SIZE);

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        passwordHash: nextHash,
        passwordHistory: updatedHistory,
        passwordChangedAt: new Date(),
      },
    });

    // Invalidate all other sessions for security
    await this.prisma.session.deleteMany({
      where: { userId, NOT: { expiresAt: { lt: new Date() } } },
    });
  }

  async toggleMfa(userId: string, enabled: boolean): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { mfaEnabled: enabled },
    });
  }

  verifyAccessToken(token: string): JwtPayload {
    try {
      return jwt.verify(token, env.JWT_ACCESS_SECRET) as JwtPayload;
    } catch {
      throw new Error('Invalid or expired access token');
    }
  }

  private async createSession(
    userId: string,
    orgId: string,
    roleName: string,
    permissions: string[]
  ): Promise<TokenPair> {
    // Enforce concurrent session limit
    const existingSessions = await this.prisma.session.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
    });

    if (existingSessions.length >= MAX_CONCURRENT_SESSIONS) {
      // Delete oldest sessions to make room
      const toDelete = existingSessions.slice(0, existingSessions.length - MAX_CONCURRENT_SESSIONS + 1);
      await this.prisma.session.deleteMany({
        where: { id: { in: toDelete.map((s) => s.id) } },
      });
    }

    const accessToken = jwt.sign(
      { sub: userId, orgId, role: roleName, permissions } satisfies JwtPayload,
      env.JWT_ACCESS_SECRET,
      { expiresIn: env.JWT_ACCESS_EXPIRY } as jwt.SignOptions
    );

    const refreshTokenValue = uuidv4();
    const refreshExpiryMs = parseExpiry(env.JWT_REFRESH_EXPIRY);

    await this.prisma.session.create({
      data: {
        userId,
        refreshToken: refreshTokenValue,
        expiresAt: new Date(Date.now() + refreshExpiryMs),
      },
    });

    return { accessToken, refreshToken: refreshTokenValue };
  }

  private validatePassword(password: string): void {
    if (password.length < PASSWORD_MIN_LENGTH) {
      throw new Error(`Password must be at least ${PASSWORD_MIN_LENGTH} characters`);
    }
    if (!/[A-Z]/.test(password)) {
      throw new Error('Password must contain at least one uppercase letter');
    }
    if (!/[a-z]/.test(password)) {
      throw new Error('Password must contain at least one lowercase letter');
    }
    if (!/[0-9]/.test(password)) {
      throw new Error('Password must contain at least one number');
    }
    if (!/[^A-Za-z0-9]/.test(password)) {
      throw new Error('Password must contain at least one special character');
    }
  }
}

function parseExpiry(expiry: string): number {
  const match = expiry.match(/^(\d+)([smhd])$/);
  if (!match) return 7 * 24 * 60 * 60 * 1000; // default 7 days

  const value = parseInt(match[1], 10);
  switch (match[2]) {
    case 's': return value * 1000;
    case 'm': return value * 60 * 1000;
    case 'h': return value * 60 * 60 * 1000;
    case 'd': return value * 24 * 60 * 60 * 1000;
    default: return 7 * 24 * 60 * 60 * 1000;
  }
}
