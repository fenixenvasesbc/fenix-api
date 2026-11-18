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

### Ejecutar alertas por labels manualmente

Uso local:

```bash
pnpm notifications:run-label-alerts
```

Docker:

```bash
docker compose exec api pnpm notifications:run-label-alerts
```

Salida esperada:

```json
{
  "ok": true,
  "executedAt": "2026-07-17T05:00:00.000Z",
  "rules": 5,
  "inspected": 120,
  "created": 45
}
```

Reglas:

- Crea alertas reales, no es dry-run.
- Es idempotente: si ya existen alertas para el mismo lead, label y fecha de entrada al label, no las duplica.
- Para simular una fecha concreta:

```bash
pnpm notifications:run-label-alerts -- --now=2026-07-17T07:00:00+02:00
```

## Observabilidad: logs, health y reconexión

### Niveles de log

Todos los procesos usan el `Logger` de NestJS (niveles `log`, `warn`, `error`, `debug`).

| Nivel | Cuándo aparece |
|---|---|
| `LOG` | Flujo normal: webhook encolado, job recibido, campaña encolada, resumen de cron sin fallos. |
| `WARN` | Situación anómala pero controlada: webhook sin `id`/`type`, evento duplicado, evento sin ruta, cron que terminó con `failed>0`, health check degradado. |
| `ERROR` | Fallo que requiere atención: job que va a retry o a dead, cron abortado, RabbitMQ desconectado, errores no capturados del proceso. Incluye el stack en las líneas siguientes. |

Helpers compartidos en `src/common/utils/logging.ts`: `errorMessage`, `errorStack`, `runCronWithSummary`, `bump`.

### Workers (RabbitMQ)

Cada error de worker incluye `deaths`, `action` (`retry:<rk>` o `dead:<rk>`), `providerEventId`, `eventType` (o `leadCampaignId` en campañas) y el stack.

Buscar en logs:

- `action=dead` → el mensaje agotó los reintentos y quedó en la cola dead.
- `Unhandled consumer error queue=` → excepción que escapó al handler del worker.
- `RabbitMQ consumer cancelled by broker` → el broker canceló un consumidor.

### Crons

Todos los `@Cron` (excepto alertas por labels, que ya tenía su propio resumen) van envueltos en `runCronWithSummary` y dejan siempre dos líneas:

```text
[cron:reengagement] started
[cron:reengagement] finished found=12 enqueued=10 skipped=2 failed=0 durationMs=840
```

| Job | Horario (Europe/Madrid) | Contadores |
|---|---|---|
| `reengagement` | 09:00 L-V | `found`, `enqueued`, `skipped`, `failed`, `noWindow` |
| `repetition-reminder` | 09:15 L-V | `found`, `enqueued`, `skipped`, `failed` |
| `label-message-rules` | 09:30 diario | `rules`, `found`, `enqueued`, `skipped`, `failed` |
| `design-request-sla` | minuto 15 de cada hora | `found`, `labeled`, `failed` |
| `media-cleanup` | 03:00 diario | `inspected`, `deleted`, `failed` |

- Si `failed>0`, el resumen sale como `WARN`.
- Si falla algo fuera del bucle (p. ej. la query principal contra la BD), sale `[cron:<job>] aborted ... err=...` como `ERROR` con stack.
- Si un día no aparece `[cron:<job>] started` a su hora, el proceso API no estaba levantado.

### Reconexión de RabbitMQ

`RabbitmqService` se reconecta solo si la conexión o el canal se cierran después del arranque:

1. Log `ERROR`: `RabbitMQ connection closed unexpectedly. Reconnecting and restoring N consumers...`
2. Reintenta con backoff (0,5 s → 10 s). A partir del 5.º intento cada fallo sale como `ERROR`.
3. Vuelve a declarar la topología y re-suscribe todos los consumidores.
4. Log `LOG`: `RabbitMQ reconnected after <ms>ms. consumers restored=N`.

Mientras reconecta, `publish` falla con `Rabbit channel unavailable (reconnecting)`. Los mensajes que estaban en proceso en el canal viejo no se ack-ean y el broker los re-entrega.

### Health check

`GET /health` (público, proceso API):

| HTTP | `status` | Significado |
|---|---|---|
| 200 | `ok` | BD responde a `SELECT 1` y RabbitMQ conectado. |
| 503 | `degraded` | Falla BD o RabbitMQ (detalle en `checks`). |

```json
{
  "status": "ok",
  "uptimeSec": 3600,
  "checks": {
    "database": { "ok": true, "latencyMs": 3 },
    "rabbitmq": { "connected": true, "reconnecting": false, "consumers": 1, "disconnectedSince": null }
  },
  "timestamp": "2026-11-18T11:00:00.000Z"
}
```

Usarlo como healthcheck de Docker o en un monitor externo. El worker no expone HTTP: su salud se ve en los logs.

### Errores de proceso

`main.ts` y `worker.main.ts` registran `registerProcessErrorHandlers` (`src/common/utils/process-handlers.ts`):

- `unhandledRejection` → `ERROR` con stack; el proceso sigue vivo.
- `uncaughtException` → `ERROR` con stack y salida con código 1 (el contenedor se reinicia).
- Fallo en el arranque (`bootstrap`) → `ERROR` `API/Worker failed to start` y salida con código 1.
- `SIGTERM`/`SIGINT` → `WARN` y cierre ordenado (`enableShutdownHooks`).

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
7. Revisar logs `[cron:reengagement]` (09:00) y `[cron:repetition-reminder]` (09:15) Europe/Madrid: deben aparecer `started` y `finished`.
8. Comprobar `GET /health` → 200.

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
