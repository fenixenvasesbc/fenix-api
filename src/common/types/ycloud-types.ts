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

export interface CreateYcloudTemplateInput {
  wabaId: string;
  name: string;
  language: string;
  category: 'AUTHENTICATION' | 'MARKETING' | 'UTILITY';
  components: unknown[];
}

export interface YcloudCreateTemplateResponse {
  id?: unknown;
  officialTemplateId?: unknown;
  name?: unknown;
  language?: unknown;
  category?: unknown;
  status?: unknown;
  [key: string]: unknown;
}

// PATCH /whatsapp/templates/{wabaId}/{name}/{language} -- solo se puede
// editar el contenido (components); name/language/wabaId identifican la
// plantilla y no se pueden cambiar por esta via. Meta/YCloud solo permite
// editar plantillas APPROVED/REJECTED/PAUSED (ARCHIVED no se puede).
export interface EditYcloudTemplateInput {
  wabaId: string;
  name: string;
  language: string;
  components: unknown[];
}

export interface YcloudEditTemplateResponse {
  id?: unknown;
  officialTemplateId?: unknown;
  name?: unknown;
  language?: unknown;
  category?: unknown;
  status?: unknown;
  [key: string]: unknown;
}


export interface YcloudTemplateReviewedWebhook {
  id?: unknown;
  type?: unknown;
  apiVersion?: unknown;
  createTime?: unknown;
  whatsappTemplate?: {
    wabaId?: unknown;
    name?: unknown;
    language?: unknown;
    category?: unknown;
    status?: unknown;
    reason?: unknown;
    statusUpdateEvent?: unknown;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}