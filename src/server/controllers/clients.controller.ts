import { Request, Response, NextFunction } from 'express';
import {
  ClientService,
  ClientNotFoundError,
  TeamNotFoundForClientError,
  ClientTeamOrgMismatchError,
  ClientTeamMappingExistsError,
} from '../services/client.service';
import { prisma } from '../config/database';

const clientService = new ClientService(prisma);

export async function onboardClient(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const client = await clientService.onboardClient(req.user.orgId, req.body);
    res.status(201).json(client);
  } catch (err) {
    next(err);
  }
}

export async function listClients(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const clients = await clientService.listClients(req.user.orgId);
    res.status(200).json(clients);
  } catch (err) {
    next(err);
  }
}

export async function getClient(req: Request, res: Response, next: NextFunction) {
  try {
    const client = await clientService.getClientDetail(req.params.id);

    if (!client) {
      res.status(404).json({ error: 'Client not found' });
      return;
    }

    res.status(200).json(client);
  } catch (err) {
    next(err);
  }
}

export async function updateClient(req: Request, res: Response, next: NextFunction) {
  try {
    const updated = await clientService.updateClient(req.params.id, req.body);

    if (!updated) {
      res.status(404).json({ error: 'Client not found' });
      return;
    }

    res.status(200).json(updated);
  } catch (err) {
    next(err);
  }
}

export async function updateSlaConfig(req: Request, res: Response, next: NextFunction) {
  try {
    const { config } = req.body;

    if (!config || typeof config !== 'object') {
      res.status(400).json({ error: 'config object is required' });
      return;
    }

    const updated = await clientService.updateSlaConfig(req.params.id, config);

    if (!updated) {
      res.status(404).json({ error: 'Client not found' });
      return;
    }

    res.status(200).json(updated);
  } catch (err) {
    next(err);
  }
}

export async function mapClientToTeam(req: Request, res: Response, next: NextFunction) {
  try {
    const { teamId } = req.body;

    if (!teamId) {
      res.status(400).json({ error: 'teamId is required' });
      return;
    }

    const mapping = await clientService.mapClientToTeam(req.params.id, teamId);
    res.status(201).json(mapping);
  } catch (err: any) {
    if (err instanceof ClientNotFoundError) {
      res.status(404).json({ error: err.message });
      return;
    }
    if (
      err instanceof TeamNotFoundForClientError ||
      err instanceof ClientTeamOrgMismatchError
    ) {
      res.status(400).json({ error: err.message });
      return;
    }
    if (err instanceof ClientTeamMappingExistsError) {
      res.status(409).json({ error: err.message });
      return;
    }
    next(err);
  }
}
