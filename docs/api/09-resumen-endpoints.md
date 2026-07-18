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

## Eventos legacy/manuales

| Método | Endpoint | Uso |
|---|---|---|
| `POST` | `/events/outbound/accepted` | Procesar evento outbound aceptado legacy/manual. |
| `POST` | `/events/inbound/received` | Procesar evento inbound legacy/manual. |
