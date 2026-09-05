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
  accountId: string;
  name: string;
  color?: string;
  alertThresholdDays?: number;
  sortOrder?: number;
};

type UpdateInput = {
  accountId: string;
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
 * Reemplaza el antiguo enum fijo LeadLabel: cada Account tiene sus propias
 * filas de LeadLabelDefinition, sembradas con las 6 labels originales como
 * "sistema" (isSystem = true, no se pueden borrar, pero su nombre/color/
 * umbral de alerta si son editables) mas cualquier label custom que se cree
 * desde aqui.
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

  async listByAccount(accountId: string) {
    await this.ensureSystemLabelsSeeded(accountId);

    return this.prisma.leadLabelDefinition.findMany({
      where: { accountId },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
  }

  async create(input: CreateInput) {
    const code = await this.buildUniqueCustomCode(input.accountId, input.name);

    return this.prisma.leadLabelDefinition.create({
      data: {
        accountId: input.accountId,
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
    const definition = await this.prisma.leadLabelDefinition.findFirst({
      where: { id: input.id, accountId: input.accountId },
    });

    if (!definition) {
      throw new NotFoundException('Label not found for this account');
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

  async remove(accountId: string, id: string) {
    const definition = await this.prisma.leadLabelDefinition.findFirst({
      where: { id, accountId },
    });

    if (!definition) {
      throw new NotFoundException('Label not found for this account');
    }

    if (definition.isSystem) {
      throw new BadRequestException(
        'Las labels de sistema no se pueden borrar, solo desactivar su alerta',
      );
    }

    const inUse = await this.prisma.leadLabelAssignment.findFirst({
      where: { accountId, label: definition.code, removedAt: null },
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

  // Por si una cuenta se creo antes de que existiera este modulo, o por
  // cualquier motivo le faltan las 6 filas de sistema: las siembra de forma
  // idempotente (skipDuplicates via unique [accountId, code]).
  private async ensureSystemLabelsSeeded(accountId: string) {
    await this.prisma.leadLabelDefinition.createMany({
      data: SYSTEM_LABEL_SEED.map((seed) => ({
        accountId,
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

  private async buildUniqueCustomCode(accountId: string, name: string) {
    const base =
      name
        .trim()
        .toUpperCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '') // quita acentos
        .replace(/[^A-Z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 50) || 'LABEL';

    let candidate = base;
    let attempt = 1;

    while (
      await this.prisma.leadLabelDefinition.findFirst({
        where: { accountId, code: candidate },
        select: { id: true },
      })
    ) {
      attempt += 1;
      candidate = `${base}_${attempt}`;
    }

    return candidate;
  }
}
