import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { requireRole, requireUser } from '../auth/auth.middleware';
import { ADMIN_ROLES } from '../common/roles';
import * as settingsService from './settings.service';

const settingsSchema = z
  .object({
    adminOnlyLogin: z.boolean(),
    registrationClosed: z.boolean(),
  })
  .partial()
  .strict();

export function createSettingsRouter(authenticate: RequestHandler) {
  const router = Router();
  const adminOnly = [authenticate, requireUser, requireRole(...ADMIN_ROLES)];

  router.get('/', ...adminOnly, async (_req, res) => {
    res.json(settingsService.toPublicSettings(await settingsService.getSettings()));
  });

  router.patch('/', ...adminOnly, async (req, res) => {
    const input = settingsSchema.parse(req.body);
    res.json(await settingsService.updateSettings(input));
  });

  return router;
}
