import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { UsersModule } from './modules/users/users.module';
import { AuthModule } from './modules/auth/auth.module';
import { RefreshTokensModule } from './modules/refresh-tokens/refresh-tokens.module';
import { AccountsModule } from './modules/accounts/accounts.module';
import { EventsController } from './modules/events/events.controller';
import { EventsService } from './modules/events/events.service';
import { EventsModule } from './modules/events/events.module';
import { DashboardController } from './modules/dashboard/dashboard.controller';
import { DashboardService } from './modules/dashboard/dashboard.service';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { RabbitmqModule } from './modules/rabbitmq/rabbitmq.module';
import { WorkerModule } from './modules/worker/worker.module';
import { WebhookService } from './modules/webhook/webhook.service';
import { WebhookController } from './modules/webhook/webhook.controller';
import { WebhookModule } from './modules/webhook/webhook.module';
import { WebhookInboxService } from './modules/webhook-inbox/webhook-inbox.service';
import { WebhookInboxModule } from './modules/webhook-inbox/webhook-inbox.module';
import { InboundMessageService } from './modules/inbound-message/inbound-message.service';
import { InboundMessageModule } from './modules/inbound-message/inbound-message.module';
import { MessageStatusService } from './modules/message-status/message-status.service';
import { MessageStatusModule } from './modules/message-status/message-status.module';
import { ReengagementModule } from './modules/reengagement/reengagement.module';
import { CredentialsModule } from './modules/credentials/credentials.module';
import { YcloudModule } from './modules/ycloud/ycloud.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    UsersModule,
    AuthModule,
    PrismaModule,
    RefreshTokensModule,
    AccountsModule,
    EventsModule,
    DashboardModule,
    RabbitmqModule,
    WorkerModule,
    WebhookModule,
    WebhookInboxModule,
    InboundMessageModule,
    MessageStatusModule,
    ReengagementModule,
    CredentialsModule,
    YcloudModule,
  ],
  controllers: [
    AppController,
    EventsController,
    DashboardController,
    WebhookController,
  ],
  providers: [
    AppService,
    EventsService,
    DashboardService,
    WebhookService,
    WebhookInboxService,
    InboundMessageService,
    MessageStatusService,
  ],
})
export class AppModule {}
