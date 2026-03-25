export interface SendYcloudTemplateMessageInput {
  accountId: string;
  to: string;
  from: string;
  templateName: string;
  languageCode: string;
  externalId?: string;
}

export interface YcloudSendTemplateResponse {
  id?: string;
  wamid?: string;
  [key: string]: unknown;
}
