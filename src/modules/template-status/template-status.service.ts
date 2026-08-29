import { Injectable, Logger } from '@nestjs/common';
import { AccountGlobalTemplateStatus, Prisma, WebhookEventStatus } from '@prisma/client';
import { WebhookInboxJob } from 'src/common/types/webhook-inbox-job';
import type { YcloudTemplateReviewedWebhook } from 'src/common/types/ycloud-types';
import { PrismaService } from 'src/prisma/prisma.service';

const VALID_STATUSES = new Set(Object.values(AccountGlobalTemplateStatus));

// Sincroniza AccountGlobalTemplateStatus (nuestra copia por comercial de una
// GlobalWhatsappTemplate) cuando Meta aprueba/rechaza/pausa una plantilla.
// Un mismo wabaId puede tener varios numeros/cuentas -- se actualizan todas
// las filas que compartan ese wabaId + nombre/idioma de la plantilla.
@Injectable()
export class TemplateStatusService {
  private readonly logger = new Logger(TemplateStatusService.name);

  constructor(private readonly prisma: PrismaService) {}

  async process(job: WebhookInboxJob): Promise<void> {
    this.logger.log(
      `Processing template-status job id=${job.providerEventId} type=${job.eventType}`,
    );

    await this.markProcessing(job);

    const event = this.parseEvent(job.payload);
    const template = event.whatsappTemplate;
    if (!template) {
      throw new Error('Missing whatsappTemplate');
    }

    const wabaId = this.nonEmpty(template.wabaId);
    const name = this.nonEmpty(template.name);
    const language = this.nonEmpty(template.language);

    if (!wabaId || !name || !language) {
      throw new Error(
        'Missing whatsappTemplate.wabaId/name/language',
      );
    }

    // Meta manda mas valores de los que rastreamos (FLAGGED, ARCHIVED,
    // PENDING_DELETION...) -- si no lo reconocemos, no pisamos el estado
    // actual, solo dejamos constancia del webhook para revision manual.
    const status = this.mapStatus(
      template.statusUpdateEvent ?? template.status,
    );
    const reason = this.nonEmpty(template.reason);

    const result = await this.prisma.globalWhatsappTemplateAccount.updateMany({
      where: {
        wabaId,
        globalTemplate: { name, language },
      },
      data: {
        ...(status ? { status } : {}),
        statusDetail: reason,
        lastWebhookPayload: event as unknown as Prisma.InputJsonValue,
        lastSyncedAt: new Date(),
      },
    });

    await this.markProcessed(job);

    this.logger.log(
      `Template-status processed providerEventId=${job.providerEventId} wabaId=${wabaId} name=${name} language=${language} status=${status ?? '(sin cambio, valor no reconocido)'} rowsUpdated=${result.count}`,
    );

    if (result.count === 0) {
      this.logger.warn(
        `Template-status webhook did not match any GlobalWhatsappTemplateAccount wabaId=${wabaId} name=${name} language=${language} (puede ser una plantilla creada fuera de la gestion global)`,
      );
    }
  }

  async markFailed(job: WebhookInboxJob, error: unknown, dead = false) {
    const now = new Date();

    await this.prisma.webhookEvent.updateMany({
      where: { providerEventId: job.providerEventId },
      data: {
        status: dead ? WebhookEventStatus.DEAD : WebhookEventStatus.FAILED,
        lastAttemptAt: now,
        deadAt: dead ? now : undefined,
        lastError: this.formatError(error),
      },
    });
  }

  private parseEvent(payload: unknown): YcloudTemplateReviewedWebhook {
    const event = payload as YcloudTemplateReviewedWebhook;

    if (event?.type !== 'whatsapp.template.reviewed') {
      throw new Error(`Unsupported eventType=${String(event?.type)}`);
    }

    return event;
  }

  private async markProcessing(job: WebhookInboxJob) {
    await this.prisma.webhookEvent.updateMany({
      where: { providerEventId: job.providerEventId },
      data: {
        status: WebhookEventStatus.PROCESSING,
        attempts: { increment: 1 },
        lastAttemptAt: new Date(),
      },
    });
  }

  private async markProcessed(job: WebhookInboxJob) {
    await this.prisma.webhookEvent.updateMany({
      where: { providerEventId: job.providerEventId },
      data: {
        status: WebhookEventStatus.PROCESSED,
        processedAt: new Date(),
        lastError: null,
      },
    });
  }

  private mapStatus(value: unknown): AccountGlobalTemplateStatus | null {
    const normalized =
      typeof value === 'string' ? value.trim().toUpperCase() : '';
    return VALID_STATUSES.has(normalized as AccountGlobalTemplateStatus)
      ? (normalized as AccountGlobalTemplateStatus)
      : null;
  }

  private nonEmpty(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  private formatError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
