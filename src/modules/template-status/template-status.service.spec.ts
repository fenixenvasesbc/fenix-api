import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from 'src/prisma/prisma.service';
import { WebhookInboxJob } from 'src/common/types/webhook-inbox-job';
import { CampaignTemplateSyncService } from '../campaign-templates/campaign-template-sync.service';
import { TemplateStatusService } from './template-status.service';

function buildJob(templateName: string): WebhookInboxJob {
  return {
    providerEventId: 'evt-1',
    eventType: 'whatsapp.template.reviewed',
    payload: {
      type: 'whatsapp.template.reviewed',
      whatsappTemplate: {
        wabaId: 'waba-123',
        name: templateName,
        language: 'es_ES',
        status: 'APPROVED',
        statusUpdateEvent: 'APPROVED',
      },
    },
  } as unknown as WebhookInboxJob;
}

describe('TemplateStatusService', () => {
  let service: TemplateStatusService;
  let prisma: {
    webhookEvent: { updateMany: jest.Mock };
    globalWhatsappTemplateAccount: { updateMany: jest.Mock };
    account: { findMany: jest.Mock };
  };
  let campaignTemplateSyncService: { syncAccount: jest.Mock };

  beforeEach(async () => {
    prisma = {
      webhookEvent: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      globalWhatsappTemplateAccount: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      account: { findMany: jest.fn().mockResolvedValue([]) },
    };
    campaignTemplateSyncService = {
      syncAccount: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TemplateStatusService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: CampaignTemplateSyncService,
          useValue: campaignTemplateSyncService,
        },
      ],
    }).compile();

    service = module.get<TemplateStatusService>(TemplateStatusService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('does not touch CampaignDefinition sync when the template name is not in the campaign registry', async () => {
    await service.process(buildJob('presupuesto'));

    expect(prisma.account.findMany).not.toHaveBeenCalled();
    expect(campaignTemplateSyncService.syncAccount).not.toHaveBeenCalled();
  });

  it('syncs CampaignDefinition/AccountCampaignTemplate for every active account sharing the wabaId when the template name matches the registry (re_enganche)', async () => {
    prisma.account.findMany.mockResolvedValue([
      { id: 'account-1', user: { isActive: true } },
      { id: 'account-2', user: { isActive: true } },
      { id: 'account-3', user: { isActive: false } },
    ]);

    await service.process(buildJob('re_enganche'));

    expect(prisma.account.findMany).toHaveBeenCalledWith({
      where: { wabaId: 'waba-123' },
      select: { id: true, user: { select: { isActive: true } } },
    });
    expect(campaignTemplateSyncService.syncAccount).toHaveBeenCalledTimes(2);
    expect(campaignTemplateSyncService.syncAccount).toHaveBeenCalledWith(
      'account-1',
    );
    expect(campaignTemplateSyncService.syncAccount).toHaveBeenCalledWith(
      'account-2',
    );
    expect(campaignTemplateSyncService.syncAccount).not.toHaveBeenCalledWith(
      'account-3',
    );
  });

  it('also syncs for recordatorio_repeticion (the other registered template)', async () => {
    prisma.account.findMany.mockResolvedValue([
      { id: 'account-1', user: { isActive: true } },
    ]);

    await service.process(buildJob('recordatorio_repeticion'));

    expect(campaignTemplateSyncService.syncAccount).toHaveBeenCalledWith(
      'account-1',
    );
  });

  it('does not let a failed campaign sync for one account stop the webhook from being marked processed, nor block syncing the remaining accounts', async () => {
    prisma.account.findMany.mockResolvedValue([
      { id: 'account-1', user: { isActive: true } },
      { id: 'account-2', user: { isActive: true } },
    ]);
    campaignTemplateSyncService.syncAccount
      .mockRejectedValueOnce(new Error('YCloud unreachable'))
      .mockResolvedValueOnce(undefined);

    await expect(service.process(buildJob('re_enganche'))).resolves.not.toThrow();

    expect(campaignTemplateSyncService.syncAccount).toHaveBeenCalledTimes(2);
    expect(prisma.webhookEvent.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'PROCESSED' }),
      }),
    );
  });
});
