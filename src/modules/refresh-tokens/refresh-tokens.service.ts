import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class RefreshTokensService {
  constructor(private readonly prisma: PrismaService) {}

  create(params: { userId: string; tokenHash: string; expiresAt: Date }) {
    return this.prisma.refreshToken.create({
      data: {
        userId: params.userId,
        tokenHash: params.tokenHash,
        expiresAt: params.expiresAt,
      },
    });
  }

  async revokeByTokenHash(tokenHash: string) {
    // Revoca solo si está activo (no revocado) para evitar writes innecesarios
    const existing = await this.prisma.refreshToken.findUnique({ where: { tokenHash } });
    if (!existing || existing.revokedAt) return null;

    return this.prisma.refreshToken.update({
      where: { id: existing.id },
      data: { revokedAt: new Date() },
    });
  }

  revokeAllForUser(userId: string) {
    return this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  findActiveByUser(userId: string) {
    return this.prisma.refreshToken.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });
  }

  findByTokenHash(tokenHash: string) {
    return this.prisma.refreshToken.findUnique({
      where: { tokenHash },
    });
  }

  /**
   * ADR-008 (sesion-diaria): revoca TODOS los refresh tokens activos del
   * sistema en una sola sentencia (updateMany, no un loop por usuario), para
   * que escale sin importar cuantos usuarios haya. Lo dispara el cron diario
   * (SessionRefreshScheduler) y tambien un endpoint manual de ADMIN
   * (POST /auth/sessions/revoke-all). El proximo access token que caduque
   * (<=15min, JWT_ACCESS_TTL_SECONDS) hara fallar el refresh en el cliente y
   * Fenix-SPA fuerza una recarga completa (window.location.href='/'),
   * forzando re-login en cualquier pestana que se haya dejado abierta.
   */
  revokeAllActive() {
    return this.prisma.refreshToken.updateMany({
      where: { revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}