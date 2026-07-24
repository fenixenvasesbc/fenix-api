import {
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

  async listKnowledgeDocuments(input: {
    page: number;
    limit: number;
    keyword?: string | null;
  }) {
    this.assertEnabled();
    const apiKey = this.getKnowledgeApiKey();
    const datasetId = this.getDatasetId();
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
