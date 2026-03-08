import { Test, TestingModule } from '@nestjs/testing';
import { InboundMessageService } from './inbound-message.service';

describe('InboundMessageService', () => {
  let service: InboundMessageService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [InboundMessageService],
    }).compile();

    service = module.get<InboundMessageService>(InboundMessageService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
