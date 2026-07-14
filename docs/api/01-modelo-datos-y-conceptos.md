# Modelo de datos y conceptos centrales

## Entidades principales

### User

Representa un usuario autenticable.

Roles:

| Role | Descripción |
|---|---|
| `ADMIN` | Administración global. Puede gestionar cuentas y usuarios. |
| `SALES` | Comercial. Normalmente asociado a una sola cuenta. |
| `FACTORY` | Usuario de fábrica, usado para módulo de clichés. |

Reglas:

- Un usuario `SALES` puede tener como máximo una cuenta asociada por `accountId`.
- Los endpoints protegidos filtran acceso según rol.

### Account

Representa una cuenta comercial/canal WhatsApp.

Campos clave:

| Campo | Uso |
|---|---|
| `wabaId` | ID de WhatsApp Business Account en YCloud/Meta. |
| `phoneE164` | Número WhatsApp de la empresa. |
| `name` | Nombre interno de la cuenta. |

Regla de unicidad:

- Una cuenta se identifica por `wabaId + phoneE164`.

### Lead

Representa un cliente/contacto dentro de una cuenta.

Identidad:

- `accountId + phoneE164` es único.

Campos funcionales:

| Campo | Descripción |
|---|---|
| `status` | Estado base del lead: `NEW` o `RESPONDED`. |
| `currentLabel` | Label operativo/comercial actual. |
| `preferredLanguage` | Idioma preferido/resuelto para plantillas. |
| `firstOutboundAt` | Fecha del primer outbound aceptado. |
| `firstInboundAt` | Fecha del primer inbound. |
| `respondedAt` | Fecha de primera respuesta. |
| `lastInboundAt` | Último inbound. |
| `lastOutboundAt` | Último outbound. |
| `lastMessageAt` | Última actividad de mensaje. |

### Message

Representa mensajes inbound/outbound.

Campos relevantes:

| Campo | Descripción |
|---|---|
| `direction` | `INBOUND` u `OUTBOUND`. |
| `type` | `TEMPLATE`, `TEXT`, `IMAGE`, `AUDIO`, `VIDEO`, `DOCUMENT`, `UNKNOWN`. |
| `status` | `UNKNOWN`, `ACCEPTED`, `SENT`, `DELIVERED`, `READ`, `FAILED`. |
| `ycloudMessageId` | ID interno YCloud. |
| `wamid` | ID WhatsApp. |
| `externalId` | ID enviado a YCloud para correlación/idempotencia. |
| `clientRequestId` | Idempotencia para envíos manuales desde SPA. |
| `templateName` | Nombre de plantilla outbound. |
| `templateLang` | Idioma usado al enviar plantilla. |
| `rawPayload` | Payload original del proveedor o request. |

### Conversation

Estado agregado de una conversación WhatsApp por `accountId + leadId`.

Campos:

| Campo | Uso |
|---|---|
| `status` | `OPEN`, `CLOSED`, `ARCHIVED`. |
| `lastMessageId` | Último mensaje relevante. |
| `lastInboundMessageId` | Último mensaje inbound. |
| `lastOutboundMessageId` | Último outbound. |
| `requiresAttention` | Si la conversación requiere atención comercial. |
| `unreadCount` | Contador de no leídos. |
| `customerWindowExpiresAt` | Fin de ventana WhatsApp 24h. |
| `isCustomerWindowOpen` | Indicador calculado/persistido. |

### WebhookEvent

Inbox/auditoría de webhooks.

Estados:

| Estado | Significado |
|---|---|
| `PENDING` | Evento guardado pendiente de procesamiento. |
| `PROCESSING` | Worker procesando. |
| `PROCESSED` | Procesado correctamente. |
| `FAILED` | Falló, puede reintentarse. |
| `DEAD` | Agotó retries o se envió a dead-letter. |

### CampaignDefinition

Definición global de una campaña por tipo e idioma.

Tipos:

| Tipo | Uso |
|---|---|
| `FIRST_CONTACT` | Plantillas de primer contacto. |
| `WEEK1_REENGAGEMENT` | Reenganche automático de leads nuevos sin respuesta. |
| `REPETITION_REMINDER` | Recordatorio automático de repetición. |

### AccountCampaignTemplate

Materialización de una plantilla aprobada para una cuenta específica.

Guarda:

- `officialTemplateId` de YCloud/Meta;
- `wabaId`;
- `name`;
- `language`;
- `status`;
- `payloadSnapshot`;
- `lastSyncedAt`.

Regla:

- Solo se envían campañas si la plantilla por cuenta está `APPROVED` e `isActive = true`.

### LeadCampaign

Instancia de campaña aplicada a un lead.

Usos actuales:

- reenganche;
- recordatorio de repetición.

Evita duplicados con:

- `externalId`;
- `leadId + type + businessWindowKey`.

### LeadRepetitionReminder

Recordatorio de repetición creado cuando un lead entra en label `REPETICIONES`.

Campos:

| Campo | Uso |
|---|---|
| `markedAt` | Cuándo se marcó el lead como repetición. |
| `dueAt` | Cuándo vence el recordatorio. |
| `reminderDays` | Frecuencia calculada/asignada. |
| `sentAt` | Cuándo se envió el recordatorio. |
| `canceledAt` | Cuándo se canceló por cambio de label. |

## Prioridad de nombre visible del lead

La API calcula `displayName` con esta prioridad:

1. `whatsappContactName`
2. `ycloudNickname`
3. `whatsappProfileName`
4. `name`
5. `phoneE164`

También devuelve `displayNameSource`:

| Source | Significado |
|---|---|
| `WHATSAPP_CONTACT` | Nombre guardado en agenda WhatsApp Business. |
| `YCLOUD_NICKNAME` | Nickname desde YCloud. |
| `WHATSAPP_PROFILE` | Nombre público del perfil WhatsApp. |
| `LEGACY_NAME` | Campo legacy `name`. |
| `PHONE` | Fallback al teléfono. |

Regla importante:

- Los mensajes inbound actualizan `whatsappProfileName`, pero no sobrescriben `whatsappContactName` ni `ycloudNickname`.

## Resolución de idioma

La API resuelve idioma por:

1. `lead.preferredLanguage`, si existe.
2. Prefijo telefónico:

| Prefijo | Idioma |
|---|---|
| `+34` | `es_ES` |
| `+33` | `fr` |
| `+39` | `it` |
| `+49` | `de` |
| `+41` | `en` |

