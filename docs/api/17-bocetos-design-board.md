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

## Etiquetas de lead relacionadas (ver doc 03 para el catálogo completo)

| Momento | Label aplicada | Tipo |
|---|---|---|
| Al crear la solicitud | `BOCETO_EN_PROCESO` | Sistema |
| Si se vence el plazo | `BOCETOS_ATRASADOS` | Sistema |
| Al reenviar el boceto terminado al lead, mientras sigue en "Terminado" | `BOCETO_ENVIADO` | **Personalizada** — hay que crearla desde Configuración > Etiquetas antes de que tenga efecto; si no existe, el reenvío de WhatsApp igual se manda, solo que no se etiqueta (se loguea un warning). |
| Al aprobar (botón o etiqueta `BOCETO_APROBADO` puesta manualmente) | `BOCETO_APROBADO` | Sistema |

`Lead.currentLabel` es un valor único: aplicar una label nueva reemplaza/oculta la anterior, sin tener que "quitarla" aparte. Por eso reenviar no pisa `BOCETO_APROBADO` si la tarjeta ya está en "Aprobados" (`forwardAttachment()` solo aplica `BOCETO_ENVIADO` mientras `column.isFinal`).

`BOCETO_APROBADO` además dispara lógica propia: `LeadsController.setLabel()` llama a `DesignBoardService.approveByLabel(accountId, leadId)` **antes** de aplicar la etiqueta — busca una solicitud en `isFinal` con `approvedAt: null`; si no hay ninguna, bloquea la etiqueta (`BadRequestException`); si hay, mueve la tarjeta a "Aprobados" (`approvedViaLabel: true`).

## Reenviar al lead

`POST /requests/:id/attachments/:attachmentId/forward` (`ADMIN` o `SALES` dueña). Busca el adjunto por `designRequestId` o dentro de un comentario de la misma solicitud (el boceto terminado suele quedar en un comentario del diseñador, no en los adjuntos de entrada de la comercial).

- Si la ventana de servicio de WhatsApp (24h) está abierta: `OutboundService.sendMediaMessage()` (mensaje libre).
- Si está cerrada: plantilla genérica según tipo de archivo (`boceto_jpg2` para imagen, `boceto_pdf` para documento), inyectando el archivo real como override del header.
- Marca `forwardedToLeadAt` en el adjunto.
- Si `column.isFinal`, aplica la label `BOCETO_ENVIADO` (ver arriba).

## Reportes

`GET /design-board/reports/summary?dateFrom&dateTo` (`ADMIN`, `DESIGNER_MANAGER`, `SALES_MANAGER`): devuelve los **últimos 3 meses separados** (el mes de `dateTo` es el más reciente de los 3), cada uno con `completedCount`, `approvedCount`, `approvalRate`, `approvedByCountry`, `byCreator` (por comercial) y `byDesigner` (por diseñador asignado, con el detalle de títulos). `byDesigner` se omite (`[]`) cuando el rol es `SALES_MANAGER` — esa pestaña de la SPA no es para ese rol.

`GET /design-board/reports/my-approval-rate` (`SALES`): tasa de aprobación personal del comercial, últimos 3 meses.

Cuentan el histórico completo, incluidas las tarjetas ya archivadas desde "Aprobados" — el archivado solo las saca del tablero visual.

## Tiempo real

`GET /design-board/events` (SSE), reusa `ChatEventsService` (RabbitMQ + SSE), eventos `design_request.created`/`.moved`/`.commented`/`.updated` con payload liviano (solo IDs) — el cliente debe reconsultar por REST. Solo filtra por `accountId` para `SALES`; el resto de roles recibe todo y confía en la visibilidad de cada endpoint REST.

## UI (Fenix-SPA)

`app/dashboard/bocetos/page.tsx`: tablero + pestañas "Tablero" / "Reportes y estadísticas" (`canViewReports` = `DESIGNER_MANAGER`/`ADMIN`/`SALES_MANAGER`) / "Por diseñador" (`canViewDesignerReport` = solo `DESIGNER_MANAGER`/`ADMIN`). Componentes en `components/design-board/`: `design-request-card.tsx`, `design-request-detail-dialog.tsx`, `create-design-request-dialog.tsx` (botón en el chat del lead), `design-board-reports.tsx`, `designer-completion-report.tsx`.

## Pendientes conocidos

- Crear la label personalizada "Boceto enviado" desde Configuración > Etiquetas (no viene sembrada).
- El formulario "Crear boceto" no permite adjuntar mensajes/archivos ya existentes del chat (`kind: 'FROM_CHAT'`) todavía, aunque el backend lo soporta.
- El filtro "por comercial" del tablero se llena solo con los comerciales presentes en la vista actual, no con el catálogo completo de `SALES` (limitación de `GET /users` para `DESIGNER_MANAGER`).

Ver ADR completo (histórico de diseño, decisiones y alcance de cada submódulo) en el proyecto Claude "Fenix": `adr-004-modulo-bocetos-diseno.md`.
