import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { DifyClient } from '../dify.client';
import { RagLlmClient } from './rag-llm.client';

/**
 * Orquestador RAG nativo de Fenix: reimplementa en código propio (fenix-api)
 * el workflow "v5" que antes vivía como Chatflow en Dify (ver
 * claude/rag-adaptativo-v2-arquitectura-corregida.md en el proyecto Fenix
 * para el histórico completo del diseño y los bugs encontrados en Dify).
 *
 * Motivación: Dify mostró un bug de entrega de respuesta no diagnosticado
 * (el workflow calculaba bien la respuesta pero la UI/API de chat de Dify no
 * la entregaba, tanto en Preview como en la Web App de producción). Esta
 * implementación llama al LLM directamente desde fenix-api y sigue usando el
 * Knowledge Base de Dify SOLO para la recuperación (retrieval) de los 4
 * datasets ya indexados — no se usa el Chatflow ni el endpoint de chat de
 * Dify en ningún punto de este archivo.
 *
 * Flujo (replica fiel del grafo v5, sin los nodos "FLATTEN" de Dify porque
 * aquí parseamos JSON estructurado directamente en TypeScript):
 *
 *  1. RESOLVER Y PLANIFICAR EVIDENCIA (LLM, salida estructurada): resuelve
 *     referencias anafóricas usando el historial de la sesión y decide qué
 *     fuentes documentales son necesarias.
 *     -> si clarification_required: devuelve la pregunta de aclaración y
 *        termina (equivalente a SOLICITAR ACLARACION).
 *  2. Recuperación por fuente (paralelo, solo las fuentes marcadas como
 *     "required") contra el Knowledge Retrieval API de Dify.
 *  3. EVALUAR SUFICIENCIA (regla, no LLM): igual que en Dify, solo mira si
 *     hay evidencia no vacía y de longitud mínima, más la señal
 *     requires_clarification del paso 1. Limitación conocida (heredada del
 *     diseño original): no puede detectar si la evidencia es temáticamente
 *     incorrecta aunque no esté vacía.
 *  4. Según next_action:
 *     - responder: sigue directo a generación.
 *     - buscar_mas: recuperación correctiva (reintenta con la pregunta
 *       resuelta contra las 4 fuentes) + EVALUACION FINAL (LLM).
 *     - full_doc: recupera el catálogo completo (metadata filter) +
 *       EVALUACION FINAL (LLM).
 *     - aclarar: se abstiene pidiendo aclaración.
 *  5. GENERAR RESPUESTA GROUNDED (LLM, texto libre).
 *  6. VALIDACION LIGERA condicional: se salta (igual que IF/ELSE 11 +
 *     ANSWER SIN VALIDACION en Dify) cuando la pregunta es de una sola
 *     fuente y no exhaustiva; en cualquier otro caso valida con un LLM
 *     adicional antes de responder.
 */

type ConversationTurn = { role: 'user' | 'assistant'; content: string };

type SourceKey =
  | 'catalogo_medidas'
  | 'producto_impresion'
  | 'operaciones_facturacion'
  | 'general';

type PlanResult = {
  resolved_question: string;
  clarification_required: boolean;
  clarification_question: string | null;
  requires_clarification: boolean;
  requires_exhaustive_retrieval: boolean;
  catalogo_medidas_required: boolean;
  catalogo_medidas_query: string | null;
  producto_impresion_required: boolean;
  producto_impresion_query: string | null;
  operaciones_facturacion_required: boolean;
  operaciones_facturacion_query: string | null;
  general_required: boolean;
  general_query: string | null;
};

type RetrievedRecord = {
  sourceKey: SourceKey;
  datasetId: string;
  documentId: string;
  documentName: string | null;
  segmentId: string;
  score: number;
  content: string;
};

export type RagAnswerResult = {
  answer: string;
  abstained: boolean;
  clarificationRequested: boolean;
  nextAction: 'responder' | 'buscar_mas' | 'full_doc' | 'aclarar';
  sourcesUsed: SourceKey[];
  citations: Array<{
    providerResourceId: string | null;
    datasetId: string | null;
    documentId: string | null;
    documentName: string | null;
    segmentId: string | null;
    score: number | null;
    excerpt: string | null;
    metadata: Record<string, unknown>;
  }>;
  usage: {
    plan?: Record<string, any> | null;
    evaluateFinal?: Record<string, any> | null;
    generate?: Record<string, any> | null;
    validate?: Record<string, any> | null;
    // Agregado de las 4 llamadas anteriores + costo estimado. Nombres de
    // campo elegidos para calzar con lo que la SPA ya lee de "usage" (antes
    // venía calculado por Dify): total_price/currency en
    // formatUsagePrice() de assistant-floating-chat.tsx y
    // app/dashboard/asistente/page.tsx.
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    total_price?: string;
    currency?: string;
  };
  model: string;
  singleSourceQuery: boolean;
  validationSkipped: boolean;
};

const SOURCES: Array<{ key: SourceKey; label: string }> = [
  { key: 'catalogo_medidas', label: 'Catalogo y medidas' },
  { key: 'producto_impresion', label: 'Producto e impresion' },
  { key: 'operaciones_facturacion', label: 'Operaciones y facturacion' },
  { key: 'general', label: 'Base del agente' },
];

const ABSTAIN_INSUFFICIENT_EVIDENCE_TEXT =
  'No puedo responder con seguridad porque la evidencia documental disponible no es suficiente o no cubre el alcance de la consulta.';

const ABSTAIN_VALIDATION_FAILED_TEXT =
  'No puedo confirmar que la respuesta este respaldada por la evidencia documental disponible. Por precaucion, me abstengo de darla como definitiva; por favor reformula o precisa la pregunta.';

// Precio estimado por token, usado solo para mostrar un costo aproximado en
// la UI (la SPA ya leía esto de Dify antes de esta migración). OpenAI no
// entrega precio en la respuesta de la API como sí hacía Dify — se calcula
// aquí a partir de los tokens reales que reporta cada llamada. Los valores
// por defecto corresponden a gpt-4.1 (USD por 1M de tokens) al momento de
// esta implementación; si cambian los precios de OpenAI o el modelo
// configurado en RAG_LLM_MODEL, ajustar via las variables de entorno en vez
// de tocar código.
const PRICE_INPUT_PER_1M_TOKENS = Number(
  process.env.RAG_LLM_PRICE_INPUT_PER_1M ?? '2.00',
);
const PRICE_OUTPUT_PER_1M_TOKENS = Number(
  process.env.RAG_LLM_PRICE_OUTPUT_PER_1M ?? '8.00',
);
const PRICE_CURRENCY = process.env.RAG_LLM_PRICE_CURRENCY ?? 'USD';

@Injectable()
export class RagOrchestratorService {
  private readonly logger = new Logger(RagOrchestratorService.name);

  private readonly topK = Number(process.env.RAG_TOP_K ?? '8');
  private readonly topKFullDoc = Number(process.env.RAG_TOP_K_FULL_DOC ?? '10');
  private readonly minEvidenceChars = Number(process.env.RAG_MIN_EVIDENCE_CHARS ?? '40');
  private readonly fullDocMetadataKey =
    process.env.RAG_CATALOGO_FULL_DOC_METADATA_KEY ?? 'document_scope';
  private readonly fullDocMetadataValue =
    process.env.RAG_CATALOGO_FULL_DOC_METADATA_VALUE ?? 'FENIX_CATALOGO_COMPLETO_V1';
  private readonly maxHistoryTurns = Number(process.env.RAG_MAX_HISTORY_TURNS ?? '6');

  // Cache en memoria del mapeo source -> dataset_id, parseado una sola vez
  // desde la variable de entorno DIFY_KNOWLEDGE_DATASETS_JSON. Formato real
  // (array de datasets, ver getDatasetsConfig() para el mapeo de "key"):
  //   [
  //     { "id": "...", "key": "base-agente", "name": "...", "description": "..." },
  //     { "id": "...", "key": "catalogo-medidas", ... },
  //     { "id": "...", "key": "operaciones-facturacion", ... },
  //     { "id": "...", "key": "producto-impresion", ... }
  //   ]
  private datasetsConfigCache: Partial<Record<SourceKey, string>> | null = null;

  constructor(
    private readonly difyClient: DifyClient,
    private readonly llm: RagLlmClient,
  ) {}

  async answer(input: {
    question: string;
    history: ConversationTurn[];
  }): Promise<RagAnswerResult> {
    const history = input.history.slice(-this.maxHistoryTurns);

    // 1. RESOLVER Y PLANIFICAR EVIDENCIA
    const { plan, usage: planUsage } = await this.resolveAndPlan(input.question, history);

    if (plan.clarification_required) {
      return this.buildClarificationResult(plan, planUsage);
    }

    const requiredSources = SOURCES.filter((source) => this.isRequired(plan, source.key));
    const singleSourceQuery = requiredSources.length === 1;

    // 2. Recuperación por fuente (paralelo)
    const initialRecords = await this.retrieveSources(requiredSources, plan);
    let evidenceRecords = initialRecords;
    let evidenceContext = this.buildEvidenceContext(evidenceRecords);

    // 3. EVALUAR SUFICIENCIA (regla)
    const nextAction = this.evaluateSufficiency(
      evidenceContext,
      plan.requires_clarification,
      plan.requires_exhaustive_retrieval,
    );

    if (nextAction === 'aclarar') {
      return this.buildClarificationResult(plan, planUsage, 'aclarar');
    }

    let finalSufficient = true;
    let evaluateFinalUsage: Record<string, any> | null = null;

    if (nextAction === 'buscar_mas' || nextAction === 'full_doc') {
      const extraRecords =
        nextAction === 'buscar_mas'
          ? await this.retrieveCorrective(plan)
          : await this.retrieveFullDoc(plan);

      evidenceRecords = this.dedupeRecords([...evidenceRecords, ...extraRecords]);
      evidenceContext = this.buildEvidenceContext(evidenceRecords);

      const evalFinal = await this.evaluateFinal(plan.resolved_question, evidenceContext);
      finalSufficient = evalFinal.data.final_sufficient;
      evaluateFinalUsage = evalFinal.usage;
    }

    if (!finalSufficient) {
      return {
        answer: ABSTAIN_INSUFFICIENT_EVIDENCE_TEXT,
        abstained: true,
        clarificationRequested: false,
        nextAction,
        sourcesUsed: requiredSources.map((s) => s.key),
        citations: this.toCitations(evidenceRecords),
        usage: {
          plan: planUsage,
          evaluateFinal: evaluateFinalUsage,
          ...this.summarizeUsage([planUsage, evaluateFinalUsage]),
        },
        model: process.env.RAG_LLM_MODEL ?? 'gpt-4.1',
        singleSourceQuery,
        validationSkipped: true,
      };
    }

    // 5. GENERAR RESPUESTA GROUNDED
    const generated = await this.generateGroundedAnswer(
      plan.resolved_question,
      evidenceContext,
      history,
    );

    // 6. Validación condicional (salto para pregunta simple, una sola
    // fuente, no exhaustiva — igual que IF/ELSE 11 en Dify).
    const skipValidation = singleSourceQuery && !plan.requires_exhaustive_retrieval;

    if (skipValidation) {
      return {
        answer: generated.text,
        abstained: false,
        clarificationRequested: false,
        nextAction,
        sourcesUsed: requiredSources.map((s) => s.key),
        citations: this.toCitations(evidenceRecords),
        usage: {
          plan: planUsage,
          evaluateFinal: evaluateFinalUsage,
          generate: generated.usage,
          ...this.summarizeUsage([planUsage, evaluateFinalUsage, generated.usage]),
        },
        model: generated.model,
        singleSourceQuery,
        validationSkipped: true,
      };
    }

    const validation = await this.validateLightly(generated.text, evidenceContext);

    return {
      answer: validation.data.valid ? generated.text : ABSTAIN_VALIDATION_FAILED_TEXT,
      abstained: !validation.data.valid,
      clarificationRequested: false,
      nextAction,
      sourcesUsed: requiredSources.map((s) => s.key),
      citations: this.toCitations(evidenceRecords),
      usage: {
        plan: planUsage,
        evaluateFinal: evaluateFinalUsage,
        generate: generated.usage,
        validate: validation.usage,
        ...this.summarizeUsage([planUsage, evaluateFinalUsage, generated.usage, validation.usage]),
      },
      model: generated.model,
      singleSourceQuery,
      validationSkipped: false,
    };
  }

  // ---------------------------------------------------------------------
  // Nodo 1: RESOLVER Y PLANIFICAR EVIDENCIA
  // ---------------------------------------------------------------------
  private async resolveAndPlan(
    question: string,
    history: ConversationTurn[],
  ): Promise<{ plan: PlanResult; usage: Record<string, any> | null }> {
    const schema = {
      type: 'object',
      additionalProperties: false,
      required: [
        'resolved_question',
        'clarification_required',
        'clarification_question',
        'requires_clarification',
        'requires_exhaustive_retrieval',
        'catalogo_medidas_required',
        'catalogo_medidas_query',
        'producto_impresion_required',
        'producto_impresion_query',
        'operaciones_facturacion_required',
        'operaciones_facturacion_query',
        'general_required',
        'general_query',
      ],
      properties: {
        resolved_question: { type: 'string' },
        clarification_required: { type: 'boolean' },
        clarification_question: { type: ['string', 'null'] },
        requires_clarification: { type: 'boolean' },
        requires_exhaustive_retrieval: { type: 'boolean' },
        catalogo_medidas_required: { type: 'boolean' },
        catalogo_medidas_query: { type: ['string', 'null'] },
        producto_impresion_required: { type: 'boolean' },
        producto_impresion_query: { type: ['string', 'null'] },
        operaciones_facturacion_required: { type: 'boolean' },
        operaciones_facturacion_query: { type: ['string', 'null'] },
        general_required: { type: 'boolean' },
        general_query: { type: ['string', 'null'] },
      },
    };

    const systemPrompt = [
      'Eres el módulo de resolución de contexto y planificación de evidencia de un asistente interno de Fenix (empresa de cajas y envases impresos).',
      'Tu tarea tiene DOS PARTES, en este orden:',
      '',
      'PARTE 1 — Resolución de referencias anafóricas:',
      '- Si la pregunta del usuario es autocontenida (no depende del historial), pasala tal cual en "resolved_question" y NUNCA marques clarification_required=true solo porque la pregunta es general, abierta o amplia — eso lo decide la Parte 2, no tú.',
      '- Si la pregunta contiene una referencia (p. ej. "esa caja", "la misma", "y para pizza?") que SÍ se puede resolver con el historial de la conversación, resuélvela y escribe la pregunta completa y autocontenida en "resolved_question".',
      '- Si la pregunta contiene una referencia que NO se puede resolver de forma inequívoca con el historial (por ejemplo, el turno anterior mencionó dos productos distintos y no está claro a cuál se refiere "esa"), marca clarification_required=true y escribe en "clarification_question" una pregunta breve y concreta para desambiguar. En ese caso no necesitas completar el resto de los campos con precisión (usa false/null razonables), no se van a usar.',
      '',
      'PARTE 2 — Planificación de fuentes documentales (solo si clarification_required=false):',
      'Hay 4 fuentes documentales disponibles. Para cada una, decide si es necesaria para responder la pregunta resuelta, y si lo es, escribe una query de búsqueda breve y específica para esa fuente (o null si no es necesaria):',
      '- catalogo_medidas: catálogo completo de medidas de cajas/productos.',
      '- producto_impresion: reglas de impresión, mínimos de pedido, colores, limitaciones de producto.',
      '- operaciones_facturacion: plazos, incidencias de envío, facturación, procesos operativos.',
      '- general: base de conocimiento general del agente (políticas internas, qué puede/no puede prometer, etc.).',
      '',
      'requires_exhaustive_retrieval=true cuando la pregunta pide una LISTA COMPLETA o el máximo/mínimo de algo dentro de un catálogo (p. ej. "¿qué medidas hay disponibles para...?", "¿cuál es la caja con mayor altura?") — en ese caso el buscador recuperará el documento completo, no solo los mejores resultados.',
      '',
      'requires_clarification=true (distinto de clarification_required) cuando, aun pudiendo planificar la búsqueda, la pregunta es demasiado vaga para producir queries útiles — señal tardía usada más adelante en el flujo, úsala con criterio conservador (por defecto false).',
      '',
      'Responde SOLO el JSON del schema.',
    ].join('\n');

    const userPrompt = [
      history.length
        ? `Historial reciente de la conversación:\n${history
            .map((turn) => `${turn.role === 'user' ? 'Usuario' : 'Asistente'}: ${turn.content}`)
            .join('\n')}`
        : 'No hay historial previo en esta conversación (primer turno).',
      '',
      `Pregunta actual del usuario: ${question}`,
    ].join('\n');

    const result = await this.llm.completeStructured<PlanResult>({
      node: 'RESOLVER Y PLANIFICAR EVIDENCIA',
      systemPrompt,
      userPrompt,
      schemaName: 'resolve_and_plan',
      schema,
    });

    return { plan: result.data, usage: result.usage };
  }

  // ---------------------------------------------------------------------
  // Resumen de uso + costo estimado (ver comentario de PRICE_INPUT/OUTPUT
  // arriba). Suma los tokens de todas las llamadas LLM hechas en esta
  // respuesta (plan, evaluateFinal, generate, validate — las que aplicaron
  // según el camino tomado) y calcula un precio aproximado en el mismo
  // formato que la SPA ya sabe leer.
  // ---------------------------------------------------------------------
  private summarizeUsage(
    usages: Array<Record<string, any> | null | undefined>,
  ): {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    total_price: string;
    currency: string;
  } {
    let promptTokens = 0;
    let completionTokens = 0;
    let totalTokens = 0;

    for (const usage of usages) {
      if (!usage) continue;
      promptTokens += Number(usage.prompt_tokens ?? 0);
      completionTokens += Number(usage.completion_tokens ?? 0);
      totalTokens += Number(
        usage.total_tokens ?? Number(usage.prompt_tokens ?? 0) + Number(usage.completion_tokens ?? 0),
      );
    }

    const price =
      (promptTokens / 1_000_000) * PRICE_INPUT_PER_1M_TOKENS +
      (completionTokens / 1_000_000) * PRICE_OUTPUT_PER_1M_TOKENS;

    return {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: totalTokens,
      total_price: price.toFixed(6),
      currency: PRICE_CURRENCY,
    };
  }

  private isRequired(plan: PlanResult, key: SourceKey): boolean {
    switch (key) {
      case 'catalogo_medidas':
        return plan.catalogo_medidas_required;
      case 'producto_impresion':
        return plan.producto_impresion_required;
      case 'operaciones_facturacion':
        return plan.operaciones_facturacion_required;
      case 'general':
        return plan.general_required;
    }
  }

  private getQueryFor(plan: PlanResult, key: SourceKey): string {
    const perSourceQuery =
      key === 'catalogo_medidas'
        ? plan.catalogo_medidas_query
        : key === 'producto_impresion'
          ? plan.producto_impresion_query
          : key === 'operaciones_facturacion'
            ? plan.operaciones_facturacion_query
            : plan.general_query;

    return (perSourceQuery && perSourceQuery.trim()) || plan.resolved_question;
  }

  private getDatasetsConfig(): Partial<Record<SourceKey, string>> {
    if (this.datasetsConfigCache) return this.datasetsConfigCache;

    const raw = process.env.DIFY_KNOWLEDGE_DATASETS_JSON;
    if (!raw) {
      throw new BadRequestException(
        'Falta configurar DIFY_KNOWLEDGE_DATASETS_JSON (JSON con los dataset_id de Dify por fuente)',
      );
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new BadRequestException('DIFY_KNOWLEDGE_DATASETS_JSON no es un JSON válido');
    }

    if (!Array.isArray(parsed)) {
      throw new BadRequestException(
        'DIFY_KNOWLEDGE_DATASETS_JSON debe ser un array de datasets [{id, key, name, description}]',
      );
    }

    // El "key" que usa el JSON real (kebab-case, definido fuera de este
    // código) no coincide con las claves internas del orquestador
    // (snake_case, ver SourceKey) — se mapean explícitamente aquí.
    const keyMap: Record<string, SourceKey> = {
      'catalogo-medidas': 'catalogo_medidas',
      'producto-impresion': 'producto_impresion',
      'operaciones-facturacion': 'operaciones_facturacion',
      'base-agente': 'general',
    };

    const config: Partial<Record<SourceKey, string>> = {};
    for (const entry of parsed as Array<Record<string, unknown>>) {
      const rawKey = typeof entry?.key === 'string' ? entry.key : null;
      const datasetId = typeof entry?.id === 'string' ? entry.id : null;
      if (!rawKey || !datasetId) continue;
      const sourceKey = keyMap[rawKey];
      if (!sourceKey) continue; // entrada desconocida, se ignora
      config[sourceKey] = datasetId;
    }

    this.datasetsConfigCache = config;
    return this.datasetsConfigCache;
  }

  private getDatasetId(source: { key: SourceKey; label: string }): string {
    const config = this.getDatasetsConfig();
    const datasetId = config[source.key];
    if (!datasetId) {
      throw new BadRequestException(
        `Falta el dataset_id de la fuente "${source.key}" (${source.label}) dentro de DIFY_KNOWLEDGE_DATASETS_JSON`,
      );
    }
    return datasetId;
  }

  // ---------------------------------------------------------------------
  // Nodo 2: recuperación por fuente
  // ---------------------------------------------------------------------
  private async retrieveSources(
    requiredSources: Array<{ key: SourceKey; label: string }>,
    plan: PlanResult,
  ): Promise<RetrievedRecord[]> {
    const results = await Promise.all(
      requiredSources.map(async (source) => {
        try {
          const datasetId = this.getDatasetId(source);
          const query = this.getQueryFor(plan, source.key);
          const response = await this.difyClient.retrieveFromDataset({
            datasetId,
            query,
            topK: this.topK,
          });
          return this.toRetrievedRecords(source.key, datasetId, response);
        } catch (error: any) {
          this.logger.error(
            `Fallo la recuperación de la fuente ${source.key}: ${error?.message ?? error}`,
          );
          return [] as RetrievedRecord[];
        }
      }),
    );

    return results.flat();
  }

  // Recuperación correctiva ("buscar_mas"): reintenta con la pregunta
  // resuelta contra las 4 fuentes (no solo las que el plan marcó como
  // requeridas), como red de seguridad cuando la evidencia inicial fue
  // insuficiente. Nota: el nodo equivalente en Dify (RECUPERACION
  // CORRECTIVA) usaba "corrective_queries" de un nodo Code basado en
  // reglas, no un LLM — aquí se simplifica reusando la pregunta resuelta,
  // documentado como limitación conocida heredada del diseño original.
  private async retrieveCorrective(plan: PlanResult): Promise<RetrievedRecord[]> {
    const results = await Promise.all(
      SOURCES.map(async (source) => {
        try {
          const datasetId = this.getDatasetId(source);
          const response = await this.difyClient.retrieveFromDataset({
            datasetId,
            query: plan.resolved_question,
            topK: this.topK,
          });
          return this.toRetrievedRecords(source.key, datasetId, response);
        } catch (error: any) {
          this.logger.error(
            `Fallo la recuperación correctiva de la fuente ${source.key}: ${error?.message ?? error}`,
          );
          return [] as RetrievedRecord[];
        }
      }),
    );
    return results.flat();
  }

  // Recuperación exhaustiva del catálogo completo ("full_doc"), filtrando
  // por el metadata document_scope=FENIX_CATALOGO_COMPLETO_V1 del dataset
  // "Catalogo y medidas" — igual que RECUPERAR FULL-DOC en Dify.
  private async retrieveFullDoc(plan: PlanResult): Promise<RetrievedRecord[]> {
    const catalogSource = SOURCES.find((s) => s.key === 'catalogo_medidas')!;
    try {
      const datasetId = this.getDatasetId(catalogSource);
      const response = await this.difyClient.retrieveFromDataset({
        datasetId,
        query: plan.resolved_question,
        topK: this.topKFullDoc,
        metadataFilter: {
          logicalOperator: 'and',
          conditions: [
            {
              name: this.fullDocMetadataKey,
              comparisonOperator: 'contains',
              value: this.fullDocMetadataValue,
            },
          ],
        },
      });
      return this.toRetrievedRecords('catalogo_medidas', datasetId, response);
    } catch (error: any) {
      this.logger.error(`Fallo la recuperación full_doc: ${error?.message ?? error}`);
      return [];
    }
  }

  private toRetrievedRecords(
    sourceKey: SourceKey,
    datasetId: string,
    response: Awaited<ReturnType<DifyClient['retrieveFromDataset']>>,
  ): RetrievedRecord[] {
    const records = Array.isArray(response?.records) ? response.records : [];
    return records
      .map((record) => ({
        sourceKey,
        datasetId,
        documentId: record.segment?.document_id ?? '',
        documentName: record.segment?.document?.name ?? null,
        segmentId: record.segment?.id ?? '',
        score: typeof record.score === 'number' ? record.score : 0,
        content: record.segment?.content ?? '',
      }))
      .filter((record) => record.content.trim().length > 0);
  }

  private dedupeRecords(records: RetrievedRecord[]): RetrievedRecord[] {
    const seen = new Set<string>();
    const out: RetrievedRecord[] = [];
    for (const record of records) {
      const key = record.segmentId || `${record.documentId}:${record.content.slice(0, 50)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(record);
    }
    return out;
  }

  // ---------------------------------------------------------------------
  // NORMALIZAR EVIDENCIA (concatenación simple, sin filtro por score —
  // igual que el nodo Code equivalente en Dify)
  // ---------------------------------------------------------------------
  private buildEvidenceContext(records: RetrievedRecord[]): string {
    return records.map((record) => record.content.trim()).join('\n\n---\n\n');
  }

  // ---------------------------------------------------------------------
  // Nodo 3: EVALUAR SUFICIENCIA (regla, no LLM — misma heurística que en
  // Dify: solo mira longitud de la evidencia + requires_clarification).
  // Limitación conocida: no detecta evidencia temáticamente incorrecta
  // aunque no esté vacía (ver Bug 6 en el histórico del proyecto).
  // ---------------------------------------------------------------------
  private evaluateSufficiency(
    evidenceContext: string,
    requiresClarification: boolean,
    requiresExhaustiveRetrieval: boolean,
  ): 'responder' | 'buscar_mas' | 'full_doc' | 'aclarar' {
    if (requiresClarification) return 'aclarar';
    if (evidenceContext.trim().length >= this.minEvidenceChars) return 'responder';
    return requiresExhaustiveRetrieval ? 'full_doc' : 'buscar_mas';
  }

  // ---------------------------------------------------------------------
  // Nodo: EVALUACION FINAL (LLM, solo se llama tras buscar_mas/full_doc)
  // ---------------------------------------------------------------------
  private async evaluateFinal(question: string, evidenceContext: string) {
    const schema = {
      type: 'object',
      additionalProperties: false,
      required: ['final_sufficient', 'reason'],
      properties: {
        final_sufficient: { type: 'boolean' },
        reason: { type: 'string' },
      },
    };

    const systemPrompt = [
      'Eres el módulo de evaluación final de evidencia de un asistente interno de Fenix.',
      'Recibes una pregunta y evidencia documental recuperada tras una búsqueda ampliada (correctiva o de catálogo completo).',
      'Decide si esa evidencia es suficiente y temáticamente correcta para responder la pregunta con seguridad, sin inventar ni asumir nada que no esté en el texto.',
      'Si la evidencia no cubre la pregunta, o solo cubre un tema relacionado pero distinto, marca final_sufficient=false.',
      'Responde SOLO el JSON del schema.',
    ].join('\n');

    const userPrompt = [
      `Pregunta: ${question}`,
      '',
      'Evidencia documental recuperada:',
      evidenceContext.trim() || '(sin evidencia)',
    ].join('\n');

    return this.llm.completeStructured<{ final_sufficient: boolean; reason: string }>({
      node: 'EVALUACION FINAL',
      systemPrompt,
      userPrompt,
      schemaName: 'evaluate_final',
      schema,
    });
  }

  // ---------------------------------------------------------------------
  // Nodo: GENERAR RESPUESTA GROUNDED
  // ---------------------------------------------------------------------
  private async generateGroundedAnswer(
    question: string,
    evidenceContext: string,
    history: ConversationTurn[],
  ) {
    const systemPrompt = [
      'Eres el asistente interno de Fenix (empresa de cajas y envases impresos). Respondes en español, de forma clara, profesional y concisa.',
      'Respondes ÚNICAMENTE con información presente en la evidencia documental que se te entrega. No inventas datos, cifras, plazos ni reglas que no estén en el texto.',
      'Si la evidencia no alcanza para una parte de la pregunta, dilo explícitamente en vez de completarlo por tu cuenta.',
      'No prometas nada que no esté respaldado literalmente por la evidencia.',
    ].join('\n');

    const userPrompt = [
      history.length
        ? `Historial reciente de la conversación:\n${history
            .map((turn) => `${turn.role === 'user' ? 'Usuario' : 'Asistente'}: ${turn.content}`)
            .join('\n')}`
        : '',
      '',
      `Pregunta: ${question}`,
      '',
      'Evidencia documental:',
      evidenceContext.trim() || '(sin evidencia)',
    ]
      .filter(Boolean)
      .join('\n');

    return this.llm.completeText({
      node: 'GENERAR RESPUESTA GROUNDED',
      systemPrompt,
      userPrompt,
    });
  }

  // ---------------------------------------------------------------------
  // Nodo: VALIDACION LIGERA (condicional, ver IF/ELSE 11 en el diseño original)
  // ---------------------------------------------------------------------
  private async validateLightly(answerText: string, evidenceContext: string) {
    const schema = {
      type: 'object',
      additionalProperties: false,
      required: ['valid', 'reason'],
      properties: {
        valid: { type: 'boolean' },
        reason: { type: 'string' },
      },
    };

    const systemPrompt = [
      'Eres el módulo de validación ligera de un asistente interno de Fenix.',
      'Recibes una respuesta ya generada y la evidencia documental que la respalda.',
      'Marca valid=false SOLO si la respuesta afirma algo que no está respaldado por la evidencia (una cifra, plazo, regla o promesa inventada o incorrecta).',
      'No seas excesivamente estricto: una respuesta que resume o reformula fielmente la evidencia es válida.',
      'Responde SOLO el JSON del schema.',
    ].join('\n');

    const userPrompt = [
      'Respuesta generada:',
      answerText,
      '',
      'Evidencia documental:',
      evidenceContext.trim() || '(sin evidencia)',
    ].join('\n');

    return this.llm.completeStructured<{ valid: boolean; reason: string }>({
      node: 'VALIDACION LIGERA',
      systemPrompt,
      userPrompt,
      schemaName: 'validate_lightly',
      schema,
    });
  }

  private buildClarificationResult(
    plan: PlanResult,
    planUsage: Record<string, any> | null = null,
    nextAction: 'aclarar' = 'aclarar',
  ): RagAnswerResult {
    return {
      answer:
        plan.clarification_question?.trim() ||
        'Necesito que precises tu pregunta para poder responderte con seguridad.',
      abstained: false,
      clarificationRequested: true,
      nextAction,
      sourcesUsed: [],
      citations: [],
      usage: { plan: planUsage, ...this.summarizeUsage([planUsage]) },
      model: process.env.RAG_LLM_MODEL ?? 'gpt-4.1',
      singleSourceQuery: false,
      validationSkipped: true,
    };
  }

  private toCitations(records: RetrievedRecord[]) {
    return records.map((record) => ({
      providerResourceId: record.segmentId || null,
      datasetId: record.datasetId || null,
      documentId: record.documentId || null,
      documentName: record.documentName,
      segmentId: record.segmentId || null,
      score: record.score,
      excerpt: record.content.slice(0, 500),
      metadata: { sourceKey: record.sourceKey },
    }));
  }
}
