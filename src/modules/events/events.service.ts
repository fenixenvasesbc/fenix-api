import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, MessageDirection, MessageStatus, MessageType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { YCloudOutboundAcceptedDto } from './dto/ycloud-outbound-accepted.dto';

@Injectable()
export class EventsService {
  constructor(private readonly prisma: PrismaService) {}

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

  async registerOutboundAccepted(body: YCloudOutboundAcceptedDto) {
    // 1) Resolver Account por unique(wabaId, phoneE164=from)
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

    // Reglas solicitadas
    const nameFromInput = (body.leadName ?? '').trim();
    const emailFromInput = (body.leadEmail ?? '').trim();
    const leadNameFinal = nameFromInput.length > 0 ? nameFromInput : body.to; // fallback: teléfono
    const leadEmailFinal = emailFromInput.length > 0 ? emailFromInput : null; // vacío -> null

    // 2) Obtener lead existente (si existe) para actualizar solo lo necesario
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
        },
        select: { id: true },
      });
      leadId = created.id;
    } else {
      leadId = existingLead.id;

      // Construimos update mínimo (solo si hace falta)
      const data: Prisma.LeadUpdateInput = {};

      // firstOutboundAt solo si está null
      if (!existingLead.firstOutboundAt) {
        data.firstOutboundAt = providerCreateTime ?? new Date();
      }

      // name:
      // - si viene leadName => si está vacío en BD, lo rellenamos con leadName
      // - si NO viene leadName => si está vacío en BD, lo ponemos como teléfono
      const existingName = (existingLead.name ?? '').trim();
      if (existingName.length === 0) {
        data.name = leadNameFinal; // ya incluye fallback a teléfono
      }

      // email: solo rellenar si está null/vacío y llega leadEmail válido
      const existingEmail = (existingLead.email ?? '').trim();
      if ((existingEmail.length === 0) && leadEmailFinal) {
        data.email = leadEmailFinal;
      }

      if (Object.keys(data).length > 0) {
        await this.prisma.lead.update({ where: { id: leadId }, data });
      }
    }

    // 3) Crear Message idempotente por unique(accountId, ycloudMessageId)
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
}