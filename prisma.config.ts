import { defineConfig } from 'prisma/config';

// Prisma no carga `.env` automáticamente cuando existe este archivo.
// Usamos la función nativa de Node (sin dependencias extra).
try {
  process.loadEnvFile('.env');
} catch {
  // Sin archivo .env: se usan las variables del entorno (CI, servidor, etc.).
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'migrations' },
});
