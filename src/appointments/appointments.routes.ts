import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { AppointmentStatus, Role } from '@prisma/client';
import { requireRole, requireUser } from '../auth/auth.middleware';
import { getCurrentUser } from '../auth/request-context';
import { SCHEDULING_ROLES } from '../common/roles';
import { paginationSchema } from '../common/pagination';
import { dateSchema, dateTimeSchema, idParamsSchema, uuidSchema } from '../common/validation';
import { todayInArgentina } from '../config/time';
import * as appointmentsService from './appointments.service';

const bookingSchema = z
  .object({ professionalId: uuidSchema, specialtyId: uuidSchema, startAt: dateTimeSchema })
  .strict();
const rescheduleSchema = bookingSchema.partial();

const mineQuerySchema = paginationSchema.extend({
  scope: z.enum(['upcoming', 'past', 'all']).default('upcoming'),
});
const agendaQuerySchema = z.object({ date: dateSchema.optional() });
const staffQuerySchema = paginationSchema.extend({
  professionalId: uuidSchema.optional(),
  date: dateSchema.optional(),
  status: z.enum(AppointmentStatus).optional(),
});

export function createAppointmentsRouter(authenticate: RequestHandler) {
  const router = Router();
  router.use(authenticate, requireUser);

  // ---- Paciente ----
  router.post('/', requireRole(Role.PATIENT), async (req, res) => {
    const input = bookingSchema.parse(req.body);
    res.status(201).json(await appointmentsService.bookAppointment(getCurrentUser(req), input));
  });

  router.get('/mine', requireRole(Role.PATIENT), async (req, res) => {
    const { scope, ...pagination } = mineQuerySchema.parse(req.query);
    res.json(await appointmentsService.listPatientAppointments(getCurrentUser(req), { scope }, pagination));
  });

  // ---- Profesional ----
  router.get('/agenda', requireRole(Role.PROFESSIONAL), async (req, res) => {
    const { date } = agendaQuerySchema.parse(req.query);
    res.json(await appointmentsService.getProfessionalAgenda(getCurrentUser(req), date ?? todayInArgentina()));
  });

  // ---- Personal de turnos ----
  router.get('/', requireRole(...SCHEDULING_ROLES), async (req, res) => {
    const { professionalId, date, status, ...pagination } = staffQuerySchema.parse(req.query);
    res.json(await appointmentsService.listAllAppointments({ professionalId, date, status }, pagination));
  });

  // ---- Operaciones sobre un turno (la propiedad se valida en el servicio) ----
  router.get('/:id', async (req, res) => {
    const { id } = idParamsSchema.parse(req.params);
    res.json(await appointmentsService.getAppointment(getCurrentUser(req), id));
  });

  router.patch('/:id', async (req, res) => {
    const { id } = idParamsSchema.parse(req.params);
    const input = rescheduleSchema.parse(req.body);
    res.json(await appointmentsService.rescheduleAppointment(getCurrentUser(req), id, input));
  });

  router.post('/:id/cancel', async (req, res) => {
    const { id } = idParamsSchema.parse(req.params);
    res.json(await appointmentsService.cancelAppointment(getCurrentUser(req), id));
  });

  return router;
}
