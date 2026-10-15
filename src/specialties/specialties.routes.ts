import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { requireRole, requireUser } from '../auth/auth.middleware';
import { ADMIN_ROLES } from '../common/roles';
import { idParamsSchema } from '../common/validation';
import * as specialtiesService from './specialties.service';

const specialtySchema = z
  .object({
    name: z.string().trim().min(2, 'es obligatorio').max(80),
    description: z.string().trim().max(300).nullable().optional(),
    isActive: z.boolean().optional(),
  })
  .strict();

export function createSpecialtiesRouter(authenticate: RequestHandler) {
  const router = Router();
  const adminOnly = [authenticate, requireUser, requireRole(...ADMIN_ROLES)];

  // Público: especialidades activas.
  router.get('/', async (_req, res) => {
    res.json(await specialtiesService.listSpecialties({ includeInactive: false }));
  });

  // Administración: incluye las desactivadas.
  router.get('/manage', ...adminOnly, async (_req, res) => {
    res.json(await specialtiesService.listSpecialties({ includeInactive: true }));
  });

  router.post('/', ...adminOnly, async (req, res) => {
    const input = specialtySchema.parse(req.body);
    res.status(201).json(await specialtiesService.createSpecialty(input));
  });

  router.patch('/:id', ...adminOnly, async (req, res) => {
    const { id } = idParamsSchema.parse(req.params);
    const input = specialtySchema.partial().parse(req.body);
    res.json(await specialtiesService.updateSpecialty(id, input));
  });

  return router;
}
