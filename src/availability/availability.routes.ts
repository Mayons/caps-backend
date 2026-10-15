import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { Role } from '@prisma/client';
import { requireRole, requireUser } from '../auth/auth.middleware';
import { getCurrentUser } from '../auth/request-context';
import { SCHEDULING_ROLES } from '../common/roles';
import { dateSchema, dateTimeSchema, idParamsSchema, uuidSchema } from '../common/validation';
import * as availabilityService from './availability.service';

const slotsQuerySchema = z
  .object({
    date: dateSchema,
    professionalId: uuidSchema.optional(),
    specialtyId: uuidSchema.optional(),
  })
  .refine((query) => query.professionalId || query.specialtyId, {
    message: 'indicá una especialidad o un profesional',
    path: ['specialtyId'],
  });

const blocksQuerySchema = z.object({
  professionalId: uuidSchema.optional(),
  from: dateTimeSchema.optional(),
  to: dateTimeSchema.optional(),
  includeInactive: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
});

const createBlockSchema = z
  .object({ professionalId: uuidSchema, startAt: dateTimeSchema, endAt: dateTimeSchema })
  .strict();
const updateBlockSchema = z
  .object({ startAt: dateTimeSchema.optional(), endAt: dateTimeSchema.optional() })
  .strict();

export function createAvailabilityRouter(authenticate: RequestHandler) {
  const router = Router();
  // Los permisos finos (profesional con permiso habilitado) se validan en el servicio.
  const canWorkWithAvailability = [
    authenticate,
    requireUser,
    requireRole(...SCHEDULING_ROLES, Role.PROFESSIONAL),
  ];

  router.get('/slots', authenticate, requireUser, async (req, res) => {
    const query = slotsQuerySchema.parse(req.query);
    res.json(await availabilityService.listSlots(query));
  });

  router.get('/', ...canWorkWithAvailability, async (req, res) => {
    const query = blocksQuerySchema.parse(req.query);
    res.json(await availabilityService.listBlocks(getCurrentUser(req), query));
  });

  router.post('/', ...canWorkWithAvailability, async (req, res) => {
    const input = createBlockSchema.parse(req.body);
    res.status(201).json(await availabilityService.createBlock(getCurrentUser(req), input));
  });

  router.patch('/:id', ...canWorkWithAvailability, async (req, res) => {
    const { id } = idParamsSchema.parse(req.params);
    const input = updateBlockSchema.parse(req.body);
    res.json(await availabilityService.updateBlock(getCurrentUser(req), id, input));
  });

  router.post('/:id/deactivate', ...canWorkWithAvailability, async (req, res) => {
    const { id } = idParamsSchema.parse(req.params);
    res.json(await availabilityService.deactivateBlock(getCurrentUser(req), id));
  });

  return router;
}
