import { Request, Response, NextFunction } from 'express';
import { UserService, UserNotFoundError, RoleNotFoundError } from '../services/user.service';
import { prisma } from '../config/database';

const userService = new UserService(prisma);

export async function listUsers(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const filters = {
      search: req.query.search as string | undefined,
      roleId: req.query.roleId as string | undefined,
      status: req.query.status as string | undefined,
      page: req.query.page ? Number(req.query.page) : undefined,
      limit: req.query.limit ? Number(req.query.limit) : undefined,
    };

    const result = await userService.listUsers(req.user.orgId, filters);
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

export async function getUser(req: Request, res: Response, next: NextFunction) {
  try {
    const user = await userService.getUser(req.params.id);

    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    res.status(200).json(user);
  } catch (err) {
    next(err);
  }
}

export async function updateUser(req: Request, res: Response, next: NextFunction) {
  try {
    const updated = await userService.updateUser(req.params.id, req.body);

    if (!updated) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    res.status(200).json(updated);
  } catch (err) {
    next(err);
  }
}

export async function deactivateUser(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await userService.deactivateUser(req.params.id);

    if (!result) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

export async function changeRole(req: Request, res: Response, next: NextFunction) {
  try {
    const { roleId } = req.body;

    if (!roleId) {
      res.status(400).json({ error: 'roleId is required' });
      return;
    }

    const result = await userService.changeRole(req.params.id, roleId);
    res.status(200).json(result);
  } catch (err: any) {
    if (err instanceof UserNotFoundError) {
      res.status(404).json({ error: err.message });
      return;
    }
    if (err instanceof RoleNotFoundError) {
      res.status(400).json({ error: err.message });
      return;
    }
    next(err);
  }
}

export async function inviteUser(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const user = await userService.inviteUser(req.user.orgId, req.body);
    res.status(200).json(user);
  } catch (err) {
    next(err);
  }
}
