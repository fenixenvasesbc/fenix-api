import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { WebhookService } from './webhook.service';


@Controller('webhooks')
export class WebhookController {
  constructor(private readonly webhooksService: WebhookService) {}

  @Post('ycloud')
  @HttpCode(200)
  async receiveYCloudWebhook(@Body() body: any) {
    await this.webhooksService.enqueueYCloudWebhook(body);

    return { ok: true };
  }
}