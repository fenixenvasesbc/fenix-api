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
    datasetId?: string | null;
  }) {
    this.assertAdmin(input.user);
    const datasetId = input.datasetId ? this.getDatasetOrThrow(input.datasetId).id : undefined;
    const startedAt = Date.now();
    const response = await this.difyClient.listKnowledgeDocuments({
      page: input.page,
      limit: input.limit,
      keyword: input.keyword,
      datasetId,
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
          datasetId: datasetId ?? null,
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

  async listConfiguredKnowledgeDatasets(input: {
    user: AuthUser;
    documentsLimit?: number;
  }) {
    this.assertAdmin(input.user);
    const datasets = this.getConfiguredDatasets();
    const documentsLimit = input.documentsLimit ?? 20;

    // Por cada base de conocimiento configurada, traemos tambien sus
    // documentos actuales en Dify: asi, al elegir donde subir uno nuevo,
    // el admin ve de una vez que dataset es cada uno y que hay ya dentro
    // (sin tener que entrar a la interfaz de Dify).
    const datasetsWithDocuments = await Promise.all(
      datasets.map(async (dataset) => {
        try {
          const response = await this.difyClient.listKnowledgeDocuments({
            page: 1,
            limit: documentsLimit,
            datasetId: dataset.id,
          });

          const rawDocuments = Array.isArray((response as any)?.data)
            ? (response as any).data
            : [];

          const documents = rawDocuments.map((doc: any) => ({
            id: this.stringOrNull(doc?.id),
            name: this.stringOrNull(doc?.name),
            enabled: Boolean(doc?.enabled),
            wordCount:
              typeof doc?.word_count === 'number' ? doc.word_count : null,
            createdAt:
              typeof doc?.created_at === 'number'
                ? new Date(doc.created_at * 1000).toISOString()
                : null,
          }));

          const total = (response as any)?.total;

          return {
            ...dataset,
            documentCount: typeof total === 'number' ? total : documents.length,
            documents,
            documentsError: null as string | null,
          };
        } catch (error: any) {
          this.logger.error(
            `No se pudieron listar documentos del dataset ${dataset.id}: ${error?.message ?? error}`,
          );
          return {
            ...dataset,
            documentCount: null as number | null,
            documents: [] as unknown[],
            documentsError:
              error instanceof DifyRequestError
                ? error.providerMessage ?? error.message
                : 'No se pudo consultar Dify para este dataset',
          };
        }
      }),
    );

    return { data: datasetsWithDocuments };
  }

  async processKnowledgePdf(input: {
    user: AuthUser;
    file: Express.Multer.File;
    datasetId: string;
    documentName?: string | null;
    replaceDocumentId?: string | null;
    replaceDocumentName?: string | null;
  }) {
    this.assertAdmin(input.user);
    this.assertKnowledgePdf(input.file);

    const dataset = this.getDatasetOrThrow(input.datasetId);
    const documentName =
      this.cleanDocumentName(input.documentName) ??
      this.cleanDocumentName(input.file.originalname.replace(/\.pdf$/i, '')) ??
      input.file.originalname;
    const replaceDocumentId = this.cleanDocumentName(input.replaceDocumentId);
    let replaceDocumentName = this.cleanDocumentName(input.replaceDocumentName);
    const startedAt = Date.now();

    try {
      if (replaceDocumentId) {
        // Falla rapido (antes de gastar la llamada a OpenAI) si el documento
        // que se quiere reemplazar ya no existe en el dataset destino.
        const confirmedName = await this.assertReplaceDocumentInDataset({
          datasetId: dataset.id,
          documentId: replaceDocumentId,
        });
        replaceDocumentName = confirmedName ?? replaceDocumentName;
      }

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
            replacesDifyDocumentId: replaceDocumentId,
            replacesDifyDocumentName: replaceDocumentName,
            errorMessage: `Hay subsecciones ### con mas de ${process.env.ASSISTANT_KNOWLEDGE_MAX_SUBSECTION_CHARS ?? '1000'} caracteres.`,
          difyResponse: {
            oversizeBlocks: transformed.oversizeBlocks,
            replacesDifyDocumentId: replaceDocumentId,
            replacesDifyDocumentName: replaceDocumentName,
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
            replacesDifyDocumentId: replaceDocumentId,
            replacesDifyDocumentName: replaceDocumentName,
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

      if (difyDocumentId && difyBatch) {
        // Dify indexa el documento en segundo plano; hay que esperar a que
        // termine antes de poder deshabilitarlo (si no, Dify responde 400
        // "is not completed"). Con datasets Parent-child esto puede tardar
        // mas que en modo General por el paso adicional de sub-chunks.
        await this.difyClient.waitForKnowledgeDocumentIndexing({
          datasetId: dataset.id,
          batch: difyBatch,
          documentId: difyDocumentId,
        });
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
          replacesDifyDocumentId: replaceDocumentId,
          replacesDifyDocumentName: replaceDocumentName,
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
          replacesDifyDocumentId: replaceDocumentId,
          replacesDifyDocumentName: replaceDocumentName,
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
          replacesDifyDocumentId: replaceDocumentId,
          replacesDifyDocumentName: replaceDocumentName,
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
    const replacementAction = this.getReplacementAction();

    // El "enable" del documento nuevo y el "archive/disable" del documento
    // viejo son dos llamadas separadas a Dify: no son atomicas. Por eso
    // persistimos newDocumentEnabledAt apenas la primera tiene exito, ANTES
    // de intentar la segunda. Asi, si el archivado del viejo falla (o el
    // proceso se cae en el medio), un reintento de este mismo metodo sabe
    // que no debe volver a llamar "enable" (Dify ya lo tiene publicado) y
    // el admin puede ver en el import que el documento nuevo ya esta en
    // vivo aunque el reemplazo no se haya completado.
    let response: Record<string, any> | null = null;
    if (!knowledgeImport.newDocumentEnabledAt) {
      response = await this.difyClient.updateKnowledgeDocumentStatus({
        datasetId: knowledgeImport.datasetId,
        documentId: knowledgeImport.difyDocumentId,
        action: 'enable',
      });
      await this.prisma.assistantKnowledgeImport.update({
        where: { id: knowledgeImport.id },
        data: { newDocumentEnabledAt: new Date() },
      });
    }

    let replacementResponse: Record<string, any> | null = null;
    if (knowledgeImport.replacesDifyDocumentId) {
      try {
        replacementResponse = await this.difyClient.updateKnowledgeDocumentStatus({
          datasetId: knowledgeImport.datasetId,
          documentId: knowledgeImport.replacesDifyDocumentId,
          action: replacementAction,
        });
      } catch (error: any) {
        const replacementErrorMessage =
          error?.message ?? 'No se pudo archivar el documento anterior en Dify';

        // El documento nuevo ya quedo publicado (ver arriba). Dejamos el
        // import en PENDING_APPROVAL -no APPROVED-, pero guardamos el error
        // para que quede visible: el admin necesita saber que hay dos
        // documentos activos a la vez y puede reintentar la aprobacion
        // (el "enable" no se repetira) o resolverlo manualmente en Dify.
        await this.prisma.assistantKnowledgeImport.update({
          where: { id: knowledgeImport.id },
          data: { replacementError: String(replacementErrorMessage).slice(0, 500) },
        });

        await this.prisma.assistantAuditEvent.create({
          data: {
            userId: input.user.userId,
            accountId: input.user.accountId ?? null,
            action: AssistantAuditAction.KNOWLEDGE_APPROVE,
            success: false,
            latencyMs: Date.now() - startedAt,
            provider: 'DIFY',
            providerId: knowledgeImport.difyDocumentId,
            errorCode:
              error instanceof DifyRequestError
                ? String(error.statusCode ?? 'DIFY_ERROR')
                : 'REPLACEMENT_ARCHIVE_FAILED',
            errorMessage: replacementErrorMessage,
            metadata: {
              importId: knowledgeImport.id,
              datasetId: knowledgeImport.datasetId,
              newDocumentAlreadyEnabled: true,
              replacesDifyDocumentId: knowledgeImport.replacesDifyDocumentId,
              replacesDifyDocumentName: knowledgeImport.replacesDifyDocumentName,
              replacementAction,
            } as Prisma.InputJsonValue,
          },
        });

        throw new BadRequestException(
          `El documento nuevo ya quedo publicado en Dify, pero no se pudo archivar el documento anterior (${knowledgeImport.replacesDifyDocumentName ?? knowledgeImport.replacesDifyDocumentId}): ${replacementErrorMessage}. Puedes reintentar la aprobacion o archivar el documento anterior manualmente en Dify.`,
        );
      }
    }

    const updated = await this.prisma.assistantKnowledgeImport.update({
      where: { id: knowledgeImport.id },
      data: {
        status: AssistantKnowledgeImportStatus.APPROVED,
        approvedAt: new Date(),
        replacementAction: knowledgeImport.replacesDifyDocumentId
          ? replacementAction
          : null,
        replacementError: null,
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
          replacesDifyDocumentId: knowledgeImport.replacesDifyDocumentId,
          replacesDifyDocumentName: knowledgeImport.replacesDifyDocumentName,
          replacementAction: knowledgeImport.replacesDifyDocumentId
            ? replacementAction
            : null,
          replacementResponse,
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

    let discardedDocumentResponse: Record<string, any> | null = null;

    if (knowledgeImport.difyDocumentId) {
      discardedDocumentResponse = await this.difyClient.updateKnowledgeDocumentStatus({
        datasetId: knowledgeImport.datasetId,
        documentId: knowledgeImport.difyDocumentId,
        action: 'archive',
      });
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
          difyDocumentId: knowledgeImport.difyDocumentId,
          discardedDocumentAction: knowledgeImport.difyDocumentId ? 'archive' : null,
          discardedDocumentResponse,
          replacesDifyDocumentId: knowledgeImport.replacesDifyDocumentId,
          replacesDifyDocumentName: knowledgeImport.replacesDifyDocumentName,
        } as Prisma.InputJsonValue,
      },
    });

    return { data: updated };
  }

  async listKnowledgeImports(input: {
    user: AuthUser;
    status?: AssistantKnowledgeImportStatus;
    datasetId?: string | null;
    page: number;
    limit: number;
  }) {
    this.assertAdmin(input.user);

    const where: Prisma.AssistantKnowledgeImportWhereInput = {};
    if (input.status) {
      where.status = input.status;
    } else {
      where.status = {
        in: [
          AssistantKnowledgeImportStatus.PENDING_APPROVAL,
          AssistantKnowledgeImportStatus.NEEDS_MANUAL_REVIEW,
        ],
      };
    }
    if (input.datasetId) {
      where.datasetId = this.getDatasetOrThrow(input.datasetId).id;
    }

    const [total, imports] = await this.prisma.$transaction([
      this.prisma.assistantKnowledgeImport.count({ where }),
      this.prisma.assistantKnowledgeImport.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (input.page - 1) * input.limit,
        take: input.limit,
        select: {
          id: true,
          datasetId: true,
          datasetName: true,
          documentName: true,
          sourceFileName: true,
          sourceSizeBytes: true,
          status: true,
          errorMessage: true,
          replacesDifyDocumentId: true,
          replacesDifyDocumentName: true,
          newDocumentEnabledAt: true,
          replacementError: true,
          createdAt: true,
          updatedAt: true,
          approvedAt: true,
          discardedAt: true,
          user: { select: { email: true } },
        },
      }),
    ]);

    return {
      data: imports,
      meta: {
        page: input.page,
        limit: input.limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / input.limit)),
      },
    };
  }

  async getKnowledgeImport(input: { user: AuthUser; importId: string }) {
    this.assertAdmin(input.user);
    const knowledgeImport = await this.prisma.assistantKnowledgeImport.findUnique({
      where: { id: input.importId },
      include: { user: { select: { email: true } } },
    });
    if (!knowledgeImport) throw new NotFoundException('Knowledge import not found');

    const dataset = this.getConfiguredDatasets().find(
      (item) => item.id === knowledgeImport.datasetId,
    ) ?? {
      id: knowledgeImport.datasetId,
      key: knowledgeImport.datasetId,
      name: knowledgeImport.datasetName,
      description: null,
    };

    const difyResponse = (knowledgeImport.difyResponse ?? null) as Record<string, any> | null;
    const oversizeBlocks =
      knowledgeImport.status === AssistantKnowledgeImportStatus.NEEDS_MANUAL_REVIEW
        ? (difyResponse?.oversizeBlocks ?? [])
        : [];

    return {
      data: {
        importId: knowledgeImport.id,
        status: knowledgeImport.status,
        markdown: knowledgeImport.markdown,
        validationPoints: knowledgeImport.validationPoints,
        oversizeBlocks,
        dataset,
        documentName: knowledgeImport.documentName,
        sourceFileName: knowledgeImport.sourceFileName,
        sourceMimeType: knowledgeImport.sourceMimeType,
        sourceSizeBytes: knowledgeImport.sourceSizeBytes,
        difyDocumentId: knowledgeImport.difyDocumentId,
        difyBatch: knowledgeImport.difyBatch,
        replacesDifyDocumentId: knowledgeImport.replacesDifyDocumentId,
        replacesDifyDocumentName: knowledgeImport.replacesDifyDocumentName,
        replacementAction: knowledgeImport.replacementAction,
        newDocumentEnabledAt: knowledgeImport.newDocumentEnabledAt,
        replacementError: knowledgeImport.replacementError,
        errorMessage: knowledgeImport.errorMessage,
        uploadedBy: knowledgeImport.user?.email ?? null,
        createdAt: knowledgeImport.createdAt,
        updatedAt: knowledgeImport.updatedAt,
        approvedAt: knowledgeImport.approvedAt,
        discardedAt: knowledgeImport.discardedAt,
      },
    };
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

  // Busca un documento dentro de un dataset consultando Dify directamente
  // (no confia en lo que manda el frontend, que podria estar desactualizado
  // o llegar manipulado via una llamada directa a la API). Recorre unas
  // pocas paginas de Dify, suficiente para el volumen de documentos que
  // maneja Fenix hoy.
  private async getDatasetDocumentOrThrow(input: {
    datasetId: string;
    documentId: string;
  }): Promise<{ id: string; name: string | null; enabled: boolean }> {
    const maxPages = 5;
    const limit = 100;
    for (let page = 1; page <= maxPages; page += 1) {
      const response = await this.difyClient.listKnowledgeDocuments({
        page,
        limit,
        datasetId: input.datasetId,
      });
      const rawDocuments = Array.isArray((response as any)?.data)
        ? (response as any).data
        : [];
      const match = rawDocuments.find(
        (doc: any) => this.stringOrNull(doc?.id) === input.documentId,
      );
      if (match) {
        return {
          id: input.documentId,
          name: this.stringOrNull(match?.name),
          enabled: Boolean(match?.enabled),
        };
      }
      if (!(response as any)?.has_more) break;
    }
    throw new BadRequestException(
      'El documento no existe en el dataset seleccionado (puede haber sido eliminado o archivado en Dify). Actualiza la lista de documentos e intenta de nuevo.',
    );
  }

  // Verifica contra Dify que el documento a reemplazar realmente exista
  // dentro del dataset destino, y devuelve el nombre real que tiene en Dify
  // (para no confiar tampoco en el nombre que mando el cliente).
  private async assertReplaceDocumentInDataset(input: {
    datasetId: string;
    documentId: string;
  }): Promise<string | null> {
    const document = await this.getDatasetDocumentOrThrow(input);
    return document.name;
  }

  // Activa o desactiva un documento existente en un dataset (sin pasar por
  // el flujo de aprobacion/reemplazo). Se usa desde el listado de
  // documentos de la SPA para que el admin pueda apagar temporalmente un
  // documento sin tener que ir a Dify directamente.
  async setKnowledgeDocumentStatus(input: {
    user: AuthUser;
    datasetId: string;
    documentId: string;
    enabled: boolean;
  }) {
    this.assertAdmin(input.user);
    const dataset = this.getDatasetOrThrow(input.datasetId);
    const document = await this.getDatasetDocumentOrThrow({
      datasetId: dataset.id,
      documentId: input.documentId,
    });

    const startedAt = Date.now();
    const action = input.enabled ? 'enable' : 'disable';

    try {
      const response = await this.difyClient.updateKnowledgeDocumentStatus({
        datasetId: dataset.id,
        documentId: input.documentId,
        action,
      });

      await this.prisma.assistantAuditEvent.create({
        data: {
          userId: input.user.userId,
          accountId: input.user.accountId ?? null,
          action: AssistantAuditAction.KNOWLEDGE_DOCUMENT_STATUS,
          success: true,
          latencyMs: Date.now() - startedAt,
          provider: 'DIFY',
          providerId: input.documentId,
          metadata: {
            datasetId: dataset.id,
            documentName: document.name,
            action,
            response,
          } as Prisma.InputJsonValue,
        },
      });

      return {
        data: {
          id: input.documentId,
          name: document.name,
          datasetId: dataset.id,
          enabled: input.enabled,
        },
      };
    } catch (error: any) {
      await this.prisma.assistantAuditEvent.create({
        data: {
          userId: input.user.userId,
          accountId: input.user.accountId ?? null,
          action: AssistantAuditAction.KNOWLEDGE_DOCUMENT_STATUS,
          success: false,
          latencyMs: Date.now() - startedAt,
          provider: 'DIFY',
          providerId: input.documentId,
          errorCode:
            error instanceof DifyRequestError
              ? String(error.statusCode ?? 'DIFY_ERROR')
              : 'KNOWLEDGE_DOCUMENT_STATUS_ERROR',
          errorMessage: error?.message ?? 'No se pudo actualizar el estado del documento',
          metadata: {
            datasetId: dataset.id,
            documentId: input.documentId,
            action,
          } as Prisma.InputJsonValue,
        },
      });
      throw error;
    }
  }

  private extractDifyDocumentId(response: Record<string, any>) {
    return (
      this.stringOrNull(response.document?.id) ??
      this.stringOrNull(response.data?.document?.id) ??
      this.stringOrNull(response.id) ??
      this.stringOrNull(response.document_id)
    );
  }

  private getReplacementAction(): 'archive' | 'disable' {
    const value = (process.env.DIFY_KNOWLEDGE_REPLACE_OLD_ACTION ?? 'archive')
      .trim()
      .toLowerCase();
    return value === 'disable' ? 'disable' : 'archive';
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
