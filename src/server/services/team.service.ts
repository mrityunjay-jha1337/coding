import { PrismaClient } from '@prisma/client';

interface CreateTeamData {
  readonly name: string;
  readonly leadId?: string;
}

interface UpdateTeamData {
  readonly name?: string;
  readonly leadId?: string;
  readonly settings?: Record<string, unknown>;
}

export class TeamService {
  constructor(private readonly prisma: PrismaClient) {}

  async createTeam(orgId: string, data: CreateTeamData) {
    if (data.leadId) {
      const leadUser = await this.prisma.user.findUnique({
        where: { id: data.leadId },
      });
      if (!leadUser || leadUser.orgId !== orgId) {
        throw new TeamLeadNotFoundError(data.leadId);
      }
    }

    const team = await this.prisma.team.create({
      data: {
        orgId,
        name: data.name,
        leadId: data.leadId ?? null,
      },
      select: {
        id: true,
        name: true,
        leadId: true,
        settings: true,
        createdAt: true,
      },
    });

    return team;
  }

  async listTeams(orgId: string) {
    const teams = await this.prisma.team.findMany({
      where: { orgId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        leadId: true,
        settings: true,
        createdAt: true,
        _count: {
          select: { members: true },
        },
      },
    });

    return teams.map((team) => ({
      id: team.id,
      name: team.name,
      leadId: team.leadId,
      settings: team.settings,
      createdAt: team.createdAt,
      memberCount: team._count.members,
    }));
  }

  async getTeamWithMembers(teamId: string) {
    const team = await this.prisma.team.findUnique({
      where: { id: teamId },
      select: {
        id: true,
        name: true,
        orgId: true,
        leadId: true,
        settings: true,
        createdAt: true,
        members: {
          select: {
            joinedAt: true,
            user: {
              select: {
                id: true,
                email: true,
                name: true,
                specialisation: true,
                status: true,
              },
            },
          },
        },
        clientMappings: {
          select: {
            client: {
              select: { id: true, name: true, status: true },
            },
          },
        },
      },
    });

    if (!team) {
      return null;
    }

    return {
      id: team.id,
      name: team.name,
      orgId: team.orgId,
      leadId: team.leadId,
      settings: team.settings,
      createdAt: team.createdAt,
      members: team.members.map((m) => ({
        ...m.user,
        joinedAt: m.joinedAt,
      })),
      clients: team.clientMappings.map((cm) => cm.client),
    };
  }

  async updateTeam(teamId: string, data: UpdateTeamData) {
    const existing = await this.prisma.team.findUnique({
      where: { id: teamId },
    });

    if (!existing) {
      return null;
    }

    const updatePayload: Record<string, unknown> = {};

    if (data.name !== undefined) {
      updatePayload.name = data.name;
    }
    if (data.leadId !== undefined) {
      updatePayload.leadId = data.leadId;
    }
    if (data.settings !== undefined) {
      updatePayload.settings = data.settings;
    }

    const updated = await this.prisma.team.update({
      where: { id: teamId },
      data: updatePayload as any,
      select: {
        id: true,
        name: true,
        leadId: true,
        settings: true,
        createdAt: true,
      },
    });

    return updated;
  }

  async deleteTeam(teamId: string) {
    const existing = await this.prisma.team.findUnique({
      where: { id: teamId },
    });

    if (!existing) {
      return null;
    }

    await this.prisma.team.delete({
      where: { id: teamId },
    });

    return { id: teamId, deleted: true };
  }

  async addMember(teamId: string, userId: string) {
    const [team, user] = await Promise.all([
      this.prisma.team.findUnique({ where: { id: teamId } }),
      this.prisma.user.findUnique({ where: { id: userId } }),
    ]);

    if (!team) {
      throw new TeamNotFoundError(teamId);
    }

    if (!user) {
      throw new MemberNotFoundError(userId);
    }

    if (user.orgId !== team.orgId) {
      throw new MemberOrgMismatchError(userId, team.orgId);
    }

    const existingMembership = await this.prisma.teamMember.findUnique({
      where: { teamId_userId: { teamId, userId } },
    });

    if (existingMembership) {
      throw new MemberAlreadyExistsError(userId, teamId);
    }

    const membership = await this.prisma.teamMember.create({
      data: { teamId, userId },
      select: {
        teamId: true,
        userId: true,
        joinedAt: true,
        user: {
          select: { id: true, email: true, name: true },
        },
      },
    });

    return membership;
  }

  async removeMember(teamId: string, userId: string) {
    const membership = await this.prisma.teamMember.findUnique({
      where: { teamId_userId: { teamId, userId } },
    });

    if (!membership) {
      throw new MemberNotInTeamError(userId, teamId);
    }

    await this.prisma.teamMember.delete({
      where: { teamId_userId: { teamId, userId } },
    });

    return { teamId, userId, removed: true };
  }
}

export class TeamNotFoundError extends Error {
  constructor(teamId: string) {
    super(`Team not found: ${teamId}`);
    this.name = 'TeamNotFoundError';
  }
}

export class TeamLeadNotFoundError extends Error {
  constructor(leadId: string) {
    super(`Team lead not found or not in organisation: ${leadId}`);
    this.name = 'TeamLeadNotFoundError';
  }
}

export class MemberNotFoundError extends Error {
  constructor(userId: string) {
    super(`User not found: ${userId}`);
    this.name = 'MemberNotFoundError';
  }
}

export class MemberOrgMismatchError extends Error {
  constructor(userId: string, orgId: string) {
    super(`User ${userId} does not belong to organisation ${orgId}`);
    this.name = 'MemberOrgMismatchError';
  }
}

export class MemberAlreadyExistsError extends Error {
  constructor(userId: string, teamId: string) {
    super(`User ${userId} is already a member of team ${teamId}`);
    this.name = 'MemberAlreadyExistsError';
  }
}

export class MemberNotInTeamError extends Error {
  constructor(userId: string, teamId: string) {
    super(`User ${userId} is not a member of team ${teamId}`);
    this.name = 'MemberNotInTeamError';
  }
}
