export type ChatEventType =
  | 'message.created'
  | 'message.deleted'
  | 'message.status.updated'
  | 'conversation.updated'
  | 'conversation.read'
  | 'conversation.closed'
  | 'conversation.reopened';

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
