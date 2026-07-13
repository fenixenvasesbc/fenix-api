import { WebhookEventStatus } from '@prisma/client';
import { SmbStateSyncService } from './smb-state-sync.service';

describe('SmbStateSyncService', () => {
  const job = {
    provider: 'ycloud' as const,
    providerEventId: 'evt_6a54b78594f7fc5f9b9c0ea5',
    eventType: 'whatsapp.smb.app.state.sync',
    apiVersion: 'v2',
    providerTime: '2026-07-13T10:01:41.355Z',
    receivedAt: '2026-07-13T10:01:42.000Z',
    payload: {
      id: 'evt_6a54b78594f7fc5f9b9c0ea5',
      type: 'whatsapp.smb.app.state.sync',
      apiVersion: 'v2',
      createTime: '2026-07-13T10:01:41.355Z',
      whatsappSmbAppStateSync: {
        wabaId: '1846802705910630',
        phoneNumber: '+34645730616',
        stateSync: [
          {
            contact: {
              fullName: 'CUSTOMER-FULL-NAME',
              firstName: 'CUSTOMER-FIRST-NAME',
              phoneNumber: '+393933891708',
              userId: 'US.13491208655302741918',
              parentUserId: 'US.11815799212886844830',
              username: '@Joejoe',
            },
            action: 'add',
            timestamp: 1783936899877,
          },
        ],
      },
    },
  };

  const buildService = () => {
    const chatEvents = {
      publish: jest.fn().mockResolvedValue(undefined),
    };
    const prisma = {
      webhookEvent: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      account: {
        findUnique: jest.fn().mockResolvedValue({ id: 'account-1' }),
      },
      lead: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'lead-1',
          whatsappContactName: null,
          whatsappUserId: null,
          whatsappParentUserId: null,
          whatsappUsername: null,
        }),
        update: jest.fn().mockResolvedValue({ id: 'lead-1' }),
      },
    };

    return {
      prisma,
      chatEvents,
      service: new SmbStateSyncService(prisma as never, chatEvents as never),
    };
  };

  it('updates contact name and WhatsApp identifiers from SMB state sync', async () => {
    const { service, prisma, chatEvents } = buildService();

    await service.process(job);

    expect(prisma.account.findUnique).toHaveBeenCalledWith({
      where: {
        wabaId_phoneE164: {
          wabaId: '1846802705910630',
          phoneE164: '+34645730616',
        },
      },
      select: { id: true },
    });
    expect(prisma.lead.findUnique).toHaveBeenCalledWith({
      where: {
        accountId_phoneE164: {
          accountId: 'account-1',
          phoneE164: '+393933891708',
        },
      },
      select: {
        id: true,
        whatsappContactName: true,
        whatsappUserId: true,
        whatsappParentUserId: true,
        whatsappUsername: true,
      },
    });
    expect(prisma.lead.update).toHaveBeenCalledWith({
      where: { id: 'lead-1' },
      data: {
        whatsappContactName: 'CUSTOMER-FULL-NAME',
        whatsappUserId: 'US.13491208655302741918',
        whatsappParentUserId: 'US.11815799212886844830',
        whatsappUsername: '@Joejoe',
      },
    });
    expect(chatEvents.publish).toHaveBeenCalledWith({
      type: 'conversation.updated',
      accountId: 'account-1',
      leadId: 'lead-1',
      payload: {
        source: 'whatsapp.smb.app.state.sync',
        providerEventId: 'evt_6a54b78594f7fc5f9b9c0ea5',
        action: 'add',
        reason: 'lead.contact_name.updated',
      },
    });
    expect(prisma.webhookEvent.updateMany).toHaveBeenLastCalledWith({
      where: { providerEventId: 'evt_6a54b78594f7fc5f9b9c0ea5' },
      data: {
        status: WebhookEventStatus.PROCESSED,
        accountId: 'account-1',
        processedAt: expect.any(Date),
        lastError: null,
      },
    });
  });

  it('clears whatsappContactName when the contact is removed from the SMB agenda', async () => {
    const { service, prisma, chatEvents } = buildService();
    prisma.lead.findUnique.mockResolvedValue({
      id: 'lead-1',
      whatsappContactName: 'CUSTOMER-FULL-NAME',
      whatsappUserId: 'US.13491208655302741918',
      whatsappParentUserId: 'US.11815799212886844830',
      whatsappUsername: '@Joejoe',
    });

    await service.process({
      ...job,
      payload: {
        ...job.payload,
        whatsappSmbAppStateSync: {
          ...job.payload.whatsappSmbAppStateSync,
          stateSync: [
            {
              contact: {
                fullName: 'CUSTOMER-FULL-NAME',
                firstName: 'CUSTOMER-FIRST-NAME',
                phoneNumber: '+393933891708',
                userId: 'US.13491208655302741918',
                parentUserId: 'US.11815799212886844830',
                username: '@Joejoe',
              },
              action: 'remove',
              timestamp: 0,
            },
          ],
        },
      },
    });

    expect(prisma.lead.update).toHaveBeenCalledWith({
      where: { id: 'lead-1' },
      data: {
        whatsappContactName: null,
      },
    });
    expect(chatEvents.publish).toHaveBeenCalledWith({
      type: 'conversation.updated',
      accountId: 'account-1',
      leadId: 'lead-1',
      payload: {
        source: 'whatsapp.smb.app.state.sync',
        providerEventId: 'evt_6a54b78594f7fc5f9b9c0ea5',
        action: 'remove',
        reason: 'lead.contact_name.updated',
      },
    });
  });
});
