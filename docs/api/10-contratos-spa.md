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
