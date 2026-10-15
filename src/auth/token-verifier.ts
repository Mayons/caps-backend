import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

/** Datos de identidad que nos interesan del token de Firebase. */
export interface Identity {
  uid: string;
  email: string | null;
  emailVerified: boolean;
}

/**
 * Función que recibe un ID token de Firebase y devuelve la identidad.
 * Debe lanzar un error si el token es inválido o venció.
 * En los tests se reemplaza por una versión falsa.
 */
export type TokenVerifier = (idToken: string) => Promise<Identity>;

export function createFirebaseTokenVerifier(projectId: string): TokenVerifier {
  if (getApps().length === 0) {
    // Para verificar tokens alcanza con el ID del proyecto: Firebase Admin
    // descarga las claves públicas de Google. Si existe
    // GOOGLE_APPLICATION_CREDENTIALS se usan esas credenciales del servidor.
    initializeApp({
      projectId,
      ...(process.env.GOOGLE_APPLICATION_CREDENTIALS ? { credential: applicationDefault() } : {}),
    });
  }
  const auth = getAuth();

  return async (idToken) => {
    const decoded = await auth.verifyIdToken(idToken);
    return {
      uid: decoded.uid,
      email: decoded.email ?? null,
      emailVerified: decoded.email_verified === true,
    };
  };
}
