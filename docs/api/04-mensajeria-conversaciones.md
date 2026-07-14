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

