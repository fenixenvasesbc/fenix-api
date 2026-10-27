import { Role } from '@prisma/client';

// Eventos de dominio del tablero de bocetos, publicados via EventEmitter2
// (patron Observer/pub-sub). DesignBoardService los EMITE y no sabe (ni le
// importa) quien los escucha -- hoy los consume
// DesignRequestNotificationsListener (src/modules/notifications/listeners)
// para crear alertas in-app, pero cualquier modulo nuevo puede suscribirse
// sin tocar design-board.service.ts (ej. un futuro listener de email/Slack).
// Los payloads son livianos pero, a diferencia de los eventos de
// ChatEventsService (que solo llevan IDs porque el consumidor -- la SPA --
// vuelve a pedir el estado real por REST), estos SI llevan los campos que
// el listener necesita para decidir el destinatario, porque el consumidor
// es codigo del propio backend y evitamos una relectura a la base de datos
// redundante en el mismo request.

export const DESIGN_REQUEST_EVENTS = {
  READY: 'design-request.ready',
  COMMENTED: 'design-request.commented',
  SENT_TO_MODIFICATION: 'design-request.sent-to-modification',
  APPROVED: 'design-request.approved',
  // Pedido explicito del usuario, 23/oct/2026: una solicitud entra a
  // "Boceto en revision" (columna isInReview) -- ver move() en
  // DesignBoardService.
  IN_REVIEW: 'design-request.in-review',
  // Pedido explicito del usuario, 27/oct/2026: la comercial propietaria
  // (o ADMIN) edita un dato de la solicitud (titulo/instrucciones/pais/
  // tipo) -- ver updateRequest() en DesignBoardService.
  UPDATED: 'design-request.updated',
} as const;

export class DesignRequestReadyEvent {
  constructor(
    public readonly designRequestId: string,
    public readonly accountId: string,
    public readonly leadId: string,
    public readonly createdByUserId: string,
    // Bug encontrado al revisar el ciclo Terminado -> Modificacion ->
    // Terminado (23/oct/2026): antes no llevaba timestamp, asi que el
    // dedupeKey del listener era SIEMPRE el mismo para una misma
    // solicitud -- si volvia a llegar a "Terminado" una segunda vez (tras
    // pasar de nuevo por Modificacion), la comercial NO volvia a recibir
    // la alerta "Boceto terminado" (createNotification() la descartaba
    // por dedupe), aunque la tarjeta si estuviera, de hecho, en la
    // columna. Mismo criterio que SENT_TO_MODIFICATION/APPROVED/IN_REVIEW.
    public readonly occurredAt: Date,
  ) {}
}

export class DesignRequestCommentedEvent {
  constructor(
    public readonly designRequestId: string,
    public readonly commentId: string,
    public readonly accountId: string,
    public readonly leadId: string,
    public readonly authorUserId: string,
    public readonly authorRole: Role,
    public readonly createdByUserId: string,
    public readonly assignedUserId: string | null,
  ) {}
}

export class DesignRequestSentToModificationEvent {
  constructor(
    public readonly designRequestId: string,
    public readonly accountId: string,
    public readonly leadId: string,
    public readonly assignedUserId: string | null,
    public readonly occurredAt: Date,
  ) {}
}

export class DesignRequestApprovedEvent {
  constructor(
    public readonly designRequestId: string,
    public readonly accountId: string,
    public readonly leadId: string,
    public readonly assignedUserId: string | null,
    public readonly occurredAt: Date,
  ) {}
}

// Solo notifica a TODO el Jefe de Diseño (igual que APPROVED) -- no hay un
// "manager asignado" a la solicitud, es quien revisa los bocetos.
export class DesignRequestInReviewEvent {
  constructor(
    public readonly designRequestId: string,
    public readonly accountId: string,
    public readonly leadId: string,
    public readonly occurredAt: Date,
  ) {}
}

// Pedido explicito del usuario, 27/oct/2026: avisa al diseñador asignado
// (si hay uno) de que un dato de la solicitud cambio -- changedFields
// lleva los nombres de campo tal cual los usa updateRequest() ('title',
// 'instructions', 'country', 'requestType') para que el listener pueda
// armar un mensaje legible sin tener que volver a leer la solicitud.
export class DesignRequestUpdatedEvent {
  constructor(
    public readonly designRequestId: string,
    public readonly accountId: string,
    public readonly leadId: string,
    public readonly assignedUserId: string | null,
    public readonly changedFields: string[],
    public readonly occurredAt: Date,
  ) {}
}
