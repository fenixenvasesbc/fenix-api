import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { PrismaModule } from 'src/prisma/prisma.module';
import { AssistantController } from './assistant.controller';
import { AssistantService } from './assistant.service';
import { DifyClient } from './dify.client';

@Module({
  imports: [PrismaModule, HttpModule],
  controllers: [AssistantController],
  providers: [AssistantService, DifyClient],
  exports: [AssistantService],
})
export class AssistantModule {}
