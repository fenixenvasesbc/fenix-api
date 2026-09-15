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
}
