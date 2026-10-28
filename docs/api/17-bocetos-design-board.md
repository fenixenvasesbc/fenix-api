# Bocetos: tablero de solicitudes de diseño

## Objetivo funcional

Tablero Kanban (tipo Jira) para que una comercial (`SALES`) pida un boceto a Diseño directamente desde el chat de un lead, y el equipo de Diseño (`DESIGNER`/`DESIGNER_MANAGER`) lo gestione con columnas, plazos en días hábiles, pausa, comentarios con adjuntos, reenvío al lead y reportes. Es **un solo tablero global** (`DesignBoard`), compartido por todas las cuentas comerciales.

Módulo: `src/modules/design-board/`. Endpoints: ver doc 09.

## Roles

| Rol | Alcance |
|---|---|
| `SALES` / `SALES_MANAGER` (tratado igual que `SALES` en este módulo) | Crea solicitudes; ve solo columna inicial y final, solo sus propias tarjetas; aprueba/envía a modificación/reenvía sus propias tarjetas. `SALES_MANAGER` además ve la pestaña "Reportes y estadísticas" (no "Por diseñador"). |
| `DESIGNER` | Ve todas las columnas excepto "Aprobados"; solo sus tarjetas asignadas; mueve ±1. |
| `DESIGNER_MANAGER` | Control total: asigna diseñador, ve "Aprobados", pausa/reanuda, archiva, ve reportes y "Por diseñador". Login restringido únicamente a este módulo. |
| `ADMIN` | Todo lo anterior sin restricción. |

## Columnas (tablero por defecto)

Nuevos(0) → Modificación(1, oculta del flujo normal) → En revisión(2) → Terminado(3, `isFinal`) → Aprobados(4, `isApproved`).

- El movimiento normal es `PATCH /requests/:id/move`, ±1, saltando la columna "Modificación" salvo que la tarjeta ya esté en ella.
- El único camino para entrar a "Modificación" es `POST /requests/:id/send-to-modification`, solo desde `isFinal`. Reinicia el plazo a `modificationSlaBusinessDays` (1 día hábil por defecto).
- "Aprobados" solo es visible para `DESIGNER_MANAGER`/`ADMIN`; `archive()` (`POST /requests/:id/archive`) la saca del tablero sin borrar datos (sigue contando en reportes).

## Plazos (SLA) en días hábiles

`BusinessDaysService.computeBusinessDueAt()`: corte a las 14:00 hora España (si el ancla es antes, ese día cuenta como día 1; si es después, arranca al día hábil siguiente), luego N días hábiles (3 al crear, el valor de la columna al entrar a "Modificación"), saltando fines de semana y `PublicHoliday`.

Semáforo (`DesignBoardService.withSlaStatus()`, calculado al leer, no persistido):

- 🟢 verde: más de 1 día hábil para `dueAt`.
- 🟠 naranja: 1 día hábil o menos, no vencida.
- 🔴 rojo: vencida.
- Si `pausedAt` no es nulo, el color queda congelado en el que tenía al pausar.

Cron `DesignRequestSlaSchedulerService` (cada hora): aplica `BOCETOS_ATRASADOS` una sola vez por solicitud vencida y no pausada (`overdueLabelAppliedAt` como dedupe).

Pausa (`POST /requests/:id/pause` / `.../resume`, solo `DESIGNER_MANAGER`/`ADMIN`): al reanudar, `dueAt` se desplaza hacia adelante por el tiempo real (ms) que estuvo pausada — no se recalculan días hábiles parciales.

**Plazo según tipo de solicitud** (`resolveCreationSlaBusinessDays()`, usado al crear y al editar `requestType`): `BOCETO` (default) = 3 días hábiles del tablero; `MOD`/`REPET_MOD`/`REPET_ANADE` = 1 día hábil; `REPET_BOCETO` = 2 días hábiles. Además, si el tipo es `BOCETO` y la **descripción** menciona uno de estos productos (plazo extendido): vaso(s), pala(s), panini(s), "hamburguesa folding", ensaladera(s) → 4 días hábiles en vez de 3.

**Fix 28/oct/2026 (reportado por el usuario)**: la detección de esos productos en la descripción usaba `String.includes()` (substring plano) sobre palabras cortas como "pala" — substring de palabras comunes del castellano ("palabra", "paladar", "palacio", "paliar"...), así que una descripción que solo mencionara, por ejemplo, "revisar la palabra del eslogan" disparaba el plazo extendido de 4 días por error. Caso real: tres bocetos creados el mismo día/hora con `dueAt` distinto (dos en 3 días hábiles, uno en 4). Fix: `buildExtendedSlaKeywordPattern()` usa un regex con límite de palabra (`\b...\bs?\b`, admite plural: "vasos", "palas") en vez de substring suelto.

## Etiquetas de lead relacionadas (ver doc 03 para el catálogo completo)

| Momento | Label aplicada | Tipo |
|---|---|---|
| Al crear la solicitud | `BOCETO_EN_PROCESO` | Sistema |
| Si se vence el plazo | `BOCETOS_ATRASADOS` | Sistema |
| Al reenviar el boceto terminado al lead, mientras sigue en "Terminado" | `BOCETO_ENVIADO` | **Personalizada** — hay que crearla desde Configuración > Etiquetas antes de que tenga efecto; si no existe, el reenvío de WhatsApp igual se manda, solo que no se etiqueta (se loguea un warning). |
| Al aprobar (botón o etiqueta `BOCETO_APROBADO` puesta manualmente) | `BOCETO_APROBADO` | Sistema |
| Al enviar de "Terminado" a "Modificación" (el lead pide cambios) | `BOCETO_EN_PROCESO` (de nuevo) | Sistema |

Las 3 son **mutuamente excluyentes**: representan el estado actual del boceto para ese lead, nunca debe haber más de una activa a la vez. Esto NO lo garantiza `LeadsService.setLabel()` por sí solo — solo marca la nueva como activa, nunca desactiva (`removedAt`) la anterior; `Lead.currentLabel` es un valor único, pero el frontend (`activeLeadLabels()`) lee primero `LeadLabelAssignment` (todas las activas), así que una etiqueta vieja sin desactivar sigue apareciendo igual.

Por eso `DesignBoardService` tiene un helper dedicado, `applyBocetoStageLabel(accountId, leadId, label, changedByUserId)`: aplica la etiqueta nueva y desactiva (`removeLabel()`) las otras dos de la lista `BOCETO_STAGE_LABELS`. Si aplicar la nueva falla (ej. `BOCETO_ENVIADO` todavía no se creó como etiqueta personalizada), no desactiva las demás — el lead se queda en el estado anterior en vez de sin ninguna. Lo usan `createRequest()`, `approve()`, `forwardAttachment()` y `sendToModification()`; `approveByLabel()` (la etiqueta `BOCETO_APROBADO` puesta a mano en el chat) desactiva las otras dos de forma defensiva porque en ese camino es `LeadsController.setLabel()` quien aplica la etiqueta nueva, después de que este método retorna.

Caso de referencia que motivó esto: boceto terminado → se reenvía (`BOCETO_ENVIADO`) → el lead pide cambios → `sendToModification()` → vuelve a "Terminado" → se reenvía otra vez. Sin este mecanismo, `BOCETO_ENVIADO` se quedaba pegada para siempre tras el primer reenvío, con el riesgo de disparar por error una automatización (`LabelMessageRule`) atada a esa etiqueta aunque el boceto ya no estuviera enviado de verdad.

`BOCETO_APROBADO` además dispara lógica propia: `LeadsController.setLabel()` llama a `DesignBoardService.approveByLabel(accountId, leadId)` **antes** de aplicar la etiqueta — busca una solicitud en `isFinal` con `approvedAt: null`; si no hay ninguna, bloquea la etiqueta (`BadRequestException`); si hay, mueve la tarjeta a "Aprobados" (`approvedViaLabel: true`).

## Categorías (Configuración > Categorías)

Pedido explicito del usuario, 27/oct/2026: una solicitud puede tener una o varias **categorías** (`DesignRequestCategory`) -- catálogo **GLOBAL**, deliberadamente **APARTE** de las labels de lead (`LeadLabelDefinition`, doc 03). No tienen `code`, no son "de sistema", y no disparan ninguna automatización (`LabelMessageRule`, alertas in-app); son solo clasificación/filtro manual de solicitudes de boceto (ej. "Urgente", "Cliente VIP", "Rediseño").

- `GET /design-request-categories`: cualquier rol del módulo (`ADMIN`, `SALES`, `SALES_MANAGER`, `DESIGNER`, `DESIGNER_MANAGER`) -- lo necesitan para los selectores de "Crear boceto" y el detalle de la solicitud.
- `POST` / `PATCH /:id` / `DELETE /:id`: **solo `ADMIN`** (y, por `ROLE_INHERITANCE`, `SUPPORT`). A diferencia de las labels de lead (donde `SALES_MANAGER` también puede), aquí **no** se le da acceso a `DESIGNER_MANAGER` -- decisión explícita del usuario al pedir esta funcionalidad, para no romper el aislamiento del ADR-004 que lo restringe únicamente al tablero de bocetos (`DESIGNER_MANAGER` sigue sin poder entrar a Configuración en absoluto).
- Borrar se bloquea si la categoría está asignada a alguna solicitud (sugiere desactivar, mismo criterio que `LeadLabelDefinitionsService.remove()`).

`categoryIds: string[]` en `POST /design-board/requests` (al crear) y `PATCH /design-board/requests/:id` (al editar, **reemplaza el set completo** -- mandar `[]` las quita todas, omitir el campo las deja como estaban). Se valida que cada id exista y esté activo (`DesignRequestCategoriesService.assertActiveCategoryIds()`) antes de tocar nada. Editar las categorías de una solicitud cuenta como campo cambiado para `DESIGN_REQUEST_UPDATED` (ver sección de Notificaciones más arriba) -- avisa al diseñador asignado igual que editar título/instrucciones/país/tipo.

`listRequests()`/`getRequestDetail()` devuelven `categories: DesignRequestCategory[]` (aplanado, sin el wrapper de la tabla de asignación `DesignRequestCategoryAssignment`).

UI: `components/design-board/category-multi-select.tsx` (selector reusado en `create-design-request-dialog.tsx` y `design-request-detail-dialog.tsx`); `components/dashboard/design-request-categories-panel.tsx` (CRUD, pestaña "Categorías" en Configuración, visible solo con `canSeeAdminScreens`).

## Reenviar al lead

`POST /requests/:id/attachments/:attachmentId/forward` (`ADMIN` o `SALES` dueña). Busca el adjunto por `designRequestId` o dentro de un comentario de la misma solicitud (el boceto terminado suele quedar en un comentario del diseñador, no en los adjuntos de entrada de la comercial).

- Si la ventana de servicio de WhatsApp (24h) está abierta: `OutboundService.sendMediaMessage()` (mensaje libre).
- Si está cerrada: plantilla genérica según tipo de archivo (`boceto_jpg2` para imagen, `boceto_pdf` para documento), inyectando el archivo real como override del header.
- Marca `forwardedToLeadAt` en el adjunto.
- Si `column.isFinal`, aplica la label `BOCETO_ENVIADO` (ver arriba).

## Reportes

`GET /design-board/reports/summary?dateFrom&dateTo` (`ADMIN`, `DESIGNER_MANAGER`, `SALES_MANAGER`): devuelve los **últimos 3 meses separados** (el mes de `dateTo` es el más reciente de los 3), cada uno con `completedCount`, `approvedCount`, `approvalRate`, `approvedByCountry`, `byCreator` (por comercial) y `byDesigner` (por diseñador asignado, con el detalle de títulos). `byDesigner` se omite (`[]`) cuando el rol es `SALES_MANAGER` — esa pestaña de la SPA no es para ese rol.

Pedido explicito del usuario, 28/oct/2026: cada mes incluye además `byCategory: { categoryId, completedCount }[]` -- cantidad de solicitudes **terminadas** (misma cohorte `completedAt` del mes) por categoría, vía `designRequestCategoryAssignment.groupBy({ by: ['categoryId'] })`. Una solicitud puede tener varias categorías a la vez (N:M), así que la suma de `byCategory` no tiene por qué coincidir con `completedCount` del mes. Misma visibilidad que `byDesigner`: se omite (`[]`) para `SALES_MANAGER`.

`GET /design-board/reports/my-approval-rate` (`SALES`): tasa de aprobación personal del comercial, últimos 3 meses.

Cuentan el histórico completo, incluidas las tarjetas ya archivadas desde "Aprobados" — el archivado solo las saca del tablero visual.

## Tiempo real

`GET /design-board/events` (SSE), reusa `ChatEventsService` (RabbitMQ + SSE), eventos `design_request.created`/`.moved`/`.commented`/`.updated` con payload liviano (solo IDs) — el cliente debe reconsultar por REST. Solo filtra por `accountId` para `SALES`; el resto de roles recibe todo y confía en la visibilidad de cada endpoint REST.

Distinto (y complementario) a esto: las notificaciones in-app persistentes (campanita), ver abajo.

## Notificaciones in-app (campanita)

Patrón Observer (`EventEmitter2`): `DesignBoardService` solo emite eventos de dominio (`DESIGN_REQUEST_EVENTS`, en `events/design-board.events.ts`) y no sabe quién los consume. `DesignRequestNotificationsListener` (`src/modules/notifications/listeners/design-request-notifications.listener.ts`) es el único lugar que decide destinatario y mensaje, vía `NotificationsService.createNotification()` (con `dedupeKey` para no duplicar la misma alerta).

| Evento | Se dispara cuando... | Destinatario(s) |
|---|---|---|
| `DESIGN_REQUEST_READY` | La tarjeta llega a "Terminado" (`isFinal`) | La comercial que creó la solicitud |
| `DESIGN_REQUEST_COMMENTED` | Nuevo comentario | "La otra parte": si comenta Diseño, avisa a la comercial creadora; si comenta cualquier otro rol, avisa al diseñador asignado |
| `DESIGN_REQUEST_SENT_TO_MODIFICATION` | `sendToModification()` | El diseñador asignado |
| `DESIGN_REQUEST_APPROVED` | `approve()`/`approveByLabel()` | El diseñador asignado + TODO `DESIGNER_MANAGER` activo |
| `DESIGN_REQUEST_IN_REVIEW` | La tarjeta entra a "En revisión" (`isInReview`) | TODO `DESIGNER_MANAGER` activo |
| `DESIGN_REQUEST_UPDATED` | **Pedido explicito del usuario, 27/oct/2026**: `updateRequest()` edita título/instrucciones/país/tipo | El diseñador asignado (si hay uno, y si quien edita no es la misma persona asignada) |

`DESIGN_REQUEST_UPDATED` lleva `changedFields` (los campos que de verdad cambiaron, ver los `if (dto.X !== undefined)` de `updateRequest()`) para armar un mensaje legible ("Se editó: título, instrucciones.") sin que el listener tenga que releer la solicitud. Si no hay diseñador asignado todavía, se omite — no hay a quien avisar.

Requiere el valor `DESIGN_REQUEST_UPDATED` en el enum `AppNotificationType` (migración `20261027120000_design_request_updated_notification`) — como con cualquier cambio de enum de Prisma, hace falta `prisma generate`/`migrate deploy` antes de que el código compile y la base lo acepte.

## UI (Fenix-SPA)

`app/dashboard/bocetos/page.tsx`: tablero + pestañas "Tablero" / "Reportes y estadísticas" (`canViewReports` = `DESIGNER_MANAGER`/`ADMIN`/`SALES_MANAGER`) / "Por diseñador" (`canViewDesignerReport` = solo `DESIGNER_MANAGER`/`ADMIN`) / "Por categoría" (pedido explicito del usuario, 28/oct/2026; `canViewCategoryReport` = solo `DESIGNER_MANAGER`/`ADMIN`, igual que "Por diseñador"). Componentes en `components/design-board/`: `design-request-card.tsx`, `design-request-detail-dialog.tsx`, `create-design-request-dialog.tsx` (botón en el chat del lead), `design-board-reports.tsx`, `designer-completion-report.tsx`, `category-completion-report.tsx` (mismo patrón que `designer-completion-report.tsx` pero resolviendo nombre/color de categoría vía `designRequestCategoriesApi.list()` en vez de `useUserCache`).

Filtros del tablero disponibles para `DESIGNER_MANAGER`/`ADMIN` (`canManage`): por diseñador asignado, por comercial creadora, y (pedido explicito del usuario, 27/oct/2026) **"Sin asignar"** — un checkbox que pide `unassignedOnly: true` (`GET /design-board/requests?unassignedOnly=true`, mapeado a `assignedUserId: null` en `visibilityWhere()`); mutuamente excluyente con el filtro por diseñador (se deshabilita/limpia al activar "Sin asignar", y el backend prioriza `unassignedOnly` si llegaran los dos filtros a la vez).

## Pendientes conocidos

- Crear la label personalizada "Boceto enviado" desde Configuración > Etiquetas (no viene sembrada).
- El formulario "Crear boceto" no permite adjuntar mensajes/archivos ya existentes del chat (`kind: 'FROM_CHAT'`) todavía, aunque el backend lo soporta.
- El filtro "por comercial" del tablero se llena solo con los comerciales presentes en la vista actual, no con el catálogo completo de `SALES` (limitación de `GET /users` para `DESIGNER_MANAGER`).

Ver ADR completo (histórico de diseño, decisiones y alcance de cada submódulo) en el proyecto Claude "Fenix": `adr-004-modulo-bocetos-diseno.md`.
