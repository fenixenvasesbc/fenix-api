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
  const ycloud = {
    sendTextMessage: jest.fn(),
    sendTemplateMessage: jest.fn(),
    listWhatsappTemplates: jest.fn(),
  };
  const conversations = { touchOutbound: jest.fn() };
  const policy = { assertCanSendText: jest.fn(), assertCanSendTemplate: jest.fn() };
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

// Bug reportado por el usuario, 23/nov/2026: "Reenviar al lead" (boceto
// terminado) con la ventana de 24h cerrada manda el archivo real como
// headerMediaOverride, pero WhatsApp SI lo recibia bien mientras la
// bandeja de Fenix siempre mostraba la misma imagen -- ver
// applyHeaderMediaOverride() en message.service.ts, que depende de que
// este archivo real quede guardado en el propio Message (mediaUrl/
// fileName), no solo mandado a YCloud.
describe('OutboundService.sendTemplateMessage con headerMediaOverride', () => {
  const prisma = {
    message: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    lead: { findFirst: jest.fn() },
    account: { findUnique: jest.fn() },
  };
  const ycloud = {
    sendTemplateMessage: jest.fn(),
    listWhatsappTemplates: jest.fn(),
  };
  const conversations = { touchOutbound: jest.fn() };
  const policy = { assertCanSendTemplate: jest.fn() };
  const events = { publish: jest.fn() };

  const service = new OutboundService(
    prisma as never,
    ycloud as never,
    conversations as never,
    policy as never,
    events as never,
  );

  const leadId = '11111111-1111-4111-8111-111111111111';
  const accountId = '22222222-2222-4222-8222-222222222222';

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.lead.findFirst.mockResolvedValue({
      id: leadId,
      phoneE164: '+5491100000000',
      preferredLanguage: 'es_ES',
    });
    prisma.account.findUnique.mockResolvedValue({
      id: accountId,
      phoneE164: '+5491199999999',
    });
    prisma.message.findUnique.mockResolvedValue(null);
    prisma.message.create.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
      Promise.resolve({ id: 'message-id', createdAt: new Date(), ...data }),
    );
    prisma.message.update.mockResolvedValue({
      id: 'message-id',
      createdAt: new Date(),
      providerCreateTime: new Date(),
    });
    conversations.touchOutbound.mockResolvedValue({ id: 'conversation-id' });
    ycloud.listWhatsappTemplates.mockResolvedValue([
      {
        name: 'boceto_jpg2',
        language: 'es_ES',
        components: [{ type: 'HEADER', format: 'IMAGE', example: { header_url: ['https://example.com/plantilla-ejemplo.jpg'] } }],
      },
    ]);
    ycloud.sendTemplateMessage.mockResolvedValue({ id: 'wamid-1', createTime: new Date().toISOString() });
  });

  it('guarda el archivo real (mediaUrl/fileName) en el Message, no el de ejemplo de la plantilla', async () => {
    await service.sendTemplateMessage({
      accountId,
      leadId,
      clientRequestId: 'design_request_forward_template:attachment-1',
      templateName: 'boceto_jpg2',
      headerMediaOverride: { url: 'https://media.fenix/attachment-1.jpg', fileName: 'boceto-vasos.jpg' },
    });

    expect(prisma.message.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          mediaUrl: 'https://media.fenix/attachment-1.jpg',
          fileName: 'boceto-vasos.jpg',
        }),
      }),
    );

    // Y WhatsApp si recibe el archivo real (comportamiento previo, sin
    // regresion): el header enviado usa el link del override.
    expect(ycloud.sendTemplateMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        components: [
          expect.objectContaining({
            parameters: [expect.objectContaining({ image: { link: 'https://media.fenix/attachment-1.jpg' } })],
          }),
        ],
      }),
    );
  });

  it('sin headerMediaOverride (plantilla normal) no guarda mediaUrl en el Message', async () => {
    await service.sendTemplateMessage({
      accountId,
      leadId,
      clientRequestId: 'campaign:some-id',
      templateName: 'boceto_jpg2',
    });

    expect(prisma.message.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.not.objectContaining({ mediaUrl: expect.anything() }),
      }),
    );
  });

  it('un reintento con el MISMO clientRequestId y el MISMO archivo es un replay idempotente, no un conflicto', async () => {
    prisma.message.findUnique.mockResolvedValue({
      id: 'message-id',
      leadId,
      type: MessageType.TEMPLATE,
      status: MessageStatus.ACCEPTED,
      externalId: 'wamid-1',
      textBody: null,
      templateName: 'boceto_jpg2',
      templateLang: 'es_ES',
      mediaUrl: 'https://media.fenix/attachment-1.jpg',
      caption: null,
      fileName: 'boceto-vasos.jpg',
    });

    const response = await service.sendTemplateMessage({
      accountId,
      leadId,
      clientRequestId: 'design_request_forward_template:attachment-1',
      templateName: 'boceto_jpg2',
      headerMediaOverride: { url: 'https://media.fenix/attachment-1.jpg', fileName: 'boceto-vasos.jpg' },
    });

    expect(response).toMatchObject({ idempotentReplay: true });
    expect(ycloud.sendTemplateMessage).not.toHaveBeenCalled();
  });

  it('un reintento con el MISMO clientRequestId pero OTRO archivo rechaza en vez de reusar el anterior', async () => {
    prisma.message.findUnique.mockResolvedValue({
      id: 'message-id',
      leadId,
      type: MessageType.TEMPLATE,
      status: MessageStatus.ACCEPTED,
      externalId: 'wamid-1',
      textBody: null,
      templateName: 'boceto_jpg2',
      templateLang: 'es_ES',
      mediaUrl: 'https://media.fenix/attachment-1.jpg',
      caption: null,
      fileName: 'boceto-vasos.jpg',
    });

    await expect(
      service.sendTemplateMessage({
        accountId,
        leadId,
        clientRequestId: 'design_request_forward_template:attachment-1',
        templateName: 'boceto_jpg2',
        headerMediaOverride: { url: 'https://media.fenix/attachment-2-OTRO.jpg', fileName: 'boceto-bolsas.jpg' },
      }),
    ).rejects.toThrow();

    expect(ycloud.sendTemplateMessage).not.toHaveBeenCalled();
  });
});
