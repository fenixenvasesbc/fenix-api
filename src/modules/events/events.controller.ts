import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiKeyGuard } from '../auth/guards/api-key.guard';
import { EventsService } from './events.service';
import { YCloudOutboundAcceptedDto } from './dto/ycloud-outbound-accepted.dto';
import { YCloudInboundReceivedDto } from './dto/ycloud-inbound-received.dto';

@Controller('events')
export class EventsController {
  constructor(private readonly events: EventsService) {}

  @UseGuards(ApiKeyGuard)
  @Post('outbound/accepted')
  async outboundAccepted(@Body() body: YCloudOutboundAcceptedDto) {
    return this.events.registerOutboundAccepted(body);
  }

  //@UseGuards(ApiKeyGuard)
  @Post('inbound/received')
  async inboundReceived(@Body() body: YCloudInboundReceivedDto) {
    return this.events.registerInboundReceived(body);
  }
}