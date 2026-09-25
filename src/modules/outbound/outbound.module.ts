import { Module } from '@nestjs/common';
import { OutboundService } from './outbound.service';
import { OutboundController } from './outbound.controller';
import { ChatPolicyService } from './chat-policy.service';
import { ConversationModule } from '../conversation/conversation.module';
import { YcloudModule } from '../ycloud/ycloud.module';

// ADR-004: convertido de módulo vacío (`@Module({})`, con OutboundService/
// OutboundController/ChatPolicyService declarados a mano en AppModule) a un
// módulo real que los provee y EXPORTA OutboundService, siguiendo el mismo
// patrón que ya usan ConversationModule/YcloudModule. Esto permite que
// DesignBoardModule reuse OutboundService (POST /outbound/media) para
// "reenviar al lead" sin duplicar lógica de envío de WhatsApp.
@Module({
  imports: [ConversationModule, YcloudModule],
  controllers: [OutboundController],
  providers: [OutboundService, ChatPolicyService],
  exports: [OutboundService],
})
export class OutboundModule {}
