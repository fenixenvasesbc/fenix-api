import { Prisma } from '@prisma/client';
import { AcquisitionTouchService } from './acquisition-touch.service';

describe('AcquisitionTouchService (ADR-007, por plantilla)', () => {
  const prisma = {
    acquisitionTemplate: {
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      create: jest.fn(),
    },
    leadAcquisitionTouch: { create: jest.fn() },
    $executeRaw: jest.fn(),
  };
  let service: AcquisitionTouchService;
  const occurredAt = new Date('2026-11-23T09:00:00Z');

  const uniqueError = () =>
    new Prisma.PrismaClientKnownRequestError('unique', { code: 'P2002', clientVersion: 'test' });

  beforeEach(() => {
    jest.resetAllMocks();
    service = new AcquisitionTouchService(prisma as any);
  });

  it('sin plantilla no registra nada', async () => {
    await service.recordTouch({ leadId: 'lead-1', templateName: undefined, occurredAt });
    await service.recordTouch({ leadId: 'lead-1', templateName: '  ', occurredAt });

    expect(prisma.acquisitionTemplate.findUnique).not.toHaveBeenCalled();
    expect(prisma.leadAcquisitionTouch.create).not.toHaveBeenCalled();
  });

  it('plantilla del catalogo: crea el toque LIVE', async () => {
    prisma.acquisitionTemplate.findUnique.mockResolvedValue({ id: 'tpl-pizza' });

    await service.recordTouch({
      leadId: 'lead-1',
      templateName: 'cajas_pizza_es',
      occurredAt,
      externalMessageId: 'yc-1',
    });

    expect(prisma.acquisitionTemplate.create).not.toHaveBeenCalled();
    expect(prisma.leadAcquisitionTouch.create).toHaveBeenCalledWith({
      data: {
        leadId: 'lead-1',
        templateId: 'tpl-pizza',
        templateName: 'cajas_pizza_es',
        occurredAt,
        externalMessageId: 'yc-1',
        source: 'LIVE',
      },
    });
  });

  it('plantilla nueva: la auto-registra SIN familia y crea el toque', async () => {
    prisma.acquisitionTemplate.findUnique.mockResolvedValue(null);
    prisma.acquisitionTemplate.create.mockResolvedValue({ id: 'tpl-new' });

    await service.recordTouch({ leadId: 'lead-1', templateName: 'campana_nueva_es', occurredAt });

    expect(prisma.acquisitionTemplate.create).toHaveBeenCalledWith({
      data: { templateName: 'campana_nueva_es', autoCreated: true },
      select: { id: true },
    });
    expect(prisma.leadAcquisitionTouch.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ templateId: 'tpl-new' }) }),
    );
  });

  it('carrera al auto-registrar: reusa la plantilla creada por el otro envio', async () => {
    prisma.acquisitionTemplate.findUnique.mockResolvedValue(null);
    prisma.acquisitionTemplate.create.mockRejectedValue(uniqueError());
    prisma.acquisitionTemplate.findUniqueOrThrow.mockResolvedValue({ id: 'tpl-race' });

    await service.recordTouch({ leadId: 'lead-1', templateName: 'campana_nueva_es', occurredAt });

    expect(prisma.leadAcquisitionTouch.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ templateId: 'tpl-race' }) }),
    );
  });

  it('reintento del mismo envio (P2002 en el toque): no lanza', async () => {
    prisma.acquisitionTemplate.findUnique.mockResolvedValue({ id: 'tpl-pizza' });
    prisma.leadAcquisitionTouch.create.mockRejectedValue(uniqueError());

    await expect(
      service.recordTouch({ leadId: 'lead-1', templateName: 'cajas_pizza_es', occurredAt, externalMessageId: 'yc-1' }),
    ).resolves.toBeUndefined();
  });

  it('cualquier otro error se loguea y NO se propaga (no bloquea el mensaje)', async () => {
    prisma.acquisitionTemplate.findUnique.mockRejectedValue(new Error('db caida'));

    await expect(
      service.recordTouch({ leadId: 'lead-1', templateName: 'cajas_pizza_es', occurredAt }),
    ).resolves.toBeUndefined();
  });

  it('backfillTemplate solo toma envios de n8n (sin externalId, sin source, sin whatsappMessage)', async () => {
    prisma.$executeRaw.mockResolvedValue(7);

    const inserted = await service.backfillTemplate('tpl-pizza', 'cajas_pizza_es');

    expect(inserted).toBe(7);
    const sql = prisma.$executeRaw.mock.calls[0][0] as { sql: string; values: unknown[] };
    expect(sql.sql).toContain('m."externalId" IS NULL');
    expect(sql.sql).toContain(`jsonb_exists(m."rawPayload", 'wabaId')`);
    expect(sql.sql).toContain(`NOT jsonb_exists(m."rawPayload", 'source')`);
    expect(sql.sql).toContain(`NOT jsonb_exists(m."rawPayload", 'whatsappMessage')`);
    expect(sql.sql).toContain('ON CONFLICT DO NOTHING');
    expect(sql.values).toEqual(['tpl-pizza', 'cajas_pizza_es']);
  });
});
