import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';

/**
 * Llamador genérico a OpenAI (chat/completions), reutilizando el mismo
 * patrón que ya existe en assistant-knowledge-transform.service.ts (HTTP
 * directo via HttpService, sin el SDK oficial de OpenAI). Se usa desde el
 * orquestador RAG nativo (ver rag-orchestrator.service.ts) para los 4 nodos
 * LLM que antes vivían dentro del Chatflow de Dify:
 *   - RESOLVER Y PLANIFICAR EVIDENCIA (salida estructurada)
 *   - EVALUACION FINAL (salida estructurada)
 *   - VALIDACION LIGERA (salida estructurada)
 *   - GENERAR RESPUESTA GROUNDED (texto libre)
 */
@Injectable()
export class RagLlmClient {
  private readonly logger = new Logger(RagLlmClient.name);

  private readonly baseUrl = (
    process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1'
  ).replace(/\/+$/, '');

  private readonly timeoutMs = Number(process.env.RAG_LLM_TIMEOUT_MS ?? '60000');

  constructor(private readonly httpService: HttpService) {}

  /**
   * Llama al modelo pidiendo salida estructurada (JSON Schema en modo
   * estricto: additionalProperties=false y todos los campos en "required",
   * usando uniones con null para los campos opcionales — es el único modo
   * que OpenAI garantiza que respeta el schema al 100%).
   */
  async completeStructured<T>(input: {
    node: string;
    systemPrompt: string;
    userPrompt: string;
    schemaName: string;
    schema: Record<string, any>;
    temperature?: number;
  }): Promise<{ data: T; usage: Record<string, any> | null; model: string }> {
    const apiKey = this.getApiKey();
    const model = this.getModel();

    try {
      const response = await firstValueFrom(
        this.httpService.post(
          `${this.baseUrl}/chat/completions`,
          {
            model,
            temperature: input.temperature ?? 0,
            messages: [
              { role: 'system', content: input.systemPrompt },
              { role: 'user', content: input.userPrompt },
            ],
            response_format: {
              type: 'json_schema',
              json_schema: {
                name: input.schemaName,
                strict: true,
                schema: input.schema,
              },
            },
          },
          {
            headers: {
              Authorization: `Bearer ${apiKey}`,
              'Content-Type': 'application/json',
            },
            timeout: this.timeoutMs,
          },
        ),
      );

      const content = response.data?.choices?.[0]?.message?.content;
      if (typeof content !== 'string' || !content.trim()) {
        throw new Error('El modelo devolvió una respuesta vacía');
      }

      let parsed: T;
      try {
        parsed = JSON.parse(content) as T;
      } catch {
        throw new Error('El modelo devolvió JSON inválido');
      }

      return {
        data: parsed,
        usage: response.data?.usage ?? null,
        model,
      };
    } catch (error: any) {
      throw this.toError(input.node, error);
    }
  }

  /** Llama al modelo pidiendo texto libre (usado por GENERAR RESPUESTA GROUNDED). */
  async completeText(input: {
    node: string;
    systemPrompt: string;
    userPrompt: string;
    temperature?: number;
  }): Promise<{ text: string; usage: Record<string, any> | null; model: string }> {
    const apiKey = this.getApiKey();
    const model = this.getModel();

    try {
      const response = await firstValueFrom(
        this.httpService.post(
          `${this.baseUrl}/chat/completions`,
          {
            model,
            temperature: input.temperature ?? 0,
            messages: [
              { role: 'system', content: input.systemPrompt },
              { role: 'user', content: input.userPrompt },
            ],
          },
          {
            headers: {
              Authorization: `Bearer ${apiKey}`,
              'Content-Type': 'application/json',
            },
            timeout: this.timeoutMs,
          },
        ),
      );

      const content = response.data?.choices?.[0]?.message?.content;
      if (typeof content !== 'string' || !content.trim()) {
        throw new Error('El modelo devolvió una respuesta vacía');
      }

      return {
        text: content.trim(),
        usage: response.data?.usage ?? null,
        model,
      };
    } catch (error: any) {
      throw this.toError(input.node, error);
    }
  }

  private getApiKey() {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new BadRequestException('OPENAI_API_KEY is missing');
    return apiKey;
  }

  private getModel() {
    return process.env.RAG_LLM_MODEL ?? 'gpt-4.1';
  }

  private toError(node: string, error: any) {
    const providerMessage =
      error?.response?.data?.error?.message ?? error?.message ?? 'Unknown OpenAI error';
    this.logger.error(`RAG LLM call failed node=${node} message=${providerMessage}`);
    return new BadRequestException(`Fallo el nodo ${node} del asistente: ${providerMessage}`);
  }
}
