import { Test, TestingModule } from '@nestjs/testing';
import { EventsService } from './events.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AcquisitionTouchService } from '../acquisition/acquisition-touch.service';

describe('EventsService', () => {
  let service: EventsService;
  const prisma = {
    account: { findUnique: jest.fn() },
    lead: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
    message: { create: jest.fn(), findUnique: jest.fn() },
  };
  const acquisitionTouches = { recordTouch: jest.fn() };

  beforeEach(async () => {
    jest.resetAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EventsService,
        { provide: PrismaService, useValue: prisma },
        { provide: AcquisitionTouchService, useValue: acquisitionTouches },
      ],
    }).compile();

    service = module.get<EventsService>(EventsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('registerOutboundAccepted -> captacion (ADR-007)', () => {
    const baseBody = {
      id: 'ycloud-msg-1',
      status: 'accepted',
      from: '+34600000000',
      to: '+34611111111',
      wabaId: 'waba-1',
      createTime: '2026-11-23T09:00:00.000Z',
      template: { name: 'cajas_pizza_es', language: { code: 'es_ES' } },
    };

    beforeEach(() => {
      prisma.account.findUnique.mockResolvedValue({ id: 'acc-1' });
      prisma.lead.findUnique.mockResolvedValue(null);
      prisma.lead.create.mockResolvedValue({ id: 'lead-1' });
      prisma.message.create.mockResolvedValue({ id: 'msg-1' });
    });

    it('registra el toque con el producto, la hora del proveedor y el id de YCloud', async () => {
      await service.registerOutboundAccepted({ ...baseBody, producto: '/landing-pizza' } as any);

      expect(acquisitionTouches.recordTouch).toHaveBeenCalledWith({
        leadId: 'lead-1',
        producto: '/landing-pizza',
        occurredAt: new Date('2026-11-23T09:00:00.000Z'),
        externalMessageId: 'ycloud-msg-1',
      });
      expect(prisma.message.create).toHaveBeenCalled();
    });

    it('sin producto delega igual (el servicio lo ignora) y el mensaje se guarda', async () => {
      await service.registerOutboundAccepted(baseBody as any);

      expect(acquisitionTouches.recordTouch).toHaveBeenCalledWith(
        expect.objectContaining({ producto: undefined }),
      );
      expect(prisma.message.create).toHaveBeenCalled();
    });
  });
});
