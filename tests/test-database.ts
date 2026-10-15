import { existsSync } from 'node:fs';

/**
 * Devuelve la URL de la base de datos de pruebas. Los tests BORRAN los datos,
 * por eso exigimos que el nombre de la base contenga "test".
 */
export function getTestDatabaseUrl(): string {
  if (!process.env.TEST_DATABASE_URL && existsSync('.env')) process.loadEnvFile('.env');
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error('Definí TEST_DATABASE_URL en .env (ver .env.example) para correr los tests.');
  }
  const databaseName = new URL(url).pathname.replace('/', '');
  if (!databaseName.includes('test')) {
    throw new Error(`Por seguridad, la base de pruebas debe contener "test" en su nombre (actual: "${databaseName}").`);
  }
  return url;
}
