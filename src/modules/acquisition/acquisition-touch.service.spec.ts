import { Prisma } from '@prisma/client';
import { AcquisitionTouchService } from './acquisition-touch.service';

describe('AcquisitionTouchService (ADR-007)', () => {
  const prisma = {
    landing: {
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      create: jest.fn(),
    },
    leadAcquisitionTouch: { create: jest.fn() },
  };
  let service: AcquisitionTouchService;
  const occurredAt = new Date('2026-11-23T09:00:00Z');

  const uniqueError = () =>
    new Prisma.PrismaClientKnownRequestError('unique', {
      code: 'P2002',
      clientVersion: 'test',
    });

  beforeEach(() => {
    jest.resetAllMocks();
    service = new AcquisitionTouchService(prisma as any);
  });

  it('sin producto no registra nada (no es captacion de n8n)', async () => {
    await service.recordTouch({ leadId: 'lead-1', producto: undefined, occurredAt });
    await service.recordTouch({ leadId: 'lead-1', producto: '   ', occurredAt });

    expect(prisma.landing.findUnique).not.toHaveBeenCalled();
    expect(prisma.leadAcquisitionTouch.create).not.toHaveBeenCalled();
  });

  it('landing conocida: crea el toque con el slug normalizado', async () => {
    prisma.landing.findUnique.mockResolvedValue({ id: 'landing-pizza' });

    await service.recordTouch({
      leadId: 'lead-1',
      producto: ' /Landing-Pizza/ ',
      occurredAt,
      externalMessageId: 'yc-1',
    });

    expect(prisma.landing.findUnique).toHaveBeenCalledWith({
      where: { slug: '/landing-pizza' },
      select: { id: true },
    });
    expect(prisma.landing.create).not.toHaveBeenCalled();
    expect(prisma.leadAcquisitionTouch.create).toHaveBeenCalledWith({
      data: {
        leadId: 'lead-1',
        landingId: 'landing-pizza',
        rawProducto: ' /Landing-Pizza/ ',
        occurredAt,
        externalMessageId: 'yc-1',
      },
    });
  });

  it('landing desconocida: la auto-registra SIN familia y crea el toque', async () => {
    prisma.landing.findUnique.mockResolvedValue(null);
    prisma.landing.create.mockResolvedValue({ id: 'landing-new' });

    await service.recordTouch({ leadId: 'lead-1', producto: '/landing-nueva', occurredAt });

    expect(prisma.landing.create).toHaveBeenCalledWith({
      data: { slug: '/landing-nueva', autoCreated: true },
      select: { id: true },
    });
    expect(prisma.leadAcquisitionTouch.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ landingId: 'landing-new' }) }),
    );
  });

  it('carrera al auto-registrar: reusa la landing creada por el otro envio', async () => {
    prisma.landing.findUnique.mockResolvedValue(null);
    prisma.landing.create.mockRejectedValue(uniqueError());
    prisma.landing.findUniqueOrThrow.mockResolvedValue({ id: 'landing-race' });

    await service.recordTouch({ leadId: 'lead-1', producto: '/landing-nueva', occurredAt });

    expect(prisma.leadAcquisitionTouch.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ landingId: 'landing-race' }) }),
    );
  });

  it('reintento del mismo envio (P2002 en el toque): no lanza', async () => {
    prisma.landing.findUnique.mockResolvedValue({ id: 'landing-pizza' });
    prisma.leadAcquisitionTouch.create.mockRejectedValue(uniqueError());

    await expect(
      service.recordTouch({ leadId: 'lead-1', producto: '/landing-pizza', occurredAt, externalMessageId: 'yc-1' }),
    ).resolves.toBeUndefined();
  });

  it('cualquier otro error se loguea y NO se propaga (no bloquea el mensaje)', async () => {
    prisma.landing.findUnique.mockRejectedValue(new Error('db caida'));

    await expect(
      service.recordTouch({ leadId: 'lead-1', producto: '/landing-pizza', occurredAt }),
    ).resolves.toBeUndefined();
  });
});
