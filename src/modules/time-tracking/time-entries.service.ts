import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EmployeeContractType, TimeEntryRateType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { TimeTrackingRatesService } from './time-tracking-rates.service';

const REGULAR_DAY_MINUTES = 8 * 60;
const MADRID_TZ = 'Europe/Madrid';

type DayType = 'HOLIDAY' | 'SUNDAY' | 'SATURDAY' | 'WEEKDAY';

@Injectable()
export class TimeEntriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rates: TimeTrackingRatesService,
  ) {}

  async clock(employeeId: string, userId: string) {
    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
    });
    if (!employee) throw new NotFoundException('Employee not found');
    if (!employee.isActive)
      throw new BadRequestException('El empleado está inactivo');

    const openEntry = await this.prisma.timeEntry.findFirst({
      where: { employeeId, clockOutAt: null },
      orderBy: { clockInAt: 'desc' },
    });

    if (!openEntry) {
      const entry = await this.prisma.timeEntry.create({
        data: { employeeId, clockInAt: new Date(), clockInByUserId: userId },
      });
      return { action: 'CLOCK_IN' as const, entry };
    }

    const entry = await this.closeEntry(
      openEntry,
      employee.contractType,
      userId,
    );
    return { action: 'CLOCK_OUT' as const, entry };
  }

  async listForEmployee(employeeId: string, from?: string, to?: string) {
    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
    });
    if (!employee) throw new NotFoundException('Employee not found');

    const entries = await this.prisma.timeEntry.findMany({
      where: {
        employeeId,
        clockInAt: {
          gte: from ? new Date(from) : undefined,
          lte: to ? new Date(to) : undefined,
        },
      },
      orderBy: { clockInAt: 'desc' },
    });

    const closedEntries = entries.filter(
      (entry) => entry.payableHours !== null,
    );
    const totalPayableHours = closedEntries.reduce(
      (sum, entry) => sum + (entry.payableHours ?? 0),
      0,
    );
    const totalAmount = closedEntries.reduce(
      (sum, entry) => sum + Number(entry.amount ?? 0),
      0,
    );

    return {
      employee,
      entries,
      totals: {
        payableHours: totalPayableHours,
        amount: Number(totalAmount.toFixed(2)),
      },
    };
  }

  private async closeEntry(
    openEntry: { id: string; clockInAt: Date },
    contractType: EmployeeContractType,
    userId: string,
  ) {
    const clockOutAt = new Date();
    const rates = await this.rates.getRates();

    // Duracion real del turno, sin capar: se guarda siempre tal cual para
    // no perder el dato de auditoria, aunque el pago se calcule sobre el
    // tope cuando corresponda.
    const rawTotalMinutes = Math.max(
      0,
      Math.round(
        (clockOutAt.getTime() - openEntry.clockInAt.getTime()) / 60000,
      ),
    );

    // Tope configurable (TimeTrackingRate.maxShiftMinutes/maxShiftEnabled):
    // cubre el caso del reloj dejado corriendo. Si se supera, el pago se
    // calcula solo hasta el tope y la entrada queda marcada para revision.
    const wasCapped =
      rates.maxShiftEnabled && rawTotalMinutes > rates.maxShiftMinutes;
    const payableMinutes = wasCapped ? rates.maxShiftMinutes : rawTotalMinutes;

    const dayType = await this.resolveDayType(openEntry.clockInAt);

    let payableHours: number;
    let rateType: TimeEntryRateType;
    let rateApplied: number;

    if (contractType === 'FIJO') {
      if (dayType === 'WEEKDAY') {
        // Entre semana: solo se paga como extra lo que supere las 8h.
        const extraMinutes = Math.max(
          0,
          payableMinutes - REGULAR_DAY_MINUTES,
        );
        payableHours = this.minutesToPayableHours(extraMinutes);
        rateType = 'OVERTIME_WEEKDAY';
        rateApplied = Number(rates.overtimeWeekdayRate);
      } else {
        // Sabado, domingo y festivo: toda la jornada cuenta como extra
        // desde la primera hora, cada uno a su propia tarifa.
        payableHours = this.minutesToPayableHours(payableMinutes);
        rateType = this.rateTypeForDay(dayType);
        rateApplied = this.rateForDay(dayType, rates);
      }
    } else {
      payableHours = this.minutesToPayableHours(payableMinutes);
      rateType = 'HOURLY';
      rateApplied = Number(rates.hourlyRate);
    }

    const amount = Number((payableHours * rateApplied).toFixed(2));

    return this.prisma.timeEntry.update({
      where: { id: openEntry.id },
      data: {
        clockOutAt,
        clockOutByUserId: userId,
        totalMinutes: rawTotalMinutes,
        wasCapped,
        payableHours,
        rateType,
        rateApplied,
        amount,
      },
    });
  }

  // Fracciones >= 30 min cuentan como 1 hora completa; las inferiores no se pagan ni se redondean.
  private minutesToPayableHours(minutes: number): number {
    const fullHours = Math.floor(minutes / 60);
    const remainder = minutes % 60;
    return fullHours + (remainder >= 30 ? 1 : 0);
  }

  private rateTypeForDay(dayType: DayType): TimeEntryRateType {
    switch (dayType) {
      case 'HOLIDAY':
        return 'OVERTIME_HOLIDAY';
      case 'SUNDAY':
        return 'OVERTIME_SUNDAY';
      case 'SATURDAY':
        return 'OVERTIME_SATURDAY';
      default:
        return 'OVERTIME_WEEKDAY';
    }
  }

  private rateForDay(
    dayType: DayType,
    rates: {
      overtimeHolidayRate: unknown;
      overtimeSundayRate: unknown;
      overtimeSaturdayRate: unknown;
      overtimeWeekdayRate: unknown;
    },
  ): number {
    switch (dayType) {
      case 'HOLIDAY':
        return Number(rates.overtimeHolidayRate);
      case 'SUNDAY':
        return Number(rates.overtimeSundayRate);
      case 'SATURDAY':
        return Number(rates.overtimeSaturdayRate);
      default:
        return Number(rates.overtimeWeekdayRate);
    }
  }

  // Festivo (si esta cargado en el calendario) > domingo > sabado > entre semana.
  private async resolveDayType(date: Date): Promise<DayType> {
    const dateOnly = this.toMadridDateOnly(date);
    const holiday = await this.prisma.publicHoliday.findUnique({
      where: { date: dateOnly },
    });
    if (holiday) return 'HOLIDAY';

    const weekday = new Intl.DateTimeFormat('en-US', {
      timeZone: MADRID_TZ,
      weekday: 'short',
    }).format(date);

    if (weekday === 'Sun') return 'SUNDAY';
    if (weekday === 'Sat') return 'SATURDAY';
    return 'WEEKDAY';
  }

  // Normaliza una fecha/hora a la fecha civil (00:00 UTC de ese dia) segun
  // el huso de Madrid, para poder comparar contra PublicHoliday.date (@db.Date).
  private toMadridDateOnly(date: Date): Date {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: MADRID_TZ,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(date);
    const year = parts.find((part) => part.type === 'year')!.value;
    const month = parts.find((part) => part.type === 'month')!.value;
    const day = parts.find((part) => part.type === 'day')!.value;
    return new Date(`${year}-${month}-${day}T00:00:00.000Z`);
  }
}
