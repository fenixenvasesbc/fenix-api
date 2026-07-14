import { Test, TestingModule } from '@nestjs/testing';
import { MessageStatusService } from './message-status.service';
import { PrismaService } from 'src/prisma/prisma.service';
import { ChatEventsService } from '../chat-events/chat-events.service';
import { ConversationService } from '../conversation/conversation.service';
import { MessageDirection, MessageStatus, MessageType } from '@prisma/client';

describe('MessageStatusService', () => {
  let service: MessageStatusService;
  let prisma: {
    message: { findFirst: jest.Mock };
    account: { findUnique: jest.Mock };
    webhookEvent: { updateMany: jest.Mock };
    $transaction: jest.Mock;
  };
  let tx: {
    lead: { upsert: jest.Mock; update: jest.Mock };
    message: { upsert: jest.Mock; update: jest.Mock };
    messageStatusHistory: { create: jest.Mock };
    leadCampaign: { findFirst: jest.Mock; update: jest.Mock };
    webhookEvent: { updateMany: jest.Mock };
  };
  let chatEvents: { publish: jest.Mock };
  let conversationService: { touchOutboundTx: jest.Mock };

  beforeEach(async () => {
    tx = {
      lead: {
        upsert: jest.fn(),
        update: jest.fn(),
      },
      message: {
        upsert: jest.fn(),
        update: jest.fn(),
      },
      messageStatusHistory: {
        create: jest.fn(),
      },
      leadCampaign: {
        findFirst: jest.fn(),
        update: jest.fn(),
      },
      webhookEvent: {
        updateMany: jest.fn(),
      },
    };

    prisma = {
      message: {
        findFirst: jest.fn(),
      },
      account: {
        findUnique: jest.fn(),
      },
      webhookEvent: {
        updateMany: jest.fn(),
      },
      $transaction: jest.fn((callback) => callback(tx)),
    };

    chatEvents = {
      publish: jest.fn(),
    };

    conversationService = {
      touchOutboundTx: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MessageStatusService,
        {
          provide: PrismaService,
          useValue: prisma,
        },
        {
          provide: ChatEventsService,
          useValue: chatEvents,
        },
        {
          provide: ConversationService,
          useValue: conversationService,
        },
      ],
    }).compile();

    service = module.get<MessageStatusService>(MessageStatusService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('reconstructs a manual outbound message from a whatsapp.message.updated event when no message exists', async () => {
    prisma.message.findFirst.mockResolvedValue(null);
    prisma.account.findUnique.mockResolvedValue({ id: 'account-1' });
    tx.lead.upsert.mockResolvedValue({
      id: 'lead-1',
      firstOutboundAt: new Date('2026-07-03T21:52:25.192Z'),
    });
    tx.message.upsert.mockResolvedValue({ id: 'message-1' });
    conversationService.touchOutboundTx.mockResolvedValue({
      id: 'conversation-1',
    });

    await service.process({
      providerEventId: 'evt_6a484b385d364502a6769efc',
      payload: {
        id: 'evt_6a484b385d364502a6769efc',
        type: 'whatsapp.message.updated',
        apiVersion: 'v2',
        createTime: '2026-07-03T21:52:25.192Z',
        whatsappMessage: {
          id: '6a484b356f5e6c47a872a3b0',
          wamid:
            'wamid.HBgLMzQ2MTQ3OTUyOTgVAgARGBRDRUZCMTZDMTcwODg3NTY3QzU0RAA=',
          status: 'delivered',
          from: '+34645730616',
          to: '+34614795298',
          wabaId: '1846802705910630',
          externalId: '7f80c16b-9764-48f5-9862-5d17777aa77e',
          type: 'TEXT',
          text: {
            body: 'hola',
          },
        },
      },
    } as any);

    expect(prisma.account.findUnique).toHaveBeenCalledWith({
      where: {
        wabaId_phoneE164: {
          wabaId: '1846802705910630',
          phoneE164: '+34645730616',
        },
      },
      select: {
        id: true,
      },
    });

    expect(tx.lead.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          accountId_phoneE164: {
            accountId: 'account-1',
            phoneE164: '+34614795298',
          },
        },
      }),
    );

    expect(tx.message.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          accountId_ycloudMessageId: {
            accountId: 'account-1',
            ycloudMessageId: '6a484b356f5e6c47a872a3b0',
          },
        },
        create: expect.objectContaining({
          accountId: 'account-1',
          leadId: 'lead-1',
          direction: MessageDirection.OUTBOUND,
          type: MessageType.TEXT,
          status: MessageStatus.DELIVERED,
          textBody: 'hola',
        }),
      }),
    );

    expect(tx.webhookEvent.updateMany).toHaveBeenCalledWith({
      where: {
        providerEventId: 'evt_6a484b385d364502a6769efc',
      },
      data: expect.objectContaining({
        status: 'PROCESSED',
        accountId: 'account-1',
        leadId: 'lead-1',
        messageId: 'message-1',
        lastError: null,
      }),
    });

    expect(chatEvents.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'message.created',
        accountId: 'account-1',
        leadId: 'lead-1',
        conversationId: 'conversation-1',
        messageId: 'message-1',
      }),
    );
  });

  it('marks webhook event with account, lead and message when updating an existing message', async () => {
    prisma.message.findFirst.mockResolvedValueOnce({
      id: 'message-1',
      accountId: 'account-1',
      leadId: 'lead-1',
      status: MessageStatus.SENT,
      ycloudMessageId: '6a54b1b6ba9fc44294d16131',
      wamid: null,
      externalId: null,
    });

    await service.process({
      providerEventId: 'evt_existing_message_updated',
      payload: {
        id: 'evt_existing_message_updated',
        type: 'whatsapp.message.updated',
        apiVersion: 'v2',
        createTime: '2026-07-14T08:31:54.320Z',
        whatsappMessage: {
          id: '6a54b1b6ba9fc44294d16131',
          status: 'read',
          from: '+34667980423',
          to: '+393395988835',
          wabaId: '130594500136724',
          type: 'template',
        },
      },
    } as any);

    expect(tx.message.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'message-1' },
        data: expect.objectContaining({
          status: MessageStatus.READ,
        }),
      }),
    );

    expect(tx.webhookEvent.updateMany).toHaveBeenCalledWith({
      where: {
        providerEventId: 'evt_existing_message_updated',
      },
      data: expect.objectContaining({
        status: 'PROCESSED',
        accountId: 'account-1',
        leadId: 'lead-1',
        messageId: 'message-1',
        lastError: null,
      }),
    });

    expect(chatEvents.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'message.status.updated',
        accountId: 'account-1',
        leadId: 'lead-1',
        messageId: 'message-1',
        payload: expect.objectContaining({
          status: MessageStatus.READ,
        }),
      }),
    );
  });
});
