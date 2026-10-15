import { env } from './config/env';
import { createApp } from './app';
import { createFirebaseTokenVerifier } from './auth/token-verifier';
import { prisma } from './common/prisma';

async function main() {
  await prisma.$connect();
  const app = createApp({ verifyToken: createFirebaseTokenVerifier(env.FIREBASE_PROJECT_ID) });
  app.listen(env.PORT, () => {
    console.log(`CAPS API (${env.NODE_ENV}) escuchando en http://localhost:${env.PORT}/api/v1`);
    if (env.FIREBASE_AUTH_EMULATOR_HOST) {
      console.log(`Usando el emulador de Firebase Auth en ${env.FIREBASE_AUTH_EMULATOR_HOST}`);
    }
  });
}

main().catch((error) => {
  console.error('No se pudo iniciar el servidor:', error);
  process.exit(1);
});
