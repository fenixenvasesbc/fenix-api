# Arquitectura general

## Vista funcional

La API Fenix CRM es un backend NestJS que coordina:

- usuarios y cuentas comerciales;
- leads y conversaciones WhatsApp;
- envío y recepción de mensajes por YCloud;
- webhooks entrantes de YCloud;
- campañas automáticas;
- métricas comerciales;
- gestión de clichés para fábrica.

La API trabaja con tres componentes principales:

| Componente | Responsabilidad |
|---|---|
| API HTTP | Expone endpoints REST para SPA, webhooks y operaciones administrativas. |
| Worker | Consume RabbitMQ y procesa webhooks, eventos y campañas asíncronas. |
| Scheduler | Ejecuta cron jobs y publica trabajos en RabbitMQ. Actualmente corre en el proceso API. |

## Procesos

### Proceso API

Responsable de:

- autenticar usuarios;
- servir endpoints REST;
- recibir webhooks YCloud y encolarlos;
- publicar eventos realtime de chat;
- ejecutar schedulers:
  - reenganche;
  - repetición.

Módulo principal: `AppModule`.

### Proceso worker

Responsable de:

- consumir colas RabbitMQ;
- procesar webhooks guardados;
- procesar mensajes inbound;
- actualizar estados outbound;
- sincronizar nombres/contactos;
- enviar campañas encoladas.

Módulo principal: `WorkerModule`.

Nota: los schedulers están separados del worker para evitar que el proceso worker registre cron jobs.

## Integraciones externas

| Sistema | Uso |
|---|---|
| YCloud | Envío de mensajes, recepción de webhooks, consulta de contactos, consulta de plantillas. |
| WhatsApp Business | Canal de comunicación final, administrado vía YCloud. |
| RabbitMQ | Procesamiento asíncrono, retries y desacoplamiento entre recepción y procesamiento. |
| PostgreSQL | Persistencia principal mediante Prisma. |

## Patrones de diseño aplicados

### Inbox de webhooks

Los webhooks no se procesan directamente en el request HTTP. El flujo es:

1. `POST /webhooks/ycloud` recibe el payload.
2. Se valida que tenga `id` y `type`.
3. Se publica un job en RabbitMQ.
4. El worker guarda el evento en `WebhookEvent`.
5. Si el evento ya existe, se ignora como duplicado.
6. Se enruta a una cola especializada según `eventType`.

Esto permite:

- responder rápido a YCloud;
- evitar duplicados por `providerEventId`;
- aplicar retries;
- auditar todos los eventos recibidos.

### Workers especializados

Cada tipo de evento complejo tiene su propio worker/servicio:

| Evento | Procesador |
|---|---|
| `whatsapp.inbound_message.received` | `InboundMessageService` |
| `whatsapp.message.updated` | `MessageStatusService` |
| `contact.attributes_changed` | `ContactAttributesService` |
| `whatsapp.smb.app.state.sync` | `SmbStateSyncService` |
| campaña reenganche | `ReengagementDispatchService` |
| campaña repetición | `RepetitionReminderDispatchService` |

### Idempotencia

La API usa varias llaves para evitar duplicados:

- `WebhookEvent.providerEventId` único para webhooks.
- `Message.accountId + ycloudMessageId` único.
- `Message.externalId` único.
- `Lead.accountId + phoneE164` único.
- `LeadCampaign.externalId` único.
- `LeadCampaign.leadId + type + businessWindowKey` único.

## Eventos realtime hacia SPA

La API publica eventos de chat usando RabbitMQ y `ChatEventsService`. Eventos relevantes:

| Evento | Uso |
|---|---|
| `message.created` | Nuevo mensaje visible en conversación. |
| `message.status.updated` | Cambio de estado de mensaje outbound. |
| `message.deleted` | Revocación/borrado de mensaje inbound. |
| `conversation.updated` | Cambios en conversación, lead o último mensaje. |
| `conversation.read` | Conversación marcada como leída. |
| `conversation.closed` | Conversación cerrada. |
| `conversation.reopened` | Conversación reabierta. |

## Separación API vs Worker

Los schedulers viven en módulos importados solo por `AppModule`:

- `ReengagementSchedulerModule`
- `RepetitionReminderSchedulerModule`

El `WorkerModule` importa módulos core/dispatchers, pero no módulos scheduler. Esto evita que un cron se registre dos veces.

