import type { Prisma } from '@prisma/client';
import { prisma } from '../common/prisma';
import { badRequest, conflict, isUniqueViolation, notFound } from '../common/errors';
import { paginated, toPrismaPagination, type Pagination } from '../common/pagination';

const withSpecialties = {
  specialties: { include: { specialty: true }, orderBy: { specialty: { name: 'asc' } } },
} satisfies Prisma.ProfessionalInclude;

type ProfessionalWithSpecialties = Prisma.ProfessionalGetPayload<{ include: typeof withSpecialties }>;

/** Vista pública: sin email, teléfono ni matrícula. */
export function toPublicProfessional(professional: ProfessionalWithSpecialties) {
  return {
    id: professional.id,
    firstName: professional.firstName,
    lastName: professional.lastName,
    specialties: professional.specialties
      .filter((link) => link.specialty.isActive)
      .map((link) => ({ id: link.specialty.id, name: link.specialty.name })),
  };
}

/** Vista administrativa: incluye datos de contacto y estado de la cuenta. */
export function toManagedProfessional(
  professional: ProfessionalWithSpecialties & { invitations?: { expiresAt: Date }[] },
) {
  return {
    id: professional.id,
    firstName: professional.firstName,
    lastName: professional.lastName,
    email: professional.email,
    phone: professional.phone,
    licenseNumber: professional.licenseNumber,
    isActive: professional.isActive,
    allowAvailabilityManagement: professional.allowAvailabilityManagement,
    hasLinkedAccount: professional.userId !== null,
    pendingInvitationExpiresAt: professional.invitations?.[0]?.expiresAt ?? null,
    specialties: professional.specialties.map((link) => ({
      id: link.specialty.id,
      name: link.specialty.name,
      isActive: link.specialty.isActive,
    })),
  };
}

export async function listPublicProfessionals(specialtyId?: string) {
  const professionals = await prisma.professional.findMany({
    where: {
      isActive: true,
      specialties: {
        some: { specialty: { isActive: true, ...(specialtyId ? { id: specialtyId } : {}) } },
      },
    },
    include: withSpecialties,
    orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
  });
  return professionals.map(toPublicProfessional);
}

export async function getPublicProfessional(id: string) {
  const professional = await prisma.professional.findFirst({
    where: { id, isActive: true },
    include: withSpecialties,
  });
  if (!professional) throw notFound('Profesional no encontrado');
  return toPublicProfessional(professional);
}

function managedInclude() {
  // Solo la invitación pendiente más reciente (la fecha se calcula en cada consulta).
  return {
    ...withSpecialties,
    invitations: {
      where: { usedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
      take: 1,
      select: { expiresAt: true },
    },
  } satisfies Prisma.ProfessionalInclude;
}

export async function listManagedProfessionals(search: string | undefined, pagination: Pagination) {
  const where: Prisma.ProfessionalWhereInput = search
    ? {
        OR: [
          { firstName: { contains: search, mode: 'insensitive' } },
          { lastName: { contains: search, mode: 'insensitive' } },
          { email: { contains: search, mode: 'insensitive' } },
        ],
      }
    : {};
  const [items, total] = await prisma.$transaction([
    prisma.professional.findMany({
      where,
      include: managedInclude(),
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
      ...toPrismaPagination(pagination),
    }),
    prisma.professional.count({ where }),
  ]);
  return paginated(items.map(toManagedProfessional), total, pagination);
}

export async function getManagedProfessional(id: string) {
  const professional = await prisma.professional.findUnique({ where: { id }, include: managedInclude() });
  if (!professional) throw notFound('Profesional no encontrado');
  return toManagedProfessional(professional);
}

export interface ProfessionalInput {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  licenseNumber?: string | null;
  isActive?: boolean;
  allowAvailabilityManagement?: boolean;
  specialtyIds: string[];
}

async function assertSpecialtiesExist(tx: Prisma.TransactionClient, specialtyIds: string[]) {
  const found = await tx.specialty.count({ where: { id: { in: specialtyIds }, isActive: true } });
  if (found !== specialtyIds.length) {
    throw badRequest('INVALID_SPECIALTY', 'Alguna de las especialidades no existe o está desactivada');
  }
}

function handleDuplicateEmail(error: unknown): never {
  if (isUniqueViolation(error)) {
    throw conflict('PROFESSIONAL_EMAIL_TAKEN', 'Ya existe un profesional con ese email');
  }
  throw error;
}

export async function createProfessional(input: ProfessionalInput) {
  const { specialtyIds, ...data } = input;
  try {
    const id = await prisma.$transaction(async (tx) => {
      await assertSpecialtiesExist(tx, specialtyIds);
      const professional = await tx.professional.create({
        data: { ...data, specialties: { create: specialtyIds.map((specialtyId) => ({ specialtyId })) } },
      });
      return professional.id;
    });
    return getManagedProfessional(id);
  } catch (error) {
    handleDuplicateEmail(error);
  }
}

export async function updateProfessional(id: string, input: Partial<ProfessionalInput>) {
  const { specialtyIds, ...data } = input;
  try {
    await prisma.$transaction(async (tx) => {
      const existing = await tx.professional.findUnique({
        where: { id },
        include: { specialties: true },
      });
      if (!existing) throw notFound('Profesional no encontrado');

      // La vinculación de cuentas compara este email: no se cambia con una cuenta vinculada.
      if (data.email && data.email !== existing.email && existing.userId) {
        throw conflict(
          'PROFESSIONAL_LINKED',
          'No se puede cambiar el email de un profesional con cuenta vinculada. Revocá el acceso primero',
        );
      }

      if (specialtyIds) {
        const current = existing.specialties.map((link) => link.specialtyId);
        const toAdd = specialtyIds.filter((sid) => !current.includes(sid));
        const toRemove = current.filter((sid) => !specialtyIds.includes(sid));
        await assertSpecialtiesExist(tx, toAdd);

        // No quitar una especialidad que todavía tiene turnos futuros confirmados.
        const futureAppointments = await tx.appointment.count({
          where: {
            professionalId: id,
            specialtyId: { in: toRemove },
            status: 'CONFIRMED',
            startAt: { gt: new Date() },
          },
        });
        if (futureAppointments > 0) {
          throw conflict(
            'SPECIALTY_HAS_APPOINTMENTS',
            'No se puede quitar una especialidad que tiene turnos futuros confirmados',
          );
        }
        await tx.professionalSpecialty.deleteMany({
          where: { professionalId: id, specialtyId: { in: toRemove } },
        });
        await tx.professionalSpecialty.createMany({
          data: toAdd.map((specialtyId) => ({ professionalId: id, specialtyId })),
        });
      }

      await tx.professional.update({ where: { id }, data });
    });
    return getManagedProfessional(id);
  } catch (error) {
    handleDuplicateEmail(error);
  }
}

/**
 * Revoca el acceso de la cuenta vinculada sin borrar el profesional ni sus turnos.
 * La persona vuelve a ser un usuario PATIENT común.
 */
export async function revokeProfessionalAccess(id: string) {
  await prisma.$transaction(async (tx) => {
    const professional = await tx.professional.findUnique({ where: { id } });
    if (!professional) throw notFound('Profesional no encontrado');

    await tx.professionalInvitation.updateMany({
      where: { professionalId: id, usedAt: null, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (professional.userId) {
      await tx.professional.update({ where: { id }, data: { userId: null } });
      await tx.user.update({ where: { id: professional.userId }, data: { role: 'PATIENT' } });
    }
  });
  return getManagedProfessional(id);
}
