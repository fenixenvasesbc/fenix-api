import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { UsersService } from '../users/users.service';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { Role } from '@prisma/client';

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UsersService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  private async hashPassword(password: string): Promise<string> {
    const rounds = Number(this.config.get<string>('BCRYPT_SALT_ROUNDS') ?? '10');
    return bcrypt.hash(password, rounds);
  }

  private signAccessToken(user: { id: string; role: Role }) {
    return this.jwt.sign({ role: user.role }, { subject: user.id });
  }

  async login(email: string, password: string) {
    const user = await this.users.findByEmail(email);
    if (!user || !user.isActive) throw new UnauthorizedException('Invalid credentials');

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) throw new UnauthorizedException('Invalid credentials');

    return { accessToken: this.signAccessToken(user) };
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