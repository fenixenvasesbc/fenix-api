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

## Revocación diaria de sesiones (refresh tokens)

Las comerciales suelen dejar la pestaña del navegador abierta indefinidamente. Para forzar una recarga completa de la aplicación cada mañana (último build desplegado, estado en memoria limpio, re-login), un cron revoca todos los refresh tokens activos del sistema a una hora fija.

Endpoint manual (además del cron):

```http
POST /auth/sessions/revoke-all
```

Rol:

- `ADMIN`

Reglas funcionales:

- Revoca **todos** los refresh tokens activos del sistema (todos los usuarios, todas las cuentas), en una sola operación (`RefreshTokensService.revokeAllActive()`).
- Cron automático: `SessionRefreshScheduler`, todos los días a las 6:00 (zona horaria `Europe/Madrid` por defecto, configurable con `DAILY_SESSION_REFRESH_TIMEZONE`). Se puede desactivar sin tocar código con la variable de entorno `DAILY_SESSION_REFRESH_ENABLED=false`.
- Efecto en el cliente: no se notifica activamente a la SPA. El access token en curso sigue siendo válido hasta que caduca (`JWT_ACCESS_TTL_SECONDS`, 15 minutos por defecto); en cuanto caduca, el intento de refresh falla (el refresh token ya está revocado) y `Fenix-SPA` hace una recarga completa de la página (`window.location.href = '/'`), que lleva a la pantalla de login.
- No distingue por rol: afecta también a cuentas `ADMIN`.

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

