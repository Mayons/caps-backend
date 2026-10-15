import type { Request } from 'express';
import type { User } from '@prisma/client';
import type { Identity } from './token-verifier';
import { forbidden, unauthorized } from '../common/errors';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Identidad verificada por Firebase. */
      identity?: Identity;
      /** Usuario de CAPS asociado a esa identidad (null si todavía no se registró). */
      currentUser?: User | null;
    }
  }
}

export function getIdentity(req: Request): Identity {
  if (!req.identity) throw unauthorized('AUTH_REQUIRED', 'Tenés que iniciar sesión');
  return req.identity;
}

/** Devuelve el usuario de CAPS. Solo usar en rutas protegidas con `requireUser`. */
export function getCurrentUser(req: Request): User {
  if (!req.currentUser) throw forbidden('USER_NOT_REGISTERED', 'Tenés que completar tu registro');
  return req.currentUser;
}
