import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';

type CreateInput = {
  name: string;
  color?: string;
  sortOrder?: number;
};

type UpdateInput = {
  id: string;
  name?: string;
  color?: string;
  active?: boolean;
  sortOrder?: number;
};

/**
 * CRUD de categorias de boceto configurables desde la UI (Configuracion >
 * Categorias). Catalogo GLOBAL (igual criterio que LeadLabelDefinition:
 * una sola definicion compartida, no por cuenta), pero deliberadamente
 * APARTE de las labels de lead -- no tienen `code`, ni `isSystem`, ni
 * disparan ninguna automatizacion (LabelMessageRule, alertas in-app); son
 * solo clasificacion/filtro manual de solicitudes de boceto. Pedido
 * explicito del usuario, 27/oct/2026.
 *
 * Crear/editar/borrar queda solo para ADMIN (y, por ROLE_INHERITANCE,
 * SUPPORT) -- a diferencia de las labels de lead, donde SALES_MANAGER
 * tambien puede: aqui no hay un equivalente "manager" con acceso a
 * Configuracion (DESIGNER_MANAGER queda fuera a proposito, ver ADR-004 /
 * decision explicita del usuario al pedir esta funcionalidad). Leer el
 * catalogo (list) lo puede hacer cualquier rol del modulo de bocetos
 * (ADMIN, SALES, SALES_MANAGER, DESIGNER, DESIGNER_MANAGER), ya que lo
 * necesitan para los selectores de categoria en "Crear boceto" y el
 * detalle de la solicitud.
 */
@Injectable()
export class DesignRequestCategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  async list() {
    return this.prisma.designRequestCategory.findMany({
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
  }

  async create(input: CreateInput) {
    const name = input.name.trim();

    const existing = await this.prisma.designRequestCategory.findUnique({
      where: { name },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException('Ya existe una categoría con ese nombre');
    }

    return this.prisma.designRequestCategory.create({
      data: {
        name,
        color: input.color ?? null,
        active: true,
        sortOrder: input.sortOrder ?? 0,
      },
    });
  }

  async update(input: UpdateInput) {
    const category = await this.prisma.designRequestCategory.findUnique({
      where: { id: input.id },
    });

    if (!category) {
      throw new NotFoundException('Categoría no encontrada');
    }

    if (input.name !== undefined) {
      const name = input.name.trim();
      const existing = await this.prisma.designRequestCategory.findUnique({
        where: { name },
        select: { id: true },
      });
      if (existing && existing.id !== category.id) {
        throw new ConflictException('Ya existe una categoría con ese nombre');
      }
    }

    return this.prisma.designRequestCategory.update({
      where: { id: category.id },
      data: {
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        ...(input.color !== undefined ? { color: input.color } : {}),
        ...(input.active !== undefined ? { active: input.active } : {}),
        ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
      },
    });
  }

  async remove(id: string) {
    const category = await this.prisma.designRequestCategory.findUnique({
      where: { id },
    });

    if (!category) {
      throw new NotFoundException('Categoría no encontrada');
    }

    // Igual criterio que LeadLabelDefinitionsService.remove(): si esta en
    // uso, se bloquea el borrado (sugiere desactivar en vez de borrar) en
    // vez de dejar que el cascade de la FK se la lleve en silencio de
    // solicitudes que la siguen mostrando.
    const inUse = await this.prisma.designRequestCategoryAssignment.findFirst({
      where: { categoryId: id },
      select: { id: true },
    });

    if (inUse) {
      throw new BadRequestException(
        'No se puede borrar una categoría que está asignada a alguna solicitud -- desactívala en su lugar',
      );
    }

    await this.prisma.designRequestCategory.delete({ where: { id } });

    return { deleted: true };
  }

  // Usado por DesignBoardService al crear/editar una solicitud: valida
  // que los ids existan y esten activos antes de asignarlos (evita que
  // una categoria desactivada, o un id inventado, se cuele via API).
  async assertActiveCategoryIds(categoryIds: string[]): Promise<void> {
    if (categoryIds.length === 0) return;

    const unique = Array.from(new Set(categoryIds));
    const found = await this.prisma.designRequestCategory.findMany({
      where: { id: { in: unique }, active: true },
      select: { id: true },
    });

    if (found.length !== unique.length) {
      throw new BadRequestException(
        'Una o más categorías indicadas no existen o están inactivas',
      );
    }
  }
}
