import { Test, TestingModule } from '@nestjs/testing';
import { WebhookInboxService } from './webhook-inbox.service';

describe('WebhookInboxService', () => {
  let service: WebhookInboxService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [WebhookInboxService],
    }).compile();

    service = module.get<WebhookInboxService>(WebhookInboxService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
