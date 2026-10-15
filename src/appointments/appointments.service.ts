import type { AppointmentStatus, Prisma, User } from '@prisma/client';
import { prisma } from '../common/prisma';
import { env } from '../config/env';
import { addMinutes, argentinaDayRange } from '../config/time';
import { badRequest, conflict, forbidden, isConstraintError, notFound } from '../common/errors';
import { paginated, toPrismaPagination, type Pagination } from '../common/pagination';
import { isSchedulingStaff } from '../common/roles';
import { isAlignedWithBlock } from '../availability/slots';

const appointmentInclude = {
  professional: { select: { id: true, firstName: true, lastName: true } },
  specialty: { select: { id: true, name: true } },
  patient: { select: { id: true, firstName: true, lastName: true, email: true, phone: true } },
} satisfies Prisma.AppointmentInclude;

type AppointmentWithRelations = Prisma.AppointmentGetPayload<{ include: typeof appointmentInclude }>;

/**
 * Qué datos del paciente se devuelven:
 * - 'none': el propio paciente ya sabe quién es.
 * - 'minimal': el profesional ve nombre y teléfono.
 * - 'contact': el personal de turnos ve también el email.
 */
type PatientDetail = 'none' | 'minimal' | 'contact';

export function toAppointmentResponse(appointment: AppointmentWithRelations, patientDetail: PatientDetail) {
  const { patient } = appointment;
  return {
    id: appointment.id,
    startAt: appointment.startAt,
    endAt: appointment.endAt,
    status: appointment.status,
    professional: appointment.professional,
    specialty: appointment.specialty,
    ...(patientDetail === 'none'
      ? {}
      : {
          patient: {
            id: patient.id,
            firstName: patient.firstName,
            lastName: patient.lastName,
            phone: patient.phone,
            ...(patientDetail === 'contact' ? { email: patient.email } : {}),
          },
        }),
  };
}

function patientDetailFor(actor: User): PatientDetail {
  if (isSchedulingStaff(actor.role)) return 'contact';
  if (actor.role === 'PROFESSIONAL') return 'minimal';
  return 'none';
}

interface BookingInput {
  professionalId: string;
  specialtyId: string;
  startAt: Date;
}

/**
 * Reglas de negocio de una reserva. Se ejecuta dentro de la transacción y
 * deja "tomado" (FOR SHARE) el bloque de disponibilidad para que nadie lo
 * modifique o desactive mientras se guarda el turno.
 */
async function validateBooking(tx: Prisma.TransactionClient, input: BookingInput) {
  if (input.startAt <= new Date()) {
    throw badRequest('APPOINTMENT_IN_PAST', 'No se pueden reservar turnos en el pasado');
  }

  const professional = await tx.professional.findUnique({
    where: { id: input.professionalId },
    include: { specialties: { include: { specialty: true } } },
  });
  if (!professional || !professional.isActive) throw notFound('Profesional no encontrado');

  const offersSpecialty = professional.specialties.some(
    (link) => link.specialtyId === input.specialtyId && link.specialty.isActive,
  );
  if (!offersSpecialty) {
    throw badRequest('SPECIALTY_MISMATCH', 'El profesional no atiende la especialidad seleccionada');
  }

  const endAt = addMinutes(input.startAt, env.APPOINTMENT_DURATION_MINUTES);
  const blocks = await tx.$queryRaw<{ id: string; startAt: Date }[]>`
    SELECT id, "startAt" FROM "Availability"
    WHERE "professionalId" = ${input.professionalId}::uuid
      AND status = 'ACTIVE'
      AND "startAt" <= ${input.startAt}
      AND "endAt" >= ${endAt}
    FOR SHARE`;
  const block = blocks[0];
  if (!block || !isAlignedWithBlock(block.startAt, input.startAt, env.APPOINTMENT_DURATION_MINUTES)) {
    throw conflict('SLOT_NOT_AVAILABLE', 'El horario elegido no está dentro de la disponibilidad publicada');
  }
  return { endAt };
}

/** Traduce las restricciones de la base de datos a errores entendibles. */
function handleOverlapErrors(error: unknown): never {
  if (isConstraintError(error, 'Appointment_professional_no_overlap')) {
    throw conflict('SLOT_TAKEN', 'Ese horario acaba de ser reservado. Elegí otro');
  }
  if (isConstraintError(error, 'Appointment_patient_no_overlap')) {
    throw conflict('PATIENT_HAS_APPOINTMENT', 'Ya tenés otro turno en ese horario');
  }
  throw error;
}

export async function bookAppointment(patient: User, input: BookingInput) {
  try {
    const appointment = await prisma.$transaction(async (tx) => {
      const { endAt } = await validateBooking(tx, input);
      return tx.appointment.create({
        data: { ...input, endAt, patientId: patient.id, status: 'CONFIRMED' },
        include: appointmentInclude,
      });
    });
    return toAppointmentResponse(appointment, 'none');
  } catch (error) {
    handleOverlapErrors(error);
  }
}

/**
 * Busca un turno respetando la propiedad del recurso. Si el usuario no puede
 * verlo devolvemos 404 (no 403) para no revelar que existe.
 */
async function findAccessibleAppointment(tx: Prisma.TransactionClient, actor: User, id: string) {
  const appointment = await tx.appointment.findUnique({ where: { id }, include: appointmentInclude });
  if (!appointment) throw notFound('Turno no encontrado');

  if (isSchedulingStaff(actor.role)) return appointment;
  if (actor.role === 'PATIENT' && appointment.patientId === actor.id) return appointment;
  if (actor.role === 'PROFESSIONAL') {
    const own = await tx.professional.findUnique({ where: { userId: actor.id }, select: { id: true } });
    if (own?.id === appointment.professionalId) return appointment;
  }
  throw notFound('Turno no encontrado');
}

/** Solo el paciente dueño del turno o el personal de turnos pueden modificarlo. */
function assertCanModify(actor: User, appointment: AppointmentWithRelations) {
  const isOwner = actor.role === 'PATIENT' && appointment.patientId === actor.id;
  if (!isOwner && !isSchedulingStaff(actor.role)) {
    throw forbidden('FORBIDDEN', 'No tenés permiso para modificar este turno');
  }
  if (appointment.status !== 'CONFIRMED') {
    throw conflict('APPOINTMENT_NOT_EDITABLE', 'El turno está cancelado');
  }
  if (appointment.startAt <= new Date()) {
    throw conflict('APPOINTMENT_NOT_EDITABLE', 'No se pueden modificar turnos que ya pasaron');
  }
}

export async function getAppointment(actor: User, id: string) {
  const appointment = await findAccessibleAppointment(prisma, actor, id);
  return toAppointmentResponse(appointment, patientDetailFor(actor));
}

export async function rescheduleAppointment(actor: User, id: string, input: Partial<BookingInput>) {
  try {
    const appointment = await prisma.$transaction(async (tx) => {
      // Bloquea el turno para evitar dos ediciones simultáneas.
      await tx.$queryRaw`SELECT id FROM "Appointment" WHERE id = ${id}::uuid FOR UPDATE`;
      const current = await findAccessibleAppointment(tx, actor, id);
      assertCanModify(actor, current);

      const booking: BookingInput = {
        professionalId: input.professionalId ?? current.professionalId,
        specialtyId: input.specialtyId ?? current.specialtyId,
        startAt: input.startAt ?? current.startAt,
      };
      const { endAt } = await validateBooking(tx, booking);
      return tx.appointment.update({
        where: { id },
        data: { ...booking, endAt },
        include: appointmentInclude,
      });
    });
    return toAppointmentResponse(appointment, patientDetailFor(actor));
  } catch (error) {
    handleOverlapErrors(error);
  }
}

export async function cancelAppointment(actor: User, id: string) {
  const appointment = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Appointment" WHERE id = ${id}::uuid FOR UPDATE`;
    const current = await findAccessibleAppointment(tx, actor, id);
    assertCanModify(actor, current);
    // El registro se conserva con estado CANCELLED.
    return tx.appointment.update({
      where: { id },
      data: { status: 'CANCELLED' },
      include: appointmentInclude,
    });
  });
  return toAppointmentResponse(appointment, patientDetailFor(actor));
}

export async function listPatientAppointments(
  patient: User,
  filters: { scope: 'upcoming' | 'past' | 'all' },
  pagination: Pagination,
) {
  const now = new Date();
  const where: Prisma.AppointmentWhereInput = {
    patientId: patient.id,
    ...(filters.scope === 'upcoming' ? { startAt: { gte: now } } : {}),
    ...(filters.scope === 'past' ? { startAt: { lt: now } } : {}),
  };
  const [items, total] = await prisma.$transaction([
    prisma.appointment.findMany({
      where,
      include: appointmentInclude,
      orderBy: { startAt: filters.scope === 'past' ? 'desc' : 'asc' },
      ...toPrismaPagination(pagination),
    }),
    prisma.appointment.count({ where }),
  ]);
  return paginated(
    items.map((item) => toAppointmentResponse(item, 'none')),
    total,
    pagination,
  );
}

/** Agenda del profesional vinculado al usuario actual. */
export async function getProfessionalAgenda(actor: User, date: string) {
  const own = await prisma.professional.findUnique({ where: { userId: actor.id } });
  if (!own) throw forbidden('PROFESSIONAL_NOT_LINKED', 'Tu cuenta no está vinculada a un profesional');

  const { start, end } = argentinaDayRange(date);
  const [appointments, upcomingConfirmed] = await Promise.all([
    prisma.appointment.findMany({
      where: { professionalId: own.id, startAt: { gte: start, lt: end } },
      include: appointmentInclude,
      orderBy: { startAt: 'asc' },
    }),
    prisma.appointment.count({
      where: { professionalId: own.id, status: 'CONFIRMED', startAt: { gte: new Date() } },
    }),
  ]);

  return {
    date,
    professional: { id: own.id, firstName: own.firstName, lastName: own.lastName },
    confirmedForDate: appointments.filter((item) => item.status === 'CONFIRMED').length,
    upcomingConfirmed,
    appointments: appointments.map((item) => toAppointmentResponse(item, 'minimal')),
  };
}

/** Listado general para el personal de turnos. */
export async function listAllAppointments(
  filters: { professionalId?: string; date?: string; status?: AppointmentStatus },
  pagination: Pagination,
) {
  const range = filters.date ? argentinaDayRange(filters.date) : null;
  const where: Prisma.AppointmentWhereInput = {
    ...(filters.professionalId ? { professionalId: filters.professionalId } : {}),
    ...(filters.status ? { status: filters.status } : {}),
    ...(range ? { startAt: { gte: range.start, lt: range.end } } : {}),
  };
  const [items, total] = await prisma.$transaction([
    prisma.appointment.findMany({
      where,
      include: appointmentInclude,
      orderBy: { startAt: 'asc' },
      ...toPrismaPagination(pagination),
    }),
    prisma.appointment.count({ where }),
  ]);
  return paginated(
    items.map((item) => toAppointmentResponse(item, 'contact')),
    total,
    pagination,
  );
}
