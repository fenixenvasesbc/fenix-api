# Atribución de captación y ROI semanal de campañas

Mide cada semana la efectividad de las campañas de Meta por **familia de inversión** (p. ej. `LANDING PIZZA FRANCIA`):

**inversión → mensajes (leads) → bocetos pedidos → bocetos aprobados**

Decisión de arquitectura: `claude/adr-007-atribucion-landings-roi.md` (proyecto Fenix).

## Flujo de captación

1. Meta → hoja "Reparto de leads" de n8n.
2. n8n reparte el lead y lo contacta con la **plantilla de WhatsApp de su campaña** (p. ej. `cajas_pizza_es`), pasando por Fenix: `POST /events/outbound/accepted`.
3. Fenix guarda un `LeadAcquisitionTouch` por cada envío con plantilla.

Ese endpoint solo lo usa n8n. Los envíos manuales desde Fenix (OutboundService + webhook de estado) **no** pasan por él y no cuentan como captación. Tampoco cuenta quien escribe por su cuenta. No hace falta ningún cambio en n8n.

## Reglas de negocio

| Regla | Detalle |
|---|---|
| Mensajes (leads) | Leads distintos con un toque en la semana, en la familia de la plantilla de ese envío. |
| Boceto pedido | La **primera** solicitud de boceto del lead con `requestType = 'BOCETO'` (o `null` en solicitudes antiguas). |
| Atribución | Esa solicitud se atribuye al **último toque del lead anterior a su creación** (si el lead re-entró por otra campaña, cuenta la última). |
| Aprobado | Esa misma solicitud con `approvedAt` no nulo, aunque tenga varias categorías. |
| Semana | Semana (lunes–domingo, `Europe/Madrid`) del toque atribuido = semana de entrada del lead. |
| Sin toque previo | Si el lead no tiene ningún toque anterior a su primera BOCETO, no se atribuye. |

Todo se calcula al consultar (sin snapshot): reasignar plantillas, borrar solicitudes o cambiar su tipo se refleja en el histórico.

## Entidades

| Modelo | Descripción |
|---|---|
| `InvestmentFamily` | Unidad de inversión: `name` único, `country` (`DesignRequestCountry`: ES/FR/IT/DE/CH), `sortOrder`, `active`. |
| `AcquisitionTemplate` | Plantilla de captación (`templateName` único, tal como en YCloud) → `familyId` (null = pendiente de asignar). `autoCreated` si la registró la captura. |
| `LeadAcquisitionTouch` | Toque de captación: `leadId`, `templateId`, `templateName`, `occurredAt` (hora del proveedor), `externalMessageId` único (id de YCloud), `source` (`LIVE` \| `BACKFILL`). Append-only. |
| `FamilyWeeklySpend` | Inversión por familia y semana: `weekStart` (lunes, `date`), `amountCents`. Único por `(familyId, weekStart)`. |

## Captura (`POST /events/outbound/accepted`)

- Usa `template.name` del envío.
- Plantilla en el catálogo → toque con esa plantilla.
- Plantilla desconocida → se crea un `AcquisitionTemplate` sin familia (aparece como **Pendiente** en Configuración) y el toque se guarda igual.
- Idempotente por `externalMessageId`.
- Nunca bloquea el registro del mensaje: los errores se registran en log.
- El campo `producto` del DTO (de la primera versión) se sigue aceptando pero se ignora.

## Histórico (backfill)

Los toques anteriores se reconstruyen desde `Message`, con los envíos que entraron por el endpoint de n8n:

- `direction = OUTBOUND`, `templateName` en el catálogo y `externalId` nulo;
- `rawPayload` con las claves `wabaId` y `template` (body plano de n8n);
- sin `source` (envíos manuales de Fenix) ni `whatsappMessage` (mensajes reconstruidos desde webhooks).

Se ejecuta en la migración `20261122180000_acquisition_by_template` para las plantillas sembradas, y al crear o renombrar una plantilla desde Configuración (`AcquisitionTouchService.backfillTemplate`). Es idempotente.

## Endpoints

| Método | Ruta | Roles | Descripción |
|---|---|---|---|
| GET | `/acquisition/families` | ADMIN, SUPPORT | Familias con sus plantillas. |
| POST | `/acquisition/families` | SUPPORT | Crear familia (`name`, `country`, `sortOrder?`). |
| PATCH | `/acquisition/families/:id` | SUPPORT | Editar nombre, país, orden o `active`. |
| GET | `/acquisition/templates` | SUPPORT | Plantillas (pendientes primero) con `touchCount`. |
| POST | `/acquisition/templates` | SUPPORT | Añadir plantilla (`templateName`, `familyId?`); reconstruye su histórico y devuelve `backfilled`. |
| PATCH | `/acquisition/templates/:id` | SUPPORT | Asignar/mover familia (`familyId`, `null` = sin familia) o renombrar (solo si no tiene toques). |
| DELETE | `/acquisition/templates/:id` | SUPPORT | Solo si no tiene toques. |
| GET | `/acquisition/spend?weekStart=YYYY-MM-DD` | ADMIN, SUPPORT | Inversión de la semana (normaliza al lunes) para las familias activas. |
| PUT | `/acquisition/spend` | ADMIN, SUPPORT | `{ weekStart, items: [{ familyId, amountCents \| null }] }`; `null` borra. |
| GET | `/acquisition/report/weekly?from&to&groupBy=family\|country` | ADMIN, SUPPORT | Embudo por semana y familia/país. Por defecto las últimas 8 semanas; máx. 104. |
| GET | `/acquisition/report/conversion-lag?from&to` | ADMIN, SUPPORT | Tiempos de conversión. Por defecto las últimas 26 semanas. |

El catálogo es exclusivo de SUPPORT: la herencia de roles SUPPORT→ADMIN es unidireccional (mismo criterio que `LabelMessageRule`).

### Reporte semanal

Cada fila (familia, país o "Sin familia asignada") trae por semana `leads`, `bocetos`, `approved` y `spendCents` (`null` = sin inversión cargada, distinto de 0), más `totals`. Familias inactivas solo aparecen si tienen datos.

Estado de cada semana:

| Estado | Significado |
|---|---|
| `CURRENT` | Semana en curso. |
| `IN_PROGRESS` | Cerrada, pero todavía pueden llegar aprobaciones. |
| `MATURE` | Ya pasaron `maturity.weeks` semanas desde su inicio. |

`maturity.weeks` se calcula con los datos de las últimas 26 semanas: la semana desde la entrada en la que se alcanza el 80 % de las aprobaciones. Con menos de 10 aprobaciones se usa 4 (`estimated: true`).

### Tiempos de conversión

**No dependen de la captación de n8n.** Se calculan sobre la primera solicitud BOCETO de **cada** lead creada en el rango (semana de creación del boceto; por defecto las últimas 26 semanas), venga o no de una campaña. Dos tramos, con media, mediana, p80 y p90 (días):

| Tramo | Desde | Hasta |
|---|---|---|
| `daysReplyToBoceto` | Primera respuesta del lead (primer mensaje `INBOUND`, `Message.occurredAt`) | Creación de la primera solicitud BOCETO |
| `daysBocetoToApproval` | Creación de la solicitud | `approvedAt` |

Primera respuesta: el primer mensaje entrante anterior al boceto y, si el lead tuvo un contacto de n8n antes del boceto, posterior al último de esos contactos (para no tomar una respuesta de una campaña anterior). Sin contacto de n8n equivale a `Lead.firstInboundAt`. `replied` = bocetos con respuesta previa (los que no la tienen quedan fuera del primer tramo).

`byFamily` agrupa por la familia del último contacto de n8n; los leads sin contacto van en `__no_campaign__` ("Sin contacto de n8n").

`curve`, `curveSample`, `maturityWeeks` y `daysEntryToApproval` salen de la cohorte de campañas (semana del contacto de n8n) y solo sirven para la madurez.

## UI (Fenix-SPA)

- **Dashboard > Campañas / ROI** (ADMIN y SUPPORT): detalle de una semana (o del rango) por familia o país con mensajes, inversión, €/mensaje, bocetos, % msg→boceto, €/boceto, aprobados, % boceto→aprobado y €/aprobado; evolución semana a semana de la métrica elegida; diálogo "Cargar inversión"; tiempos de conversión (primera respuesta → boceto y boceto → aprobado).
- **Configuración > Campañas y familias** (solo SUPPORT): familias (crear, editar, activar) y equivalencias plantilla → familia (añadir con recuperación del histórico, asignar pendientes, mover, borrar si no tiene datos).
