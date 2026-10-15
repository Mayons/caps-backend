// Política horaria de CAPS:
// - En la base de datos todas las fechas se guardan en UTC (timestamptz).
// - La API recibe y devuelve fechas ISO 8601 (por ejemplo 2026-10-20T12:00:00.000Z).
// - Cuando se pide "un día" (YYYY-MM-DD) se interpreta en hora de Argentina.
//   Argentina usa UTC-03:00 todo el año (no tiene horario de verano desde 2009).
export const APP_TIME_ZONE = 'America/Argentina/Buenos_Aires';
const ARGENTINA_UTC_OFFSET = '-03:00';

const MS_PER_MINUTE = 60_000;
const MS_PER_DAY = 24 * 60 * MS_PER_MINUTE;

/** Devuelve el inicio y el fin (exclusivo) de un día calendario de Argentina. */
export function argentinaDayRange(date: string): { start: Date; end: Date } {
  const start = new Date(`${date}T00:00:00${ARGENTINA_UTC_OFFSET}`);
  return { start, end: new Date(start.getTime() + MS_PER_DAY) };
}

export function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * MS_PER_MINUTE);
}

export function minutesBetween(start: Date, end: Date): number {
  return (end.getTime() - start.getTime()) / MS_PER_MINUTE;
}

/** Fecha de hoy (YYYY-MM-DD) según el calendario de Argentina. */
export function todayInArgentina(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: APP_TIME_ZONE }).format(now);
}
