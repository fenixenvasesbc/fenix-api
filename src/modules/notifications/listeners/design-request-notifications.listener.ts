import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { AppNotificationType, Role } from '@prisma/client';
import {
  DESIGN_REQUEST_EVENTS,
  DesignRequestCommentedEvent,
  DesignRequestReadyEvent,
  DesignRequestSentToModificationEvent,
} from '../../design-board/events/design-board.events';
import { NotificationsService } from '../notifications.service';

// ADR-004 Submodulo 6, reescrito con el patron Observer (EventEmitter2) a
// pedido del cliente: DesignBoardService ya no sabe nada de notificaciones,
// solo publica "esto paso en el tablero" (ver
// design-board/events/design-board.events.ts). Este listener es el UNICO
// lugar del codigo que decide QUIEN se entera de cada evento -- si mañana
// cambia esa regla de negocio, o se agrega un canal nuevo (email, Slack),
// se toca aca, nunca design-board.service.ts. NotificationsModule no
// importa DesignBoardModule ni viceversa: quedan totalmente desacoplados,
// conectados solo por el nombre del evento.
@Injectable()
export class DesignRequestNotificationsListener {
  private readonly logger = new Logger(DesignRequestNotificationsListener.name);

  constructor(private readonly notifications: NotificationsService) {}

  @OnEvent(DESIGN_REQUEST_EVENTS.READY)
  async onReady(event: DesignRequestReadyEvent) {
    await this.safely(() =>
      this.notifications.createNotification({
        accountId: event.accountId,
        leadId: event.leadId,
        recipientUserId: event.createdByUserId,
        type: AppNotificationType.DESIGN_REQUEST_READY,
        dedupeKey: `design_request_ready:${event.designRequestId}`,
        title: 'Boceto terminado',
        message: 'Un boceto que pediste ya está listo para tu revisión.',
      }),
    );
  }

  @OnEvent(DESIGN_REQUEST_EVENTS.COMMENTED)
  async onCommented(event: DesignRequestCommentedEvent) {
    // ADR-004 §9.8: "a la otra parte" -- si comenta el lado de diseño
    // (DESIGNER/DESIGNER_MANAGER), avisa a la comercial creadora; si
    // comenta cualquier otro rol (SALES, o ADMIN actuando por ella), avisa
    // al diseñador asignado. Si todavia no hay nadie asignado del lado de
    // diseño, no hay a quien avisar -- se omite en vez de fallar.
    const isDesignSide =
      event.authorRole === Role.DESIGNER || event.authorRole === Role.DESIGNER_MANAGER;
    const recipientUserId = isDesignSide ? event.createdByUserId : event.assignedUserId;

    if (!recipientUserId) return;

    await this.safely(() =>
      this.notifications.createNotification({
        accountId: event.accountId,
        leadId: event.leadId,
        recipientUserId,
        type: AppNotificationType.DESIGN_REQUEST_COMMENTED,
        dedupeKey: `design_request_commented:${event.commentId}`,
        title: 'Nuevo comentario en un boceto',
        message: 'Hay un comentario nuevo en una solicitud de boceto.',
      }),
    );
  }

  @OnEvent(DESIGN_REQUEST_EVENTS.SENT_TO_MODIFICATION)
  async onSentToModification(event: DesignRequestSentToModificationEvent) {
    if (!event.assignedUserId) return;

    await this.safely(() =>
      this.notifications.createNotification({
        accountId: event.accountId,
        leadId: event.leadId,
        recipientUserId: event.assignedUserId,
        type: AppNotificationType.DESIGN_REQUEST_SENT_TO_MODIFICATION,
        dedupeKey: `design_request_sent_to_modification:${event.designRequestId}:${event.occurredAt.getTime()}`,
        title: 'Boceto enviado a modificación',
        message: 'Un boceto que tenías asignado volvió a "Modificación".',
      }),
    );
  }

  // EventEmitter2.emit() no espera a los listeners (fire-and-forget): un
  // error aca no debe tumbar el flujo del tablero (mover/comentar ya se
  // guardo bien), asi que se loguea y listo -- mismo criterio que ya usa
  // ChatEventsService.publish() para sus propios fallos.
  private async safely(fn: () => Promise<unknown>) {
    try {
      await fn();
    } catch (error) {
      this.logger.warn(`No se pudo crear la notificacion de boceto: ${String(error)}`);
    }
  }
}
