import { ChatEventsService } from './chat-events.service';

describe('ChatEventsService', () => {
  const rabbit = { publish: jest.fn() };
  const prisma = {
    message: { findUnique: jest.fn() },
    conversation: { findUnique: jest.fn() },
  };
  let service: ChatEventsService;

  beforeEach(() => {
    jest.clearAllMocks();
    rabbit.publish.mockResolvedValue(undefined);
    service = new ChatEventsService(rabbit as never, prisma as never);
  });

  it('enriches message.created with message and conversation snapshots', async () => {
    prisma.message.findUnique.mockResolvedValue({
      id: 'message-id',
      leadId: 'lead-id',
      textBody: 'Hola',
    });
    prisma.conversation.findUnique.mockResolvedValue({
      id: 'conversation-id',
      leadId: 'lead-id',
      lead: { id: 'lead-id' },
    });

    await service.publish({
      type: 'message.created',
      accountId: 'account-id',
      leadId: 'lead-id',
      conversationId: 'conversation-id',
      messageId: 'message-id',
      payload: { direction: 'INBOUND' },
    });

    expect(rabbit.publish).toHaveBeenCalledWith(
      'chat.events',
      expect.objectContaining({
        type: 'message.created',
        payload: expect.objectContaining({
          direction: 'INBOUND',
          message: expect.objectContaining({ id: 'message-id' }),
          conversation: expect.objectContaining({ id: 'conversation-id' }),
        }),
      }),
    );
  });
});
