import {
  BadRequestException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { UsersService } from '../users/users.service';
import { RefreshTokensService } from '../refresh-tokens/refresh-tokens.service';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { randomBytes, createHash } from 'crypto';
import { Role } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PasswordResetMailService } from './password-reset-mail.service';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly users: UsersService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly refreshTokens: RefreshTokensService,
    private readonly prisma: PrismaService,
    private readonly passwordResetMail: PasswordResetMailService,
  ) {}

  private refreshTokenExpiresAt() {
    const days = Number(this.config.get<string>('REFRESH_TOKEN_DAYS') ?? '30');
    const d = new Date();
    d.setDate(d.getDate() + days);
    return d;
  }

  private hashToken(token: string) {
    // hash determinístico, rápido y buscable
    return createHash('sha256').update(token).digest('hex');
  }

  private async mintRefreshToken(userId: string) {
    const token = randomBytes(64).toString('hex'); // token "en claro" para el cliente
    const tokenHash = this.hashToken(token);

    await this.refreshTokens.create({
      userId,
      tokenHash,
      expiresAt: this.refreshTokenExpiresAt(),
    });

    return token;
  }

  private async hashPassword(password: string): Promise<string> {
    const rounds = Number(
      this.config.get<string>('BCRYPT_SALT_ROUNDS') ?? '10',
    );
    return bcrypt.hash(password, rounds);
  }

  private signAccessToken(user: {
    id: string;
    role: Role;
    accountId?: string | null;
  }) {
    return this.jwt.sign(
      { role: user.role, accountId: user.accountId ?? null },
      { subject: user.id },
    );
  }

  async login(email: string, password: string) {
    const user = await this.users.findByEmail(email);
    if (!user || !user.isActive)
      throw new UnauthorizedException('Invalid credentials');

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) throw new UnauthorizedException('Invalid credentials');
    const accessToken = this.signAccessToken(user);
    const refreshToken = await this.mintRefreshToken(user.id);

    return { accessToken, refreshToken };
  }

  async requestPasswordReset(email: string) {
    const normalizedEmail = email.trim().toLowerCase();
    const genericResponse = {
      message:
        'Si el correo existe y esta activo, enviaremos un enlace para cambiar la contrasena.',
    };

    const user = await this.prisma.user.findFirst({
      where: { email: { equals: normalizedEmail, mode: 'insensitive' } },
    });
    if (!user || !user.isActive) return genericResponse;

    const token = randomBytes(32).toString('hex');
    const tokenHash = this.hashToken(token);
    const expiresAt = this.passwordResetExpiresAt();

    await this.prisma.$transaction([
      this.prisma.passwordResetToken.updateMany({
        where: { userId: user.id, usedAt: null },
        data: { usedAt: new Date() },
      }),
      this.prisma.passwordResetToken.create({
        data: { userId: user.id, tokenHash, expiresAt },
      }),
    ]);

    const resetUrl = this.buildPasswordResetUrl(token);

    try {
      await this.passwordResetMail.sendPasswordResetEmail({
        email: user.email,
        resetUrl,
      });
    } catch (cause) {
      this.logger.error(
        `Password reset email failed userId=${user.id} email=${user.email}`,
        cause instanceof Error ? cause.stack : String(cause),
      );
    }

    return genericResponse;
  }

  async resetPassword(token: string, password: string) {
    const tokenHash = this.hashToken(token.trim());
    const resetToken = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });

    if (
      !resetToken ||
      resetToken.usedAt ||
      resetToken.expiresAt < new Date() ||
      !resetToken.user.isActive
    ) {
      throw new BadRequestException('El enlace no es valido o ya expiro');
    }

    const passwordHash = await this.hashPassword(password);

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: resetToken.userId },
        data: { passwordHash },
      }),
      this.prisma.passwordResetToken.update({
        where: { id: resetToken.id },
        data: { usedAt: new Date() },
      }),
      this.prisma.passwordResetToken.updateMany({
        where: {
          userId: resetToken.userId,
          usedAt: null,
          id: { not: resetToken.id },
        },
        data: { usedAt: new Date() },
      }),
    ]);

    await this.refreshTokens.revokeAllForUser(resetToken.userId);

    return { message: 'Contrasena actualizada correctamente' };
  }

  private passwordResetExpiresAt() {
    const minutes = Number(
      this.config.get<string>('PASSWORD_RESET_TOKEN_TTL_MINUTES') ?? '30',
    );
    const d = new Date();
    d.setMinutes(d.getMinutes() + minutes);
    return d;
  }

  private buildPasswordResetUrl(token: string) {
    const baseUrl =
      this.config.get<string>('PASSWORD_RESET_BASE_URL') ||
      this.config.get<string>('SPA_PUBLIC_URL') ||
      this.config.get<string>('CORS_ORIGIN') ||
      'https://app.fenixcrm.site';
    const normalizedBaseUrl = baseUrl.replace(/\/$/, '');
    return `${normalizedBaseUrl}/reset-password?token=${encodeURIComponent(token)}`;
  }

  async logout(refreshToken: string) {
    if (!refreshToken) throw new BadRequestException('Missing refresh token');

    const tokenHash = this.hashToken(refreshToken);
    await this.refreshTokens.revokeByTokenHash(tokenHash);

    // aunque no exista, respondemos OK para evitar enumeración
    return { message: 'Logged out' };
  }

  async refresh(refreshToken: string) {
    if (!refreshToken) {
      throw new BadRequestException('Missing refresh token');
    }

    const tokenHash = this.hashToken(refreshToken);

    const storedToken = await this.refreshTokens.findByTokenHash(tokenHash);
    if (!storedToken) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    // 🔥 MEJORA PRO AQUÍ
    if (storedToken.revokedAt) {
      // posible robo o reuse → invalidar toda la sesión
      await this.refreshTokens.revokeAllForUser(storedToken.userId);

      throw new UnauthorizedException('Refresh token reuse detected');
    }

    if (storedToken.expiresAt < new Date()) {
      throw new UnauthorizedException('Refresh token expired');
    }

    const user = await this.users.findById(storedToken.userId);
    if (!user || !user.isActive) {
      throw new UnauthorizedException('User inactive or not found');
    }

    // 🔁 rotación normal
    await this.refreshTokens.revokeByTokenHash(tokenHash);

    const accessToken = this.signAccessToken(user);
    const newRefreshToken = await this.mintRefreshToken(user.id);

    return {
      accessToken,
      refreshToken: newRefreshToken,
    };
  }

  async createAdmin(email: string, password: string) {
    const existing = await this.users.findByEmail(email);
    if (existing) throw new BadRequestException('Email already registered');

    const passwordHash = await this.hashPassword(password);
    const user = await this.users.createUser({
      email,
      passwordHash,
      role: Role.ADMIN,
    });

    return { id: user.id, email: user.email, role: user.role };
  }

  async createSales(email: string, password: string) {
    const existing = await this.users.findByEmail(email);
    if (existing) throw new BadRequestException('Email already registered');

    const passwordHash = await this.hashPassword(password);
    const user = await this.users.createUser({
      email,
      passwordHash,
      role: Role.SALES,
    });

    return { id: user.id, email: user.email, role: user.role };
  }

  async createFactory(email: string, password: string) {
    const existing = await this.users.findByEmail(email);
    if (existing) throw new BadRequestException('Email already registered');

    const passwordHash = await this.hashPassword(password);
    const user = await this.users.createUser({
      email,
      passwordHash,
      role: Role.FACTORY,
    });

    return { id: user.id, email: user.email, role: user.role };
  }

  async createFactoryManager(email: string, password: string) {
    const existing = await this.users.findByEmail(email);
    if (existing) throw new BadRequestException('Email already registered');

    const passwordHash = await this.hashPassword(password);
    const user = await this.users.createUser({
      email,
      passwordHash,
      role: Role.FACTORY_MANAGER,
    });

    return { id: user.id, email: user.email, role: user.role };
  }
}
