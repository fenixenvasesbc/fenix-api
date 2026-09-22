import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  AccountCampaignTemplateStatus,
  CampaignDefinitionStatus,
  CampaignDefinitionType,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { YcloudService } from '../ycloud/ycloud.service';
import type { YcloudWhatsappTemplate } from 'src/common/types/ycloud-types';
import {
  CAMPAIGN_TEMPLATE_REGISTRY,
  CampaignTemplateRegistryEntry,
} from './campaign-template-registry';

type AppliedTemplate = {
  internalLanguage: string;
  ycloudLanguage: string;
  officialTemplateId: string;
  status: AccountCampaignTemplateStatus;
};

type CollisionInfo = {
  internalLanguage: string;
  candidates: string[];
  resolved: string | null;
  reason?: string;
};

type EntrySyncResult = {
  templateName: string;
  type: CampaignDefinitionType;
  templatesFound: number;
  applied: AppliedTemplate[];
  skippedInvalid: number;
  collisions: CollisionInfo[];
};

// Sincroniza CampaignDefinition/AccountCampaignTemplate (usados por
// Repeticion y Reenganche) contra YCloud para UNA cuenta puntual, a demanda
// -- pensado para el boton "Sincronizar campañas" de una comercial, una vez
// que sus plantillas ya quedaron aprobadas en Meta (ver ADR-003). Reemplaza
// la necesidad de correr los scripts sync-*-templates-from-ycloud.ts a mano
// para el caso comun de "esta cuenta, ahora"; los scripts CLI se mantienen
// para uso manual/debug multi-cuenta.
@Injectable()
export class CampaignTemplateSyncService {
  private readonly logger = new Logger(CampaignTemplateSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ycloudService: YcloudService,
  ) {}

  async syncAccount(
    accountId: string,
    options?: { preferLanguage?: Record<string, string> },
  ) {
    const account = await this.prisma.account.findUnique({
      where: { id: accountId },
      select: {
        id: true,
        name: true,
        wabaId: true,
        user: { select: { isActive: true } },
      },
    });
    if (!account) {
      throw new NotFoundException('Cuenta comercial no encontrada');
    }
    if (!account.user?.isActive) {
      throw new BadRequestException(
        'La cuenta comercial no tiene un usuario activo',
      );
    }

    let templates: YcloudWhatsappTemplate[];
    try {
      templates = await this.ycloudService.listWhatsappTemplates({ accountId });
    } catch (error) {
      throw new BadRequestException(
        `No se pudo listar las plantillas de YCloud: ${this.errorMessage(error)}`,
      );
    }

    const entries: EntrySyncResult[] = [];
    for (const registryEntry of CAMPAIGN_TEMPLATE_REGISTRY) {
      entries.push(
        await this.syncEntry({
          account,
          templates,
          registryEntry,
          preferLanguage:
            options?.preferLanguage?.[registryEntry.templateName] ?? null,
        }),
      );
    }

    return {
      accountId: account.id,
      accountName: account.name,
      entries,
    };
  }

  private async syncEntry(input: {
    account: { id: string; name: string; wabaId: string };
    templates: YcloudWhatsappTemplate[];
    registryEntry: CampaignTemplateRegistryEntry;
    preferLanguage: string | null;
  }): Promise<EntrySyncResult> {
    const { account, templates, registryEntry, preferLanguage } = input;

    const matching = templates.filter(
      (template) => this.nonEmpty(template.name) === registryEntry.templateName,
    );

    const result: EntrySyncResult = {
      templateName: registryEntry.templateName,
      type: registryEntry.type,
      templatesFound: matching.length,
      applied: [],
      skippedInvalid: 0,
      collisions: [],
    };

    if (matching.length === 0) {
      return result;
    }

    // Agrupa por idioma interno normalizado (es/es_ES colapsan a la misma
    // clave de CampaignDefinition) para poder detectar colisiones antes de
    // decidir que se aplica.
    const byInternalLanguage = new Map<string, YcloudWhatsappTemplate[]>();
    for (const template of matching) {
      const ycloudLanguage = this.nonEmpty(template.language);
      const officialTemplateId = this.nonEmpty(
        template.officialTemplateId ?? template.id,
      );

      if (!ycloudLanguage || !officialTemplateId) {
        result.skippedInvalid += 1;
        continue;
      }

      const internalLanguage = this.toInternalLanguage(ycloudLanguage);
      const bucket = byInternalLanguage.get(internalLanguage) ?? [];
      bucket.push(template);
      byInternalLanguage.set(internalLanguage, bucket);
    }

    for (const [internalLanguage, group] of byInternalLanguage) {
      let toApply = group;

      if (group.length > 1) {
        const candidates = group.map(
          (t) => this.nonEmpty(t.language) ?? '(desconocido)',
        );

        if (preferLanguage) {
          const preferred = group.filter(
            (t) => this.nonEmpty(t.language) === preferLanguage,
          );
          if (preferred.length > 0) {
            toApply = preferred;
            result.collisions.push({
              internalLanguage,
              candidates,
              resolved: preferLanguage,
            });
          } else {
            result.collisions.push({
              internalLanguage,
              candidates,
              resolved: null,
              reason: `preferLanguage "${preferLanguage}" no esta entre las candidatas`,
            });
            continue;
          }
        } else {
          // Sin preferencia explicita no se aplica nada de este grupo --
          // queda marcado para revision manual en vez de resolverlo en
          // silencio con "gana el ultimo procesado" (ver ADR-003).
          result.collisions.push({
            internalLanguage,
            candidates,
            resolved: null,
            reason:
              'colision sin preferLanguage para este template; requiere revision manual',
          });
          continue;
        }
      }

      for (const template of toApply) {
        const definitionId = await this.ensureCampaignDefinition({
          internalLanguage,
          registryEntry,
          template,
        });

        const officialTemplateId = this.nonEmpty(
          template.officialTemplateId ?? template.id,
        )!;
        const ycloudLanguage = this.nonEmpty(template.language)!;
        const status = this.toAccountCampaignTemplateStatus(
          this.nonEmpty(template.status),
        );

        const data = {
          officialTemplateId,
          wabaId: this.nonEmpty(template.wabaId) ?? account.wabaId,
          name: registryEntry.templateName,
          language: ycloudLanguage,
          category: this.nonEmpty(template.category),
          qualityRating: this.nonEmpty(template.qualityRating),
          status,
          statusDetail: this.nonEmpty(template.statusUpdateEvent),
          ycloudCreateTime: this.parseDate(template.createTime),
          ycloudUpdateTime: this.parseDate(template.updateTime),
          lastSyncedAt: new Date(),
          payloadSnapshot: template as unknown as Prisma.InputJsonObject,
          lastWebhookPayload: template as unknown as Prisma.InputJsonObject,
          lastError: null,
          isActive: true,
        };

        await this.prisma.accountCampaignTemplate.upsert({
          where: {
            accountId_campaignDefinitionId: {
              accountId: account.id,
              campaignDefinitionId: definitionId,
            },
          },
          update: data,
          create: {
            accountId: account.id,
            campaignDefinitionId: definitionId,
            ...data,
          },
        });

        result.applied.push({
          internalLanguage,
          ycloudLanguage,
          officialTemplateId,
          status,
        });
      }
    }

    return result;
  }

  private async ensureCampaignDefinition(input: {
    internalLanguage: string;
    registryEntry: CampaignTemplateRegistryEntry;
    template: YcloudWhatsappTemplate;
  }): Promise<string> {
    const key = `${input.registryEntry.keyPrefix}_${input.internalLanguage.toLowerCase()}`;

    const existing = await this.prisma.campaignDefinition.findUnique({
      where: { key },
      select: { id: true },
    });

    const payload = {
      provider: 'YCLOUD',
      templateName: input.registryEntry.templateName,
      components: Array.isArray(input.template.components)
        ? input.template.components
        : [],
      variables: [],
    } satisfies Prisma.InputJsonObject;

    if (existing) {
      await this.prisma.campaignDefinition.update({
        where: { id: existing.id },
        data: {
          name: input.registryEntry.campaignName,
          type: input.registryEntry.type,
          language: input.internalLanguage,
          category: this.nonEmpty(input.template.category),
          payload,
          status: CampaignDefinitionStatus.ACTIVE,
          isActive: true,
        },
      });
      return existing.id;
    }

    const created = await this.prisma.campaignDefinition.create({
      data: {
        key,
        name: input.registryEntry.campaignName,
        type: input.registryEntry.type,
        language: input.internalLanguage,
        category: this.nonEmpty(input.template.category),
        payload,
        status: CampaignDefinitionStatus.ACTIVE,
        isActive: true,
      },
      select: { id: true },
    });
    return created.id;
  }

  private toInternalLanguage(ycloudLanguage: string) {
    return ycloudLanguage === 'es' ? 'es_ES' : ycloudLanguage;
  }

  private toAccountCampaignTemplateStatus(
    status: string | null,
  ): AccountCampaignTemplateStatus {
    const normalized = status?.toUpperCase();
    if (
      normalized &&
      Object.values(AccountCampaignTemplateStatus).includes(
        normalized as AccountCampaignTemplateStatus,
      )
    ) {
      return normalized as AccountCampaignTemplateStatus;
    }
    return AccountCampaignTemplateStatus.ERROR;
  }

  private parseDate(value: unknown): Date | null {
    const raw = this.nonEmpty(value);
    if (!raw) return null;
    const date = new Date(raw);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  private nonEmpty(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
