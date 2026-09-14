import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';

type CreateInput = {
  name: string;
  labelCode: string;
  triggerAfterDays: number;
  templateName: string;
  createdByUserId?: string;
};

type UpdateInput = {
  id: string;
  name?: string;
  labelCode?: string;
  triggerAfterDays?: number;
  templateName?: string;
  active?: boolean;
};

/**
 * CRUD de LabelMessageRule (Configuracion > Reglas de mensajes), la
 * implementacion de ADR-002: "si un lead lleva N dias en esta etiqueta,
 * mandale esta plantilla de WhatsApp", configurable sin escribir codigo.
 *
 * Solo el rol SUPPORT puede llegar a estos endpoints (ver el controller);
 * ADMIN queda excluido de esta pantalla en particular a proposito, por
 * pedido explicito, aunque SUPPORT hereda todo el resto de los permisos
 * de ADMIN via ROLE_INHERITANCE.
 */
@Injectable()
export class LabelMessageRulesService {
  constructor(private readonly prisma: PrismaService) {}

  async list() {
    return this.prisma.labelMessageRule.findMany({
      orderBy: [{ active: 'desc' }, { createdAt: 'desc' }],
    });
  }

  async create(input: CreateInput) {
    await this.assertLabelCodeExists(input.labelCode);
    await this.assertTemplateNameExists(input.templateName);

    return this.prisma.labelMessageRule.create({
      data: {
        name: input.name.trim(),
        labelCode: input.labelCode,
        triggerAfterDays: input.triggerAfterDays,
        templateName: input.templateName,
        active: true,
        createdByUserId: input.createdByUserId ?? null,
      },
    });
  }

  async update(input: UpdateInput) {
    const rule = await this.prisma.labelMessageRule.findUnique({
      where: { id: input.id },
    });

    if (!rule) {
      throw new NotFoundException('Label message rule not found');
    }

    if (input.labelCode !== undefined) {
      await this.assertLabelCodeExists(input.labelCode);
    }

    if (input.templateName !== undefined) {
      await this.assertTemplateNameExists(input.templateName);
    }

    return this.prisma.labelMessageRule.update({
      where: { id: rule.id },
      data: {
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        ...(input.labelCode !== undefined
          ? { labelCode: input.labelCode }
          : {}),
        ...(input.triggerAfterDays !== undefined
          ? { triggerAfterDays: input.triggerAfterDays }
          : {}),
        ...(input.templateName !== undefined
          ? { templateName: input.templateName }
          : {}),
        ...(input.active !== undefined ? { active: input.active } : {}),
      },
    });
  }

  async remove(id: string) {
    const rule = await this.prisma.labelMessageRule.findUnique({
      where: { id },
    });

    if (!rule) {
      throw new NotFoundException('Label message rule not found');
    }

    await this.prisma.labelMessageRule.delete({ where: { id } });

    return { deleted: true };
  }

  private async assertLabelCodeExists(labelCode: string) {
    const label = await this.prisma.leadLabelDefinition.findFirst({
      where: { code: labelCode },
      select: { id: true },
    });

    if (!label) {
      throw new BadRequestException(
        `No existe una etiqueta con codigo "${labelCode}"`,
      );
    }
  }

  private async assertTemplateNameExists(templateName: string) {
    const template = await this.prisma.globalWhatsappTemplate.findFirst({
      where: { name: templateName },
      select: { id: true },
    });

    if (!template) {
      throw new BadRequestException(
        `No existe una plantilla global con nombre "${templateName}"`,
      );
    }
  }
}
