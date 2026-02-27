import {
  Body,
  Controller,
  Post,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ApiKeyGuard } from '../auth/guards/api-key.guard';
import { EventsService } from './events.service';
import { YCloudOutboundAcceptedDto } from './dto/ycloud-outbound-accepted.dto';
import { YCloudInboundReceivedDto } from './dto/ycloud-inbound-received.dto';

@Controller('events')
export class EventsController {
  constructor(private readonly events: EventsService) {}

  /**
   * OUTBOUND ACCEPTED
   * Mantiene validación estricta (usa la global)
   */
  @UseGuards(ApiKeyGuard)
  @Post('outbound/accepted')
  async outboundAccepted(
    @Body() body: YCloudOutboundAcceptedDto,
  ) {
    return this.events.registerOutboundAccepted(body);
  }

  /**
   * INBOUND RECEIVED
   * Webhook externo → puede traer propiedades nuevas (ej: audio.voice)
   * Relajamos forbidNonWhitelisted SOLO aquí.
   */
  //@UseGuards(ApiKeyGuard)
  @Post('inbound/received')
  @UsePipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: false, // 👈 clave
      transform: true,
    }),
  )
  async inboundReceived(
    @Body() body: YCloudInboundReceivedDto,
  ) {
    return this.events.registerInboundReceived(body);
  }
}