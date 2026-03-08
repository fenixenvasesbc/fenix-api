import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import type { WebhookInboxJob } from 'src/common/types/webhook-inbox-job';
import type {
  YCloudMessageUpdatedEventDto,
  YCloudUpdatedWhatsappMessageDto,
  WhatsappMessageStatus,
} from '../../common/types/ycloud-message-updated.dto';
import { Prisma } from '@prisma/client';

@Injectable()
export class MessageStatusService {
  private readonly logger = new Logger(MessageStatusService.name);

  constructor(private readonly prisma: PrismaService) {}

  async process(job: WebhookInboxJob): Promise<void> {
    const event: YCloudMessageUpdatedEventDto = this.parseEvent(job.payload);
    const whatsappMessage: YCloudUpdatedWhatsappMessageDto =
      event.whatsappMessage;

    const nextStatus = this.normalizeStatus(whatsappMessage.status);

    if (!nextStatus) {
      this.logger.warn(
        `Unsupported status providerEventId=${job.providerEventId} status=${String(
          whatsappMessage.status,
        )}`,
      );
      return;
    }

    const message = await this.findMessage(whatsappMessage);

    if (!message) {
      this.logger.warn(
        `Message not found providerEventId=${job.providerEventId} ycloudMessageId=${whatsappMessage.id} wamid=${whatsappMessage.wamid ?? '-'} externalId=${whatsappMessage.externalId ?? '-'}`,
      );
      return;
    }

    if (!this.shouldUpdate(message.status, nextStatus)) {
      this.logger.log(
        `Ignoring non-forward transition messageId=${message.id} current=${message.status} next=${nextStatus}`,
      );
      await this.prisma.webhookEvent.updateMany({
        where: { providerEventId: job.providerEventId },
        data: {
          status: 'PROCESSED',
          processedAt: new Date(),
          lastError: null,
        },
      });
      return;
    }

    const providerUpdateTime = this.resolveProviderUpdateTime(
      event,
      whatsappMessage,
      nextStatus,
    );

    const errorPayload = this.buildErrorPayload(whatsappMessage);

    await this.prisma.$transaction([
      this.prisma.message.update({
        where: { id: message.id },
        data: {
          status: nextStatus,
          providerUpdateTime,
          errors: errorPayload ?? undefined,
          rawPayload: job.payload as Prisma.InputJsonValue,
        },
      }),
      this.prisma.messageStatusHistory.create({
        data: {
          messageId: message.id,
          fromStatus: message.status,
          toStatus: nextStatus,
          providerEventId: job.providerEventId,
          providerTime: providerUpdateTime,
          payload: job.payload as Prisma.InputJsonValue,
        },
      }),
      this.prisma.webhookEvent.updateMany({
        where: { providerEventId: job.providerEventId },
        data: {
          status: 'PROCESSED',
          processedAt: new Date(),
          lastError: null,
        },
      }),
    ]);
  }

  private parseEvent(payload: unknown): YCloudMessageUpdatedEventDto {
    if (!payload || typeof payload !== 'object') {
      throw new Error('Invalid updated payload');
    }

    const event = payload as YCloudMessageUpdatedEventDto;

    if (event.type !== 'whatsapp.message.updated') {
      throw new Error(`Unexpected event type: ${String(event.type)}`);
    }

    if (!event.id) {
      throw new Error('Missing event id');
    }

    if (!event.createTime) {
      throw new Error('Missing event createTime');
    }

    if (!event.whatsappMessage) {
      throw new Error('Missing whatsappMessage');
    }

    if (!event.whatsappMessage.id) {
      throw new Error('Missing whatsappMessage.id');
    }

    if (!event.whatsappMessage.status) {
      throw new Error('Missing whatsappMessage.status');
    }

    return event;
  }

  private async findMessage(whatsappMessage: YCloudUpdatedWhatsappMessageDto) {
    if (whatsappMessage.id) {
      const byYCloudId = await this.prisma.message.findFirst({
        where: { ycloudMessageId: whatsappMessage.id },
      });

      if (byYCloudId) return byYCloudId;
    }

    if (whatsappMessage.wamid) {
      const byWamid = await this.prisma.message.findFirst({
        where: { wamid: whatsappMessage.wamid },
      });

      if (byWamid) return byWamid;
    }

    if (whatsappMessage.externalId) {
      const byExternalId = await this.prisma.message.findFirst({
        where: { externalId: whatsappMessage.externalId },
      });

      if (byExternalId) return byExternalId;
    }

    return null;
  }

  private normalizeStatus(
    status: YCloudUpdatedWhatsappMessageDto['status'],
  ): WhatsappMessageStatus | null {
    const normalized = String(status).trim().toUpperCase();

    switch (normalized) {
      case 'ACCEPTED':
      case 'SENT':
      case 'DELIVERED':
      case 'READ':
      case 'FAILED':
        return normalized;
      default:
        return null;
    }
  }

  private shouldUpdate(
    current: string | null,
    next: WhatsappMessageStatus,
  ): boolean {
    const rank: Record<WhatsappMessageStatus, number> = {
      ACCEPTED: 1,
      SENT: 2,
      DELIVERED: 3,
      READ: 4,
      FAILED: 99,
    };

    if (!current) return true;
    if (current === next) return false;

    if (next === 'FAILED') {
      return current !== 'READ';
    }

    const currentRank = rank[current as WhatsappMessageStatus] ?? 0;
    const nextRank = rank[next];

    return nextRank > currentRank;
  }

  private resolveProviderUpdateTime(
    event: YCloudMessageUpdatedEventDto,
    whatsappMessage: YCloudUpdatedWhatsappMessageDto,
    status: WhatsappMessageStatus,
  ): Date {
    const candidate =
      (status === 'READ' && whatsappMessage.readTime) ||
      (status === 'DELIVERED' && whatsappMessage.deliverTime) ||
      (status === 'SENT' && whatsappMessage.sendTime) ||
      whatsappMessage.createTime ||
      event.createTime;

    const parsed = candidate ? new Date(candidate) : new Date();
    return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  }

  private buildErrorPayload(
    whatsappMessage: YCloudUpdatedWhatsappMessageDto,
  ): Prisma.InputJsonValue | undefined {
    if (
      whatsappMessage.status !== 'FAILED' &&
      !whatsappMessage.errorCode &&
      !whatsappMessage.errorMessage &&
      !whatsappMessage.whatsappApiError
    ) {
      return undefined;
    }

    const whatsappApiError = whatsappMessage.whatsappApiError
      ? {
          message: whatsappMessage.whatsappApiError.message ?? null,
          type: whatsappMessage.whatsappApiError.type ?? null,
          code: whatsappMessage.whatsappApiError.code ?? null,
          fbtrace_id: whatsappMessage.whatsappApiError.fbtrace_id ?? null,
          error_data: whatsappMessage.whatsappApiError.error_data
            ? {
                messaging_product:
                  whatsappMessage.whatsappApiError.error_data
                    .messaging_product ?? null,
                details:
                  whatsappMessage.whatsappApiError.error_data.details ?? null,
              }
            : null,
        }
      : null;

    return {
      errorCode: whatsappMessage.errorCode ?? null,
      errorMessage: whatsappMessage.errorMessage ?? null,
      whatsappApiError,
    } as Prisma.InputJsonValue;
  }
}
