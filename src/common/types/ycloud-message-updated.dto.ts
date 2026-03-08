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

export interface YCloudUpdatedWhatsappMessageDto {
  id: string;
  wamid?: string;
  status: WhatsappMessageStatus;

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