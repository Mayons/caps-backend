import { execSync } from 'node:child_process';
import { getTestDatabaseUrl } from './test-database';

// Aplica las migraciones a la base de pruebas antes de correr los tests.
export default function setup() {
  const url = getTestDatabaseUrl();
  execSync('npx prisma migrate deploy', {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: url, DATABASE_URL_MIGRATIONS: url },
  });
}
