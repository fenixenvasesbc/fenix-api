import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { LeadCampaignType, Role } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { DashboardService } from './dashboard.service';

describe('DashboardService', () => {
  let service: DashboardService;
  let prisma: { $queryRaw: jest.Mock };

  beforeEach(async () => {
    prisma = { $queryRaw: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DashboardService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<DashboardService>(DashboardService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ---------------------------------------------------------------
  // getCampaignResponseMetrics (ADR-006: tasa de respuesta de
  // LeadCampaign -- reenganche/repeticion/reglas de etiqueta, unificadas
  // via LeadCampaign.respondedAt/sentAt).
  // ---------------------------------------------------------------

  describe('getCampaignResponseMetrics', () => {
    const dto = { from: '2026-10-01', to: '2026-10-17' };

    it('ADMIN sin accountId ve scope GLOBAL y mapea las filas con responseRate', async () => {
      prisma.$queryRaw.mockResolvedValue([
        {
          type: 'LABEL_RULE',
          templateName: 'recordatorio_presupuesto',
          sent: 10n,
          responded: 4n,
          avgResponseSeconds: 3600.4,
        },
        {
          type: 'WEEK1_REENGAGEMENT',
          templateName: 're_enganche',
          sent: 5n,
          responded: 0n,
          avgResponseSeconds: null,
        },
      ]);

      const result = await service.getCampaignResponseMetrics(dto, {
        role: Role.ADMIN,
        accountId: null,
      });

      expect(result.scope).toBe('GLOBAL');
      expect(result.appliedAccountId).toBeNull();
      expect(result.data).toEqual([
        {
          type: 'LABEL_RULE',
          templateName: 'recordatorio_presupuesto',
          sent: 10,
          responded: 4,
          responseRate: 40,
          avgResponseSeconds: 3600,
        },
        {
          type: 'WEEK1_REENGAGEMENT',
          templateName: 're_enganche',
          sent: 5,
          responded: 0,
          responseRate: 0,
          avgResponseSeconds: null,
        },
      ]);
    });

    it('ADMIN con accountId consulta scope ACCOUNT', async () => {
      prisma.$queryRaw.mockResolvedValue([]);

      const result = await service.getCampaignResponseMetrics(
        { ...dto, accountId: 'account-9' },
        { role: Role.ADMIN, accountId: null },
      );

      expect(result.scope).toBe('ACCOUNT');
      expect(result.appliedAccountId).toBe('account-9');
    });

    it('SALES siempre queda limitado a su propia cuenta, ignorando accountId del query', async () => {
      prisma.$queryRaw.mockResolvedValue([]);

      const result = await service.getCampaignResponseMetrics(
        { ...dto, accountId: 'account-otra' },
        { role: Role.SALES, accountId: 'account-1' },
      );

      expect(result.appliedAccountId).toBe('account-1');
    });

    it('SALES sin accountId propio lanza ForbiddenException', async () => {
      await expect(
        service.getCampaignResponseMetrics(dto, {
          role: Role.SALES,
          accountId: null,
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);

      expect(prisma.$queryRaw).not.toHaveBeenCalled();
    });

    it('filtra por type cuando se especifica', async () => {
      prisma.$queryRaw.mockResolvedValue([]);

      await service.getCampaignResponseMetrics(
        { ...dto, type: LeadCampaignType.LABEL_RULE },
        { role: Role.ADMIN, accountId: null },
      );

      expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
      const [sqlFragment] = prisma.$queryRaw.mock.calls[0];
      expect(sqlFragment.values).toContain(LeadCampaignType.LABEL_RULE);
    });
  });
});
