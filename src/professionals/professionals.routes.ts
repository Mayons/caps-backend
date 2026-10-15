import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { Role } from '@prisma/client';
import { requireRole, requireUser } from '../auth/auth.middleware';
import { getCurrentUser, getIdentity } from '../auth/request-context';
import { ADMIN_ROLES } from '../common/roles';
import { paginationSchema } from '../common/pagination';
import { emailSchema, idParamsSchema, nameSchema, phoneSchema, uuidSchema } from '../common/validation';
import * as professionalsService from './professionals.service';
import * as invitationsService from './invitations.service';

const professionalSchema = z
  .object({
    firstName: nameSchema,
    lastName: nameSchema,
    email: emailSchema,
    phone: phoneSchema,
    licenseNumber: z.string().trim().max(40).nullable().optional(),
    isActive: z.boolean().optional(),
    allowAvailabilityManagement: z.boolean().optional(),
    specialtyIds: z
      .array(uuidSchema)
      .min(1, 'elegí al menos una especialidad')
      .transform((ids) => [...new Set(ids)]),
  })
  .strict();

const listQuerySchema = z.object({ specialtyId: uuidSchema.optional() });
const manageQuerySchema = paginationSchema.extend({ search: z.string().trim().max(80).optional() });
const linkSchema = z.object({ token: z.string().min(20).max(200) }).strict();

export function createProfessionalsRouter(authenticate: RequestHandler) {
  const router = Router();
  const adminOnly = [authenticate, requireUser, requireRole(...ADMIN_ROLES)];

  // ---- Público ----
  router.get('/', async (req, res) => {
    const { specialtyId } = listQuerySchema.parse(req.query);
    res.json(await professionalsService.listPublicProfessionals(specialtyId));
  });

  // ---- Vinculación de cuenta (cualquier usuario registrado con una invitación) ----
  router.post('/link', authenticate, requireUser, async (req, res) => {
    const { token } = linkSchema.parse(req.body);
    res.json(await invitationsService.acceptInvitation(token, getCurrentUser(req), getIdentity(req)));
  });

  // ---- Administración ----
  router.get('/manage', ...adminOnly, async (req, res) => {
    const { search, ...pagination } = manageQuerySchema.parse(req.query);
    res.json(await professionalsService.listManagedProfessionals(search, pagination));
  });

  router.get('/:id/manage', ...adminOnly, async (req, res) => {
    const { id } = idParamsSchema.parse(req.params);
    res.json(await professionalsService.getManagedProfessional(id));
  });

  router.post('/', ...adminOnly, async (req, res) => {
    const input = professionalSchema.parse(req.body);
    res.status(201).json(await professionalsService.createProfessional(input));
  });

  router.patch('/:id', ...adminOnly, async (req, res) => {
    const { id } = idParamsSchema.parse(req.params);
    const input = professionalSchema.partial().parse(req.body);
    res.json(await professionalsService.updateProfessional(id, input));
  });

  router.post('/:id/invitations', ...adminOnly, async (req, res) => {
    const { id } = idParamsSchema.parse(req.params);
    res.status(201).json(await invitationsService.createInvitation(id, getCurrentUser(req)));
  });

  router.delete('/:id/invitations', ...adminOnly, async (req, res) => {
    const { id } = idParamsSchema.parse(req.params);
    res.json(await invitationsService.revokePendingInvitations(id));
  });

  // Solo el Super Admin puede revocar el acceso de un profesional.
  router.post(
    '/:id/revoke-access',
    authenticate,
    requireUser,
    requireRole(Role.SUPER_ADMIN),
    async (req, res) => {
      const { id } = idParamsSchema.parse(req.params);
      res.json(await professionalsService.revokeProfessionalAccess(id));
    },
  );

  router.get('/:id', async (req, res) => {
    const { id } = idParamsSchema.parse(req.params);
    res.json(await professionalsService.getPublicProfessional(id));
  });

  return router;
}
