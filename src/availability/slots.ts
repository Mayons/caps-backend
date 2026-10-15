import { addMinutes } from '../config/time';

export interface TimeRange {
  startAt: Date;
  endAt: Date;
}

function overlaps(a: TimeRange, b: TimeRange): boolean {
  return a.startAt < b.endAt && b.startAt < a.endAt;
}

/**
 * Divide los bloques de disponibilidad en horarios de `durationMinutes`.
 * Descarta los horarios que ya pasaron, los que están fuera del rango pedido
 * y los que se superponen con turnos confirmados.
 */
export function generateSlots(options: {
  blocks: TimeRange[];
  booked: TimeRange[];
  durationMinutes: number;
  from: Date;
  to: Date;
  now: Date;
}): TimeRange[] {
  const { blocks, booked, durationMinutes, from, to, now } = options;
  const slots: TimeRange[] = [];

  for (const block of blocks) {
    let startAt = block.startAt;
    while (addMinutes(startAt, durationMinutes) <= block.endAt) {
      const slot = { startAt, endAt: addMinutes(startAt, durationMinutes) };
      const inRange = slot.startAt >= from && slot.startAt < to;
      const isFuture = slot.startAt > now;
      if (inRange && isFuture && !booked.some((appointment) => overlaps(slot, appointment))) {
        slots.push(slot);
      }
      startAt = slot.endAt;
    }
  }
  return slots.sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
}

/** ¿El horario empieza exactamente en uno de los cortes generados para el bloque? */
export function isAlignedWithBlock(blockStart: Date, slotStart: Date, durationMinutes: number): boolean {
  const offsetMs = slotStart.getTime() - blockStart.getTime();
  return offsetMs >= 0 && offsetMs % (durationMinutes * 60_000) === 0;
}
