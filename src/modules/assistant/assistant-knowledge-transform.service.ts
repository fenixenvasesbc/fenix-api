import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';

type TransformResult = {
  markdown: string;
  validationPoints: string[];
  oversizeBlocks: Array<{ index: number; length: number; heading: string }>;
  needsManualReview: boolean;
};

@Injectable()
export class AssistantKnowledgeTransformService {
  private readonly logger = new Logger(AssistantKnowledgeTransformService.name);
  private readonly maxBlockChars = Number(
    process.env.ASSISTANT_KNOWLEDGE_MAX_SUBSECTION_CHARS ?? '1000',
  );
  private readonly maxRetries = Number(
    process.env.ASSISTANT_KNOWLEDGE_TRANSFORM_RETRY_COUNT ?? '1',
  );
  private readonly timeoutMs = Number(
    process.env.ASSISTANT_KNOWLEDGE_TRANSFORM_TIMEOUT_MS ?? '90000',
  );

  constructor(private readonly httpService: HttpService) {}

  async transformPdfText(input: {
    rawText: string;
    documentName: string;
    datasetName: string;
  }): Promise<TransformResult> {
    const rawText = input.rawText.trim();
    if (!rawText) throw new BadRequestException('No text could be extracted from PDF');

    let markdown = await this.callOpenAi({
      systemPrompt: this.buildSystemPrompt(),
      userPrompt: this.buildInitialUserPrompt(input),
    });

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      const oversizeBlocks = this.findOversizeBlocks(markdown);
      if (oversizeBlocks.length === 0) {
        return {
          markdown,
          validationPoints: this.extractValidationPoints(markdown),
          oversizeBlocks,
          needsManualReview: false,
        };
      }

      if (attempt >= this.maxRetries) {
        return {
          markdown,
          validationPoints: this.extractValidationPoints(markdown),
          oversizeBlocks,
          needsManualReview: true,
        };
      }

      this.logger.warn(
        `RAG markdown has oversize blocks. retry=${attempt + 1} count=${oversizeBlocks.length}`,
      );

      markdown = await this.callOpenAi({
        systemPrompt: this.buildSystemPrompt(),
        userPrompt: this.buildRetryPrompt(markdown, oversizeBlocks),
      });
    }

    return {
      markdown,
      validationPoints: this.extractValidationPoints(markdown),
      oversizeBlocks: this.findOversizeBlocks(markdown),
      needsManualReview: true,
    };
  }

  findOversizeBlocks(markdown: string) {
    return this.splitSubsections(markdown)
      .map((block, index) => ({
        index,
        length: block.length,
        heading: block.split(/\r?\n/, 1)[0]?.trim() || `Bloque ${index + 1}`,
      }))
      .filter((block) => block.length > this.maxBlockChars);
  }

  private splitSubsections(markdown: string) {
    return markdown
      .split(/(?=^### )/m)
      .map((block) => block.trim())
      .filter(Boolean);
  }

  private async callOpenAi(input: { systemPrompt: string; userPrompt: string }) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new BadRequestException('OPENAI_API_KEY is missing');

    const model = process.env.OPENAI_RAG_TRANSFORM_MODEL ?? 'gpt-4.1-mini';
    const baseUrl = (process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1').replace(
      /\/+$/,
      '',
    );

    try {
      const response = await firstValueFrom(
        this.httpService.post(
          `${baseUrl}/chat/completions`,
          {
            model,
            temperature: 0.1,
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
        throw new Error('OpenAI returned an empty transformation');
      }

      return this.stripMarkdownFence(content.trim());
    } catch (error: any) {
      const providerMessage =
        error?.response?.data?.error?.message ?? error?.message ?? 'Unknown OpenAI error';
      this.logger.error(`OpenAI RAG transform failed: ${providerMessage}`);
      throw new BadRequestException(`No se pudo transformar el documento: ${providerMessage}`);
    }
  }

  private buildSystemPrompt() {
    return [
      'Eres un editor tecnico especializado en transformar PDFs internos en documentos Markdown optimizados para RAG.',
      'Tu tarea es reestructurar el texto extraido sin inventar informacion y sin eliminar reglas, excepciones ni advertencias.',
      'Reglas obligatorias:',
      '- No inventar informacion.',
      '- No eliminar reglas, excepciones ni advertencias del original.',
      '- Si algo es ambiguo, conservarlo y marcarlo explicitamente como "requiere validacion".',
      '- Estructurar el contenido en encabezados ## por tema/categoria/producto y ### por subseccion.',
      '- Repetir SIEMPRE el nombre del tema/producto en cada encabezado ###. Ejemplo: "### Minimo de pedido — Cajas de envio".',
      `- CRITICO: ninguna subseccion ### puede superar ${this.maxBlockChars} caracteres incluyendo el encabezado.`,
      '- Si una subseccion natural supera el limite, dividirla en varias subsecciones mas pequenas, repitiendo el nombre del tema en cada ###.',
      '- Nunca dividir a mitad de una frase o a mitad de una lista.',
      '- Las secciones globales/transversales al final del documento deben tener tambien su propio ### interno.',
      '- Extraer literalmente cifras, medidas, precios y plazos, sin parafrasear ni redondear.',
      '- Al final, incluir una seccion "## Puntos a validar" con subsecciones ### autocontenidas para cada ambiguedad o una subseccion que indique que no se detectaron puntos.',
      'Devuelve solo Markdown. No incluyas explicaciones fuera del documento.',
    ].join('\n');
  }

  private buildInitialUserPrompt(input: {
    rawText: string;
    documentName: string;
    datasetName: string;
  }) {
    return [
      `Nombre del documento: ${input.documentName}`,
      `Dataset/categoria destino: ${input.datasetName}`,
      '',
      'Texto extraido del PDF:',
      '---',
      input.rawText,
      '---',
    ].join('\n');
  }

  private buildRetryPrompt(
    markdown: string,
    oversizeBlocks: Array<{ index: number; length: number; heading: string }>,
  ) {
    return [
      `El Markdown anterior incumple el limite duro de ${this.maxBlockChars} caracteres por subseccion ###.`,
      'Divide especificamente estas subsecciones en bloques mas pequenos, autocontenidos y con el tema repetido en cada encabezado ###:',
      ...oversizeBlocks.map(
        (block) => `- ${block.heading} (${block.length} caracteres)`,
      ),
      '',
      'Devuelve el documento completo corregido. No elimines informacion.',
      '',
      markdown,
    ].join('\n');
  }

  private extractValidationPoints(markdown: string) {
    const match = markdown.match(/##\s+Puntos a validar[\s\S]*$/i);
    if (!match) return [];

    return match[0]
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => /^[-*]\s+/.test(line) || /^###\s+/.test(line))
      .map((line) => line.replace(/^[-*]\s+/, '').replace(/^###\s+/, '').trim())
      .filter(Boolean);
  }

  private stripMarkdownFence(content: string) {
    return content
      .replace(/^```(?:markdown|md)?\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();
  }
}
