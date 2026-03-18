import { Test, TestingModule } from '@nestjs/testing';
import { ReengagementSelectionService } from './reengagement-selection-service.service';

describe('ReengagementSelectionServiceService', () => {
  let service: ReengagementSelectionService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ReengagementSelectionService],
    }).compile();

    service = module.get<ReengagementSelectionService>(
      ReengagementSelectionService,
    );
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
