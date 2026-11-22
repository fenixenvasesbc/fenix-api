# Flujos de n8n de captación: reparto de leads y envío de plantillas

Documenta los dos workflows de n8n que llevan un lead de Meta hasta Fenix. Analizados a partir de los JSON exportados el 22/nov/2026 (`Reparto Leads` y `Envio Plantillas 2026`, ambos activos). La atribución de campañas que se apoya en ellos está en [19](./19-atribucion-campanas-roi.md).

## Visión general

```
Meta (formularios / landings)
  └─► Google Sheets "Reparto de leads" › pestaña Leads        (Nombre, WhastApp, Mensaje, Producto)
        │
        ▼  n8n "Reparto Leads" — lunes a viernes 10:00
  Google Sheets "Envío Plantillas" › 1 pestaña por comercial  (fila con Enviado = "No")
  Google Sheets "Reparto de leads" › Totales / Total Asignado (contadores del día)
        │
        ▼  n8n "Envio Plantillas 2026" — 1 ramal por comercial, 10:10–11:30
  YCloud POST /v2/whatsapp/messages/sendDirectly             (plantilla de la campaña)
        │ OK                                   │ error
        ▼                                      ▼
  Fenix POST /events/outbound/accepted     Fila marcada "Fallido" + Error en la hoja.
  + fila marcada "Enviado = Sí"            NO se llama a Fenix.
```

Ambos workflows tienen como error workflow "🚨 Alertas Errores n8n" (`DqB25n5Mg9QT6hRwchdR9`).

## 1. Reparto Leads

| Paso | Nodo | Qué hace |
|---|---|---|
| Disparo | `Schedule Trigger` | Cron `0 0 10 * * 1-5`: **lunes a viernes a las 10:00** (zona de la instancia, Europe/Paris = hora de España). |
| Lectura | `GS Origen - Leads`, `GS Origen - Config` | Lee **todas** las filas de la pestaña Leads y la configuración de comerciales (`Activo XX` / `Peso XX` por segmento). |
| Segmento | `Detectar + Contar + Asignar` | `detectSegment(Producto)`, por subcadenas y en este orden: `tarta` → TART; `francia` → FR; `italia` → IT; `suiza`/`sui` → SUI; `alemania` → DE; `españa` → ES; si no coincide ninguna → **ES**. |
| Reparto | ídem | Por segmento: baraja los leads y asigna con la lógica del ODS, `ROUND(total × peso / Σpesos)` más un ajuste exacto (las faltas van al que tiene menos, las sobras se quitan al que tiene más). Sin comerciales activos → `SIN_ASIGNAR`. DE no tiene columnas en Config, así que sus leads quedan `SIN_ASIGNAR`. |
| Salida | `GS Destino - Append por Comercial` | Añade una fila en la pestaña del comercial del libro **"Envío Plantillas"**: `Nombre`, `Teléfono` (= WhastApp), `Cantidad` (= Mensaje), `Campaña` (= Producto), `Fecha` (= `FechaAsignacion`, ISO UTC de la ejecución) y `Enviado = "No"`. |
| Contadores | `GS Origen - Totales (Update)`, `UpdateTotalsByComercia` → `Update row in sheet`, `Update Total Assigned` | Totales del día por país (España, Tartas, Francia, Italia, Suiza, Alemania) y tabla CAMPAÑA × comercial (LANDING, LANDING FRANCIA, LANDING ITALIA, LANDING SUIZA). `/tartas` cuenta dentro de LANDING (ES). |

Notas:
- El workflow **no borra** la pestaña Leads. El vaciado diario de la hoja se hace fuera de este flujo.
- Los leads que entran en fin de semana se reparten el lunes, que por eso concentra más volumen.
- `sui` como subcadena puede coincidir con productos que no son de Suiza.

## 2. Envio Plantillas 2026

Un ramal idéntico por comercial (19 nodos cada uno). Cada comercial tiene **su propio número de WhatsApp** (`from`), es decir, su propia cuenta en Fenix (`wabaId` + `phoneE164`).

| Comercial | Pestaña | Hora | Pausa entre envíos |
|---|---|---|---|
| Sofía | Sofía | 10:10 | 15 s |
| Verónica | Veronica | 10:20 | 15 s |
| Lidia | Lidia | 10:30 | 15 s |
| Lucía | Lucia | 10:40 | 15 s |
| Tamara | Tamara | 10:50 | 30 s |
| Conchi | Conchi | 11:00 | 20 s |
| Jessica | Jessica | 11:10 | 20 s |
| Reme | Reme | 11:20 | 20 s |
| Estefanía | Estefania | 11:30 | 15 s |
| Diana | Diana | 11:30 | 15 s |

Los triggers se disparan **todos los días**, pero solo envían filas asignadas ese día (ver el filtro), así que en la práctica solo hay envíos de lunes a viernes.

| Paso | Nodo | Qué hace |
|---|---|---|
| Plantillas | `Get Capains` | Lee la pestaña **Plantillas** de "Envío Plantillas": `Campaña` (= Producto, p. ej. `/landing-combo`) → `Plantilla`, `Idioma`, `Imagen`. Es la tabla de equivalencias campaña → plantilla. |
| Pendientes | `Get Customers` | Filas de la pestaña del comercial con `Enviado = "No"`. |
| Filtro de fecha | `Filter By Date` | `Fecha` posterior a `$now.toUTC().toISODate()`: **solo filas asignadas hoy** (fecha UTC). Una fila que no se envía su día **no se reintenta** al día siguiente. |
| Campaña → plantilla | `Match Customer Campain` | Busca `Campaña` en Plantillas (normalizada a minúsculas y sin espacios). Si no la encuentra, `Plantilla` queda vacía. |
| Bucle | `Loop Over Items` + `Wait` | De uno en uno, con la pausa de la tabla. |
| País | `Extract Country` | Por subcadena de `Campaña`: `francia` → FR, `italia` → IT, `suiza` → CH, `alemania` → DE; si no, ES. |
| Teléfono | `Formatear Número` | Normaliza a E.164 según el país (ES: 9 dígitos que empiezan por 6/7/8/9; FR: 9–10 dígitos; IT: 3… o 0…; CH y DE con prefijo **+41**). Si no cuadra, `phoneFormatted = null`. |
| Envío | `Send Message With Image` / `Without Image` (`If` según `Imagen`) | `POST https://api.ycloud.com/v2/whatsapp/messages/sendDirectly` con la plantilla, el idioma, la imagen de cabecera opcional, `from` del comercial y `to` formateado. `onError: continueRegularOutput`. |
| ¿Error? | `If` sobre `$json.error` | **Sin error** → `Edit Fields` (añade `leadName` = Nombre) → **`Post Fenix`** → `Update row in sheet` (`Enviado = "Sí"`, `Estado` = status de YCloud, `MessageId`). **Con error** → `Parse Error` → `Update Error row in sheet` (`Estado = "Fallido"`, `Error` legible y `MessageId` = requestId). **No se llama a Fenix.** |

### Body que n8n envía a Fenix (`POST /events/outbound/accepted`)

La respuesta de YCloud reenviada tal cual, más `leadName`:

```json
{ "id", "wamid", "status", "from", "to", "wabaId", "type", "template",
  "createTime", "updateTime", "pricingCategory", "leadName" }
```

No se envía `leadEmail` ni `producto`. La campaña llega a Fenix **solo a través de `template.name`**, que es la base de la atribución del doc 19.

## 3. Implicaciones para Fenix

| Situación | Hoja "Envío Plantillas" | Fenix |
|---|---|---|
| Envío aceptado por YCloud | `Enviado = Sí`, `Estado` = accepted… | Lead + mensaje + toque de captación. Si luego falla, el webhook lo pasa a `FAILED`, pero **cuenta**. |
| YCloud rechaza el envío al momento (número mal formado, plantilla vacía porque la campaña no está en Plantillas, número sin WhatsApp…) | `Estado = Fallido` + `Error` | **Nada**: n8n no llama a Fenix. El lead aparece en el reparto (y en los contadores) pero no en Fenix. |
| Fenix responde con error (400/500) en `Post Fenix` | La fila sigue `Enviado = No`, aunque el WhatsApp **sí salió** | El nodo **no tiene `onError`**: la ejecución de ese comercial se corta (salta la alerta) y **los leads siguientes de su lista ese día no se envían**. Al día siguiente el filtro de fecha los excluye. |
| Fila con la misma `Teléfono` repetida | Las actualizaciones se hacen por `Teléfono` (`matchingColumns`), así que pueden pisarse entre sí | Un lead por número y cuenta. |

Caso real (LANDING COMBO, lunes 16/11/2026): 32 leads repartidos, 1 con `Estado = Fallido` y error de YCloud `400 PARAM_MISSING "Either 'to' or 'recipient' must be provided"`, y 31 en Fenix. Ese error significa que `Formatear Número` no pudo normalizar el teléfono (`phoneFormatted = null`) y el envío salió sin destinatario. El lead **no se registró en Fenix**, que es el comportamiento esperado del flujo.

Consecuencias para conciliar con el Excel:

- **Diferencias "Excel > Fenix"** en un día: buscar en la pestaña de cada comercial de "Envío Plantillas" las filas de ese día (`Fecha`) con la campaña en cuestión y **`Estado = Fallido`**. La columna `Error` dice el motivo.
- **Desfase de un día entre el Excel y Fenix** (más un día, menos al siguiente): el envío no puede salir otro día por el filtro de fecha, así que la causa está en cómo se asigna la fecha en el Excel de estadísticas, no en n8n ni en Fenix.

## 4. Riesgos y mejoras posibles (no aplicadas)

- `Post Fenix` sin `onError`: un fallo de Fenix corta el resto de envíos del comercial ese día. Con `continueRegularOutput` y registrando el error en la hoja, se aislaría cada lead.
- Los rechazos inmediatos de YCloud no llegan a Fenix: no hay rastro en el CRM de leads repartidos que no se pudieron contactar. Se podría enviar a Fenix un evento de "fallo de envío" para que aparezcan en el reporte de captación.
- `Filter By Date` con fecha UTC: los envíos fallidos o pendientes no se reintentan nunca.
- DE se formatea con +41 (Suiza) y en el reparto queda `SIN_ASIGNAR` (no hay columnas DE en Config).
