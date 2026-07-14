# Webhooks YCloud y sincronización WhatsApp

## Objetivo funcional

Recibir eventos de YCloud, guardarlos con idempotencia, procesarlos asíncronamente y actualizar leads, mensajes, conversaciones y nombres.

## Entrada única de webhooks

Endpoint:

```http
POST /webhooks/ycloud
```

Respuesta:

```json
{ "ok": true }
```

Reglas:

- El request HTTP no procesa la lógica de negocio.
- Solo valida que exista `id` y `type`.
- Publica un job en RabbitMQ con:
  - `provider`;
  - `providerEventId`;
  - `eventType`;
  - `apiVersion`;
  - `providerTime`;
  - `payload`;
  - `receivedAt`.

## Inbox de webhooks

El `WebhookWorker` consume la cola principal, guarda `WebhookEvent` y evita duplicados por `providerEventId`.

Si el evento ya existe:

- se considera duplicado;
- se hace `ack`;
- no se reprocesa.

## Routing por tipo de evento

| `eventType` | Cola/procesador |
|---|---|
| `whatsapp.inbound_message.received` | Inbound message worker |
| `whatsapp.message.updated` | Message status worker |
| `contact.attributes_changed` | Contact attributes worker |
| `whatsapp.smb.app.state.sync` | SMB state sync worker |
| Otros | Se guardan, pero no tienen ruta downstream |

## Retries del inbox

El worker principal aplica estrategia:

| Death count | Acción |
|---|---|
| `0-2` | Retry 10s |
| `3-5` | Retry 1m |
| `6-8` | Retry 10m |
| `>8` | Dead-letter |

## Inbound message

Evento:

```txt
whatsapp.inbound_message.received
```

Lógica:

1. Normaliza payload.
2. Resuelve cuenta por:
   ```txt
   wabaId + to
   ```
3. Crea/actualiza lead por:
   ```txt
   accountId + from
   ```
4. Cambia lead a `RESPONDED`.
5. Guarda nombre de perfil público en `whatsappProfileName`.
6. No sobrescribe `whatsappContactName` ni `ycloudNickname`.
7. Crea/actualiza `Message`.
8. Actualiza `Conversation`.
9. Marca `WebhookEvent` como `PROCESSED`.
10. Publica eventos realtime.

## Message updated

Evento:

```txt
whatsapp.message.updated
```

Uso:

- Actualizar estados de mensajes outbound.

Estados normalizados:

- `SENT`
- `DELIVERED`
- `READ`
- `FAILED`

Reglas:

- Ignora transiciones no progresivas.
- Crea `MessageStatusHistory`.
- Si el mensaje pertenece a una `LeadCampaign` en estado `UNKNOWN`, reconcilia a `SENT` o `FAILED`.
- Si no encuentra mensaje, puede reconciliar mensajes outbound manuales usando `externalId`.

## Contact attributes changed

Evento:

```txt
contact.attributes_changed
```

Uso:

- Actualizar nombres desde atributos del contacto YCloud.

Atributos considerados:

| Atributo | Campo destino |
|---|---|
| `remarkName`, `remark_name` | `Lead.whatsappContactName` |
| `nickname`, `nickName`, `nick_name` | `Lead.ycloudNickname` |

Reglas:

1. Si no cambió ningún atributo relevante, se marca procesado y se ignora.
2. Si el nuevo valor relevante es vacío, se ignora.
3. Si no hay teléfono en el evento, consulta el contacto en YCloud.
4. Busca el lead por `accountId + phoneE164`.
5. Si el lead existe y cambió el valor, actualiza el campo.
6. Publica `conversation.updated`.

Nota:

- Este webhook no siempre es el más fiable para nombres de agenda; por eso también se procesa `whatsapp.smb.app.state.sync`.

## WhatsApp SMB app state sync

Evento:

```txt
whatsapp.smb.app.state.sync
```

Uso:

- Sincronizar cambios de agenda de WhatsApp Business App.
- Es la fuente principal para `whatsappContactName`.

Resolución de cuenta:

```txt
whatsappSmbAppStateSync.wabaId + whatsappSmbAppStateSync.phoneNumber
```

Por cada item en `stateSync`:

1. Obtiene `contact.phoneNumber`.
2. Busca lead por `accountId + phoneE164`.
3. Si no existe, lo registra como `missingLead`.
4. Si `action = add` o `edit`:
   - usa `contact.fullName` o `contact.firstName`;
   - actualiza `whatsappContactName`;
   - actualiza `whatsappUserId`, `whatsappParentUserId`, `whatsappUsername` si vienen.
5. Si `action = remove`:
   - limpia `whatsappContactName`;
   - no borra lead ni conversación.
6. Publica `conversation.updated`.

## Backfill de nombres YCloud

Script:

```bash
pnpm ycloud:backfill-lead-names -- --account=<ACCOUNT_UUID> --delay-ms=250
```

Modo escritura:

```bash
pnpm ycloud:backfill-lead-names -- --account=<ACCOUNT_UUID> --delay-ms=250 --apply
```

Reglas:

- Dry-run por defecto.
- Recorre leads con `status != NEW`.
- Consulta YCloud Contact API por teléfono.
- Si encuentra nombre de agenda, actualiza `whatsappContactName`.
- Si encuentra nickname, actualiza `ycloudNickname`.
- Si no viene un campo, no sobrescribe ni borra.
- Usa delay para no saturar YCloud.

