import { getTestDatabaseUrl } from './test-database';

// Variables de entorno para los tests (se definen antes de importar la app).
const url = getTestDatabaseUrl();
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = url;
process.env.DATABASE_URL_MIGRATIONS = url;
process.env.FIREBASE_PROJECT_ID = 'caps-test';
process.env.APPOINTMENT_DURATION_MINUTES = '15';
process.env.CORS_ORIGIN = 'http://localhost:5173';
// Nunca usar el emulador en tests: acepta tokens sin firma.
delete process.env.FIREBASE_AUTH_EMULATOR_HOST;
