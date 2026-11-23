import { MessageService } from './message.service';

// Bug reportado por el usuario, 23/nov/2026: "Reenviar al lead" de un
// boceto terminado, cuando la ventana de 24h de WhatsApp esta cerrada, usa
// una plantilla generica ("boceto_jpg2"/"boceto_pdf") con el archivo real
// inyectado como headerMediaOverride -- el lead recibe el archivo correcto,
// pero getLeadMessages() armaba el preview de CUALQUIER mensaje TEMPLATE a
// partir del payload de GlobalWhatsappTemplate (el "ejemplo" generico que
// Meta guarda al aprobar la plantilla), igual para todos los mensajes de
// esa plantilla -- la bandeja de Fenix mostraba siempre la misma imagen,
// sin importar que boceto se hubiera reenviado en realidad.
// OutboundService.sendTemplateMessage() ahora guarda el archivo real
// (mediaUrl/fileName) en el propio Message cuando hubo headerMediaOverride;
// estos tests cubren que getLeadMessages() lo use para pisar el header
// generico por el real (y que sin ese archivo real, el comportamiento
// previo -- mostrar el ejemplo de la plantilla -- no cambie).
describe('MessageService.getLeadMessages', () => {
  const prisma = {
    lead: { findFirst: jest.fn() },
    conversation: { findUnique: jest.fn() },
    message: { findFirst: jest.fn(), findMany: jest.fn() },
    globalWhatsappTemplate: { findMany: jest.fn() },
  };

  const service = new MessageService(prisma as never);

  const leadId = '11111111-1111-4111-8111-111111111111';
  const accountId = '22222222-2222-4222-8222-222222222222';

  const genericTemplatePayload = [
    {
      type: 'HEADER',
      format: 'IMAGE',
      example: { header_url: ['https://example.com/plantilla-ejemplo.jpg'] },
    },
    { type: 'BODY', text: 'Tu boceto esta listo' },
  ];

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.lead.findFirst.mockResolvedValue({
      id: leadId,
      name: 'Lead de prueba',
      manualName: null,
      ycloudNickname: null,
      whatsappContactName: null,
      whatsappProfileName: null,
      phoneE164: '+5491100000000',
    });
    prisma.conversation.findUnique.mockResolvedValue({
      id: 'conversation-id',
      channel: 'WHATSAPP',
      status: 'OPEN',
      lastMessageId: null,
      lastInboundMessageId: null,
      lastOutboundMessageId: null,
      lastMessageAt: new Date(),
      lastInboundAt: null,
      lastOutboundAt: new Date(),
      customerWindowExpiresAt: null,
      isCustomerWindowOpen: false,
      requiresAttention: false,
      unreadCount: 0,
      assignedUserId: null,
      assignedAt: null,
      closedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    prisma.globalWhatsappTemplate.findMany.mockResolvedValue([
      { name: 'boceto_jpg2', language: 'es_ES', payload: genericTemplatePayload },
    ]);
  });

  function templateMessage(overrides: Partial<Record<string, unknown>> = {}) {
    return {
      id: 'message-1',
      accountId,
      leadId,
      direction: 'OUTBOUND',
      type: 'TEMPLATE',
      status: 'ACCEPTED',
      templateName: 'boceto_jpg2',
      templateLang: 'es_ES',
      mediaUrl: null,
      caption: null,
      mimeType: null,
      fileName: null,
      rawPayload: { source: 'outbound-message-service' },
      occurredAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
      ...overrides,
    };
  }

  it('usa el archivo real reenviado (mediaUrl del Message) en vez del ejemplo generico de la plantilla', async () => {
    prisma.message.findMany.mockResolvedValue([
      templateMessage({
        id: 'message-boceto-vasos',
        mediaUrl: 'https://media.fenix/boceto-vasos.jpg',
        fileName: 'boceto-vasos.jpg',
      }),
    ]);

    const result = await service.getLeadMessages({ accountId, leadId, limit: 50 });

    const header = (result.messages[0].templatePayload as any[]).find(
      (c) => c.type === 'HEADER',
    );
    expect(header.example.header_url).toEqual(['https://media.fenix/boceto-vasos.jpg']);
  });

  it('dos bocetos distintos reenviados por la MISMA plantilla muestran cada uno su propia imagen, no siempre la misma', async () => {
    // El Prisma real ordena por occurredAt DESC (ver orderBy en
    // getLeadMessages, mas reciente primero) y el servicio hace .reverse()
    // antes de devolver los mensajes (mas viejo primero, como en un chat) --
    // se mockea en ese mismo orden (bolsas, el mas nuevo, primero) para que
    // el resultado final quede vasos -> bolsas, igual que en la app real.
    prisma.message.findMany.mockResolvedValue([
      templateMessage({
        id: 'message-boceto-bolsas',
        mediaUrl: 'https://media.fenix/boceto-bolsas.jpg',
        occurredAt: new Date('2026-11-23T11:00:00Z'),
      }),
      templateMessage({
        id: 'message-boceto-vasos',
        mediaUrl: 'https://media.fenix/boceto-vasos.jpg',
        occurredAt: new Date('2026-11-23T10:00:00Z'),
      }),
    ]);

    const result = await service.getLeadMessages({ accountId, leadId, limit: 50 });

    const headerUrls = result.messages.map((message) => {
      const header = (message.templatePayload as any[]).find((c) => c.type === 'HEADER');
      return header.example.header_url[0];
    });

    expect(headerUrls).toEqual([
      'https://media.fenix/boceto-vasos.jpg',
      'https://media.fenix/boceto-bolsas.jpg',
    ]);
  });

  it('sin archivo real propio (plantilla sin reenvio de boceto) sigue mostrando el ejemplo generico, como antes', async () => {
    prisma.message.findMany.mockResolvedValue([templateMessage()]);

    const result = await service.getLeadMessages({ accountId, leadId, limit: 50 });

    const header = (result.messages[0].templatePayload as any[]).find(
      (c) => c.type === 'HEADER',
    );
    expect(header.example.header_url).toEqual(['https://example.com/plantilla-ejemplo.jpg']);
  });

  it('no toca el header de una plantilla de solo texto', async () => {
    prisma.globalWhatsappTemplate.findMany.mockResolvedValue([
      {
        name: 'texto_simple',
        language: 'es_ES',
        payload: [
          { type: 'HEADER', format: 'TEXT', text: 'Hola' },
          { type: 'BODY', text: 'Mensaje de texto' },
        ],
      },
    ]);
    prisma.message.findMany.mockResolvedValue([
      templateMessage({
        templateName: 'texto_simple',
        mediaUrl: 'https://media.fenix/no-deberia-usarse.jpg',
      }),
    ]);

    const result = await service.getLeadMessages({ accountId, leadId, limit: 50 });

    const header = (result.messages[0].templatePayload as any[]).find(
      (c) => c.type === 'HEADER',
    );
    expect(header).toEqual({ type: 'HEADER', format: 'TEXT', text: 'Hola' });
  });
});
