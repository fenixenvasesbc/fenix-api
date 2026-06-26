export type WhatsappMessageStatus =
  | 'ACCEPTED'
  | 'SENT'
  | 'DELIVERED'
  | 'READ'
  | 'FAILED';

export interface YCloudWhatsappApiError {
  message?: string;
  type?: string;
  code?: string;
  fbtrace_id?: string;
  error_data?: {
    messaging_product?: string;
    details?: string;
  };
}

export interface YCloudUpdatedTextPayload {
  body?: string;
}

export interface YCloudUpdatedMediaPayload {
  link?: string;
  caption?: string;
  filename?: string;
  mime_type?: string;
}

export interface YCloudCustomerProfileDto {
  name?: string;
  username?: string;
}

export interface YCloudUpdatedWhatsappMessageDto {
  id: string;
  wamid?: string;
  status: WhatsappMessageStatus;
  from?: string;
  to?: string;
  wabaId?: string;

  recipientUserId?: string;
  parentRecipientUserId?: string;

  customerProfile?: YCloudCustomerProfileDto | null;

  pricingModel?: string;
  pricingType?: string;
  pricingCategory?: string;
  totalPrice?: number;
  currency?: string;

  createTime?: string;
  sendTime?: string;
  deliverTime?: string;
  readTime?: string;

  bizType?: string;
  type?: string;
  text?: YCloudUpdatedTextPayload;
  image?: YCloudUpdatedMediaPayload;
  audio?: YCloudUpdatedMediaPayload;
  video?: YCloudUpdatedMediaPayload;
  document?: YCloudUpdatedMediaPayload;

  externalId?: string;

  errorCode?: string;
  errorMessage?: string;
  whatsappApiError?: YCloudWhatsappApiError;
}

export interface YCloudMessageUpdatedEventDto {
  id: string;
  type: 'whatsapp.message.updated';
  apiVersion?: string;
  createTime: string;
  whatsappMessage: YCloudUpdatedWhatsappMessageDto;
}
