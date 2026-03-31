import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';

@Injectable()
export class ReengagementSelectionService {
  constructor(private readonly prisma: PrismaService) {}

  async findEligibleLeads(start: Date, end: Date) {
    return this.prisma.lead.findMany({
      where: {
        status: 'NEW',
        accountId: { not: null },
        firstOutboundAt: {
          gte: start,
          lte: end,
        },
        firstOutboundTemplateName: { not: null },
        firstInboundAt: null,
        account: {
          is: {
            user: {
              is: {
                isActive: true,
              },
            },
          },
        },
      },
      select: {
        id: true,
        accountId: true,
        phoneE164: true,
        preferredLanguage: true,
        firstOutboundTemplateName: true,
        firstOutboundAt: true,
      },
      orderBy: {
        firstOutboundAt: 'asc',
      },
    });
  }
}
