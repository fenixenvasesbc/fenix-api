import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { PrismaModule } from 'src/prisma/prisma.module';
import { AssistantController } from './assistant.controller';
import { AssistantService } from './assistant.service';
import { DifyClient } from './dify.client';
import { AssistantKnowledgeTransformService } from './assistant-knowledge-transform.service';

@Module({
  imports: [PrismaModule, HttpModule],
  controllers: [AssistantController],
  providers: [AssistantService, DifyClient, AssistantKnowledgeTransformService],
  exports: [AssistantService],
})
export class AssistantModule {}
