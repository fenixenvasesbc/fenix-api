# Chat API Contract

Contrato operativo para el frontend y el equipo que integra el chat de Fenix CRM.

## Convenciones

- Base path: el host de la API actual.
- Autenticacion: todos los endpoints de chat usan `Authorization: Bearer <access_token>`.
- Roles soportados: `ADMIN` y `SALES`.
- `SALES`: el backend usa el `accountId` del token. Si envia otro `accountId`, responde `403`.
- `ADMIN`: debe enviar `accountId` en query o body segun el endpoint.
- `leadId`, `accountId`, `messageId` son UUID.
- `limit` por defecto es `50` y maximo `100`.
- Los endpoints protegidos rechazan campos extra en body/query.
- Query booleans aceptados: `true`, `false`, `1`, `0`.

## Conversation List

Lista conversaciones de una cuenta para construir la bandeja principal del chat.

### Historical Conversation Backfill

Los mensajes anteriores a la creacion del modelo `Conversation` se recuperan con un backfill idempotente. El comando no modifica conversaciones existentes y crea historicos con `unreadCount = 0` y `requiresAttention = false`.

Previsualizacion, sin escrituras:

```bash
node dist/src/scripts/backfill-conversations.js
```

Aplicar para todas las cuentas:

```bash
node dist/src/scripts/backfill-conversations.js --apply
```

Limitar a una cuenta:

```bash
node dist/src/scripts/backfill-conversations.js --account=<accountId>
node dist/src/scripts/backfill-conversations.js --apply --account=<accountId>
```

El comando se puede repetir: la restriccion unica `accountId + leadId + channel` y `skipDuplicates` evitan duplicados.

```http
GET /conversations?accountId=<accountId>&limit=50&before=<conversationId>&search=&onlyOpen=false&onlyPending=false
```

Query params:

| Param         | Tipo    | Requerido    | Notas                                                     |
| ------------- | ------- | ------------ | --------------------------------------------------------- |
| `accountId`   | UUID    | Solo `ADMIN` | `SALES` lo toma del token.                                |
| `limit`       | number  | No           | Default `50`, max `100`.                                  |
| `before`      | UUID    | No           | Cursor para cargar conversaciones mas antiguas.           |
| `search`      | string  | No           | Busca por nombre, telefono, email o username de WhatsApp. |
| `onlyOpen`    | boolean | No           | `true`, `false`, `1` o `0`.                               |
| `onlyPending` | boolean | No           | Filtra conversaciones con `requiresAttention = true`.     |

Response:

```json
{
  "data": [
    {
      "id": "conversation-id",
      "accountId": "account-id",
      "leadId": "lead-id",
      "channel": "WHATSAPP",
      "status": "OPEN",
      "lastMessageId": "message-id",
      "lastInboundMessageId": "message-id",
      "lastOutboundMessageId": "message-id",
      "lastMessageAt": "2026-06-19T10:00:00.000Z",
      "lastInboundAt": "2026-06-19T09:58:00.000Z",
      "lastOutboundAt": "2026-06-19T10:00:00.000Z",
      "customerWindowExpiresAt": "2026-06-20T09:58:00.000Z",
      "isCustomerWindowOpen": true,
      "requiresAttention": false,
      "unreadCount": 0,
      "assignedUserId": null,
      "assignedAt": null,
      "closedAt": null,
      "createdAt": "2026-06-19T09:58:00.000Z",
      "updatedAt": "2026-06-19T10:00:00.000Z",
      "lead": {},
      "lastMessage": {}
    }
  ],
  "pageInfo": {
    "hasMore": true,
    "nextBefore": "oldest-conversation-id-in-this-page"
  }
}
```

Paginacion:

- Primera carga: llamar sin `before`.
- Pagina siguiente: usar `before = pageInfo.nextBefore` con los mismos filtros.
- El orden es estable por `lastMessageAt` e `id`, ambos descendentes.
- Al cambiar cuenta, busqueda o filtros, reiniciar el cursor.
- Un cursor que no pertenece a la cuenta responde `404`.

## Conversation Detail

Obtiene la conversacion agregada por lead.

```http
GET /conversations/:leadId?accountId=<accountId>
```

Response:

```json
{
  "data": {
    "id": "conversation-id",
    "lead": {},
    "lastMessage": {},
    "lastInboundMessage": {},
    "lastOutboundMessage": {}
  }
}
```

Errores:

- `404`: no existe conversacion para ese `leadId` y cuenta.

## Mark Conversation As Read

Limpia no leidos y quita `requiresAttention`.

```http
POST /conversations/:leadId/read?accountId=<accountId>
```

Response:

```json
{
  "data": {
    "id": "conversation-id",
    "unreadCount": 0,
    "requiresAttention": false
  }
}
```

## Close Conversation

Cierra una conversacion resuelta.

```http
POST /conversations/:leadId/close?accountId=<accountId>
```

Response:

```json
{
  "data": {
    "id": "conversation-id",
    "status": "CLOSED",
    "closedAt": "2026-06-19T10:10:00.000Z",
    "unreadCount": 0,
    "requiresAttention": false
  }
}
```

## Reopen Conversation

Reabre una conversacion cerrada.

```http
POST /conversations/:leadId/reopen?accountId=<accountId>
```

Response:

```json
{
  "data": {
    "id": "conversation-id",
    "status": "OPEN",
    "closedAt": null,
    "isCustomerWindowOpen": true
  }
}
```

## Message History

Obtiene el detalle del lead, estado de conversacion y mensajes.

```http
GET /message/lead/:leadId?accountId=<accountId>&limit=50&before=<messageId>
```

Query params:

| Param       | Tipo   | Requerido    | Notas                                     |
| ----------- | ------ | ------------ | ----------------------------------------- |
| `accountId` | UUID   | Solo `ADMIN` | `SALES` lo toma del token.                |
| `limit`     | number | No           | Default `50`, max `100`.                  |
| `before`    | UUID   | No           | Cursor para cargar mensajes mas antiguos. |

Response:

```json
{
  "lead": {
    "id": "lead-id",
    "accountId": "account-id",
    "name": "Cliente",
    "phoneE164": "+34123456789"
  },
  "conversation": {
    "id": "conversation-id",
    "status": "OPEN",
    "customerWindowExpiresAt": "2026-06-20T09:58:00.000Z",
    "isCustomerWindowOpen": true,
    "canSendFreeform": true,
    "requiresAttention": false,
    "unreadCount": 0
  },
  "messages": [
    {
      "id": "message-id",
      "direction": "INBOUND",
      "type": "TEXT",
      "status": "UNKNOWN",
      "textBody": "Hola",
      "mediaUrl": null,
      "caption": null,
      "createdAt": "2026-06-19T09:58:00.000Z"
    }
  ],
  "pageInfo": {
    "hasMore": true,
    "nextBefore": "oldest-message-id-in-this-page"
  }
}
```

Scroll contract:

- Primera carga: llamar sin `before`.
- Al hacer scroll hacia arriba: llamar con `before = pageInfo.nextBefore`.
- El backend devuelve mensajes en orden cronologico ascendente.
- El frontend debe insertar la pagina anterior al inicio del array actual.
- Si `pageInfo.hasMore` es `false`, no hay mas mensajes antiguos.

## Legacy Conversation List

Existe un endpoint anterior que devuelve conversaciones desde el modulo de mensajes:

```http
GET /message/conversations?accountId=<accountId>&limit=50&search=
```

Para nuevas pantallas usar preferentemente `GET /conversations`, porque incluye filtros operativos de bandeja.

## Lead Labels

Cada lead puede tener una sola label activa, usada como estado actual del flujo comercial.

Labels soportadas:

| Label API           | Texto UI sugerido |
| ------------------- | ----------------- |
| `PRODUCCION`        | Produccion        |
| `BOCETO_EN_PROCESO` | Boceto en proceso |
| `PENDIENTE_DE_PAGO` | Pendiente de pago |
| `MUESTRAS`          | Muestras          |
| `REPETICIONES`      | Repeticiones      |
| `BOCETOS_ATRASADOS` | Bocetos atrasados |

Campos relevantes en `Lead`:

```json
{
  "currentLabel": "REPETICIONES",
  "currentLabelChangedAt": "2026-06-21T10:00:00.000Z",
  "repetitionReminderDays": 90,
  "nextRepetitionReminderAt": "2026-09-21T10:00:00.000Z"
}
```

### List Leads

Lista leads de una cuenta y permite filtrar por label.

```http
GET /leads?accountId=<accountId>&label=PRODUCCION&labelChangedOrder=desc&search=&limit=50&before=<leadId>
```

Query params:

| Param               | Tipo           | Requerido    | Notas                                                                 |
| ------------------- | -------------- | ------------ | --------------------------------------------------------------------- |
| `accountId`         | UUID           | Solo `ADMIN` | `SALES` lo toma del token.                                            |
| `label`             | LeadLabel      | No           | Filtra por label actual.                                              |
| `search`            | string         | No           | Busca por nombre, telefono, email o username.                         |
| `limit`             | number         | No           | Default `50`, max `200`.                                              |
| `before`            | UUID           | No           | Cursor para cargar la pagina siguiente.                               |
| `labelChangedOrder` | `asc` o `desc` | No           | Orden por fecha de cambio cuando se filtra por label. Default `desc`. |

Response:

```json
{
  "accountId": "account-id",
  "data": [
    {
      "id": "lead-id",
      "name": "Cliente",
      "phoneE164": "+34123456789",
      "currentLabel": "PRODUCCION",
      "currentLabelChangedAt": "2026-06-21T10:00:00.000Z",
      "repetitionReminderDays": null,
      "nextRepetitionReminderAt": null
    }
  ],
  "pageInfo": {
    "hasMore": true,
    "nextBefore": "last-lead-id-in-page"
  }
}
```

Paginacion:

- Primera carga: llamar sin `before`.
- Pagina siguiente: usar `before = pageInfo.nextBefore`.
- Al cambiar cuenta, label o busqueda, reiniciar el cursor.
- Al filtrar por label, `desc` muestra cambios recientes primero y `asc` los antiguos primero.
- Si `pageInfo.hasMore` es `false`, no hay mas leads para esos filtros.

### Set Lead Label

Cambia la label activa del lead, registra historial y crea/cancela recordatorios de repeticion.

```http
PATCH /leads/:leadId/label?accountId=<accountId>
Content-Type: application/json
```

Body:

```json
{
  "label": "REPETICIONES",
  "reminderDays": 90
}
```

Reglas de `REPETICIONES`:

- Primera vez: usa `90` dias por defecto, salvo `reminderDays` explicito.
- Segunda vez o posteriores: si no se envia `reminderDays`, calcula los dias transcurridos desde la repeticion anterior y lo guarda como nuevo periodo personalizado del lead.
- Si la fecha cae fin de semana, `nextRepetitionReminderAt` se mueve al siguiente lunes.
- Cada ciclo crea un `LeadRepetitionReminder`.
- Al cambiar a cualquier label, se cancelan recordatorios pendientes previos para evitar avisos duplicados o desfasados.

Response:

```json
{
  "lead": {
    "id": "lead-id",
    "currentLabel": "REPETICIONES",
    "repetitionReminderDays": 90,
    "nextRepetitionReminderAt": "2026-09-21T10:00:00.000Z"
  },
  "labelHistoryId": "history-id",
  "repetitionReminderId": "reminder-id",
  "nextRepetitionReminderAt": "2026-09-21T10:00:00.000Z",
  "repetitionReminderDays": 90
}
```

### Lead Label History

```http
GET /leads/:leadId/label-history?accountId=<accountId>
```

Devuelve los ultimos cambios de label del lead.

### Due Repetition Reminders

Endpoint pensado para el job futuro que buscara recordatorios vencidos de lunes a viernes.

```http
GET /leads/repetition-reminders/due?accountId=<accountId>&limit=100
```

Devuelve recordatorios con:

- `dueAt <= now`
- `sentAt = null`
- `canceledAt = null`

### Mark Repetition Reminder Sent

Marca un recordatorio como enviado para que nunca vuelva a notificarse.

```http
POST /leads/repetition-reminders/:reminderId/sent?accountId=<accountId>
```

## Send Text Message

Envia texto libre. Solo permitido si la ventana de atencion de 24h esta abierta.

```http
POST /outbound/text
Content-Type: application/json
```

Body:

```json
{
  "accountId": "account-id",
  "leadId": "lead-id",
  "clientRequestId": "uuid-generado-por-el-cliente",
  "text": "Mensaje"
}
```

Validaciones:

- `leadId`: UUID.
- `clientRequestId`: UUID obligatorio y unico por accion de envio.
- `accountId`: UUID opcional; requerido para `ADMIN`.
- `text`: string no vacio, maximo 4096 caracteres.

Response:

```json
{
  "success": true,
  "messageId": "message-id",
  "externalId": "external-id",
  "status": "ACCEPTED",
  "idempotentReplay": false
}
```

Idempotencia:

- La SPA genera un UUID antes del primer intento y conserva el mismo valor en todos sus reintentos.
- Si la API ya proceso ese UUID para el mismo mensaje, devuelve el registro existente con `idempotentReplay: true` sin volver a llamar a YCloud.
- Reutilizar el UUID con otro lead, tipo o contenido responde `409`.
- Para una accion nueva siempre se debe generar un UUID nuevo.

Errores:

- `400`: texto vacio o fuera de ventana 24h.
- `403`: `accountId` invalido para el usuario.
- `404`: lead o account no existe.

## Send Template Message

Envia template. Se usa especialmente cuando la ventana de 24h esta cerrada.

```http
POST /outbound/template
Content-Type: application/json
```

Body:

```json
{
  "accountId": "account-id",
  "leadId": "lead-id",
  "clientRequestId": "uuid-generado-por-el-cliente",
  "templateName": "template_name",
  "languageCode": "es_ES"
}
```

`languageCode` es opcional; si no se envia, el backend usa idioma preferido del lead o `es_ES`.

Validaciones:

- `leadId`: UUID.
- `clientRequestId`: UUID obligatorio; aplica el mismo contrato de idempotencia del envio de texto.
- `accountId`: UUID opcional; requerido para `ADMIN`.
- `templateName`: string no vacio, maximo 512 caracteres.
- `languageCode`: string opcional, maximo 20 caracteres.

## Upload Media

Sube un archivo a YCloud para obtener URL usable en mensajes de media.

```http
POST /media/upload
Content-Type: multipart/form-data
```

Form field:

| Field  | Tipo   | Notas         |
| ------ | ------ | ------------- |
| `file` | binary | Maximo 16 MB. |

Response: depende de YCloud, debe incluir la informacion necesaria para usar la URL en `/outbound/media`.

## Send Media Message

Envia imagen o documento. Requiere ventana 24h abierta.

```http
POST /outbound/media
Content-Type: application/json
```

Body imagen:

```json
{
  "accountId": "account-id",
  "leadId": "lead-id",
  "clientRequestId": "uuid-generado-por-el-cliente",
  "type": "image",
  "mediaUrl": "https://...",
  "caption": "Opcional"
}
```

Body documento:

```json
{
  "accountId": "account-id",
  "leadId": "lead-id",
  "clientRequestId": "uuid-generado-por-el-cliente",
  "type": "document",
  "mediaUrl": "https://...",
  "fileName": "archivo.pdf",
  "caption": "Opcional"
}
```

Validaciones:

- `leadId`: UUID.
- `clientRequestId`: UUID obligatorio; aplica el mismo contrato de idempotencia del envio de texto.
- `accountId`: UUID opcional; requerido para `ADMIN`.
- `type`: `image` o `document`.
- `mediaUrl`: URL absoluta con protocolo, maximo 2048 caracteres.
- `caption`: string opcional, maximo 1024 caracteres.
- `fileName`: requerido para documentos, maximo 255 caracteres.

## Realtime Events

Stream SSE para recibir cambios del chat en tiempo real.

```http
GET /chat/events?accountId=<accountId>
Accept: text/event-stream
Authorization: Bearer <access_token>
```

Notas de autenticacion:

- El endpoint usa JWT igual que el resto de la API.
- `SALES`: no necesita `accountId`; si lo envia debe coincidir con el token.
- `ADMIN`: debe enviar `accountId`.
- `EventSource` nativo del navegador no permite enviar header `Authorization`; usar una libreria tipo `@microsoft/fetch-event-source` o un cliente SSE basado en `fetch`.

Eventos emitidos:

| Event                    | Cuando ocurre                                                                              |
| ------------------------ | ------------------------------------------------------------------------------------------ |
| `message.created`        | Entra un inbound o se acepta un outbound.                                                  |
| `message.deleted`        | WhatsApp/YCloud notifica un revoke y se asocia con un unico mensaje en una ventana segura. |
| `message.status.updated` | Cambia estado provider del mensaje saliente.                                               |
| `conversation.updated`   | Cambia resumen de conversacion por inbound/outbound.                                       |
| `conversation.read`      | Se marca como leida.                                                                       |
| `conversation.closed`    | Se cierra.                                                                                 |
| `conversation.reopened`  | Se reabre.                                                                                 |
| `heartbeat`              | Keep-alive cada 25 segundos.                                                               |

Formato de evento:

```json
{
  "id": "event-id",
  "type": "message.created",
  "accountId": "account-id",
  "leadId": "lead-id",
  "conversationId": "conversation-id",
  "messageId": "message-id",
  "createdAt": "2026-06-19T10:00:00.000Z",
  "payload": {
    "direction": "INBOUND"
  }
}
```

Contrato frontend recomendado:

- Al recibir `message.created`, refrescar `GET /message/lead/:leadId` si la conversacion esta abierta, o actualizar la bandeja si no lo esta.
- Al recibir `message.deleted`, actualizar en memoria el mensaje por `messageId` marcandolo como eliminado; si era el ultimo mensaje, refrescar/parchear la fila de `GET /conversations`.
- Al recibir `message.status.updated`, actualizar el estado del mensaje si esta en memoria.
- Al recibir cualquier evento `conversation.*`, refrescar o parchear la fila de `GET /conversations`.
- Reconectar automaticamente si el stream se corta.

Notas de infraestructura:

- La API mantiene conexiones SSE in-memory.
- Los eventos producidos en workers llegan a la API por RabbitMQ usando:
  - queue default: `chat.events.api`
  - routing key default: `chat.events`
- Si se despliegan varias APIs, este MVP debe evolucionar a fanout/pub-sub por instancia o Redis Pub/Sub.
- En Nginx/NGX Proxy, desactivar buffering para esta ruta y usar timeouts largos.

Ejemplo Nginx:

```nginx
location /chat/events {
  proxy_pass http://api_upstream;
  proxy_http_version 1.1;
  proxy_set_header Connection "";
  proxy_buffering off;
  proxy_cache off;
  proxy_read_timeout 3600s;
  proxy_send_timeout 3600s;
}
```

## Frontend Integration Notes

- Al abrir una conversacion, llamar `GET /message/lead/:leadId` y luego `POST /conversations/:leadId/read`.
- Para bandejas, usar `GET /conversations`.
- Para pendientes, usar `GET /conversations?onlyPending=true`.
- Para abiertas, usar `GET /conversations?onlyOpen=true`.
- Para enviar texto/media, revisar `conversation.canSendFreeform`; si es `false`, mostrar envio por template.
- Despues de enviar un mensaje, el frontend puede refrescar la conversacion o insertar optimistamente el mensaje devuelto cuando se implemente evento realtime.
