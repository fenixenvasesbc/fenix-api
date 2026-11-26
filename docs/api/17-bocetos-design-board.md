# Bocetos: tablero de solicitudes de diseño

## Objetivo funcional

Tablero Kanban (tipo Jira) para que una comercial (`SALES`) pida un boceto a Diseño directamente desde el chat de un lead, y el equipo de Diseño (`DESIGNER`/`DESIGNER_MANAGER`) lo gestione con columnas, plazos en días hábiles, pausa, comentarios con adjuntos, reenvío al lead y reportes. Es **un solo tablero global** (`DesignBoard`), compartido por todas las cuentas comerciales.

Módulo: `src/modules/design-board/`. Endpoints: ver doc 09.

Países de una solicitud (`DesignRequestCountry`): `ES` (por defecto), `FR`, `IT`, `DE` y `CH` (Suiza, desde el 22/nov/2026; también lo usan las familias de inversión del doc 19).

## Roles

| Rol | Alcance |
|---|---|
| `SALES` / `SALES_MANAGER` (tratado igual que `SALES` en este módulo) | Crea solicitudes; ve Nuevos, Modificación, Terminado, Aprobados (desde 30/oct/2026) y En revisión (desde 16/nov/2026) -- siempre solo sus propias tarjetas. Aprueba/envía a modificación/reenvía sus propias tarjetas; en "Aprobados" y "En revisión" es solo lectura (mover/archivar sigue siendo exclusivo de `DESIGNER`/`DESIGNER_MANAGER`/`ADMIN`). Desde 16/nov/2026, aprobar además exige haber marcado antes al menos un adjunto como "versión aprobada". **Desde 26/nov/2026**: aunque ve la tarjeta en "En revisión", **no puede abrir su detalle** (`getRequestDetail()` rechaza con `ForbiddenException` -- ver sección "En revisión: tarjeta visible, detalle bloqueado" más abajo). `SALES_MANAGER` además ve las pestañas "Reportes y estadísticas" e "Informe semanal" (no "Por diseñador"). Desde 20/nov/2026, `SALES` puro (no `SALES_MANAGER`) ve encima del tablero el widget "Bocetos terminados sin aprobar (últimos 3 meses)" -- única estadística pensada para ese rol. |
| `DESIGNER` | Ve todas las columnas excepto "Aprobados"; solo sus tarjetas asignadas; mueve ±1. |
| `DESIGNER_MANAGER` | Asigna diseñador, ve "Aprobados" (solo lectura: desde 05/nov/2026 ya **no** puede aprobar, ver más abajo), pausa/reanuda, archiva, ve reportes y "Por diseñador". Login restringido únicamente a este módulo. |
| `ADMIN` | Todo lo anterior sin restricción. |

## Columnas (tablero por defecto)

Nuevos(0) → Modificación(1, oculta del flujo normal) → En revisión(2) → Terminado(3, `isFinal`) → Aprobados(4, `isApproved`).

- El movimiento normal es `PATCH /requests/:id/move`, ±1, saltando la columna "Modificación" salvo que la tarjeta ya esté en ella.
- El único camino para entrar a "Modificación" es `POST /requests/:id/send-to-modification`, solo desde `isFinal`. Reinicia el plazo a `modificationSlaBusinessDays` (1 día hábil por defecto).
- "Aprobados" solo es visible para `DESIGNER_MANAGER`/`ADMIN`; `archive()` (`POST /requests/:id/archive`) la saca del tablero sin borrar datos (sigue contando en reportes).

## Plazos (SLA) en días hábiles

`BusinessDaysService.computeBusinessDueAt()` (pedido explicito del usuario, 28/oct/2026: periodos reales de 24h hábiles, no conteo inclusivo): el día en que entra la solicitud **nunca** cuenta como parte del plazo. Corte a las 14:00 hora España: si el ancla es antes del corte, el día real de entrada es el "día efectivo"; si es en o después, se trata como si hubiera entrado el día calendario siguiente. Desde el día calendario siguiente al "día efectivo" se cuentan N días hábiles (el primero = 24h, el segundo = 48h, etc; 3 al crear por defecto, el valor de la columna al entrar a "Modificación"), saltando fines de semana y `PublicHoliday`; `dueAt` es el último de esos días a las 14:00.

Ejemplo: entra miércoles antes de las 14:00, plazo de 3 días hábiles → jueves = 24h, viernes = 48h, el siguiente día hábil (lunes, saltando sábado/domingo) = 72h → `dueAt` es ese lunes a las 14:00.

**Nota sobre plazos de 1 día** (MOD/REPET_MOD/REPET_ANADE/"Modificación"): con el criterio anterior (06/oct/2026) hacía falta forzar el salto al día hábil siguiente sin importar la hora del ancla, porque si no el plazo real podía ser de apenas minutos. Con el criterio de 24h reales esa garantía ya es automática para cualquier plazo, así que esa excepción se eliminó — el corte de las 14:00 ahora se respeta igual para plazos de 1 día que para cualquier otro.

Semáforo (`DesignBoardService.withSlaStatus()`, calculado al leer, no persistido):

- 🟢 verde: más de 1 día hábil para `dueAt`.
- 🟠 naranja: 1 día hábil o menos, no vencida.
- 🔴 rojo: vencida.
- Si `pausedAt` no es nulo, el color queda congelado en el que tenía al pausar.

Cron `DesignRequestSlaSchedulerService` (cada hora): aplica `BOCETOS_ATRASADOS` una sola vez por solicitud vencida y no pausada (`overdueLabelAppliedAt` como dedupe).

Pausa (`POST /requests/:id/pause` / `.../resume`, `DESIGNER_MANAGER`/`ADMIN` y, desde 26/nov/2026 -- pedido explícito del usuario --, el **diseñador asignado** a esa solicitud, acotado por `assertCanView()` para que no pueda pausar/reanudar las de otro diseñador): al reanudar, `dueAt` se desplaza hacia adelante por el tiempo real (ms) que estuvo pausada — no se recalculan días hábiles parciales.

**Plazo según tipo de solicitud** (`resolveCreationSlaBusinessDays()`, usado al crear y al editar `requestType`): `BOCETO` (default) = 3 días hábiles del tablero; `MOD`/`REPET_MOD`/`REPET_ANADE` = 1 día hábil; `REPET_BOCETO` = 2 días hábiles. Además, si el tipo es `BOCETO` y la **descripción** menciona uno de estos productos (plazo extendido): vaso(s), pala(s), panini(s), "hamburguesa folding", ensaladera(s) → 4 días hábiles en vez de 3.

**Fix 28/oct/2026 (reportado por el usuario)**: la detección de esos productos en la descripción usaba `String.includes()` (substring plano) sobre palabras cortas como "pala" — substring de palabras comunes del castellano ("palabra", "paladar", "palacio", "paliar"...), así que una descripción que solo mencionara, por ejemplo, "revisar la palabra del eslogan" disparaba el plazo extendido de 4 días por error. Caso real: tres bocetos creados el mismo día/hora con `dueAt` distinto (dos en 3 días hábiles, uno en 4). Fix: `buildExtendedSlaKeywordPattern()` usa un regex con límite de palabra (`\b...\bs?\b`, admite plural: "vasos", "palas") en vez de substring suelto.

## Etiquetas de lead relacionadas (ver doc 03 para el catálogo completo)

| Momento | Label aplicada | Tipo |
|---|---|---|
| Al crear la solicitud | `BOCETO_EN_PROCESO` | Sistema |
| Si se vence el plazo | `BOCETOS_ATRASADOS` | Sistema |
| Al reenviar el boceto terminado al lead, mientras sigue en "Terminado" | `BOCETO_ENVIADO` | **Personalizada** — hay que crearla desde Configuración > Etiquetas antes de que tenga efecto; si no existe, el reenvío de WhatsApp igual se manda, solo que no se etiqueta (se loguea un warning). |
| Al aprobar desde el tablero (único camino desde 16/nov/2026, ver más abajo) | `BOCETO_APROBADO` | Sistema |
| Al enviar de "Terminado" a "Modificación" (el lead pide cambios) | `BOCETO_EN_PROCESO` (de nuevo) | Sistema |

Las 3 son **mutuamente excluyentes**: representan el estado actual del boceto para ese lead, nunca debe haber más de una activa a la vez. Esto NO lo garantiza `LeadsService.setLabel()` por sí solo — solo marca la nueva como activa, nunca desactiva (`removedAt`) la anterior; `Lead.currentLabel` es un valor único, pero el frontend (`activeLeadLabels()`) lee primero `LeadLabelAssignment` (todas las activas), así que una etiqueta vieja sin desactivar sigue apareciendo igual.

Por eso `DesignBoardService` tiene un helper dedicado, `applyBocetoStageLabel(accountId, leadId, label, changedByUserId)`: aplica la etiqueta nueva y desactiva (`removeLabel()`) las otras dos de la lista `BOCETO_STAGE_LABELS`. Si aplicar la nueva falla (ej. `BOCETO_ENVIADO` todavía no se creó como etiqueta personalizada), no desactiva las demás — el lead se queda en el estado anterior en vez de sin ninguna. Lo usan `createRequest()`, `approve()`, `forwardAttachment()` y `sendToModification()` -- es decir, todos los caminos legítimos que pueden tocar estas 3 etiquetas, ya que desde 16/nov/2026 ya no existe un camino alternativo por fuera de `DesignBoardService` (ver nota de `approveByLabel()` abajo).

Caso de referencia que motivó esto: boceto terminado → se reenvía (`BOCETO_ENVIADO`) → el lead pide cambios → `sendToModification()` → vuelve a "Terminado" → se reenvía otra vez. Sin este mecanismo, `BOCETO_ENVIADO` se quedaba pegada para siempre tras el primer reenvío, con el riesgo de disparar por error una automatización (`LabelMessageRule`) atada a esa etiqueta aunque el boceto ya no estuviera enviado de verdad.

**Eliminado 16/nov/2026, pedido explícito del usuario**: hasta esa fecha, poner la etiqueta `BOCETO_APROBADO` a mano desde el chat disparaba `DesignBoardService.approveByLabel()` (ADR-004 Submódulo 2, "aprobación automática por etiqueta"), que aprobaba el boceto sin pasar por el tablero. Ese método se eliminó por completo: `LeadsController.setLabel()` ahora bloquea `BOCETO_APROBADO` de forma **incondicional** (`ForbiddenException`, el label nunca llega a guardarse), y el catálogo que devuelve `GET /lead-label-definitions` incluye un campo calculado `manuallyAssignable` (`false` solo para `BOCETO_APROBADO`) para que la SPA deshabilite esa opción en los selectores "Agregar label" en vez de dejar que el usuario la elija y reciba el error recién al guardar. La única forma de que un lead termine con `BOCETO_APROBADO` activo es que su solicitud se apruebe desde el tablero (`POST .../approve`, que aplica la etiqueta via `applyBocetoStageLabel()`).

## Categorías (Configuración > Categorías)

Pedido explicito del usuario, 27/oct/2026: una solicitud puede tener una o varias **categorías** (`DesignRequestCategory`) -- catálogo **GLOBAL**, deliberadamente **APARTE** de las labels de lead (`LeadLabelDefinition`, doc 03). No tienen `code`, no son "de sistema", y no disparan ninguna automatización (`LabelMessageRule`, alertas in-app); son solo clasificación/filtro manual de solicitudes de boceto (ej. "Urgente", "Cliente VIP", "Rediseño").

- `GET /design-request-categories`: cualquier rol del módulo (`ADMIN`, `SALES`, `SALES_MANAGER`, `DESIGNER`, `DESIGNER_MANAGER`) -- lo necesitan para los selectores de "Crear boceto" y el detalle de la solicitud.
- `POST` / `PATCH /:id` / `DELETE /:id`: **solo `ADMIN`** (y, por `ROLE_INHERITANCE`, `SUPPORT`). A diferencia de las labels de lead (donde `SALES_MANAGER` también puede), aquí **no** se le da acceso a `DESIGNER_MANAGER` -- decisión explícita del usuario al pedir esta funcionalidad, para no romper el aislamiento del ADR-004 que lo restringe únicamente al tablero de bocetos (`DESIGNER_MANAGER` sigue sin poder entrar a Configuración en absoluto).
- Borrar se bloquea si la categoría está asignada a alguna solicitud (sugiere desactivar, mismo criterio que `LeadLabelDefinitionsService.remove()`).

`categoryIds: string[]` en `POST /design-board/requests` (al crear) y `PATCH /design-board/requests/:id` (al editar, **reemplaza el set completo** -- mandar `[]` las quita todas, omitir el campo las deja como estaban). Se valida que cada id exista y esté activo (`DesignRequestCategoriesService.assertActiveCategoryIds()`) antes de tocar nada. Editar las categorías de una solicitud cuenta como campo cambiado para `DESIGN_REQUEST_UPDATED` (ver sección de Notificaciones más arriba) -- avisa al diseñador asignado igual que editar título/instrucciones/país/tipo.

`listRequests()`/`getRequestDetail()` devuelven `categories: DesignRequestCategory[]` (aplanado, sin el wrapper de la tabla de asignación `DesignRequestCategoryAssignment`).

UI: `components/design-board/category-multi-select.tsx` (selector reusado en `create-design-request-dialog.tsx` y `design-request-detail-dialog.tsx`); `components/dashboard/design-request-categories-panel.tsx` (CRUD, pestaña "Categorías" en Configuración, visible solo con `canSeeAdminScreens`).

### Aprobación parcial por categoría (21/nov/2026)

Pedido explicito del usuario: una solicitud con varias categorías puede quedar aprobada solo en ALGUNAS de ellas (ejemplo del pedido: solicitud con envío, vasos y bolsas donde el cliente aprueba vasos y bolsas pero rechaza cajas) -- antes, aprobar la solicitud entera sumaba "aprobada" por igual a las 4 categorías en el reporte "Por categoría", sin forma de distinguir cuál quedó realmente fuera.

- `DesignRequestCategoryAssignment.approved` (boolean, default `true`, migración `20261121110000_design_request_category_approved`). Vive en el join solicitud↔categoría, **no** en la solicitud ni en la categoría del catálogo -- es el estado de ESA categoría dentro de ESA solicitud en particular.
- Default `true` porque, como dice el pedido, "por defecto se suelen aprobar todas" -- al crear/editar `categoryIds` (sección de arriba), cada asignación nueva nace aprobada; nada cambia si nunca se usa `rejectedCategoryIds`.
- `POST /design-board/requests/:id/approve` acepta ahora, además de `approvedAttachmentIds`, un `rejectedCategoryIds?: string[]` -- las categorías de ESTA solicitud que el cliente NO aceptó (el resto queda/vuelve a quedar aprobada). Se valida que cada id pertenezca a una categoría ya asignada a la solicitud antes de tocar nada (`BadRequestException` si no). Dentro de la misma transacción que mueve la tarjeta a "Aprobados", `approve()` **re-escribe el estado de TODAS** las asignaciones de la solicitud (no solo las rechazadas) -- mismo criterio que ya usaba para `isApprovedVersion` de los adjuntos: así, si la tarjeta vuelve a "Modificación" y se re-aprueba después, la decisión de esa segunda llamada manda y no quedan rechazos de un intento anterior pegados por error.
- No dispara ningún flujo adicional (sin reapertura, sin notificación, sin mover nada aparte) -- la tarjeta sigue teniendo un único `approvedAt`/columna "Aprobados"; esto es puramente el dato que usa el reporte "Por categoría" para separar, dentro de una misma solicitud aprobada, cuáles categorías quedaron aprobadas y cuáles no.
- `listRequests()`/`getRequestDetail()`/`searchArchive()`/`createRequest()` (los 4 lugares que aplanan `categories`) ahora devuelven cada categoría con su `approved` incluido: `{ ...category, approved }`.
- Reporte "Por categoría" (`byCategory`, ver sección "Reportes" más abajo): `approvedCount` ahora cuenta por `DesignRequestCategoryAssignment.approved = true` (y la solicitud aprobada en el periodo), en vez de heredarlo de `request.approvedAt` sin distinguir -- así una categoría rechazada dentro de una solicitud aprobada cuenta como "no aprobada", no como "aprobada".
- Datos históricos: la migración no toca ninguna fila -- al tener `DEFAULT true`, toda asignación existente (de solicitudes aprobadas o no) queda en `true`. Para una solicitud aprobada antes de este cambio, esto reproduce exactamente el comportamiento anterior (todas sus categorías contaban como aprobadas); no hay reportes de meses pasados con huecos.
- UI (`Fenix-SPA`, `design-request-detail-dialog.tsx`): al aprobar (botón "Aprobar" o moviendo la tarjeta a "Aprobados" desde el selector de columna), se muestra un checklist con las categorías de la solicitud, todas marcadas por defecto -- la comercial desmarca las que el cliente no aceptó antes de confirmar. Una vez aprobada, el bloque de categorías del detalle muestra las rechazadas tachadas (`category.approved === false`), para que quede visible sin tener que ir al reporte.

## Versión aprobada (marcado de adjuntos) y archivo histórico

Pedido explicito del usuario, 28/oct/2026: el Jefe de Diseño (`DESIGNER_MANAGER`) necesitaba ver rápido, entre todos los adjuntos de una solicitud (los que se suben a la tarjeta y los que se van subiendo en comentarios de revisión), cuál es el archivo que el cliente aprobó realmente -- eso se pierde entre tantos comentarios. Solo lo sabe la comercial que habló con el cliente, así que es un **marcado explícito**, nunca inferido automáticamente (ni "el último adjunto", ni "el del comentario más reciente").

- `DesignRequestAttachment.isApprovedVersion` (boolean, default `false`, migración `20261028140000_design_request_attachment_approved_version`). Puede haber más de un adjunto marcado por solicitud (ej. frontal y trasero de un mismo diseño).
- `PATCH /design-board/requests/:id/attachments/:attachmentId/approved-version` body `{ approved: boolean }` -- marca/desmarca. Mismo criterio de permisos que "Reenviar al lead": solo la comercial propietaria de la solicitud (dueña, no cualquier `SALES`) o `ADMIN`. El Jefe de Diseño **nunca** puede marcarlo, solo consultar el resultado -- él no estuvo en la conversación con el cliente.
- `POST /design-board/requests/:id/approve` acepta opcionalmente `{ approvedAttachmentIds?: string[] }` -- permite marcar de una vez al momento de aprobar desde el tablero. Es opcional cuando ya se marcó antes desde el detalle (estrella); el marcado también puede hacerse después con el endpoint de arriba. Si se manda, valida que cada id sea un adjunto real de esa solicitud (tarjeta o comentario) antes de tocar nada, y la selección de esa llamada **reemplaza** cualquier marcado anterior de esa misma solicitud.
- **Permiso de `POST .../approve` (05/nov/2026, pedido explícito del usuario)**: aprobar es exclusivo de la comercial dueña de la solicitud (o `ADMIN`) -- antes `DESIGNER_MANAGER` también podía aprobar igual que ellos, ahora `ForbiddenException` para el Jefe de Diseño. Su rol en el flujo sigue terminando en mover la tarjeta a "Terminado" (y sigue pudiendo "Enviar a modificación", eso no cambió); de ahí en más, aprobar es decisión exclusiva de la comercial, únicamente desde este endpoint (ver 16/nov/2026 más abajo sobre la eliminación del camino por etiqueta).
- **Exigencia de "versión aprobada" al aprobar (16/nov/2026, pedido explícito del usuario)**: `POST .../approve` ahora rechaza con `BadRequestException` si la solicitud no tiene ningún adjunto marcado con `isApprovedVersion = true` -- la comercial tiene que haber marcado al menos uno (estrella en el detalle, o mandando `approvedAttachmentIds` en el mismo llamado a `approve()`) antes de poder aprobar. Si `approvedAttachmentIds` viene con al menos un id en esta misma llamada, alcanza (se van a marcar dentro de la misma transacción, no hace falta que ya estuviera marcado de antes). En la SPA, `canApprove`/`columnActions.APPROVED` (`design-request-detail-dialog.tsx`) ahora también exigen `approvedVersionAttachments.length > 0`; si falta, el botón "Aprobar" se oculta y se muestra un texto explicando qué falta, en vez de dejar que el usuario lo intente y reciba el error del backend.
- **Eliminación de la aprobación por etiqueta (16/nov/2026, mismo pedido)**: ya no existe ningún camino alternativo para aprobar -- `approveByLabel()` (ADR-004 Submódulo 2) fue eliminado por completo, y `LeadsController.setLabel()` bloquea `BOCETO_APROBADO` de forma incondicional (ver sección "Etiquetas de lead relacionadas" más arriba). Aprobar es, desde esta fecha, posible **únicamente** desde este endpoint.
- `listRequests()`/`getRequestDetail()` no cambian su forma -- `isApprovedVersion` viene incluido en cada adjunto como cualquier otro campo escalar; la SPA filtra client-side para la sección "Versión aprobada" del detalle (`design-request-detail-dialog.tsx`).

### Buscador de archivo histórico

`GET /design-board/requests/archive/search` (`ADMIN`/`DESIGNER_MANAGER` únicamente, mismo criterio que "Aprobados"): buscador de bocetos **archivados** ("marcados como hechos" desde Aprobados), deliberadamente **separado** de `GET /design-board/requests` (`listRequests()`/`ListDesignRequestsQueryDto`) -- ese endpoint está pensado para el tablero del día a día (mes actual por defecto, sin paginación porque siempre queda acotado a un mes) y mezclar ahí la semántica de "sin límite de fecha salvo que se pida" habría sido fragil para los dos casos.

Filtros (`SearchArchivedDesignRequestsQueryDto`, todos opcionales): `search` (título/instrucciones, contains insensible a mayúsculas), `requestType`, `categoryId`, `createdByUserId`, `assignedUserId`, `country`, `dateFrom`/`dateTo` (`YYYY-MM-DD`, sobre `archivedAt`). Si no se manda ningún rango de fechas, **no hay límite de fecha** -- ese es justo el punto de este buscador frente al tablero normal. Paginado (`page`/`limit`, default `limit=25`, máximo `100`) porque puede acumular años de histórico.

Cada resultado incluye `approvedVersionAttachments` (atajo ya aplanado: adjuntos de tarjeta + comentarios con `isApprovedVersion=true`), para no repetir esa lógica del lado del cliente.

UI: pestaña "Archivo" en `app/dashboard/bocetos/page.tsx` (`components/design-board/design-request-archive-search.tsx`), **oculta por defecto** -- es su propia pestaña, nunca mezclada con "Tablero", y solo visible para `DESIGNER_MANAGER`/`ADMIN` (`canManage`). Cada resultado abre el mismo diálogo de detalle que el tablero.

### Descarga: uno por uno, no en zip

Pedido explicito del usuario: la descarga de los archivos de la versión aprobada es **individual** (un link `<a download>` por archivo, igual que el resto de adjuntos del módulo), no un zip -- el Jefe de Diseño guarda cada archivo donde le conviene (carpetas distintas según el archivo), algo que un zip único le quitaría.

## Buscador GLOBAL de bocetos

Pedido explícito del usuario, 24/nov/2026: un buscador que, a diferencia del filtro de título del tablero (`GET /design-board/requests?title=...`, acotado al mes/estado visible ahí mismo), busque por título **o instrucciones** entre **todas** las solicitudes del sistema que el usuario pueda ver -- cualquier mes, archivadas o no. Deliberadamente un tercer mecanismo, separado tanto de `listRequests()` (tablero del día a día) como de `searchArchive()` (archivo histórico, exclusivo `DESIGNER_MANAGER`/`ADMIN`):

- `GET /design-board/requests/search/quick` (`ADMIN`, `SALES`, `DESIGNER`, `DESIGNER_MANAGER` -- **todos** los roles del módulo, a diferencia de `archive/search`). Query `search` (string, requerido, 1-200 caracteres) vía `QuickSearchDesignRequestsQueryDto`.
- Visibilidad: reusa `visibilityWhere(user)`, igual que el tablero -- `SALES` solo encuentra sus propias solicitudes, `DESIGNER` solo las suyas asignadas, `DESIGNER_MANAGER`/`ADMIN` sin restricción. No admite los filtros adicionales del tablero (asignado/creador/sin asignar), solo texto libre.
- Sin `archivedAt: null` ni filtro de fecha/mes: busca en cualquier estado, igual de "sin límite de fecha" que `searchArchive()`, pero sobre **todas** las solicitudes (no solo las archivadas).
- Sin paginación -- pensado para alimentar un desplegable mientras se escribe, no una pantalla de listado. Tope fijo de `DesignBoardService.QUICK_SEARCH_RESULT_LIMIT` (20) resultados, ordenados por `createdAt` descendente.
- Respuesta ligera (`DesignRequestQuickSearchResult` en el frontend): `id`, `title`, `requestType`, `country`, `createdAt`, `archivedAt`, `completedAt`, `column` (`id`/`name`/`isFinal`/`isApproved`) y `lead` (`id`/`displayName`/`phoneE164`) -- sin attachments/comments/SLA, para no cargar de más un resultado de búsqueda que solo sirve para elegir-y-abrir.
- Ruta de dos segmentos tras `requests` (`search/quick`), mismo motivo que `archive/search`: no choca con `GET requests/:id`.

UI: `components/design-board/design-request-quick-search.tsx`, un input nuevo con desplegable de resultados debajo (debounce 400ms, cierra al hacer click fuera o `Escape`), ubicado en la cabecera de `app/dashboard/bocetos/page.tsx` -- a propósito **separado** del filtro de título del tablero y fuera de las pestañas (`Tabs`), visible para cualquier rol del módulo. Al elegir un resultado se abre con el mismo mecanismo `?requestId=...`/`setOpenRequestId` que ya usa el resto de la pantalla.

## Navegación lead -> último boceto

`GET /design-board/requests/by-lead/:leadId/latest` (`ADMIN`, `SALES`, `DESIGNER`, `DESIGNER_MANAGER`). Pedido explícito del usuario, 30/oct/2026: desde el chat de un lead, la comercial quiere ir directo al **último** boceto que pidió para ese lead -- no un desplegable con todo el histórico (puede acumular muchos bocetos viejos). Devuelve solo `{ id: string | null }` (el más reciente por `createdAt`, respetando la misma visibilidad que el resto del módulo -- `SALES` solo encuentra algo acá si el boceto es suyo); `null` si el lead no tiene ninguno visible para ese usuario. El frontend abre el detalle completo con ese id reusando el deep-link `?requestId=...` que ya existía en el tablero (`app/dashboard/bocetos/page.tsx`), en una pestaña nueva para no perder el chat -- botón "Último boceto" en el header de `app/dashboard/messages/page.tsx`, junto a "Crear boceto".

**Camino inverso (30/oct/2026)**: desde la card y el detalle de la solicitud, el nombre del lead es un link que navega a `/dashboard/messages?leadId=<leadId>&accountId=<accountId>` (deep-link que `app/dashboard/messages/page.tsx` ya soportaba), reusando el mismo patrón. Solo clickeable para `SALES`/`SALES_MANAGER`/`ADMIN` (los únicos roles con acceso a esa pantalla) -- para `DESIGNER`/`DESIGNER_MANAGER` el nombre se muestra igual que antes, como texto plano, porque su navegación queda restringida únicamente al módulo de bocetos.

## Reenviar al lead

## Comentarios

`POST /design-board/requests/:id/comments` (`AddDesignRequestCommentDto`). Desde el 31/oct/2026, `body` es **opcional** -- el servicio (`addComment()`) exige al menos uno de los dos (`body` con contenido real tras `trim()`, o `attachments` no vacío), para permitir comentar adjuntando solo un archivo, sin texto (pedido explícito del usuario: antes el botón "Comentar" quedaba deshabilitado si no se escribía nada, aunque hubiera un adjunto cargado). Si no llega ninguno de los dos, `BadRequestException`.

UI (`Fenix-SPA`): el textarea de comentario nuevo y el de edición de un comentario existente (`design-request-detail-dialog.tsx`) responden a **Enter** para enviar/guardar (`Shift+Enter` sigue insertando un salto de línea) -- antes solo se podía confirmar con el botón.

## Reenviar al lead

`POST /requests/:id/attachments/:attachmentId/forward` (`ADMIN` o `SALES` dueña). Busca el adjunto por `designRequestId` o dentro de un comentario de la misma solicitud (el boceto terminado suele quedar en un comentario del diseñador, no en los adjuntos de entrada de la comercial).

- Si la ventana de servicio de WhatsApp (24h) está abierta: `OutboundService.sendMediaMessage()` (mensaje libre).
- Si está cerrada: plantilla genérica según tipo de archivo (`boceto_jpg2` para imagen, `boceto_pdf` para documento), inyectando el archivo real como override del header.
- Marca `forwardedToLeadAt` en el adjunto.
- Si `column.isFinal`, aplica la label `BOCETO_ENVIADO` (ver arriba).

### Bug corregido: la bandeja de Fenix mostraba siempre la misma imagen (23/nov/2026)

Reporte del usuario: al reenviar un boceto terminado, WhatsApp recibía el archivo correcto, pero en la bandeja de mensajes de Fenix **siempre se veía la misma imagen**, sin importar cuál adjunto se hubiera reenviado.

**Causa**: solo pasaba cuando la ventana de 24h ya estaba cerrada (camino de plantilla, `forwardAttachmentViaTemplate()`). `boceto_jpg2`/`boceto_pdf` son plantillas únicas, reutilizadas para reenviar bocetos distintos -- el archivo real sí viaja a WhatsApp vía `headerMediaOverride` (eso nunca falló), pero `MessageService.getLeadMessages()` armaba el *preview* de cualquier mensaje `TEMPLATE` leyendo el `payload` genérico guardado en `GlobalWhatsappTemplate` -- el "ejemplo" que Meta guarda al aprobar la plantilla, igual para **todos** los mensajes que usan esa plantilla. El `Message` en sí nunca guardaba el archivo real (`mediaUrl`/`fileName` quedaban `null` para mensajes `TEMPLATE`), así que no había forma de distinguir un reenvío de otro en la bandeja.

**Fix**:
- `OutboundService.sendTemplateMessage()`: cuando el caller pasa `headerMediaOverride`, ahora también se guarda `mediaUrl`/`fileName` en el propio `Message` (antes solo se usaba para armar el `components` que se manda a YCloud). El `expectation` de idempotencia (`clientRequestId`) también incluye estos campos, para que un reintento con el **mismo** `clientRequestId` pero un archivo **distinto** se detecte como conflicto en vez de reusar el mensaje anterior.
- `MessageService.getLeadMessages()`: nuevo helper privado `applyHeaderMediaOverride(payload, message)` -- si el `Message` tiene `mediaUrl` propio, reemplaza `header.example.header_url` del payload genérico de la plantilla por ese archivo real (nunca toca un header `TEXT`, que no tiene media). Sin `mediaUrl` propio (plantillas normales, sin reenvío de bocetos) es un no-op: se sigue devolviendo el ejemplo genérico, como antes de este fix -- sin regresión para el resto de los usos de plantillas (campañas, etc.).
- Tests: `outbound.service.spec.ts` (guarda el archivo real en el `Message`, no pisa el comportamiento de plantillas sin override, detecta reintento con archivo distinto) y `message.service.spec.ts` (el preview usa el archivo real, dos bocetos reenviados por la misma plantilla muestran cada uno su propia imagen, plantillas sin reenvío de boceto no cambian, headers `TEXT` no se tocan).

**Follow-up el mismo día (Fenix-SPA)**: al desplegar el fix de arriba, el header de una plantilla con formato `DOCUMENT` (`boceto_pdf`) pasó a verse **roto** en la bandeja (WhatsApp seguía recibiendo el PDF correcto). Causa: `TemplateMessageContent()` (`app/dashboard/messages/page.tsx`) renderizaba la cabecera de **cualquier** plantilla con un `<img>`, sin mirar el `format` -- funcionaba por casualidad mientras `header_url` era el ejemplo genérico de la plantilla (un jpg de muestra que Meta guarda al aprobarla), pero un PDF real no renderiza dentro de un `<img>`. Fix: ahora `IMAGE` usa `<img>`, `VIDEO` usa `<video>`, y `DOCUMENT` muestra un link descargable (ícono + nombre), igual que `MessageContent()` ya hace para mensajes sueltos tipo `DOCUMENT`. Commit `d836c40` en `Fenix-SPA`.

## Reportes

`GET /design-board/reports/summary?dateFrom&dateTo&createdByUserId&categoryId&mode` (`ADMIN`, `DESIGNER_MANAGER`, `SALES_MANAGER`): por defecto (`mode` ausente o `"months"`) devuelve los **últimos 3 meses separados** (el mes de `dateTo` es el más reciente de los 3), cada uno con `completedCount`, `approvedCount`, `notApprovedCount`, `approvalRate`, `byCountry`, `byCreator` (por comercial) y `byDesigner` (por diseñador asignado, con el detalle de títulos). `byDesigner`/`byCategory` se omiten (`[]`) cuando el rol es `SALES_MANAGER` — esas pestañas de la SPA no son para ese rol.

**Pedido explicito del usuario (apuntes de negocio), 20/nov/2026** — unificación de la antigua pestaña "Por categoría" dentro de "Reportes y estadísticas":
- `createdByUserId`/`categoryId` (ambos opcionales, combinables entre sí) acotan **todo** el desglose del periodo a un comercial y/o categoría puntual (ej.: "¿cuántos bocetos de Caja de envío hizo Lucía en octubre, y cuántos tiene aprobados?"). `categoryId` se ignora silenciosamente para `SALES_MANAGER` (mismo criterio que `byCategory`).
- `mode: "range"` sustituye los 3 meses fijos por un **único periodo libre** `[dateFrom, dateTo]` (ambos requeridos, inclusive -- útil para ver una semana puntual). La respuesta sigue siendo `{ months: [...] }` pero con un solo elemento, `month: null` y `rangeFrom`/`rangeTo` marcando el periodo exacto. `dateFrom`/`dateTo` inválidos o fuera de orden -> `BadRequestException`.
- `byCreator` ahora incluye también `notApprovedCount`.
- `byCategory` pasó de `{ categoryId, completedCount }[]` a `{ categoryId, completedCount, approvedCount, notApprovedCount, approvalRate }[]` -- mismo criterio de "varias categorías por solicitud" que antes (la suma no tiene por qué coincidir con `completedCount` del periodo).
- Implementación: `getReportsSummary()` delega en `reportPeriodBreakdown(range, monthKey, includeByDesigner, includeByCategory, filters)`, un método genérico parametrizado por un rango `{start, end}` cualquiera (mes calendario o rango libre) del que `monthlyReportBreakdown()` es ahora un envoltorio fino.

Pedido explicito del usuario, 04/nov/2026: `byDesigner` solo cuenta solicitudes de tipo `BOCETO`/`REPET_BOCETO` (más las viejas sin `requestType` persistido, tratadas como `BOCETO`) -- las de tipo `MOD`/`REPET_MOD`/`REPET_ANADE` quedan afuera, porque son un ajuste sobre un boceto que ya se contó antes, no un trabajo nuevo del diseñador. El resto del desglose del periodo no cambió -- sigue contando todos los tipos.

**Pedido explicito del usuario, 21/nov/2026:**
- `approvedByCountry` (`{ country, count }[]`, solo aprobados) pasó a `byCountry`: `{ country, completedCount, approvedCount, notApprovedCount, approvalRate }[]` -- mismo shape/criterio que `byCreator`/`byCategory`. Internamente `reportPeriodBreakdown()` agrega una query `completedByCountry` (groupBy por `country` sobre la misma cohorte `completedInRange`) junto a la ya existente `approvedByCountry`, y las mergea igual que `byCreator`.
- SPA: se eliminó el selector "Vista" (Mes a mes / Rango personalizado) de `design-board-reports.tsx`. Ahora **siempre** se pide `mode: 'range'`, con `dateFrom`/`dateTo` anclados a un mes calendario completo (`monthRangeForKey()` en `design-board-utils.ts`) navegado con flechas ← mes → (`shiftMonthKey()`). La flecha "siguiente" se deshabilita cuando el mes elegido es el actual (`isCurrentOrFutureMonthKey()`) -- no se puede mirar un mes que todavía no pasó. Por defecto se carga el mes en curso (antes: últimos 3 meses fijos). El selector Desde/Hasta se conserva para acotar a un sub-rango dentro del mes elegido (p.ej. una semana puntual) -- cada navegación con flechas lo resetea a los límites completos de ese mes, para que ambos selectores queden coherentes entre sí; un sub-rango editado a mano sigue filtrando correctamente vía el `mode: 'range'` ya existente, sin cambios de backend.
- SUPPORT pasa a tener los mismos permisos que ADMIN en **todo** el módulo de bocetos (pedido: "El rol de support debe tener los mismos permisos que el admin en todos los módulos incluyendo el de bocetos"). A nivel de rutas esto ya lo resolvía `ROLE_INHERITANCE` en `roles.guard.ts` (cualquier `@Roles(Role.ADMIN, ...)` del controller ya deja pasar a SUPPORT), pero varios chequeos literales `user.role === Role.ADMIN` dentro de `DesignBoardService` no pasaban por el guard y bloqueaban a SUPPORT igual: `updateRequest`, `deleteRequest`, `assertCanView`, `assign`, `sendToModification`, `deleteComment`, `deleteAttachment`, `approve`, `forwardAttachment`, el marcado de versión aprobada, `searchArchive`, `archive`, `pause`, `resume`, `getReportsSummary` y `getWeeklyApprovalReport`. Se centraliza en un nuevo `isAdminLike(role)` (espejando el `isSalesLike()` ya existente). No toca los permisos EXCLUSIVOS de SUPPORT (p. ej. `LabelMessageRule`), que son chequeos aparte sin relación con ADMIN. En la SPA, el mismo `isAdmin` (antes solo `role === 'ADMIN'`) se amplió a incluir SUPPORT en `app/dashboard/bocetos/page.tsx` y `design-request-detail-dialog.tsx` -- mismo patrón ya usado en el resto del frontend (leads, messages, plantillas, settings, sidebar, etc.).

`GET /design-board/reports/weekly?dateTo&weekStart` (`ADMIN`, `DESIGNER_MANAGER`, `SALES_MANAGER`, añadido 20/nov/2026 por apuntes de negocio): "Informe semanal" -- replica el aviso manual que hoy se hace entre ventas y diseño para avisarle a Cristian cuáles bocetos se aprobaron esa semana. Para cada comercial y cada uno de los últimos 3 meses (`dateTo` decide el más reciente, igual que `reports/summary`): `pendingCount` (cuántos de ese mes quedan sin aprobar **a día de hoy** -- ya refleja lo aprobado esta semana) y `approvedThisWeekCount` (cuántos de ese mes se aprobaron durante la semana consultada, `weekStart` + 7 días; sin `weekStart`, los últimos 7 días hasta ahora). Ejemplo del pedido: "Lucía tiene sin aprobar 20 de agosto... y esta semana aprueba 2 de agosto. Lucía en Agosto pasará a tener 18 sin aprobar" -> `pendingCount: 18`, `approvedThisWeekCount: 2`. No requiere persistencia nueva, se computa en vivo con `completedAt`/`approvedAt`.

**Pedido explicito del usuario, 21/nov/2026** -- además de saber DE QUÉ MES eran los bocetos aprobados esta semana (ya resuelto arriba, el desglose ya era por mes), también DE QUÉ CATEGORÍA (ejemplo del pedido: "aprobó 6 esta semana: 2 de octubre y 1 de noviembre"). Cada elemento de `months[]` gana `approvedThisWeekByCategory: { categoryId, count }[]` -- cuántos de los bocetos aprobados esta semana, en ese mes, tenían cada categoría. Solo cuenta categorías que el cliente **sí** aceptó (`DesignRequestCategoryAssignment.approved = true`, ver "Aprobación parcial por categoría" en la sección "Categorías" más arriba): si el cliente aprobó la solicitud pero rechazó una de sus categorías, esa categoría no suma acá aunque el boceto sí cuente en `approvedThisWeekCount`. Como una solicitud puede tener varias categorías aprobadas a la vez, la suma de `approvedThisWeekByCategory` puede ser mayor que `approvedThisWeekCount` (o menor, si alguna categoría quedó rechazada) -- mismo criterio de "no exclusivo" que el resto de los desgloses por categoría de este módulo. Implementación: a diferencia de los demás desgloses de este método (que usan `groupBy` sobre `DesignRequest.createdByUserId`, un campo escalar de esa misma tabla), agrupar por categoría Y comercial a la vez no se puede hacer con `groupBy` directo sobre `DesignRequestCategoryAssignment` (`createdByUserId` vive en la solicitud relacionada, no en la asignación) -- se trae el detalle con `findMany` y se agrega en memoria, mismo patrón que ya usaba `byDesigner` en `reportPeriodBreakdown()`. Frontend (`weekly-approval-report.tsx`): cada línea de "aprobó N esta semana" ahora agrega el desglose entre paréntesis (ej. "aprobó 2 esta semana (2 Vasos)"), resolviendo el nombre de cada categoría contra el mismo catálogo que usa "Reportes y estadísticas" (`designRequestCategoriesApi.list()`); el export a PDF incluye el mismo desglose.

`GET /design-board/reports/my-approval-rate` (`SALES`): tasa de aprobación personal del comercial, últimos 3 meses.

**Pedido explicito del usuario, 21/nov/2026 (aprobación parcial por categoría -- ver sección "Categorías" más arriba):** `byCategory[].approvedCount` ya no cuenta "toda categoría de una solicitud aprobada" por igual -- ahora cuenta solo las asignaciones con `approved = true` dentro de solicitudes aprobadas en el periodo (`notApprovedCount`/`approvalRate` se derivan igual que siempre a partir de ahí). Sin cambios de forma en la respuesta (sigue siendo `{ categoryId, completedCount, approvedCount, notApprovedCount, approvalRate }[]`) ni de los demás desgloses (`byCountry`/`byCreator`/`byDesigner`).

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
| `DESIGN_REQUEST_APPROVED` | `approve()` (único camino desde 16/nov/2026) | El diseñador asignado + TODO `DESIGNER_MANAGER` activo |
| `DESIGN_REQUEST_IN_REVIEW` | La tarjeta entra a "En revisión" (`isInReview`) | TODO `DESIGNER_MANAGER` activo |
| `DESIGN_REQUEST_UPDATED` | **Pedido explicito del usuario, 27/oct/2026**: `updateRequest()` edita título/instrucciones/país/tipo | El diseñador asignado (si hay uno, y si quien edita no es la misma persona asignada) |

`DESIGN_REQUEST_UPDATED` lleva `changedFields` (los campos que de verdad cambiaron, ver los `if (dto.X !== undefined)` de `updateRequest()`) para armar un mensaje legible ("Se editó: título, instrucciones.") sin que el listener tenga que releer la solicitud. Si no hay diseñador asignado todavía, se omite — no hay a quien avisar.

Requiere el valor `DESIGN_REQUEST_UPDATED` en el enum `AppNotificationType` (migración `20261027120000_design_request_updated_notification`) — como con cualquier cambio de enum de Prisma, hace falta `prisma generate`/`migrate deploy` antes de que el código compile y la base lo acepte.

## En revisión: tarjeta visible, detalle bloqueado para SALES

Pedido explícito del usuario, 26/nov/2026: desde el 16/nov/2026 `SALES`/`SALES_MANAGER` podía ver sus propias tarjetas en la columna "En revisión" (`isInReview`) -- tablero, detalle, lo que sea. Ahora, aunque **sigue viendo la tarjeta en el tablero** (sabe que existe y en qué estado está, `visibilityWhere()` no cambió para `listRequests()`), **no puede abrir su detalle** mientras esté en esa columna -- es la fase en la que el Jefe de Diseño la revisa antes de aprobarla.

Se resolvió exclusivamente en el backend, nunca solo en la SPA -- `getRequestDetail()` reusa `visibilityWhere()` igual que el resto del módulo, así que ocultarlo únicamente en el frontend habría dejado el dato accesible por cualquier llamada directa (deep-link `?requestId=`, "último boceto", el buscador global):

- `getRequestDetail()`: tras encontrar la solicitud, si `isSalesLike(user.role)` y `request.column.isInReview`, lanza `ForbiddenException` ("No puedes ver el detalle de este boceto mientras está en revisión"). No afecta a `DESIGNER`/`DESIGNER_MANAGER`/`ADMIN`.
- `getLatestRequestIdForLead()` ("último boceto" del chat): para `SALES`, excluye `column.isInReview` del `where` (vía `AND` combinando con `visibilityWhere()`, nunca una segunda clave `column` suelta -- pisaría la que ya devuelve `visibilityWhere()`) -- no tiene sentido mandarla justo a una solicitud que después el backend le va a rechazar.
- `quickSearchRequests()` (buscador global): mismo criterio, excluye `column.isInReview` de los resultados para `SALES`.
- UI (`app/dashboard/bocetos/page.tsx`): el click en la tarjeta para `SALES` en esa columna muestra un toast ("No puedes ver el detalle de este boceto mientras está en revisión") en vez de abrir el diálogo -- evita el viaje redondo, pero el backend sigue siendo quien realmente lo impide (un deep-link viejo con ese `requestId`, por ejemplo, cae en el `error` ya existente del diálogo de detalle).

## UI (Fenix-SPA)

`app/dashboard/bocetos/page.tsx`: tablero + pestañas "Tablero" / "Reportes y estadísticas" (`canViewReports` = `DESIGNER_MANAGER`/`ADMIN`/`SALES_MANAGER`) / "Por diseñador" (`canViewDesignerReport` = solo `DESIGNER_MANAGER`/`ADMIN`) / "Informe semanal" (`canViewWeeklyReport` = mismo criterio que `canViewReports`, añadido 20/nov/2026) / "Archivo" (pedido explicito del usuario, 28/oct/2026; `canViewArchiveSearch` = solo `DESIGNER_MANAGER`/`ADMIN`, ver "Versión aprobada y archivo histórico" arriba).

**Pedido explicito del usuario (apuntes de negocio), 20/nov/2026**: la pestaña separada "Por categoría" se eliminó (`category-completion-report.tsx` borrado) -- ese desglose vive ahora dentro de "Reportes y estadísticas" (`design-board-reports.tsx`), que ganó selectores de comercial (`usersApi.getSales()`) y categoría (`designRequestCategoriesApi.list()`, oculto para `SALES_MANAGER`) además de un selector de vista "Mes a mes" / "Rango personalizado" (este último manda `mode: 'range'` al backend; el selector de vista se eliminó el 21/nov/2026, ver más abajo -- ahora siempre es `mode: 'range'` anclado a un mes navegable con flechas). La columna "Boceto terminado" del tablero ahora se ordena por `completedAt` (más reciente primero por defecto, botón para invertir -- `finalSortAscending` en `app/dashboard/bocetos/page.tsx`). El widget `my-approval-rate-widget.tsx` (existía desde 07/oct/2026 pero nunca se montaba en ningún lado) ahora se monta para `SALES` puro (no `SALES_MANAGER`, mismo gate que el backend) encima del tablero, con el foco cambiado de "tasa de aprobación" a "bocetos sin aprobar" (pedido explícito: "LA ÚNICA ESTADÍSTICA QUE DEBERÍA VER LA COMERCIAL... SON LOS BOCETOS TERMINADOS (NO APROBADOS)..."). Nuevo componente `weekly-approval-report.tsx` (pestaña "Informe semanal"): consume `reports/weekly`, exporta a PDF abriendo una ventana nueva con una versión imprimible y disparando `window.print()` (no hay librería de generación de PDF en el proyecto; se dejó así en vez de añadir una dependencia nueva solo para esto).

**Fix 20/nov/2026 (mismo turno, detectado por el usuario via DevTools con capturas de red)**: el selector "Comercial" de la pestaña unificada llama a `GET /users/sales` (`usersApi.getSales()`), pero ese endpoint estaba restringido a solo `ADMIN` (`@Roles(Role.ADMIN)` en `users.controller.ts`) -- `SALES_MANAGER` y `DESIGNER_MANAGER`, los otros dos roles con acceso a "Reportes y estadísticas", recibían `403 Forbidden` al abrir la pestaña. Fix: se amplió a `@Roles(Role.ADMIN, Role.SALES_MANAGER, Role.DESIGNER_MANAGER)` -- `usersService.getSales()` ya devolvía una lectura liviana de `SALES`/`SALES_MANAGER` sin los filtros de gestión de `listUsers()`/`assertCanManageRole()` (que para `DESIGNER_MANAGER` fuerza `where.role = DESIGNER` y por eso no servía como alternativa), así que no hizo falta tocar el servicio ni el frontend, solo el guard de rol del endpoint.

Componentes en `components/design-board/`: `design-request-card.tsx`, `design-request-detail-dialog.tsx`, `create-design-request-dialog.tsx` (botón en el chat del lead), `design-board-reports.tsx`, `designer-completion-report.tsx`, `weekly-approval-report.tsx`, `my-approval-rate-widget.tsx`, `design-request-archive-search.tsx`.

Filtros del tablero disponibles para `DESIGNER_MANAGER`/`ADMIN` (`canManage`): por diseñador asignado, por comercial creadora, y (pedido explicito del usuario, 27/oct/2026) **"Sin asignar"** — un checkbox que pide `unassignedOnly: true` (`GET /design-board/requests?unassignedOnly=true`, mapeado a `assignedUserId: null` en `visibilityWhere()`); mutuamente excluyente con el filtro por diseñador (se deshabilita/limpia al activar "Sin asignar", y el backend prioriza `unassignedOnly` si llegaran los dos filtros a la vez).

## Pendientes conocidos

- Crear la label personalizada "Boceto enviado" desde Configuración > Etiquetas (no viene sembrada).
- El formulario "Crear boceto" no permite adjuntar mensajes/archivos ya existentes del chat (`kind: 'FROM_CHAT'`) todavía, aunque el backend lo soporta.
- El filtro "por comercial" del tablero se llena solo con los comerciales presentes en la vista actual, no con el catálogo completo de `SALES` (limitación de `GET /users` para `DESIGNER_MANAGER`).
- El buscador de archivo histórico (ver "Versión aprobada y archivo histórico") no tiene filtro por comercial creadora en la UI todavía (sí en el backend, `createdByUserId`) -- se dejó fuera del primer alcance por la misma limitación de catálogo de `SALES` que el punto anterior.

Ver ADR completo (histórico de diseño, decisiones y alcance de cada submódulo) en el proyecto Claude "Fenix": `adr-004-modulo-bocetos-diseno.md`.
