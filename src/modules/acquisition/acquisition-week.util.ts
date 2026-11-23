// ADR-007: helpers de fechas (Europe/Madrid) sin dependencias externas. Las
// fechas viajan como "YYYY-MM-DD" (fecha local).
//
// Semana de seguimiento = MARTES a LUNES (pedido del usuario, 23/nov/2026):
// n8n solo envia de lunes a viernes, y los leads que llegan el fin de semana
// se contactan el lunes, asi que el lunes cierra la semana que empezo el
// martes anterior. La clave de una semana es su martes.
//
// "Dia de envio": sabado y domingo se agregan al lunes siguiente (n8n no
// envia en fin de semana; la inversion de esos dias produce los leads que se
// contactan el lunes). Los dias de envio son mar, mie, jue, vie y lun.

export const ACQUISITION_TIME_ZONE = 'Europe/Madrid';

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isDateKey(value: string): boolean {
  if (!DATE_KEY_RE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/** Fecha local (Europe/Madrid) de un instante, como "YYYY-MM-DD". */
export function madridDateKey(instant: Date): string {
  // en-CA formatea como YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: ACQUISITION_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
}

export function addDays(dateKey: string, days: number): string {
  const d = new Date(`${dateKey}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** 0 = domingo ... 6 = sabado */
export function dayOfWeek(dateKey: string): number {
  return new Date(`${dateKey}T00:00:00Z`).getUTCDay();
}

/** Martes que abre la semana (martes-lunes) que contiene `dateKey`. */
export function weekStartOf(dateKey: string): string {
  const diff = (dayOfWeek(dateKey) - 2 + 7) % 7;
  return addDays(dateKey, -diff);
}

/** Dia de envio al que se agrega un dia natural (sab/dom -> lunes siguiente). */
export function sendDayOf(dateKey: string): string {
  const dow = dayOfWeek(dateKey);
  if (dow === 6) return addDays(dateKey, 2);
  if (dow === 0) return addDays(dateKey, 1);
  return dateKey;
}

export function isSendDay(dateKey: string): boolean {
  const dow = dayOfWeek(dateKey);
  return dow !== 0 && dow !== 6;
}

export function currentWeekStart(now: Date = new Date()): string {
  return weekStartOf(madridDateKey(now));
}

/** Lista de martes desde `fromWeek` hasta `toWeek` (ambos inclusive). */
export function weeksBetween(fromWeek: string, toWeek: string): string[] {
  const out: string[] = [];
  let cursor = fromWeek;
  // tope defensivo: 5 años de semanas
  for (let i = 0; cursor <= toWeek && i < 260; i += 1) {
    out.push(cursor);
    cursor = addDays(cursor, 7);
  }
  return out;
}

/** Dias naturales desde `from` hasta `to` (ambos inclusive). */
export function daysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  let cursor = from;
  for (let i = 0; cursor <= to && i < 2000; i += 1) {
    out.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return out;
}

/**
 * Rango UTC "holgado" que seguro contiene todos los dias locales entre
 * `fromDay` y `toDay` (un dia de margen a cada lado cubre cualquier offset de
 * Europe/Madrid). Solo sirve para que SQL use el indice por fecha; el bucket
 * exacto se calcula despues con la fecha local.
 */
export function coarseUtcRange(fromDay: string, toDay: string) {
  return {
    start: new Date(`${addDays(fromDay, -1)}T00:00:00Z`),
    end: new Date(`${addDays(toDay, 2)}T00:00:00Z`),
  };
}
