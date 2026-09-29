import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';

type TransformResult = {
  markdown: string;
  validationPoints: string[];
  oversizeBlocks: Array<{ index: number; length: number; heading: string }>;
  contentIssues: string[];
  needsManualReview: boolean;
};

@Injectable()
export class AssistantKnowledgeTransformService {
  private readonly logger = new Logger(AssistantKnowledgeTransformService.name);
  private readonly maxBlockChars = Number(
    process.env.ASSISTANT_KNOWLEDGE_MAX_SUBSECTION_CHARS ?? '1000',
  );
  // Antes en 1 reintento: con la verificacion de estructura (FAQs, secciones
  // globales con su propio ###) ademas de la de tamano, puede hacer falta mas
  // de una vuelta para que el modelo corrija todo. 2 reintentos = hasta 3
  // llamadas a OpenAI por documento en el peor caso.
  private readonly maxRetries = Number(
    process.env.ASSISTANT_KNOWLEDGE_TRANSFORM_RETRY_COUNT ?? '2',
  );
  // Subido de 90s a 120s: el prompt es mas largo y el modelo por defecto
  // (gpt-4.1, ver callOpenAi) es mas lento que gpt-4.1-mini.
  private readonly timeoutMs = Number(
    process.env.ASSISTANT_KNOWLEDGE_TRANSFORM_TIMEOUT_MS ?? '120000',
  );
  // Encabezados de secciones globales/transversales que, si el documento las
  // genera, deben llevar su propio ### interno como punto de corte (ver
  // buildSystemPrompt). Coincide en texto con la plantilla de la skill
  // rag-knowledge-transformer que se usa para transformar documentos a mano,
  // para que ambos caminos (manual y automatico via PDF) sean consistentes.
  private readonly requiredGlobalHeadings = [
    'Preguntas frecuentes globales',
    'Alertas importantes',
    'Qué no debe prometer el asistente',
    'Escalamiento',
    'Posibles contradicciones o puntos a validar',
    'Puntos a validar',
  ];

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
      const contentIssues = this.findContentIssues(markdown);
      const hasProblems = oversizeBlocks.length > 0 || contentIssues.length > 0;

      if (!hasProblems) {
        return {
          markdown,
          validationPoints: this.extractValidationPoints(markdown),
          oversizeBlocks,
          contentIssues,
          needsManualReview: false,
        };
      }

      if (attempt >= this.maxRetries) {
        return {
          markdown,
          validationPoints: this.extractValidationPoints(markdown),
          oversizeBlocks,
          contentIssues,
          needsManualReview: true,
        };
      }

      this.logger.warn(
        `RAG markdown needs correction. retry=${attempt + 1} oversizeBlocks=${oversizeBlocks.length} contentIssues=${contentIssues.length}`,
      );

      markdown = await this.callOpenAi({
        systemPrompt: this.buildSystemPrompt(),
        userPrompt: this.buildRetryPrompt(markdown, oversizeBlocks, contentIssues),
      });
    }

    return {
      markdown,
      validationPoints: this.extractValidationPoints(markdown),
      oversizeBlocks: this.findOversizeBlocks(markdown),
      contentIssues: this.findContentIssues(markdown),
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

  /**
   * Verificacion de ESTRUCTURA (no de tamano): que cada tema de producto
   * tenga al menos una subseccion de Preguntas frecuentes (la pieza clave
   * para evitar colisiones de recuperacion entre productos "gemelos", ver
   * el bug de "Cajas de combo" vs "Cajas hamburguesa"), y que las secciones
   * globales/transversales tengan su propio ### interno como punto de corte
   * en vez de quedar como un ## plano sin subsecciones.
   */
  findContentIssues(markdown: string): string[] {
    const issues: string[] = [];
    const topicBlocks = markdown
      .split(/(?=^## )/m)
      .map((block) => block.trim())
      .filter(Boolean);

    for (const block of topicBlocks) {
      const headingLine = block.split(/\r?\n/, 1)[0]?.replace(/^##\s+/, '').trim() ?? '';
      if (!headingLine) continue;

      // Secciones de encabezado del documento, sin reglas de producto propias.
      if (/^(resumen|ámbito de aplicación|ambito de aplicacion|índice temático|indice tematico)/i.test(
        headingLine,
      )) {
        continue;
      }

      const isGlobalSection = this.requiredGlobalHeadings.some((heading) =>
        headingLine.toLowerCase().startsWith(heading.toLowerCase()),
      );

      if (isGlobalSection) {
        const firstContentLine = block
          .split(/\r?\n/)
          .slice(1)
          .find((line) => line.trim().length > 0);
        if (!firstContentLine || !/^###\s+/.test(firstContentLine.trim())) {
          issues.push(
            `La sección global "${headingLine}" no tiene un ### interno como primer contenido (queda sin punto de corte propio).`,
          );
        }
        continue;
      }

      if (!/^###\s+Preguntas frecuentes/im.test(block)) {
        issues.push(
          `El tema "${headingLine}" no incluye una subsección ### Preguntas frecuentes.`,
        );
      }
    }

    return issues;
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

    // Antes 'gpt-4.1-mini'. Subida a 'gpt-4.1': esta llamada se hace pocas
    // veces (una por documento subido, no por cada pregunta de un usuario),
    // asi que el costo extra es insignificante frente al riesgo de que la
    // base de conocimiento quede mal estructurada. Ademas es el mismo modelo
    // que ya usa rag-llm.client.ts (RAG_LLM_MODEL) para el resto del flujo,
    // asi que queda consistente.
    const model = process.env.OPENAI_RAG_TRANSFORM_MODEL ?? 'gpt-4.1';
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

  /**
   * Metodologia alineada con la skill "rag-knowledge-transformer" que se usa
   * para transformar documentos a mano (ver claude/adr-005 y el historico de
   * fixes de retrieval en claude/rag-adaptativo-v2-arquitectura-corregida.md
   * del proyecto): el objetivo no es solo Markdown bien formado, es un
   * documento donde cada fragmento se pueda recuperar de forma aislada sin
   * perder contexto ni confundirse con un producto parecido.
   */
  private buildSystemPrompt() {
    return [
      'Eres un editor tecnico especializado en transformar documentos internos (extraidos de PDF)',
      'en bases de conocimiento en Markdown, optimizadas para recuperacion semantica (RAG) en Dify.',
      'Sigues la misma metodologia que ya se usa manualmente en este equipo para documentos de',
      'conocimiento: no inventar nada, no perder reglas ni excepciones, y estructurar el contenido',
      'para que cada fragmento se pueda recuperar de forma aislada sin perder contexto.',
      '',
      'REGLAS OBLIGATORIAS DE CONTENIDO:',
      '- No inventar informacion que no este en el texto extraido.',
      '- No eliminar reglas, excepciones ni advertencias del original, aunque parezcan menores.',
      '- Si algo es ambiguo o incompleto, conservarlo tal cual y marcarlo explicitamente como',
      '  "requiere validacion" en una subseccion "### Puntos a validar" del tema correspondiente.',
      '- Extraer literalmente cifras, medidas, precios y plazos, sin parafrasear ni redondear.',
      '- Repetir SIEMPRE el nombre del tema/producto en cada encabezado ###. Nunca uses referencias',
      '  vagas como "esto", "lo anterior" o "dicho producto": cada subseccion debe entenderse por si',
      '  sola si se recupera de forma aislada, sin el resto del documento como contexto.',
      '',
      'ESTRUCTURA OBLIGATORIA:',
      '- Un encabezado ## por cada tema/producto/categoria real del documento.',
      '- Dentro de cada ##, subsecciones ### segun el contenido disponible (Descripcion, Gramaje,',
      '  Plazos, Minimo de pedido, Impresion, Limitaciones de diseno, Reglas de color, etc.) - omite',
      '  las que no tengan contenido real, nunca las rellenes con informacion inventada.',
      '- Cada ## de producto DEBE incluir al menos una subseccion "### Preguntas frecuentes" (con el',
      '  nombre del producto repetido en el encabezado) con 2 a 4 preguntas realistas que haria un',
      '  comercial, con respuestas basadas estrictamente en el texto extraido. Esta seccion es',
      '  critica: es la que mas ayuda al sistema de recuperacion a distinguir productos con datos',
      '  parecidos.',
      '- Si el tema lo amerita, agrega tambien "### Casos de uso — <nombre del producto>" con 1 o 2',
      '  ejemplos breves de pregunta de cliente + respuesta recomendada.',
      '',
      'DETECCION DE PRODUCTOS "GEMELOS" (CRITICO, no lo omitas):',
      '- Si detectas dos o mas ## de producto con redaccion casi identica y los mismos umbrales',
      '  numericos o casi (por ejemplo, dos productos distintos que comparten exactamente las',
      '  mismas cantidades minimas de impresion), es una situacion de alto riesgo de colision de',
      '  recuperacion: el sistema puede confundir un producto con otro al buscar y responder con el',
      '  dato equivocado.',
      '- En ese caso, para CADA uno de los productos gemelos, sin excepcion: agrega una nota',
      '  explicita de desambiguacion en su "### Descripcion" nombrando al otro producto y aclarando',
      '  que son productos distintos aunque compartan cifras; agrega una subseccion ### dedicada,',
      '  con el nombre del producto en el titulo, para el dato que comparten (por ejemplo',
      '  "### Impresion a dos colores — <nombre del producto>"); y agrega en "### Preguntas',
      '  frecuentes" una pregunta especifica que mencione el nombre del producto y el umbral exacto,',
      '  de forma que cada producto tenga su propio fragmento recuperable sin depender del otro.',
      '',
      `LIMITE DE TAMANO (obligatorio): ninguna subseccion ### puede superar ${this.maxBlockChars}`,
      'caracteres incluyendo el encabezado. Si una subseccion natural lo supera, dividela en varias',
      'subsecciones mas pequenas, repitiendo el nombre del tema en cada ### nueva. Nunca dividas a',
      'mitad de una frase o de una lista.',
      '',
      'SECCIONES GLOBALES/TRANSVERSALES: si el documento tiene contenido que aplica a varios temas a',
      'la vez (alertas generales, reglas que el asistente nunca debe romper, cuando escalar a una',
      'persona, preguntas frecuentes que mezclan varios productos), agregalas al final como sus',
      'propios ## (por ejemplo "## Alertas importantes"), pero cada una de esas secciones ## DEBE',
      'llevar inmediatamente debajo un ### con el mismo nombre (o equivalente) como primer',
      'contenido, para que sirva de punto de corte propio - una seccion ## global sin ningun ###',
      'interno se fusiona mal con la seccion anterior al trocear el documento en Dify.',
      '',
      'Al final del documento, incluye siempre una seccion "## Puntos a validar" con su propio ###',
      'interno, listando cualquier ambiguedad o dato incompleto detectado (o una subseccion que',
      'indique explicitamente que no se detectaron puntos).',
      '',
      'Devuelve solo el documento en Markdown. No incluyas explicaciones fuera del documento, ni',
      'texto envolvente como "Aqui tienes el documento".',
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
    contentIssues: string[],
  ) {
    const lines = ['El Markdown anterior tiene los siguientes problemas que debes corregir:', ''];

    if (oversizeBlocks.length > 0) {
      lines.push(
        `1. Incumple el limite duro de ${this.maxBlockChars} caracteres por subseccion ###.`,
        '   Divide especificamente estas subsecciones en bloques mas pequenos, autocontenidos y',
        '   con el tema repetido en cada encabezado ### nuevo:',
        ...oversizeBlocks.map((block) => `   - ${block.heading} (${block.length} caracteres)`),
        '',
      );
    }

    if (contentIssues.length > 0) {
      lines.push(
        '2. Faltan elementos obligatorios de estructura (ver reglas del system prompt sobre',
        '   Preguntas frecuentes, productos gemelos y secciones globales con ### propio):',
        ...contentIssues.map((issue) => `   - ${issue}`),
        '',
      );
    }

    lines.push(
      'Devuelve el documento COMPLETO corregido (no un resumen ni solo las partes que cambiaste).',
      'No elimines ni resumas informacion que ya estaba correcta.',
      '',
      markdown,
    );

    return lines.join('\n');
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
