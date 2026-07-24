import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  AssistantAuditAction,
  AssistantFeedbackRating,
  AssistantMessageRole,
  AssistantMessageStatus,
  AssistantSessionMode,
  Prisma,
  Role,
} from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { DifyClient, DifyRequestError } from './dify.client';

type AuthUser = {
  userId: string;
  role: Role;
  accountId?: string | null;
};

type QueryInput = {
  user: AuthUser;
  question: string;
  sessionId?: string | null;
  accountId?: string | null;
};

@Injectable()
export class AssistantService {
  private readonly logger = new Logger(AssistantService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly difyClient: DifyClient,
  ) {}

  async query(input: QueryInput) {
    const startedAt = Date.now();
    const accountId = this.resolveOptionalAccountId(input.user, input.accountId);
    let session = input.sessionId
      ? await this.getOwnedSession(input.user, input.sessionId)
      : null;

    if (!session) {
      session = await this.prisma.assistantSession.create({
        data: {
          userId: input.user.userId,
          accountId,
          mode: AssistantSessionMode.INTERNAL_FAQ,
          title: this.buildTitle(input.question),
        },
      });
    }

    const userMessage = await this.prisma.assistantMessage.create({
      data: {
        sessionId: session.id,
        userId: input.user.userId,
        role: AssistantMessageRole.USER,
        status: AssistantMessageStatus.COMPLETED,
        content: input.question,
      },
    });

    try {
      const response = await this.difyClient.sendChatMessage({
        query: input.question,
        conversationId: session.providerConversationId,
        user: `fenix:${input.user.userId}`,
      });
      const latencyMs = Date.now() - startedAt;
      const answer = this.extractAnswer(response);
      const usage = this.extractUsage(response);
      const citations = this.extractCitations(response);

      const assistantMessage = await this.prisma.$transaction(async (tx) => {
        const created = await tx.assistantMessage.create({
          data: {
            sessionId: session!.id,
            role: AssistantMessageRole.ASSISTANT,
            status: AssistantMessageStatus.COMPLETED,
            content: answer,
            providerMessageId:
              this.stringOrNull(response.message_id) ??
              this.stringOrNull(response.id),
            providerTaskId: this.stringOrNull(response.task_id),
            latencyMs,
            usage: usage as Prisma.InputJsonValue,
            rawPayload: this.shouldLogRawPayload()
              ? (response as Prisma.InputJsonValue)
              : undefined,
          },
        });

        if (response.conversation_id) {
          await tx.assistantSession.update({
            where: { id: session!.id },
            data: {
              providerConversationId: String(response.conversation_id),
            },
          });
        }

        if (citations.length) {
          await tx.assistantCitation.createMany({
            data: citations.map((citation) => ({
              messageId: created.id,
              providerResourceId: citation.providerResourceId,
              datasetId: citation.datasetId,
              documentId: citation.documentId,
              documentName: citation.documentName,
              segmentId: citation.segmentId,
              score: citation.score,
              excerpt: citation.excerpt,
              metadata: citation.metadata as Prisma.InputJsonValue,
            })),
          });
        }

        await tx.assistantAuditEvent.create({
          data: {
            userId: input.user.userId,
            accountId,
            action: AssistantAuditAction.QUERY,
            success: true,
            latencyMs,
            provider: 'DIFY',
            providerId: this.stringOrNull(response.message_id),
            metadata: {
              sessionId: session!.id,
              userMessageId: userMessage.id,
              assistantMessageId: created.id,
              usage,
              citationCount: citations.length,
            } as Prisma.InputJsonValue,
          },
        });

        return created;
      });

      return {
        data: {
          sessionId: session.id,
          messageId: assistantMessage.id,
          answer,
          citations,
          usage,
          latencyMs,
          providerConversationId:
            this.stringOrNull(response.conversation_id) ??
            session.providerConversationId,
        },
      };
    } catch (error: any) {
      const latencyMs = Date.now() - startedAt;
      await this.prisma.assistantAuditEvent.create({
        data: {
          userId: input.user.userId,
          accountId,
          action: AssistantAuditAction.QUERY,
          success: false,
          latencyMs,
          provider: 'DIFY',
          errorCode:
            error instanceof DifyRequestError
              ? String(error.statusCode ?? 'DIFY_ERROR')
              : 'ASSISTANT_ERROR',
          errorMessage: error?.message ?? 'Unknown assistant error',
          metadata: {
            sessionId: session.id,
            userMessageId: userMessage.id,
          } as Prisma.InputJsonValue,
        },
      });

      await this.prisma.assistantMessage.create({
        data: {
          sessionId: session.id,
          role: AssistantMessageRole.ASSISTANT,
          status: AssistantMessageStatus.FAILED,
          content: '',
          errorCode:
            error instanceof DifyRequestError
              ? String(error.statusCode ?? 'DIFY_ERROR')
              : 'ASSISTANT_ERROR',
          errorMessage: error?.message ?? 'Unknown assistant error',
        },
      });

      throw error;
    }
  }

  async listSessions(input: {
    user: AuthUser;
    accountId?: string | null;
    limit: number;
  }) {
    const accountId = this.resolveOptionalAccountId(input.user, input.accountId);

    const sessions = await this.prisma.assistantSession.findMany({
      where: {
        userId: input.user.userId,
        ...(accountId ? { accountId } : {}),
      },
      orderBy: { updatedAt: 'desc' },
      take: input.limit,
      include: {
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    });

    return { data: sessions };
  }

  async getSession(user: AuthUser, sessionId: string) {
    await this.getOwnedSession(user, sessionId);
    const session = await this.prisma.assistantSession.findUnique({
      where: { id: sessionId },
      include: {
        messages: {
          orderBy: { createdAt: 'asc' },
          include: {
            citations: true,
            feedback: {
              where: { userId: user.userId },
            },
          },
        },
      },
    });

    return { data: session };
  }

  async feedback(input: {
    user: AuthUser;
    messageId: string;
    rating: AssistantFeedbackRating;
    reason?: string | null;
    editedText?: string | null;
  }) {
    const message = await this.prisma.assistantMessage.findUnique({
      where: { id: input.messageId },
      include: { session: true },
    });

    if (!message) throw new NotFoundException('Assistant message not found');
    this.assertCanAccessSession(input.user, message.session);
    if (message.role !== AssistantMessageRole.ASSISTANT) {
      throw new BadRequestException('Feedback can only be attached to answers');
    }

    const feedback = await this.prisma.assistantFeedback.upsert({
      where: {
        messageId_userId: {
          messageId: input.messageId,
          userId: input.user.userId,
        },
      },
      create: {
        messageId: input.messageId,
        userId: input.user.userId,
        rating: input.rating,
        reason: input.reason,
        editedText: input.editedText,
      },
      update: {
        rating: input.rating,
        reason: input.reason,
        editedText: input.editedText,
      },
    });

    await this.prisma.assistantAuditEvent.create({
      data: {
        userId: input.user.userId,
        accountId: message.session.accountId,
        action: AssistantAuditAction.FEEDBACK,
        success: true,
        metadata: {
          sessionId: message.sessionId,
          messageId: input.messageId,
          rating: input.rating,
        } as Prisma.InputJsonValue,
      },
    });

    return { data: feedback };
  }

  async listKnowledgeDocuments(input: {
    user: AuthUser;
    page: number;
    limit: number;
    keyword?: string | null;
  }) {
    this.assertAdmin(input.user);
    const startedAt = Date.now();
    const response = await this.difyClient.listKnowledgeDocuments({
      page: input.page,
      limit: input.limit,
      keyword: input.keyword,
    });
    await this.prisma.assistantAuditEvent.create({
      data: {
        userId: input.user.userId,
        action: AssistantAuditAction.KNOWLEDGE_LIST,
        success: true,
        latencyMs: Date.now() - startedAt,
        metadata: {
          page: input.page,
          limit: input.limit,
          keyword: input.keyword ?? null,
        } as Prisma.InputJsonValue,
      },
    });
    return response;
  }

  async uploadKnowledgeDocument(input: {
    user: AuthUser;
    file: Express.Multer.File;
  }) {
    this.assertAdmin(input.user);
    if (!input.file) throw new BadRequestException('File is required');
    if (input.file.mimetype !== 'application/pdf') {
      throw new BadRequestException('Only PDF files are supported for now');
    }
    const maxMb = Number(process.env.ASSISTANT_KNOWLEDGE_MAX_FILE_MB ?? '25');
    if (input.file.size > maxMb * 1024 * 1024) {
      throw new BadRequestException(`File exceeds ${maxMb}MB`);
    }

    const startedAt = Date.now();
    try {
      const response = await this.difyClient.uploadKnowledgeDocument({
        file: input.file,
      });
      await this.prisma.assistantAuditEvent.create({
        data: {
          userId: input.user.userId,
          action: AssistantAuditAction.KNOWLEDGE_UPLOAD,
          success: true,
          latencyMs: Date.now() - startedAt,
          provider: 'DIFY',
          providerId: this.stringOrNull(response.document?.id ?? response.id),
          metadata: {
            originalName: input.file.originalname,
            mimeType: input.file.mimetype,
            sizeBytes: input.file.size,
            response,
          } as Prisma.InputJsonValue,
        },
      });
      return { data: response };
    } catch (error: any) {
      await this.prisma.assistantAuditEvent.create({
        data: {
          userId: input.user.userId,
          action: AssistantAuditAction.KNOWLEDGE_UPLOAD,
          success: false,
          latencyMs: Date.now() - startedAt,
          provider: 'DIFY',
          errorCode:
            error instanceof DifyRequestError
              ? String(error.statusCode ?? 'DIFY_ERROR')
              : 'ASSISTANT_ERROR',
          errorMessage: error?.message ?? 'Unknown assistant error',
          metadata: {
            originalName: input.file.originalname,
            mimeType: input.file.mimetype,
            sizeBytes: input.file.size,
          } as Prisma.InputJsonValue,
        },
      });
      throw error;
    }
  }

  private async getOwnedSession(user: AuthUser, sessionId: string) {
    const session = await this.prisma.assistantSession.findUnique({
      where: { id: sessionId },
    });
    if (!session) throw new NotFoundException('Assistant session not found');
    this.assertCanAccessSession(user, session);
    return session;
  }

  private assertCanAccessSession(
    user: AuthUser,
    session: { userId: string; accountId: string | null },
  ) {
    if (session.userId !== user.userId) {
      throw new ForbiddenException('You cannot access this assistant session');
    }
    if (
      user.role === Role.SALES &&
      session.accountId &&
      user.accountId !== session.accountId
    ) {
      throw new ForbiddenException('You cannot access another account context');
    }
  }

  private assertAdmin(user: AuthUser) {
    if (user.role !== Role.ADMIN) {
      throw new ForbiddenException('Only admins can manage assistant knowledge');
    }
  }

  private resolveOptionalAccountId(
    user: AuthUser,
    accountIdFromRequest?: string | null,
  ) {
    if (user.role === Role.SALES) {
      if (accountIdFromRequest && accountIdFromRequest !== user.accountId) {
        throw new ForbiddenException('You cannot use another account context');
      }
      return user.accountId ?? null;
    }

    return accountIdFromRequest ?? user.accountId ?? null;
  }

  private buildTitle(question: string) {
    const clean = question.replace(/\s+/g, ' ').trim();
    return clean.length > 80 ? `${clean.slice(0, 77)}...` : clean;
  }

  private extractAnswer(response: Record<string, any>) {
    const answer = response.answer;
    if (typeof answer === 'string' && answer.trim()) return answer.trim();
    return 'No se pudo obtener una respuesta del asistente.';
  }

  private extractUsage(response: Record<string, any>) {
    return response.metadata?.usage ?? null;
  }

  private extractCitations(response: Record<string, any>) {
    const resources = response.metadata?.retriever_resources;
    if (!Array.isArray(resources)) return [];

    return resources.map((resource: Record<string, any>) => ({
      providerResourceId: this.stringOrNull(resource.id),
      datasetId: this.stringOrNull(resource.dataset_id),
      documentId: this.stringOrNull(resource.document_id),
      documentName:
        this.stringOrNull(resource.document_name) ??
        this.stringOrNull(resource.title),
      segmentId:
        this.stringOrNull(resource.segment_id) ??
        this.stringOrNull(resource.segment_position),
      score:
        typeof resource.score === 'number'
          ? new Prisma.Decimal(resource.score)
          : null,
      excerpt:
        this.stringOrNull(resource.content) ??
        this.stringOrNull(resource.text) ??
        this.stringOrNull(resource.segment_content),
      metadata: resource,
    }));
  }

  private stringOrNull(value: unknown) {
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number') return String(value);
    return null;
  }

  private shouldLogRawPayload() {
    return (process.env.ASSISTANT_LOG_PROMPTS ?? 'false').toLowerCase() ===
      'true';
  }
}
