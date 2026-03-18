import { Test, TestingModule } from '@nestjs/testing';
import { ReengagementSchedulerService } from './reengagement-scheduler-service.service';

describe('ReengagementSchedulerService', () => {
  let service: ReengagementSchedulerService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ReengagementSchedulerService],
    }).compile();

    service = module.get<ReengagementSchedulerService>(
      ReengagementSchedulerService,
    );
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
