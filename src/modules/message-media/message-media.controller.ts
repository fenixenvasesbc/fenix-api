import {
  Controller,
  Get,
  NotFoundException,
  Param,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { MessageMediaService } from './message-media.service';

@Controller('media-files')
export class MessageMediaController {
  constructor(private readonly messageMediaService: MessageMediaService) {}

  @Get('*key')
  async getMedia(
    @Param('key') key: string[] | string,
    @Res() res: Response,
    // Pedido explicito del usuario, 27/oct/2026: al descargar un adjunto
    // (bocetos, chat, etc.) el archivo se guardaba con un nombre distinto
    // al original -- la causa real es que esta URL es CROSS-ORIGIN
    // respecto a la SPA (MEDIA_PUBLIC_BASE_URL apunta al dominio de la
    // API, no al de app.fenixcrm.site), y el atributo HTML `download` de
    // un <a> SOLO funciona para recursos del MISMO origen; el navegador
    // lo ignora aca y cae de vuelta a nombrar el archivo segun la URL
    // (el storageKey, que es un path interno tipo timestamp/random, no el
    // nombre real). La unica forma confiable de fijar el nombre para un
    // recurso cross-origin es que el SERVIDOR lo diga via el header
    // Content-Disposition -- por eso el nombre real (`fileName`) tiene
    // que viajar como query param desde quien ya lo conoce (la SPA, que
    // lo tiene en Message.fileName/DesignRequestAttachment.fileName/
    // MediaUpload.originalName) en vez de intentar resolverlo aca
    // buscando en 3 tablas distintas por storageKey.
    @Query('filename') filename?: string,
    // 'download=1' fuerza descarga (Content-Disposition: attachment),
    // para el boton "Descargar". Sin este parametro se mantiene el
    // comportamiento actual (sin forzar disposition) para no romper los
    // usos de esta misma URL como preview inline (<img>/<video>/<iframe>
    // en AttachmentPreviewDialog) -- forzar "attachment" ahi haria que el
    // iframe de un PDF, por ejemplo, dispare una descarga en vez de
    // mostrarlo.
    @Query('download') download?: string,
  ) {
    const storageKey = Array.isArray(key) ? key.join('/') : key;

    try {
      const media = await this.messageMediaService.getLocalMedia(storageKey);
      res.setHeader('Content-Type', media.mimeType);
      res.setHeader('Content-Length', String(media.size));
      res.setHeader('Cache-Control', 'private, max-age=86400');

      const disposition = this.buildContentDisposition(
        download === '1' || download === 'true' ? 'attachment' : 'inline',
        filename,
        storageKey,
      );
      if (disposition) res.setHeader('Content-Disposition', disposition);

      res.send(media.buffer);
    } catch {
      throw new NotFoundException('Media file not found');
    }
  }

  // RFC 6266 / RFC 5987: `filename=` para navegadores viejos (solo
  // ASCII, comillas/backslashes escapadas) + `filename*=UTF-8''...` para
  // que acentos/ñ/espacios se vean bien en los modernos -- mismo nombre
  // que el usuario subio, no el storageKey.
  private buildContentDisposition(
    type: 'inline' | 'attachment',
    filename: string | undefined,
    storageKey: string,
  ) {
    const rawName =
      filename?.trim() || (type === 'attachment' ? this.basename(storageKey) : '');
    if (!rawName) return type === 'attachment' ? type : null;

    // Fuera cualquier caracter de control (incluido CR/LF -- evita
    // inyeccion de headers) antes de armar el valor.
    const safeName = rawName.replace(/[\r\n\x00-\x1f]/g, ' ').slice(0, 255);
    const asciiFallback = safeName
      .replace(/[^\x20-\x7e]/g, '_')
      .replace(/"/g, "'");

    return `${type}; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(safeName)}`;
  }

  private basename(storageKey: string) {
    const parts = storageKey.split('/');
    return parts[parts.length - 1] || 'archivo';
  }
}
