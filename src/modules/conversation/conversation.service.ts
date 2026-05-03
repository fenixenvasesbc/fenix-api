import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  ConversationChannel,
  ConversationStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';

type TouchInboundConversationInput = {
  accountId: string;
  leadId: string;
  messageId: string;
  inboundAt: Date;
  incrementUnread?: boolean;
};

type TouchOutboundConversationInput = {
  accountId: string;
  leadId: string;
  messageId: string;
  outboundAt: Date;
  clearUnread?: boolean;
};

type MarkConversationAsReadInput = {
  accountId: string;
  leadId: string;
};

@Injectable()
export class ConversationService {
  private readonly logger = new Logger(ConversationService.name);

  constructor(private readonly prisma: PrismaService) {}

  async touchInbound(input: TouchInboundConversationInput) {
    return this.touchInboundTx(this.prisma, input);
  }

  async touchInboundTx(
    tx: Prisma.TransactionClient,
    input: TouchInboundConversationInput,
  ) {
    const {
      accountId,
      leadId,
      messageId,
      inboundAt,
      incrementUnread = true,
    } = input;

    const customerWindowExpiresAt = new Date(
      inboundAt.getTime() + 24 * 60 * 60 * 1000,
    );

    const existing = await tx.conversation.findUnique({
      where: {
        accountId_leadId_channel: {
          accountId,
          leadId,
          channel: ConversationChannel.WHATSAPP,
        },
      },
      select: {
        id: true,
        lastMessageAt: true,
      },
    });

    let conversation;

    if (!existing) {
      conversation = await tx.conversation.create({
        data: {
          accountId,
          leadId,
          channel: ConversationChannel.WHATSAPP,
          status: ConversationStatus.OPEN,
          lastMessageId: messageId,
          lastInboundMessageId: messageId,
          lastMessageAt: inboundAt,
          lastInboundAt: inboundAt,
          customerWindowExpiresAt,
          isCustomerWindowOpen: true,
          requiresAttention: true,
          unreadCount: incrementUnread ? 1 : 0,
        },
      });

      this.logger.log(
        `Conversation created from inbound accountId=${accountId} leadId=${leadId} conversationId=${conversation.id}`,
      );

      return conversation;
    }

    const shouldReplaceLastMessage =
      !existing.lastMessageAt ||
      inboundAt.getTime() >= existing.lastMessageAt.getTime();

    conversation = await tx.conversation.update({
      where: { id: existing.id },
      data: {
        status: ConversationStatus.OPEN,
        closedAt: null,
        lastInboundMessageId: messageId,
        lastInboundAt: inboundAt,
        customerWindowExpiresAt,
        isCustomerWindowOpen: true,
        requiresAttention: true,
        ...(incrementUnread && {
          unreadCount: {
            increment: 1,
          },
        }),
        ...(shouldReplaceLastMessage && {
          lastMessageId: messageId,
          lastMessageAt: inboundAt,
        }),
      },
    });

    this.logger.log(
      `Conversation touched by inbound accountId=${accountId} leadId=${leadId} conversationId=${conversation.id} incrementUnread=${incrementUnread}`,
    );

    return conversation;
  }

  async touchOutbound(input: TouchOutboundConversationInput) {
    const {
      accountId,
      leadId,
      messageId,
      outboundAt,
      clearUnread = true,
    } = input;

    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.conversation.findUnique({
        where: {
          accountId_leadId_channel: {
            accountId,
            leadId,
            channel: ConversationChannel.WHATSAPP,
          },
        },
        select: {
          id: true,
          lastMessageAt: true,
          customerWindowExpiresAt: true,
        },
      });

      let conversation;

      if (!existing) {
        conversation = await tx.conversation.create({
          data: {
            accountId,
            leadId,
            channel: ConversationChannel.WHATSAPP,
            status: ConversationStatus.OPEN,
            lastMessageId: messageId,
            lastOutboundMessageId: messageId,
            lastMessageAt: outboundAt,
            lastOutboundAt: outboundAt,
            isCustomerWindowOpen: false,
            requiresAttention: false,
            unreadCount: 0,
          },
        });
      } else {
        const shouldReplaceLastMessage =
          !existing.lastMessageAt ||
          outboundAt.getTime() >= existing.lastMessageAt.getTime();

        const isCustomerWindowOpen = existing.customerWindowExpiresAt
          ? existing.customerWindowExpiresAt.getTime() > Date.now()
          : false;

        conversation = await tx.conversation.update({
          where: { id: existing.id },
          data: {
            status: ConversationStatus.OPEN,
            closedAt: null,
            lastOutboundMessageId: messageId,
            lastOutboundAt: outboundAt,
            isCustomerWindowOpen,
            requiresAttention: false,
            ...(clearUnread && {
              unreadCount: 0,
            }),
            ...(shouldReplaceLastMessage && {
              lastMessageId: messageId,
              lastMessageAt: outboundAt,
            }),
          },
        });
      }

      await tx.lead.update({
        where: { id: leadId },
        data: {
          lastOutboundAt: outboundAt,
          lastMessageAt: outboundAt,
        },
      });

      return conversation;
    });
  }

  async markAsRead(input: MarkConversationAsReadInput) {
    const { accountId, leadId } = input;

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
      },
    });

    if (!conversation) {
      return null;
    }

    return this.prisma.conversation.update({
      where: { id: conversation.id },
      data: {
        unreadCount: 0,
        requiresAttention: false,
      },
    });
  }

  async close(input: MarkConversationAsReadInput) {
    const { accountId, leadId } = input;

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
      },
    });

    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }

    return this.prisma.conversation.update({
      where: { id: conversation.id },
      data: {
        status: ConversationStatus.CLOSED,
        closedAt: new Date(),
        requiresAttention: false,
        unreadCount: 0,
      },
    });
  }

  async reopen(input: MarkConversationAsReadInput) {
    const { accountId, leadId } = input;

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
        customerWindowExpiresAt: true,
      },
    });

    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }

    const isCustomerWindowOpen = conversation.customerWindowExpiresAt
      ? conversation.customerWindowExpiresAt.getTime() > Date.now()
      : false;

    return this.prisma.conversation.update({
      where: { id: conversation.id },
      data: {
        status: ConversationStatus.OPEN,
        closedAt: null,
        isCustomerWindowOpen,
      },
    });
  }

  async getByLead(accountId: string, leadId: string) {
    return this.prisma.conversation.findUnique({
      where: {
        accountId_leadId_channel: {
          accountId,
          leadId,
          channel: ConversationChannel.WHATSAPP,
        },
      },
      include: {
        lead: true,
        lastMessage: true,
        lastInboundMessage: true,
        lastOutboundMessage: true,
      },
    });
  }

  async listByAccount(params: {
    accountId: string;
    limit: number;
    search?: string | null;
    onlyOpen?: boolean;
    onlyPending?: boolean;
  }) {
    const {
      accountId,
      limit,
      search,
      onlyOpen = false,
      onlyPending = false,
    } = params;

    return this.prisma.conversation.findMany({
      where: {
        accountId,
        ...(onlyOpen ? { status: ConversationStatus.OPEN } : {}),
        ...(onlyPending ? { requiresAttention: true } : {}),
        ...(search
          ? {
              lead: {
                OR: [
                  { name: { contains: search, mode: 'insensitive' } },
                  { phoneE164: { contains: search, mode: 'insensitive' } },
                  { email: { contains: search, mode: 'insensitive' } },
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
      include: {
        lead: true,
        lastMessage: true,
      },
    });
  }

  async refreshWindowState(accountId: string, leadId: string) {
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
        customerWindowExpiresAt: true,
      },
    });

    if (!conversation) {
      return null;
    }

    const isCustomerWindowOpen = conversation.customerWindowExpiresAt
      ? conversation.customerWindowExpiresAt.getTime() > Date.now()
      : false;

    return this.prisma.conversation.update({
      where: { id: conversation.id },
      data: {
        isCustomerWindowOpen,
      },
    });
  }
}
