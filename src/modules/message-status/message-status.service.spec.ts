import { Test, TestingModule } from '@nestjs/testing';
import { MessageStatusService } from './message-status.service';
import { PrismaService } from 'src/prisma/prisma.service';
import { ChatEventsService } from '../chat-events/chat-events.service';
import { ConversationService } from '../conversation/conversation.service';

describe('MessageStatusService', () => {
  let service: MessageStatusService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MessageStatusService,
        {
          provide: PrismaService,
          useValue: {},
        },
        {
          provide: ChatEventsService,
          useValue: {},
        },
        {
          provide: ConversationService,
          useValue: {},
        },
      ],
    }).compile();

    service = module.get<MessageStatusService>(MessageStatusService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
