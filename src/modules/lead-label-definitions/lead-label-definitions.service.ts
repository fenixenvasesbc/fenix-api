import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import {
  SYSTEM_LABEL_SEED,
  SystemLabelCode,
} from 'src/common/constants/lead-labels';

type CreateInput = {
  name: string;
  color?: string;
  alertThresholdDays?: number;
  sortOrder?: number;
};

type UpdateInput = {
  id: string;
  name?: string;
  color?: string;
  alertThresholdDays?: number | null;
  active?: boolean;
  sortOrder?: number;
};

/**
 * CRUD de labels de lead configurables desde la UI (Configuracion > Etiquetas).
 *
 * Reemplaza el antiguo enum fijo LeadLabel: es un catalogo GLOBAL compartido
 * por todas las cuentas, sembrado con las 6 labels originales como "sistema"
 * (isSystem = true, no se pueden borrar, pero su nombre/color/umbral de
 * alerta si son editables) mas cualquier label custom que se cree desde aqui.
 * Editar o crear una label aplica para todo el sistema, no para una cuenta
 * en particular.
 *
 * IMPORTANTE: esto es SOLO el sistema de alertas in-app (AppNotification,
 * ver NotificationsService.runLabelAlerts). El envio automatico de mensajes
 * de WhatsApp para el label "REPETICIONES" (LeadRepetitionReminder +
 * RepetitionReminderSchedulerService/DispatchService) no se toca aqui y
 * sigue funcionando igual: ese codigo especifico ('REPETICIONES') no debe
 * cambiar ni borrarse.
 */
@Injectable()
export class LeadLabelDefinitionsService {
  constructor(private readonly prisma: PrismaService) {}

  async list() {
    await this.ensureSystemLabelsSeeded();

    return this.prisma.leadLabelDefinition.findMany({
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
  }

  async create(input: CreateInput) {
    const code = await this.buildUniqueCustomCode(input.name);

    return this.prisma.leadLabelDefinition.create({
      data: {
        code,
        name: input.name.trim(),
        color: input.color ?? null,
        isSystem: false,
        alertThresholdDays: input.alertThresholdDays ?? null,
        active: true,
        sortOrder: input.sortOrder ?? 0,
      },
    });
  }

  async update(input: UpdateInput) {
    const definition = await this.prisma.leadLabelDefinition.findUnique({
      where: { id: input.id },
    });

    if (!definition) {
      throw new NotFoundException('Label not found');
    }

    if (definition.isSystem && input.active === false) {
      throw new BadRequestException(
        'No se puede desactivar una label de sistema',
      );
    }

    return this.prisma.leadLabelDefinition.update({
      where: { id: definition.id },
      data: {
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        ...(input.color !== undefined ? { color: input.color } : {}),
        ...(input.alertThresholdDays !== undefined
          ? { alertThresholdDays: input.alertThresholdDays }
          : {}),
        ...(input.active !== undefined ? { active: input.active } : {}),
        ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
      },
    });
  }

  async remove(id: string) {
    const definition = await this.prisma.leadLabelDefinition.findUnique({
      where: { id },
    });

    if (!definition) {
      throw new NotFoundException('Label not found');
    }

    if (definition.isSystem) {
      throw new BadRequestException(
        'Las labels de sistema no se pueden borrar, solo desactivar su alerta',
      );
    }

    // Como el catalogo ahora es global, se bloquea el borrado si CUALQUIER
    // cuenta la tiene asignada a un lead activo (no solo una en particular).
    const inUse = await this.prisma.leadLabelAssignment.findFirst({
      where: { label: definition.code, removedAt: null },
      select: { id: true },
    });

    if (inUse) {
      throw new ConflictException(
        'No se puede borrar una label que esta asignada a leads activos',
      );
    }

    await this.prisma.leadLabelDefinition.delete({ where: { id: definition.id } });

    return { deleted: true };
  }

  // Siembra las 6 labels de sistema si por algun motivo faltan (ej. primer
  // arranque de un entorno nuevo). Idempotente via unique(code).
  private async ensureSystemLabelsSeeded() {
    await this.prisma.leadLabelDefinition.createMany({
      data: SYSTEM_LABEL_SEED.map((seed) => ({
        code: seed.code as SystemLabelCode,
        name: seed.name,
        isSystem: true,
        alertThresholdDays: seed.alertThresholdDays,
        active: true,
        sortOrder: seed.sortOrder,
      })),
      skipDuplicates: true,
    });
  }

  private async buildUniqueCustomCode(name: string) {
    const base =
      name
        .trim()
        .toUpperCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '') // quita acentos
        .replace(/[^A-Z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 50) || 'LABEL';

    let candidate = base;
    let attempt = 1;

    while (
      await this.prisma.leadLabelDefinition.findFirst({
        where: { code: candidate },
        select: { id: true },
      })
    ) {
      attempt += 1;
      candidate = `${base}_${attempt}`;
    }

    return candidate;
  }
}
