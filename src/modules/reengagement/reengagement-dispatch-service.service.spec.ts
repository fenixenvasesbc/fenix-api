import { Test, TestingModule } from '@nestjs/testing';
import { ReengagementDispatchService } from '../reengagement/reengagement-dispatch-service.service';

describe('ReengagementDispatchService', () => {
  let service: ReengagementDispatchService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ReengagementDispatchService],
    }).compile();

    service = module.get<ReengagementDispatchService>(
      ReengagementDispatchService,
    );
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
