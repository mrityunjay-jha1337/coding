import { Request, Response, NextFunction } from 'express';

/**
 * Permission guard middleware factory.
 * Checks if the authenticated user has ANY of the required permissions.
 *
 * Permission format: "resource:action" or "resource:action:scope"
 * Wildcard '*' grants all permissions (SUPER_ADMIN).
 */
export function requirePermission(...requiredPermissions: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const userPermissions = req.user.permissions;

    // Wildcard = super admin
    if (userPermissions.includes('*')) {
      next();
      return;
    }

    const hasPermission = requiredPermissions.some((required) => {
      // Exact match
      if (userPermissions.includes(required)) return true;

      // Check if user has a broader permission (e.g., 'claims:read' covers 'claims:read:team')
      const parts = required.split(':');
      if (parts.length >= 2) {
        const broadPermission = parts.slice(0, 2).join(':');
        if (userPermissions.includes(broadPermission)) return true;
      }

      return false;
    });

    if (!hasPermission) {
      res.status(403).json({ error: 'Insufficient permissions' });
      return;
    }

    next();
  };
}

/**
 * Role guard middleware factory.
 * Checks if the authenticated user has one of the required roles.
 */
export function requireRole(...roleNames: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    if (!roleNames.includes(req.user.role)) {
      res.status(403).json({ error: 'Insufficient role' });
      return;
    }

    next();
  };
}
