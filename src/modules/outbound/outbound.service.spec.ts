import { Test, TestingModule } from '@nestjs/testing';
import { OutboundService } from './outbound.service';

describe('OutboundService', () => {
  let service: OutboundService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [OutboundService],
    }).compile();

    service = module.get<OutboundService>(OutboundService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
