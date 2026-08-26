import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { Role } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { AssistantService } from './assistant.service';
import {
  AssistantFeedbackDto,
  AssistantKnowledgeDatasetsQueryDto,
  AssistantKnowledgeQueryDto,
  AssistantKnowledgeUploadDto,
  AssistantQueryDto,
  AssistantSessionsQueryDto,
} from './dto/assistant.dto';

type AuthUser = {
  userId: string;
  role: Role;
  accountId?: string | null;
};

@Controller('assistant')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AssistantController {
  constructor(private readonly assistantService: AssistantService) {}

  @Roles(Role.ADMIN, Role.SALES)
  @Post('query')
  query(@Body() body: AssistantQueryDto, @Req() req: { user: AuthUser }) {
    return this.assistantService.query({
      user: req.user,
      question: body.question,
      sessionId: body.sessionId ?? null,
      accountId: body.accountId ?? null,
    });
  }

  @Roles(Role.ADMIN, Role.SALES)
  @Get('sessions')
  listSessions(
    @Query() query: AssistantSessionsQueryDto,
    @Req() req: { user: AuthUser },
  ) {
    return this.assistantService.listSessions({
      user: req.user,
      accountId: query.accountId ?? null,
      limit: query.limit ?? 50,
    });
  }

  @Roles(Role.ADMIN, Role.SALES)
  @Get('sessions/:sessionId')
  getSession(
    @Param('sessionId', new ParseUUIDPipe()) sessionId: string,
    @Req() req: { user: AuthUser },
  ) {
    return this.assistantService.getSession(req.user, sessionId);
  }

  @Roles(Role.ADMIN, Role.SALES)
  @Post('messages/:messageId/feedback')
  feedback(
    @Param('messageId', new ParseUUIDPipe()) messageId: string,
    @Body() body: AssistantFeedbackDto,
    @Req() req: { user: AuthUser },
  ) {
    return this.assistantService.feedback({
      user: req.user,
      messageId,
      rating: body.rating,
      reason: body.reason ?? null,
      editedText: body.editedText ?? null,
    });
  }

  @Roles(Role.ADMIN)
  @Get('knowledge/datasets')
  listKnowledgeDatasets(
    @Query() query: AssistantKnowledgeDatasetsQueryDto,
    @Req() req: { user: AuthUser },
  ) {
    return this.assistantService.listConfiguredKnowledgeDatasets({
      user: req.user,
      documentsLimit: query.documentsLimit,
    });
  }

  @Roles(Role.ADMIN)
  @Post('knowledge/imports')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: {
        fileSize:
          Number(process.env.ASSISTANT_KNOWLEDGE_MAX_FILE_MB ?? '25') *
          1024 *
          1024,
      },
    }),
  )
  processKnowledgePdf(
    @UploadedFile() file: Express.Multer.File,
    @Body() body: AssistantKnowledgeUploadDto,
    @Req() req: { user: AuthUser },
  ) {
    return this.assistantService.processKnowledgePdf({
      user: req.user,
      file,
      datasetId: body.datasetId,
      documentName: body.documentName ?? null,
      replaceDocumentId: body.replaceDocumentId ?? null,
      replaceDocumentName: body.replaceDocumentName ?? null,
    });
  }

  @Roles(Role.ADMIN)
  @Post('knowledge/imports/:importId/approve')
  approveKnowledgeImport(
    @Param('importId', new ParseUUIDPipe()) importId: string,
    @Req() req: { user: AuthUser },
  ) {
    return this.assistantService.approveKnowledgeImport({
      user: req.user,
      importId,
    });
  }

  @Roles(Role.ADMIN)
  @Post('knowledge/imports/:importId/discard')
  discardKnowledgeImport(
    @Param('importId', new ParseUUIDPipe()) importId: string,
    @Req() req: { user: AuthUser },
  ) {
    return this.assistantService.discardKnowledgeImport({
      user: req.user,
      importId,
    });
  }

  @Roles(Role.ADMIN)
  @Get('knowledge/documents')
  listKnowledgeDocuments(
    @Query() query: AssistantKnowledgeQueryDto,
    @Req() req: { user: AuthUser },
  ) {
    return this.assistantService.listKnowledgeDocuments({
      user: req.user,
      page: query.page ?? 1,
      limit: query.limit ?? 20,
      keyword: query.keyword ?? null,
      datasetId: query.datasetId ?? null,
    });
  }
}
