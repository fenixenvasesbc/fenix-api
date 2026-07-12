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
