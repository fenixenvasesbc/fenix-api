import { Test, TestingModule } from '@nestjs/testing';
import { OutboundController } from './outbound.controller';

describe('OutboundController', () => {
  let controller: OutboundController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [OutboundController],
    }).compile();

    controller = module.get<OutboundController>(OutboundController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
