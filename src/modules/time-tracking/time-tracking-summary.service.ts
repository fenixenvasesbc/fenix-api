import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  TimeTrackingSummaryGroupBy,
  TimeTrackingSummaryQueryDto,
} from './dto/summary.dto';

const MADRID_TZ = 'Europe/Madrid';
const DEFAULT_RANGE_DAYS = 30;

type SummaryRow = {
  periodKey: string;
  employeeId: string;
  employeeName: string;
  overtimeWeekdayHours: number;
  overtimeWeekdayAmount: number;
  overtimeSaturdayHours: number;
  overtimeSaturdayAmount: number;
  hourlyHours: number;
  hourlyAmount: number;
};

@Injectable()
export class TimeTrackingSummaryService {
  constructor(private readonly prisma: PrismaService) {}

  async summarize(query: TimeTrackingSummaryQueryDto) {
    const to = query.to ? new Date(query.to) : new Date();
    const from = query.from
      ? new Date(query.from)
      : new Date(to.getTime() - DEFAULT_RANGE_DAYS * 24 * 60 * 60 * 1000);
    const groupBy: TimeTrackingSummaryGroupBy = query.groupBy ?? 'day';

    const entries = await this.prisma.timeEntry.findMany({
      where: {
        clockOutAt: { not: null },
        clockInAt: { gte: from, lte: to },
        employeeId: query.employeeId,
      },
      include: {
        employee: { select: { id: true, name: true, contractType: true } },
      },
      orderBy: { clockInAt: 'asc' },
    });

    const buckets = new Map<string, SummaryRow>();

    for (const entry of entries) {
      const periodKey = this.periodKey(entry.clockInAt, groupBy);
      const key = `${entry.employeeId}:${periodKey}`;
      const bucket =
        buckets.get(key) ??
        ({
          periodKey,
          employeeId: entry.employeeId,
          employeeName: entry.employee.name,
          overtimeWeekdayHours: 0,
          overtimeWeekdayAmount: 0,
          overtimeSaturdayHours: 0,
          overtimeSaturdayAmount: 0,
          hourlyHours: 0,
          hourlyAmount: 0,
        } satisfies SummaryRow);

      const hours = entry.payableHours ?? 0;
      const amount = Number(entry.amount ?? 0);

      if (entry.rateType === 'OVERTIME_WEEKDAY') {
        bucket.overtimeWeekdayHours += hours;
        bucket.overtimeWeekdayAmount += amount;
      } else if (entry.rateType === 'OVERTIME_SATURDAY') {
        bucket.overtimeSaturdayHours += hours;
        bucket.overtimeSaturdayAmount += amount;
      } else if (entry.rateType === 'HOURLY') {
        bucket.hourlyHours += hours;
        bucket.hourlyAmount += amount;
      }

      buckets.set(key, bucket);
    }

    const rows = Array.from(buckets.values())
      .map((row) => ({
        ...row,
        overtimeWeekdayAmount: Number(row.overtimeWeekdayAmount.toFixed(2)),
        overtimeSaturdayAmount: Number(row.overtimeSaturdayAmount.toFixed(2)),
        hourlyAmount: Number(row.hourlyAmount.toFixed(2)),
        totalAmount: Number(
          (
            row.overtimeWeekdayAmount +
            row.overtimeSaturdayAmount +
            row.hourlyAmount
          ).toFixed(2),
        ),
      }))
      .sort(
        (a, b) =>
          a.periodKey.localeCompare(b.periodKey) ||
          a.employeeName.localeCompare(b.employeeName),
      );

    return { from, to, groupBy, rows };
  }

  private periodKey(date: Date, groupBy: TimeTrackingSummaryGroupBy): string {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: MADRID_TZ,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(date);
    const year = parts.find((part) => part.type === 'year')!.value;
    const month = parts.find((part) => part.type === 'month')!.value;
    const day = parts.find((part) => part.type === 'day')!.value;

    if (groupBy === 'day') return `${year}-${month}-${day}`;
    if (groupBy === 'month') return `${year}-${month}`;

    return this.isoWeekKey(Number(year), Number(month), Number(day));
  }

  private isoWeekKey(year: number, month: number, day: number): string {
    const localMidnight = new Date(Date.UTC(year, month - 1, day));
    const isoDayNum = (localMidnight.getUTCDay() + 6) % 7; // 0 = lunes
    const thursday = new Date(localMidnight);
    thursday.setUTCDate(localMidnight.getUTCDate() - isoDayNum + 3);

    const isoYear = thursday.getUTCFullYear();
    const firstThursday = new Date(Date.UTC(isoYear, 0, 4));
    const firstThursdayDayNum = (firstThursday.getUTCDay() + 6) % 7;
    firstThursday.setUTCDate(
      firstThursday.getUTCDate() - firstThursdayDayNum + 3,
    );

    const week =
      1 +
      Math.round(
        (thursday.getTime() - firstThursday.getTime()) /
          (7 * 24 * 60 * 60 * 1000),
      );

    return `${isoYear}-W${String(week).padStart(2, '0')}`;
  }
}
