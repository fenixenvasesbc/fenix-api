# Contratos SPA relevantes

## Objetivo

Documentar contratos consumidos directamente por la SPA cuando una feature necesita reglas de negocio del backend. La SPA debe tratar estos contratos como la fuente segura y no llamar proveedores externos con credenciales.

## Nueva conversacion WhatsApp

Feature SPA:

- modulo: `app/dashboard/messages/page.tsx`;
- accion: boton `Nueva conversacion`;
- comportamiento: buscar lead existente, crear lead si no existe y enviar plantilla para iniciar conversacion.

### `GET /outbound/templates`

Uso SPA:

- cargar panel de seleccion de plantillas;
- buscar por nombre/cuerpo;
- filtrar por categoria;
- filtrar por idioma;
- paginar cuando hay muchas plantillas.

Regla:

- la API consulta YCloud;
- la SPA no conoce ni recibe la API key;
- por defecto se muestran plantillas `APPROVED`.
- si la plantilla trae header media en YCloud, la respuesta incluye `headerMedia` y `requiresHeaderMedia`.
- la SPA no pide la imagen: la API usa la URL que viene en los `components` de YCloud al enviar.

Tipos SPA:

- `WhatsappTemplate`;
- `WhatsappTemplatesResponse`.

### `POST /conversations/start`

Uso SPA:

- iniciar una conversacion desde telefono y pais;
- abrir conversacion existente si ya hay lead;
- crear lead nuevo si no existe;
- enviar plantilla cuando no hay ventana 24h abierta.

Tipos SPA:

- `StartConversationRequest`;
- `StartConversationResponse`.

Payload principal:

```json
{
  "accountId": "uuid-opcional-para-admin",
  "countryCode": "34",
  "phoneNumber": "612345678",
  "name": "Cliente opcional",
  "templateName": "nombre_template",
  "languageCode": "es_ES",
  "clientRequestId": "uuid"
}
```

Respuesta principal:

```json
{
  "data": {
    "lead": {},
    "conversation": {},
    "policy": {},
    "sentMessage": {}
  }
}
```

## Regla de ventana WhatsApp

La SPA no decide si puede enviar texto libre fuera de ventana. La API devuelve `policy` y bloquea en backend:

- `canSendFreeform`;
- `canSendTemplate`;
- `requiresTemplate`.

Si `requiresTemplate = true`, la SPA debe seleccionar plantilla y llamar `/conversations/start` con `templateName`.

## Plantillas con header media

Cuando YCloud devuelve una plantilla con componente `HEADER` de formato `IMAGE`, `VIDEO` o `DOCUMENT`, la API:

1. Extrae la primera URL disponible dentro del componente.
2. Devuelve esa informacion en `WhatsappTemplate.headerMedia`.
3. Al enviar la plantilla, vuelve a resolver la metadata en backend por `name + language`.
4. Construye automaticamente el componente:

```json
{
  "type": "header",
  "parameters": [
    {
      "type": "image",
      "image": {
        "link": "https://..."
      }
    }
  ]
}
```

La SPA solo selecciona la plantilla; no debe pedir ni enviar la URL del header como dato de confianza.

## Notificaciones de campanita

La SPA debe consumir las notificaciones desde la API. Las reglas de negocio y los umbrales viven en backend.

### `GET /notifications`

Uso SPA:

- cargar la campanita;
- mostrar alertas pendientes por cuenta;
- permitir ver historico si se consulta `status=ALL` o `status=READ`.

Query:

```txt
accountId=uuid   # requerido para ADMIN, ignorado para SALES si coincide con su cuenta
status=UNREAD    # UNREAD | READ | ALL
limit=50         # maximo 200
```

Respuesta:

```json
{
  "data": [
    {
      "id": "uuid",
      "accountId": "uuid",
      "leadId": "uuid",
      "type": "LABEL_STALE",
      "status": "UNREAD",
      "severity": "WARNING",
      "title": "Cliente lleva 7 dias en Muestras",
      "message": "El lead Cliente permanece en Muestras...",
      "label": "MUESTRAS",
      "triggeredAt": "2026-07-17T05:00:00.000Z",
      "readAt": null,
      "metadata": {},
      "lead": {
        "id": "uuid",
        "displayName": "Cliente",
        "displayNameSource": "whatsappContactName"
      }
    }
  ],
  "unreadCount": 1
}
```

### `POST /notifications/:notificationId/read`

Marca una alerta como leida y devuelve la alerta actualizada.

### `POST /notifications/read-all`

Marca todas las alertas no leidas de la cuenta como leidas.

### Eventos realtime

El backend publica eventos por cuenta:

- `notification.created`;
- `notification.updated`.

La SPA puede usarlos para refrescar el contador de la campanita sin recargar toda la pantalla.
