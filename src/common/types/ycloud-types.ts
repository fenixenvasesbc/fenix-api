export interface SendYcloudTemplateMessageInput {
  accountId: string;
  to: string;
  from: string;
  templateName: string;
  languageCode: string;
  externalId?: string;
  components?: unknown[];
}

export interface YcloudSendTemplateResponse {
  id?: string;
  wamid?: string;
  [key: string]: unknown;
}

export interface YcloudWhatsappTemplateComponent {
  type?: unknown;
  text?: unknown;
  format?: unknown;
  [key: string]: unknown;
}

export interface YcloudWhatsappTemplate {
  officialTemplateId?: unknown;
  id?: unknown;
  wabaId?: unknown;
  name?: unknown;
  language?: unknown;
  category?: unknown;
  qualityRating?: unknown;
  status?: unknown;
  statusUpdateEvent?: unknown;
  createTime?: unknown;
  updateTime?: unknown;
  components?: unknown;
  [key: string]: unknown;
}

export interface YcloudWhatsappTemplateListResponse {
  offset?: unknown;
  limit?: unknown;
  length?: unknown;
  items?: unknown;
}
