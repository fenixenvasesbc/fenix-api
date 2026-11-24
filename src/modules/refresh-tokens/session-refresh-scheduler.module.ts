import { Module } from '@nestjs/common';
import { RefreshTokensModule } from './refresh-tokens.module';
import { SessionRefreshScheduler } from './session-refresh.scheduler';

@Module({
  imports: [RefreshTokensModule],
  providers: [SessionRefreshScheduler],
})
export class SessionRefreshSchedulerModule {}
