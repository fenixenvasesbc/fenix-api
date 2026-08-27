import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import FormData from 'form-data';

export class DifyRequestError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly providerMessage?: string,
  ) {
    super(message);
    this.name = 'DifyRequestError';
  }
}

type DifyChatInput = {
  query: string;
  conversationId?: string | null;
  user: string;
  inputs?: Record<string, unknown>;
};

type DifyUploadDocumentInput = {
  file: Express.Multer.File;
};

type DifyCreateDocumentByTextInput = {
  datasetId: string;
  name: string;
  text: string;
};

type DifyDocForm = 'text_model' | 'hierarchical_model';

type DifyIndexingStatusEntry = {
  id: string;
  indexing_status: string;
  error: string | null;
  completed_segments?: number;
  total_segments?: number;
};

@Injectable()
export class DifyClient {
  private readonly logger = new Logger(DifyClient.name);
  private readonly baseUrl = (
    process.env.DIFY_BASE_URL ?? 'http://host.docker.internal:32770'
  ).replace(/\/+$/, '');

  private readonly timeoutMs = Number(
    process.env.ASSISTANT_TIMEOUT_MS ?? '30000',
  );

  constructor(private readonly httpService: HttpService) {}

  async sendChatMessage(input: DifyChatInput) {
    this.assertEnabled();
    const apiKey = this.getAppApiKey();

    const body = {
      inputs: {
        language: process.env.ASSISTANT_LANGUAGE ?? 'es',
        mode: 'internal_faq',
        ...(input.inputs ?? {}),
      },
      query: input.query,
      response_mode: 'blocking',
      conversation_id: input.conversationId ?? '',
      user: input.user,
    };

    return this.postJson<Record<string, any>>({
      path: '/v1/chat-messages',
      apiKey,
      body,
      operation: 'chatMessage',
    });
  }

  // Reenvia a Dify el like/dislike que se da en la SPA, usando el mismo
  // "user" con el que se genero el mensaje original. Asi, la calificacion
  // tambien aparece en Logs & Annotations dentro de Dify y un admin puede
  // convertir esa respuesta en una anotacion (capa de FAQ) desde ahi.
  async sendMessageFeedback(input: {
    messageId: string;
    rating: 'like' | 'dislike' | null;
    user: string;
    content?: string | null;
  }) {
    this.assertEnabled();
    const apiKey = this.getAppApiKey();

    return this.postJson<Record<string, any>>({
      path: `/v1/messages/${input.messageId}/feedbacks`,
      apiKey,
      body: {
        rating: input.rating,
        user: input.user,
        ...(input.content ? { content: input.content } : {}),
      },
      operation: 'sendMessageFeedback',
    });
  }

  async listKnowledgeDocuments(input: {
    page: number;
    limit: number;
    keyword?: string | null;
    datasetId?: string | null;
  }) {
    this.assertEnabled();
    const apiKey = this.getKnowledgeApiKey();
    const datasetId = input.datasetId || this.getDatasetId();
    const params = new URLSearchParams({
      page: String(input.page),
      limit: String(input.limit),
    });
    if (input.keyword?.trim()) params.set('keyword', input.keyword.trim());

    return this.getJson<Record<string, any>>({
      path: `/v1/datasets/${datasetId}/documents?${params.toString()}`,
      apiKey,
      operation: 'listKnowledgeDocuments',
    });
  }

  async uploadKnowledgeDocument(input: DifyUploadDocumentInput) {
    this.assertEnabled();
    const apiKey = this.getKnowledgeApiKey();
    const datasetId = this.getDatasetId();

    const form = new FormData();
    form.append(
      'data',
      JSON.stringify({
        indexing_technique: process.env.DIFY_KNOWLEDGE_INDEXING_TECHNIQUE ??
          'high_quality',
        process_rule: {
          mode: process.env.DIFY_KNOWLEDGE_PROCESS_RULE_MODE ?? 'automatic',
        },
      }),
    );
    form.append('file', input.file.buffer, {
      filename: input.file.originalname,
      contentType: input.file.mimetype,
      knownLength: input.file.size,
    });

    try {
      const response = await firstValueFrom(
        this.httpService.post(
          `${this.baseUrl}/v1/datasets/${datasetId}/document/create-by-file`,
          form,
          {
            headers: {
              Authorization: `Bearer ${apiKey}`,
              ...form.getHeaders(),
            },
            timeout: this.timeoutMs,
            maxBodyLength: Infinity,
            maxContentLength: Infinity,
          },
        ),
      );
      return response.data as Record<string, any>;
    } catch (error: any) {
      throw this.toDifyError('uploadKnowledgeDocument', error);
    }
  }

  async createKnowledgeDocumentByText(input: DifyCreateDocumentByTextInput) {
    this.assertEnabled();
    const apiKey = this.getKnowledgeApiKey();

    return this.postJson<Record<string, any>>({
      path: `/v1/datasets/${input.datasetId}/document/create-by-text`,
      apiKey,
      operation: 'createKnowledgeDocumentByText',
      body: {
        name: input.name,
        text: input.text,
        indexing_technique:
          process.env.DIFY_KNOWLEDGE_INDEXING_TECHNIQUE ?? 'high_quality',
        ...this.buildProcessRuleBody(),
      },
    });
  }

  /**
   * El "doc_form" es una propiedad fija por dataset en Dify (Parent-child /
   * Jerarquico vs. General). Si no coincide con lo que espera el dataset,
   * Dify responde 400 "doc_form is different from the dataset doc_form".
   * Todos los datasets configurados de Fenix estan en modo Parent-child, asi
   * que por defecto usamos hierarchical_model. Se puede volver a text_model
   * con DIFY_KNOWLEDGE_DOC_FORM=text_model si algun dataset futuro no usa
   * fragmentacion jerarquica.
   */
  private buildProcessRuleBody(): {
    doc_form: DifyDocForm;
    process_rule: Record<string, any>;
  } {
    const docForm = (process.env.DIFY_KNOWLEDGE_DOC_FORM ??
      'hierarchical_model') as DifyDocForm;

    const preProcessingRules = [
      { id: 'remove_extra_spaces', enabled: true },
      { id: 'remove_urls_emails', enabled: false },
    ];

    if (docForm === 'hierarchical_model') {
      return {
        doc_form: docForm,
        process_rule: {
          mode: 'hierarchical',
          rules: {
            pre_processing_rules: preProcessingRules,
            // Nivel padre: un chunk padre por subseccion "### ...", para que
            // el asistente reciba el bloque completo del tema al recuperar.
            segmentation: {
              separator: process.env.DIFY_KNOWLEDGE_SEGMENT_SEPARATOR ?? '\n###',
              max_tokens: Number(process.env.DIFY_KNOWLEDGE_SEGMENT_MAX_TOKENS ?? '800'),
            },
            parent_mode: process.env.DIFY_KNOWLEDGE_PARENT_MODE ?? 'paragraph',
            // Nivel hijo: fragmentos mas pequenos dentro de cada padre, usados
            // para el matching semantico en la busqueda.
            subchunk_segmentation: {
              separator: process.env.DIFY_KNOWLEDGE_SUBCHUNK_SEPARATOR ?? '\n',
              max_tokens: Number(process.env.DIFY_KNOWLEDGE_SUBCHUNK_MAX_TOKENS ?? '200'),
            },
          },
        },
      };
    }

    return {
      doc_form: docForm,
      process_rule: {
        mode: 'custom',
        rules: {
          pre_processing_rules: preProcessingRules,
          segmentation: {
            separator: process.env.DIFY_KNOWLEDGE_SEGMENT_SEPARATOR ?? '\n###',
            max_tokens: Number(process.env.DIFY_KNOWLEDGE_SEGMENT_MAX_TOKENS ?? '800'),
          },
        },
      },
    };
  }

  async getKnowledgeDocumentIndexingStatus(input: {
    datasetId: string;
    batch: string;
  }): Promise<{ data: DifyIndexingStatusEntry[] }> {
    this.assertEnabled();
    const apiKey = this.getKnowledgeApiKey();

    return this.getJson<{ data: DifyIndexingStatusEntry[] }>({
      path: `/v1/datasets/${input.datasetId}/documents/${input.batch}/indexing-status`,
      apiKey,
      operation: 'getKnowledgeDocumentIndexingStatus',
    });
  }

  /**
   * Dify indexa el documento en segundo plano (waiting -> parsing -> cleaning
   * -> splitting -> indexing -> completed/error). Con parent-child esto puede
   * tardar mas que con el modo General por el paso adicional de sub-chunks.
   * Hay que esperar a "completed" antes de poder deshabilitarlo (enable/disable
   * fallan con 400 "is not completed" mientras sigue indexando).
   */
  async waitForKnowledgeDocumentIndexing(input: {
    datasetId: string;
    batch: string;
    documentId: string;
  }): Promise<void> {
    const pollIntervalMs = Number(
      process.env.ASSISTANT_KNOWLEDGE_INDEXING_POLL_INTERVAL_MS ?? '3000',
    );
    const timeoutMs = Number(
      process.env.ASSISTANT_KNOWLEDGE_INDEXING_TIMEOUT_MS ?? '120000',
    );
    const startedAt = Date.now();

    for (;;) {
      const response = await this.getKnowledgeDocumentIndexingStatus({
        datasetId: input.datasetId,
        batch: input.batch,
      });
      const entries = response.data ?? [];
      const entry =
        entries.find((item) => item.id === input.documentId) ?? entries[0];

      if (entry?.indexing_status === 'completed') return;

      if (entry?.indexing_status === 'error') {
        throw new BadRequestException(
          `Dify no pudo indexar el documento: ${entry.error ?? 'error desconocido'}`,
        );
      }

      if (Date.now() - startedAt >= timeoutMs) {
        throw new BadRequestException(
          `El documento sigue indexandose en Dify despues de ${Math.round(
            timeoutMs / 1000,
          )}s (estado: ${entry?.indexing_status ?? 'desconocido'}). Revisa el dataset en Dify antes de reintentar.`,
        );
      }

      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }
  }

  async updateKnowledgeDocumentStatus(input: {
    datasetId: string;
    documentId: string;
    action: 'enable' | 'disable' | 'archive' | 'un_archive';
  }) {
    this.assertEnabled();
    const apiKey = this.getKnowledgeApiKey();

    return this.patchJson<Record<string, any>>({
      path: `/v1/datasets/${input.datasetId}/documents/status/${input.action}`,
      apiKey,
      operation: `knowledgeDocumentStatus:${input.action}`,
      body: {
        document_ids: [input.documentId],
      },
    });
  }

  private async postJson<T>(input: {
    path: string;
    apiKey: string;
    body: unknown;
    operation: string;
  }): Promise<T> {
    try {
      const response = await firstValueFrom(
        this.httpService.post(`${this.baseUrl}${input.path}`, input.body, {
          headers: {
            Authorization: `Bearer ${input.apiKey}`,
            'Content-Type': 'application/json',
          },
          timeout: this.timeoutMs,
        }),
      );
      return response.data as T;
    } catch (error: any) {
      throw this.toDifyError(input.operation, error);
    }
  }

  private async getJson<T>(input: {
    path: string;
    apiKey: string;
    operation: string;
  }): Promise<T> {
    try {
      const response = await firstValueFrom(
        this.httpService.get(`${this.baseUrl}${input.path}`, {
          headers: {
            Authorization: `Bearer ${input.apiKey}`,
          },
          timeout: this.timeoutMs,
        }),
      );
      return response.data as T;
    } catch (error: any) {
      throw this.toDifyError(input.operation, error);
    }
  }

  private async patchJson<T>(input: {
    path: string;
    apiKey: string;
    body: unknown;
    operation: string;
  }): Promise<T> {
    try {
      const response = await firstValueFrom(
        this.httpService.patch(`${this.baseUrl}${input.path}`, input.body, {
          headers: {
            Authorization: `Bearer ${input.apiKey}`,
            'Content-Type': 'application/json',
          },
          timeout: this.timeoutMs,
        }),
      );
      return response.data as T;
    } catch (error: any) {
      throw this.toDifyError(input.operation, error);
    }
  }

  private assertEnabled() {
    if ((process.env.ASSISTANT_ENABLED ?? 'false').toLowerCase() !== 'true') {
      throw new ServiceUnavailableException('Assistant is disabled');
    }
  }

  private getAppApiKey() {
    const apiKey = process.env.DIFY_APP_API_KEY;
    if (!apiKey) {
      throw new ServiceUnavailableException('DIFY_APP_API_KEY is missing');
    }
    return apiKey;
  }

  private getKnowledgeApiKey() {
    const apiKey = process.env.DIFY_KNOWLEDGE_API_KEY ?? process.env.DIFY_APP_API_KEY;
    if (!apiKey) {
      throw new ServiceUnavailableException(
        'DIFY_KNOWLEDGE_API_KEY or DIFY_APP_API_KEY is missing',
      );
    }
    return apiKey;
  }

  private getDatasetId() {
    const datasetId = process.env.DIFY_KNOWLEDGE_DATASET_ID;
    if (!datasetId) {
      throw new ServiceUnavailableException(
        'DIFY_KNOWLEDGE_DATASET_ID is missing',
      );
    }
    return datasetId;
  }

  private toDifyError(operation: string, error: any) {
    const status = error?.response?.status;
    const data = error?.response?.data;
    const providerMessage =
      data?.message ?? data?.error ?? error?.message ?? 'Unknown Dify error';
    this.logger.error(
      `Dify request failed operation=${operation} status=${status ?? 'unknown'} message=${providerMessage}`,
    );
    return new DifyRequestError(
      `Dify ${operation} failed: ${providerMessage}`,
      status,
      providerMessage,
    );
  }
}
