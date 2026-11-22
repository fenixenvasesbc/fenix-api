import { BadRequestException } from '@nestjs/common';
import { AcquisitionReportService, UNASSIGNED_KEY } from './acquisition-report.service';

/**
 * ADR-007. El SQL (bucket semanal en Europe/Madrid, primera BOCETO y ultimo
 * toque anterior via LATERAL) se valida contra Postgres real; aqui se prueba
 * la agregacion, las reglas de filas, la madurez y la inversion.
 */
describe('AcquisitionReportService (ADR-007)', () => {
  const families = [
    { id: 'f-pizza', name: 'LANDING PIZZA', country: 'ES', active: true, sortOrder: 20 },
    { id: 'f-pizza-fr', name: 'LANDING PIZZA FRANCIA', country: 'FR', active: true, sortOrder: 110 },
    { id: 'f-old', name: 'LANDING VIEJA', country: 'ES', active: false, sortOrder: 900 },
  ];

  let leadRows: any[];
  let bocetoRows: any[];
  let attributedRows: any[];

  const prisma = {
    investmentFamily: { findMany: jest.fn(), count: jest.fn() },
    familyWeeklySpend: {
      findMany: jest.fn(),
      deleteMany: jest.fn(),
      upsert: jest.fn(),
    },
    $queryRaw: jest.fn(),
    $transaction: jest.fn(),
  };
  let service: AcquisitionReportService;

  const d = (key: string) => new Date(`${key}T00:00:00Z`);

  beforeEach(() => {
    jest.resetAllMocks();
    jest.useFakeTimers().setSystemTime(new Date('2026-11-25T10:00:00Z')); // miercoles
    leadRows = [];
    bocetoRows = [];
    attributedRows = [];
    prisma.investmentFamily.findMany.mockResolvedValue(families);
    prisma.familyWeeklySpend.findMany.mockResolvedValue([]);
    prisma.$queryRaw.mockImplementation(async (sql: { sql: string }) => {
      if (sql.sql.includes('COUNT(DISTINCT t."leadId")')) return leadRows;
      if (sql.sql.includes('COUNT(a."approvedAt")')) return bocetoRows;
      return attributedRows;
    });
    service = new AcquisitionReportService(prisma as any);
  });

  afterEach(() => jest.useRealTimers());

  describe('getWeeklyReport', () => {
    it('por defecto devuelve 8 semanas terminando en la semana actual', async () => {
      const report = await service.getWeeklyReport({});
      expect(report.from).toBe('2026-10-05');
      expect(report.to).toBe('2026-11-23');
      expect(report.weeks).toHaveLength(8);
      expect(report.weeks[7]).toEqual({ weekStart: '2026-11-23', status: 'CURRENT' });
    });

    it('agrega leads, bocetos, aprobados e inversion por familia y semana', async () => {
      leadRows = [
        { week: d('2026-11-16'), familyId: 'f-pizza', leads: 50 },
        { week: d('2026-11-16'), familyId: 'f-pizza-fr', leads: 20 },
      ];
      bocetoRows = [{ week: d('2026-11-16'), familyId: 'f-pizza', bocetos: 6, approved: 2 }];
      prisma.familyWeeklySpend.findMany.mockResolvedValue([
        { familyId: 'f-pizza', weekStart: d('2026-11-16'), amountCents: 29400 },
      ]);

      const report = await service.getWeeklyReport({ from: '2026-11-16', to: '2026-11-22' });

      expect(report.weeks).toEqual([{ weekStart: '2026-11-16', status: 'IN_PROGRESS' }]);
      const pizza = report.rows.find((r) => r.key === 'f-pizza')!;
      expect(pizza.weeks[0]).toEqual({
        weekStart: '2026-11-16',
        leads: 50,
        bocetos: 6,
        approved: 2,
        spendCents: 29400,
      });
      const pizzaFr = report.rows.find((r) => r.key === 'f-pizza-fr')!;
      expect(pizzaFr.weeks[0].spendCents).toBeNull(); // sin inversion cargada != 0
      expect(report.totals.totals).toEqual({ leads: 70, bocetos: 6, approved: 2, spendCents: 29400 });
    });

    it('familias inactivas solo aparecen si tienen datos; "Sin familia" solo si hay datos', async () => {
      let report = await service.getWeeklyReport({ from: '2026-11-16', to: '2026-11-22' });
      expect(report.rows.map((r) => r.key)).toEqual(['f-pizza', 'f-pizza-fr']);

      leadRows = [
        { week: d('2026-11-16'), familyId: 'f-old', leads: 3 },
        { week: d('2026-11-16'), familyId: null, leads: 4 },
      ];
      report = await service.getWeeklyReport({ from: '2026-11-16', to: '2026-11-22' });
      expect(report.rows.map((r) => r.key)).toEqual(['f-pizza', 'f-pizza-fr', 'f-old', UNASSIGNED_KEY]);
      expect(report.rows.find((r) => r.key === UNASSIGNED_KEY)!.totals.leads).toBe(4);
    });

    it('ignora filas fuera de las semanas pedidas (rango holgado del SQL)', async () => {
      leadRows = [
        { week: d('2026-11-09'), familyId: 'f-pizza', leads: 99 },
        { week: d('2026-11-16'), familyId: 'f-pizza', leads: 5 },
      ];
      const report = await service.getWeeklyReport({ from: '2026-11-16', to: '2026-11-16' });
      expect(report.totals.totals.leads).toBe(5);
    });

    it('groupBy=country suma las familias de cada pais', async () => {
      leadRows = [
        { week: d('2026-11-16'), familyId: 'f-pizza', leads: 10 },
        { week: d('2026-11-16'), familyId: 'f-pizza-fr', leads: 7 },
      ];
      const report = await service.getWeeklyReport({
        from: '2026-11-16',
        to: '2026-11-16',
        groupBy: 'country',
      });
      expect(report.rows.map((r) => [r.key, r.totals.leads])).toEqual([
        ['ES', 10],
        ['FR', 7],
      ]);
    });

    it('marca como MADURA una semana cuando ya pasaron las semanas de madurez', async () => {
      // Sin muestra suficiente -> madurez estimada de 4 semanas
      const report = await service.getWeeklyReport({ from: '2026-10-19', to: '2026-11-23' });
      expect(report.maturity).toEqual({ weeks: 4, threshold: 0.8, sampleSize: 0, estimated: true });
      const status = Object.fromEntries(report.weeks.map((w) => [w.weekStart, w.status]));
      expect(status['2026-10-19']).toBe('MATURE');
      expect(status['2026-10-26']).toBe('MATURE');
      expect(status['2026-11-02']).toBe('IN_PROGRESS');
      expect(status['2026-11-23']).toBe('CURRENT');
    });

    it('rechaza rangos invertidos o fechas invalidas', async () => {
      await expect(service.getWeeklyReport({ from: '2026-11-23', to: '2026-11-01' })).rejects.toBeInstanceOf(
        BadRequestException,
      );
      await expect(service.getWeeklyReport({ from: '2026-13-01' })).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('tiempos de conversion y madurez', () => {
    const row = (
      touch: string,
      bocetoDays: number,
      approvalDays: number | null,
      familyId = 'f-pizza',
      replyDays: number | null = 0.5,
    ) => {
      const touchAt = new Date(`${touch}T10:00:00Z`);
      return {
        leadId: `${touch}-${bocetoDays}-${approvalDays}`,
        touchAt,
        firstReplyAt: replyDays === null ? null : new Date(touchAt.getTime() + replyDays * 86_400_000),
        bocetoAt: new Date(touchAt.getTime() + bocetoDays * 86_400_000),
        approvedAt:
          approvalDays === null ? null : new Date(touchAt.getTime() + approvalDays * 86_400_000),
        familyId,
      };
    };

    it('calcula percentiles, curva acumulada y semanas de madurez', async () => {
      // 10 aprobados: 8 dentro de la 2a semana (<14 dias), 2 mas tarde
      attributedRows = [
        ...[2, 3, 4, 5, 8, 9, 10, 13].map((days) => row('2026-10-05', 1, days)),
        row('2026-10-05', 2, 20),
        row('2026-10-05', 2, 30),
        row('2026-10-05', 1, null), // pedido sin aprobar
      ];

      const lag = await service.getConversionLag({ from: '2026-10-05', to: '2026-11-23' });

      expect(lag.bocetos).toBe(11);
      expect(lag.approved).toBe(10);
      expect(lag.replied).toBe(11);
      expect(lag.daysEntryToApproval.p50).toBe(8);
      expect(lag.curve[0]).toEqual({ week: 0, cumulativeShare: 0.4 }); // <7 dias: 2,3,4,5
      expect(lag.curve[1]).toEqual({ week: 1, cumulativeShare: 0.8 });
      expect(lag.maturityWeeks).toBe(2);
      expect(lag.byFamily).toEqual([
        expect.objectContaining({ key: 'f-pizza', name: 'LANDING PIZZA', bocetos: 11, approved: 10 }),
      ]);

      const maturity = await service.computeMaturity();
      expect(maturity).toEqual({ weeks: 2, threshold: 0.8, sampleSize: 10, estimated: false });
    });

    it('tramos pedidos por el usuario: primera respuesta -> boceto y boceto -> aprobado (media y percentiles)', async () => {
      attributedRows = [
        // respuesta a las 12h, boceto al dia 1 -> 0.5 dias; aprobado al dia 3 -> 2 dias
        row('2026-11-02', 1, 3),
        // respuesta a las 12h, boceto al dia 2 -> 1.5 dias; aprobado al dia 6 -> 4 dias
        row('2026-11-02', 2, 6),
        // respuesta al dia 1, boceto al dia 4 -> 3 dias; sin aprobar
        row('2026-11-02', 4, null, 'f-pizza', 1),
        // no contesto antes de pedir el boceto: fuera del tramo 1, dentro del tramo 2
        row('2026-11-02', 1, 2, 'f-pizza', null),
      ];

      const lag = await service.getConversionLag({ from: '2026-11-02', to: '2026-11-23' });

      expect(lag.replied).toBe(3);
      expect(lag.daysReplyToBoceto).toEqual({ mean: 1.7, p50: 1.5, p80: 3, p90: 3 });
      // boceto -> aprobado: 2, 4, 1
      expect(lag.daysBocetoToApproval).toEqual({ mean: 2.3, p50: 2, p80: 4, p90: 4 });
      expect(lag.byFamily[0]).toEqual(
        expect.objectContaining({
          daysReplyToBoceto: expect.objectContaining({ p50: 1.5 }),
          daysBocetoToApproval: expect.objectContaining({ p50: 2 }),
        }),
      );
    });

    it('sin aprobaciones devuelve estadisticas nulas y curva vacia', async () => {
      attributedRows = [row('2026-11-02', 1, null)];
      const lag = await service.getConversionLag({ from: '2026-11-02', to: '2026-11-23' });
      expect(lag.daysEntryToApproval).toEqual({ mean: null, p50: null, p80: null, p90: null });
      expect(lag.daysBocetoToApproval).toEqual({ mean: null, p50: null, p80: null, p90: null });
      expect(lag.curve).toEqual([]);
      expect(lag.maturityWeeks).toBeNull();
    });
  });

  describe('inversion semanal', () => {
    it('normaliza la semana al lunes y devuelve null donde no hay inversion', async () => {
      prisma.investmentFamily.findMany.mockResolvedValue([
        { id: 'f-pizza', name: 'LANDING PIZZA', country: 'ES' },
        { id: 'f-pizza-fr', name: 'LANDING PIZZA FRANCIA', country: 'FR' },
      ]);
      prisma.familyWeeklySpend.findMany.mockResolvedValue([{ familyId: 'f-pizza', amountCents: 29400 }]);

      const res = await service.getWeeklySpend('2026-11-19'); // jueves

      expect(res.weekStart).toBe('2026-11-16');
      expect(prisma.familyWeeklySpend.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { weekStart: d('2026-11-16') } }),
      );
      expect(res.items.map((i) => i.amountCents)).toEqual([29400, null]);
    });

    it('upsert por familia/semana; null borra; familia inexistente se rechaza', async () => {
      prisma.investmentFamily.count.mockResolvedValue(2);
      prisma.familyWeeklySpend.upsert.mockReturnValue('UPSERT');
      prisma.familyWeeklySpend.deleteMany.mockReturnValue('DELETE');
      prisma.$transaction.mockResolvedValue([]);
      prisma.investmentFamily.findMany.mockResolvedValue([]);

      await service.upsertWeeklySpend(
        '2026-11-16',
        [
          { familyId: 'f-pizza', amountCents: 29400 },
          { familyId: 'f-pizza-fr', amountCents: null },
        ],
        'user-1',
      );

      expect(prisma.familyWeeklySpend.upsert).toHaveBeenCalledWith({
        where: { familyId_weekStart: { familyId: 'f-pizza', weekStart: d('2026-11-16') } },
        create: { familyId: 'f-pizza', weekStart: d('2026-11-16'), amountCents: 29400, updatedByUserId: 'user-1' },
        update: { amountCents: 29400, updatedByUserId: 'user-1' },
      });
      expect(prisma.familyWeeklySpend.deleteMany).toHaveBeenCalledWith({
        where: { familyId: 'f-pizza-fr', weekStart: d('2026-11-16') },
      });
      expect(prisma.$transaction).toHaveBeenCalledWith(['UPSERT', 'DELETE']);

      prisma.investmentFamily.count.mockResolvedValue(0);
      await expect(
        service.upsertWeeklySpend('2026-11-16', [{ familyId: 'x', amountCents: 1 }], 'user-1'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});
