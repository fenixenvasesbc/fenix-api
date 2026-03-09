import { Injectable, Logger } from '@nestjs/common';
import { Prisma, WebhookEventStatus } from '@prisma/client';
import { WebhookInboxJob } from 'src/common/types/webhook-inbox-job';
import { PrismaService } from 'src/prisma/prisma.service';

@Injectable()
export class WebhookInboxService {
  private readonly logger = new Logger(WebhookInboxService.name);

  constructor(private readonly prisma: PrismaService) {}

  async store(job: WebhookInboxJob): Promise<'created' | 'duplicate'> {
    const accountId = await this.tryResolveAccountId(job.payload);

    try {
      await this.prisma.webhookEvent.create({
        data: {
          provider: job.provider,
          providerEventId: job.providerEventId,
          eventType: job.eventType,
          apiVersion: job.apiVersion ?? null,
          providerTime: job.providerTime ? new Date(job.providerTime) : null,
          payload: job.payload as Prisma.InputJsonValue,
          status: WebhookEventStatus.PENDING,
          accountId: accountId ?? null,
        },
      });

      this.logger.log(
        `WebhookEvent stored providerEventId=${job.providerEventId} eventType=${job.eventType}`,
      );

      return 'created';
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        this.logger.warn(
          `Duplicate WebhookEvent ignored providerEventId=${job.providerEventId}`,
        );
        return 'duplicate';
      }

      throw error;
    }
  }

  private async tryResolveAccountId(payload: unknown): Promise<string | null> {
    const body = payload as any;

    const wabaId =
      body?.whatsappInboundMessage?.wabaId ??
      body?.whatsappMessage?.wabaId ??
      null;

    const phoneE164 =
      body?.whatsappInboundMessage?.to ??
      body?.whatsappMessage?.to ??
      null;

    if (!wabaId || !phoneE164) {
      return null;
    }

    const account = await this.prisma.account.findUnique({
      where: {
        wabaId_phoneE164: {
          wabaId,
          phoneE164,
        },
      },
      select: { id: true },
    });

    return account?.id ?? null;
  }

  private isUniqueViolation(error: unknown): boolean {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    );
  }
}