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
  AssistantKnowledgeQueryDto,
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
    });
  }

  @Roles(Role.ADMIN)
  @Post('knowledge/documents')
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
  uploadKnowledgeDocument(
    @UploadedFile() file: Express.Multer.File,
    @Req() req: { user: AuthUser },
  ) {
    return this.assistantService.uploadKnowledgeDocument({
      user: req.user,
      file,
    });
  }
}
