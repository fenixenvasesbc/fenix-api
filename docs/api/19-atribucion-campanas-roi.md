# Atribución de captación y ROI de campañas

Mide por semana (martes–lunes) y por día la efectividad de las campañas de Meta por **familia de inversión** (p. ej. `LANDING PIZZA FRANCIA`):

**inversión diaria → mensajes (leads) → presupuestos / bocetos pedidos → bocetos aprobados**, con un objetivo de €/mensaje por familia.

Decisión de arquitectura: `claude/adr-007-atribucion-landings-roi.md` (proyecto Fenix).

## Flujo de captación

1. Meta → hoja "Reparto de leads" de n8n.
2. n8n reparte el lead y lo contacta con la **plantilla de WhatsApp de su campaña** (p. ej. `cajas_pizza_es`), pasando por Fenix: `POST /events/outbound/accepted`.
3. Fenix guarda un `LeadAcquisitionTouch` por cada envío con plantilla.

Ese endpoint solo lo usa n8n. Los envíos manuales desde Fenix (OutboundService + webhook de estado) **no** pasan por él y no cuentan como captación. Tampoco cuenta quien escribe por su cuenta. No hace falta ningún cambio en n8n.

## Reglas de negocio

| Regla | Detalle |
|---|---|
| Mensajes (leads) | Leads distintos con un toque en el periodo, en la familia de la plantilla de ese envío. |
| Boceto pedido | La **primera** solicitud de boceto del lead con `requestType = 'BOCETO'` (o `null` en solicitudes antiguas). |
| Atribución | Esa solicitud se atribuye al **último toque del lead anterior a su creación** (si el lead re-entró por otra campaña, cuenta la última). |
| Aprobado | Esa misma solicitud con `approvedAt` no nulo, aunque tenga varias categorías. |
| Presupuesto | Primera asignación al lead de la etiqueta configurada como "Presupuesto enviado" (`LeadLabelAssignment.assignedAt`), atribuida igual: último toque anterior. Cuenta en el periodo de entrada del lead. |
| Semana | **Martes a lunes** (`Europe/Madrid`) del toque atribuido = semana de entrada del lead. n8n solo envía de lunes a viernes y los leads del fin de semana se contactan el lunes, que cierra la semana. Clave = el martes. |
| Día | Día de envío del toque: mar, mié, jue, vie y lun. Sábado y domingo se agregan al lunes siguiente. |
| Inversión | Importe **diario** por familia, vigente desde su fecha hasta el siguiente cambio. Se aplica a todos los días naturales (también fin de semana). Inversión de un periodo = suma de sus días (el lunes de la vista diaria incluye sábado y domingo). |
| Objetivo €/mensaje | Por familia, con historial por fecha. Cada lead toma el objetivo vigente el día de su entrada; el del periodo es la media ponderada por mensajes (sin mensajes, la media de los objetivos de sus días de envío). €/mensaje real > objetivo = rojo; ≤ = verde. |
| Sin toque previo | Si el lead no tiene ningún toque anterior a su primera BOCETO, no se atribuye. |

Todo se calcula al consultar (sin snapshot): reasignar plantillas, borrar solicitudes o cambiar su tipo se refleja en el histórico.

## Entidades

| Modelo | Descripción |
|---|---|
| `InvestmentFamily` | Unidad de inversión: `name` único, `country` (`DesignRequestCountry`: ES/FR/IT/DE/CH), `sortOrder`, `active`. |
| `AcquisitionTemplate` | Plantilla de captación (`templateName` único, tal como en YCloud) → `familyId` (null = pendiente de asignar). `autoCreated` si la registró la captura. |
| `LeadAcquisitionTouch` | Toque de captación: `leadId`, `templateId`, `templateName`, `occurredAt` (hora del proveedor), `externalMessageId` único (id de YCloud), `source` (`LIVE` \| `BACKFILL` \| `BACKFILL_LEAD`). Append-only. |
| `FamilySpendRate` | Inversión diaria: `familyId`, `effectiveFrom` (`date`), `dailyAmountCents` (0 = deja de invertir). Único por `(familyId, effectiveFrom)`. Sustituye a `FamilyWeeklySpend` (migración `20261123100000`: importe/7 desde el lunes de cada semana cargada y 0 desde el lunes siguiente si no había más). |
| `FamilyLeadTarget` | Objetivo de €/mensaje: `familyId`, `effectiveFrom`, `targetCentsPerLead` (`null` = sin objetivo desde esa fecha). |
| `AcquisitionSettings` | Fila única `default`: `quoteLabelCode` = `code` de la etiqueta "Presupuesto enviado" (la migración la busca por nombre). |

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

Después, para los leads que siguen **sin ningún toque**, se usa `Lead.firstOutboundTemplateName` + `firstOutboundAt` si la plantilla está en el catálogo (`source = BACKFILL_LEAD`). Cubre los leads antiguos, cuyo primer envío llegó reconstruido desde el webhook de YCloud. Es una aproximación: si n8n volvió a contactar al lead, la plantilla es la última y la fecha, la primera.

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
| GET | `/acquisition/spend?date=YYYY-MM-DD` | ADMIN, SUPPORT | Importe diario y objetivo vigentes ese día (por defecto hoy) por familia activa, con `spendEffectiveFrom`, `targetEffectiveFrom` y `nextChangeFrom` (cambio guardado después). |
| PUT | `/acquisition/spend` | ADMIN, SUPPORT | `{ date, items: [{ familyId, dailyAmountCents?, targetCentsPerLead? }] }`. Campo omitido = sin cambios; solo se guarda (desde `date`) lo que difiere de lo vigente. `targetCentsPerLead: null` quita el objetivo. |
| GET | `/acquisition/settings` | ADMIN, SUPPORT | Etiqueta de presupuesto configurada. |
| PATCH | `/acquisition/settings` | SUPPORT | `{ quoteLabelCode \| null }`. |
| GET | `/acquisition/report?granularity=week\|day&from&to&groupBy=family\|country` | ADMIN, SUPPORT | Embudo por periodo. `week`: semanas martes–lunes, por defecto las últimas 8 (máx. 104). `day`: días de envío, por defecto la semana actual (máx. 92 días). Sustituye a `/report/weekly`. |
| GET | `/acquisition/report/conversion-lag?from&to` | ADMIN, SUPPORT | Tiempos de conversión. Por defecto las últimas 26 semanas. |

El catálogo es exclusivo de SUPPORT: la herencia de roles SUPPORT→ADMIN es unidireccional (mismo criterio que `LabelMessageRule`).

### Reporte por periodo

`periods[]` = `{ key, start, end, status }` (en `day`, el lunes tiene `start` = sábado). Cada fila (familia, país o "Sin familia asignada") trae por periodo `leads`, `quotes`, `bocetos`, `approved`, `spendCents` (`null` = sin inversión cargada, distinto de 0) y `targetCentsPerLead`, más `totals`. `quoteLabel` = etiqueta usada para los presupuestos (`null` = no configurada, `quotes` = 0). Familias inactivas solo aparecen si tienen datos.

Estado de cada periodo:

| Estado | Significado |
|---|---|
| `CURRENT` | Periodo en curso (o futuro). |
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

- **Dashboard > Campañas / ROI** (ADMIN y SUPPORT): botones Semanal / Diaria y flechas por semana (martes–lunes; por defecto la última cerrada). Resumen del periodo (inversión total, mensajes, €/mensaje frente al objetivo, presupuestos, bocetos, aprobados); detalle por familia o país con mensajes, inversión, €/mensaje (rojo/verde), objetivo, presupuestos, % msg→presupuesto, bocetos, % msg→boceto, €/boceto, aprobados, % boceto→aprobado y €/aprobado; evolución por semana o día de la métrica elegida; diálogo "Inversión y objetivos" (importe diario y objetivo por familia a partir de una fecha, precargados; solo se guarda lo que cambia); tiempos de conversión.
- **Configuración > Campañas y familias** (solo SUPPORT): etiqueta de presupuesto enviado; familias (crear, editar, activar) y equivalencias plantilla → familia (añadir con recuperación del histórico, asignar pendientes, mover, borrar si no tiene datos).
