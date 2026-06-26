# Cliches API Contract

CRUD para gestionar los cliches fisicos de fabricacion.

## Autenticacion y roles

Todos los endpoints requieren:

```http
Authorization: Bearer <access_token>
```

Roles permitidos para `/cliches`: `ADMIN` y `FACTORY`. Los usuarios `SALES`
reciben `403 Forbidden`.

Un administrador puede crear un usuario de fabrica con:

```http
POST /auth/factory
Content-Type: application/json
Authorization: Bearer <admin_access_token>

{
  "email": "fabrica@fenixcrm.site",
  "password": "password-seguro"
}
```

## Modelo

```json
{
  "id": "e312d42f-7960-4cd0-b609-f56502823137",
  "name": "CAJA PREMIUM",
  "category": "PIZZA",
  "letter": "D1",
  "year": 2025,
  "createdAt": "2026-06-26T10:00:00.000Z",
  "updatedAt": "2026-06-26T10:00:00.000Z"
}
```

- `name`: obligatorio, maximo 160 caracteres. Se guarda recortado y en mayusculas. Puede repetirse.
- `category`: uno de `ENVIO`, `COMBO`, `HAMBURGUESA`, `PIZZA`, `LONCHEADO`, `SOBRES`, `BOLSAS`.
- `letter`: ubicacion fisica alfanumerica como `D1` o `F3`. Se guarda en mayusculas.
- `year`: entero entre `1900` y `9999`.

## Crear

```http
POST /cliches
Content-Type: application/json

{
  "name": "caja premium",
  "category": "PIZZA",
  "letter": "d1",
  "year": 2025
}
```

Respuesta: `201 Created` con el cliche creado.

## Listar y filtrar

```http
GET /cliches?page=1&limit=25&search=premium&category=PIZZA&year=2025
```

Todos los parametros son opcionales:

| Parametro  | Tipo   | Descripcion                                      |
| ---------- | ------ | ------------------------------------------------ |
| `page`     | int    | Pagina desde 1. Default: `1`.                    |
| `limit`    | int    | Elementos por pagina, de 1 a 100. Default: `25`. |
| `search`   | string | Busca parcialmente por `name` o `letter`.        |
| `category` | enum   | Filtra por categoria.                            |
| `year`     | int    | Filtra por ano.                                  |

Respuesta `200 OK`:

```json
{
  "items": [],
  "pagination": {
    "page": 1,
    "limit": 25,
    "total": 0,
    "totalPages": 0
  }
}
```

## Consultar uno

```http
GET /cliches/:id
```

Respuesta: `200 OK`. Devuelve `404 Not Found` si no existe.

## Actualizar

```http
PATCH /cliches/:id
Content-Type: application/json

{
  "name": "caja premium actualizada",
  "category": "COMBO",
  "letter": "F3",
  "year": 2026
}
```

Todos los campos son opcionales. Los campos enviados respetan las mismas
validaciones de creacion. Respuesta: `200 OK` con el registro actualizado.

## Eliminar

```http
DELETE /cliches/:id
```

Respuesta `200 OK`:

```json
{
  "id": "e312d42f-7960-4cd0-b609-f56502823137",
  "deleted": true
}
```

## Categorias

Para construir el selector del frontend sin duplicar valores:

```http
GET /cliches/categories
```

Respuesta `200 OK`:

```json
["ENVIO", "COMBO", "HAMBURGUESA", "PIZZA", "LONCHEADO", "SOBRES", "BOLSAS"]
```
