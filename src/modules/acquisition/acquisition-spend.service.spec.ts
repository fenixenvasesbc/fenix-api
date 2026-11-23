import { BadRequestException } from '@nestjs/common';
import { AcquisitionSpendService, valueOn } from './acquisition-spend.service';

describe('AcquisitionSpendService (ADR-007, inversion diaria y objetivo)', () => {
  const d = (key: string) => new Date(`${key}T00:00:00Z`);
  let rates: any[];
  let targets: any[];
  const prisma = {
    investmentFamily: { findMany: jest.fn(), count: jest.fn() },
    familySpendRate: { findMany: jest.fn(), upsert: jest.fn() },
    familyLeadTarget: { findMany: jest.fn(), upsert: jest.fn() },
    acquisitionSettings: { findUnique: jest.fn(), upsert: jest.fn() },
    leadLabelDefinition: { findUnique: jest.fn(), count: jest.fn() },
    $transaction: jest.fn(),
  };
  let service: AcquisitionSpendService;

  beforeEach(() => {
    jest.resetAllMocks();
    rates = [
      { familyId: 'f1', effectiveFrom: d('2026-11-10'), dailyAmountCents: 1000 },
      { familyId: 'f1', effectiveFrom: d('2026-11-20'), dailyAmountCents: 1500 },
    ];
    targets = [{ familyId: 'f1', effectiveFrom: d('2026-11-01'), targetCentsPerLead: 300 }];
    prisma.investmentFamily.findMany.mockResolvedValue([
      { id: 'f1', name: 'LANDING PIZZA', country: 'ES' },
      { id: 'f2', name: 'LANDING COMBO', country: 'ES' },
    ]);
    prisma.investmentFamily.count.mockImplementation(async ({ where }) => where.id.in.filter((id: string) => id !== 'nope').length);
    prisma.familySpendRate.findMany.mockImplementation(async () => rates);
    prisma.familyLeadTarget.findMany.mockImplementation(async () => targets);
    prisma.familySpendRate.upsert.mockImplementation((args) => ({ op: 'rate', args }));
    prisma.familyLeadTarget.upsert.mockImplementation((args) => ({ op: 'target', args }));
    prisma.$transaction.mockResolvedValue([]);
    service = new AcquisitionSpendService(prisma as any);
  });

  it('valueOn toma el valor con la fecha de inicio mas reciente <= dia', () => {
    const list = [
      { effectiveFrom: '2026-11-10', value: 1 },
      { effectiveFrom: '2026-11-20', value: 2 },
    ];
    expect(valueOn(list, '2026-11-09')).toBeNull();
    expect(valueOn(list, '2026-11-10')?.value).toBe(1);
    expect(valueOn(list, '2026-11-19')?.value).toBe(1);
    expect(valueOn(list, '2026-12-31')?.value).toBe(2);
  });

  it('getForm precarga los ultimos valores vigentes y avisa de cambios posteriores', async () => {
    const form = await service.getForm('2026-11-15');
    expect(form.items[0]).toEqual({
      familyId: 'f1',
      name: 'LANDING PIZZA',
      country: 'ES',
      dailyAmountCents: 1000,
      spendEffectiveFrom: '2026-11-10',
      targetCentsPerLead: 300,
      targetEffectiveFrom: '2026-11-01',
      nextChangeFrom: '2026-11-20',
    });
    expect(form.items[1]).toEqual(
      expect.objectContaining({ familyId: 'f2', dailyAmountCents: null, targetCentsPerLead: null, nextChangeFrom: null }),
    );
  });

  it('saveForm solo guarda lo que cambia respecto a lo vigente ese dia', async () => {
    const res = await service.saveForm(
      '2026-11-23',
      [
        { familyId: 'f1', dailyAmountCents: 1500, targetCentsPerLead: 250 }, // importe igual, objetivo cambia
        { familyId: 'f2', dailyAmountCents: 800 }, // nuevo
      ],
      'user-1',
    );
    const ops = prisma.$transaction.mock.calls[0][0];
    expect(ops).toHaveLength(2);
    expect(ops[0]).toEqual({
      op: 'target',
      args: expect.objectContaining({
        where: { familyId_effectiveFrom: { familyId: 'f1', effectiveFrom: d('2026-11-23') } },
        create: expect.objectContaining({ targetCentsPerLead: 250, updatedByUserId: 'user-1' }),
      }),
    });
    expect(ops[1]).toEqual({
      op: 'rate',
      args: expect.objectContaining({ create: expect.objectContaining({ familyId: 'f2', dailyAmountCents: 800 }) }),
    });
    expect(res.changed).toBe(2);
  });

  it('objetivo null quita el objetivo desde esa fecha; si ya no habia, no guarda nada', async () => {
    await service.saveForm('2026-11-23', [{ familyId: 'f1', targetCentsPerLead: null }, { familyId: 'f2', targetCentsPerLead: null }], 'u');
    const ops = prisma.$transaction.mock.calls[0][0];
    expect(ops).toHaveLength(1);
    expect(ops[0].args.create).toEqual(expect.objectContaining({ familyId: 'f1', targetCentsPerLead: null }));
  });

  it('sin cambios no abre transaccion; familia inexistente o fecha invalida se rechazan', async () => {
    await service.saveForm('2026-11-23', [{ familyId: 'f1', dailyAmountCents: 1500 }], 'u');
    expect(prisma.$transaction).not.toHaveBeenCalled();
    await expect(service.saveForm('2026-11-23', [{ familyId: 'nope', dailyAmountCents: 1 }], 'u')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(service.saveForm('2026-02-30', [], 'u')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('ajustes: la etiqueta de presupuesto debe existir', async () => {
    prisma.leadLabelDefinition.count.mockResolvedValue(0);
    await expect(service.updateSettings({ quoteLabelCode: 'no-existe' }, 'u')).rejects.toBeInstanceOf(BadRequestException);
    prisma.leadLabelDefinition.count.mockResolvedValue(1);
    prisma.acquisitionSettings.findUnique.mockResolvedValue({ quoteLabelCode: 'presupuesto-enviado' });
    prisma.leadLabelDefinition.findUnique.mockResolvedValue({ code: 'presupuesto-enviado', name: 'Presupuesto enviado', color: null });
    const res = await service.updateSettings({ quoteLabelCode: 'presupuesto-enviado' }, 'u');
    expect(prisma.acquisitionSettings.upsert).toHaveBeenCalled();
    expect(res.quoteLabel?.name).toBe('Presupuesto enviado');
  });
});
