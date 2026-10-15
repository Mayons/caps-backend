import { existsSync } from 'node:fs';
import { z } from 'zod';

// Carga `.env` (si existe) usando la función nativa de Node.
// En tests las variables las define `tests/setup.ts`.
if (process.env.NODE_ENV !== 'test' && existsSync('.env')) {
  process.loadEnvFile('.env');
}

const isProduction = process.env.NODE_ENV === 'production';

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(3000),
    DATABASE_URL: z.string().startsWith('postgres', 'debe ser una URL postgresql://'),
    FIREBASE_PROJECT_ID: z.string().min(1, 'es obligatoria'),
    // Solo para desarrollo con el emulador de Firebase Authentication.
    FIREBASE_AUTH_EMULATOR_HOST: z.string().optional(),
    APPOINTMENT_DURATION_MINUTES: isProduction
      ? z.coerce.number().int().positive().max(240)
      : z.coerce.number().int().positive().max(240).default(15),
    INVITATION_TTL_HOURS: z.coerce.number().int().positive().max(720).default(72),
    // Lista separada por comas, por ejemplo: http://localhost:5173,https://caps.example.org
    CORS_ORIGIN: z.string().min(1, 'es obligatoria'),
  })
  .refine((env) => !(env.NODE_ENV === 'production' && env.FIREBASE_AUTH_EMULATOR_HOST), {
    message: 'no se puede usar el emulador de Firebase en producción',
    path: ['FIREBASE_AUTH_EMULATOR_HOST'],
  });

function loadEnv() {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `  - ${issue.path.join('.') || 'variable'}: ${issue.message}`)
      .join('\n');
    console.error(`\nConfiguración inválida. Revisá tu archivo .env:\n${problems}\n`);
    process.exit(1);
  }
  return {
    ...result.data,
    corsOrigins: result.data.CORS_ORIGIN.split(',').map((origin) => origin.trim()),
  };
}

export const env = loadEnv();
