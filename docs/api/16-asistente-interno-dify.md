# Asistente interno con Dify

## Objetivo

El asistente interno permite que usuarios de Fenix consulten conocimiento global de la empresa desde la SPA sin exponer credenciales de Dify u OpenAI en el frontend.

El primer alcance es conservador:

- asistente de FAQs internas en español;
- conocimiento global en Dify;
- carga de PDFs desde Fenix solo para usuarios `ADMIN`;
- consulta disponible para `ADMIN` y `SALES`;
- sin acciones automáticas;
- sin envío de mensajes a clientes;
- sin modificaciones del CRM por parte del asistente.

## Arquitectura

```text
Fenix SPA
  -> Fenix API
    -> Dify API
      -> OpenAI
      -> Knowledge Dataset
```

La SPA nunca llama a Dify directamente. Toda llamada sale desde Fenix API.

## Variables de entorno

```env
ASSISTANT_ENABLED=true
ASSISTANT_LANGUAGE=es
ASSISTANT_TIMEOUT_MS=30000
ASSISTANT_LOG_PROMPTS=false
ASSISTANT_KNOWLEDGE_MAX_FILE_MB=25

DIFY_BASE_URL=http://host.docker.internal:32770
DIFY_APP_ID=33ac29c6-4d69-405b-ba15-e5bed0e430cf
DIFY_APP_API_KEY=***
DIFY_KNOWLEDGE_DATASET_ID=b34134ee-be65-4bd4-bc23-70c9ea57e49a

# Opcional. Si no existe, se usa DIFY_APP_API_KEY.
DIFY_KNOWLEDGE_API_KEY=***

# Opcional. Defaults conservadores.
DIFY_KNOWLEDGE_INDEXING_TECHNIQUE=high_quality
DIFY_KNOWLEDGE_PROCESS_RULE_MODE=automatic
```

Notas:

- `DIFY_BASE_URL` puede quedarse como `http://host.docker.internal:32770` porque Fenix API ya validó conectividad con Dify en la VPS.
- `DIFY_APP_API_KEY` no debe estar en la SPA.
- `DIFY_KNOWLEDGE_API_KEY` permite separar permisos de consulta y permisos de carga si Dify lo requiere.
- `ASSISTANT_LOG_PROMPTS=false` evita guardar el payload crudo de Dify por defecto.

## Endpoints

Todos requieren JWT.

### Consultar asistente

```http
POST /assistant/query
```

Roles:

- `ADMIN`
- `SALES`

Body:

```json
{
  "sessionId": "opcional-uuid",
  "accountId": "opcional-uuid",
  "question": "¿Quién puede subir documentos al conocimiento?"
}
```

Respuesta:

```json
{
  "data": {
    "sessionId": "uuid",
    "messageId": "uuid",
    "answer": "Respuesta del asistente",
    "citations": [],
    "usage": {
      "total_tokens": 205,
      "total_price": "0.0001384",
      "currency": "USD"
    },
    "latencyMs": 1826,
    "providerConversationId": "id-conversacion-dify"
  }
}
```

Reglas:

- El asistente responde en español.
- Si `sessionId` existe, se reutiliza la conversación de Dify.
- Cada pregunta y respuesta queda registrada en `AssistantMessage`.
- El coste/uso devuelto por Dify queda en `usage`.
- Las citas se guardan si Dify devuelve `metadata.retriever_resources`.

### Listar sesiones

```http
GET /assistant/sessions?limit=50
```

Roles:

- `ADMIN`
- `SALES`

Devuelve las sesiones del usuario autenticado.

### Obtener una sesión

```http
GET /assistant/sessions/:sessionId
```

Roles:

- `ADMIN`
- `SALES`

Solo el dueño de la sesión puede leerla.

### Feedback de respuesta

```http
POST /assistant/messages/:messageId/feedback
```

Roles:

- `ADMIN`
- `SALES`

Body:

```json
{
  "rating": "HELPFUL",
  "reason": "Respondió correctamente",
  "editedText": "opcional"
}
```

`rating` puede ser:

- `HELPFUL`
- `NOT_HELPFUL`

La combinación `messageId + userId` es única; si el usuario cambia su feedback, se actualiza.

### Listar documentos del conocimiento

```http
GET /assistant/knowledge/documents?page=1&limit=20&keyword=precios
```

Rol:

- `ADMIN`

Fenix API reenvía la consulta a:

```text
GET /v1/datasets/{datasetId}/documents
```

### Subir PDF al conocimiento

```http
POST /assistant/knowledge/documents
Content-Type: multipart/form-data
```

Rol:

- `ADMIN`

Campo:

```text
file=<archivo.pdf>
```

Restricciones iniciales:

- solo PDF;
- máximo por defecto: 25 MB;
- el archivo se envía directamente a Dify;
- Fenix guarda auditoría/metadata, no guarda el PDF como fuente principal.

Dify recibe:

```text
POST /v1/datasets/{datasetId}/document/create-by-file
```

con:

- `file`: archivo binario;
- `data`: JSON con `indexing_technique` y `process_rule`.

## Modelo de datos

Tablas agregadas:

- `AssistantSession`: sesión del usuario con Dify.
- `AssistantMessage`: pregunta/respuesta del asistente.
- `AssistantCitation`: fragmentos recuperados por Dify, si vienen.
- `AssistantFeedback`: evaluación de utilidad por usuario.
- `AssistantAuditEvent`: auditoría de consultas, feedback y gestión de knowledge.

## Seguridad

- Dify y OpenAI son backend-only.
- `SALES` puede consultar conocimiento, pero no puede cargar documentos.
- `ADMIN` puede consultar y administrar documentos.
- Las sesiones son privadas por usuario.
- El asistente no ejecuta acciones ni envía mensajes.
- Por defecto no se guarda el payload crudo de Dify.

## Despliegue

1. Aplicar migraciones:

```bash
docker compose exec api pnpm prisma migrate deploy
```

2. Agregar variables al `.env` de Fenix.

3. Recrear API:

```bash
docker compose up -d --build api
```

4. Validar health Dify desde Fenix:

```bash
docker compose exec api wget -qO- http://host.docker.internal:32770/health
```

5. Probar consulta desde Fenix API con JWT desde la SPA/Postman.

## Estado actual

Implementado en API:

- endpoints de consulta;
- sesiones;
- feedback;
- listado de documentos;
- subida de PDFs;
- auditoría;
- integración con Dify por variables de entorno.

Pendiente de siguiente fase:

- pantalla SPA `/dashboard/asistente`;
- panel admin de subida de PDFs desde SPA;
- visualización de citas;
- métricas agregadas de consumo por usuario/periodo.
