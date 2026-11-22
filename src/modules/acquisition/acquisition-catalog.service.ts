import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DesignRequestCountry, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { normalizeLandingSlug } from './acquisition-week.util';

/**
 * ADR-007: catalogo de familias de inversion y equivalencias landing->familia
 * (Configuracion > Campañas y familias, solo SUPPORT). Nada se borra si ya
 * tiene datos: las familias se desactivan y las landings con toques solo se
 * pueden reasignar, para no perder historico.
 */
@Injectable()
export class AcquisitionCatalogService {
  constructor(private readonly prisma: PrismaService) {}

  async listFamilies() {
    const families = await this.prisma.investmentFamily.findMany({
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: {
        landings: { select: { id: true, slug: true }, orderBy: { slug: 'asc' } },
      },
    });
    return families;
  }

  async createFamily(input: {
    name: string;
    country: DesignRequestCountry;
    sortOrder?: number;
  }) {
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
    input: {
      name?: string;
      country?: DesignRequestCountry;
      sortOrder?: number;
      active?: boolean;
    },
  ) {
    await this.findFamilyOrThrow(id);
    const name = input.name?.trim();
    if (input.name !== undefined && !name) {
      throw new BadRequestException('El nombre es obligatorio');
    }
    try {
      return await this.prisma.investmentFamily.update({
        where: { id },
        data: {
          name,
          country: input.country,
          sortOrder: input.sortOrder,
          active: input.active,
        },
      });
    } catch (e) {
      this.rethrowUnique(e, 'Ya existe una familia con ese nombre');
    }
  }

  async listLandings() {
    const landings = await this.prisma.landing.findMany({
      orderBy: [{ slug: 'asc' }],
      include: {
        family: { select: { id: true, name: true, country: true } },
        _count: { select: { touches: true } },
      },
    });
    // Pendientes de asignar primero
    return landings
      .map(({ _count, ...landing }) => ({ ...landing, touchCount: _count.touches }))
      .sort((a, b) => Number(a.familyId !== null) - Number(b.familyId !== null));
  }

  async createLanding(input: { slug: string; familyId?: string }) {
    const slug = this.requireSlug(input.slug);
    if (input.familyId) await this.findFamilyOrThrow(input.familyId);
    try {
      return await this.prisma.landing.create({
        data: { slug, familyId: input.familyId ?? null },
        include: { family: { select: { id: true, name: true, country: true } } },
      });
    } catch (e) {
      this.rethrowUnique(e, 'Ya existe una landing con ese producto');
    }
  }

  async updateLanding(id: string, input: { slug?: string; familyId?: string | null }) {
    const landing = await this.prisma.landing.findUnique({
      where: { id },
      include: { _count: { select: { touches: true } } },
    });
    if (!landing) throw new NotFoundException('Landing no encontrada');

    let slug: string | undefined;
    if (input.slug !== undefined) {
      slug = this.requireSlug(input.slug);
      // Con toques ya registrados, el slug es la clave con la que n8n la
      // identifica: cambiarlo haria que los proximos envios creen otra.
      if (slug !== landing.slug && landing._count.touches > 0) {
        throw new BadRequestException(
          'Esta landing ya tiene leads registrados: no se puede cambiar su producto. Crea una landing nueva y asígnala a la familia que corresponda.',
        );
      }
    }
    if (input.familyId) await this.findFamilyOrThrow(input.familyId);

    try {
      return await this.prisma.landing.update({
        where: { id },
        data: {
          slug,
          familyId: input.familyId === undefined ? undefined : input.familyId,
          // asignada a mano: deja de figurar como auto-registrada
          autoCreated: input.familyId ? false : undefined,
        },
        include: { family: { select: { id: true, name: true, country: true } } },
      });
    } catch (e) {
      this.rethrowUnique(e, 'Ya existe una landing con ese producto');
    }
  }

  async deleteLanding(id: string) {
    const landing = await this.prisma.landing.findUnique({
      where: { id },
      include: { _count: { select: { touches: true } } },
    });
    if (!landing) throw new NotFoundException('Landing no encontrada');
    if (landing._count.touches > 0) {
      throw new BadRequestException(
        'Esta landing ya tiene leads registrados y no se puede borrar. Puedes moverla a otra familia.',
      );
    }
    await this.prisma.landing.delete({ where: { id } });
    return { ok: true };
  }

  private requireSlug(raw: string): string {
    const slug = normalizeLandingSlug(raw);
    if (!slug) throw new BadRequestException('El producto (slug) no es válido');
    return slug;
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
