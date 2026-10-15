import { createHash, randomBytes } from 'node:crypto';
import type { User } from '@prisma/client';
import { prisma } from '../common/prisma';
import { env } from '../config/env';
import { badRequest, conflict, forbidden, isUniqueViolation, notFound } from '../common/errors';
import type { Identity } from '../auth/token-verifier';

/** En la base solo se guarda el hash del token, nunca el token en sí. */
export function hashInvitationToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Crea una invitación de un solo uso para que el profesional vincule su cuenta.
 * Revoca las invitaciones pendientes anteriores. El token se devuelve UNA sola vez.
 */
export async function createInvitation(professionalId: string, createdBy: User) {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + env.INVITATION_TTL_HOURS * 60 * 60 * 1000);

  const invitation = await prisma.$transaction(async (tx) => {
    const professional = await tx.professional.findUnique({ where: { id: professionalId } });
    if (!professional) throw notFound('Profesional no encontrado');
    if (!professional.isActive) {
      throw conflict('PROFESSIONAL_INACTIVE', 'El profesional está desactivado');
    }
    if (professional.userId) {
      throw conflict('PROFESSIONAL_ALREADY_LINKED', 'El profesional ya tiene una cuenta vinculada');
    }

    await tx.professionalInvitation.updateMany({
      where: { professionalId, usedAt: null, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return tx.professionalInvitation.create({
      data: {
        professionalId,
        tokenHash: hashInvitationToken(token),
        expiresAt,
        createdByUserId: createdBy.id,
      },
    });
  });

  return { invitationId: invitation.id, expiresAt: invitation.expiresAt, token };
}

export async function revokePendingInvitations(professionalId: string) {
  const professional = await prisma.professional.findUnique({ where: { id: professionalId } });
  if (!professional) throw notFound('Profesional no encontrado');
  const result = await prisma.professionalInvitation.updateMany({
    where: { professionalId, usedAt: null, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return { revoked: result.count };
}

const INVALID_INVITATION = 'La invitación no es válida';

/**
 * Vincula la cuenta del usuario actual con un profesional existente.
 * Requisitos: email verificado en Firebase, invitación válida Y el mismo email
 * que el registro del profesional. Todo ocurre en una sola transacción.
 */
export async function acceptInvitation(token: string, user: User, identity: Identity) {
  if (!identity.emailVerified) {
    throw forbidden('EMAIL_NOT_VERIFIED', 'Primero tenés que verificar tu email');
  }
  if (user.role !== 'PATIENT') {
    throw conflict('ROLE_NOT_LINKABLE', 'Esta cuenta ya tiene un rol asignado y no puede vincularse');
  }

  try {
    return await prisma.$transaction(async (tx) => {
      const invitation = await tx.professionalInvitation.findUnique({
        where: { tokenHash: hashInvitationToken(token) },
        include: { professional: true },
      });
      if (!invitation) throw badRequest('INVITATION_INVALID', INVALID_INVITATION);
      if (invitation.revokedAt) throw badRequest('INVITATION_REVOKED', 'La invitación fue revocada');
      if (invitation.usedAt) throw badRequest('INVITATION_USED', 'La invitación ya fue utilizada');
      if (invitation.expiresAt <= new Date()) throw badRequest('INVITATION_EXPIRED', 'La invitación venció');

      const professional = invitation.professional;
      if (!professional.isActive) throw badRequest('INVITATION_INVALID', INVALID_INVITATION);
      if (professional.email !== user.email) {
        throw forbidden(
          'INVITATION_EMAIL_MISMATCH',
          'La invitación pertenece a otro email. Ingresá con el email registrado en el CAPS',
        );
      }

      // Las condiciones en el `where` protegen contra dos vinculaciones simultáneas.
      const used = await tx.professionalInvitation.updateMany({
        where: { id: invitation.id, usedAt: null, revokedAt: null },
        data: { usedAt: new Date(), usedByUserId: user.id },
      });
      const linked = await tx.professional.updateMany({
        where: { id: professional.id, userId: null },
        data: { userId: user.id },
      });
      if (used.count !== 1 || linked.count !== 1) {
        throw conflict('PROFESSIONAL_ALREADY_LINKED', 'El profesional ya tiene una cuenta vinculada');
      }
      await tx.user.update({ where: { id: user.id }, data: { role: 'PROFESSIONAL' } });

      return { professionalId: professional.id };
    });
  } catch (error) {
    // `Professional.userId` es único: un usuario no puede quedar asociado a dos profesionales.
    if (isUniqueViolation(error)) {
      throw conflict('USER_ALREADY_LINKED', 'Esta cuenta ya está vinculada a otro profesional');
    }
    throw error;
  }
}
