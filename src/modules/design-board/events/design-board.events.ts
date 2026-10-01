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
} as const;

export class DesignRequestReadyEvent {
  constructor(
    public readonly designRequestId: string,
    public readonly accountId: string,
    public readonly leadId: string,
    public readonly createdByUserId: string,
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
