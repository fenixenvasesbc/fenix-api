export type ChatEventType =
  | 'message.created'
  | 'message.deleted'
  | 'message.updated'
  | 'message.status.updated'
  | 'conversation.updated'
  | 'conversation.read'
  | 'conversation.closed'
  | 'conversation.reopened'
  | 'notification.created'
  | 'notification.updated'
  // ADR-004 Submodulo 11: reusa el mismo bus (RabbitMQ + SSE) del chat en
  // vez de montar infraestructura de tiempo real nueva. 'moved' cubre
  // cualquier cambio de columna (move/sendToModification/approve/
  // approveByLabel/archive); 'commented' un comentario nuevo; 'updated' el
  // resto (create/assign/pause/resume) -- suficiente para que la SPA sepa
  // que debe refrescar el tablero, sin duplicar el estado completo en el
  // evento.
  | 'design_request.created'
  | 'design_request.moved'
  | 'design_request.commented'
  | 'design_request.updated';

export type ChatEvent = {
  id: string;
  type: ChatEventType;
  accountId: string;
  leadId?: string | null;
  conversationId?: string | null;
  messageId?: string | null;
  createdAt: string;
  payload?: Record<string, unknown>;
};

export type PublishChatEventInput = Omit<ChatEvent, 'id' | 'createdAt'> & {
  id?: string;
  createdAt?: string;
};
