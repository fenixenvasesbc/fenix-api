import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { RefreshTokensService } from './refresh-tokens.service';
import { runCronWithSummary, bump } from 'src/common/utils/logging';

/**
 * ADR-008 (sesion-diaria): las comerciales dejan Fenix-SPA abierto en el
 * navegador indefinidamente. Para forzar una recarga completa cada manana
 * (ultimo build desplegado, estado en memoria limpio) revocamos todos los
 * refresh tokens activos a una hora fija. No hace falta tocar el frontend:
 * en <=15min (JWT_ACCESS_TTL_SECONDS) el access token caduca, el refresh
 * falla porque el token fue revocado, y Fenix-SPA ya hace
 * window.location.href='/' en ese caso (lib/api-client.ts).
 */
@Injectable()
export class SessionRefreshScheduler {
  private readonly logger = new Logger(SessionRefreshScheduler.name);

  constructor(private readonly refreshTokens: RefreshTokensService) {}

  @Cron(CronExpression.EVERY_DAY_AT_6AM, {
    timeZone: process.env.DAILY_SESSION_REFRESH_TIMEZONE ?? 'Europe/Madrid',
  })
  async runDailySessionRefresh() {
    if ((process.env.DAILY_SESSION_REFRESH_ENABLED ?? 'true') !== 'true') {
      this.logger.log('Daily session refresh disabled (DAILY_SESSION_REFRESH_ENABLED)');
      return;
    }

    await runCronWithSummary(this.logger, 'session-refresh', async (stats) => {
      const result = await this.refreshTokens.revokeAllActive();
      bump(stats, 'revoked', result.count);
    });
  }
}
