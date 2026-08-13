# Importación de conocimiento Dify desde Fenix

## Objetivo

Permitir que un administrador suba un PDF desde Fenix SPA, lo transforme automáticamente en Markdown optimizado para RAG, lo valide y lo cargue en el dataset correspondiente de Dify sin entrar a la consola de Dify.

## Flujo funcional

1. El admin entra a `Dashboard > Asistente`.
2. Selecciona el dataset/categoría destino.
3. Elige si quiere crear un documento nuevo o reemplazar un documento existente del mismo dataset.
4. Selecciona un PDF.
5. Pulsa `Procesar`.
6. La API:
   - extrae texto del PDF;
   - llama a OpenAI para convertirlo a Markdown RAG;
   - valida que cada bloque `###` tenga máximo `ASSISTANT_KNOWLEDGE_MAX_SUBSECTION_CHARS`;
   - si la validación pasa, sube el Markdown a Dify con `create-by-text`;
   - deshabilita el documento nuevo en Dify para dejarlo pendiente de aprobación;
   - guarda una fila en `AssistantKnowledgeImport`;
   - si es reemplazo, guarda el `documentId` y nombre del documento anterior.
7. La SPA muestra:
   - Markdown completo;
   - puntos a validar;
   - bloques demasiado largos si existen;
   - documento anterior que se reemplazará, si aplica;
   - botones `Aprobar y publicar` y `Descartar`.
8. Al aprobar:
   - la API habilita el documento nuevo en Dify usando `PATCH /v1/datasets/{dataset_id}/documents/status/enable`;
   - si era reemplazo, archiva por defecto el documento anterior para evitar conocimiento duplicado o contradictorio.
9. Al descartar:
   - si ya existía un documento pendiente en Dify, la API lo archiva;
   - el documento anterior no se toca.

## Endpoints API

```txt
GET  /assistant/knowledge/datasets
GET  /assistant/knowledge/documents
POST /assistant/knowledge/imports
POST /assistant/knowledge/imports/:importId/approve
POST /assistant/knowledge/imports/:importId/discard
```

Todos requieren usuario `ADMIN`.

## Reemplazo de documentos

El flujo de reemplazo no modifica el documento anterior al procesar el PDF. La sustitución real ocurre solo cuando el admin pulsa `Aprobar y publicar`.

Esto permite revisar el Markdown generado antes de afectar el conocimiento activo de Dify:

- `Procesar`: crea el documento nuevo en Dify como deshabilitado y registra cuál documento reemplazará.
- `Aprobar`: habilita el documento nuevo y archiva/deshabilita el anterior según configuración.
- `Descartar`: archiva el borrador nuevo y deja intacto el documento anterior.

La SPA lista los documentos del dataset seleccionado para que el admin pueda escoger:

- `Crear documento nuevo`
- `Reemplazar: <documento existente>`

## Variables de entorno

```env
ASSISTANT_ENABLED=true

DIFY_BASE_URL=https://dify-api.fenixcrm.site
DIFY_KNOWLEDGE_API_KEY=
DIFY_KNOWLEDGE_DATASETS_JSON=[{"id":"dataset-id","key":"limitaciones","name":"Limitaciones de producto","description":"Reglas y limitaciones por producto"}]

OPENAI_API_KEY=
OPENAI_RAG_TRANSFORM_MODEL=gpt-4.1-mini
OPENAI_BASE_URL=https://api.openai.com/v1

ASSISTANT_KNOWLEDGE_MAX_FILE_MB=25
ASSISTANT_KNOWLEDGE_MAX_SUBSECTION_CHARS=1000
ASSISTANT_KNOWLEDGE_TRANSFORM_RETRY_COUNT=1
ASSISTANT_KNOWLEDGE_TRANSFORM_TIMEOUT_MS=90000

DIFY_KNOWLEDGE_SEGMENT_SEPARATOR="\n###"
DIFY_KNOWLEDGE_SEGMENT_MAX_TOKENS=800
DIFY_KNOWLEDGE_REPLACE_OLD_ACTION=archive
```

Si solo hay un dataset, se puede usar el fallback:

```env
DIFY_KNOWLEDGE_DATASET_ID=
DIFY_KNOWLEDGE_DATASET_NAME=Conocimiento global
```

`DIFY_KNOWLEDGE_REPLACE_OLD_ACTION` define qué hace Fenix con el documento anterior cuando se aprueba un reemplazo:

- `archive` por defecto: recomendado, oculta el documento anterior del conocimiento activo.
- `disable`: alternativa si se prefiere dejarlo sin publicar pero no archivado.

## Reglas de validación

La API divide el Markdown generado con:

```txt
(?=^### )
```

en modo multilínea. Si un bloque supera el límite, se hace un reintento con OpenAI. Si sigue fallando, no se sube automáticamente a Dify y el import queda en `NEEDS_MANUAL_REVIEW`.

## Notas Dify

Se usa `create-by-text` con `process_rule.mode = custom` y separador `\n###`.

No se usa modo jerárquico/parent-child por problemas conocidos de indexación silenciosa vía API en algunas versiones de Dify.
