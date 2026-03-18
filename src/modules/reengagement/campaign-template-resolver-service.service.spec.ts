import { Test, TestingModule } from '@nestjs/testing';
import { CampaignTemplateResolverService } from '../reengagement/campaign-template-resolver-service.service';

describe('CampaignTemplateResolverServiceService', () => {
  let service: CampaignTemplateResolverService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [CampaignTemplateResolverService],
    }).compile();

    service = module.get<CampaignTemplateResolverService>(
      CampaignTemplateResolverService,
    );
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
