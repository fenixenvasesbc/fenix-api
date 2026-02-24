import { Injectable, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { FirstMessageMetricsDto } from './dto/first-message-metrics.dto';
import { Role } from '@prisma/client';
import { Prisma } from '@prisma/client';

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async getFirstMessageResponses(dto: FirstMessageMetricsDto, user: any) {
    const {
      from,
      to,
      groupBy,
      responseWindowHours = 48,
      groupByAccount = false,
      accountId,
    } = dto;

    // 🔐 Validación básica
    if (!from || !to) {
      throw new ForbiddenException('from and to are required');
    }

    if (!['week', 'month'].includes(groupBy)) {
      throw new ForbiddenException('Invalid groupBy value');
    }

    const fromDate = new Date(from);
    const toDate = new Date(to);

    const isSales = user.role === Role.SALES;
    const isAdmin = user.role === Role.ADMIN;

    // 🎯 Determinar scope
    let effectiveAccountId: string | null = null;
    let isGlobal = false;

    if (isSales) {
      effectiveAccountId = user.accountId;
    } else if (isAdmin && accountId) {
      effectiveAccountId = accountId;
    } else if (isAdmin && !accountId) {
      isGlobal = true;
    }

    // Seguridad extra
    if (!isGlobal && !effectiveAccountId) {
      throw new ForbiddenException('Invalid account scope');
    }

    const dateTrunc = groupBy; // solo week o month permitido arriba

    // 🔧 Construcción dinámica segura
    const conditions: Prisma.Sql[] = [
      Prisma.sql`l."firstOutboundAt" IS NOT NULL`,
      Prisma.sql`l."firstOutboundAt" >= ${fromDate}`,
      Prisma.sql`l."firstOutboundAt" < ${toDate}`,
    ];

    if (!isGlobal) {
      conditions.push(
        Prisma.sql`l."accountId" = ${effectiveAccountId}`,
      );
    }

    const whereClause = Prisma.sql`
      WHERE ${Prisma.join(conditions, ' AND ')}
    `;

    const joinAccount =
      isGlobal && groupByAccount
        ? Prisma.sql`JOIN "Account" a ON a.id = l."accountId"`
        : Prisma.empty;

    const selectAccountFields =
      isGlobal && groupByAccount
        ? Prisma.sql`
            l."accountId",
            a.name as "accountName",
          `
        : Prisma.empty;

    const groupByAccountFields =
      isGlobal && groupByAccount
        ? Prisma.sql`, l."accountId", a.name`
        : Prisma.empty;

    const rows = await this.prisma.$queryRaw<
      {
        period: Date;
        accountId?: string;
        accountName?: string;
        templateName: string | null;
        sentFirst: bigint;
        responded: bigint;
      }[]
    >(Prisma.sql`
      SELECT
        date_trunc(${Prisma.raw(`'${dateTrunc}'`)}, l."firstOutboundAt") as period,
        ${selectAccountFields}
        l."firstOutboundTemplateName" as "templateName",
        COUNT(*)::bigint as "sentFirst",
        COUNT(*) FILTER (
          WHERE l."firstInboundAt" IS NOT NULL
          AND l."firstInboundAt" <= l."firstOutboundAt" + ${responseWindowHours} * interval '1 hour'
        )::bigint as "responded"
      FROM "Lead" l
      ${joinAccount}
      ${whereClause}
      GROUP BY period, l."firstOutboundTemplateName" ${groupByAccountFields}
      ORDER BY period ASC
    `);

    const data = rows.map((r) => {
      const sent = Number(r.sentFirst);
      const responded = Number(r.responded);
      const notResponded = sent - responded;

      return {
        period: r.period,
        accountId: r.accountId ?? null,
        accountName: r.accountName ?? null,
        templateName: r.templateName ?? 'unknown',
        sentFirst: sent,
        responded,
        notResponded,
        responseRate: sent
          ? Number(((responded / sent) * 100).toFixed(2))
          : 0,
      };
    });

    return {
      groupBy,
      from,
      to,
      responseWindowHours,
      scope: isGlobal
        ? groupByAccount
          ? 'GLOBAL_BY_ACCOUNT'
          : 'GLOBAL'
        : 'SINGLE_ACCOUNT',
      data,
    };
  }
}