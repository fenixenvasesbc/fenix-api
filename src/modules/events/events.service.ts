import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, MessageDirection, MessageStatus, MessageType, LeadStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { YCloudOutboundAcceptedDto } from './dto/ycloud-outbound-accepted.dto';
import { YCloudInboundReceivedDto } from './dto/ycloud-inbound-received.dto';

@Injectable()
export class EventsService {
  constructor(private readonly prisma: PrismaService) {}

  // -------------------------
  // Helpers
  // -------------------------
  private mapStatus(status?: string): MessageStatus {
    switch ((status || '').toLowerCase()) {
      case 'accepted': return MessageStatus.ACCEPTED;
      case 'sent': return MessageStatus.SENT;
      case 'delivered': return MessageStatus.DELIVERED;
      case 'read': return MessageStatus.READ;
      case 'failed': return MessageStatus.FAILED;
      default: return MessageStatus.UNKNOWN;
    }
  }

  private mapType(type?: string): MessageType {
    switch ((type || '').toLowerCase()) {
      case 'template': return MessageType.TEMPLATE;
      case 'text': return MessageType.TEXT;
      case 'image': return MessageType.IMAGE;
      case 'audio': return MessageType.AUDIO;
      case 'video': return MessageType.VIDEO;
      case 'document': return MessageType.DOCUMENT;
      default: return MessageType.UNKNOWN;
    }
  }

  private extractHeaderImageUrl(payload: any): string | null {
    try {
      const comps = payload?.template?.components;
      if (!Array.isArray(comps)) return null;
      for (const c of comps) {
        if ((c?.type || '').toLowerCase() !== 'header') continue;
        const params = c?.parameters;
        if (!Array.isArray(params)) continue;
        for (const p of params) {
          if ((p?.type || '').toLowerCase() === 'image') {
            return p?.image?.link ?? null;
          }
        }
      }
      return null;
    } catch {
      return null;
    }
  }

  private toStr(v: any): string {
    return v === null || v === undefined ? '' : String(v);
  }

  private normE164Loose(v: any): string {
    // Para producción: evita que “34645...” no matchee con "+34645..."
    let s = this.toStr(v).trim().replace(/\s+/g, '');
    if (!s) return '';
    if (!s.startsWith('+') && /^\d{7,20}$/.test(s)) s = '+' + s;
    return s;
  }

  private pickIsoToDate(iso?: string): Date | null {
    if (!iso) return null;
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  private extractInboundMedia(msg: any): { mediaUrl: string | null; caption: string | null } {
    const t = (msg?.type || '').toLowerCase();

    const media =
      t === 'image' ? msg?.image :
      t === 'video' ? msg?.video :
      t === 'audio' ? msg?.audio :
      t === 'document' ? msg?.document :
      null;

    const mediaUrl = media?.link ?? null;
    const caption = media?.caption ?? null;

    return { mediaUrl, caption };
  }

  // -------------------------
  // Outbound accepted (ya lo tenías)
  // -------------------------
  async registerOutboundAccepted(body: YCloudOutboundAcceptedDto) {
    const account = await this.prisma.account.findUnique({
      where: { wabaId_phoneE164: { wabaId: body.wabaId, phoneE164: body.from } },
      select: { id: true },
    });
    if (!account) {
      throw new NotFoundException(
        `Account not found for wabaId=${body.wabaId} and from=${body.from}`,
      );
    }

    const providerCreateTime = body.createTime ? new Date(body.createTime) : null;
    const providerUpdateTime = body.updateTime ? new Date(body.updateTime) : null;
    const firstOutboundTemplateName = body.template?.name ?? null;

    const nameFromInput = (body.leadName ?? '').trim();
    const emailFromInput = (body.leadEmail ?? '').trim();
    const leadNameFinal = nameFromInput.length > 0 ? nameFromInput : body.to;
    const leadEmailFinal = emailFromInput.length > 0 ? emailFromInput : null;

    const existingLead = await this.prisma.lead.findUnique({
      where: {
        accountId_phoneE164: { accountId: account.id, phoneE164: body.to },
      },
      select: { id: true, name: true, email: true, firstOutboundAt: true },
    });

    let leadId: string;

    if (!existingLead) {
      const created = await this.prisma.lead.create({
        data: {
          accountId: account.id,
          phoneE164: body.to,
          name: leadNameFinal,
          email: leadEmailFinal,
          status: 'NEW',
          firstOutboundAt: providerCreateTime ?? new Date(),
          firstOutboundTemplateName: firstOutboundTemplateName,
        },
        select: { id: true },
      });
      leadId = created.id;
    } else {
      leadId = existingLead.id;

      const data: Prisma.LeadUpdateInput = {};

      if (!existingLead.firstOutboundAt) {
        data.firstOutboundAt = providerCreateTime ?? new Date();
      }

      const templateName = body.template?.name ?? null;
      if (templateName) {
        data.firstOutboundTemplateName = templateName;
      }

      const existingName = (existingLead.name ?? '').trim();
      
      if (existingName.length === 0) {
        data.name = leadNameFinal;
      }

      const existingEmail = (existingLead.email ?? '').trim();
      if ((existingEmail.length === 0) && leadEmailFinal) {
        data.email = leadEmailFinal;
      }

      if (Object.keys(data).length > 0) {
        await this.prisma.lead.update({ where: { id: leadId }, data });
      }
    }

    const msgData: Prisma.MessageCreateInput = {
      account: { connect: { id: account.id } },
      lead: { connect: { id: leadId } },

      direction: MessageDirection.OUTBOUND,
      type: this.mapType(body.type ?? 'template'),

      ycloudMessageId: body.id,
      wamid: body.wamid ?? null,

      templateName: body.template?.name ?? null,
      templateLang: body.template?.language?.code ?? null,
      pricingCategory: body.pricingCategory ?? null,
      totalPrice: body.totalPrice ?? null,
      currency: body.currency ?? null,
      status: this.mapStatus(body.status),

      providerCreateTime,
      providerUpdateTime,

      mediaUrl: this.extractHeaderImageUrl(body as any),
      rawPayload: body as any,
    };

    try {
      const message = await this.prisma.message.create({ data: msgData });
      return {
        ok: true,
        createdMessage: true,
        idempotent: false,
        accountId: account.id,
        leadId,
        messageId: message.id,
      };
    } catch (e: any) {
      if (e?.code === 'P2002') {
        const existing = await this.prisma.message.findUnique({
          where: {
            accountId_ycloudMessageId: {
              accountId: account.id,
              ycloudMessageId: body.id,
            },
          },
          select: { id: true, leadId: true },
        });

        return {
          ok: true,
          createdMessage: false,
          idempotent: true,
          accountId: account.id,
          leadId: existing?.leadId ?? leadId,
          messageId: existing?.id ?? null,
        };
      }
      throw e;
    }
  }

  // -------------------------
  // Inbound received (nuevo)
  // -------------------------
  async registerInboundReceived(body: YCloudInboundReceivedDto) {
    const msg = body.whatsappInboundMessage;

    // Normaliza teléfonos por si llegan sin '+'
    const wabaId = msg.wabaId;
    const businessPhone = this.normE164Loose(msg.to);
    const customerPhone = this.normE164Loose(msg.from);

    // 1) Resolver Account por unique(wabaId, phoneE164=to)
    const account = await this.prisma.account.findUnique({
      where: { wabaId_phoneE164: { wabaId, phoneE164: businessPhone } },
      select: { id: true },
    });
    if (!account) {
      throw new NotFoundException(
        `Account not found for wabaId=${wabaId} and to=${businessPhone}`,
      );
    }

    // 2) Upsert Lead por unique(accountId, phoneE164=from)
    const providerCreateTime = this.pickIsoToDate(body.createTime) ?? null;
    const providerSendTime = this.pickIsoToDate(msg.sendTime) ?? null;

    const inboundName = (msg.customerProfile?.name ?? '').trim();
    const leadNameFallback = customerPhone; // si no hay nombre, al menos queda el teléfono

    const existingLead = await this.prisma.lead.findUnique({
      where: {
        accountId_phoneE164: { accountId: account.id, phoneE164: customerPhone },
      },
      select: { id: true, name: true, firstInboundAt: true, status: true },
    });

    let leadId: string;

    if (!existingLead) {
      const created = await this.prisma.lead.create({
        data: {
          accountId: account.id,
          phoneE164: customerPhone,
          name: inboundName.length > 0 ? inboundName : leadNameFallback,
          status: LeadStatus.RESPONDED,
          firstInboundAt: providerSendTime ?? providerCreateTime ?? new Date(),
        },
        select: { id: true },
      });
      leadId = created.id;
    } else {
      leadId = existingLead.id;

      const leadUpdate: Prisma.LeadUpdateInput = {};

      // firstInboundAt solo si está null
      if (!existingLead.firstInboundAt) {
        leadUpdate.firstInboundAt = providerSendTime ?? providerCreateTime ?? new Date();
      }

      // status: al primer inbound, pasa a RESPONDED (si todavía está NEW)
      if (existingLead.status !== LeadStatus.RESPONDED) {
        leadUpdate.status = LeadStatus.RESPONDED;
      }

      // name: si está vacío y llega customerProfile.name
      const existingName = (existingLead.name ?? '').trim();
      if (existingName.length === 0) {
        leadUpdate.name = inboundName.length > 0 ? inboundName : leadNameFallback;
      }

      if (Object.keys(leadUpdate).length > 0) {
        await this.prisma.lead.update({ where: { id: leadId }, data: leadUpdate });
      }
    }

    // 3) Crear Message INBOUND idempotente por unique(accountId, ycloudMessageId)
    const mappedType = this.mapType(msg.type);
    const textBody =
      mappedType === MessageType.TEXT ? (msg.text?.body ?? null) : null;

    const { mediaUrl, caption } = this.extractInboundMedia(msg as any);

    const msgData: Prisma.MessageCreateInput = {
      account: { connect: { id: account.id } },
      lead: { connect: { id: leadId } },

      direction: MessageDirection.INBOUND,
      type: mappedType,

      ycloudMessageId: msg.id,
      wamid: msg.wamid ?? null,
      contextWamid: msg.context?.id ?? null,

      // inbound normalmente no trae status
      status: MessageStatus.UNKNOWN,

      providerCreateTime,
      providerSendTime,

      textBody: textBody ?? caption ?? null,
      mediaUrl: mediaUrl,

      rawPayload: body as any,
    };

    try {
      const created = await this.prisma.message.create({ data: msgData });
      return {
        ok: true,
        createdMessage: true,
        idempotent: false,
        accountId: account.id,
        leadId,
        messageId: created.id,
      };
    } catch (e: any) {
      if (e?.code === 'P2002') {
        const existing = await this.prisma.message.findUnique({
          where: {
            accountId_ycloudMessageId: {
              accountId: account.id,
              ycloudMessageId: msg.id,
            },
          },
          select: { id: true, leadId: true },
        });

        return {
          ok: true,
          createdMessage: false,
          idempotent: true,
          accountId: account.id,
          leadId: existing?.leadId ?? leadId,
          messageId: existing?.id ?? null,
        };
      }
      throw e;
    }
  }
}