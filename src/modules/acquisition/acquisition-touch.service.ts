import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export type RecordTouchInput = {
  leadId: string;
  templateName: string | null | undefined;
  occurredAt: Date;
  externalMessageId?: string | null;
};

/**
 * ADR-007: registra cada contacto de captacion de n8n como
 * LeadAcquisitionTouch, a partir de la PLANTILLA del envio. Solo se llama
 * desde POST /events/outbound/accepted, que solo usa n8n: los envios
 * manuales de Fenix no pasan por aqui y no cuentan como captacion.
 *
 * - Sin plantilla no hay toque.
 * - Plantilla desconocida -> se auto-registra SIN familia (pendiente de
 *   asignar en Configuracion); al asignarla, el historico se reclasifica
 *   solo porque la familia se resuelve por join al consultar.
 * - Idempotente por externalMessageId (reintentos de n8n y backfill).
 * - NUNCA lanza: un fallo aqui no puede tumbar la recepcion del mensaje.
 */
@Injectable()
export class AcquisitionTouchService {
  private readonly logger = new Logger(AcquisitionTouchService.name);

  constructor(private readonly prisma: PrismaService) {}

  async recordTouch(input: RecordTouchInput): Promise<void> {
    const templateName = (input.templateName ?? '').trim();
    if (!templateName) return;

    try {
      const template = await this.findOrCreateTemplate(templateName);

      await this.prisma.leadAcquisitionTouch.create({
        data: {
          leadId: input.leadId,
          templateId: template.id,
          templateName,
          occurredAt: input.occurredAt,
          externalMessageId: input.externalMessageId ?? null,
          source: 'LIVE',
        },
      });
    } catch (e: unknown) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        return; // mismo envio reintentado (o ya reconstruido): ya registrado
      }
      this.logger.warn(
        `No se pudo registrar el toque de captacion (lead=${input.leadId}, plantilla=${templateName}): ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
    }
  }

  /**
   * Reconstruye los toques historicos de una plantilla. Mismo criterio que
   * la migracion 20261122180000, en dos pasos (idempotente):
   * 1. Envios exactos desde Message que entraron por
   *    POST /events/outbound/accepted: rawPayload plano de n8n (wabaId +
   *    template), sin externalId, sin "source" (envios manuales de Fenix) ni
   *    "whatsappMessage" (reconstruidos desde webhooks).
   * 2. Para los leads que siguen sin ningun toque: Lead.firstOutboundTemplateName
   *    + firstOutboundAt (cubre los leads antiguos, cuyo primer envio llego
   *    reconstruido desde el webhook de YCloud).
   */
  async backfillTemplate(templateId: string, templateName: string): Promise<number> {
    const fromMessages = await this.prisma.$executeRaw(Prisma.sql`
      INSERT INTO "LeadAcquisitionTouch"
        ("id", "leadId", "templateId", "templateName", "occurredAt", "externalMessageId", "source")
      SELECT md5('touch:' || m."id")::uuid::text,
             m."leadId",
             ${templateId},
             m."templateName",
             COALESCE(m."providerCreateTime", m."occurredAt"),
             m."ycloudMessageId",
             'BACKFILL'
      FROM "Message" m
      WHERE m."templateName" = ${templateName}
        AND m."direction" = 'OUTBOUND'
        AND m."externalId" IS NULL
        AND jsonb_exists(m."rawPayload", 'wabaId')
        AND jsonb_exists(m."rawPayload", 'template')
        AND NOT jsonb_exists(m."rawPayload", 'whatsappMessage')
        AND NOT jsonb_exists(m."rawPayload", 'source')
      ON CONFLICT DO NOTHING
    `);
    const fromLeads = await this.prisma.$executeRaw(Prisma.sql`
      INSERT INTO "LeadAcquisitionTouch"
        ("id", "leadId", "templateId", "templateName", "occurredAt", "externalMessageId", "source")
      SELECT md5('lead-touch:' || l."id")::uuid::text,
             l."id",
             ${templateId},
             l."firstOutboundTemplateName",
             l."firstOutboundAt",
             NULL,
             'BACKFILL_LEAD'
      FROM "Lead" l
      WHERE l."firstOutboundTemplateName" = ${templateName}
        AND l."firstOutboundAt" IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM "LeadAcquisitionTouch" t WHERE t."leadId" = l."id")
      ON CONFLICT DO NOTHING
    `);
    return fromMessages + fromLeads;
  }

  private async findOrCreateTemplate(templateName: string) {
    const existing = await this.prisma.acquisitionTemplate.findUnique({
      where: { templateName },
      select: { id: true },
    });
    if (existing) return existing;

    try {
      const created = await this.prisma.acquisitionTemplate.create({
        data: { templateName, autoCreated: true },
        select: { id: true },
      });
      this.logger.log(
        `Plantilla de captacion nueva auto-registrada sin familia: ${templateName} (asignarla en Configuracion > Campañas y familias)`,
      );
      return created;
    } catch (e: unknown) {
      // Carrera con otro envio simultaneo de la misma plantilla
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        return this.prisma.acquisitionTemplate.findUniqueOrThrow({
          where: { templateName },
          select: { id: true },
        });
      }
      throw e;
    }
  }
}
