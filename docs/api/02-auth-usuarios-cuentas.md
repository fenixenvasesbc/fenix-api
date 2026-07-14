# Autenticación, usuarios y cuentas

## Objetivo funcional

Controlar el acceso a la API, asociar usuarios comerciales a cuentas y permitir administración de cuentas/canales WhatsApp.

## Roles

| Rol | Permisos principales |
|---|---|
| `ADMIN` | Crear usuarios, gestionar cuentas, consultar cuentas/leads globales. |
| `SALES` | Trabajar sobre su cuenta asignada. |
| `FACTORY` | Gestionar módulo de clichés. |

## Flujo de login

Endpoint:

```http
POST /auth/login
```

Entrada:

- `email`
- `password`

Salida esperada:

- access token;
- refresh token;
- datos de usuario según implementación del servicio.

Reglas:

- La contraseña se valida contra `passwordHash`.
- El access token se usa en endpoints protegidos con `JwtAuthGuard`.
- El refresh token permite renovar sesión.

## Refresh token

Endpoint:

```http
POST /auth/refresh
```

Regla:

- El refresh token debe existir, no estar revocado y no estar expirado.

## Logout

Endpoint:

```http
POST /auth/logout
```

Regla:

- Revoca el refresh token recibido.

## Creación de usuarios

Solo `ADMIN`.

Endpoints:

| Endpoint | Crea |
|---|---|
| `POST /auth/admins` | Usuario `ADMIN`. |
| `POST /auth/sales` | Usuario `SALES`. |
| `POST /auth/factory` | Usuario `FACTORY`. |

## Cuentas

### Crear cuenta

Endpoint:

```http
POST /accounts/create
```

Rol:

- `ADMIN`

Reglas funcionales:

- La cuenta representa un número WhatsApp/YCloud.
- La identidad externa de cuenta es `wabaId + phoneE164`.
- Puede vincularse a un usuario `SALES`.

### Consultar cuentas

Endpoints:

| Endpoint | Rol | Uso |
|---|---|---|
| `GET /accounts` | `ADMIN` | Lista cuentas. |
| `GET /accounts/:id` | `ADMIN` | Detalle de cuenta. |
| `GET /accounts/:id/leads` | `ADMIN` | Leads de una cuenta. |
| `GET /accounts/me/profile` | `SALES` | Perfil/cuenta del comercial autenticado. |
| `GET /accounts/me/leads` | `SALES` | Leads de su cuenta. |

### Actualizar cuenta y usuario

Endpoint:

```http
PATCH /accounts/:id
```

Rol:

- `ADMIN`

Uso:

- Actualizar datos de cuenta y/o usuario asociado.

### Desactivar usuario de cuenta

Endpoint:

```http
PATCH /accounts/:id/deactivate
```

Rol:

- `ADMIN`

Uso:

- Desactiva el usuario asociado a la cuenta.

## Reglas de acceso multi-cuenta

Patrón repetido en módulos de leads, conversaciones, mensajes y outbound:

- Si el usuario es `ADMIN`, debe enviar `accountId` explícito.
- Si el usuario es `SALES`, se usa `req.user.accountId`.
- Si un `SALES` intenta enviar otro `accountId`, se rechaza con `Forbidden`.

