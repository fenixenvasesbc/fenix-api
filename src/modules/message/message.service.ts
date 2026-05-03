import { Injectable, NotFoundException } from '@nestjs/common';
import { MessageDirection, Prisma } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';

type GetLeadMessagesInput = {
  accountId: string;
  leadId: string;
  limit: number;
};

type GetConversationsInput = {
  accountId: string;
  limit: number;
  search: string | null;
};

@Injectable()
export class MessageService {
  constructor(private readonly prisma: PrismaService) {}

  async getLeadMessages(input: GetLeadMessagesInput) {
    const { accountId, leadId, limit } = input;

    const lead = await this.prisma.lead.findFirst({
      where: {
        id: leadId,
        accountId,
      },
      select: {
        id: true,
        accountId: true,
        name: true,
        phoneE164: true,
        email: true,
        status: true,
        preferredLanguage: true,
        whatsappUserId: true,
        whatsappParentUserId: true,
        whatsappUsername: true,
        firstOutboundAt: true,
        firstInboundAt: true,
        lastInboundAt: true,
        lastOutboundAt: true,
        respondedAt: true,
        lastMessageAt: true,
        sourceTemplateName: true,
        firstOutboundTemplateName: true,
        reengagementSentAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!lead) {
      throw new NotFoundException('Lead not found for this account');
    }

    const conversation = await this.prisma.conversation.findUnique({
      where: {
        accountId_leadId_channel: {
          accountId,
          leadId,
          channel: 'WHATSAPP',
        },
      },
      select: {
        id: true,
        channel: true,
        status: true,
        lastMessageId: true,
        lastInboundMessageId: true,
        lastOutboundMessageId: true,
        lastMessageAt: true,
        lastInboundAt: true,
        lastOutboundAt: true,
        customerWindowExpiresAt: true,
        isCustomerWindowOpen: true,
        requiresAttention: true,
        unreadCount: true,
        assignedUserId: true,
        assignedAt: true,
        closedAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    const messages = await this.prisma.message.findMany({
      where: {
        accountId,
        leadId,
      },
      orderBy: [
        { providerSendTime: 'desc' },
        { providerCreateTime: 'desc' },
        { createdAt: 'desc' },
      ],
      take: limit,
      select: {
        id: true,
        accountId: true,
        leadId: true,
        direction: true,
        type: true,
        status: true,
        ycloudMessageId: true,
        wamid: true,
        contextWamid: true,
        senderWhatsAppUserId: true,
        senderParentUserId: true,
        recipientWhatsAppUserId: true,
        recipientParentUserId: true,
        customerUsername: true,
        customerDisplayName: true,
        templateName: true,
        templateLang: true,
        pricingCategory: true,
        totalPrice: true,
        currency: true,
        providerCreateTime: true,
        providerUpdateTime: true,
        providerSendTime: true,
        textBody: true,
        mediaUrl: true,
        caption: true,
        mimeType: true,
        fileName: true,
        errors: true,
        interactivePayload: true,
        rawPayload: true,
        externalId: true,
        respondedAt: true,
        responseToId: true,
        campaignKey: true,
        referralPayload: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    const orderedMessages = [...messages].reverse();

    return {
      lead,
      conversation: conversation
        ? {
            id: conversation.id,
            channel: conversation.channel,
            status: conversation.status,
            lastMessageId: conversation.lastMessageId,
            lastInboundMessageId: conversation.lastInboundMessageId,
            lastOutboundMessageId: conversation.lastOutboundMessageId,
            lastMessageAt: conversation.lastMessageAt,
            lastInboundAt: conversation.lastInboundAt,
            lastOutboundAt: conversation.lastOutboundAt,
            customerWindowExpiresAt: conversation.customerWindowExpiresAt,
            isCustomerWindowOpen: conversation.isCustomerWindowOpen,
            canSendFreeform: conversation.isCustomerWindowOpen,
            requiresAttention: conversation.requiresAttention,
            unreadCount: conversation.unreadCount,
            assignedUserId: conversation.assignedUserId,
            assignedAt: conversation.assignedAt,
            closedAt: conversation.closedAt,
            createdAt: conversation.createdAt,
            updatedAt: conversation.updatedAt,
          }
        : this.buildFallbackConversationFromLead(lead),
      messages: orderedMessages,
    };
  }

  async getConversations(input: GetConversationsInput) {
    const { accountId, limit, search } = input;

    const conversations = await this.prisma.conversation.findMany({
      where: {
        accountId,
        ...(search
          ? {
              lead: {
                OR: [
                  {
                    name: {
                      contains: search,
                      mode: 'insensitive',
                    },
                  },
                  {
                    phoneE164: {
                      contains: search,
                      mode: 'insensitive',
                    },
                  },
                  {
                    email: {
                      contains: search,
                      mode: 'insensitive',
                    },
                  },
                  {
                    whatsappUsername: {
                      contains: search,
                      mode: 'insensitive',
                    },
                  },
                ],
              },
            }
          : {}),
      },
      orderBy: [{ lastMessageAt: 'desc' }, { updatedAt: 'desc' }],
      take: limit,
      select: {
        id: true,
        channel: true,
        status: true,
        lastMessageId: true,
        lastInboundMessageId: true,
        lastOutboundMessageId: true,
        lastMessageAt: true,
        lastInboundAt: true,
        lastOutboundAt: true,
        customerWindowExpiresAt: true,
        isCustomerWindowOpen: true,
        requiresAttention: true,
        unreadCount: true,
        assignedUserId: true,
        assignedAt: true,
        closedAt: true,
        createdAt: true,
        updatedAt: true,
        lead: {
          select: {
            id: true,
            accountId: true,
            name: true,
            phoneE164: true,
            email: true,
            status: true,
            preferredLanguage: true,
            whatsappUserId: true,
            whatsappParentUserId: true,
            whatsappUsername: true,
            firstOutboundAt: true,
            firstInboundAt: true,
            lastInboundAt: true,
            lastOutboundAt: true,
            respondedAt: true,
            lastMessageAt: true,
            sourceTemplateName: true,
            firstOutboundTemplateName: true,
            reengagementSentAt: true,
            createdAt: true,
            updatedAt: true,
          },
        },
        lastMessage: {
          select: {
            id: true,
            direction: true,
            type: true,
            status: true,
            textBody: true,
            mediaUrl: true,
            caption: true,
            mimeType: true,
            fileName: true,
            templateName: true,
            templateLang: true,
            providerCreateTime: true,
            providerUpdateTime: true,
            providerSendTime: true,
            createdAt: true,
          },
        },
      },
    });

    return {
      data: conversations.map((conversation) => ({
        lead: conversation.lead,
        conversation: {
          id: conversation.id,
          channel: conversation.channel,
          status: conversation.status,
          lastMessageId: conversation.lastMessageId,
          lastInboundMessageId: conversation.lastInboundMessageId,
          lastOutboundMessageId: conversation.lastOutboundMessageId,
          lastMessageAt: conversation.lastMessageAt,
          lastInboundAt: conversation.lastInboundAt,
          lastOutboundAt: conversation.lastOutboundAt,
          customerWindowExpiresAt: conversation.customerWindowExpiresAt,
          isCustomerWindowOpen: conversation.isCustomerWindowOpen,
          canSendFreeform: conversation.isCustomerWindowOpen,
          requiresAttention: conversation.requiresAttention,
          unreadCount: conversation.unreadCount,
          assignedUserId: conversation.assignedUserId,
          assignedAt: conversation.assignedAt,
          closedAt: conversation.closedAt,
          createdAt: conversation.createdAt,
          updatedAt: conversation.updatedAt,
        },
        lastMessage: conversation.lastMessage
          ? {
              ...conversation.lastMessage,
              preview: this.buildMessagePreview(conversation.lastMessage),
            }
          : null,
      })),
    };
  }

  private buildFallbackConversationFromLead(lead: {
    lastInboundAt: Date | null;
    lastOutboundAt: Date | null;
    lastMessageAt: Date | null;
  }) {
    const customerWindow = this.resolveCustomerWindow(lead.lastInboundAt);

    return {
      id: null,
      channel: 'WHATSAPP',
      status: 'OPEN',
      lastMessageId: null,
      lastInboundMessageId: null,
      lastOutboundMessageId: null,
      lastMessageAt: lead.lastMessageAt,
      lastInboundAt: lead.lastInboundAt,
      lastOutboundAt: lead.lastOutboundAt,
      customerWindowExpiresAt: customerWindow.expiresAt,
      isCustomerWindowOpen: customerWindow.isOpen,
      canSendFreeform: customerWindow.isOpen,
      requiresAttention: false,
      unreadCount: 0,
      assignedUserId: null,
      assignedAt: null,
      closedAt: null,
      createdAt: null,
      updatedAt: null,
    };
  }

  private resolveCustomerWindow(lastInboundAt: Date | null) {
    if (!lastInboundAt) {
      return {
        isOpen: false,
        expiresAt: null as Date | null,
      };
    }

    const expiresAt = new Date(lastInboundAt.getTime() + 24 * 60 * 60 * 1000);

    return {
      isOpen: expiresAt.getTime() > Date.now(),
      expiresAt,
    };
  }

  private buildMessagePreview(message: {
    direction: MessageDirection;
    textBody: string | null;
    caption: string | null;
    templateName: string | null;
    mediaUrl: string | null;
    fileName: string | null;
    mimeType: string | null;
  }) {
    if (message.textBody) return message.textBody;
    if (message.caption) return message.caption;
    if (message.templateName) return `Template: ${message.templateName}`;
    if (message.fileName) return `Archivo: ${message.fileName}`;
    if (message.mediaUrl && message.mimeType)
      return `Media: ${message.mimeType}`;
    if (message.mediaUrl) return 'Media message';

    return message.direction === MessageDirection.INBOUND
      ? 'Mensaje entrante'
      : 'Mensaje saliente';
  }
}
