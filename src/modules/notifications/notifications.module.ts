import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { ChatEventsModule } from '../chat-events/chat-events.module';
import { NotificationsController } from './notifications.controller';
import { NotificationsSchedulerService } from './notifications-scheduler.service';
import { NotificationsService } from './notifications.service';
import { DesignRequestNotificationsListener } from './listeners/design-request-notifications.listener';

@Module({
  imports: [PrismaModule, ChatEventsModule],
  controllers: [NotificationsController],
  // DesignRequestNotificationsListener no lo importa ni lo llama ningun
  // otro modulo -- se registra solo para que Nest lo instancie y sus
  // @OnEvent() se suscriban al bus de EventEmitter2 (EventEmitterModule
  // esta registrado global en AppModule). DesignBoardModule no aparece en
  // ningun import de este archivo: la unica conexion entre los dos
  // modulos es el nombre del evento.
  providers: [
    NotificationsService,
    NotificationsSchedulerService,
    DesignRequestNotificationsListener,
  ],
  exports: [NotificationsService],
})
export class NotificationsModule {}
