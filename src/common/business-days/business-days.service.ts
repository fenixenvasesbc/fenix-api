import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';

/**
 * Utilidades de "dias habiles" (excluyendo fines de semana y feriados
 * cargados en PublicHoliday) para todo el sistema que cuenta "dias en
 * una etiqueta": alertas in-app, recordatorios de Repeticion y las
 * reglas de mensajes configurables (LabelMessageRule).
 *
 * El conteo es INCLUSIVO desde la fecha de inicio: si el dia de inicio
 * ya es habil, cuenta como dia 1. Ejemplo: un lead marcado un viernes
 * con un umbral de 3 dias vence el martes siguiente (viernes=1,
 * sabado/domingo no cuentan, lunes=2, martes=3).
 */
@Injectable()
export class BusinessDaysService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Carga todas las fechas de PublicHoliday en un Set de claves
   * YYYY-MM-DD (UTC). Pensado para llamarse una vez por corrida de
   * scheduler, no por cada lead/assignment.
   */
  async loadHolidaySet(): Promise<Set<string>> {
    const holidays = await this.prisma.publicHoliday.findMany({
      select: { date: true },
    });

    return new Set(holidays.map((holiday) => this.toDateKey(holiday.date)));
  }

  toDateKey(date: Date): string {
    return date.toISOString().slice(0, 10);
  }

  startOfUtcDay(date: Date): Date {
    return new Date(
      Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
    );
  }

  addCalendarDays(date: Date, days: number): Date {
    const result = new Date(date);
    result.setUTCDate(result.getUTCDate() + days);
    return result;
  }

  isWeekend(date: Date): boolean {
    const day = date.getUTCDay();
    return day === 0 || day === 6;
  }

  isBusinessDay(date: Date, holidaySet: Set<string>): boolean {
    return !this.isWeekend(date) && !holidaySet.has(this.toDateKey(date));
  }

  /**
   * Fecha (medianoche UTC) en la que se alcanza el n-esimo dia habil,
   * contando inclusivamente desde `start` (si `start` ya es habil,
   * cuenta como dia 1).
   */
  nthBusinessDayOnOrAfter(
    start: Date,
    n: number,
    holidaySet: Set<string>,
  ): Date {
    if (n < 1) {
      throw new Error('nthBusinessDayOnOrAfter: n debe ser >= 1');
    }

    let current = this.startOfUtcDay(start);
    let count = 0;
    let guard = 0;

    while (guard < 10000) {
      if (this.isBusinessDay(current, holidaySet)) {
        count += 1;
        if (count === n) return current;
      }
      current = this.addCalendarDays(current, 1);
      guard += 1;
    }

    throw new Error('nthBusinessDayOnOrAfter: limite de iteraciones excedido');
  }

  /**
   * Cantidad de dias habiles transcurridos entre `start` y `until`,
   * ambos inclusive (contando `start` como dia 1 si es habil). Devuelve
   * 0 si `until` es anterior a `start`.
   */
  countBusinessDaysElapsed(
    start: Date,
    until: Date,
    holidaySet: Set<string>,
  ): number {
    const startDay = this.startOfUtcDay(start);
    const untilDay = this.startOfUtcDay(until);

    if (untilDay < startDay) return 0;

    let current = startDay;
    let count = 0;

    while (current <= untilDay) {
      if (this.isBusinessDay(current, holidaySet)) count += 1;
      current = this.addCalendarDays(current, 1);
    }

    return count;
  }

  /**
   * True si, contando dias habiles inclusive desde `start`, ya se
   * alcanzo o supero el umbral `thresholdDays` al momento `now`.
   */
  isBusinessDaysDue(
    start: Date,
    thresholdDays: number,
    now: Date,
    holidaySet: Set<string>,
  ): boolean {
    if (thresholdDays < 1) return true;

    const dueDate = this.nthBusinessDayOnOrAfter(start, thresholdDays, holidaySet);
    return this.startOfUtcDay(now) >= dueDate;
  }

  // -----------------------------------------------------------------
  // ADR-004 SS7 (Submodulo 1): plazo en dias habiles + corte de horario
  // en una zona horaria dada (hoy: Europe/Madrid para el modulo de
  // bocetos). Usa Intl.DateTimeFormat en vez de sumar una dependencia de
  // timezones nueva -- 14:00 local nunca cae en la hora ambigua/inexistente
  // de un cambio de horario europeo (esos ocurren de madrugada), asi que
  // el algoritmo de dos pasadas de abajo es exacto para este caso de uso.
  // -----------------------------------------------------------------

  private zonedDateTimeParts(
    date: Date,
    timeZone: string,
  ): { year: number; month: number; day: number; hour: number; minute: number } {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    const parts = formatter.formatToParts(date);
    const get = (type: string) =>
      Number(parts.find((p) => p.type === type)?.value ?? 0);

    // Intl puede devolver "24" para medianoche con hour12:false segun el
    // runtime; se normaliza a 0.
    const hour = get('hour') % 24;

    return {
      year: get('year'),
      month: get('month'),
      day: get('day'),
      hour,
      minute: get('minute'),
    };
  }

  /**
   * Instante UTC correspondiente a una fecha/hora "de pared" en `timeZone`
   * (ej. las 14:00 del 5 de marzo en Europe/Madrid). Algoritmo estandar de
   * dos pasadas con Intl: una primera aproximacion tratando la hora de
   * pared como si fuera UTC, corregida por el offset real de esa zona en
   * ese instante.
   */
  private zonedWallTimeToUtc(
    year: number,
    month: number,
    day: number,
    hour: number,
    minute: number,
    timeZone: string,
  ): Date {
    const guess = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));
    const asZoned = this.zonedDateTimeParts(guess, timeZone);
    const zonedAsUtc = Date.UTC(
      asZoned.year,
      asZoned.month - 1,
      asZoned.day,
      asZoned.hour,
      asZoned.minute,
      0,
    );
    const driftMs = guess.getTime() - zonedAsUtc;
    return new Date(guess.getTime() + driftMs);
  }

  /**
   * "Bucket" de dia logico (medianoche UTC con los mismos numeros de
   * Y/M/D que la fecha de calendario local en `timeZone`) -- pensado
   * unicamente para reusar `nthBusinessDayOnOrAfter`/`countBusinessDaysElapsed`
   * (que comparan por getUTC*) contando dias de calendario de esa zona
   * horaria en vez de dias de calendario UTC.
   */
  localDayBucket(date: Date, timeZone: string): Date {
    const { year, month, day } = this.zonedDateTimeParts(date, timeZone);
    return new Date(Date.UTC(year, month - 1, day));
  }

  /**
   * Calcula `dueAt` aplicando la regla de ADR-004 SS7: si `anchor` cae
   * antes de `cutoffHour` en `timeZone`, el dia de `anchor` cuenta como el
   * dia 1 del plazo; si cae en o despues del corte, el plazo arranca al
   * dia habil siguiente. Desde ahi cuenta `businessDays` dias habiles
   * (saltando fines de semana y `holidaySet`) y devuelve el instante
   * `cutoffHour`:00 (hora local) de ese dia habil final.
   */
  computeBusinessDueAt(
    anchor: Date,
    businessDays: number,
    holidaySet: Set<string>,
    options?: { cutoffHour?: number; timeZone?: string },
  ): Date {
    const cutoffHour = options?.cutoffHour ?? 14;
    const timeZone = options?.timeZone ?? 'Europe/Madrid';

    const anchorParts = this.zonedDateTimeParts(anchor, timeZone);
    const anchorDayBucket = new Date(
      Date.UTC(anchorParts.year, anchorParts.month - 1, anchorParts.day),
    );

    const pastCutoff =
      anchorParts.hour > cutoffHour ||
      (anchorParts.hour === cutoffHour && anchorParts.minute > 0);

    const startDayBucket = pastCutoff
      ? this.addCalendarDays(anchorDayBucket, 1)
      : anchorDayBucket;

    const dueDayBucket = this.nthBusinessDayOnOrAfter(
      startDayBucket,
      businessDays,
      holidaySet,
    );

    return this.zonedWallTimeToUtc(
      dueDayBucket.getUTCFullYear(),
      dueDayBucket.getUTCMonth() + 1,
      dueDayBucket.getUTCDate(),
      cutoffHour,
      0,
      timeZone,
    );
  }

  /**
   * Dias habiles que quedan hasta `dueAt` contando desde `now`, en
   * dias de calendario de `timeZone` (0 = hoy es el dia de vencimiento o
   * ya vencio dentro del mismo dia habil, 1 = vence el proximo dia habil,
   * etc.). Pensado para el semaforo de 3 colores (ADR-004 SS8): no mira la
   * hora exacta de `dueAt`, solo el dia habil en que cae.
   */
  businessDaysUntilDue(
    now: Date,
    dueAt: Date,
    holidaySet: Set<string>,
    timeZone = 'Europe/Madrid',
  ): number {
    const nowBucket = this.localDayBucket(now, timeZone);
    const dueBucket = this.localDayBucket(dueAt, timeZone);

    if (dueBucket < nowBucket) return -1;

    return this.countBusinessDaysElapsed(nowBucket, dueBucket, holidaySet) - 1;
  }
}
