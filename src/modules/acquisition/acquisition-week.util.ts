// ADR-007: helpers de semana (lunes-domingo, Europe/Madrid) sin dependencias
// externas. Las semanas viajan como "YYYY-MM-DD" (el lunes local), igual que
// FamilyWeeklySpend.weekStart (@db.Date). El bucket exacto de cada toque se
// calcula en SQL con AT TIME ZONE; estos helpers solo arman rangos y claves.

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

/** Lunes de la semana que contiene `dateKey`. */
export function mondayOf(dateKey: string): string {
  const d = new Date(`${dateKey}T00:00:00Z`);
  const dow = d.getUTCDay(); // 0 = domingo
  const diff = dow === 0 ? -6 : 1 - dow;
  return addDays(dateKey, diff);
}

export function currentWeekStart(now: Date = new Date()): string {
  return mondayOf(madridDateKey(now));
}

/** Lista de lunes desde `fromWeek` hasta `toWeek` (ambos inclusive). */
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

/**
 * Rango UTC "holgado" que seguro contiene todas las semanas locales pedidas
 * (un dia de margen a cada lado cubre cualquier offset de Europe/Madrid).
 * Solo sirve para que SQL use el indice por occurredAt; el bucket exacto se
 * filtra despues por la semana local.
 */
export function coarseUtcRange(fromWeek: string, toWeek: string) {
  return {
    start: new Date(`${addDays(fromWeek, -1)}T00:00:00Z`),
    end: new Date(`${addDays(toWeek, 8)}T00:00:00Z`),
  };
}

/**
 * Normaliza el `Producto` que manda n8n a un slug estable: sin dominio,
 * query ni fragmento, en minusculas, con "/" inicial y sin "/" final.
 * "https://web.com/Landing-Pizza/?utm=x" -> "/landing-pizza".
 * Devuelve null si no queda nada util.
 */
export function normalizeLandingSlug(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  let value = String(raw).trim();
  if (!value) return null;

  value = value.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]*/i, ''); // protocolo + host
  value = value.split('#')[0].split('?')[0];
  value = value.trim().toLowerCase().replace(/\s+/g, '-');
  value = value.replace(/\/{2,}/g, '/').replace(/\/+$/, '');
  if (!value) return null;
  if (!value.startsWith('/')) value = `/${value}`;
  return value === '/' ? null : value;
}
