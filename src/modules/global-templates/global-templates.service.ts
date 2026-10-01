import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { AccountGlobalTemplateStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AccountsService } from '../accounts/accounts.service';
import { YcloudRequestError, YcloudService } from '../ycloud/ycloud.service';
import { buildWhatsappTemplateComponents } from 'src/common/utils/whatsapp-template-components';
import {
  CreateGlobalTemplateDto,
  EditGlobalTemplateDto,
} from './dto/global-template.dto';

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

  // Edita el contenido de una plantilla ya creada -- a diferencia de
  // create(), no crea filas nuevas: actualiza el payload local y llama a
  // YCloud una vez por cada cuenta donde la plantilla ya esta replicada
  // (cada WABA tiene su propia copia, ver modelo GlobalWhatsappTemplateAccount).
  // Si una cuenta falla (por ejemplo porque esta ARCHIVED o todavia
  // PENDING de revision en Meta) no aborta el resto -- el error queda
  // registrado en esa fila, igual que ya hace propagateToAccount().
  async update(templateId: string, dto: EditGlobalTemplateDto) {
    const template = await this.prisma.globalWhatsappTemplate.findUnique({
      where: { id: templateId },
      include: { accountTemplates: true },
    });
    if (!template) {
      throw new NotFoundException('Plantilla no encontrada');
    }

    const components = buildWhatsappTemplateComponents(dto);

    await this.prisma.globalWhatsappTemplate.update({
      where: { id: template.id },
      data: { payload: components as Prisma.InputJsonValue },
    });

    // ARCHIVED no se puede editar en YCloud/Meta (ver docs); ERROR/REJECTED/
    // etc. si se intentan -- si YCloud las rechaza igual, el catch abajo lo
    // registra sin frenar las demas cuentas.
    const editableAccounts = template.accountTemplates.filter(
      (at) => at.status !== AccountGlobalTemplateStatus.ARCHIVED,
    );

    for (const accountTemplate of editableAccounts) {
      try {
        const result = await this.ycloudService.editTemplate({
          accountId: accountTemplate.accountId,
          wabaId: accountTemplate.wabaId,
          name: template.name,
          language: template.language,
          components,
        });

        await this.prisma.globalWhatsappTemplateAccount.update({
          where: { id: accountTemplate.id },
          data: {
            status: this.mapStatus(result.status ?? accountTemplate.status),
            statusDetail: null,
          },
        });
      } catch (error) {
        this.logger.warn(
          `No se pudo editar la plantilla en accountId=${accountTemplate.accountId} wabaId=${accountTemplate.wabaId}: ${String(error)}`,
        );
        await this.prisma.globalWhatsappTemplateAccount.update({
          where: { id: accountTemplate.id },
          data: { statusDetail: this.errorMessage(error) },
        });
      }
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

      // YCloud/Meta puede rechazar la CREACION por dos motivos que en
      // realidad significan "ya existe, no hay nada que crear":
      //  - 409 ALREADY_EXISTS: un intento anterior la creo en Meta pero
      //    fallo al guardar la fila local, o se creo por fuera de Fenix.
      //  - 400 "Template Category Doesn't Match": ESE WABA puntual ya
      //    tiene una plantilla con el mismo nombre+idioma pero con otra
      //    categoria (p.ej. Meta la reclasifico de UTILITY a MARKETING
      //    despues de aprobarla, o se creo con otra categoria por fuera de
      //    Fenix). Meta no permite cambiar la categoria de una plantilla
      //    existente via API, asi que no tiene sentido reintentar la
      //    creacion -- lo correcto es reconciliar con el estado real que
      //    YA esta viva en Meta (reconcileExistingAccountTemplate hace el
      //    mismo lookup que el caso 409) en vez de bloquear la cuenta con
      //    un ERROR que requeriria borrar la plantilla a mano en Meta.
      // En ambos casos la plantilla SIGUE FUNCIONANDO para enviar mensajes
      // (el envio no filtra por categoria, ver outbound.service.ts
      // resolveTemplateComponentsForSend) -- lo unico que corrige esto es
      // que la pantalla de Plantillas dejara de mostrar un ERROR enganoso.
      const isAlreadyExistsConflict =
        error instanceof YcloudRequestError && error.statusCode === 409;
      const categoryMismatch = this.extractCategoryMismatch(error);

      if (isAlreadyExistsConflict || categoryMismatch) {
        const reconciled = await this.reconcileExistingAccountTemplate({
          ...input,
          categoryMismatchNote: categoryMismatch
            ? `Meta tiene esta plantilla registrada con categoria ${categoryMismatch.existingCategory} en vez de ${categoryMismatch.expectedCategory} (la definida aca). El envio funciona igual; si esto afecta facturacion o compliance, revisala en el WhatsApp Manager de Meta.`
            : null,
        });
        if (reconciled) return;
      }

      await this.prisma.globalWhatsappTemplateAccount.create({
        data: {
          globalTemplateId: input.template.id,
          accountId: input.accountId,
          wabaId: input.wabaId,
          status: AccountGlobalTemplateStatus.ERROR,
          statusDetail: categoryMismatch
            ? `La plantilla "${input.template.name}" ya existe en Meta para esta cuenta con categoria ${categoryMismatch.existingCategory}, pero esta definida aca como ${categoryMismatch.expectedCategory}, y no se pudo reconciliar automaticamente (no se encontro en YCloud al reintentar la busqueda). Revisala manualmente en el WhatsApp Manager de Meta.`
            : this.errorMessage(error),
        },
      });
    }
  }

  // Busca el patron especifico del error 400 "Template Category Doesn't
  // Match" en el mensaje que devuelve YCloud/Meta (ver propagateToAccount)
  // y extrae ambas categorias para armar un mensaje claro. Devuelve null si
  // el error no corresponde a este caso puntual.
  private extractCategoryMismatch(
    error: unknown,
  ): { expectedCategory: string; existingCategory: string } | null {
    if (!(error instanceof YcloudRequestError) || error.statusCode !== 400) {
      return null;
    }

    const match = error.message.match(
      /The category (\w+) doesn't match the one that's already associated with this template,\s*(\w+)/i,
    );
    if (!match) return null;

    return { expectedCategory: match[1], existingCategory: match[2] };
  }

  // Busca en YCloud la plantilla que ya existe en el WABA (por nombre e
  // idioma) y crea/actualiza la fila local con su estado real. Devuelve
  // false si no la encuentra, para que el llamador registre el ERROR
  // original. categoryMismatchNote (opcional) se antepone al mensaje
  // generico cuando el motivo de reconciliar fue un conflicto de categoria
  // (ver propagateToAccount), para no perder esa informacion en el
  // statusDetail. Pasar existingAccountTemplateId permite reusar esta
  // misma funcion desde syncAccounts() para refrescar filas que YA existen
  // (UPDATE) en vez de solo crearlas (CREATE).
  private async reconcileExistingAccountTemplate(input: {
    template: { id: string; name: string; language: string; category: string };
    accountId: string;
    wabaId: string;
    categoryMismatchNote?: string | null;
    existingAccountTemplateId?: string;
  }): Promise<boolean> {
    try {
      const templates = await this.ycloudService.listWhatsappTemplates({
        accountId: input.accountId,
      });

      // Comparamos nombre+idioma con algo de tolerancia: una plantilla que
      // ya existia en Meta de antes (no creada por Fenix) puede tener
      // espacios sueltos o el idioma en otra variante de mayusculas/
      // separador ("es-ES" vs "es_ES") y seguir siendo, a todos los
      // efectos, la misma plantilla.
      const normalize = (value: unknown) =>
        typeof value === 'string'
          ? value.trim().toLowerCase().replace(/-/g, '_')
          : '';
      const expectedName = normalize(input.template.name);
      const expectedLanguage = normalize(input.template.language);

      const match = templates.find(
        (item) =>
          normalize(item.name) === expectedName &&
          normalize(item.language) === expectedLanguage,
      );

      if (!match) {
        // Ayuda a diagnosticar por que no reconcilio: lista lo que YCloud
        // SI devolvio con ese mismo nombre (en cualquier idioma), para
        // distinguir "no existe en este WABA" de "existe pero con un
        // nombre/idioma que no calza con lo esperado".
        const sameName = templates.filter(
          (item) => normalize(item.name) === expectedName,
        );
        this.logger.warn(
          `reconcileExistingAccountTemplate: sin match para template="${input.template.name}" language="${input.template.language}" accountId=${input.accountId} wabaId=${input.wabaId}. ` +
            `Variantes encontradas con ese nombre: ${
              sameName.length
                ? sameName
                    .map((item) => `${String(item.name)}/${String(item.language)} (${String(item.status)})`)
                    .join(', ')
                : 'ninguna'
            }`,
        );
        return false;
      }

      const statusDetail = input.categoryMismatchNote
        ? input.categoryMismatchNote
        : 'Ya existia en YCloud/Meta; se reconcilio el estado automaticamente';

      const data = {
        globalTemplateId: input.template.id,
        accountId: input.accountId,
        wabaId: input.wabaId,
        officialTemplateId: this.nonEmpty(
          match.officialTemplateId ?? match.id,
        ),
        status: this.mapStatus(match.status),
        statusDetail,
        lastSyncedAt: new Date(),
      };

      if (input.existingAccountTemplateId) {
        await this.prisma.globalWhatsappTemplateAccount.update({
          where: { id: input.existingAccountTemplateId },
          data,
        });
      } else {
        await this.prisma.globalWhatsappTemplateAccount.create({ data });
      }
      return true;
    } catch (reconcileError) {
      this.logger.warn(
        `No se pudo reconciliar la plantilla existente en accountId=${input.accountId} wabaId=${input.wabaId}: ${String(reconcileError)}`,
      );
      return false;
    }
  }

  // Boton "Sincronizar estados" de la pantalla de Plantillas: re-consulta
  // YCloud/Meta para CADA cuenta ya vinculada a esta plantilla (incluidas
  // las que quedaron en ERROR) y actualiza el estado local con la verdad
  // actual -- cubre el caso en que Meta cambio algo (aprobo, reclasifico la
  // categoria, pauso) por fuera del flujo normal de Fenix, o en que la
  // plantilla ya existia en Meta de antes y el intento de creacion de
  // Fenix fallo sin que hubiera nada realmente mal. No crea filas para
  // cuentas que nunca intentaron agregar esta plantilla -- para eso esta
  // "Agregar comercial".
  async syncAccounts(templateId: string) {
    const template = await this.prisma.globalWhatsappTemplate.findUnique({
      where: { id: templateId },
      include: { accountTemplates: true },
    });
    if (!template) {
      throw new NotFoundException('Plantilla no encontrada');
    }

    const results: Array<{
      accountId: string;
      accountTemplateId: string;
      outcome: 'synced' | 'not_found_in_meta';
    }> = [];

    for (const row of template.accountTemplates) {
      const reconciled = await this.reconcileExistingAccountTemplate({
        template,
        accountId: row.accountId,
        wabaId: row.wabaId,
        existingAccountTemplateId: row.id,
      });

      results.push({
        accountId: row.accountId,
        accountTemplateId: row.id,
        outcome: reconciled ? 'synced' : 'not_found_in_meta',
      });

      if (!reconciled) {
        // No esta en YCloud bajo este nombre+idioma: no tocamos el
        // status/statusDetail existente (puede ser un ERROR legitimo que
        // todavia requiere accion manual), solo dejamos constancia de que
        // se intento sincronizar.
        await this.prisma.globalWhatsappTemplateAccount.update({
          where: { id: row.id },
          data: { lastSyncedAt: new Date() },
        });
      }
    }

    return {
      templateId,
      totalAccounts: template.accountTemplates.length,
      synced: results.filter((r) => r.outcome === 'synced').length,
      notFoundInMeta: results.filter((r) => r.outcome === 'not_found_in_meta')
        .length,
      results,
    };
  }

  // Boton "Sincronizar todas" a nivel general (fuera del detalle de una
  // plantilla puntual): corre syncAccounts() para TODAS las plantillas
  // globales, una por una. Pensado para despues de detectar en Meta un
  // problema que puede afectar a varias plantillas/cuentas a la vez (p.ej.
  // una reclasificacion masiva de categoria) y no querer entrar plantilla
  // por plantilla.
  async syncAllTemplates() {
    const templates = await this.prisma.globalWhatsappTemplate.findMany({
      select: { id: true, name: true, language: true },
      orderBy: { createdAt: 'asc' },
    });

    const perTemplate: Array<{
      templateId: string;
      name: string;
      language: string;
      totalAccounts: number;
      synced: number;
      notFoundInMeta: number;
    }> = [];

    for (const template of templates) {
      const result = await this.syncAccounts(template.id);
      perTemplate.push({
        templateId: template.id,
        name: template.name,
        language: template.language,
        totalAccounts: result.totalAccounts,
        synced: result.synced,
        notFoundInMeta: result.notFoundInMeta,
      });
    }

    return {
      totalTemplates: perTemplate.length,
      totalAccounts: perTemplate.reduce((sum, t) => sum + t.totalAccounts, 0),
      synced: perTemplate.reduce((sum, t) => sum + t.synced, 0),
      notFoundInMeta: perTemplate.reduce(
        (sum, t) => sum + t.notFoundInMeta,
        0,
      ),
      templates: perTemplate,
    };
  }

  async addAccount(templateId: string, accountId: string) {
    const template = await this.prisma.globalWhatsappTemplate.findUnique({
      where: { id: templateId },
    });
    if (!template) {
      throw new NotFoundException('Plantilla no encontrada');
    }

    const account = await this.prisma.account.findUnique({
      where: { id: accountId },
      select: {
        id: true,
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

    const existing =
      await this.prisma.globalWhatsappTemplateAccount.findUnique({
        where: {
          globalTemplateId_accountId: {
            globalTemplateId: templateId,
            accountId,
          },
        },
      });
    if (existing) {
      // Un intento anterior que quedo en ERROR o REJECTED no representa una
      // plantilla activa en Meta: se borra la fila local y se reintenta en
      // vez de bloquear al admin para siempre con el mensaje generico.
      const retryableStatuses = new Set<AccountGlobalTemplateStatus>([
        AccountGlobalTemplateStatus.ERROR,
        AccountGlobalTemplateStatus.REJECTED,
      ]);
      if (!retryableStatuses.has(existing.status)) {
        throw new BadRequestException(
          'Esa cuenta comercial ya tiene esta plantilla',
        );
      }
      await this.prisma.globalWhatsappTemplateAccount.delete({
        where: { id: existing.id },
      });
    }

    await this.propagateToAccount({
      template,
      components: template.payload as unknown[],
      accountId: account.id,
      wabaId: account.wabaId,
    });

    return this.getById(templateId);
  }

  // Asigna TODAS las plantillas globales vigentes a una cuenta comercial
  // nueva -- pensado para el alta de una comercial: en vez de agregarlas una
  // por una desde la UI, un solo boton recorre el catalogo completo y reusa
  // addAccount() (que ya sabe crear la plantilla en YCloud/Meta y reconciliar
  // 409 ALREADY_EXISTS) para cada una. No aborta el lote si una falla -- cada
  // resultado queda registrado individualmente para que el admin vea donde
  // quedo pendiente.
  async bootstrapAccount(accountId: string) {
    const account = await this.prisma.account.findUnique({
      where: { id: accountId },
      select: { id: true, user: { select: { isActive: true } } },
    });
    if (!account) {
      throw new NotFoundException('Cuenta comercial no encontrada');
    }
    if (!account.user?.isActive) {
      throw new BadRequestException(
        'La cuenta comercial no tiene un usuario activo',
      );
    }

    const templates = await this.prisma.globalWhatsappTemplate.findMany({
      select: { id: true, name: true, language: true },
      orderBy: { name: 'asc' },
    });

    const retryableStatuses = new Set<AccountGlobalTemplateStatus>([
      AccountGlobalTemplateStatus.ERROR,
      AccountGlobalTemplateStatus.REJECTED,
    ]);

    const results: Array<{
      templateId: string;
      name: string;
      language: string;
      outcome: 'created' | 'skipped' | 'error';
      detail?: string;
    }> = [];

    for (const template of templates) {
      const existing =
        await this.prisma.globalWhatsappTemplateAccount.findUnique({
          where: {
            globalTemplateId_accountId: {
              globalTemplateId: template.id,
              accountId,
            },
          },
        });

      if (existing && !retryableStatuses.has(existing.status)) {
        results.push({
          templateId: template.id,
          name: template.name,
          language: template.language,
          outcome: 'skipped',
        });
        continue;
      }

      try {
        await this.addAccount(template.id, accountId);
        results.push({
          templateId: template.id,
          name: template.name,
          language: template.language,
          outcome: 'created',
        });
      } catch (error) {
        this.logger.warn(
          `bootstrapAccount: fallo template=${template.name} lang=${template.language} accountId=${accountId}: ${this.errorMessage(error)}`,
        );
        results.push({
          templateId: template.id,
          name: template.name,
          language: template.language,
          outcome: 'error',
          detail: this.errorMessage(error),
        });
      }
    }

    return {
      accountId,
      totalTemplates: templates.length,
      created: results.filter((r) => r.outcome === 'created').length,
      skipped: results.filter((r) => r.outcome === 'skipped').length,
      errors: results.filter((r) => r.outcome === 'error').length,
      results,
    };
  }

  async removeAccount(templateId: string, accountTemplateId: string) {
    const row = await this.prisma.globalWhatsappTemplateAccount.findUnique({
      where: { id: accountTemplateId },
      include: { globalTemplate: true },
    });

    if (!row || row.globalTemplateId !== templateId) {
      throw new NotFoundException(
        'La cuenta no esta asociada a esta plantilla',
      );
    }

    let ycloudError: string | null = null;
    try {
      await this.ycloudService.deleteTemplate({
        accountId: row.accountId,
        wabaId: row.wabaId,
        name: row.globalTemplate.name,
        language: row.globalTemplate.language,
      });
    } catch (error) {
      this.logger.warn(
        `No se pudo borrar la plantilla en accountId=${row.accountId} wabaId=${row.wabaId}: ${String(error)}`,
      );
      ycloudError = this.errorMessage(error);
    }

    await this.prisma.globalWhatsappTemplateAccount.delete({
      where: { id: accountTemplateId },
    });

    return {
      message:
        ycloudError === null
          ? 'Plantilla eliminada de la cuenta comercial'
          : `Se quito la plantilla de Fenix, pero no se pudo borrar en YCloud/Meta: ${ycloudError}`,
      ycloudError,
    };
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
