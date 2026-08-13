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
  AssistantKnowledgeImportStatus,
  AssistantMessageRole,
  AssistantMessageStatus,
  AssistantSessionMode,
  Prisma,
  Role,
} from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { DifyClient, DifyRequestError } from './dify.client';
import { PDFParse } from 'pdf-parse';
import { AssistantKnowledgeTransformService } from './assistant-knowledge-transform.service';

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
    private readonly transformService: AssistantKnowledgeTransformService,
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

  listConfiguredKnowledgeDatasets(input: { user: AuthUser }) {
    this.assertAdmin(input.user);
    return { data: this.getConfiguredDatasets() };
  }

  async processKnowledgePdf(input: {
    user: AuthUser;
    file: Express.Multer.File;
    datasetId: string;
    documentName?: string | null;
  }) {
    this.assertAdmin(input.user);
    this.assertKnowledgePdf(input.file);

    const dataset = this.getDatasetOrThrow(input.datasetId);
    const documentName =
      this.cleanDocumentName(input.documentName) ??
      this.cleanDocumentName(input.file.originalname.replace(/\.pdf$/i, '')) ??
      input.file.originalname;
    const startedAt = Date.now();

    try {
      const rawText = await this.extractPdfText(input.file.buffer);
      const transformed = await this.transformService.transformPdfText({
        rawText,
        documentName,
        datasetName: dataset.name,
      });

      if (transformed.needsManualReview) {
        const knowledgeImport = await this.prisma.assistantKnowledgeImport.create({
          data: {
            userId: input.user.userId,
            accountId: input.user.accountId ?? null,
            datasetId: dataset.id,
            datasetName: dataset.name,
            documentName,
            sourceFileName: input.file.originalname,
            sourceMimeType: input.file.mimetype,
            sourceSizeBytes: input.file.size,
            markdown: transformed.markdown,
            validationPoints: transformed.validationPoints,
            status: AssistantKnowledgeImportStatus.NEEDS_MANUAL_REVIEW,
            errorMessage: `Hay subsecciones ### con mas de ${process.env.ASSISTANT_KNOWLEDGE_MAX_SUBSECTION_CHARS ?? '1000'} caracteres.`,
            difyResponse: {
              oversizeBlocks: transformed.oversizeBlocks,
            } as Prisma.InputJsonValue,
          },
        });

        await this.auditKnowledgeProcess({
          user: input.user,
          startedAt,
          success: false,
          metadata: {
            importId: knowledgeImport.id,
            datasetId: dataset.id,
            documentName,
            oversizeBlocks: transformed.oversizeBlocks,
          },
          errorCode: 'NEEDS_MANUAL_REVIEW',
          errorMessage: knowledgeImport.errorMessage,
        });

        return {
          data: {
            importId: knowledgeImport.id,
            status: knowledgeImport.status,
            markdown: transformed.markdown,
            validationPoints: transformed.validationPoints,
            oversizeBlocks: transformed.oversizeBlocks,
            dataset,
            documentName,
          },
        };
      }

      const difyResponse = await this.difyClient.createKnowledgeDocumentByText({
        datasetId: dataset.id,
        name: documentName,
        text: transformed.markdown,
      });
      const difyDocumentId = this.extractDifyDocumentId(difyResponse);
      const difyBatch = this.stringOrNull(difyResponse.batch);

      if (difyDocumentId) {
        await this.difyClient.updateKnowledgeDocumentStatus({
          datasetId: dataset.id,
          documentId: difyDocumentId,
          action: 'disable',
        });
      }

      const knowledgeImport = await this.prisma.assistantKnowledgeImport.create({
        data: {
          userId: input.user.userId,
          accountId: input.user.accountId ?? null,
          datasetId: dataset.id,
          datasetName: dataset.name,
          documentName,
          sourceFileName: input.file.originalname,
          sourceMimeType: input.file.mimetype,
          sourceSizeBytes: input.file.size,
          markdown: transformed.markdown,
          validationPoints: transformed.validationPoints,
          status: AssistantKnowledgeImportStatus.PENDING_APPROVAL,
          difyDocumentId,
          difyBatch,
          difyResponse: difyResponse as Prisma.InputJsonValue,
        },
      });

      await this.auditKnowledgeProcess({
        user: input.user,
        startedAt,
        success: true,
        providerId: difyDocumentId,
        metadata: {
          importId: knowledgeImport.id,
          datasetId: dataset.id,
          documentName,
          difyBatch,
          validationPointCount: transformed.validationPoints.length,
        },
      });

      return {
        data: {
          importId: knowledgeImport.id,
          status: knowledgeImport.status,
          markdown: transformed.markdown,
          validationPoints: transformed.validationPoints,
          oversizeBlocks: [],
          dataset,
          documentName,
          difyDocumentId,
          difyBatch,
        },
      };
    } catch (error: any) {
      await this.auditKnowledgeProcess({
        user: input.user,
        startedAt,
        success: false,
        errorCode:
          error instanceof DifyRequestError
            ? String(error.statusCode ?? 'DIFY_ERROR')
            : 'KNOWLEDGE_PROCESS_ERROR',
        errorMessage: error?.message ?? 'Unknown knowledge process error',
        metadata: {
          datasetId: dataset.id,
          documentName,
          originalName: input.file.originalname,
          mimeType: input.file.mimetype,
          sizeBytes: input.file.size,
        },
      });
      throw error;
    }
  }

  async approveKnowledgeImport(input: { user: AuthUser; importId: string }) {
    this.assertAdmin(input.user);
    const knowledgeImport = await this.prisma.assistantKnowledgeImport.findUnique({
      where: { id: input.importId },
    });
    if (!knowledgeImport) throw new NotFoundException('Knowledge import not found');
    if (knowledgeImport.status !== AssistantKnowledgeImportStatus.PENDING_APPROVAL) {
      throw new BadRequestException('Only pending imports can be approved');
    }
    if (!knowledgeImport.difyDocumentId) {
      throw new BadRequestException('Knowledge import has no Dify document id');
    }

    const startedAt = Date.now();
    const response = await this.difyClient.updateKnowledgeDocumentStatus({
      datasetId: knowledgeImport.datasetId,
      documentId: knowledgeImport.difyDocumentId,
      action: 'enable',
    });

    const updated = await this.prisma.assistantKnowledgeImport.update({
      where: { id: knowledgeImport.id },
      data: {
        status: AssistantKnowledgeImportStatus.APPROVED,
        approvedAt: new Date(),
      },
    });

    await this.prisma.assistantAuditEvent.create({
      data: {
        userId: input.user.userId,
        accountId: input.user.accountId ?? null,
        action: AssistantAuditAction.KNOWLEDGE_APPROVE,
        success: true,
        latencyMs: Date.now() - startedAt,
        provider: 'DIFY',
        providerId: knowledgeImport.difyDocumentId,
        metadata: {
          importId: knowledgeImport.id,
          datasetId: knowledgeImport.datasetId,
          response,
        } as Prisma.InputJsonValue,
      },
    });

    return { data: updated };
  }

  async discardKnowledgeImport(input: { user: AuthUser; importId: string }) {
    this.assertAdmin(input.user);
    const knowledgeImport = await this.prisma.assistantKnowledgeImport.findUnique({
      where: { id: input.importId },
    });
    if (!knowledgeImport) throw new NotFoundException('Knowledge import not found');
    if (
      knowledgeImport.status !== AssistantKnowledgeImportStatus.PENDING_APPROVAL &&
      knowledgeImport.status !== AssistantKnowledgeImportStatus.NEEDS_MANUAL_REVIEW
    ) {
      throw new BadRequestException('Only pending imports can be discarded');
    }

    const updated = await this.prisma.assistantKnowledgeImport.update({
      where: { id: knowledgeImport.id },
      data: {
        status: AssistantKnowledgeImportStatus.DISCARDED,
        discardedAt: new Date(),
      },
    });

    await this.prisma.assistantAuditEvent.create({
      data: {
        userId: input.user.userId,
        accountId: input.user.accountId ?? null,
        action: AssistantAuditAction.KNOWLEDGE_DISCARD,
        success: true,
        provider: 'DIFY',
        providerId: knowledgeImport.difyDocumentId,
        metadata: {
          importId: knowledgeImport.id,
          datasetId: knowledgeImport.datasetId,
        } as Prisma.InputJsonValue,
      },
    });

    return { data: updated };
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

  private assertKnowledgePdf(file?: Express.Multer.File) {
    if (!file) throw new BadRequestException('File is required');
    if (file.mimetype !== 'application/pdf') {
      throw new BadRequestException('Only PDF files are supported');
    }
    const maxMb = Number(process.env.ASSISTANT_KNOWLEDGE_MAX_FILE_MB ?? '25');
    if (file.size > maxMb * 1024 * 1024) {
      throw new BadRequestException(`File exceeds ${maxMb}MB`);
    }
  }

  private async extractPdfText(buffer: Buffer) {
    const parser = new PDFParse({ data: new Uint8Array(buffer) });
    try {
      const result = await parser.getText();
      return result.text.trim();
    } finally {
      await parser.destroy();
    }
  }

  private getConfiguredDatasets() {
    const raw = process.env.DIFY_KNOWLEDGE_DATASETS_JSON;
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as Array<{
          id?: unknown;
          name?: unknown;
          key?: unknown;
          description?: unknown;
        }>;
        return parsed
          .filter((item) => typeof item.id === 'string' && typeof item.name === 'string')
          .map((item) => ({
            id: String(item.id),
            name: String(item.name),
            key: typeof item.key === 'string' ? item.key : String(item.id),
            description:
              typeof item.description === 'string' ? item.description : null,
          }));
      } catch {
        throw new BadRequestException('DIFY_KNOWLEDGE_DATASETS_JSON is invalid JSON');
      }
    }

    const datasetId = process.env.DIFY_KNOWLEDGE_DATASET_ID;
    if (!datasetId) {
      throw new BadRequestException(
        'DIFY_KNOWLEDGE_DATASETS_JSON or DIFY_KNOWLEDGE_DATASET_ID is missing',
      );
    }

    return [
      {
        id: datasetId,
        key: 'default',
        name: process.env.DIFY_KNOWLEDGE_DATASET_NAME ?? 'Conocimiento global',
        description: null,
      },
    ];
  }

  private getDatasetOrThrow(datasetId: string) {
    const dataset = this.getConfiguredDatasets().find(
      (item) => item.id === datasetId || item.key === datasetId,
    );
    if (!dataset) throw new BadRequestException('Dataset is not configured');
    return dataset;
  }

  private cleanDocumentName(value?: string | null) {
    const clean = value?.replace(/\s+/g, ' ').trim();
    return clean || null;
  }

  private extractDifyDocumentId(response: Record<string, any>) {
    return (
      this.stringOrNull(response.document?.id) ??
      this.stringOrNull(response.data?.document?.id) ??
      this.stringOrNull(response.id) ??
      this.stringOrNull(response.document_id)
    );
  }

  private async auditKnowledgeProcess(input: {
    user: AuthUser;
    startedAt: number;
    success: boolean;
    providerId?: string | null;
    errorCode?: string | null;
    errorMessage?: string | null;
    metadata: Record<string, unknown>;
  }) {
    await this.prisma.assistantAuditEvent.create({
      data: {
        userId: input.user.userId,
        accountId: input.user.accountId ?? null,
        action: AssistantAuditAction.KNOWLEDGE_PROCESS,
        success: input.success,
        latencyMs: Date.now() - input.startedAt,
        provider: 'DIFY',
        providerId: input.providerId ?? null,
        errorCode: input.errorCode ?? null,
        errorMessage: input.errorMessage ?? null,
        metadata: input.metadata as Prisma.InputJsonValue,
      },
    });
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
