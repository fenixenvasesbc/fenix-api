import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from 'src/prisma/prisma.service';
import { BusinessDaysService } from './business-days.service';

describe('BusinessDaysService', () => {
  let service: BusinessDaysService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BusinessDaysService,
        { provide: PrismaService, useValue: { publicHoliday: { findMany: jest.fn() } } },
      ],
    }).compile();

    service = module.get<BusinessDaysService>(BusinessDaysService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ---------------------------------------------------------------
  // computeBusinessDueAt (ADR-004 §7, Submódulo 1)
  // ---------------------------------------------------------------

  describe('computeBusinessDueAt', () => {
    const empty = new Set<string>();

    it('counts the anchor day as day 1 when the anchor is before the cutoff hour', () => {
      // 2026-01-05 10:00 Europe/Madrid (CET, UTC+1) -> Monday, business day.
      const anchor = new Date('2026-01-05T09:00:00.000Z');

      const dueAt = service.computeBusinessDueAt(anchor, 1, empty, {
        cutoffHour: 14,
      });

      // 14:00 Europe/Madrid on the same day (2026-01-05) = 13:00 UTC (CET).
      expect(dueAt).toEqual(new Date('2026-01-05T13:00:00.000Z'));
    });

    it('starts counting from the next business day when the anchor is at/after the cutoff hour', () => {
      // 2026-01-05 16:00 Europe/Madrid -> after the 14:00 cutoff.
      const anchor = new Date('2026-01-05T15:00:00.000Z');

      const dueAt = service.computeBusinessDueAt(anchor, 1, empty, {
        cutoffHour: 14,
      });

      // Day 1 becomes 2026-01-06 (Tuesday) -> 14:00 Madrid = 13:00 UTC.
      expect(dueAt).toEqual(new Date('2026-01-06T13:00:00.000Z'));
    });

    it('skips the weekend when the next business day falls on it', () => {
      // 2026-01-02 is a Friday; 16:00 Madrid is after the cutoff.
      const anchor = new Date('2026-01-02T15:00:00.000Z');

      const dueAt = service.computeBusinessDueAt(anchor, 1, empty, {
        cutoffHour: 14,
      });

      // Day 1 skips Sat 01-03/Sun 01-04 and lands on Mon 2026-01-05.
      expect(dueAt).toEqual(new Date('2026-01-05T13:00:00.000Z'));
    });

    it('also skips holidays loaded in holidaySet', () => {
      const anchor = new Date('2026-01-02T15:00:00.000Z'); // Friday, after cutoff
      const holidaySet = new Set(['2026-01-05']); // Monday is a public holiday

      const dueAt = service.computeBusinessDueAt(anchor, 1, holidaySet, {
        cutoffHour: 14,
      });

      // Skips the weekend AND the Monday holiday -> lands on Tuesday 01-06.
      expect(dueAt).toEqual(new Date('2026-01-06T13:00:00.000Z'));
    });

    it('counts multiple business days from the anchor', () => {
      const anchor = new Date('2026-01-05T09:00:00.000Z'); // Monday, before cutoff

      const dueAt = service.computeBusinessDueAt(anchor, 3, empty, {
        cutoffHour: 14,
      });

      // Mon(1) Tue(2) Wed(3) -> 2026-01-07.
      expect(dueAt).toEqual(new Date('2026-01-07T13:00:00.000Z'));
    });
  });

  // ---------------------------------------------------------------
  // businessDaysUntilDue (ADR-004 §8, semáforo de 3 colores)
  // ---------------------------------------------------------------

  describe('businessDaysUntilDue', () => {
    const empty = new Set<string>();

    it('returns 0 when now and dueAt fall on the same business day', () => {
      const now = new Date('2026-01-05T08:00:00.000Z');
      const dueAt = new Date('2026-01-05T13:00:00.000Z');

      expect(service.businessDaysUntilDue(now, dueAt, empty)).toBe(0);
    });

    it('returns 1 when dueAt is the next business day', () => {
      const now = new Date('2026-01-05T08:00:00.000Z'); // Monday
      const dueAt = new Date('2026-01-06T13:00:00.000Z'); // Tuesday

      expect(service.businessDaysUntilDue(now, dueAt, empty)).toBe(1);
    });

    it('returns more than 1 when several business days remain', () => {
      const now = new Date('2026-01-05T08:00:00.000Z'); // Monday
      const dueAt = new Date('2026-01-08T13:00:00.000Z'); // Thursday

      expect(service.businessDaysUntilDue(now, dueAt, empty)).toBe(3);
    });

    it('returns -1 when dueAt already fell on a previous day', () => {
      const now = new Date('2026-01-06T08:00:00.000Z');
      const dueAt = new Date('2026-01-05T13:00:00.000Z');

      expect(service.businessDaysUntilDue(now, dueAt, empty)).toBe(-1);
    });
  });
});
