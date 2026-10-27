# Resumen de endpoints

## Auth

| Método | Endpoint | Roles | Uso |
|---|---|---|---|
| `POST` | `/auth/login` | Público | Login. |
| `POST` | `/auth/logout` | Público | Logout por refresh token. |
| `POST` | `/auth/refresh` | Público | Renovar access token. |
| `POST` | `/auth/admins` | `ADMIN` | Crear admin. |
| `POST` | `/auth/sales` | `ADMIN` | Crear comercial. |
| `POST` | `/auth/factory` | `ADMIN` | Crear usuario fábrica. |
| `GET` | `/auth/me` | Autenticado | Validar token. |

## Accounts

| Método | Endpoint | Roles | Uso |
|---|---|---|---|
| `GET` | `/accounts/me/profile` | `SALES` | Perfil del comercial. |
| `GET` | `/accounts/me/leads` | `SALES` | Leads de su cuenta. |
| `POST` | `/accounts/create` | `ADMIN` | Crear cuenta. |
| `GET` | `/accounts` | `ADMIN` | Listar cuentas. |
| `GET` | `/accounts/:id` | `ADMIN` | Detalle cuenta. |
| `GET` | `/accounts/:id/leads` | `ADMIN` | Leads de cuenta. |
| `PATCH` | `/accounts/:id` | `ADMIN` | Actualizar cuenta/usuario. |
| `PATCH` | `/accounts/:id/deactivate` | `ADMIN` | Desactivar usuario asociado. |

## Leads

| Método | Endpoint | Roles | Uso |
|---|---|---|---|
| `GET` | `/leads` | `ADMIN`, `SALES` | Listar leads por cuenta/filtros. |
| `PATCH` | `/leads/:leadId/label` | `ADMIN`, `SALES` | Cambiar label. |
| `DELETE` | `/leads/:leadId/labels/:label` | `ADMIN`, `SALES` | Quitar label activa. |
| `GET` | `/leads/:leadId/labels` | `ADMIN`, `SALES` | Listar labels activas/historicas. |
| `GET` | `/leads/:leadId/label-history` | `ADMIN`, `SALES` | Historial de labels. |
| `GET` | `/leads/repetition-reminders/due` | `ADMIN`, `SALES` | Recordatorios vencidos manuales. |
| `POST` | `/leads/repetition-reminders/:reminderId/sent` | `ADMIN`, `SALES` | Marcar reminder como enviado. |

## Notificaciones

| MÃ©todo | Endpoint | Roles | Uso |
|---|---|---|---|
| `GET` | `/notifications` | `ADMIN`, `SALES` | Listar alertas por cuenta. |
| `POST` | `/notifications/:notificationId/read` | `ADMIN`, `SALES` | Marcar una alerta como leida. |
| `POST` | `/notifications/read-all` | `ADMIN`, `SALES` | Marcar todas las alertas de la cuenta como leidas. |
| `POST` | `/notifications/read-label-stale` | `ADMIN`, `SALES` | Marcar como leidas las alertas pendientes de una etiqueta especifica. |

## Conversaciones

| Método | Endpoint | Roles | Uso |
|---|---|---|---|
| `POST` | `/conversations/start` | `ADMIN`, `SALES` | Buscar/crear lead por telefono e iniciar conversacion con plantilla si aplica. |
| `GET` | `/conversations` | `ADMIN`, `SALES` | Listar conversaciones. |
| `GET` | `/conversations/:leadId` | `ADMIN`, `SALES` | Detalle por lead. |
| `POST` | `/conversations/:leadId/read` | `ADMIN`, `SALES` | Marcar como leída. |
| `POST` | `/conversations/:leadId/close` | `ADMIN`, `SALES` | Cerrar conversación. |
| `POST` | `/conversations/:leadId/reopen` | `ADMIN`, `SALES` | Reabrir conversación. |

## Mensajes

| Método | Endpoint | Roles | Uso |
|---|---|---|---|
| `GET` | `/message/lead/:leadId` | `ADMIN`, `SALES` | Historial de mensajes. |
| `GET` | `/message/conversations` | `ADMIN`, `SALES` | Vista legacy/agregada de conversaciones. |

## Outbound

| Método | Endpoint | Roles | Uso |
|---|---|---|---|
| `GET` | `/outbound/templates` | `ADMIN`, `SALES` | Listar plantillas WhatsApp desde YCloud sin exponer API key a la SPA. |
| `POST` | `/outbound/template` | `ADMIN`, `SALES` | Enviar plantilla. |
| `POST` | `/outbound/text` | `ADMIN`, `SALES` | Enviar texto libre. |
| `POST` | `/outbound/media` | `ADMIN`, `SALES` | Enviar media. |

## Webhooks

| Método | Endpoint | Roles | Uso |
|---|---|---|---|
| `POST` | `/webhooks/ycloud` | Público/proveedor | Recibir webhook YCloud. |

## Dashboard

| Método | Endpoint | Roles | Uso |
|---|---|---|---|
| `GET` | `/dashboard/metrics/first-message-responses` | Autenticado | Métricas generales. |
| `POST` | `/dashboard/metrics/account/first-message-responses` | `ADMIN` | Métricas por cuenta. |

## Media

| Método | Endpoint | Roles | Uso |
|---|---|---|---|
| `POST` | `/media/upload` | `ADMIN`, `SALES` | Subir media a YCloud. |

## Clichés

| Método | Endpoint | Roles | Uso |
|---|---|---|---|
| `POST` | `/cliches` | `ADMIN`, `FACTORY` | Crear cliché. |
| `GET` | `/cliches` | `ADMIN`, `FACTORY` | Listar clichés. |
| `GET` | `/cliches/categories` | `ADMIN`, `FACTORY` | Categorías. |
| `GET` | `/cliches/:id` | `ADMIN`, `FACTORY` | Detalle. |
| `PATCH` | `/cliches/:id` | `ADMIN`, `FACTORY` | Actualizar. |
| `DELETE` | `/cliches/:id` | `ADMIN`, `FACTORY` | Eliminar. |
| `POST` | `/cliches/production-plan` | `ADMIN`, `FACTORY` | Importar PDF producción. |

## Bocetos (tablero de diseño)

Ver doc 17 para el detalle funcional completo (columnas, SLA, roles, reportes).

| Método | Endpoint | Roles | Uso |
|---|---|---|---|
| `POST` | `/design-board/requests` | `ADMIN`, `SALES` | Crear solicitud de boceto desde el chat de un lead. |
| `GET` | `/design-board/requests` | Todos los roles del módulo | Listar solicitudes (visibilidad por rol). Filtros opcionales para `DESIGNER_MANAGER`/`ADMIN`: `assignedUserId`, `createdByUserId`, `unassignedOnly=true` (solo sin diseñador asignado, pedido explicito del usuario 27/oct/2026 — prioriza sobre `assignedUserId` si llegan los dos). |
| `GET` | `/design-board/requests/:id` | Todos los roles del módulo | Detalle de una solicitud. |
| `PATCH` | `/design-board/requests/:id/assign` | `ADMIN`, `DESIGNER_MANAGER` | Asignar/desasignar diseñador. |
| `PATCH` | `/design-board/requests/:id/move` | `ADMIN`, `DESIGNER`, `DESIGNER_MANAGER` | Mover tarjeta ±1 columna. |
| `POST` | `/design-board/requests/:id/send-to-modification` | `ADMIN`, `SALES` (dueña), `DESIGNER_MANAGER` | Enviar de "Terminado" a "Modificación". |
| `POST` | `/design-board/requests/:id/approve` | `ADMIN`, `SALES` (dueña), `DESIGNER_MANAGER` | Aprobar manualmente. |
| `POST` | `/design-board/requests/:id/pause` | `ADMIN`, `DESIGNER_MANAGER` | Pausar el plazo. |
| `POST` | `/design-board/requests/:id/resume` | `ADMIN`, `DESIGNER_MANAGER` | Reanudar el plazo. |
| `POST` | `/design-board/requests/:id/archive` | `ADMIN`, `DESIGNER_MANAGER` | Archivar desde "Aprobados" ("Marcar como hecho"). |
| `POST` | `/design-board/requests/:id/comments` | Todos los roles del módulo | Comentar (con adjuntos opcionales). |
| `POST` | `/design-board/requests/:id/attachments/:attachmentId/forward` | `ADMIN`, `SALES` (dueña) | Reenviar el adjunto al lead por WhatsApp; si la tarjeta sigue en "Terminado", aplica la label personalizada `BOCETO_ENVIADO`. |
| `GET` | `/design-board/reports/summary` | `ADMIN`, `DESIGNER_MANAGER`, `SALES_MANAGER` | Reportes mensuales (terminados/aprobados/tasa/por país/por comercial); `byDesigner` se omite para `SALES_MANAGER`. |
| `GET` | `/design-board/reports/my-approval-rate` | `SALES` | Tasa de aprobación personal del comercial. |
| `GET` | `/design-board/events` | Todos los roles del módulo | Canal SSE de tiempo real. |

## Eventos legacy/manuales

| Método | Endpoint | Uso |
|---|---|---|
| `POST` | `/events/outbound/accepted` | Procesar evento outbound aceptado legacy/manual. |
| `POST` | `/events/inbound/received` | Procesar evento inbound legacy/manual. |
