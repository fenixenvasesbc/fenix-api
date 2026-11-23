import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { isDateKey, madridDateKey } from './acquisition-week.util';

const SETTINGS_ID = 'default';

/** Valor vigente en un dia: la fila con effectiveFrom mas reciente <= dia. */
export type DatedValue = { effectiveFrom: string; value: number | null };

export function valueOn(list: DatedValue[] | undefined, day: string): DatedValue | null {
  if (!list) return null;
  let found: DatedValue | null = null;
  // list ordenada por effectiveFrom asc
  for (const item of list) {
    if (item.effectiveFrom > day) break;
    found = item;
  }
  return found;
}

export type SpendFormItemInput = {
  familyId: string;
  // undefined = no tocar; numero = importe diario desde `date` (0 = deja de invertir)
  dailyAmountCents?: number;
  // undefined = no tocar; null = sin objetivo desde `date`
  targetCentsPerLead?: number | null;
};

/**
 * ADR-007 (23/nov/2026): inversion DIARIA por familia "vigente hasta que la
 * cambies" y objetivo de coste por mensaje con historial por fecha.
 * Guardar solo crea/actualiza una fila (effectiveFrom = fecha elegida) para
 * los valores que cambian respecto al vigente ese dia, asi el formulario
 * conserva los ultimos importes y basta con tocar uno.
 */
@Injectable()
export class AcquisitionSpendService {
  constructor(private readonly prisma: PrismaService) {}

  /** Historial de importes y objetivos por familia, ordenado por fecha. */
  async loadSchedules() {
    const [rates, targets] = await Promise.all([
      this.prisma.familySpendRate.findMany({
        orderBy: { effectiveFrom: 'asc' },
        select: { familyId: true, effectiveFrom: true, dailyAmountCents: true },
      }),
      this.prisma.familyLeadTarget.findMany({
        orderBy: { effectiveFrom: 'asc' },
        select: { familyId: true, effectiveFrom: true, targetCentsPerLead: true },
      }),
    ]);
    const spend = new Map<string, DatedValue[]>();
    for (const r of rates) {
      const list = spend.get(r.familyId) ?? [];
      list.push({ effectiveFrom: toKey(r.effectiveFrom), value: r.dailyAmountCents });
      spend.set(r.familyId, list);
    }
    const target = new Map<string, DatedValue[]>();
    for (const t of targets) {
      const list = target.get(t.familyId) ?? [];
      list.push({ effectiveFrom: toKey(t.effectiveFrom), value: t.targetCentsPerLead });
      target.set(t.familyId, list);
    }
    return { spend, target };
  }

  async getForm(dateRaw?: string) {
    const date = dateRaw ?? madridDateKey(new Date());
    if (!isDateKey(date)) throw new BadRequestException('date no es una fecha válida');
    const [families, schedules] = await Promise.all([
      this.prisma.investmentFamily.findMany({
        where: { active: true },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        select: { id: true, name: true, country: true },
      }),
      this.loadSchedules(),
    ]);
    return {
      date,
      items: families.map((f) => {
        const spend = valueOn(schedules.spend.get(f.id), date);
        const target = valueOn(schedules.target.get(f.id), date);
        const laterSpend = (schedules.spend.get(f.id) ?? []).find((s) => s.effectiveFrom > date);
        const laterTarget = (schedules.target.get(f.id) ?? []).find((s) => s.effectiveFrom > date);
        return {
          familyId: f.id,
          name: f.name,
          country: f.country,
          dailyAmountCents: spend?.value ?? null,
          spendEffectiveFrom: spend?.effectiveFrom ?? null,
          targetCentsPerLead: target?.value ?? null,
          targetEffectiveFrom: target?.effectiveFrom ?? null,
          // hay un cambio programado despues de `date` que seguira mandando
          nextChangeFrom: [laterSpend?.effectiveFrom, laterTarget?.effectiveFrom]
            .filter((v): v is string => !!v)
            .sort()[0] ?? null,
        };
      }),
    };
  }

  async saveForm(date: string, items: SpendFormItemInput[], userId: string) {
    if (!isDateKey(date)) throw new BadRequestException('date no es una fecha válida');
    const familyIds = Array.from(new Set(items.map((i) => i.familyId)));
    const existing = await this.prisma.investmentFamily.count({ where: { id: { in: familyIds } } });
    if (existing !== familyIds.length) throw new BadRequestException('Alguna familia no existe');

    const schedules = await this.loadSchedules();
    const day = new Date(`${date}T00:00:00Z`);
    const ops: Prisma.PrismaPromise<unknown>[] = [];
    let changed = 0;
    for (const item of items) {
      if (item.dailyAmountCents !== undefined && item.dailyAmountCents !== null) {
        const current = valueOn(schedules.spend.get(item.familyId), date);
        if (current?.value !== item.dailyAmountCents) {
          changed += 1;
          ops.push(
            this.prisma.familySpendRate.upsert({
              where: { familyId_effectiveFrom: { familyId: item.familyId, effectiveFrom: day } },
              create: {
                familyId: item.familyId,
                effectiveFrom: day,
                dailyAmountCents: item.dailyAmountCents,
                updatedByUserId: userId,
              },
              update: { dailyAmountCents: item.dailyAmountCents, updatedByUserId: userId },
            }),
          );
        }
      }
      if (item.targetCentsPerLead !== undefined) {
        const current = valueOn(schedules.target.get(item.familyId), date);
        const currentValue = current?.value ?? null;
        if (currentValue !== item.targetCentsPerLead) {
          changed += 1;
          ops.push(
            this.prisma.familyLeadTarget.upsert({
              where: { familyId_effectiveFrom: { familyId: item.familyId, effectiveFrom: day } },
              create: {
                familyId: item.familyId,
                effectiveFrom: day,
                targetCentsPerLead: item.targetCentsPerLead,
                updatedByUserId: userId,
              },
              update: { targetCentsPerLead: item.targetCentsPerLead, updatedByUserId: userId },
            }),
          );
        }
      }
    }
    if (ops.length) await this.prisma.$transaction(ops);
    return { ...(await this.getForm(date)), changed };
  }

  // ---- Ajustes (etiqueta de presupuesto) -------------------------------------

  async getSettings() {
    const settings = await this.prisma.acquisitionSettings.findUnique({ where: { id: SETTINGS_ID } });
    const code = settings?.quoteLabelCode ?? null;
    const label = code
      ? await this.prisma.leadLabelDefinition.findUnique({
          where: { code },
          select: { code: true, name: true, color: true },
        })
      : null;
    return { quoteLabelCode: code, quoteLabel: label };
  }

  async updateSettings(input: { quoteLabelCode?: string | null }, userId: string) {
    if (input.quoteLabelCode !== undefined && input.quoteLabelCode !== null) {
      const exists = await this.prisma.leadLabelDefinition.count({ where: { code: input.quoteLabelCode } });
      if (!exists) throw new BadRequestException('La etiqueta no existe');
    }
    if (input.quoteLabelCode !== undefined) {
      await this.prisma.acquisitionSettings.upsert({
        where: { id: SETTINGS_ID },
        create: { id: SETTINGS_ID, quoteLabelCode: input.quoteLabelCode, updatedByUserId: userId },
        update: { quoteLabelCode: input.quoteLabelCode, updatedByUserId: userId },
      });
    }
    return this.getSettings();
  }
}

function toKey(value: Date | string): string {
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
}

