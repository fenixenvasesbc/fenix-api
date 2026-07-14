# Dashboard, media y clichés

## Dashboard

### Objetivo

Calcular métricas comerciales de respuesta por plantilla/cuenta, incluyendo primeros mensajes y reenganches.

### Endpoint general

```http
GET /dashboard/metrics/first-message-responses
```

Parámetros:

- `from`;
- `to`;
- `groupByAccount` opcional.

Reglas:

- `ADMIN` consulta global.
- `ADMIN + groupByAccount=true` agrupa por cuenta y template.
- `SALES` consulta solo su cuenta.

### Endpoint por cuenta

```http
POST /dashboard/metrics/account/first-message-responses
```

Rol:

- `ADMIN`

Uso:

- Consultar métricas de una cuenta específica enviando `accountId` en body.

## Media upload

### Objetivo

Subir archivos a YCloud para usarlos en mensajes media.

Endpoint:

```http
POST /media/upload
```

Roles:

- `ADMIN`
- `SALES`

Reglas:

- Usa `multipart/form-data`.
- Campo de archivo: `file`.
- Límite: 16 MB.
- El archivo se mantiene en memoria durante la subida.
- Se resuelve `accountId` desde el usuario.

Restricción actual:

- Para `ADMIN`, el endpoint espera que el usuario tenga contexto `accountId`; si no, rechaza.

## Clichés

### Objetivo

Gestionar clichés/productos para fábrica y permitir importación desde plan de producción PDF.

Roles permitidos:

- `ADMIN`
- `FACTORY`

### Categorías

Valores:

- `ENVIO`
- `COMBO`
- `HAMBURGUESA`
- `PIZZA`
- `LONCHEADO`
- `SOBRES`
- `BOLSAS`
- `VASOS`
- `TARTAS`

### Endpoints

| Endpoint | Método | Uso |
|---|---|---|
| `/cliches` | `POST` | Crear cliché. |
| `/cliches` | `GET` | Listar clichés. |
| `/cliches/categories` | `GET` | Listar categorías. |
| `/cliches/:id` | `GET` | Obtener cliché. |
| `/cliches/:id` | `PATCH` | Actualizar cliché. |
| `/cliches/:id` | `DELETE` | Eliminar cliché. |
| `/cliches/production-plan` | `POST` | Importar PDF de plan de producción. |

### Importación de plan de producción

Endpoint:

```http
POST /cliches/production-plan
```

Reglas:

- Usa `multipart/form-data`.
- Campo de archivo: `file`.
- Límite: 10 MB.
- Procesa PDF en memoria.

