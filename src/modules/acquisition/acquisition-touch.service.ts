import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { normalizeLandingSlug } from './acquisition-week.util';

export type RecordTouchInput = {
  leadId: string;
  producto: string | null | undefined;
  occurredAt: Date;
  externalMessageId?: string | null;
};

/**
 * ADR-007: registra cada contacto de captacion de n8n (envio con `producto`)
 * como LeadAcquisitionTouch. Reglas:
 * - Sin `producto` no hay toque: solo cuentan los leads que n8n contacta
 *   (quien escribe por su cuenta, aunque sea un compañero, no es captacion).
 * - Slug desconocido -> se auto-registra una Landing SIN familia (pendiente
 *   de asignar en Configuracion); al asignarla, el historico se reclasifica
 *   solo porque la familia se resuelve por join al consultar.
 * - Idempotente por externalMessageId (reintentos de n8n).
 * - NUNCA lanza: un fallo aqui no puede tumbar la recepcion del mensaje.
 */
@Injectable()
export class AcquisitionTouchService {
  private readonly logger = new Logger(AcquisitionTouchService.name);

  constructor(private readonly prisma: PrismaService) {}

  async recordTouch(input: RecordTouchInput): Promise<void> {
    const slug = normalizeLandingSlug(input.producto);
    if (!slug) return;

    try {
      const landing = await this.findOrCreateLanding(slug);

      await this.prisma.leadAcquisitionTouch.create({
        data: {
          leadId: input.leadId,
          landingId: landing.id,
          rawProducto: String(input.producto).slice(0, 500),
          occurredAt: input.occurredAt,
          externalMessageId: input.externalMessageId ?? null,
        },
      });
    } catch (e: unknown) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        return; // mismo envio reintentado: ya registrado
      }
      this.logger.warn(
        `No se pudo registrar el toque de captacion (lead=${input.leadId}, producto=${String(input.producto)}): ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
    }
  }

  private async findOrCreateLanding(slug: string) {
    const existing = await this.prisma.landing.findUnique({
      where: { slug },
      select: { id: true },
    });
    if (existing) return existing;

    try {
      const created = await this.prisma.landing.create({
        data: { slug, autoCreated: true },
        select: { id: true },
      });
      this.logger.log(
        `Landing nueva auto-registrada sin familia: ${slug} (asignarla en Configuracion > Campañas y familias)`,
      );
      return created;
    } catch (e: unknown) {
      // Carrera con otro envio simultaneo del mismo slug
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        return this.prisma.landing.findUniqueOrThrow({
          where: { slug },
          select: { id: true },
        });
      }
      throw e;
    }
  }
}
