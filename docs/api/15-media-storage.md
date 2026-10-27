# Almacenamiento local de media de WhatsApp

## Objetivo

Evitar que Fenix dependa de URLs temporales o internas de YCloud/WhatsApp para imagenes, audios, videos y documentos recibidos o sincronizados por webhooks.

Cuando un webhook trae un mensaje con `mediaUrl`, la API intenta descargar el archivo y guardarlo en un storage local compartido entre `worker` y `api`.

## Flujo funcional

### Media entrante o sincronizada por webhooks

1. YCloud envia un webhook con media:
   - `whatsapp.inbound_message.received`;
   - `whatsapp.smb.message.echoes`;
   - `whatsapp.smb.history`;
   - reconstruccion manual desde `whatsapp.message.updated`.
2. El worker crea o actualiza el `Message`.
3. Si el mensaje trae `mediaUrl`, `MessageMediaService` intenta descargar el archivo.
4. El archivo se guarda en disco local con una clave no adivinable.
5. La API reemplaza `Message.mediaUrl` por la URL propia `/media-files/...`.
6. La SPA sigue renderizando `message.mediaUrl` sin cambios.

Si la descarga falla, el mensaje no falla ni se pierde. Se conserva el `mediaUrl` original y se deja warning en logs.

### Media saliente desde la SPA

1. La SPA sube primero el archivo a `POST /media/upload`.
2. La API guarda una copia local temporal y crea un registro `MediaUpload`.
3. La API sube el archivo a YCloud y devuelve:
   - `mediaUploadId`;
   - `mediaId` de YCloud;
   - `mediaUrl` propio de Fenix;
   - metadatos de storage local.
4. La SPA llama a `POST /outbound/media` enviando `mediaUploadId`.
5. Si YCloud acepta el envio, el `Message` queda creado/aceptado y el `MediaUpload` pasa a `ATTACHED`.
6. Si falla el envio, el `Message` queda `FAILED` y el `MediaUpload` queda `FAILED` con `lastError`, conservando la referencia local/YCloud para diagnostico y reintentos internos.

Este flujo evita que un archivo subido quede sin trazabilidad cuando falla el paso de envio.

## Campos en `Message`

- `mediaUrl`: URL que usa la SPA. Si el archivo fue archivado, apunta a Fenix.
- `mediaOriginalUrl`: URL original recibida desde YCloud.
- `mediaStorageDriver`: `local` cuando el archivo esta en storage local.
- `mediaStorageKey`: ruta interna relativa dentro del storage.
- `mediaSizeBytes`: tamano guardado.
- `mediaStoredAt`: fecha en que se guardo.
- `mediaExpiresAt`: fecha en que puede eliminarse por retencion.
- `mediaExpiredAt`: fecha en que fue eliminado fisicamente.

## Tabla `MediaUpload`

Controla archivos subidos por la SPA antes de que se adjunten a un `Message`.

- `status=UPLOADED`: archivo guardado localmente y, si YCloud respondio bien, con `providerMediaId`.
- `status=ATTACHED`: el upload ya fue usado por un mensaje saliente.
- `status=FAILED`: el envio asociado fallo; se conserva para diagnostico o reintento.
- `status=EXPIRED`: el cleanup elimino el archivo temporal vencido.

## Variables de entorno

```env
MEDIA_STORAGE_DRIVER=local
MEDIA_STORAGE_HOST_DIR=/data/fenix-media
MEDIA_STORAGE_LOCAL_DIR=/app/storage/media
MEDIA_PUBLIC_BASE_URL=https://api.fenixcrm.site/media-files
MEDIA_RETENTION_DAYS=180
MEDIA_MAX_FILE_MB=25
MEDIA_DOWNLOAD_TIMEOUT_MS=30000
MEDIA_CLEANUP_ENABLED=true
MEDIA_CLEANUP_TIMEZONE=Europe/Madrid
```

Notas:

- `MEDIA_STORAGE_HOST_DIR` se usa en `docker-compose.yml` para montar el mismo volumen en `api` y `worker`.
- `MEDIA_STORAGE_LOCAL_DIR` es la ruta dentro del contenedor.
- `MEDIA_PUBLIC_BASE_URL` debe apuntar al API, no a la SPA.

## Docker

`api` y `worker` deben compartir el mismo volumen:

```yaml
volumes:
  - ${MEDIA_STORAGE_HOST_DIR:-./storage/media}:/app/storage/media
```

En produccion se recomienda crear:

```bash
mkdir -p /data/fenix-media
```

y definir:

```env
MEDIA_STORAGE_HOST_DIR=/data/fenix-media
```

## Retencion

El job diario de limpieza corre a las 03:00 en `Europe/Madrid` por defecto.

Cuando encuentra media vencida:

- elimina el archivo fisico;
- mantiene el mensaje;
- conserva `fileName`, `mimeType`, `type`, `caption`;
- limpia `mediaUrl`, `mediaStorageKey`, `mediaStorageDriver`;
- marca `mediaExpiredAt`.

La SPA podra seguir mostrando el mensaje, pero sin preview/descarga del archivo expirado.

Tambien elimina uploads temporales vencidos en `MediaUpload` con estado `UPLOADED` o `FAILED` que no quedaron adjuntos correctamente.

## Nombre de archivo al descargar (`Content-Disposition`)

Pedido explicito del usuario, 27/oct/2026: los archivos se descargaban con un nombre distinto al real (el nombre que el usuario subio/vio en la UI). Causa: `/media-files/...` (`MEDIA_PUBLIC_BASE_URL`) es un dominio **distinto** al de la SPA (`app.fenixcrm.site` vs `api.fenixcrm.site`), y el atributo HTML `download="..."` de un `<a>` **solo funciona para recursos del mismo origen** — para un recurso cross-origin el navegador lo ignora y nombra el archivo segun la URL (el `storageKey`, un path interno tipo timestamp/random, no el nombre real).

La unica forma confiable de fijar el nombre de un recurso cross-origin es que el servidor lo diga via el header `Content-Disposition`. `MessageMediaController.getMedia()` (`GET /media-files/*key`) ahora acepta dos query params opcionales:

- `filename`: el nombre real del archivo (quien llama ya lo conoce — `Message.fileName`/`DesignRequestAttachment.fileName`/`MediaUpload.originalName` — así que viaja como parámetro en vez de que el controller busque en esas 3 tablas por `storageKey`).
- `download=1`: fuerza `Content-Disposition: attachment` (dispara "Guardar como" con el nombre correcto). Sin este parámetro, la URL sigue funcionando igual que antes para preview inline (`<img>`/`<video>`/`<iframe>` en `AttachmentPreviewDialog` de Fenix-SPA) — forzar `attachment` ahí haría que, por ejemplo, el iframe de un PDF dispare una descarga en vez de mostrarlo.

Sin ninguno de los dos parámetros, el comportamiento es exactamente el de antes (sin `Content-Disposition`) — no rompe ningún otro consumidor existente de esta misma URL (chat, etc.) que todavía no pase estos parámetros.

En Fenix-SPA, `buildAttachmentDownloadUrl(mediaUrl, fileName)` (`components/design-board/design-board-utils.ts`) arma la URL con ambos parámetros; lo usan los botones "Descargar" de `attachment-preview-dialog.tsx` y `design-request-detail-dialog.tsx` (módulo de bocetos).

## Limitaciones actuales

- La ruta `/media-files/...` es publica, protegida por claves UUID no adivinables.
- No se implementaron URLs firmadas todavia.
- El storage implementado es local. El diseno permite migrar luego a S3/R2 agregando otro driver.
