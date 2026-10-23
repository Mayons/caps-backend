import type { RequestHandler } from 'express';
import type { Role } from '@prisma/client';
import { prisma } from '../common/prisma';
import { forbidden, unauthorized } from '../common/errors';
import { ADMIN_ROLES } from '../common/roles';
import { getSettings } from '../settings/settings.service';
import type { TokenVerifier } from './token-verifier';

/**
 * Paso 1 y 2 del flujo de autenticación: lee el token del header
 * `Authorization: Bearer <token>`, lo verifica con Firebase y busca el
 * usuario de CAPS por su `firebaseUid`.
 */
export function createAuthenticate(verifyToken: TokenVerifier): RequestHandler {
  return async (req, _res, next) => {
    const header = req.headers.authorization ?? '';
    const [scheme, token] = header.split(' ');
    if (scheme !== 'Bearer' || !token) {
      throw unauthorized('AUTH_REQUIRED', 'Tenés que iniciar sesión');
    }

    try {
      req.identity = await verifyToken(token);
    } catch {
      throw unauthorized('INVALID_TOKEN', 'La sesión no es válida o venció. Volvé a iniciar sesión');
    }

    req.currentUser = await prisma.user.findUnique({ where: { firebaseUid: req.identity.uid } });
    if (!req.currentUser && req.identity.emailVerified && req.identity.email) {
      const email = req.identity.email.trim().toLowerCase();
      await prisma.user.updateMany({
        where: { email, firebaseUid: null, isActive: true },
        data: { firebaseUid: req.identity.uid },
      });
      req.currentUser = await prisma.user.findUnique({ where: { firebaseUid: req.identity.uid } });
    }

    // Restricciones de acceso que se activan desde el panel de administración.
    const settings = await getSettings();
    if (settings.registrationClosed && !req.currentUser) {
      throw forbidden('REGISTRATION_CLOSED', 'Pronto se habilitará la incorporación de nuevos usuarios');
    }
    if (settings.adminOnlyLogin && !(req.currentUser && ADMIN_ROLES.includes(req.currentUser.role))) {
      throw forbidden('ADMIN_ONLY_LOGIN', 'Por el momento solo pueden ingresar administradores');
    }
    next();
  };
}

/** Exige que exista un usuario de CAPS y que su cuenta esté activa. */
export const requireUser: RequestHandler = (req, _res, next) => {
  if (!req.currentUser) {
    throw forbidden('USER_NOT_REGISTERED', 'Tenés que completar tu registro');
  }
  if (!req.currentUser.isActive) {
    throw forbidden('USER_INACTIVE', 'Tu cuenta está desactivada. Comunicate con el CAPS');
  }
  next();
};

/** Exige que el usuario tenga alguno de los roles indicados. Usar después de `requireUser`. */
export function requireRole(...roles: Role[]): RequestHandler {
  return (req, _res, next) => {
    if (!req.currentUser || !roles.includes(req.currentUser.role)) {
      throw forbidden('FORBIDDEN', 'No tenés permiso para realizar esta acción');
    }
    next();
  };
}
