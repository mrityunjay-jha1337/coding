import { Router } from 'express';
import * as authController from '../controllers/auth.controller';
import { authenticate } from '../middleware/auth';
import { authLimiter } from '../middleware/rateLimiter';
import { validate } from '../middleware/validate';
import { z } from 'zod';

const router = Router();

const signupSchema = z.object({
  organisationName: z.string().min(2).max(200),
  organisationType: z.enum(['BPO', 'TPA', 'INSURER', 'BROKER']),
  fcaNumber: z.string().optional(),
  adminName: z.string().min(2).max(100),
  adminEmail: z.string().email(),
  adminPassword: z.string().min(12),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  mfaCode: z.string().optional(),
});

const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});

const changePasswordSchema = z.object({
  current: z.string().min(1),
  next: z.string().min(12),
});

const mfaToggleSchema = z.object({
  enabled: z.boolean(),
});

router.post('/signup', authLimiter, validate({ body: signupSchema }), authController.signup);
router.post('/login', authLimiter, validate({ body: loginSchema }), authController.login);
router.post('/refresh', validate({ body: refreshSchema }), authController.refreshTokens);
router.post('/logout', authenticate, authController.logout);
router.get('/me', authenticate, authController.me);
router.put('/password', authenticate, validate({ body: changePasswordSchema }), authController.changePassword);
router.put('/mfa', authenticate, validate({ body: mfaToggleSchema }), authController.toggleMfa);

export default router;
