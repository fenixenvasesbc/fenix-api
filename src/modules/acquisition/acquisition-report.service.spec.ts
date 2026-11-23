import { BadRequestException } from '@nestjs/common';
import {
  AcquisitionReportService,
  NO_CAMPAIGN_KEY,
  UNASSIGNED_KEY,
} from './acquisition-report.service';
import { AcquisitionSpendService } from './acquisition-spend.service';

/**
 * ADR-007. El SQL (fecha local en Europe/Madrid, primera BOCETO / primera
 * etiqueta de presupuesto y ultimo toque anterior via LATERAL) se valida contra
 * Postgres real; aqui se prueba la agregacion por semana martes-lunes y por dia
 * de envio, la inversion diaria, el objetivo y la madurez.
 */
describe('AcquisitionReportService (ADR-007)', () => {
  const families = [
    { id: 'f-pizza', name: 'LANDING PIZZA', country: 'ES', active: true, sortOrder: 20 },
    { id: 'f-pizza-fr', name: 'LANDING PIZZA FRANCIA', country: 'FR', active: true, sortOrder: 110 },
    { id: 'f-old', name: 'LANDING VIEJA', country: 'ES', active: false, sortOrder: 900 },
  ];

  let touchRows: any[];
  let attributedRows: any[];
  let timingRows: any[];
  let quoteRows: any[];
  let rates: any[];
  let targets: any[];
  let quoteLabelCode: string | null;

  const prisma = {
    investmentFamily: { findMany: jest.fn(), count: jest.fn() },
    familySpendRate: { findMany: jest.fn(), upsert: jest.fn() },
    familyLeadTarget: { findMany: jest.fn(), upsert: jest.fn() },
    acquisitionSettings: { findUnique: jest.fn(), upsert: jest.fn() },
    leadLabelDefinition: { findUnique: jest.fn(), count: jest.fn() },
    $queryRaw: jest.fn(),
    $transaction: jest.fn(),
  };
  let service: AcquisitionReportService;

  const d = (key: string) => new Date(`${key}T00:00:00Z`);
  const touch = (leadId: string, day: string, familyId: string | null = 'f-pizza') => ({
    leadId,
    familyId,
    day: d(day),
  });
  const attributed = (touchAt: string, approved = false, familyId: string | null = 'f-pizza') => ({
    leadId: `${touchAt}-${familyId}`,
    touchAt: new Date(touchAt),
    firstReplyAt: null,
    bocetoAt: new Date(touchAt),
    approvedAt: approved ? new Date(touchAt) : null,
    familyId,
  });

  beforeEach(() => {
    jest.resetAllMocks();
    jest.useFakeTimers().setSystemTime(new Date('2026-11-25T10:00:00Z')); // miercoles
    touchRows = [];
    attributedRows = [];
    timingRows = [];
    quoteRows = [];
    rates = [];
    targets = [];
    quoteLabelCode = 'presupuesto-enviado';
    prisma.investmentFamily.findMany.mockResolvedValue(families);
    prisma.familySpendRate.findMany.mockImplementation(async () => rates);
    prisma.familyLeadTarget.findMany.mockImplementation(async () => targets);
    prisma.acquisitionSettings.findUnique.mockImplementation(async () => ({ quoteLabelCode }));
    prisma.leadLabelDefinition.findUnique.mockImplementation(async () =>
      quoteLabelCode ? { code: quoteLabelCode, name: 'Presupuesto enviado', color: null } : null,
    );
    prisma.$queryRaw.mockImplementation(async (sql: { sql: string }) => {
      if (sql.sql.includes('SELECT DISTINCT t."leadId"')) return touchRows;
      if (sql.sql.includes('acquisition:quotes')) return quoteRows;
      if (sql.sql.includes('acquisition:timings')) return timingRows;
      return attributedRows;
    });
    service = new AcquisitionReportService(prisma as any, new AcquisitionSpendService(prisma as any));
  });

  afterEach(() => jest.useRealTimers());

  const rate = (familyId: string, from: string, cents: number) => ({
    familyId,
    effectiveFrom: d(from),
    dailyAmountCents: cents,
  });
  const target = (familyId: string, from: string, cents: number | null) => ({
    familyId,
    effectiveFrom: d(from),
    targetCentsPerLead: cents,
  });

  describe('vista semanal (martes-lunes)', () => {
    it('por defecto devuelve 8 semanas terminando en la semana actual (martes 24 - lunes 30)', async () => {
      const report = await service.getReport({});
      expect(report.granularity).toBe('week');
      expect(report.from).toBe('2026-10-06');
      expect(report.to).toBe('2026-11-30');
      expect(report.periods).toHaveLength(8);
      expect(report.periods[7]).toEqual({
        key: '2026-11-24',
        start: '2026-11-24',
        end: '2026-11-30',
        status: 'CURRENT',
      });
    });

    it('el lunes cierra la semana del martes anterior; leads distintos, bocetos, presupuestos e inversion diaria x 7', async () => {
      touchRows = [
        touch('a', '2026-11-17'),
        touch('b', '2026-11-17'),
        touch('a', '2026-11-20'), // mismo lead otra vez en la semana: cuenta 1
        touch('c', '2026-11-23'), // lunes: semana del 17
        touch('d', '2026-11-24'), // martes: semana siguiente (fuera del rango pedido)
      ];
      attributedRows = [attributed('2026-11-23T09:00:00Z', true), attributed('2026-11-18T09:00:00Z')];
      quoteRows = [{ leadId: 'b', touchAt: new Date('2026-11-17T09:00:00Z'), familyId: 'f-pizza' }];
      rates = [rate('f-pizza', '2026-11-01', 1000)];
      targets = [target('f-pizza', '2026-11-01', 3000)];

      const report = await service.getReport({ from: '2026-11-17', to: '2026-11-23' });

      expect(report.periods.map((p) => p.key)).toEqual(['2026-11-17']);
      const pizza = report.rows.find((r) => r.key === 'f-pizza')!;
      expect(pizza.periods[0]).toEqual({
        key: '2026-11-17',
        leads: 3,
        bocetos: 2,
        approved: 1,
        quotes: 1,
        spendCents: 7000,
        targetCentsPerLead: 3000,
      });
      expect(report.quoteLabel).toEqual(expect.objectContaining({ name: 'Presupuesto enviado' }));
      expect(report.totals.totals).toEqual(expect.objectContaining({ leads: 3, spendCents: 7000 }));
    });

    it('la inversion es "vigente hasta que la cambies": un cambio a mitad de semana suma cada dia con su importe', async () => {
      rates = [rate('f-pizza', '2026-11-01', 1000), rate('f-pizza', '2026-11-20', 2000)];
      const report = await service.getReport({ from: '2026-11-17', to: '2026-11-23' });
      // mar-jue 3 x 10 € + vie-lun 4 x 20 €
      expect(report.rows.find((r) => r.key === 'f-pizza')!.periods[0].spendCents).toBe(3 * 1000 + 4 * 2000);
      // sin inversion cargada -> null (no 0)
      expect(report.rows.find((r) => r.key === 'f-pizza-fr')!.periods[0].spendCents).toBeNull();
    });

    it('objetivo: ponderado por los mensajes de cada dia; sin mensajes, media de los objetivos diarios', async () => {
      touchRows = [touch('a', '2026-11-17'), touch('b', '2026-11-20')];
      targets = [
        target('f-pizza', '2026-11-01', 3000),
        target('f-pizza', '2026-11-19', 2000),
        target('f-pizza-fr', '2026-11-01', 1000),
      ];
      const report = await service.getReport({ from: '2026-11-17', to: '2026-11-23' });
      expect(report.rows.find((r) => r.key === 'f-pizza')!.periods[0].targetCentsPerLead).toBe(2500);
      expect(report.rows.find((r) => r.key === 'f-pizza-fr')!.periods[0].targetCentsPerLead).toBe(1000);
    });

    it('un objetivo null lo quita desde esa fecha', async () => {
      touchRows = [touch('a', '2026-11-24')];
      targets = [target('f-pizza', '2026-11-01', 3000), target('f-pizza', '2026-11-24', null)];
      const report = await service.getReport({ from: '2026-11-24', to: '2026-11-30' });
      expect(report.rows.find((r) => r.key === 'f-pizza')!.periods[0].targetCentsPerLead).toBeNull();
    });

    it('familias inactivas solo aparecen si tienen datos; "Sin familia" solo si hay datos', async () => {
      let report = await service.getReport({ from: '2026-11-17', to: '2026-11-23' });
      expect(report.rows.map((r) => r.key)).toEqual(['f-pizza', 'f-pizza-fr']);

      touchRows = [touch('x', '2026-11-18', 'f-old'), touch('y', '2026-11-18', null)];
      report = await service.getReport({ from: '2026-11-17', to: '2026-11-23' });
      expect(report.rows.map((r) => r.key)).toEqual(['f-pizza', 'f-pizza-fr', 'f-old', UNASSIGNED_KEY]);
    });

    it('groupBy=country suma las familias de cada pais (y el objetivo se pondera)', async () => {
      touchRows = [touch('a', '2026-11-17'), touch('b', '2026-11-17', 'f-old')];
      targets = [target('f-pizza', '2026-11-01', 3000), target('f-old', '2026-11-01', 1000)];
      rates = [rate('f-pizza', '2026-11-01', 1000), rate('f-pizza-fr', '2026-11-01', 500)];
      const report = await service.getReport({ from: '2026-11-17', to: '2026-11-23', groupBy: 'country' });
      const es = report.rows.find((r) => r.key === 'ES')!;
      const fr = report.rows.find((r) => r.key === 'FR')!;
      expect(es.periods[0]).toEqual(expect.objectContaining({ leads: 2, spendCents: 7000, targetCentsPerLead: 2000 }));
      expect(fr.periods[0]).toEqual(expect.objectContaining({ leads: 0, spendCents: 3500 }));
    });

    it('marca como MADURA una semana cuando ya pasaron las semanas de madurez (4 por defecto)', async () => {
      const report = await service.getReport({ from: '2026-10-20', to: '2026-11-25' });
      const status = Object.fromEntries(report.periods.map((p) => [p.key, p.status]));
      expect(status['2026-10-20']).toBe('MATURE');
      expect(status['2026-10-27']).toBe('MATURE');
      expect(status['2026-11-03']).toBe('IN_PROGRESS');
      expect(status['2026-11-24']).toBe('CURRENT');
    });

    it('sin etiqueta de presupuesto configurada no consulta presupuestos', async () => {
      quoteLabelCode = null;
      const report = await service.getReport({ from: '2026-11-17', to: '2026-11-23' });
      expect(report.quoteLabel).toBeNull();
      const sqls = prisma.$queryRaw.mock.calls.map((c) => c[0].sql as string);
      expect(sqls.some((s) => s.includes('acquisition:quotes'))).toBe(false);
    });

    it('rechaza rangos invertidos o fechas invalidas', async () => {
      await expect(service.getReport({ from: '2026-11-30', to: '2026-11-01' })).rejects.toBeInstanceOf(
        BadRequestException,
      );
      await expect(service.getReport({ from: '2026-13-01' })).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('vista diaria (dias de envio)', () => {
    it('muestra mar-vie y lunes; el lunes suma la inversion y los leads de sabado y domingo', async () => {
      touchRows = [
        touch('a', '2026-11-17'),
        touch('b', '2026-11-21'), // sabado -> lunes 23
        touch('c', '2026-11-23'),
      ];
      rates = [rate('f-pizza', '2026-11-01', 1000)];
      const report = await service.getReport({ granularity: 'day', from: '2026-11-17', to: '2026-11-23' });

      expect(report.periods.map((p) => p.key)).toEqual([
        '2026-11-17',
        '2026-11-18',
        '2026-11-19',
        '2026-11-20',
        '2026-11-23',
      ]);
      expect(report.periods[4]).toEqual(expect.objectContaining({ start: '2026-11-21', end: '2026-11-23' }));
      const cells = report.rows.find((r) => r.key === 'f-pizza')!.periods;
      expect(cells[0]).toEqual(expect.objectContaining({ leads: 1, spendCents: 1000 }));
      expect(cells[4]).toEqual(expect.objectContaining({ leads: 2, spendCents: 3000 }));
      // la suma de los dias = la semana
      expect(report.rows.find((r) => r.key === 'f-pizza')!.totals.spendCents).toBe(7000);
    });

    it('por defecto es la semana actual (martes a lunes)', async () => {
      const report = await service.getReport({ granularity: 'day' });
      expect(report.from).toBe('2026-11-24');
      expect(report.to).toBe('2026-11-30');
      expect(report.periods.map((p) => p.status)).toEqual(['IN_PROGRESS', 'CURRENT', 'CURRENT', 'CURRENT', 'CURRENT']);
    });

    it('limita el rango diario', async () => {
      await expect(
        service.getReport({ granularity: 'day', from: '2026-01-01', to: '2026-11-23' }),
      ).rejects.toBeInstanceOf(BadRequestException);
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
      timingRows = attributedRows;

      const lag = await service.getConversionLag({ from: '2026-10-05', to: '2026-11-23' });

      expect(lag.bocetos).toBe(11);
      expect(lag.approved).toBe(10);
      expect(lag.replied).toBe(11);
      expect(lag.daysEntryToApproval.p50).toBe(8);
      expect(lag.curveSample).toBe(10);
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
      timingRows = [
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
      // la curva/madurez sale de la cohorte de campañas (vacia aqui)
      expect(lag.curve).toEqual([]);
    });

    it('los tiempos NO dependen de n8n: bocetos sin contacto de n8n cuentan en "Sin contacto de n8n"', async () => {
      const bocetoAt = new Date('2026-11-10T10:00:00Z');
      timingRows = [
        {
          leadId: 'lead-organico',
          touchAt: null,
          familyId: null,
          firstReplyAt: new Date('2026-11-08T10:00:00Z'), // 2 dias antes
          bocetoAt,
          approvedAt: new Date('2026-11-13T10:00:00Z'), // 3 dias despues
        },
      ];
      attributedRows = []; // ningun lead de campaña

      const lag = await service.getConversionLag({ from: '2026-11-02', to: '2026-11-23' });

      expect(lag.bocetos).toBe(1);
      expect(lag.daysReplyToBoceto.mean).toBe(2);
      expect(lag.daysBocetoToApproval.mean).toBe(3);
      expect(lag.byFamily).toEqual([
        expect.objectContaining({ key: NO_CAMPAIGN_KEY, name: 'Sin contacto de n8n', bocetos: 1, approved: 1 }),
      ]);
    });

    it('filtra por la semana del boceto (no la del contacto)', async () => {
      timingRows = [
        { leadId: 'a', touchAt: null, familyId: null, firstReplyAt: null, bocetoAt: new Date('2026-10-20T10:00:00Z'), approvedAt: null },
        { leadId: 'b', touchAt: null, familyId: null, firstReplyAt: null, bocetoAt: new Date('2026-11-10T10:00:00Z'), approvedAt: null },
      ];
      const lag = await service.getConversionLag({ from: '2026-11-02', to: '2026-11-23' });
      expect(lag.bocetos).toBe(1);
      expect(lag.replied).toBe(0);
    });

    it('sin aprobaciones devuelve estadisticas nulas y curva vacia', async () => {
      attributedRows = [row('2026-11-02', 1, null)];
      timingRows = attributedRows;
      const lag = await service.getConversionLag({ from: '2026-11-02', to: '2026-11-23' });
      expect(lag.daysEntryToApproval).toEqual({ mean: null, p50: null, p80: null, p90: null });
      expect(lag.daysBocetoToApproval).toEqual({ mean: null, p50: null, p80: null, p90: null });
      expect(lag.curve).toEqual([]);
      expect(lag.maturityWeeks).toBeNull();
    });
  });

});
