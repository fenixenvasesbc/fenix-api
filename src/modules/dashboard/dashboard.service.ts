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
    WITH base AS (
      -- Campañas originales
      SELECT
        l."accountId",
        l."firstOutboundTemplateName" as "templateName",
        1::bigint as "sentFirst",
        CASE
          WHEN l."firstInboundAt" IS NOT NULL
            AND (
              l."reengagementSentAt" IS NULL
              OR l."firstInboundAt" < l."reengagementSentAt"
            )
          THEN 1::bigint
          ELSE 0::bigint
        END as "responded",
        CASE
          WHEN l."firstInboundAt" IS NULL
            OR (
              l."reengagementSentAt" IS NOT NULL
              AND l."firstInboundAt" >= l."reengagementSentAt"
            )
          THEN 1::bigint
          ELSE 0::bigint
        END as "notResponded"
      FROM "Lead" l
      WHERE l."accountId" = ${accountId}
        AND l."firstOutboundAt" IS NOT NULL
        AND l."firstOutboundTemplateName" IS NOT NULL
        AND l."firstOutboundAt" >= ${fromDate}
        AND l."firstOutboundAt" < ${toExclusiveDate}

      UNION ALL

      -- Reenganches agrupados en una sola campaña
      SELECT
        l2."accountId",
        're_enganche' as "templateName",
        1::bigint as "sentFirst",
        CASE
          WHEN l2."reengagementSentAt" IS NOT NULL
            AND l2."firstInboundAt" IS NOT NULL
            AND l2."firstInboundAt" >= l2."reengagementSentAt"
          THEN 1::bigint
          ELSE 0::bigint
        END as "responded",
        CASE
          WHEN l2."reengagementSentAt" IS NOT NULL
            AND (
              l2."firstInboundAt" IS NULL
              OR l2."firstInboundAt" < l2."reengagementSentAt"
            )
          THEN 1::bigint
          ELSE 0::bigint
        END as "notResponded"
      FROM "Lead" l2
      WHERE l2."accountId" = ${accountId}
        AND l2."reengagementSentAt" IS NOT NULL
        AND l2."reengagementSentAt" >= ${fromDate}
        AND l2."reengagementSentAt" < ${toExclusiveDate}
    )
    SELECT
      base."accountId",
      a.name as "accountName",
      base."templateName",
      SUM(base."sentFirst")::bigint as "sentFirst",
      SUM(base."responded")::bigint as "responded",
      SUM(base."notResponded")::bigint as "notResponded"
    FROM base
    JOIN "Account" a ON a.id = base."accountId"
    GROUP BY base."accountId", a.name, base."templateName"
    ORDER BY base."templateName" ASC
  `);

    return this.mapFlatRows(rows, {
      from,
      to,
      scope: 'ACCOUNT',
      appliedAccountId: accountId,
      groupedBy: ['template'],
    });
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

    const leadScopeConditions: Prisma.Sql[] = [];
    const reengagementScopeConditions: Prisma.Sql[] = [];

    if (!isGlobal) {
      leadScopeConditions.push(
        Prisma.sql`l."accountId" = ${effectiveAccountId}`,
      );
      reengagementScopeConditions.push(
        Prisma.sql`l2."accountId" = ${effectiveAccountId}`,
      );
    }

    const leadScopeWhere =
      leadScopeConditions.length > 0
        ? Prisma.sql`AND ${Prisma.join(leadScopeConditions, ' AND ')}`
        : Prisma.empty;

    const reengagementScopeWhere =
      reengagementScopeConditions.length > 0
        ? Prisma.sql`AND ${Prisma.join(reengagementScopeConditions, ' AND ')}`
        : Prisma.empty;

    const joinAccount =
      isGlobal && groupByAccount
        ? Prisma.sql`JOIN "Account" a ON a.id = base."accountId"`
        : Prisma.empty;

    const selectAccountFields =
      isGlobal && groupByAccount
        ? Prisma.sql`
          base."accountId",
          a.name as "accountName",
        `
        : Prisma.empty;

    const groupByAccountFields =
      isGlobal && groupByAccount
        ? Prisma.sql`, base."accountId", a.name`
        : Prisma.empty;

    const orderByFields =
      isGlobal && groupByAccount
        ? Prisma.sql`a.name ASC, base."templateName" ASC`
        : Prisma.sql`base."templateName" ASC`;

    const rows = await this.prisma.$queryRaw<FirstMessageRow[]>(Prisma.sql`
    WITH base AS (
      -- Campañas originales
      SELECT
        l."accountId",
        l."firstOutboundTemplateName" as "templateName",
        1::bigint as "sentFirst",
        CASE
          WHEN l."firstInboundAt" IS NOT NULL
            AND (
              l."reengagementSentAt" IS NULL
              OR l."firstInboundAt" < l."reengagementSentAt"
            )
          THEN 1::bigint
          ELSE 0::bigint
        END as "responded",
        CASE
          WHEN l."firstInboundAt" IS NULL
            OR (
              l."reengagementSentAt" IS NOT NULL
              AND l."firstInboundAt" >= l."reengagementSentAt"
            )
          THEN 1::bigint
          ELSE 0::bigint
        END as "notResponded"
      FROM "Lead" l
      WHERE l."firstOutboundAt" IS NOT NULL
        AND l."firstOutboundTemplateName" IS NOT NULL
        AND l."firstOutboundAt" >= ${fromDate}
        AND l."firstOutboundAt" < ${toExclusiveDate}
        ${leadScopeWhere}

      UNION ALL

      -- Reenganches agrupados en una sola campaña
      SELECT
        l2."accountId",
        're_enganche' as "templateName",
        1::bigint as "sentFirst",
        CASE
          WHEN l2."reengagementSentAt" IS NOT NULL
            AND l2."firstInboundAt" IS NOT NULL
            AND l2."firstInboundAt" >= l2."reengagementSentAt"
          THEN 1::bigint
          ELSE 0::bigint
        END as "responded",
        CASE
          WHEN l2."reengagementSentAt" IS NOT NULL
            AND (
              l2."firstInboundAt" IS NULL
              OR l2."firstInboundAt" < l2."reengagementSentAt"
            )
          THEN 1::bigint
          ELSE 0::bigint
        END as "notResponded"
      FROM "Lead" l2
      WHERE l2."reengagementSentAt" IS NOT NULL
        AND l2."reengagementSentAt" >= ${fromDate}
        AND l2."reengagementSentAt" < ${toExclusiveDate}
        ${reengagementScopeWhere}
    )
    SELECT
      ${selectAccountFields}
      base."templateName",
      SUM(base."sentFirst")::bigint as "sentFirst",
      SUM(base."responded")::bigint as "responded",
      SUM(base."notResponded")::bigint as "notResponded"
    FROM base
    ${joinAccount}
    GROUP BY base."templateName" ${groupByAccountFields}
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
}
