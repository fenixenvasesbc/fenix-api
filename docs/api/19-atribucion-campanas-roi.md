# Atribución de captación y ROI semanal de campañas

Mide cada semana la efectividad de las campañas de Meta por **familia de inversión** (p. ej. `LANDING PIZZA FRANCIA`):

**inversión → mensajes (leads) → bocetos pedidos → bocetos aprobados**

Decisión de arquitectura: `claude/adr-007-atribucion-landings-roi.md` (proyecto Fenix).

## Flujo de captación

1. Meta → hoja "Reparto de leads" (pestaña Leads: `Nombre`, `WhastApp`, `Mensaje`, `Producto`).
2. n8n reparte el lead y lo contacta pasando por Fenix: `POST /events/outbound/accepted` con `producto` = valor de la columna Producto (slug de la landing).
3. Fenix guarda un `LeadAcquisitionTouch` por cada envío con `producto`.

Solo cuentan como captación los envíos que traen `producto`. Quien escribe por su cuenta no cuenta.

## Reglas de negocio

| Regla | Detalle |
|---|---|
| Mensajes (leads) | Leads distintos con un toque en la semana, en la familia de esa landing. |
| Boceto pedido | La **primera** solicitud de boceto del lead con `requestType = 'BOCETO'` (o `null` en solicitudes antiguas). |
| Atribución | Esa solicitud se atribuye al **último toque del lead anterior a su creación** (si el lead re-entró por otra landing, cuenta la última). |
| Aprobado | Esa misma solicitud con `approvedAt` no nulo, aunque tenga varias categorías. |
| Semana | Semana (lunes–domingo, `Europe/Madrid`) del toque atribuido = semana de entrada del lead. |
| Sin toque previo | Si el lead no tiene ningún toque anterior a su primera BOCETO, no se atribuye. |

Todo se calcula al consultar (sin snapshot): reasignar landings, borrar solicitudes o cambiar su tipo se refleja en el histórico.

## Entidades

| Modelo | Descripción |
|---|---|
| `InvestmentFamily` | Unidad de inversión: `name` único, `country` (`DesignRequestCountry`: ES/FR/IT/DE/CH), `sortOrder`, `active`. |
| `Landing` | Slug normalizado (`/landing-pizza`) → `familyId` (null = pendiente de asignar). `autoCreated` si la registró la captura. |
| `LeadAcquisitionTouch` | Toque de captación: `leadId`, `landingId`, `rawProducto`, `occurredAt` (hora del proveedor), `externalMessageId` único (id de YCloud). Append-only. |
| `FamilyWeeklySpend` | Inversión por familia y semana: `weekStart` (lunes, `date`), `amountCents`. Único por `(familyId, weekStart)`. |

Normalización del slug: minúsculas, sin protocolo/dominio, sin query ni `#`, con `/` inicial y sin `/` final.

## Captura (`POST /events/outbound/accepted`)

| Campo nuevo | Tipo | Descripción |
|---|---|---|
| `producto` | string opcional (≤500) | Slug de la landing. |

- Slug conocido → toque en esa landing.
- Slug desconocido → se crea una `Landing` sin familia (aparece como **Pendiente** en Configuración) y el toque se guarda igual.
- Idempotente por `externalMessageId`.
- Nunca bloquea el registro del mensaje: los errores se registran en log.

> Importante: la API valida con `forbidNonWhitelisted`. Desplegar `fenix-api` antes de añadir `producto` en n8n, o la API devolverá 400.

## Endpoints

| Método | Ruta | Roles | Descripción |
|---|---|---|---|
| GET | `/acquisition/families` | ADMIN, SUPPORT | Familias con sus landings. |
| POST | `/acquisition/families` | SUPPORT | Crear familia (`name`, `country`, `sortOrder?`). |
| PATCH | `/acquisition/families/:id` | SUPPORT | Editar nombre, país, orden o `active`. |
| GET | `/acquisition/landings` | SUPPORT | Landings (pendientes primero) con `touchCount`. |
| POST | `/acquisition/landings` | SUPPORT | Crear landing (`slug`, `familyId?`). |
| PATCH | `/acquisition/landings/:id` | SUPPORT | Asignar/mover familia (`familyId`, `null` = sin familia) o cambiar slug (solo si no tiene toques). |
| DELETE | `/acquisition/landings/:id` | SUPPORT | Solo si no tiene toques. |
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

Percentiles p50/p80/p90 (días) de entrada→boceto, boceto→aprobación y entrada→aprobación; curva acumulada de aprobaciones por semana desde la entrada (hasta 13 semanas); desglose por familia.

## UI (Fenix-SPA)

- **Dashboard > Campañas / ROI** (ADMIN y SUPPORT): detalle de una semana (o del rango) por familia o país con mensajes, inversión, €/mensaje, bocetos, % msg→boceto, €/boceto, aprobados, % boceto→aprobado y €/aprobado; evolución semana a semana de la métrica elegida; diálogo "Cargar inversión"; tiempos de conversión.
- **Configuración > Campañas y familias** (solo SUPPORT): familias (crear, editar, activar) y equivalencias landing → familia (crear, asignar pendientes, mover, borrar si no tiene datos).
