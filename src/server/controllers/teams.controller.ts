import { Request, Response, NextFunction } from 'express';
import {
  TeamService,
  TeamNotFoundError,
  TeamLeadNotFoundError,
  MemberNotFoundError,
  MemberOrgMismatchError,
  MemberAlreadyExistsError,
  MemberNotInTeamError,
} from '../services/team.service';
import { prisma } from '../config/database';

const teamService = new TeamService(prisma);

export async function createTeam(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const team = await teamService.createTeam(req.user.orgId, req.body);
    res.status(201).json(team);
  } catch (err: any) {
    if (err instanceof TeamLeadNotFoundError) {
      res.status(400).json({ error: err.message });
      return;
    }
    next(err);
  }
}

export async function listTeams(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const teams = await teamService.listTeams(req.user.orgId);
    res.status(200).json(teams);
  } catch (err) {
    next(err);
  }
}

export async function getTeam(req: Request, res: Response, next: NextFunction) {
  try {
    const team = await teamService.getTeamWithMembers(req.params.id);

    if (!team) {
      res.status(404).json({ error: 'Team not found' });
      return;
    }

    res.status(200).json(team);
  } catch (err) {
    next(err);
  }
}

export async function updateTeam(req: Request, res: Response, next: NextFunction) {
  try {
    const updated = await teamService.updateTeam(req.params.id, req.body);

    if (!updated) {
      res.status(404).json({ error: 'Team not found' });
      return;
    }

    res.status(200).json(updated);
  } catch (err) {
    next(err);
  }
}

export async function deleteTeam(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await teamService.deleteTeam(req.params.id);

    if (!result) {
      res.status(404).json({ error: 'Team not found' });
      return;
    }

    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

export async function addMember(req: Request, res: Response, next: NextFunction) {
  try {
    const { userId } = req.body;

    if (!userId) {
      res.status(400).json({ error: 'userId is required' });
      return;
    }

    const membership = await teamService.addMember(req.params.id, userId);
    res.status(201).json(membership);
  } catch (err: any) {
    if (err instanceof TeamNotFoundError) {
      res.status(404).json({ error: err.message });
      return;
    }
    if (
      err instanceof MemberNotFoundError ||
      err instanceof MemberOrgMismatchError
    ) {
      res.status(400).json({ error: err.message });
      return;
    }
    if (err instanceof MemberAlreadyExistsError) {
      res.status(409).json({ error: err.message });
      return;
    }
    next(err);
  }
}

export async function removeMember(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await teamService.removeMember(req.params.id, req.params.userId);
    res.status(200).json(result);
  } catch (err: any) {
    if (err instanceof MemberNotInTeamError) {
      res.status(404).json({ error: err.message });
      return;
    }
    next(err);
  }
}
