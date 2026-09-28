import { Module } from '@nestjs/common';
import { OutboundService } from './outbound.service';
import { OutboundController } from './outbound.controller';
import { ChatPolicyService } from './chat-policy.service';
import { ConversationModule } from '../conversation/conversation.module';
import { YcloudModule } from '../ycloud/ycloud.module';

// ADR-004: convertido de módulo vacío (`@Module({})`, con OutboundService/
// OutboundController/ChatPolicyService declarados a mano en AppModule) a un
// módulo real que los provee y EXPORTA OutboundService y ChatPolicyService,
// siguiendo el mismo patrón que ya usan ConversationModule/YcloudModule.
// OutboundService: para que DesignBoardModule lo reuse (POST /outbound/media)
// al "reenviar al lead" sin duplicar lógica de envío de WhatsApp.
// ChatPolicyService: ConversationController (declarado en AppModule) sigue
// dependiendo de el directamente; sin exportarlo, Nest no puede resolverlo
// fuera de este módulo (bug detectado en el deploy de produccion del 2026-09-28).
@Module({
  imports: [ConversationModule, YcloudModule],
  controllers: [OutboundController],
  providers: [OutboundService, ChatPolicyService],
  exports: [OutboundService, ChatPolicyService],
})
export class OutboundModule {}
