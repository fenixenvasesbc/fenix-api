import { Injectable, Logger } from '@nestjs/common';
import { WebhookEventStatus } from '@prisma/client';
import { WebhookInboxJob } from 'src/common/types/webhook-inbox-job';
import type {
  YCloudSmbAppStateSyncPayload,
  YCloudSmbStateSyncItem,
} from 'src/common/types/ycloud-smb-app-state-sync.dto';
import { normalizeLeadName } from 'src/common/utils/lead-name';
import { PrismaService } from 'src/prisma/prisma.service';

type ProcessSummary = {
  updated: number;
  removed: number;
  unchanged: number;
  skipped: number;
  missingLead: number;
};

@Injectable()
export class SmbStateSyncService {
  private readonly logger = new Logger(SmbStateSyncService.name);

  constructor(private readonly prisma: PrismaService) {}

  async process(job: WebhookInboxJob): Promise<void> {
    this.logger.log(
      `Processing SMB state sync job id=${job.providerEventId} type=${job.eventType}`,
    );

    await this.markProcessing(job);

    const event = this.parseEvent(job.payload);
    const sync = event.whatsappSmbAppStateSync;
    if (!sync) {
      throw new Error('Missing whatsappSmbAppStateSync');
    }

    const wabaId = this.nonEmpty(sync.wabaId);
    const accountPhoneE164 = this.normalizePhone(sync.phoneNumber);
    if (!wabaId || !accountPhoneE164) {
      throw new Error('Missing whatsappSmbAppStateSync.wabaId/phoneNumber');
    }

    const account = await this.prisma.account.findUnique({
      where: {
        wabaId_phoneE164: {
          wabaId,
          phoneE164: accountPhoneE164,
        },
      },
      select: { id: true },
    });

    if (!account) {
      throw new Error(
        `Account not found for wabaId=${wabaId} phoneE164=${accountPhoneE164}`,
      );
    }

    const stateSync = Array.isArray(sync.stateSync) ? sync.stateSync : [];
    const summary: ProcessSummary = {
      updated: 0,
      removed: 0,
      unchanged: 0,
      skipped: 0,
      missingLead: 0,
    };

    for (const item of stateSync) {
      await this.processItem({
        accountId: account.id,
        item,
        summary,
        providerEventId: job.providerEventId,
      });
    }

    await this.markProcessed(job, { accountId: account.id });

    this.logger.log(
      `SMB state sync processed providerEventId=${job.providerEventId} accountId=${account.id} updated=${summary.updated} removed=${summary.removed} unchanged=${summary.unchanged} skipped=${summary.skipped} missingLead=${summary.missingLead}`,
    );
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

  private async processItem(input: {
    accountId: string;
    item: YCloudSmbStateSyncItem;
    summary: ProcessSummary;
    providerEventId: string;
  }) {
    const contact = input.item.contact;
    const phoneE164 = this.normalizePhone(contact?.phoneNumber);
    const action = this.normalizeAction(input.item.action);

    if (!phoneE164) {
      input.summary.skipped += 1;
      return;
    }

    const lead = await this.prisma.lead.findUnique({
      where: {
        accountId_phoneE164: {
          accountId: input.accountId,
          phoneE164,
        },
      },
      select: {
        id: true,
        whatsappContactName: true,
        whatsappUserId: true,
        whatsappParentUserId: true,
        whatsappUsername: true,
      },
    });

    if (!lead) {
      input.summary.missingLead += 1;
      this.logger.warn(
        `Lead not found for SMB state sync providerEventId=${input.providerEventId} accountId=${input.accountId} phone=${this.maskPhone(phoneE164)}`,
      );
      return;
    }

    if (action === 'remove') {
      if (!normalizeLeadName(lead.whatsappContactName)) {
        input.summary.unchanged += 1;
        return;
      }

      await this.prisma.lead.update({
        where: { id: lead.id },
        data: {
          whatsappContactName: null,
        },
      });

      input.summary.removed += 1;
      return;
    }

    const whatsappContactName = normalizeLeadName(
      contact?.fullName ?? contact?.firstName,
    );

    if (!whatsappContactName) {
      input.summary.skipped += 1;
      return;
    }

    const nextWhatsappUserId = this.nonEmpty(contact?.userId);
    const nextWhatsappParentUserId = this.nonEmpty(contact?.parentUserId);
    const nextWhatsappUsername = this.nonEmpty(contact?.username);

    const updateData: {
      whatsappContactName?: string;
      whatsappUserId?: string;
      whatsappParentUserId?: string;
      whatsappUsername?: string;
    } = {};

    if (normalizeLeadName(lead.whatsappContactName) !== whatsappContactName) {
      updateData.whatsappContactName = whatsappContactName;
    }

    if (nextWhatsappUserId && lead.whatsappUserId !== nextWhatsappUserId) {
      updateData.whatsappUserId = nextWhatsappUserId;
    }

    if (
      nextWhatsappParentUserId &&
      lead.whatsappParentUserId !== nextWhatsappParentUserId
    ) {
      updateData.whatsappParentUserId = nextWhatsappParentUserId;
    }

    if (
      nextWhatsappUsername &&
      lead.whatsappUsername !== nextWhatsappUsername
    ) {
      updateData.whatsappUsername = nextWhatsappUsername;
    }

    if (Object.keys(updateData).length === 0) {
      input.summary.unchanged += 1;
      return;
    }

    await this.prisma.lead.update({
      where: { id: lead.id },
      data: updateData,
    });

    input.summary.updated += 1;
  }

  private parseEvent(payload: unknown): YCloudSmbAppStateSyncPayload {
    const event = payload as YCloudSmbAppStateSyncPayload;

    if (event?.type !== 'whatsapp.smb.app.state.sync') {
      throw new Error(`Unsupported eventType=${String(event?.type)}`);
    }

    return event;
  }

  private async markProcessing(job: WebhookInboxJob) {
    await this.prisma.webhookEvent.updateMany({
      where: { providerEventId: job.providerEventId },
      data: {
        status: WebhookEventStatus.PROCESSING,
        attempts: {
          increment: 1,
        },
        lastAttemptAt: new Date(),
      },
    });
  }

  private async markProcessed(
    job: WebhookInboxJob,
    data: { accountId: string | null },
  ) {
    await this.prisma.webhookEvent.updateMany({
      where: { providerEventId: job.providerEventId },
      data: {
        status: WebhookEventStatus.PROCESSED,
        accountId: data.accountId,
        processedAt: new Date(),
        lastError: null,
      },
    });
  }

  private normalizePhone(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();

    if (/^\+[1-9]\d{6,14}$/.test(trimmed)) return trimmed;
    if (/^[1-9]\d{6,14}$/.test(trimmed)) return `+${trimmed}`;

    return null;
  }

  private nonEmpty(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  private normalizeAction(action: unknown): 'add' | 'edit' | 'remove' | null {
    if (typeof action !== 'string') return null;

    const normalized = action.trim().toLowerCase();
    if (normalized === 'add' || normalized === 'edit') return normalized;
    if (normalized === 'remove') return 'remove';

    return null;
  }

  private maskPhone(phoneE164: string) {
    if (phoneE164.length <= 6) return '***';
    return `${phoneE164.slice(0, 3)}***${phoneE164.slice(-3)}`;
  }

  private formatError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
