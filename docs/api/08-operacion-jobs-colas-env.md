# Operación, jobs, colas y variables de entorno

## Procesos esperados

| Proceso | Comando típico | Responsabilidad |
|---|---|---|
| API | `start:prod` o `nest start` | Endpoints HTTP y schedulers. |
| Worker | `start:worker:dev` o entry `worker.main` | Consumir RabbitMQ. |

Regla operativa:

- El proceso API debe estar levantado para que corran los schedulers.
- El proceso worker debe estar levantado para procesar jobs y webhooks.

## RabbitMQ

La API usa:

- exchange principal `RABBITMQ_EXCHANGE`;
- dead-letter exchange `RABBITMQ_DLX_EXCHANGE`;
- colas principales;
- colas retry con TTL.

## Colas generales de webhooks

Variables requeridas:

```env
RABBITMQ_EXCHANGE=
RABBITMQ_DLX_EXCHANGE=

RABBITMQ_QUEUE_MAIN=
RABBITMQ_QUEUE_RETRY_10S=
RABBITMQ_QUEUE_RETRY_1M=
RABBITMQ_QUEUE_RETRY_10M=
RABBITMQ_QUEUE_DEAD=

RABBITMQ_RK_PROCESS=
RABBITMQ_RK_RETRY_10S=
RABBITMQ_RK_RETRY_1M=
RABBITMQ_RK_RETRY_10M=
RABBITMQ_RK_DEAD=
```

## Colas de mensajes

```env
RABBITMQ_QUEUE_INBOUND=
RABBITMQ_QUEUE_MESSAGE_UPDATED=
RABBITMQ_RK_INBOUND=
RABBITMQ_RK_MESSAGE_UPDATED=
```

## Colas de reenganche

```env
RABBITMQ_RK_REENGAGEMENT=lead.reengagement.week1
RABBITMQ_RK_REENGAGEMENT_RETRY_10S=lead.reengagement.retry.10s
RABBITMQ_RK_REENGAGEMENT_RETRY_1M=lead.reengagement.retry.1m
RABBITMQ_RK_REENGAGEMENT_RETRY_10M=lead.reengagement.retry.10m

RABBITMQ_QUEUE_REENGAGEMENT=q_reengagement
RABBITMQ_QUEUE_REENGAGEMENT_RETRY_10S=q_reengagement_retry_10s
RABBITMQ_QUEUE_REENGAGEMENT_RETRY_1M=q_reengagement_retry_1m
RABBITMQ_QUEUE_REENGAGEMENT_RETRY_10M=q_reengagement_retry_10m
```

## Colas de repetición

```env
RABBITMQ_RK_REPETITION_REMINDER=lead.repetition.reminder
RABBITMQ_RK_REPETITION_REMINDER_RETRY_10S=lead.repetition.reminder.retry.10s
RABBITMQ_RK_REPETITION_REMINDER_RETRY_1M=lead.repetition.reminder.retry.1m
RABBITMQ_RK_REPETITION_REMINDER_RETRY_10M=lead.repetition.reminder.retry.10m

RABBITMQ_QUEUE_REPETITION_REMINDER=q_repetition_reminder
RABBITMQ_QUEUE_REPETITION_REMINDER_RETRY_10S=q_repetition_reminder_retry_10s
RABBITMQ_QUEUE_REPETITION_REMINDER_RETRY_1M=q_repetition_reminder_retry_1m
RABBITMQ_QUEUE_REPETITION_REMINDER_RETRY_10M=q_repetition_reminder_retry_10m
```

Opcional:

```env
REPETITION_REMINDER_SCHEDULER_LIMIT=100
```

## Colas de contact attributes

Tienen defaults en código, pero se recomienda declararlas:

```env
RABBITMQ_RK_CONTACT_ATTRIBUTES_CHANGED=ycloud.contact.attributes_changed
RABBITMQ_RK_CONTACT_ATTRIBUTES_RETRY_10S=ycloud.contact.attributes_changed.retry.10s
RABBITMQ_RK_CONTACT_ATTRIBUTES_RETRY_1M=ycloud.contact.attributes_changed.retry.1m
RABBITMQ_RK_CONTACT_ATTRIBUTES_RETRY_10M=ycloud.contact.attributes_changed.retry.10m

RABBITMQ_QUEUE_CONTACT_ATTRIBUTES_CHANGED=ycloud.contact_attributes_changed
RABBITMQ_QUEUE_CONTACT_ATTRIBUTES_RETRY_10S=q_contact_attributes_retry_10s
RABBITMQ_QUEUE_CONTACT_ATTRIBUTES_RETRY_1M=q_contact_attributes_retry_1m
RABBITMQ_QUEUE_CONTACT_ATTRIBUTES_RETRY_10M=q_contact_attributes_retry_10m
```

## Colas SMB state sync

Tienen defaults en código, pero se recomienda declararlas:

```env
RABBITMQ_RK_SMB_STATE_SYNC=whatsapp.smb.app.state.sync
RABBITMQ_RK_SMB_STATE_SYNC_RETRY_10S=whatsapp.smb.app.state.sync.retry.10s
RABBITMQ_RK_SMB_STATE_SYNC_RETRY_1M=whatsapp.smb.app.state.sync.retry.1m
RABBITMQ_RK_SMB_STATE_SYNC_RETRY_10M=whatsapp.smb.app.state.sync.retry.10m

RABBITMQ_QUEUE_SMB_STATE_SYNC=q_smb_state_sync
RABBITMQ_QUEUE_SMB_STATE_SYNC_RETRY_10S=q_smb_state_sync_retry_10s
RABBITMQ_QUEUE_SMB_STATE_SYNC_RETRY_1M=q_smb_state_sync_retry_1m
RABBITMQ_QUEUE_SMB_STATE_SYNC_RETRY_10M=q_smb_state_sync_retry_10m
```

## Chat events

```env
RABBITMQ_RK_CHAT_EVENTS=chat.events
RABBITMQ_QUEUE_CHAT_EVENTS=chat.events.api
```

## YCloud

```env
YCLOUD_BASE_URL=https://api.ycloud.com/v2
CREDENTIAL_ENCRYPTION_KEY=
```

Reglas:

- Las API keys YCloud se guardan cifradas en `AccountProviderCredential`.
- Los scripts y servicios resuelven la key por `accountId`.

## Scripts operativos

### Backfill de nombres

Dry-run:

```bash
pnpm ycloud:backfill-lead-names -- --account=<ACCOUNT_UUID> --delay-ms=250
```

Apply:

```bash
pnpm ycloud:backfill-lead-names -- --account=<ACCOUNT_UUID> --delay-ms=250 --apply
```

### Sincronizar plantillas de repetición

Dry-run:

```bash
pnpm ycloud:sync-repetition-templates -- --template-name=recordatorio_repeticion
```

Apply:

```bash
pnpm ycloud:sync-repetition-templates -- --template-name=recordatorio_repeticion --apply
```

Docker:

```bash
docker compose exec api pnpm ycloud:sync-repetition-templates -- --template-name=recordatorio_repeticion --apply
```

## Validaciones recomendadas antes de despliegue

```bash
pnpm prisma validate
pnpm prisma generate
pnpm exec tsc --noEmit --pretty false
pnpm run build
```

## Checklist de despliegue para campañas

1. Aplicar migraciones.
2. Confirmar `.env` con colas nuevas.
3. Reiniciar API.
4. Reiniciar worker.
5. Verificar que RabbitMQ creó colas.
6. Verificar plantillas `APPROVED` en `AccountCampaignTemplate`.
7. Revisar logs del scheduler a las 09:00 y 09:15 Europe/Madrid.

## Alertas por labels

El scheduler de notificaciones corre en el proceso API a las 07:00 Europe/Madrid.

Variables opcionales:

```env
NOTIFICATION_LABEL_ALERT_MUESTRAS_DAYS=7
NOTIFICATION_LABEL_ALERT_BOCETO_EN_PROCESO_DAYS=4
NOTIFICATION_LABEL_ALERT_PENDIENTE_DE_PAGO_DAYS=7
NOTIFICATION_LABEL_ALERT_PRODUCCION_DAYS=14
NOTIFICATION_LABEL_ALERT_BOCETOS_ATRASADOS_DAYS=2
NOTIFICATION_LABEL_ALERT_REPETICIONES_DAYS=0
NOTIFICATION_LABEL_ALERT_BATCH_LIMIT=500
NOTIFICATION_LABEL_ALERT_SCHEDULER_ENABLED=true
```

Reglas:

- Si una variable `NOTIFICATION_LABEL_ALERT_<LABEL>_DAYS` no existe, se usa el default del codigo.
- Si se define en `0`, vacia o con un valor no valido, esa alerta queda desactivada.
- `REPETICIONES` queda sin alerta por defecto.
- `NOTIFICATION_LABEL_ALERT_BATCH_LIMIT` limita cuantos leads se inspeccionan por label en cada ejecucion.
- `NOTIFICATION_LABEL_ALERT_SCHEDULER_ENABLED=false` apaga el scheduler sin quitar el modulo.
