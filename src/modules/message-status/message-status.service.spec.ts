import { Test, TestingModule } from '@nestjs/testing';
import { MessageStatusService } from './message-status.service';

describe('MessageStatusService', () => {
  let service: MessageStatusService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [MessageStatusService],
    }).compile();

    service = module.get<MessageStatusService>(MessageStatusService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
