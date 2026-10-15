/**
 * Procedimiento controlado para crear el primer Super Admin.
 *
 * 1. La persona se registra normalmente en la aplicación (queda como PATIENT).
 * 2. El propietario del proyecto, con acceso a las variables del servidor, ejecuta:
 *      npm run super-admin:promote -- --email persona@ejemplo.com
 * 3. El script pide confirmación escribiendo el email de nuevo.
 *
 * No hay ningún endpoint de la API que permita asignar SUPER_ADMIN.
 */
import { createInterface } from 'node:readline/promises';
import { existsSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';

if (existsSync('.env')) process.loadEnvFile('.env');

async function main() {
  const index = process.argv.indexOf('--email');
  const email = index > -1 ? process.argv[index + 1]?.trim().toLowerCase() : undefined;
  if (!email) {
    console.error('Uso: npm run super-admin:promote -- --email persona@ejemplo.com');
    process.exit(1);
  }

  const prisma = new PrismaClient();
  try {
    const user = await prisma.user.findUnique({ where: { email }, include: { professional: true } });
    if (!user || !user.firebaseUid) {
      console.error('No existe un usuario registrado con ese email. Primero tiene que registrarse en la app.');
      process.exit(1);
    }
    if (user.professional) {
      console.error('La cuenta está vinculada a un profesional. Usá otra cuenta para el Super Admin.');
      process.exit(1);
    }
    if (user.role === 'SUPER_ADMIN' && user.isActive) {
      console.log('La cuenta ya es Super Admin. No se hicieron cambios.');
      return;
    }

    const databaseHost = new URL(process.env.DATABASE_URL ?? 'postgresql://desconocido').host;
    console.log(`Entorno: ${process.env.NODE_ENV ?? 'development'} — base de datos: ${databaseHost}`);
    console.log(`Se asignará SUPER_ADMIN a ${user.firstName} ${user.lastName} <${user.email}> (rol actual: ${user.role}).`);

    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = (await rl.question('Para confirmar, escribí el email nuevamente: ')).trim().toLowerCase();
    rl.close();
    if (answer !== email) {
      console.log('Confirmación incorrecta. No se hicieron cambios.');
      process.exit(1);
    }

    await prisma.user.update({ where: { id: user.id }, data: { role: 'SUPER_ADMIN', isActive: true } });
    console.log('Listo: la cuenta ahora es Super Admin. Debe cerrar sesión y volver a ingresar.');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
