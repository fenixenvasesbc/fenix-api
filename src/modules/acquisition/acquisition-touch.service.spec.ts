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

  it('backfillTemplate: primero envios exactos de n8n, luego el dato del lead para los que no tienen toque', async () => {
    prisma.$executeRaw.mockResolvedValueOnce(7).mockResolvedValueOnce(30);

    const inserted = await service.backfillTemplate('tpl-pizza', 'cajas_pizza_es');

    expect(inserted).toBe(37);
    const fromMessages = prisma.$executeRaw.mock.calls[0][0] as { sql: string; values: unknown[] };
    expect(fromMessages.sql).toContain('FROM "Message" m');
    expect(fromMessages.sql).toContain('m."externalId" IS NULL');
    expect(fromMessages.sql).toContain(`jsonb_exists(m."rawPayload", 'wabaId')`);
    expect(fromMessages.sql).toContain(`NOT jsonb_exists(m."rawPayload", 'source')`);
    expect(fromMessages.sql).toContain(`NOT jsonb_exists(m."rawPayload", 'whatsappMessage')`);
    expect(fromMessages.values).toEqual(['tpl-pizza', 'cajas_pizza_es']);

    const fromLeads = prisma.$executeRaw.mock.calls[1][0] as { sql: string; values: unknown[] };
    expect(fromLeads.sql).toContain('FROM "Lead" l');
    expect(fromLeads.sql).toContain('l."firstOutboundAt" IS NOT NULL');
    expect(fromLeads.sql).toContain('NOT EXISTS (SELECT 1 FROM "LeadAcquisitionTouch" t WHERE t."leadId" = l."id")');
    expect(fromLeads.sql).toContain("'BACKFILL_LEAD'");
    expect(fromLeads.values).toEqual(['tpl-pizza', 'cajas_pizza_es']);
  });
});
