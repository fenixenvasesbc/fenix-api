import axios, { type AxiosResponse } from 'axios';
import { Injectable, Logger } from '@nestjs/common';
import { Prisma, ProviderType, WebhookEventStatus } from '@prisma/client';
import { WebhookInboxJob } from 'src/common/types/webhook-inbox-job';
import type {
  YCloudContactAttributeChange,
  YCloudContactAttributesChangedPayload,
} from 'src/common/types/ycloud-contact-attributes-changed.dto';
import { normalizeLeadName } from 'src/common/utils/lead-name';
import { PrismaService } from 'src/prisma/prisma.service';
import { CredentialCryptoService } from '../credentials/credential-crypto.service';
import { ChatEventsService } from '../chat-events/chat-events.service';

type ActiveCredential = {
  accountId: string;
  apiKeyEncrypted: string;
};

type ContactLookup =
  | {
      kind: 'found';
      accountId: string;
      contact: unknown;
    }
  | { kind: 'not_found' };

@Injectable()
export class ContactAttributesService {
  private readonly logger = new Logger(ContactAttributesService.name);
  private readonly baseUrl = (
    process.env.YCLOUD_BASE_URL ?? 'https://api.ycloud.com/v2'
  ).replace(/\/+$/, '');

  constructor(
    private readonly prisma: PrismaService,
    private readonly cryptoService: CredentialCryptoService,
    private readonly chatEvents: ChatEventsService,
  ) {}

  async process(job: WebhookInboxJob): Promise<void> {
    this.logger.log(
      `Processing contact attributes job id=${job.providerEventId} type=${job.eventType}`,
    );

    await this.markProcessing(job);

    const event = this.parseEvent(job.payload);
    const contactAttributesChanged = event.contactAttributesChanged;
    if (!contactAttributesChanged) {
      throw new Error('Missing contactAttributesChanged');
    }

    const contactId = this.nonEmpty(contactAttributesChanged.id);
    if (!contactId) {
      throw new Error('Missing contactAttributesChanged.id');
    }

    const remarkNameChange = this.resolveRemarkNameChange(
      contactAttributesChanged.changedAttributes,
    );
    const nicknameChange = this.resolveNicknameChange(
      contactAttributesChanged.changedAttributes,
    );
    const whatsappContactName = remarkNameChange.changed
      ? normalizeLeadName(remarkNameChange.newValue)
      : null;
    const ycloudNickname = nicknameChange.changed
      ? normalizeLeadName(nicknameChange.newValue)
      : null;

    if (!remarkNameChange.changed && !nicknameChange.changed) {
      await this.markProcessed(job, {
        accountId: null,
        leadId: null,
      });
      this.logger.log(
        `Ignoring contact attributes event without nickname change providerEventId=${job.providerEventId} contactId=${contactId}`,
      );
      return;
    }

    if (!whatsappContactName && !ycloudNickname) {
      await this.markProcessed(job, {
        accountId: null,
        leadId: null,
      });
      this.logger.log(
        `Ignoring empty contact name attributes providerEventId=${job.providerEventId} contactId=${contactId}`,
      );
      return;
    }

    const lookup = await this.findContact(contactId);
    if (lookup.kind === 'not_found') {
      throw new Error(`YCloud contact not found for id=${contactId}`);
    }

    const phoneE164 =
      this.extractPhoneE164FromChangedAttributes(
        contactAttributesChanged.changedAttributes,
      ) ?? this.extractPhoneE164(lookup.contact);
    if (!phoneE164) {
      throw new Error(
        `YCloud contact event/response did not include an E.164 phone for id=${contactId}`,
      );
    }

    const lead = await this.prisma.lead.findUnique({
      where: {
        accountId_phoneE164: {
          accountId: lookup.accountId,
          phoneE164,
        },
      },
      select: {
        id: true,
        whatsappContactName: true,
        ycloudNickname: true,
      },
    });

    if (!lead) {
      await this.markProcessed(job, {
        accountId: lookup.accountId,
        leadId: null,
      });
      this.logger.warn(
        `Lead not found for contact attributes providerEventId=${job.providerEventId} accountId=${lookup.accountId} phone=${this.maskPhone(phoneE164)}`,
      );
      return;
    }

    const updateData: {
      whatsappContactName?: string;
      ycloudNickname?: string;
    } = {};

    if (
      whatsappContactName &&
      normalizeLeadName(lead.whatsappContactName) !== whatsappContactName
    ) {
      updateData.whatsappContactName = whatsappContactName;
    }

    if (
      ycloudNickname &&
      normalizeLeadName(lead.ycloudNickname) !== ycloudNickname
    ) {
      updateData.ycloudNickname = ycloudNickname;
    }

    if (Object.keys(updateData).length === 0) {
      await this.markProcessed(job, {
        accountId: lookup.accountId,
        leadId: lead.id,
      });
      this.logger.log(
        `Lead contact names already synchronized providerEventId=${job.providerEventId} leadId=${lead.id}`,
      );
      return;
    }

    await this.prisma.lead.update({
      where: { id: lead.id },
      data: updateData,
    });

    await this.chatEvents.publish({
      type: 'conversation.updated',
      accountId: lookup.accountId,
      leadId: lead.id,
      payload: {
        source: 'contact.attributes_changed',
        providerEventId: job.providerEventId,
        updatedFields: Object.keys(updateData),
        reason: 'lead.contact_name.updated',
      },
    });

    await this.markProcessed(job, {
      accountId: lookup.accountId,
      leadId: lead.id,
    });

    this.logger.log(
      `Lead contact names updated from contact attributes providerEventId=${job.providerEventId} leadId=${lead.id} accountId=${lookup.accountId}`,
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

  private parseEvent(payload: unknown): YCloudContactAttributesChangedPayload {
    const event = payload as YCloudContactAttributesChangedPayload;

    if (event?.type !== 'contact.attributes_changed') {
      throw new Error(`Unsupported eventType=${String(event?.type)}`);
    }

    if (!event.contactAttributesChanged) {
      throw new Error('Missing contactAttributesChanged');
    }

    return event;
  }

  private resolveNicknameChange(
    changedAttributes:
      | Record<string, YCloudContactAttributeChange>
      | null
      | undefined,
  ): { changed: true; newValue: unknown } | { changed: false } {
    if (!changedAttributes) return { changed: false };

    const change = this.findAttributeChange(changedAttributes, [
      'nickname',
      'nickName',
      'nick_name',
    ]);
    if (!change || !Object.prototype.hasOwnProperty.call(change, 'newValue')) {
      return { changed: false };
    }

    return { changed: true, newValue: change.newValue };
  }

  private resolveRemarkNameChange(
    changedAttributes:
      | Record<string, YCloudContactAttributeChange>
      | null
      | undefined,
  ): { changed: true; newValue: unknown } | { changed: false } {
    if (!changedAttributes) return { changed: false };

    const change = this.findAttributeChange(changedAttributes, [
      'remarkName',
      'remark_name',
    ]);
    if (!change || !Object.prototype.hasOwnProperty.call(change, 'newValue')) {
      return { changed: false };
    }

    return { changed: true, newValue: change.newValue };
  }

  private async findContact(contactId: string): Promise<ContactLookup> {
    const credentials = await this.prisma.accountProviderCredential.findMany({
      where: {
        provider: ProviderType.YCLOUD,
        isActive: true,
      },
      select: {
        accountId: true,
        apiKeyEncrypted: true,
      },
      orderBy: {
        createdAt: 'asc',
      },
    });

    if (credentials.length === 0) {
      throw new Error('No active YCLOUD credentials configured');
    }

    for (const credential of credentials) {
      const contact = await this.tryRetrieveContact(contactId, credential);
      if (contact.kind === 'found') return contact;
    }

    return { kind: 'not_found' };
  }

  private async tryRetrieveContact(
    contactId: string,
    credential: ActiveCredential,
  ): Promise<ContactLookup> {
    let apiKey: string;
    try {
      apiKey = this.cryptoService.decrypt(credential.apiKeyEncrypted);
    } catch (error) {
      this.logger.warn(
        `Skipping YCLOUD credential decrypt failure accountId=${credential.accountId} error=${this.formatError(error)}`,
      );
      return { kind: 'not_found' };
    }

    const url = `${this.baseUrl}/contact/contacts/${encodeURIComponent(
      contactId,
    )}`;

    for (let attempt = 0; attempt <= 3; attempt += 1) {
      let response: AxiosResponse | null = null;

      try {
        const receivedResponse = await axios.get(url, {
          headers: {
            'X-API-Key': apiKey,
            Accept: 'application/json',
          },
          timeout: 20_000,
          validateStatus: () => true,
        });
        response = receivedResponse;

        if (receivedResponse.status === 200) {
          return {
            kind: 'found',
            accountId: credential.accountId,
            contact: receivedResponse.data,
          };
        }

        if (
          receivedResponse.status === 401 ||
          receivedResponse.status === 403 ||
          receivedResponse.status === 404
        ) {
          return { kind: 'not_found' };
        }

        const retryable =
          receivedResponse.status === 429 || receivedResponse.status >= 500;
        if (!retryable || attempt === 3) {
          throw new Error(
            `YCloud contact lookup failed accountId=${credential.accountId}: ${this.providerMessage(
              receivedResponse,
            )}`,
          );
        }
      } catch (error) {
        if (attempt === 3) throw error;
      }

      await this.wait(this.retryDelayMs(response, attempt));
    }

    return { kind: 'not_found' };
  }

  private extractPhoneE164(contact: unknown): string | null {
    const objects = this.objectCandidates(contact);

    for (const object of objects) {
      const phone = this.normalizePhone(this.pickPhoneValue(object));

      if (phone) return phone;
    }

    return null;
  }

  private extractPhoneE164FromChangedAttributes(
    changedAttributes:
      | Record<string, YCloudContactAttributeChange>
      | null
      | undefined,
  ): string | null {
    if (!changedAttributes) return null;

    const phoneChange = this.findAttributeChange(changedAttributes, [
      'phoneE164',
      'phone_e164',
      'phone',
      'phoneNumber',
      'phone_number',
      'mobile',
      'whatsapp',
      'whatsappNumber',
      'whatsapp_number',
      'waId',
      'wa_id',
    ]);

    if (!phoneChange) return null;

    const fromNewValue = this.normalizePhone(phoneChange.newValue);
    if (fromNewValue) return fromNewValue;

    return this.normalizePhone(this.pickPhoneValue(phoneChange.newValue));
  }

  private findAttributeChange(
    changedAttributes: Record<string, YCloudContactAttributeChange>,
    keys: string[],
  ): YCloudContactAttributeChange | null {
    for (const key of keys) {
      const exactMatch = changedAttributes[key];
      if (exactMatch) return exactMatch;
    }

    const normalizedKeys = new Set(keys.map((key) => this.normalizeKey(key)));
    for (const [key, change] of Object.entries(changedAttributes)) {
      if (normalizedKeys.has(this.normalizeKey(key))) return change;
    }

    return null;
  }

  private pickPhoneValue(value: unknown): unknown {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return value;
    }

    const object = value as Record<string, unknown>;

    return (
      object.phoneE164 ??
      object.phone_e164 ??
      object.phone ??
      object.phoneNumber ??
      object.phone_number ??
      object.mobile ??
      object.whatsapp ??
      object.whatsappNumber ??
      object.whatsapp_number ??
      object.waId ??
      object.wa_id ??
      null
    );
  }

  private normalizeKey(key: string): string {
    return key.replace(/[^a-z0-9]+/gi, '').toLowerCase();
  }

  private objectCandidates(value: unknown): Record<string, unknown>[] {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return [];

    const root = value as Record<string, unknown>;
    const candidates = [root];

    for (const key of ['data', 'contact']) {
      const nested = root[key];
      if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
        candidates.push(nested as Record<string, unknown>);
      }
    }

    return candidates;
  }

  private normalizePhone(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();

    if (/^\+[1-9]\d{6,14}$/.test(trimmed)) return trimmed;
    if (/^[1-9]\d{6,14}$/.test(trimmed)) return `+${trimmed}`;

    return null;
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
    data: { accountId: string | null; leadId: string | null },
  ) {
    await this.prisma.webhookEvent.updateMany({
      where: { providerEventId: job.providerEventId },
      data: {
        status: WebhookEventStatus.PROCESSED,
        accountId: data.accountId,
        leadId: data.leadId,
        processedAt: new Date(),
        lastError: null,
      },
    });
  }

  private providerMessage(response: AxiosResponse): string {
    const body = response.data as
      | { message?: unknown; error?: { message?: unknown } }
      | undefined;

    return (
      this.nonEmpty(body?.message) ??
      this.nonEmpty(body?.error?.message) ??
      `HTTP ${response.status}`
    );
  }

  private retryDelayMs(response: AxiosResponse | null, attempt: number) {
    const retryAfter: unknown = response
      ? (response.headers as Record<string, unknown>)['retry-after']
      : undefined;
    const retryAfterSeconds =
      typeof retryAfter === 'string' ? Number(retryAfter) : Number.NaN;

    if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds >= 0) {
      return Math.min(retryAfterSeconds * 1000, 10_000);
    }

    return Math.min(500 * 2 ** attempt, 5_000);
  }

  private async wait(milliseconds: number) {
    await new Promise((resolve) => setTimeout(resolve, milliseconds));
  }

  private maskPhone(phoneE164: string) {
    if (phoneE164.length <= 6) return '***';
    return `${phoneE164.slice(0, 3)}***${phoneE164.slice(-3)}`;
  }

  private nonEmpty(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  private formatError(error: unknown): string {
    if (error instanceof Error) return error.message;

    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      return error.message;
    }

    return String(error);
  }
}
