export type WebhookInboxJob = {
  provider: 'ycloud';
  providerEventId: string;
  eventType: string;
  apiVersion?: string | null;
  providerTime?: string | null;
  payload: unknown;
  receivedAt: string;
};