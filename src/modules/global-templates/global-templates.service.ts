import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { AccountGlobalTemplateStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AccountsService } from '../accounts/accounts.service';
import { YcloudService } from '../ycloud/ycloud.service';
import { buildWhatsappTemplateComponents } from 'src/common/utils/whatsapp-template-components';
import { CreateGlobalTemplateDto } from './dto/global-template.dto';

const VALID_STATUSES = new Set(Object.values(AccountGlobalTemplateStatus));

@Injectable()
export class GlobalTemplatesService {
  private readonly logger = new Logger(GlobalTemplatesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly accountsService: AccountsService,
    private readonly ycloudService: YcloudService,
  ) {}

  async create(createdByUserId: string, dto: CreateGlobalTemplateDto) {
    const existing = await this.prisma.globalWhatsappTemplate.findUnique({
      where: { name_language: { name: dto.name, language: dto.language } },
    });
    if (existing) {
      throw new BadRequestException(
        'Ya existe una plantilla global con ese nombre e idioma',
      );
    }

    const components = buildWhatsappTemplateComponents(dto);

    // Cuentas activas con un usuario SALES/SALES_MANAGER real detras (findAllAccountsForAdmin
    // ya solo devuelve cuentas -- 1 por comercial -- filtradas por user.isActive).
    const accounts = await this.accountsService.findAllAccountsForAdmin({
      isActive: 'true',
    });

    if (accounts.length === 0) {
      throw new BadRequestException(
        'No hay cuentas comerciales activas a las que replicar la plantilla',
      );
    }

    const template = await this.prisma.globalWhatsappTemplate.create({
      data: {
        name: dto.name,
        language: dto.language,
        category: dto.category,
        payload: components as Prisma.InputJsonValue,
        createdByUserId,
      },
    });

    // Se replica cuenta por cuenta, sin abortar el lote si una falla: cada
    // resultado (o error) queda registrado en su propia fila para que el
    // admin vea exactamente donde quedo pendiente/fallida.
    for (const account of accounts) {
      await this.propagateToAccount({
        template,
        components,
        accountId: account.id,
        wabaId: account.wabaId,
      });
    }

    return this.getById(template.id);
  }

  private async propagateToAccount(input: {
    template: { id: string; name: string; language: string; category: string };
    components: unknown[];
    accountId: string;
    wabaId: string;
  }) {
    try {
      const result = await this.ycloudService.createTemplate({
        accountId: input.accountId,
        wabaId: input.wabaId,
        name: input.template.name,
        language: input.template.language,
        category: input.template.category as
          | 'AUTHENTICATION'
          | 'MARKETING'
          | 'UTILITY',
        components: input.components,
      });

      await this.prisma.globalWhatsappTemplateAccount.create({
        data: {
          globalTemplateId: input.template.id,
          accountId: input.accountId,
          wabaId: input.wabaId,
          officialTemplateId: this.nonEmpty(
            result.officialTemplateId ?? result.id,
          ),
          status: this.mapStatus(result.status),
        },
      });
    } catch (error) {
      this.logger.warn(
        `No se pudo crear la plantilla en accountId=${input.accountId} wabaId=${input.wabaId}: ${String(error)}`,
      );

      await this.prisma.globalWhatsappTemplateAccount.create({
        data: {
          globalTemplateId: input.template.id,
          accountId: input.accountId,
          wabaId: input.wabaId,
          status: AccountGlobalTemplateStatus.ERROR,
          statusDetail: this.errorMessage(error),
        },
      });
    }
  }

  async list() {
    const templates = await this.prisma.globalWhatsappTemplate.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        createdByUser: { select: { id: true, email: true } },
        accountTemplates: { select: { status: true } },
      },
    });

    return templates.map((template) => this.summarize(template));
  }

  async getById(id: string) {
    const template = await this.prisma.globalWhatsappTemplate.findUnique({
      where: { id },
      include: {
        createdByUser: { select: { id: true, email: true } },
        accountTemplates: {
          orderBy: { createdAt: 'asc' },
          include: {
            account: { select: { id: true, name: true, phoneE164: true } },
          },
        },
      },
    });

    if (!template) {
      throw new NotFoundException('Plantilla no encontrada');
    }

    return {
      ...this.summarize(template),
      accountTemplates: template.accountTemplates.map((row) => ({
        id: row.id,
        accountId: row.accountId,
        accountName: row.account.name,
        accountPhone: row.account.phoneE164,
        wabaId: row.wabaId,
        officialTemplateId: row.officialTemplateId,
        status: row.status,
        statusDetail: row.statusDetail,
        lastSyncedAt: row.lastSyncedAt,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      })),
    };
  }

  async remove(id: string) {
    const template = await this.prisma.globalWhatsappTemplate.findUnique({
      where: { id },
      include: { accountTemplates: true },
    });

    if (!template) {
      throw new NotFoundException('Plantilla no encontrada');
    }

    const failedAccounts: string[] = [];

    for (const row of template.accountTemplates) {
      try {
        await this.ycloudService.deleteTemplate({
          accountId: row.accountId,
          wabaId: row.wabaId,
          name: template.name,
          language: template.language,
        });
      } catch (error) {
        this.logger.warn(
          `No se pudo borrar la plantilla en accountId=${row.accountId} wabaId=${row.wabaId}: ${String(error)}`,
        );
        failedAccounts.push(row.accountId);
      }
    }

    await this.prisma.globalWhatsappTemplate.delete({ where: { id } });

    return {
      message:
        failedAccounts.length === 0
          ? 'Plantilla eliminada correctamente en todas las cuentas'
          : `Plantilla eliminada del catalogo, pero no se pudo borrar en ${failedAccounts.length} cuenta(s). Puede que ya no exista ahi o haya que borrarla manualmente en YCloud.`,
      failedAccountIds: failedAccounts,
    };
  }

  private summarize(template: {
    id: string;
    name: string;
    language: string;
    category: string;
    payload: Prisma.JsonValue;
    createdAt: Date;
    updatedAt: Date;
    createdByUser: { id: string; email: string } | null;
    accountTemplates: { status: AccountGlobalTemplateStatus }[];
  }) {
    const counts = {
      total: template.accountTemplates.length,
      approved: 0,
      pending: 0,
      rejected: 0,
      error: 0,
      other: 0,
    };

    for (const row of template.accountTemplates) {
      if (row.status === AccountGlobalTemplateStatus.APPROVED) counts.approved += 1;
      else if (
        row.status === AccountGlobalTemplateStatus.PENDING ||
        row.status === AccountGlobalTemplateStatus.SUBMITTED
      )
        counts.pending += 1;
      else if (row.status === AccountGlobalTemplateStatus.REJECTED) counts.rejected += 1;
      else if (row.status === AccountGlobalTemplateStatus.ERROR) counts.error += 1;
      else counts.other += 1;
    }

    return {
      id: template.id,
      name: template.name,
      language: template.language,
      category: template.category,
      payload: template.payload,
      createdBy: template.createdByUser,
      createdAt: template.createdAt,
      updatedAt: template.updatedAt,
      accountStatusCounts: counts,
    };
  }

  private mapStatus(value: unknown): AccountGlobalTemplateStatus {
    const normalized =
      typeof value === 'string' ? value.trim().toUpperCase() : '';
    return VALID_STATUSES.has(normalized as AccountGlobalTemplateStatus)
      ? (normalized as AccountGlobalTemplateStatus)
      : AccountGlobalTemplateStatus.PENDING;
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
