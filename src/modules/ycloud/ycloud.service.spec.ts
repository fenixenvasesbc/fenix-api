import { Test, TestingModule } from '@nestjs/testing';
import { YcloudService } from './ycloud.service';

describe('YcloudService', () => {
  let service: YcloudService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [YcloudService],
    }).compile();

    service = module.get<YcloudService>(YcloudService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
