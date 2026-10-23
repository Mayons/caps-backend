import request from 'supertest';
import type { Role } from '@prisma/client';
import { createApp } from '../src/app';
import { prisma } from '../src/common/prisma';
import type { TokenVerifier } from '../src/auth/token-verifier';
import { clearSettingsCache } from '../src/settings/settings.service';

/**
 * Verificador falso: el "token" tiene el formato `uid|email|verified`.
 * Cualquier otro texto se considera un token inválido.
 */
export const fakeVerifier: TokenVerifier = async (token) => {
  const [uid, email, verified] = token.split('|');
  if (!uid || !email) throw new Error('token inválido');
  return { uid, email, emailVerified: verified === 'verified' };
};

export const app = createApp({ verifyToken: fakeVerifier });
export const api = () => request(app);

export function tokenFor(uid: string, email: string, verified = true) {
  return `Bearer ${uid}|${email}|${verified ? 'verified' : 'unverified'}`;
}

export async function resetDatabase() {
  await prisma.$executeRawUnsafe(
    'TRUNCATE "Appointment", "Availability", "ProfessionalInvitation", "ProfessionalSpecialty", "Professional", "Specialty", "User" CASCADE',
  );
  await prisma.systemSettings.updateMany({ data: { adminOnlyLogin: false, registrationClosed: false } });
  clearSettingsCache();
}

let counter = 0;

/** Crea un usuario directamente en la base y devuelve su header de autorización. */
export async function createUser(role: Role = 'PATIENT', overrides: { isActive?: boolean; email?: string } = {}) {
  counter += 1;
  const email = overrides.email ?? `persona${counter}@example.com`;
  const user = await prisma.user.create({
    data: {
      firebaseUid: `uid-${counter}`,
      email,
      firstName: 'Nombre',
      lastName: `Apellido${counter}`,
      role,
      isActive: overrides.isActive ?? true,
    },
  });
  return { user, auth: tokenFor(user.firebaseUid!, email) };
}

export async function createSpecialty(name = `Especialidad ${++counter}`) {
  return prisma.specialty.create({ data: { name } });
}

export async function createProfessional(
  specialtyIds: string[],
  overrides: { userId?: string; email?: string; allowAvailabilityManagement?: boolean } = {},
) {
  counter += 1;
  return prisma.professional.create({
    data: {
      firstName: 'Profesional',
      lastName: `Ficticio${counter}`,
      email: overrides.email ?? `profesional${counter}@example.com`,
      phone: '0000 000000',
      userId: overrides.userId,
      allowAvailabilityManagement: overrides.allowAvailabilityManagement ?? false,
      specialties: { create: specialtyIds.map((specialtyId) => ({ specialtyId })) },
    },
  });
}

/** Día (YYYY-MM-DD, Argentina) dentro de `daysAhead` días. */
export function futureDay(daysAhead = 3): string {
  const date = new Date(Date.now() + daysAhead * 24 * 60 * 60 * 1000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(date);
}

/** Fecha ISO para un día y hora de Argentina, por ejemplo at('2026-10-20', '09:15'). */
export function at(day: string, time: string): string {
  return new Date(`${day}T${time}:00-03:00`).toISOString();
}

export async function createBlock(professionalId: string, day: string, from = '09:00', to = '11:00') {
  const creator = await createUser('APPOINTMENT_MANAGER');
  return prisma.availability.create({
    data: { professionalId, startAt: at(day, from), endAt: at(day, to), createdByUserId: creator.user.id },
  });
}
