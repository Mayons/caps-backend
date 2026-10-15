import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { nameSchema, phoneSchema } from '../common/validation';
import { conflict } from '../common/errors';
import { requireUser } from './auth.middleware';
import { getCurrentUser, getIdentity } from './request-context';
import * as authService from './auth.service';

// `.strict()` rechaza campos desconocidos: enviar `role` en el registro da error 400.
const registerSchema = z
  .object({
    firstName: nameSchema,
    lastName: nameSchema,
    phone: phoneSchema.optional(),
  })
  .strict();

const updateProfileSchema = registerSchema.partial();

export function createAuthRouter(authenticate: RequestHandler) {
  const router = Router();

  router.post('/register', authenticate, async (req, res) => {
    if (req.currentUser) {
      throw conflict('ALREADY_REGISTERED', 'Ya completaste tu registro');
    }
    const input = registerSchema.parse(req.body);
    const profile = await authService.registerPatient(getIdentity(req), input);
    res.status(201).json(profile);
  });

  router.get('/me', authenticate, requireUser, async (req, res) => {
    res.json(await authService.getProfile(getCurrentUser(req).id));
  });

  router.patch('/me', authenticate, requireUser, async (req, res) => {
    const input = updateProfileSchema.parse(req.body);
    res.json(await authService.updateProfile(getCurrentUser(req).id, input));
  });

  return router;
}
