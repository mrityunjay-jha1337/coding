import { Prisma, PrismaClient } from '@prisma/client';

interface OnboardClientData {
  readonly name: string;
  readonly contactEmail: string;
  readonly policyLines?: string[];
  readonly slaConfig?: Record<string, unknown>;
}

interface UpdateClientData {
  readonly name?: string;
  readonly contactEmail?: string;
  readonly status?: 'ACTIVE' | 'INACTIVE' | 'ONBOARDING';
  readonly settings?: Record<string, unknown>;
}

export class ClientService {
  constructor(private readonly prisma: PrismaClient) {}

  async onboardClient(orgId: string, data: OnboardClientData) {
    const client = await this.prisma.client.create({
      data: {
        orgId,
        name: data.name,
        contactEmail: data.contactEmail,
        policyLines: data.policyLines ?? [],
        slaConfig: (data.slaConfig ?? {}) as Prisma.InputJsonValue,
        status: 'ONBOARDING',
      },
      select: {
        id: true,
        name: true,
        contactEmail: true,
        policyLines: true,
        slaConfig: true,
        status: true,
        createdAt: true,
      },
    });

    return client;
  }

  async listClients(orgId: string) {
    const clients = await this.prisma.client.findMany({
      where: { orgId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        contactEmail: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        _count: {
          select: { claims: true },
        },
      },
    });

    return clients.map((client) => ({
      id: client.id,
      name: client.name,
      contactEmail: client.contactEmail,
      status: client.status,
      createdAt: client.createdAt,
      updatedAt: client.updatedAt,
      claimCount: client._count.claims,
    }));
  }

  async getClientDetail(clientId: string) {
    const client = await this.prisma.client.findUnique({
      where: { id: clientId },
      select: {
        id: true,
        name: true,
        orgId: true,
        contactEmail: true,
        policyLines: true,
        slaConfig: true,
        settings: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        teamMappings: {
          select: {
            team: {
              select: { id: true, name: true },
            },
          },
        },
        _count: {
          select: { claims: true },
        },
      },
    });

    if (!client) {
      return null;
    }

    return {
      id: client.id,
      name: client.name,
      orgId: client.orgId,
      contactEmail: client.contactEmail,
      policyLines: client.policyLines,
      slaConfig: client.slaConfig,
      settings: client.settings,
      status: client.status,
      createdAt: client.createdAt,
      updatedAt: client.updatedAt,
      teams: client.teamMappings.map((tm) => tm.team),
      claimCount: client._count.claims,
    };
  }

  async updateClient(clientId: string, data: UpdateClientData) {
    const existing = await this.prisma.client.findUnique({
      where: { id: clientId },
    });

    if (!existing) {
      return null;
    }

    const updatePayload: Record<string, unknown> = {};

    if (data.name !== undefined) {
      updatePayload.name = data.name;
    }
    if (data.contactEmail !== undefined) {
      updatePayload.contactEmail = data.contactEmail;
    }
    if (data.status !== undefined) {
      updatePayload.status = data.status;
    }
    if (data.settings !== undefined) {
      updatePayload.settings = data.settings;
    }

    const updated = await this.prisma.client.update({
      where: { id: clientId },
      data: updatePayload as any,
      select: {
        id: true,
        name: true,
        contactEmail: true,
        status: true,
        settings: true,
        updatedAt: true,
      },
    });

    return updated;
  }

  async mapClientToTeam(clientId: string, teamId: string) {
    const [client, team] = await Promise.all([
      this.prisma.client.findUnique({ where: { id: clientId } }),
      this.prisma.team.findUnique({ where: { id: teamId } }),
    ]);

    if (!client) {
      throw new ClientNotFoundError(clientId);
    }

    if (!team) {
      throw new TeamNotFoundForClientError(teamId);
    }

    if (client.orgId !== team.orgId) {
      throw new ClientTeamOrgMismatchError(clientId, teamId);
    }

    const existingMapping = await this.prisma.clientTeamMapping.findUnique({
      where: { clientId_teamId: { clientId, teamId } },
    });

    if (existingMapping) {
      throw new ClientTeamMappingExistsError(clientId, teamId);
    }

    const mapping = await this.prisma.clientTeamMapping.create({
      data: { clientId, teamId },
      select: {
        clientId: true,
        teamId: true,
        client: { select: { id: true, name: true } },
        team: { select: { id: true, name: true } },
      },
    });

    return mapping;
  }

  async updateSlaConfig(clientId: string, config: Record<string, unknown>) {
    const existing = await this.prisma.client.findUnique({
      where: { id: clientId },
    });

    if (!existing) {
      return null;
    }

    const updated = await this.prisma.client.update({
      where: { id: clientId },
      data: { slaConfig: config as Prisma.InputJsonValue },
      select: {
        id: true,
        name: true,
        slaConfig: true,
        updatedAt: true,
      },
    });

    return updated;
  }
}

export class ClientNotFoundError extends Error {
  constructor(clientId: string) {
    super(`Client not found: ${clientId}`);
    this.name = 'ClientNotFoundError';
  }
}

export class TeamNotFoundForClientError extends Error {
  constructor(teamId: string) {
    super(`Team not found: ${teamId}`);
    this.name = 'TeamNotFoundForClientError';
  }
}

export class ClientTeamOrgMismatchError extends Error {
  constructor(clientId: string, teamId: string) {
    super(`Client ${clientId} and team ${teamId} belong to different organisations`);
    this.name = 'ClientTeamOrgMismatchError';
  }
}

export class ClientTeamMappingExistsError extends Error {
  constructor(clientId: string, teamId: string) {
    super(`Client ${clientId} is already mapped to team ${teamId}`);
    this.name = 'ClientTeamMappingExistsError';
  }
}
