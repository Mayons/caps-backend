import type { SystemSettings } from '@prisma/client';
import { prisma } from '../common/prisma';

const SETTINGS_ID = 1;

// Se consultan en cada pedido autenticado: una caché corta evita ir a la base
// cada vez. Los cambios hechos en este mismo proceso se ven al instante.
const CACHE_TTL_MS = 10_000;
let cache: { value: SystemSettings; expiresAt: number } | null = null;

export function toPublicSettings(settings: SystemSettings) {
  return {
    adminOnlyLogin: settings.adminOnlyLogin,
    registrationClosed: settings.registrationClosed,
    updatedAt: settings.updatedAt,
  };
}

export async function getSettings(): Promise<SystemSettings> {
  if (cache && cache.expiresAt > Date.now()) return cache.value;
  // `upsert` cubre una base donde la fila todavía no existe.
  const value = await prisma.systemSettings.upsert({ where: { id: SETTINGS_ID }, create: {}, update: {} });
  cache = { value, expiresAt: Date.now() + CACHE_TTL_MS };
  return value;
}

export async function updateSettings(input: { adminOnlyLogin?: boolean; registrationClosed?: boolean }) {
  const value = await prisma.systemSettings.upsert({
    where: { id: SETTINGS_ID },
    create: input,
    update: input,
  });
  cache = { value, expiresAt: Date.now() + CACHE_TTL_MS };
  return toPublicSettings(value);
}

/** Solo para tests: olvida la configuración guardada en memoria. */
export function clearSettingsCache() {
  cache = null;
}
