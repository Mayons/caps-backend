import type { Availability, Prisma, User } from '@prisma/client';
import { prisma } from '../common/prisma';
import { env } from '../config/env';
import { argentinaDayRange, minutesBetween } from '../config/time';
import { badRequest, conflict, forbidden, isConstraintError, notFound } from '../common/errors';
import { isSchedulingStaff } from '../common/roles';
import { generateSlots } from './slots';

const MAX_BLOCK_HOURS = 16;

export function toBlockResponse(block: Availability) {
  return {
    id: block.id,
    professionalId: block.professionalId,
    startAt: block.startAt,
    endAt: block.endAt,
    status: block.status,
  };
}

/**
 * Personal de turnos (gestor, admin, super admin): puede gestionar cualquier profesional.
 * Profesional: solo su propia disponibilidad y solo si tiene el permiso habilitado.
 */
async function assertCanManageAvailability(actor: User, professionalId: string) {
  if (isSchedulingStaff(actor.role)) return;
  if (actor.role === 'PROFESSIONAL') {
    const own = await prisma.professional.findUnique({ where: { userId: actor.id } });
    if (own && own.id === professionalId && own.allowAvailabilityManagement) return;
  }
  throw forbidden('FORBIDDEN', 'No tenés permiso para gestionar esta disponibilidad');
}

function validateRange(startAt: Date, endAt: Date) {
  if (startAt <= new Date()) {
    throw badRequest('AVAILABILITY_IN_PAST', 'La disponibilidad debe empezar en el futuro');
  }
  const minutes = minutesBetween(startAt, endAt);
  if (minutes < env.APPOINTMENT_DURATION_MINUTES) {
    throw badRequest(
      'AVAILABILITY_TOO_SHORT',
      `El bloque debe durar al menos ${env.APPOINTMENT_DURATION_MINUTES} minutos`,
    );
  }
  if (minutes > MAX_BLOCK_HOURS * 60) {
    throw badRequest('AVAILABILITY_TOO_LONG', `El bloque no puede durar más de ${MAX_BLOCK_HOURS} horas`);
  }
}

function handleOverlap(error: unknown): never {
  if (isConstraintError(error, 'Availability_no_overlap')) {
    throw conflict('AVAILABILITY_OVERLAP', 'El bloque se superpone con otro bloque activo del profesional');
  }
  throw error;
}

/** Bloquea la fila del bloque hasta el final de la transacción. */
async function lockBlock(tx: Prisma.TransactionClient, id: string) {
  await tx.$queryRaw`SELECT id FROM "Availability" WHERE id = ${id}::uuid FOR UPDATE`;
  const block = await tx.availability.findUnique({ where: { id } });
  if (!block) throw notFound('Bloque de disponibilidad no encontrado');
  return block;
}

function confirmedInRange(professionalId: string, startAt: Date, endAt: Date): Prisma.AppointmentWhereInput {
  return { professionalId, status: 'CONFIRMED', startAt: { lt: endAt }, endAt: { gt: startAt } };
}

export async function listSlots(filters: { date: string; professionalId?: string; specialtyId?: string }) {
  const { start, end } = argentinaDayRange(filters.date);
  const professionals = await prisma.professional.findMany({
    where: {
      isActive: true,
      ...(filters.professionalId ? { id: filters.professionalId } : {}),
      specialties: {
        some: {
          specialty: { isActive: true, ...(filters.specialtyId ? { id: filters.specialtyId } : {}) },
        },
      },
    },
    include: { specialties: { include: { specialty: true } } },
    orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
  });
  const ids = professionals.map((professional) => professional.id);

  const [blocks, booked] = await Promise.all([
    prisma.availability.findMany({
      where: { professionalId: { in: ids }, status: 'ACTIVE', startAt: { lt: end }, endAt: { gt: start } },
    }),
    prisma.appointment.findMany({
      where: { professionalId: { in: ids }, status: 'CONFIRMED', startAt: { lt: end }, endAt: { gt: start } },
      select: { professionalId: true, startAt: true, endAt: true },
    }),
  ]);

  const now = new Date();
  return {
    date: filters.date,
    durationMinutes: env.APPOINTMENT_DURATION_MINUTES,
    professionals: professionals
      .map((professional) => ({
        id: professional.id,
        firstName: professional.firstName,
        lastName: professional.lastName,
        specialties: professional.specialties
          .filter((link) => link.specialty.isActive)
          .map((link) => ({ id: link.specialty.id, name: link.specialty.name })),
        slots: generateSlots({
          blocks: blocks.filter((block) => block.professionalId === professional.id),
          booked: booked.filter((appointment) => appointment.professionalId === professional.id),
          durationMinutes: env.APPOINTMENT_DURATION_MINUTES,
          from: start,
          to: end,
          now,
        }),
      }))
      .filter((professional) => professional.slots.length > 0),
  };
}

export async function listBlocks(
  actor: User,
  filters: { professionalId?: string; from?: Date; to?: Date; includeInactive: boolean },
) {
  let professionalId = filters.professionalId;
  if (!isSchedulingStaff(actor.role)) {
    // Un profesional solo puede ver sus propios bloques.
    const own = await prisma.professional.findUnique({ where: { userId: actor.id } });
    if (!own || (professionalId && professionalId !== own.id)) {
      throw forbidden('FORBIDDEN', 'Solo podés consultar tu propia disponibilidad');
    }
    professionalId = own.id;
  }

  const blocks = await prisma.availability.findMany({
    where: {
      ...(professionalId ? { professionalId } : {}),
      ...(filters.includeInactive ? {} : { status: 'ACTIVE' }),
      endAt: { gt: filters.from ?? new Date() },
      ...(filters.to ? { startAt: { lt: filters.to } } : {}),
    },
    include: { professional: { select: { id: true, firstName: true, lastName: true } } },
    orderBy: { startAt: 'asc' },
    take: 500,
  });

  // Cantidad de turnos confirmados dentro de cada bloque (útil para saber si se puede modificar).
  return Promise.all(
    blocks.map(async (block) => ({
      ...toBlockResponse(block),
      professional: block.professional,
      confirmedAppointments: await prisma.appointment.count({
        where: confirmedInRange(block.professionalId, block.startAt, block.endAt),
      }),
    })),
  );
}

export async function createBlock(actor: User, input: { professionalId: string; startAt: Date; endAt: Date }) {
  await assertCanManageAvailability(actor, input.professionalId);
  validateRange(input.startAt, input.endAt);

  const professional = await prisma.professional.findUnique({ where: { id: input.professionalId } });
  if (!professional) throw notFound('Profesional no encontrado');
  if (!professional.isActive) throw conflict('PROFESSIONAL_INACTIVE', 'El profesional está desactivado');

  try {
    const block = await prisma.availability.create({
      data: { ...input, createdByUserId: actor.id },
    });
    return toBlockResponse(block);
  } catch (error) {
    handleOverlap(error);
  }
}

export async function updateBlock(actor: User, id: string, input: { startAt?: Date; endAt?: Date }) {
  try {
    const block = await prisma.$transaction(async (tx) => {
      const current = await lockBlock(tx, id);
      await assertCanManageAvailability(actor, current.professionalId);
      if (current.status !== 'ACTIVE' || current.startAt <= new Date()) {
        throw conflict('AVAILABILITY_NOT_EDITABLE', 'Solo se pueden modificar bloques activos que todavía no empezaron');
      }

      const startAt = input.startAt ?? current.startAt;
      const endAt = input.endAt ?? current.endAt;
      validateRange(startAt, endAt);

      // Los turnos confirmados del bloque tienen que seguir quedando adentro.
      const outside = await tx.appointment.count({
        where: {
          ...confirmedInRange(current.professionalId, current.startAt, current.endAt),
          OR: [{ startAt: { lt: startAt } }, { endAt: { gt: endAt } }],
        },
      });
      if (outside > 0) {
        throw conflict(
          'AVAILABILITY_HAS_APPOINTMENTS',
          'El cambio dejaría turnos confirmados fuera de la disponibilidad. Reprogramalos o cancelalos primero',
        );
      }
      return tx.availability.update({ where: { id }, data: { startAt, endAt } });
    });
    return toBlockResponse(block);
  } catch (error) {
    handleOverlap(error);
  }
}

export async function deactivateBlock(actor: User, id: string) {
  const block = await prisma.$transaction(async (tx) => {
    const current = await lockBlock(tx, id);
    await assertCanManageAvailability(actor, current.professionalId);
    if (current.status !== 'ACTIVE') {
      throw conflict('AVAILABILITY_NOT_EDITABLE', 'El bloque ya está desactivado');
    }
    if (current.endAt <= new Date()) {
      throw conflict('AVAILABILITY_NOT_EDITABLE', 'No se pueden desactivar bloques que ya terminaron');
    }
    const pending = await tx.appointment.count({
      where: { ...confirmedInRange(current.professionalId, current.startAt, current.endAt), endAt: { gt: new Date() } },
    });
    if (pending > 0) {
      throw conflict(
        'AVAILABILITY_HAS_APPOINTMENTS',
        'El bloque tiene turnos confirmados. Reprogramalos o cancelalos antes de desactivarlo',
      );
    }
    return tx.availability.update({ where: { id }, data: { status: 'INACTIVE' } });
  });
  return toBlockResponse(block);
}
