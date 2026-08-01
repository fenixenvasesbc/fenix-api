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
    const totalMinutes = Math.max(
      0,
      Math.round(
        (clockOutAt.getTime() - openEntry.clockInAt.getTime()) / 60000,
      ),
    );

    const isSaturday = this.isSaturday(openEntry.clockInAt);
    let payableHours: number;
    let rateType: TimeEntryRateType;
    let rateApplied: number;

    if (contractType === 'FIJO') {
      const extraMinutes = Math.max(0, totalMinutes - REGULAR_DAY_MINUTES);
      payableHours = this.minutesToPayableHours(extraMinutes);
      rateType = isSaturday ? 'OVERTIME_SATURDAY' : 'OVERTIME_WEEKDAY';
      rateApplied = isSaturday
        ? Number(rates.overtimeSaturdayRate)
        : Number(rates.overtimeWeekdayRate);
    } else {
      payableHours = this.minutesToPayableHours(totalMinutes);
      rateType = 'HOURLY';
      rateApplied = Number(rates.hourlyRate);
    }

    const amount = Number((payableHours * rateApplied).toFixed(2));

    return this.prisma.timeEntry.update({
      where: { id: openEntry.id },
      data: {
        clockOutAt,
        clockOutByUserId: userId,
        totalMinutes,
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

  private isSaturday(date: Date): boolean {
    const weekday = new Intl.DateTimeFormat('en-US', {
      timeZone: MADRID_TZ,
      weekday: 'short',
    }).format(date);
    return weekday === 'Sat';
  }
}
