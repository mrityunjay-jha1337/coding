import { PrismaClient, UserStatus } from '@prisma/client';
import { ConflictError, NotFoundError } from '../utils/errors';

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

interface ListUsersFilters {
  readonly search?: string;
  readonly roleId?: string;
  readonly roleName?: string;
  readonly status?: string;
  readonly page?: number;
  readonly limit?: number;
}

interface UpdateUserData {
  readonly name?: string;
  readonly specialisation?: string;
  readonly status?: UserStatus;
}

interface UserListResult {
  readonly users: ReadonlyArray<Record<string, unknown>>;
  readonly total: number;
  readonly page: number;
  readonly limit: number;
  readonly totalPages: number;
}

export class UserService {
  constructor(private readonly prisma: PrismaClient) {}

  async listUsers(orgId: string, filters: ListUsersFilters): Promise<UserListResult> {
    const page = Math.max(filters.page ?? DEFAULT_PAGE, 1);
    const limit = Math.min(Math.max(filters.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = { orgId };

    if (filters.search) {
      where.OR = [
        { name: { contains: filters.search, mode: 'insensitive' } },
        { email: { contains: filters.search, mode: 'insensitive' } },
      ];
    }

    if (filters.roleId) {
      where.roleId = filters.roleId;
    }

    if (filters.roleName) {
      where.role = { name: filters.roleName };
    }

    if (filters.status) {
      where.status = filters.status;
    }

    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        where: where as any,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          email: true,
          name: true,
          specialisation: true,
          status: true,
          lastLoginAt: true,
          createdAt: true,
          role: { select: { id: true, name: true } },
        },
      }),
      this.prisma.user.count({ where: where as any }),
    ]);

    return {
      users,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async getUser(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        specialisation: true,
        status: true,
        mfaEnabled: true,
        emailVerified: true,
        lastLoginAt: true,
        createdAt: true,
        updatedAt: true,
        role: { select: { id: true, name: true, permissions: true } },
        organisation: { select: { id: true, name: true, type: true } },
        teamMemberships: {
          select: {
            joinedAt: true,
            team: { select: { id: true, name: true } },
          },
        },
      },
    });

    if (!user) {
      return null;
    }

    return user;
  }

  async updateUser(userId: string, data: UpdateUserData) {
    const existing = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!existing) {
      return null;
    }

    const updatePayload: Record<string, unknown> = {};

    if (data.name !== undefined) {
      updatePayload.name = data.name;
    }
    if (data.specialisation !== undefined) {
      updatePayload.specialisation = data.specialisation;
    }
    if (data.status !== undefined) {
      updatePayload.status = data.status;
    }

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: updatePayload as any,
      select: {
        id: true,
        email: true,
        name: true,
        specialisation: true,
        status: true,
        updatedAt: true,
        role: { select: { id: true, name: true } },
      },
    });

    return updated;
  }

  async deactivateUser(userId: string) {
    const existing = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!existing) {
      return null;
    }

    const [updated] = await Promise.all([
      this.prisma.user.update({
        where: { id: userId },
        data: { status: 'INACTIVE' },
        select: {
          id: true,
          email: true,
          name: true,
          status: true,
          updatedAt: true,
        },
      }),
      this.prisma.session.deleteMany({
        where: { userId },
      }),
    ]);

    return updated;
  }

  async changeRole(userId: string, roleId: string) {
    const [existing, role] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: userId } }),
      this.prisma.role.findUnique({ where: { id: roleId } }),
    ]);

    if (!existing) {
      throw new UserNotFoundError(userId);
    }

    if (!role) {
      throw new RoleNotFoundError(roleId);
    }

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { roleId },
      select: {
        id: true,
        email: true,
        name: true,
        updatedAt: true,
        role: { select: { id: true, name: true, permissions: true } },
      },
    });

    return updated;
  }

  async inviteUser(orgId: string, data: { email: string; name: string; roleName: string; teamId?: string; specialisation?: string }) {
    const existing = await this.prisma.user.findUnique({
      where: { email: data.email.toLowerCase() },
    });

    if (existing) {
      throw new ConflictError('A user with this email address already exists');
    }

    const role = await this.prisma.role.findFirst({
      where: { name: data.roleName, isSystem: true },
    });

    if (!role) {
      throw new RoleNotFoundError(data.roleName);
    }

    const user = await this.prisma.user.create({
      data: {
        orgId,
        email: data.email.toLowerCase(),
        name: data.name,
        roleId: role.id,
        status: 'PENDING',
        specialisation: data.specialisation,
        passwordHash: 'INVITED_USER_PENDING', // Should be handled by invite link / password set flow
      },
      select: {
        id: true,
        email: true,
        name: true,
        status: true,
        role: { select: { name: true } },
      },
    });

    if (data.teamId) {
      await this.prisma.teamMember.create({
        data: {
          teamId: data.teamId,
          userId: user.id,
        },
      });
    }

    return user;
  }
}


export class UserNotFoundError extends NotFoundError {
  constructor(userId: string) {
    super(`User with ID ${userId}`);
  }
}

export class RoleNotFoundError extends NotFoundError {
  constructor(roleId: string) {
    super(`Role ${roleId}`);
  }
}
