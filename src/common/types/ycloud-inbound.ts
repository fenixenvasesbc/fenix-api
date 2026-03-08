import { MessageType, Prisma } from '@prisma/client';

export type YCloudInboundPayload = {
  id: string;
  type: 'whatsapp.inbound_message.received';
  apiVersion?: string;
  createTime?: string;
  whatsappInboundMessage?: {
    id: string;
    wamid?: string;
    wabaId?: string;
    from?: string;
    to?: string;
    sendTime?: string;
    type?: string;
    customerProfile?: {
      name?: string;
    };
    context?: {
      from?: string;
      id?: string;
    };
    text?: {
      body?: string;
    };
    image?: {
      link?: string;
      caption?: string;
      id?: string;
      sha256?: string;
      mime_type?: string;
    };
    video?: {
      link?: string;
      caption?: string;
      id?: string;
      sha256?: string;
      mime_type?: string;
    };
    audio?: {
      link?: string;
      id?: string;
      sha256?: string;
      mime_type?: string;
    };
    document?: {
      link?: string;
      caption?: string;
      filename?: string;
      id?: string;
      sha256?: string;
      mime_type?: string;
    };
    sticker?: {
      link?: string;
      id?: string;
      sha256?: string;
      mime_type?: string;
    };
    reaction?: {
      message_id?: string;
      emoji?: string;
    };
    button?: {
      payload?: string;
      text?: string;
    };
    interactive?: {
      type?: string;
      list_reply?: {
        id?: string;
        title?: string;
        description?: string;
      };
      button_reply?: {
        id?: string;
        title?: string;
      };
      nfm_reply?: {
        name?: string;
        body?: string;
        response_json?: string;
      };
    };
    referral?: {
      source_url?: string;
      source_type?: string;
      source_id?: string;
      headline?: string;
      media_type?: string;
      image_url?: string;
      ctwa_clid?: string;
    };
    errors?: Array<{
      code?: string;
      title?: string;
    }>;
  };
};

export type NormalizedInbound = {
  providerEventId: string;
  ycloudMessageId: string;
  wamid: string | null;
  contextWamid: string | null;
  wabaId: string;
  from: string;
  to: string;
  senderName: string | null;
  providerCreateTime: Date | null;
  providerSendTime: Date | null;
  type: MessageType;
  textBody: string | null;
  mediaUrl: string | null;
  mimeType: string | null;
  caption: string | null;
  fileName: string | null;
  interactivePayload: Prisma.JsonValue | null;
  referralPayload: Prisma.JsonValue | null;
  errors: Prisma.JsonValue | null;
  rawPayload: Prisma.JsonValue;
};
