import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type { ConsumeMessage } from 'amqplib';
import {
  RabbitmqService,
  type ConsumeDecision,
} from '../rabbitmq/rabbitmq.service';
import type { WebhookInboxJob } from 'src/common/types/webhook-inbox-job';
import { SmbStateSyncService } from '../smb-state-sync/smb-state-sync.service';

@Injectable()
export class SmbStateSyncWorker implements OnModuleInit {
  private readonly logger = new Logger(SmbStateSyncWorker.name);

  constructor(
    private readonly rabbit: RabbitmqService,
    private readonly smbStateSyncService: SmbStateSyncService,
  ) {}

  async onModuleInit() {
    const queue =
      process.env.RABBITMQ_QUEUE_SMB_STATE_SYNC ?? 'q_smb_state_sync';
    this.logger.log(`Starting SMB state sync consumer on queue=${queue}`);

    await this.rabbit.consume(queue, async (msg) => this.handleMessage(msg));
  }

  private async handleMessage(msg: ConsumeMessage): Promise<ConsumeDecision> {
    const payload = this.safeJson(msg);
    const deaths = this.rabbit.getDeathCount(msg);
    let job: WebhookInboxJob | null = null;

    try {
      if (!payload) {
        throw new Error('Invalid JSON payload');
      }

      job = this.validateJob(payload);
      await this.smbStateSyncService.process(job);

      return { action: 'ack' };
    } catch (err) {
      const decision = this.routeRetry(deaths);
      const target = 'routingKey' in decision ? decision.routingKey : '-';

      if (job) {
        await this.smbStateSyncService.markFailed(
          job,
          err,
          decision.action === 'dead',
        );
      }

      this.logger.error(
        `SMB state sync worker failed. deaths=${deaths}. action=${decision.action}:${target}. err=${String(err)}`,
      );

      return decision;
    }
  }

  private validateJob(payload: any): WebhookInboxJob {
    if (!payload?.providerEventId) throw new Error('Missing providerEventId');
    if (!payload?.eventType) throw new Error('Missing eventType');
    if (!payload?.payload) throw new Error('Missing payload');

    return payload as WebhookInboxJob;
  }

  private safeJson(msg: ConsumeMessage): any | null {
    try {
      return JSON.parse(msg.content.toString('utf8'));
    } catch {
      return null;
    }
  }

  private routeRetry(deaths: number): ConsumeDecision {
    const rk10s =
      process.env.RABBITMQ_RK_SMB_STATE_SYNC_RETRY_10S ??
      'whatsapp.smb.app.state.sync.retry.10s';
    const rk1m =
      process.env.RABBITMQ_RK_SMB_STATE_SYNC_RETRY_1M ??
      'whatsapp.smb.app.state.sync.retry.1m';
    const rk10m =
      process.env.RABBITMQ_RK_SMB_STATE_SYNC_RETRY_10M ??
      'whatsapp.smb.app.state.sync.retry.10m';
    const rkDead = process.env.RABBITMQ_RK_DEAD!;

    if (deaths <= 2) return { action: 'retry', routingKey: rk10s };
    if (deaths <= 5) return { action: 'retry', routingKey: rk1m };
    if (deaths <= 8) return { action: 'retry', routingKey: rk10m };
    return { action: 'dead', routingKey: rkDead };
  }
}
