import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { Role } from '@prisma/client';
import { requireRole, requireUser } from '../auth/auth.middleware';
import { getCurrentUser } from '../auth/request-context';
import { paginationSchema } from '../common/pagination';
import { emailSchema, idParamsSchema, nameSchema, phoneSchema } from '../common/validation';
import * as usersService from './users.service';

const listQuerySchema = paginationSchema.extend({
  search: z.string().trim().max(80).optional(),
  role: z.enum(Role).optional(),
});
const roleSchema = z.object({ role: z.enum(usersService.ASSIGNABLE_ROLES) }).strict();
const statusSchema = z.object({ isActive: z.boolean() }).strict();
const createUserSchema = z.object({
  email: emailSchema,
  firstName: nameSchema,
  lastName: nameSchema,
  phone: phoneSchema.optional(),
  role: z.enum(usersService.ASSIGNABLE_ROLES),
}).strict();

export function createUsersRouter(authenticate: RequestHandler) {
  const router = Router();
  router.use(authenticate, requireUser, requireRole(Role.ADMIN, Role.SUPER_ADMIN));

  router.get('/', async (req, res) => {
    const { search, role, ...pagination } = listQuerySchema.parse(req.query);
    res.json(await usersService.listUsers({ search, role }, pagination));
  });

  router.post('/', async (req, res) => {
    const input = createUserSchema.parse(req.body);
    res.status(201).json(await usersService.createUser(getCurrentUser(req), input));
  });

  router.patch('/:id/role', async (req, res) => {
    const { id } = idParamsSchema.parse(req.params);
    const { role } = roleSchema.parse(req.body);
    res.json(await usersService.changeRole(getCurrentUser(req), id, role));
  });

  router.patch('/:id/status', requireRole(Role.SUPER_ADMIN), async (req, res) => {
    const { id } = idParamsSchema.parse(req.params);
    const { isActive } = statusSchema.parse(req.body);
    res.json(await usersService.changeStatus(getCurrentUser(req), id, isActive));
  });

  router.delete('/:id', requireRole(Role.SUPER_ADMIN), async (req, res) => {
    const { id } = idParamsSchema.parse(req.params);
    await usersService.deleteUser(getCurrentUser(req), id);
    res.status(204).end();
  });

  return router;
}
