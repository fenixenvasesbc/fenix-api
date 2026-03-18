import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import {
  AccountCampaignTemplateStatus,
  CampaignDefinitionStatus,
  CampaignDefinitionType,
} from '@prisma/client';

@Injectable()
export class CampaignTemplateResolverService {
  constructor(private readonly prisma: PrismaService) {}

  async resolveWeek1ReengagementTemplate(params: {
    accountId: string;
    language: string;
  }) {
    const definition = await this.prisma.campaignDefinition.findFirst({
      where: {
        type: CampaignDefinitionType.WEEK1_REENGAGEMENT,
        language: params.language,
        status: CampaignDefinitionStatus.ACTIVE,
        isActive: true,
      },
      select: {
        id: true,
        key: true,
        language: true,
        type: true,
      },
    });

    if (!definition) {
      return null;
    }

    const accountTemplate = await this.prisma.accountCampaignTemplate.findFirst(
      {
        where: {
          accountId: params.accountId,
          campaignDefinitionId: definition.id,
          status: AccountCampaignTemplateStatus.APPROVED,
          isActive: true,
        },
        select: {
          id: true,
          name: true,
          language: true,
          status: true,
          officialTemplateId: true,
        },
      },
    );

    if (!accountTemplate) {
      return null;
    }

    return {
      definition,
      accountTemplate,
    };
  }
}
