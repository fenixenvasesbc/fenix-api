import { Injectable, Logger } from '@nestjs/common';
import { RabbitmqService } from '../rabbitmq/rabbitmq.service';

@Injectable()
export class WebhookService {
  private readonly logger = new Logger(WebhookService.name);

  constructor(private readonly rabbit: RabbitmqService) {}

  async enqueueYCloudWebhook(body: any) {
    const providerEventId = body?.id;
    const eventType = body?.type;

    if (!providerEventId || !eventType) {
      this.logger.warn(`Invalid YCloud webhook. Missing id/type`);
      return;
    }

    const providerTime =
      body?.createTime ??
      body?.whatsappInboundMessage?.sendTime ??
      body?.whatsappMessage?.createTime ??
      null;

    const job = {
      provider: 'ycloud' as const,
      providerEventId,
      eventType,
      apiVersion: body?.apiVersion ?? null,
      providerTime,
      payload: body,
      receivedAt: new Date().toISOString(),
    };

    await this.rabbit.publish(process.env.RABBITMQ_RK_PROCESS!, job);

    this.logger.log(
      `Webhook enqueued providerEventId=${providerEventId} eventType=${eventType}`,
    );
  }
}