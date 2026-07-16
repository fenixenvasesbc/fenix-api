# Mensajería y conversaciones

## Objetivo funcional

Centralizar el historial WhatsApp por lead, aplicar políticas de ventana de conversación, enviar mensajes por YCloud y mantener la SPA actualizada en tiempo real.

## Conversaciones

Una conversación es única por:

```txt
accountId + leadId + channel
```

Actualmente el canal soportado es:

```txt
WHATSAPP
```

## Listar conversaciones

Endpoint:

```http
GET /conversations
```

Filtros:

- `accountId` para `ADMIN`;
- `limit`;
- `before`;
- `search`;
- `onlyOpen`;
- `onlyPending`;
- `label`.

Reglas:

- `SALES` solo puede consultar su cuenta.
- El buscador considera nombre de agenda, nickname, perfil, nombre legacy, teléfono, email y username.
- El resultado incluye el lead con `displayName`.

## Detalle de conversación

Endpoint:

```http
GET /conversations/:leadId
```

Regla:

- Busca la conversación WhatsApp del lead dentro de la cuenta.

## Marcar como leída

Endpoint:

```http
POST /conversations/:leadId/read
```

Efectos:

- `unreadCount = 0`;
- `requiresAttention = false`;
- publica evento `conversation.read`.

## Cerrar conversación

Endpoint:

```http
POST /conversations/:leadId/close
```

Efectos:

- cambia `status` a `CLOSED`;
- setea `closedAt`;
- publica `conversation.closed`.

## Reabrir conversación

Endpoint:

```http
POST /conversations/:leadId/reopen
```

Efectos:

- cambia `status` a `OPEN`;
- limpia `closedAt`;
- recalcula/aplica estado de ventana si corresponde;
- publica `conversation.reopened`.

## Historial de mensajes

Endpoint:

```http
GET /message/lead/:leadId
```

Uso:

- Obtener mensajes paginados de un lead.

## Envío outbound manual

Endpoints:

| Endpoint | Tipo |
|---|---|
| `POST /outbound/template` | Plantilla WhatsApp |
| `POST /outbound/text` | Texto libre |
| `POST /outbound/media` | Imagen/video/documento |

Todos requieren:

- `JwtAuthGuard`;
- roles `ADMIN` o `SALES`;
- `clientRequestId` para idempotencia.

## Idempotencia outbound

El envío manual usa:

```txt
accountId + clientRequestId
```

Regla:

- Si llega el mismo `clientRequestId` con la misma expectativa funcional, se devuelve replay.
- Si llega con datos incompatibles, se evita duplicar envíos.

## Política de ventana WhatsApp 24h

`ChatPolicyService` calcula:

- `lastInboundAt`;
- `customerWindowExpiresAt = lastInboundAt + 24h`;
- `isCustomerWindowOpen`;
- `canSendFreeform`;
- `canSendTemplate`;
- `requiresTemplate`.

Reglas:

| Caso | Resultado |
|---|---|
| Hay inbound dentro de 24h | Se permite texto libre. |
| No hay inbound dentro de 24h | Texto libre rechazado; usar template. |
| Template | Permitido por política actual. |

Mensaje de error para texto fuera de ventana:

```txt
Cannot send freeform message outside the 24-hour customer service window. Use a template message.
```

## Efectos de un outbound aceptado

Cuando YCloud acepta un outbound:

1. Se crea/actualiza `Message`.
2. Se setea `status = ACCEPTED`.
3. Se guarda `ycloudMessageId`, `wamid`, timestamps y payload.
4. Se actualiza conversación con `touchOutbound`.
5. Se actualiza `lastOutboundAt` y `lastMessageAt` del lead.
6. Se publican:
   - `message.created`;
   - `conversation.updated`.

## Efectos de un inbound

Cuando llega un inbound:

1. Se resuelve la cuenta por `wabaId + to`.
2. Se crea/actualiza el lead por `accountId + from`.
3. El lead pasa a `RESPONDED`.
4. Se actualizan:
   - `firstInboundAt` si estaba vacío;
   - `respondedAt` si estaba vacío;
   - `lastInboundAt`;
   - `lastMessageAt`;
   - `preferredLanguage`;
   - `whatsappProfileName`.
5. Se crea/actualiza el `Message`.
6. Se actualiza conversación con `touchInbound`.
7. Se incrementa unread si el mensaje es nuevo.
8. Se marca `requiresAttention = true`.
9. Se publican eventos realtime.

## Revocación/borrado de mensajes

El inbound processor contempla eventos de revocación.

Regla:

- Busca un candidato inbound dentro de una ventana corta de 30 segundos.
- Si encuentra coincidencia, marca el mensaje como eliminado y publica `message.deleted`.

## Iniciar nueva conversacion desde la SPA

Endpoint:

```http
POST /conversations/start
```

Objetivo:

- permitir que la SPA cree/inicie una conversacion estilo WhatsApp a partir de un telefono;
- buscar o crear el lead de forma segura;
- respetar la ventana de conversacion de WhatsApp;
- enviar plantilla cuando el contacto esta fuera de la ventana de 24h.

Payload:

```json
{
  "accountId": "uuid-opcional-para-admin",
  "countryCode": "34",
  "phoneNumber": "612345678",
  "name": "Cliente opcional",
  "templateName": "nombre_template",
  "languageCode": "es_ES",
  "clientRequestId": "uuid"
}
```

Reglas de negocio:

- `SALES` usa siempre su propia cuenta.
- `ADMIN` debe enviar `accountId`.
- El telefono se normaliza a `phoneE164`.
- El lead se asegura por `accountId + phoneE164`.
- Si el lead ya existe, no se sobrescribe su nombre.
- Si el lead no existe, se crea en estado `NEW`.
- Si no hay ventana de 24h abierta, `templateName` es obligatorio.
- El envio de plantilla reutiliza `OutboundService.sendTemplateMessage`, conservando idempotencia, persistencia de mensaje y eventos realtime.
- No se expone la API key de YCloud a la SPA.

## Listado de plantillas WhatsApp para SPA

Endpoint:

```http
GET /outbound/templates
```

Query params:

- `accountId`: requerido para `ADMIN`, implicito para `SALES`;
- `search`: busca por nombre o cuerpo de plantilla;
- `category`: filtra por categoria YCloud;
- `language`: filtra por idioma;
- `status`: por defecto `APPROVED`; acepta `ALL`;
- `limit`: maximo 100;
- `offset`: paginacion.

Reglas de seguridad:

- La SPA nunca consulta YCloud directamente.
- La API obtiene la API key activa de la cuenta desde credenciales internas.
- La API devuelve solo campos necesarios para seleccionar y enviar la plantilla.
- Si la plantilla trae `HEADER` media (`IMAGE`, `VIDEO` o `DOCUMENT`) con URL en los `components` de YCloud, la API lo detecta y lo envia automaticamente como componente del template.
