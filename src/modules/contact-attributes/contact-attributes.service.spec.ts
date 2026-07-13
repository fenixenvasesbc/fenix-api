import axios from 'axios';
import { WebhookEventStatus } from '@prisma/client';
import { ContactAttributesService } from './contact-attributes.service';

jest.mock('axios');

const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('ContactAttributesService', () => {
  const credential = {
    accountId: 'account-1',
    apiKeyEncrypted: 'encrypted-key',
  };
  const job = {
    provider: 'ycloud' as const,
    providerEventId: 'evt_1',
    eventType: 'contact.attributes_changed',
    apiVersion: 'v2',
    providerTime: '2024-01-01T12:00:00.000Z',
    receivedAt: '2024-01-01T12:00:01.000Z',
    payload: {
      id: 'evt_1',
      type: 'contact.attributes_changed',
      apiVersion: 'v2',
      createTime: '2024-01-01T12:00:00.000Z',
      contactAttributesChanged: {
        id: '1824266594102064128',
        updateTime: '2024-01-01T12:00:00.000Z',
        changedAttributes: {
          nickname: {
            oldValue: null,
            newValue: '  Cliente Agenda  ',
          },
        },
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
      accountProviderCredential: {
        findMany: jest.fn().mockResolvedValue([credential]),
      },
      lead: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'lead-1',
          whatsappContactName: null,
          ycloudNickname: null,
        }),
        update: jest.fn().mockResolvedValue({ id: 'lead-1' }),
      },
    };
    const cryptoService = {
      decrypt: jest.fn().mockReturnValue('api-key'),
    };

    const service = new ContactAttributesService(
      prisma as never,
      cryptoService as never,
      chatEvents as never,
    );

    return { service, prisma, cryptoService, chatEvents };
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockedAxios.get.mockResolvedValue({
      status: 200,
      data: {
        id: '1824266594102064128',
        phone: '+15551234567',
        nickname: 'Cliente Agenda',
      },
      headers: {},
    });
  });

  it('updates only ycloudNickname when nickname changed and the lead exists', async () => {
    const { service, prisma, chatEvents } = buildService();

    await service.process(job);

    expect(prisma.lead.findUnique).toHaveBeenCalledWith({
      where: {
        accountId_phoneE164: {
          accountId: 'account-1',
          phoneE164: '+15551234567',
        },
      },
      select: {
        id: true,
        whatsappContactName: true,
        ycloudNickname: true,
      },
    });
    expect(prisma.lead.update).toHaveBeenCalledWith({
      where: { id: 'lead-1' },
      data: { ycloudNickname: 'Cliente Agenda' },
    });
    expect(chatEvents.publish).toHaveBeenCalledWith({
      type: 'conversation.updated',
      accountId: 'account-1',
      leadId: 'lead-1',
      payload: {
        source: 'contact.attributes_changed',
        providerEventId: 'evt_1',
        updatedFields: ['ycloudNickname'],
        reason: 'lead.contact_name.updated',
      },
    });
    expect(prisma.webhookEvent.updateMany).toHaveBeenLastCalledWith({
      where: { providerEventId: 'evt_1' },
      data: {
        status: WebhookEventStatus.PROCESSED,
        accountId: 'account-1',
        leadId: 'lead-1',
        processedAt: expect.any(Date),
        lastError: null,
      },
    });
  });

  it('does not overwrite when the nickname newValue is empty', async () => {
    const { service, prisma, chatEvents } = buildService();

    await service.process({
      ...job,
      payload: {
        ...job.payload,
        contactAttributesChanged: {
          ...job.payload.contactAttributesChanged,
          changedAttributes: {
            nickname: {
              oldValue: 'Cliente Agenda',
              newValue: null,
            },
          },
        },
      },
    });

    expect(mockedAxios.get).not.toHaveBeenCalled();
    expect(prisma.lead.update).not.toHaveBeenCalled();
    expect(chatEvents.publish).not.toHaveBeenCalled();
    expect(prisma.webhookEvent.updateMany).toHaveBeenLastCalledWith({
      where: { providerEventId: 'evt_1' },
      data: {
        status: WebhookEventStatus.PROCESSED,
        accountId: null,
        leadId: null,
        processedAt: expect.any(Date),
        lastError: null,
      },
    });
  });

  it('uses phone_number from changedAttributes when present', async () => {
    const { service, prisma } = buildService();

    mockedAxios.get.mockResolvedValue({
      status: 200,
      data: {
        id: '1824266594102064128',
        nickname: 'Cliente Agenda',
      },
      headers: {},
    });

    await service.process({
      ...job,
      payload: {
        ...job.payload,
        contactAttributesChanged: {
          ...job.payload.contactAttributesChanged,
          changedAttributes: {
            nickname: {
              oldValue: null,
              newValue: 'Cliente Agenda',
            },
            phone_number: {
              oldValue: null,
              newValue: '15559876543',
            },
          },
        },
      },
    });

    expect(prisma.lead.findUnique).toHaveBeenCalledWith({
      where: {
        accountId_phoneE164: {
          accountId: 'account-1',
          phoneE164: '+15559876543',
        },
      },
      select: {
        id: true,
        whatsappContactName: true,
        ycloudNickname: true,
      },
    });
  });

  it('processes YCloud nick_name changes', async () => {
    const { service, prisma } = buildService();

    await service.process({
      provider: 'ycloud',
      providerEventId: 'evt_6a549a7356d918596737daaf',
      eventType: 'contact.attributes_changed',
      apiVersion: 'v2',
      providerTime: '2026-07-13T07:57:39.569Z',
      receivedAt: '2026-07-13T07:57:40.000Z',
      payload: {
        id: 'evt_6a549a7356d918596737daaf',
        type: 'contact.attributes_changed',
        apiVersion: 'v2',
        createTime: '2026-07-13T07:57:39.569Z',
        contactAttributesChanged: {
          id: '1867599678302511104',
          updateTime: '2026-07-13T07:57:39.569Z',
          changedAttributes: {
            nick_name: {
              oldValue: 'La colina de MARIA- Jose lead vasos',
              newValue: 'Jose',
              extra: [
                {
                  action: 'CHANGED',
                },
              ],
            },
          },
        },
      },
    });

    expect(mockedAxios.get).toHaveBeenCalledWith(
      expect.stringContaining('/contact/contacts/1867599678302511104'),
      expect.any(Object),
    );
    expect(prisma.lead.update).toHaveBeenCalledWith({
      where: { id: 'lead-1' },
      data: { ycloudNickname: 'Jose' },
    });
  });

  it('processes YCloud remark_name changes as WhatsApp contact name', async () => {
    const { service, prisma } = buildService();

    await service.process({
      provider: 'ycloud',
      providerEventId: 'evt_6a54b785e89b491706f54555',
      eventType: 'contact.attributes_changed',
      apiVersion: 'v2',
      providerTime: '2026-07-13T10:01:41.615Z',
      receivedAt: '2026-07-13T10:01:42.000Z',
      payload: {
        id: 'evt_6a54b785e89b491706f54555',
        type: 'contact.attributes_changed',
        apiVersion: 'v2',
        createTime: '2026-07-13T10:01:41.615Z',
        contactAttributesChanged: {
          id: '1870587874212888576',
          updateTime: '2026-07-13T10:01:41.615Z',
          changedAttributes: {
            remark_name: {
              newValue: 'Giuseppe Frappietri🇮🇹 Lead Vasos',
              extra: [
                {
                  action: 'ADDED',
                },
              ],
            },
          },
        },
      },
    });

    expect(prisma.lead.update).toHaveBeenCalledWith({
      where: { id: 'lead-1' },
      data: { whatsappContactName: 'Giuseppe Frappietri🇮🇹 Lead Vasos' },
    });
  });
});
