import { Controller, Get, NotFoundException, Param, Res } from '@nestjs/common';
import type { Response } from 'express';
import { MessageMediaService } from './message-media.service';

@Controller('media-files')
export class MessageMediaController {
  constructor(private readonly messageMediaService: MessageMediaService) {}

  @Get('*key')
  async getMedia(@Param('key') key: string[] | string, @Res() res: Response) {
    const storageKey = Array.isArray(key) ? key.join('/') : key;

    try {
      const media = await this.messageMediaService.getLocalMedia(storageKey);
      res.setHeader('Content-Type', media.mimeType);
      res.setHeader('Content-Length', String(media.size));
      res.setHeader('Cache-Control', 'private, max-age=86400');
      res.send(media.buffer);
    } catch {
      throw new NotFoundException('Media file not found');
    }
  }
}
