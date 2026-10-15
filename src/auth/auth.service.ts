import type { User } from '@prisma/client';
import { prisma } from '../common/prisma';
import { badRequest, conflict, isUniqueViolation } from '../common/errors';
import type { Identity } from './token-verifier';

/** Datos del usuario que se pueden mostrar al propio usuario. */
type ProfessionalLink = { id: string; allowAvailabilityManagement: boolean } | null;

export function toUserProfile(user: User & { professional?: ProfessionalLink }) {
  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    phone: user.phone,
    role: user.role,
    isActive: user.isActive,
    professionalId: user.professional?.id ?? null,
    canManageOwnAvailability: user.professional?.allowAvailabilityManagement ?? false,
  };
}

export const professionalLinkSelect = { id: true, allowAvailabilityManagement: true } as const;

interface RegisterInput {
  firstName: string;
  lastName: string;
  phone?: string;
}

/**
 * Registro público: crea SIEMPRE un usuario con rol PATIENT.
 * El email se toma del token verificado de Firebase, nunca del formulario.
 */
export async function registerPatient(identity: Identity, input: RegisterInput) {
  if (!identity.email) {
    throw badRequest('EMAIL_REQUIRED', 'Tu cuenta de acceso no tiene un email asociado');
  }
  const email = identity.email.trim().toLowerCase();

  try {
    const user = await prisma.user.create({
      data: {
        firebaseUid: identity.uid,
        email,
        firstName: input.firstName,
        lastName: input.lastName,
        phone: input.phone ?? null,
        role: 'PATIENT',
      },
    });
    return toUserProfile(user);
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw conflict('ALREADY_REGISTERED', 'Ya existe una cuenta de CAPS para esta identidad o este email');
    }
    throw error;
  }
}

export async function getProfile(userId: string) {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    include: { professional: { select: professionalLinkSelect } },
  });
  return toUserProfile(user);
}

export async function updateProfile(userId: string, input: Partial<RegisterInput>) {
  const user = await prisma.user.update({
    where: { id: userId },
    data: input,
    include: { professional: { select: professionalLinkSelect } },
  });
  return toUserProfile(user);
}
