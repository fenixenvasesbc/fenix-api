import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConversationChannel } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';

export type ChatPolicyResult = {
  accountId: string;
  leadId: string;
  channel: ConversationChannel;
  conversationId: string | null;

  lastInboundAt: Date | null;
  lastOutboundAt: Date | null;
  lastMessageAt: Date | null;

  customerWindowExpiresAt: Date | null;
  isCustomerWindowOpen: boolean;

  canSendFreeform: boolean;
  canSendTemplate: boolean;
  requiresTemplate: boolean;

  conversationStatus: string | null;
  requiresAttention: boolean;
  unreadCount: number;
};

type AssertCanSendTextInput = {
  accountId: string;
  leadId: string;
};

type AssertCanSendTemplateInput = {
  accountId: string;
  leadId: string;
};

@Injectable()
export class ChatPolicyService {
  constructor(private readonly prisma: PrismaService) {}

  async getPolicy(
    accountId: string,
    leadId: string,
  ): Promise<ChatPolicyResult> {
    const lead = await this.prisma.lead.findFirst({
      where: {
        id: leadId,
        accountId,
      },
      select: {
        id: true,
        accountId: true,
        lastInboundAt: true,
        lastOutboundAt: true,
        lastMessageAt: true,
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
          channel: ConversationChannel.WHATSAPP,
        },
      },
      select: {
        id: true,
        channel: true,
        status: true,
        lastInboundAt: true,
        lastOutboundAt: true,
        lastMessageAt: true,
        customerWindowExpiresAt: true,
        isCustomerWindowOpen: true,
        requiresAttention: true,
        unreadCount: true,
      },
    });

    const lastInboundAt =
      conversation?.lastInboundAt ?? lead.lastInboundAt ?? null;
    const lastOutboundAt =
      conversation?.lastOutboundAt ?? lead.lastOutboundAt ?? null;
    const lastMessageAt =
      conversation?.lastMessageAt ?? lead.lastMessageAt ?? null;

    const customerWindowExpiresAt = lastInboundAt
      ? new Date(lastInboundAt.getTime() + 24 * 60 * 60 * 1000)
      : null;

    const isCustomerWindowOpen = customerWindowExpiresAt
      ? customerWindowExpiresAt.getTime() > Date.now()
      : false;

    return {
      accountId,
      leadId,
      channel: ConversationChannel.WHATSAPP,
      conversationId: conversation?.id ?? null,

      lastInboundAt,
      lastOutboundAt,
      lastMessageAt,

      customerWindowExpiresAt,
      isCustomerWindowOpen,

      canSendFreeform: isCustomerWindowOpen,
      canSendTemplate: true,
      requiresTemplate: !isCustomerWindowOpen,

      conversationStatus: conversation?.status ?? null,
      requiresAttention: conversation?.requiresAttention ?? false,
      unreadCount: conversation?.unreadCount ?? 0,
    };
  }

  async assertCanSendText(input: AssertCanSendTextInput) {
    const policy = await this.getPolicy(input.accountId, input.leadId);

    if (!policy.canSendFreeform) {
      throw new BadRequestException(
        'Cannot send freeform message outside the 24-hour customer service window. Use a template message.',
      );
    }

    return policy;
  }

  async assertCanSendTemplate(input: AssertCanSendTemplateInput) {
    const policy = await this.getPolicy(input.accountId, input.leadId);

    if (!policy.canSendTemplate) {
      throw new BadRequestException(
        'Template message cannot be sent for this conversation.',
      );
    }

    return policy;
  }
}
