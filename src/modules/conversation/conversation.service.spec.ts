import { NotFoundException } from '@nestjs/common';
import { ConversationService } from './conversation.service';

describe('ConversationService pagination', () => {
  const prisma = {
    conversation: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
    },
  };
  const service = new ConversationService(prisma as never);

  beforeEach(() => jest.clearAllMocks());

  it('returns a stable cursor and removes the extra row', async () => {
    const cursorDate = new Date('2026-06-24T10:00:00.000Z');
    const lead = {
      ycloudNickname: null,
      whatsappProfileName: 'Cliente',
      name: null,
      phoneE164: '+34600000000',
    };
    prisma.conversation.findFirst.mockResolvedValue({
      id: '33333333-3333-4333-8333-333333333333',
      lastMessageAt: cursorDate,
    });
    prisma.conversation.findMany.mockResolvedValue([
      { id: 'conversation-1', lead },
      { id: 'conversation-2', lead },
      { id: 'conversation-3', lead },
    ]);

    const result = await service.listByAccount({
      accountId: '11111111-1111-4111-8111-111111111111',
      limit: 2,
      beforeConversationId: '33333333-3333-4333-8333-333333333333',
    });

    expect(result).toEqual({
      data: [
        {
          id: 'conversation-1',
          lead: {
            ...lead,
            displayName: 'Cliente',
            displayNameSource: 'WHATSAPP_PROFILE',
          },
        },
        {
          id: 'conversation-2',
          lead: {
            ...lead,
            displayName: 'Cliente',
            displayNameSource: 'WHATSAPP_PROFILE',
          },
        },
      ],
      pageInfo: { hasMore: true, nextBefore: 'conversation-2' },
    });
    expect(prisma.conversation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 3,
        orderBy: [
          { lastMessageAt: { sort: 'desc', nulls: 'last' } },
          { id: 'desc' },
        ],
      }),
    );
  });

  it('rejects a cursor that does not belong to the account', async () => {
    prisma.conversation.findFirst.mockResolvedValue(null);

    await expect(
      service.listByAccount({
        accountId: '11111111-1111-4111-8111-111111111111',
        limit: 50,
        beforeConversationId: '33333333-3333-4333-8333-333333333333',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(prisma.conversation.findMany).not.toHaveBeenCalled();
  });
});

describe('ConversationService touchOutboundTx', () => {
  const makeTx = (existing: Record<string, unknown> | null) => ({
    conversation: {
      findUnique: jest.fn().mockResolvedValue(existing),
      findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'conversation-1' }),
      create: jest.fn().mockResolvedValue({ id: 'conversation-1' }),
      update: jest.fn().mockResolvedValue({ id: 'conversation-1' }),
    },
    lead: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  });
  const service = new ConversationService({} as never);
  const base = {
    accountId: 'account-1',
    leadId: 'lead-1',
    messageId: 'message-1',
  };

  it('a new outbound reopens the conversation and clears unread/attention', async () => {
    const tx = makeTx({
      id: 'conversation-1',
      lastMessageAt: new Date('2026-11-18T10:00:00.000Z'),
      lastOutboundAt: new Date('2026-11-18T09:00:00.000Z'),
      customerWindowExpiresAt: null,
    });

    await service.touchOutboundTx(tx as never, {
      ...base,
      outboundAt: new Date('2026-11-18T11:00:00.000Z'),
    });

    expect(tx.conversation.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          requiresAttention: false,
          unreadCount: 0,
          lastMessageId: 'message-1',
          lastOutboundMessageId: 'message-1',
        }),
      }),
    );
  });

  it('a late (older) outbound does not clear unread/attention nor move lastMessage', async () => {
    const tx = makeTx({
      id: 'conversation-1',
      // El cliente respondió a las 14:00…
      lastMessageAt: new Date('2026-11-18T14:00:00.000Z'),
      lastOutboundAt: new Date('2026-11-18T12:00:00.000Z'),
      customerWindowExpiresAt: null,
    });

    // …y la plantilla de las 13:06 se reconstruye después.
    await service.touchOutboundTx(tx as never, {
      ...base,
      outboundAt: new Date('2026-11-18T13:06:55.000Z'),
    });

    const data = tx.conversation.update.mock.calls[0][0].data;
    expect(data).toEqual({
      lastOutboundMessageId: 'message-1',
      lastOutboundAt: new Date('2026-11-18T13:06:55.000Z'),
    });
    // Las fechas del lead solo avanzan (updateMany con condición "lt").
    expect(tx.lead.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [
            { lastMessageAt: null },
            { lastMessageAt: { lt: new Date('2026-11-18T13:06:55.000Z') } },
          ],
        }),
      }),
    );
  });

  it('an outbound older than both lastMessage and lastOutbound leaves the conversation untouched', async () => {
    const tx = makeTx({
      id: 'conversation-1',
      lastMessageAt: new Date('2026-11-18T14:00:00.000Z'),
      lastOutboundAt: new Date('2026-11-18T13:30:00.000Z'),
      customerWindowExpiresAt: null,
    });

    await service.touchOutboundTx(tx as never, {
      ...base,
      outboundAt: new Date('2026-11-18T13:06:55.000Z'),
    });

    expect(tx.conversation.update).not.toHaveBeenCalled();
    expect(tx.conversation.findUniqueOrThrow).toHaveBeenCalled();
  });
});
