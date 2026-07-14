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
- lead aún tiene `currentLabel = REPETICIONES`;
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
| `LEAD_LABEL_CHANGED` | Ya no está en `REPETICIONES`. |
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

