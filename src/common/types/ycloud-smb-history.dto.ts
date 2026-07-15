export interface YCloudSmbHistoryCustomerProfileDto {
  name?: string;
  username?: string;
}

export interface YCloudSmbHistoryTextPayload {
  body?: string;
}

export interface YCloudSmbHistoryMediaPayload {
  link?: string;
  id?: string;
  sha256?: string;
  caption?: string;
  filename?: string;
  mime_type?: string;
}

export interface YCloudSmbHistoryContextDto {
  message_id?: string;
  id?: string;
  from?: string;
}

export interface YCloudSmbHistoryInboundMessageDto {
  id: string;
  wamid?: string;
  wabaId?: string;
  from?: string;
  fromUserId?: string;
  fromParentUserId?: string;
  customerProfile?: YCloudSmbHistoryCustomerProfileDto | null;
  to?: string;
  sendTime?: string;
  type?: string;
  text?: YCloudSmbHistoryTextPayload;
  image?: YCloudSmbHistoryMediaPayload;
  audio?: YCloudSmbHistoryMediaPayload;
  video?: YCloudSmbHistoryMediaPayload;
  document?: YCloudSmbHistoryMediaPayload;
  context?: YCloudSmbHistoryContextDto | null;
}

export interface YCloudSmbHistoryWhatsappMessageDto {
  id: string;
  wamid?: string;
  status?: string;
  from?: string;
  to?: string;
  toUserId?: string;
  toParentUserId?: string;
  customerProfile?: YCloudSmbHistoryCustomerProfileDto | null;
  wabaId?: string;
  createTime?: string;
  sendTime?: string;
  updateTime?: string;
  bizType?: string;
  type?: string;
  text?: YCloudSmbHistoryTextPayload;
  image?: YCloudSmbHistoryMediaPayload;
  audio?: YCloudSmbHistoryMediaPayload;
  video?: YCloudSmbHistoryMediaPayload;
  document?: YCloudSmbHistoryMediaPayload;
  context?: YCloudSmbHistoryContextDto | null;
  externalId?: string;
}

export interface YCloudSmbHistoryEventDto {
  id: string;
  type: 'whatsapp.smb.history';
  apiVersion?: string;
  createTime: string;
  whatsappInboundMessage?: YCloudSmbHistoryInboundMessageDto;
  whatsappMessage?: YCloudSmbHistoryWhatsappMessageDto;
}
