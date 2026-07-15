export interface YCloudSmbEchoCustomerProfileDto {
  name?: string;
  username?: string;
}

export interface YCloudSmbEchoTextPayload {
  body?: string;
}

export interface YCloudSmbEchoMediaPayload {
  link?: string;
  id?: string;
  sha256?: string;
  caption?: string;
  filename?: string;
  mime_type?: string;
}

export interface YCloudSmbEchoContextDto {
  message_id?: string;
  id?: string;
  from?: string;
}

export interface YCloudSmbEchoWhatsappMessageDto {
  id: string;
  wamid?: string;
  status?: string;
  from?: string;
  to?: string;
  toUserId?: string;
  toParentUserId?: string;
  customerProfile?: YCloudSmbEchoCustomerProfileDto | null;
  wabaId?: string;
  createTime?: string;
  sendTime?: string;
  updateTime?: string;
  bizType?: string;
  type?: string;
  text?: YCloudSmbEchoTextPayload;
  image?: YCloudSmbEchoMediaPayload;
  audio?: YCloudSmbEchoMediaPayload;
  video?: YCloudSmbEchoMediaPayload;
  document?: YCloudSmbEchoMediaPayload;
  context?: YCloudSmbEchoContextDto | null;
  externalId?: string;
}

export interface YCloudSmbMessageEchoesEventDto {
  id: string;
  type: 'whatsapp.smb.message.echoes';
  apiVersion?: string;
  createTime: string;
  whatsappMessage: YCloudSmbEchoWhatsappMessageDto;
}
