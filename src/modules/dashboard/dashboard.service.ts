import { Injectable, ForbiddenException } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { FirstMessageMetricsDto } from './dto/first-message-metrics.dto';
import { AccountFirstMessageMetricsDto } from './dto/first-message-metrics.dto';

type FirstMessageRow = {
  accountId?: string;
  accountName?: string;
  templateName: string;
  sentFirst: bigint;
  responded: bigint;
  notResponded: bigint;
};

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  private buildInclusiveDateRange(from: string, to: string) {
    if (!from || !to) {
      throw new ForbiddenException('from and to are required');
    }

    const fromDate = new Date(`${from}T00:00:00.000Z`);
    const toInclusiveDate = new Date(`${to}T00:00:00.000Z`);

    if (isNaN(fromDate.getTime()) || isNaN(toInclusiveDate.getTime())) {
      throw new ForbiddenException('Invalid from/to date');
    }

    if (fromDate > toInclusiveDate) {
      throw new ForbiddenException('from must be less than or equal to to');
    }

    const toExclusiveDate = new Date(toInclusiveDate);
    toExclusiveDate.setUTCDate(toExclusiveDate.getUTCDate() + 1);

    return { fromDate, toExclusiveDate };
  }

  private toMetricRow(r: FirstMessageRow) {
    const sentFirst = Number(r.sentFirst);
    const responded = Number(r.responded);
    const notResponded = Number(r.notResponded);

    return {
      accountId: r.accountId ?? null,
      accountName: r.accountName ?? null,
      templateName: r.templateName,
      sentFirst,
      responded,
      notResponded,
      responseRate: sentFirst
        ? Number(((responded / sentFirst) * 100).toFixed(2))
        : 0,
    };
  }

  private mapFlatRows(
    rows: FirstMessageRow[],
    meta: {
      from: string;
      to: string;
      scope: 'GLOBAL' | 'GLOBAL_BY_ACCOUNT' | 'MY_ACCOUNT' | 'ACCOUNT';
      groupedBy: string[];
      appliedAccountId?: string | null;
    },
  ) {
    return {
      from: meta.from,
      to: meta.to,
      dateMode: 'INCLUSIVE',
      scope: meta.scope,
      appliedAccountId: meta.appliedAccountId ?? null,
      groupedBy: meta.groupedBy,
      data: rows.map((r) => this.toMetricRow(r)),
    };
  }

  private mapRowsGroupedByAccount(
    rows: FirstMessageRow[],
    meta: {
      from: string;
      to: string;
      appliedAccountId?: string | null;
    },
  ) {
    const grouped = new Map<
      string,
      {
        accountId: string | null;
        accountName: string | null;
        sentFirst: number;
        responded: number;
        notResponded: number;
        templates: Array<{
          templateName: string;
          sentFirst: number;
          responded: number;
          notResponded: number;
          responseRate: number;
        }>;
      }
    >();

    for (const row of rows) {
      const mapped = this.toMetricRow(row);
      const key =
        mapped.accountId ?? `account:${mapped.accountName ?? 'unknown'}`;

      if (!grouped.has(key)) {
        grouped.set(key, {
          accountId: mapped.accountId,
          accountName: mapped.accountName,
          sentFirst: 0,
          responded: 0,
          notResponded: 0,
          templates: [],
        });
      }

      const accountGroup = grouped.get(key)!;

      accountGroup.templates.push({
        templateName: mapped.templateName,
        sentFirst: mapped.sentFirst,
        responded: mapped.responded,
        notResponded: mapped.notResponded,
        responseRate: mapped.responseRate,
      });

      accountGroup.sentFirst += mapped.sentFirst;
      accountGroup.responded += mapped.responded;
      accountGroup.notResponded += mapped.notResponded;
    }

    const data = Array.from(grouped.values()).map((account) => ({
      accountId: account.accountId,
      accountName: account.accountName,
      totals: {
        sentFirst: account.sentFirst,
        responded: account.responded,
        notResponded: account.notResponded,
        responseRate: account.sentFirst
          ? Number(((account.responded / account.sentFirst) * 100).toFixed(2))
          : 0,
      },
      templates: account.templates,
    }));

    return {
      from: meta.from,
      to: meta.to,
      dateMode: 'INCLUSIVE',
      scope: 'GLOBAL_BY_ACCOUNT',
      appliedAccountId: meta.appliedAccountId ?? null,
      groupedBy: ['account', 'template'],
      data,
    };
  }

  async getFirstMessageResponses(
    dto: FirstMessageMetricsDto,
    user: { role: Role; accountId?: string | null },
  ) {
    const { from, to, groupByAccount = false } = dto;
    const { fromDate, toExclusiveDate } = this.buildInclusiveDateRange(
      from,
      to,
    );

    const isAdmin = user.role === Role.ADMIN;
    const isSales = user.role === Role.SALES;

    let isGlobal = false;
    let effectiveAccountId: string | null = null;

    if (isAdmin) {
      isGlobal = true;
    } else if (isSales) {
      if (!user.accountId) {
        throw new ForbiddenException('User has no accountId');
      }
      effectiveAccountId = user.accountId;
    } else {
      throw new ForbiddenException('Invalid role');
    }

    const conditions: Prisma.Sql[] = [
      Prisma.sql`l."firstOutboundAt" IS NOT NULL`,
      Prisma.sql`l."firstOutboundTemplateName" IS NOT NULL`,
      Prisma.sql`l."firstOutboundAt" >= ${fromDate}`,
      Prisma.sql`l."firstOutboundAt" < ${toExclusiveDate}`,
    ];

    if (!isGlobal) {
      conditions.push(Prisma.sql`l."accountId" = ${effectiveAccountId}`);
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

    const orderByFields =
      isGlobal && groupByAccount
        ? Prisma.sql`a.name ASC, l."firstOutboundTemplateName" ASC`
        : Prisma.sql`l."firstOutboundTemplateName" ASC`;

    const rows = await this.prisma.$queryRaw<FirstMessageRow[]>(Prisma.sql`
      SELECT
        ${selectAccountFields}
        l."firstOutboundTemplateName" as "templateName",
        COUNT(*)::bigint as "sentFirst",
        COUNT(*) FILTER (
          WHERE l."firstInboundAt" IS NOT NULL
        )::bigint as "responded",
        COUNT(*) FILTER (
          WHERE l."firstInboundAt" IS NULL
        )::bigint as "notResponded"
      FROM "Lead" l
      ${joinAccount}
      ${whereClause}
      GROUP BY l."firstOutboundTemplateName" ${groupByAccountFields}
      ORDER BY ${orderByFields}
    `);

    if (isGlobal && groupByAccount) {
      return this.mapRowsGroupedByAccount(rows, {
        from,
        to,
        appliedAccountId: effectiveAccountId,
      });
    }

    return this.mapFlatRows(rows, {
      from,
      to,
      scope: isGlobal ? 'GLOBAL' : 'MY_ACCOUNT',
      appliedAccountId: effectiveAccountId,
      groupedBy: ['template'],
    });
  }

  async getAccountFirstMessageResponses(
    dto: AccountFirstMessageMetricsDto,
    user: { role: Role },
  ) {
    const { accountId, from, to } = dto;

    if (user.role !== Role.ADMIN) {
      throw new ForbiddenException('Only admins can query by account');
    }

    const { fromDate, toExclusiveDate } = this.buildInclusiveDateRange(
      from,
      to,
    );

    const rows = await this.prisma.$queryRaw<FirstMessageRow[]>(Prisma.sql`
      SELECT
        l."accountId",
        a.name as "accountName",
        l."firstOutboundTemplateName" as "templateName",
        COUNT(*)::bigint as "sentFirst",
        COUNT(*) FILTER (
          WHERE l."firstInboundAt" IS NOT NULL
        )::bigint as "responded",
        COUNT(*) FILTER (
          WHERE l."firstInboundAt" IS NULL
        )::bigint as "notResponded"
      FROM "Lead" l
      JOIN "Account" a ON a.id = l."accountId"
      WHERE l."accountId" = ${accountId}
        AND l."firstOutboundAt" IS NOT NULL
        AND l."firstOutboundTemplateName" IS NOT NULL
        AND l."firstOutboundAt" >= ${fromDate}
        AND l."firstOutboundAt" < ${toExclusiveDate}
      GROUP BY l."accountId", a.name, l."firstOutboundTemplateName"
      ORDER BY l."firstOutboundTemplateName" ASC
    `);

    return this.mapFlatRows(rows, {
      from,
      to,
      scope: 'ACCOUNT',
      appliedAccountId: accountId,
      groupedBy: ['template'],
    });
  }
}
