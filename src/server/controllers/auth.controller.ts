import { Request, Response, NextFunction } from 'express';
import { AuthService } from '../services/auth.service';
import { prisma } from '../config/database';

const authService = new AuthService(prisma);

export async function signup(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await authService.signup(req.body);
    res.status(201).json(result);
  } catch (err: any) {
    if (err.message.includes('already exists') || err.message.includes('Password')) {
      res.status(400).json({ error: err.message });
    } else {
      next(err);
    }
  }
}

export async function login(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await authService.login(req.body);
    if (result.requiresMfa) {
      res.status(200).json({ requiresMfa: true, userId: result.user.id });
      return;
    }
    res.status(200).json(result);
  } catch (err: any) {
    if (err.message.includes('Invalid') || err.message.includes('locked') || err.message.includes('deactivated')) {
      res.status(401).json({ error: err.message });
    } else {
      next(err);
    }
  }
}

export async function refreshTokens(req: Request, res: Response, next: NextFunction) {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) {
      res.status(400).json({ error: 'refreshToken is required' });
      return;
    }
    const tokens = await authService.refreshTokens(refreshToken);
    res.status(200).json(tokens);
  } catch (err: any) {
    if (err.message.includes('Invalid') || err.message.includes('expired')) {
      res.status(401).json({ error: err.message });
    } else {
      next(err);
    }
  }
}

export async function logout(req: Request, res: Response, next: NextFunction) {
  try {
    const { refreshToken } = req.body;
    if (!req.user || !refreshToken) {
      res.status(400).json({ error: 'refreshToken is required' });
      return;
    }
    await authService.logout(req.user.sub, refreshToken);
    res.status(200).json({ message: 'Logged out successfully' });
  } catch (err) {
    next(err);
  }
}

export async function me(req: Request, res: Response) {
  if (!req.user) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }

  const user = await prisma.user.findUnique({
    where: { id: req.user.sub },
    select: {
      id: true, email: true, name: true, specialisation: true,
      status: true, mfaEnabled: true, lastLoginAt: true,
      role: { select: { name: true, permissions: true } },
      organisation: { select: { id: true, name: true, type: true } },
    },
  });

  if (!user) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  res.status(200).json(user);
}

export async function changePassword(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }
    await authService.changePassword(req.user.sub, req.body);
    res.status(200).json({ message: 'Password changed successfully' });
  } catch (err: any) {
    if (err.message.includes('incorrect') || err.message.includes('Password') || err.message.includes('reuse')) {
      res.status(400).json({ error: err.message });
    } else {
      next(err);
    }
  }
}

export async function toggleMfa(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }
    const { enabled } = req.body;
    if (typeof enabled !== 'boolean') {
      res.status(400).json({ error: 'enabled must be a boolean' });
      return;
    }
    await authService.toggleMfa(req.user.sub, enabled);
    res.status(200).json({ message: 'MFA status updated' });
  } catch (err) {
    next(err);
  }
}
