import { z } from 'zod';

// Esquemas reutilizables para validar la entrada de la API.

export const uuidSchema = z.uuid('identificador inválido');

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email('email inválido').max(254));

export const nameSchema = z.string().trim().min(1, 'es obligatorio').max(80);

export const phoneSchema = z
  .string()
  .trim()
  .regex(/^[0-9+()\-\s]{6,25}$/, 'teléfono inválido');

/** Fecha ISO 8601 con zona horaria, por ejemplo 2026-10-20T09:00:00-03:00. */
export const dateTimeSchema = z.iso
  .datetime({ offset: true, message: 'fecha y hora inválidas (formato ISO 8601)' })
  .transform((value) => new Date(value));

/** Día calendario en formato YYYY-MM-DD. */
export const dateSchema = z.iso.date('fecha inválida (formato AAAA-MM-DD)');

export const idParamsSchema = z.object({ id: uuidSchema });
