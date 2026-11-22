import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DesignRequestCountry, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AcquisitionTouchService } from './acquisition-touch.service';

const TEMPLATE_NAME_RE = /^[A-Za-z0-9_.-]{1,120}$/;

/**
 * ADR-007: catalogo de familias de inversion y equivalencias
 * plantilla -> familia (Configuracion > Campañas y familias, solo SUPPORT).
 * Nada con datos se borra: las familias se desactivan y las plantillas con
 * toques solo se pueden reasignar, para no perder historico.
 */
@Injectable()
export class AcquisitionCatalogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly touches: AcquisitionTouchService,
  ) {}

  async listFamilies() {
    return this.prisma.investmentFamily.findMany({
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: {
        templates: {
          select: { id: true, templateName: true },
          orderBy: { templateName: 'asc' },
        },
      },
    });
  }

  async createFamily(input: { name: string; country: DesignRequestCountry; sortOrder?: number }) {
    const name = input.name.trim();
    if (!name) throw new BadRequestException('El nombre es obligatorio');
    try {
      return await this.prisma.investmentFamily.create({
        data: { name, country: input.country, sortOrder: input.sortOrder ?? 0 },
      });
    } catch (e) {
      this.rethrowUnique(e, 'Ya existe una familia con ese nombre');
    }
  }

  async updateFamily(
    id: string,
    input: { name?: string; country?: DesignRequestCountry; sortOrder?: number; active?: boolean },
  ) {
    await this.findFamilyOrThrow(id);
    const name = input.name?.trim();
    if (input.name !== undefined && !name) {
      throw new BadRequestException('El nombre es obligatorio');
    }
    try {
      return await this.prisma.investmentFamily.update({
        where: { id },
        data: { name, country: input.country, sortOrder: input.sortOrder, active: input.active },
      });
    } catch (e) {
      this.rethrowUnique(e, 'Ya existe una familia con ese nombre');
    }
  }

  async listTemplates() {
    const templates = await this.prisma.acquisitionTemplate.findMany({
      orderBy: [{ templateName: 'asc' }],
      include: {
        family: { select: { id: true, name: true, country: true } },
        _count: { select: { touches: true } },
      },
    });
    // Pendientes de asignar primero
    return templates
      .map(({ _count, ...template }) => ({ ...template, touchCount: _count.touches }))
      .sort((a, b) => Number(a.familyId !== null) - Number(b.familyId !== null));
  }

  /**
   * Alta manual de una plantilla. Reconstruye en el acto los envios
   * historicos de n8n con esa plantilla, para que el reporte la incluya
   * desde el principio.
   */
  async createTemplate(input: { templateName: string; familyId?: string }) {
    const templateName = this.requireTemplateName(input.templateName);
    if (input.familyId) await this.findFamilyOrThrow(input.familyId);
    let created;
    try {
      created = await this.prisma.acquisitionTemplate.create({
        data: { templateName, familyId: input.familyId ?? null },
        include: { family: { select: { id: true, name: true, country: true } } },
      });
    } catch (e) {
      this.rethrowUnique(e, 'Esa plantilla ya está en el catálogo');
    }
    const backfilled = await this.touches.backfillTemplate(created.id, created.templateName);
    return { ...created, backfilled };
  }

  async updateTemplate(id: string, input: { templateName?: string; familyId?: string | null }) {
    const template = await this.prisma.acquisitionTemplate.findUnique({
      where: { id },
      include: { _count: { select: { touches: true } } },
    });
    if (!template) throw new NotFoundException('Plantilla no encontrada');

    let templateName: string | undefined;
    if (input.templateName !== undefined) {
      templateName = this.requireTemplateName(input.templateName);
      // Con toques ya registrados el nombre es la clave con la que llegan
      // los envios: cambiarlo haria que los proximos creen otra plantilla.
      if (templateName !== template.templateName && template._count.touches > 0) {
        throw new BadRequestException(
          'Esta plantilla ya tiene leads registrados: no se puede renombrar. Añade la plantilla nueva y asígnala a la familia que corresponda.',
        );
      }
    }
    if (input.familyId) await this.findFamilyOrThrow(input.familyId);

    try {
      const updated = await this.prisma.acquisitionTemplate.update({
        where: { id },
        data: {
          templateName,
          familyId: input.familyId === undefined ? undefined : input.familyId,
          autoCreated: input.familyId ? false : undefined,
        },
        include: { family: { select: { id: true, name: true, country: true } } },
      });
      // Si cambio el nombre (plantilla sin datos), traer su historico
      const backfilled =
        templateName && templateName !== template.templateName
          ? await this.touches.backfillTemplate(updated.id, updated.templateName)
          : 0;
      return { ...updated, backfilled };
    } catch (e) {
      this.rethrowUnique(e, 'Esa plantilla ya está en el catálogo');
    }
  }

  async deleteTemplate(id: string) {
    const template = await this.prisma.acquisitionTemplate.findUnique({
      where: { id },
      include: { _count: { select: { touches: true } } },
    });
    if (!template) throw new NotFoundException('Plantilla no encontrada');
    if (template._count.touches > 0) {
      throw new BadRequestException(
        'Esta plantilla ya tiene leads registrados y no se puede borrar. Puedes moverla a otra familia.',
      );
    }
    await this.prisma.acquisitionTemplate.delete({ where: { id } });
    return { ok: true };
  }

  private requireTemplateName(raw: string): string {
    const name = raw.trim();
    if (!TEMPLATE_NAME_RE.test(name)) {
      throw new BadRequestException(
        'Nombre de plantilla no válido (letras, números, "_", "-" o "."; tal como está en YCloud)',
      );
    }
    return name;
  }

  private async findFamilyOrThrow(id: string) {
    const family = await this.prisma.investmentFamily.findUnique({ where: { id } });
    if (!family) throw new NotFoundException('Familia no encontrada');
    return family;
  }

  private rethrowUnique(e: unknown, message: string): never {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      throw new ConflictException(message);
    }
    throw e;
  }
}
