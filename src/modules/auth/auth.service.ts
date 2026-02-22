import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { UsersService } from '../users/users.service';
import { RefreshTokensService } from '../refresh-tokens/refresh-tokens.service';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { randomBytes, createHash } from 'crypto';
import { Role } from '@prisma/client';

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UsersService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly refreshTokens: RefreshTokensService,
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
    const rounds = Number(this.config.get<string>('BCRYPT_SALT_ROUNDS') ?? '10');
    return bcrypt.hash(password, rounds);
  }

  private signAccessToken(user: { id: string; role: Role, accountId?: string | null }) {
    return this.jwt.sign({ role: user.role, accountId: user.accountId ?? null }, { subject: user.id });
  }

  async login(email: string, password: string) {
    const user = await this.users.findByEmail(email);
    if (!user || !user.isActive) throw new UnauthorizedException('Invalid credentials');

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) throw new UnauthorizedException('Invalid credentials');
    const accessToken = this.signAccessToken(user);
    const refreshToken = await this.mintRefreshToken(user.id);

    return { accessToken, refreshToken };
  }
  async logout(refreshToken: string) {
    if (!refreshToken) throw new BadRequestException('Missing refresh token');

    const tokenHash = this.hashToken(refreshToken);
    await this.refreshTokens.revokeByTokenHash(tokenHash);

    // aunque no exista, respondemos OK para evitar enumeración
    return { message: 'Logged out' };
  }

  async createAdmin(email: string, password: string) {
    const existing = await this.users.findByEmail(email);
    if (existing) throw new BadRequestException('Email already registered');

    const passwordHash = await this.hashPassword(password);
    const user = await this.users.createUser({ email, passwordHash, role: Role.ADMIN });

    return { id: user.id, email: user.email, role: user.role };
  }

  async createSales(email: string, password: string) {
    const existing = await this.users.findByEmail(email);
    if (existing) throw new BadRequestException('Email already registered');

    const passwordHash = await this.hashPassword(password);
    const user = await this.users.createUser({ email, passwordHash, role: Role.SALES });

    return { id: user.id, email: user.email, role: user.role };
  }
}