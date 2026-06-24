import { ConflictException } from '@nestjs/common';
import { MessageStatus, MessageType } from '@prisma/client';
import { OutboundService } from './outbound.service';

describe('OutboundService idempotency', () => {
  const prisma = {
    message: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    lead: { findFirst: jest.fn() },
    account: { findUnique: jest.fn() },
  };
  const ycloud = { sendTextMessage: jest.fn() };
  const conversations = { touchOutbound: jest.fn() };
  const policy = { assertCanSendText: jest.fn() };
  const events = { publish: jest.fn() };

  const service = new OutboundService(
    prisma as never,
    ycloud as never,
    conversations as never,
    policy as never,
    events as never,
  );

  beforeEach(() => jest.clearAllMocks());

  it('returns the existing message without calling YCloud again', async () => {
    prisma.message.findUnique.mockResolvedValue({
      id: 'message-id',
      leadId: '11111111-1111-4111-8111-111111111111',
      type: MessageType.TEXT,
      status: MessageStatus.ACCEPTED,
      externalId: 'provider-correlation-id',
      textBody: 'Hola',
      templateName: null,
      templateLang: null,
      mediaUrl: null,
      caption: null,
      fileName: null,
    });

    const response = await service.sendTextMessage({
      accountId: '22222222-2222-4222-8222-222222222222',
      leadId: '11111111-1111-4111-8111-111111111111',
      clientRequestId: '33333333-3333-4333-8333-333333333333',
      text: ' Hola ',
    });

    expect(response).toMatchObject({
      messageId: 'message-id',
      status: MessageStatus.ACCEPTED,
      idempotentReplay: true,
    });
    expect(policy.assertCanSendText).not.toHaveBeenCalled();
    expect(ycloud.sendTextMessage).not.toHaveBeenCalled();
    expect(prisma.message.create).not.toHaveBeenCalled();
  });

  it('rejects reuse of a clientRequestId with different content', async () => {
    prisma.message.findUnique.mockResolvedValue({
      id: 'message-id',
      leadId: '11111111-1111-4111-8111-111111111111',
      type: MessageType.TEXT,
      status: MessageStatus.ACCEPTED,
      externalId: 'provider-correlation-id',
      textBody: 'Contenido anterior',
      templateName: null,
      templateLang: null,
      mediaUrl: null,
      caption: null,
      fileName: null,
    });

    await expect(
      service.sendTextMessage({
        accountId: '22222222-2222-4222-8222-222222222222',
        leadId: '11111111-1111-4111-8111-111111111111',
        clientRequestId: '33333333-3333-4333-8333-333333333333',
        text: 'Contenido nuevo',
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(ycloud.sendTextMessage).not.toHaveBeenCalled();
  });
});
