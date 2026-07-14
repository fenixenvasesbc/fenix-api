# Leads: nombres, estados, labels y recordatorios

## Objetivo funcional

Gestionar clientes/contactos dentro de cada cuenta, mantener su nombre visible sincronizado con WhatsApp/YCloud y organizar el ciclo comercial mediante labels.

## Identidad del lead

Un lead es único por:

```txt
accountId + phoneE164
```

Esto permite que el mismo teléfono exista en cuentas diferentes.

## Estados base

| Estado | Cuándo se usa |
|---|---|
| `NEW` | Lead creado/confirmado por primer outbound y aún sin primera respuesta. |
| `RESPONDED` | Lead que ya respondió al menos una vez por inbound. |

Regla:

- Al recibir cualquier inbound válido, el lead pasa a `RESPONDED`.

## Nombre visible del lead

La API no depende de un único campo de nombre. Calcula:

- `displayName`;
- `displayNameSource`.

Prioridad:

1. `whatsappContactName`: nombre de agenda WhatsApp Business.
2. `ycloudNickname`: nickname en YCloud.
3. `whatsappProfileName`: nombre público de perfil WhatsApp.
4. `name`: nombre legacy.
5. `phoneE164`: fallback.

## Fuentes de nombre

### `whatsappContactName`

Fuente principal.

Se actualiza desde:

- webhook `whatsapp.smb.app.state.sync`;
- atributo `remarkName`/`remark_name` en `contact.attributes_changed`;
- backfill YCloud si trae `remarkName`, `remark_name`, `fullName` o `full_name`.

Reglas:

- Es la prioridad más alta.
- Si el webhook de agenda envía `remove`, se limpia `whatsappContactName`.
- El inbound del lead no sobrescribe este campo.

### `ycloudNickname`

Fuente secundaria.

Se actualiza desde:

- atributo `nickname`, `nickName` o `nick_name` en `contact.attributes_changed`;
- backfill YCloud si trae nickname.

Reglas:

- No se sobrescribe con inbound.
- Solo se actualiza si viene un valor no vacío.

### `whatsappProfileName`

Fuente de perfil público.

Se actualiza desde:

- inbound messages;
- eventos outbound/message updated con customer profile.

Reglas:

- No tiene prioridad sobre agenda/nickname.
- Puede cambiar con la información pública del cliente.

## Labels operativos

Valores:

| Label | Uso funcional |
|---|---|
| `PRODUCCION` | Lead en producción. |
| `BOCETO_EN_PROCESO` | Boceto en curso. |
| `PENDIENTE_DE_PAGO` | Pendiente de pago. |
| `MUESTRAS` | Gestión de muestras. |
| `REPETICIONES` | Cliente listo para recordatorio de repetición. |
| `BOCETOS_ATRASADOS` | Bocetos atrasados. |

## Cambiar label

Endpoint:

```http
PATCH /leads/:leadId/label
```

Roles:

- `ADMIN`
- `SALES`

Reglas:

1. Se valida que el lead pertenezca a la cuenta.
2. Si el label no cambia, se devuelve el lead actual.
3. Se crea un registro en `LeadLabelHistory`.
4. Se cancelan recordatorios de repetición pendientes del lead.
5. Si el nuevo label es `REPETICIONES`, se crea un nuevo `LeadRepetitionReminder`.
6. Se actualiza:
   - `currentLabel`;
   - `currentLabelChangedAt`;
   - `repetitionReminderDays`;
   - `nextRepetitionReminderAt`.
7. Se publica `conversation.updated`.

## Cálculo de repetición

Cuando un lead entra en `REPETICIONES`, se calcula:

```txt
dueAt = markedAt + reminderDays
```

Luego se ajusta al siguiente día laborable si aplica.

Reglas de `reminderDays`:

1. Si el request trae `reminderDays`, se usa ese valor.
2. Si el lead ya tuvo una repetición anterior, se calcula la diferencia entre la repetición anterior y la nueva.
3. Si no hay historial, se usa el valor actual guardado en el lead.
4. Si no hay valor previo, se usa default `90`.

## Recordatorio manual de repetición

Endpoints existentes:

```http
GET /leads/repetition-reminders/due
POST /leads/repetition-reminders/:reminderId/sent
```

Uso:

- listar recordatorios vencidos;
- marcar manualmente un recordatorio como enviado.

## Recordatorio automático de repetición

La automatización nueva usa `LeadRepetitionReminder`.

Regla clave:

- Un ciclo de `REPETICIONES` envía máximo un recordatorio.

Después de enviar:

```txt
LeadRepetitionReminder.sentAt = now
Lead.nextRepetitionReminderAt = null
```

Si el lead permanece en `REPETICIONES`, no se vuelve a enviar porque ya no hay reminder pendiente.

Si el lead sale de `REPETICIONES` y luego vuelve a entrar:

1. se crea un nuevo `LeadRepetitionReminder`;
2. se recalcula frecuencia;
3. se enviará de nuevo cuando venza ese nuevo `dueAt`.

