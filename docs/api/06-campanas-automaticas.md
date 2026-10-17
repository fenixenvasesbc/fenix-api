# Campañas automáticas: reenganche y repetición

## Objetivo funcional

Automatizar comunicaciones comerciales por WhatsApp usando plantillas aprobadas en YCloud, evitando duplicados y respetando reglas por estado/label.

## Modelo común de campañas

Entidades:

| Entidad | Uso |
|---|---|
| `CampaignDefinition` | Definición global por tipo e idioma. |
| `AccountCampaignTemplate` | Plantilla aprobada por cuenta. |
| `LeadCampaign` | Ejecución de campaña para un lead. |

Estados de `LeadCampaign`:

| Estado | Uso |
|---|---|
| `PENDING` | Creada pero no encolada. |
| `ENQUEUED` | Publicada en RabbitMQ. |
| `PROCESSING` | Worker la tomó. |
| `SENT` | Enviada y persistida localmente. |
| `SKIPPED` | Omitida por regla de negocio. |
| `FAILED` | Falló definitivamente. |
| `UNKNOWN` | El provider aceptó, pero falló persistencia post-provider. |

## Resolución de plantilla

Para enviar campaña:

1. Resolver idioma:
   - `lead.preferredLanguage`;
   - fallback por prefijo telefónico.
2. Buscar `CampaignDefinition`:
   - `type`;
   - `language`;
   - `status = ACTIVE`;
   - `isActive = true`.
3. Buscar `AccountCampaignTemplate`:
   - `accountId`;
   - `campaignDefinitionId`;
   - `status = APPROVED`;
   - `isActive = true`.

Si no hay plantilla aprobada, la campaña se marca `SKIPPED` con `TEMPLATE_NOT_FOUND`.

## Reenganche

Tipo:

```txt
WEEK1_REENGAGEMENT
```

Scheduler:

```txt
09:00 Europe/Madrid, lunes a viernes
```

Regla funcional:

- Reenganchar leads `NEW` que recibieron un primer outbound y no han respondido.

Elegibilidad:

- Lead en `status = NEW`.
- Tiene `firstOutboundAt` dentro de la ventana calculada.
- No tiene `firstInboundAt`.
- No tiene `lastInboundAt`.
- No tiene `respondedAt`.
- Tiene `firstOutboundTemplateName`.
- Cuenta/usuario activo según selección actual.

Idempotencia:

```txt
businessWindowKey = WEEK1_REENGAGEMENT:<fecha>
externalId = reengagement:week1:<leadId>:<businessWindowKey>
```

Skip reasons:

| Motivo | Significado |
|---|---|
| `LEAD_WITHOUT_ACCOUNT` | Lead sin cuenta. |
| `LEAD_WITHOUT_LANGUAGE` | No se pudo resolver idioma. |
| `LEAD_STATUS_CHANGED` | Ya no está `NEW`. |
| `LEAD_ALREADY_RESPONDED` | El lead respondió. |
| `TEMPLATE_NOT_FOUND` | No hay plantilla aprobada. |

Después de enviar:

- crea `Message` outbound `TEMPLATE`;
- actualiza `LeadCampaign` a `SENT`;
- setea `Lead.reengagementSentAt`.

## Repetición

Tipo:

```txt
REPETITION_REMINDER
```

Scheduler:

```txt
09:15 Europe/Madrid, lunes a viernes
```

Objetivo:

- Enviar recordatorio automático a leads cuyo ciclo de repetición venció.

Elegibilidad:

- `LeadRepetitionReminder.dueAt <= now`;
- `sentAt IS NULL`;
- `canceledAt IS NULL`;
- lead aún tiene una asignación activa `LeadLabelAssignment.label = REPETICIONES`;
- lead tiene `accountId`.

Idempotencia:

```txt
businessWindowKey = REPETITION_REMINDER:<reminderId>
externalId = repetition:reminder:<reminderId>
```

Esto garantiza que un reminder específico solo genere una campaña.

Regla principal:

- Un ciclo de `REPETICIONES` envía máximo una vez.

Después de enviar:

- crea `Message` outbound `TEMPLATE`;
- actualiza conversación;
- marca `LeadCampaign.status = SENT`;
- marca `LeadRepetitionReminder.sentAt`;
- limpia `Lead.nextRepetitionReminderAt` si coincide con el `dueAt` enviado;
- publica:
  - `message.created`;
  - `conversation.updated`.

Si el lead sigue en `REPETICIONES`:

- no se vuelve a enviar porque el reminder ya tiene `sentAt`.

Si el lead sale y vuelve a entrar a `REPETICIONES`:

- se crea un nuevo reminder;
- se recalcula frecuencia;
- se enviará cuando venza el nuevo `dueAt`.

Skip reasons:

| Motivo | Significado |
|---|---|
| `REMINDER_NOT_FOUND` | No existe el reminder asociado. |
| `REMINDER_ALREADY_SENT` | Ya fue enviado. |
| `REMINDER_CANCELED` | Fue cancelado por cambio de label. |
| `LEAD_WITHOUT_ACCOUNT` | Lead sin cuenta. |
| `LEAD_WITHOUT_LANGUAGE` | No se pudo resolver idioma. |
| `LEAD_LABEL_CHANGED` | Ya no tiene asignación activa `REPETICIONES`. |
| `TEMPLATE_NOT_FOUND` | No hay plantilla aprobada. |

## Sincronización de plantillas de repetición desde YCloud

Script:

```bash
pnpm ycloud:sync-repetition-templates -- --template-name=recordatorio_repeticion
```

Aplicar cambios:

```bash
pnpm ycloud:sync-repetition-templates -- --template-name=recordatorio_repeticion --apply
```

Por cuenta:

```bash
pnpm ycloud:sync-repetition-templates -- --account=<ACCOUNT_UUID> --template-name=recordatorio_repeticion --apply
```

Reglas:

- Consulta `GET /v2/whatsapp/templates`.
- Filtra `items[]` por `name`.
- Crea/actualiza `CampaignDefinition`.
- Crea/actualiza `AccountCampaignTemplate`.
- Guarda `officialTemplateId`, `wabaId`, `language`, `status`, `category`, `qualityRating` y payload.
- Dry-run por defecto.

Nombre recomendado de plantilla:

```txt
recordatorio_repeticion
```

## Reglas de mensajes por etiqueta (LabelMessageRule)

A diferencia de Reenganche y Repetición (arriba), este no es un job dedicado
por caso de uso: es un **catálogo configurable** (ADR-002) y un único job
genérico que lo recorre. Sirve para reglas del tipo "si un lead lleva N días
en esta etiqueta, mándale esta plantilla" sin escribir código ni desplegar
— por ejemplo, el recordatorio de presupuesto (lead que lleva varios días en
una etiqueta de "presupuesto enviado"/"pendiente de confirmar" sin avanzar).
No hay nada hardcodeado por este caso puntual: es una fila más en
`LabelMessageRule`, igual que cualquier otra regla que se cree desde
Configuración → Reglas de mensajes.

Tipo:

```txt
LABEL_RULE
```

### Entidad `LabelMessageRule`

| Campo | Uso |
|---|---|
| `labelCode` | Código de `LeadLabelDefinition` que dispara la regla (de sistema o personalizada). |
| `triggerAfterDays` | Días hábiles que el lead debe llevar con esa etiqueta asignada (sin quitársela) antes de disparar. |
| `templateName` | `name` de un `GlobalWhatsappTemplate` — **no** pasa por `CampaignDefinition`/`AccountCampaignTemplate` (ver ADR-002: se apoya en el sistema de plantillas vigente, no en el viejo que solo usan Reenganche/Repetición). |
| `active` | Si está apagada, el scheduler la ignora por completo. |

Administración: `Configuración → Reglas de mensajes`, solo rol `SUPPORT`
(`GET/POST/PATCH/DELETE /label-message-rules` — a propósito `ADMIN` no está
en la lista de roles de ese controller, aunque `SUPPORT` hereda el resto de
los permisos de `ADMIN`).

### Scheduler

```txt
09:30 Europe/Madrid, todos los días
```

Por cada regla activa:

1. Filtro SQL amplio por días calendario (`assignedAt <= now - triggerAfterDays días`) — superconjunto seguro, nunca excluye un candidato real.
2. Filtro exacto en memoria con `BusinessDaysService` (días hábiles, no calendario).
3. Candidatos: `LeadLabelAssignment` con `label = rule.labelCode`, `removedAt = null`.

Idempotencia (una sola vez por **asignación** de etiqueta, no recurrente):

```txt
businessWindowKey = LABEL_MESSAGE_RULE:<ruleId>:<assignmentId>
externalId = label-rule:<ruleId>:<assignmentId>
```

Si al lead se le quita la etiqueta y se le vuelve a asignar después, es una
`LeadLabelAssignment` nueva → puede volver a disparar la misma regla.

### Resolución de plantilla (distinta a Reenganche/Repetición)

1. Resolver idioma: `lead.preferredLanguage` o fallback por prefijo telefónico.
2. Buscar `GlobalWhatsappTemplate` por `name = rule.templateName` + `language`.
3. Buscar `GlobalWhatsappTemplateAccount` de esa plantilla para la cuenta del lead, exigiendo `status = APPROVED`.

Si no hay plantilla o no está aprobada para esa cuenta, se marca `SKIPPED`.

Skip reasons:

| Motivo | Significado |
|---|---|
| `RULE_NOT_FOUND` | La regla fue borrada entre encolar y despachar. |
| `RULE_INACTIVE` | La regla se desactivó entre encolar y despachar. |
| `LEAD_LABEL_CHANGED` | Al lead ya no le queda esa asignación activa (se la quitaron). |
| `LEAD_WITHOUT_ACCOUNT` | Lead sin cuenta. |
| `LEAD_WITHOUT_LANGUAGE` | No se pudo resolver idioma. |
| `TEMPLATE_NOT_FOUND` | No existe `GlobalWhatsappTemplate` con ese nombre+idioma. |
| `TEMPLATE_NOT_APPROVED` | Existe pero no está `APPROVED` para la cuenta del lead. |

Después de enviar:

- crea `Message` outbound `TEMPLATE` (con `templateName`/`templateLang`);
- actualiza la conversación (`ConversationService.touchOutbound`);
- marca `LeadCampaign.status = SENT`, `targetTemplateName`, `messageId`, `sentAt`;
- publica `message.created` y `conversation.updated` (payload `source: 'label_message_rule'`).

Operación manual (sin esperar al cron de las 9:30):

```bash
npm run label-message-rule:run
```

Corre el mismo código que el cron (`LabelMessageRuleSchedulerService.run()`)
y reporta por consola cuántos `LeadCampaign` nuevos se crearon. **No acepta
una fecha "now" simulada** — para probar con un lead específico hay que
retrasar `LeadLabelAssignment.assignedAt` en la base de datos antes de correr
el script.

## Retries de campañas

Reenganche y repetición usan retries especializados:

| Intento | Cola |
|---|---|
| 1 | Retry 10s |
| 2 | Retry 1m |
| 3 | Retry 10m |
| Después | Dead/failed |

Si YCloud devuelve un error no retryable:

- se marca `FAILED`;
- no se reintenta.

Si YCloud acepta el mensaje pero falla la persistencia local:

- se marca `UNKNOWN`;
- no se reintenta para evitar duplicar envío al cliente.
