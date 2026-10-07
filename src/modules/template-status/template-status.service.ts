import { Injectable, Logger } from '@nestjs/common';
import { AccountGlobalTemplateStatus, Prisma, WebhookEventStatus } from '@prisma/client';
import { WebhookInboxJob } from 'src/common/types/webhook-inbox-job';
import type { YcloudTemplateReviewedWebhook } from 'src/common/types/ycloud-types';
import { PrismaService } from 'src/prisma/prisma.service';
import { CampaignTemplateSyncService } from '../campaign-templates/campaign-template-sync.service';
import { CAMPAIGN_TEMPLATE_REGISTRY } from '../campaign-templates/campaign-template-registry';

const VALID_STATUSES = new Set(Object.values(AccountGlobalTemplateStatus));

// Sincroniza AccountGlobalTemplateStatus (nuestra copia por comercial de una
// GlobalWhatsappTemplate) cuando Meta aprueba/rechaza/pausa una plantilla.
// Un mismo wabaId puede tener varios numeros/cuentas -- se actualizan todas
// las filas que compartan ese wabaId + nombre/idioma de la plantilla.
@Injectable()
export class TemplateStatusService {
  private readonly logger = new Logger(TemplateStatusService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly campaignTemplateSyncService: CampaignTemplateSyncService,
  ) {}

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

    await this.syncCampaignDefinitionsIfRegistered(wabaId, name);
  }

  // Ademas de GlobalWhatsappTemplateAccount (arriba), si el nombre de la
  // plantilla coincide con una entrada de CAMPAIGN_TEMPLATE_REGISTRY (hoy:
  // re_enganche, recordatorio_repeticion), reflejar tambien el cambio en
  // CampaignDefinition/AccountCampaignTemplate -- antes de esto, ese sistema
  // (usado por Reenganche/Repeticion) solo se actualizaba corriendo un
  // script a mano para cada cuenta (ver ADR-003). Reusa
  // CampaignTemplateSyncService.syncAccount(), la misma logica que ya usa
  // el sync manual (POST /campaign-templates/accounts/:id/sync) -- incluye
  // el fix que evita crear CampaignDefinition duplicadas para type+language
  // (ver incidente cuenta 5575c85f-..., Diana).
  //
  // Best-effort por diseno: un fallo aqui no debe tumbar el procesamiento
  // del webhook de GlobalWhatsappTemplateAccount, que ya se aplico arriba y
  // es el camino critico de Etiquetas.
  private async syncCampaignDefinitionsIfRegistered(
    wabaId: string,
    templateName: string,
  ): Promise<void> {
    const isRegistered = CAMPAIGN_TEMPLATE_REGISTRY.some(
      (entry) => entry.templateName === templateName,
    );
    if (!isRegistered) return;

    // Un mismo wabaId puede tener varios numeros/cuentas (ver comentario de
    // clase mas arriba) -- se sincroniza cada una.
    const accounts = await this.prisma.account.findMany({
      where: { wabaId },
      select: { id: true, user: { select: { isActive: true } } },
    });

    for (const account of accounts) {
      if (!account.user?.isActive) continue;

      try {
        await this.campaignTemplateSyncService.syncAccount(account.id);
        this.logger.log(
          `Campaign template sync (via webhook) ok accountId=${account.id} wabaId=${wabaId} templateName=${templateName}`,
        );
      } catch (error) {
        this.logger.warn(
          `Campaign template sync (via webhook) failed accountId=${account.id} wabaId=${wabaId} templateName=${templateName}: ${this.formatError(error)}`,
        );
      }
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
