import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../prisma/prisma.service';
import { ProviderType, Role, User } from '@prisma/client';
import { CredentialCryptoService } from '../credentials/credential-crypto.service';
import { CreateUserDto, UpdateUserDto } from './dto/user.dto';

type AuthUser = {
  userId: string;
  role: Role;
  accountId?: string | null;
};

// Nunca devolvemos passwordHash al frontend.
const SAFE_USER_SELECT = {
  id: true,
  email: true,
  role: true,
  isActive: true,
  accountId: true,
  createdAt: true,
  updatedAt: true,
} as const;

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly credentialCrypto: CredentialCryptoService,
  ) {}

  findByEmail(email: string) {
    return this.prisma.user.findUnique({ where: { email } });
  }

  findById(id: string) {
    return this.prisma.user.findUnique({ where: { id } });
  }

  async createUser(params: { email: string; passwordHash: string; role: Role }): Promise<User> {
    const { email, passwordHash, role } = params;
    return this.prisma.user.create({
      data: { email, passwordHash, role },
    });
  }

  async getSales() {
    return this.prisma.user.findMany({
      where: { role: { in: [Role.SALES, Role.SALES_MANAGER] } },
      select: SAFE_USER_SELECT,
    });
  }

  // ==========================================
  // Modulo de administracion de usuarios
  // (Configuracion -> Usuarios). Solo ADMIN puede
  // gestionar cualquier rol; SALES_MANAGER solo puede
  // gestionar usuarios (existentes o nuevos) de rol SALES.
  // ==========================================

  private async hashPassword(password: string): Promise<string> {
    const rounds = Number(this.config.get<string>('BCRYPT_SALT_ROUNDS') ?? '10');
    return bcrypt.hash(password, rounds);
  }

  // SALES_MANAGER solo puede crear/editar/(des)activar usuarios de rol SALES.
  // ADMIN puede gestionar cualquier rol, incluido otro ADMIN.
  private assertCanManageRole(actingUser: AuthUser, targetRole: Role) {
    if (actingUser.role === Role.ADMIN) return;

    if (actingUser.role === Role.SALES_MANAGER && targetRole === Role.SALES) {
      return;
    }

    throw new ForbiddenException(
      'No tienes permisos para gestionar usuarios con ese rol',
    );
  }

  async listUsers(
    actingUser: AuthUser,
    params: { role?: Role; search?: string; isActive?: boolean },
  ) {
    const where: Record<string, unknown> = {};

    if (actingUser.role === Role.SALES_MANAGER) {
      // Un SALES_MANAGER solo puede ver/gestionar cuentas SALES en este modulo,
      // sin importar que rol pida por query.
      where.role = Role.SALES;
    } else if (params.role) {
      where.role = params.role;
    }

    if (params.isActive !== undefined) {
      where.isActive = params.isActive;
    }

    if (params.search) {
      where.email = { contains: params.search, mode: 'insensitive' };
    }

    return this.prisma.user.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      select: SAFE_USER_SELECT,
    });
  }

  async getUserSafe(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: SAFE_USER_SELECT,
    });

    if (!user) throw new NotFoundException('User not found');

    return user;
  }

  async adminCreateUser(actingUser: AuthUser, dto: CreateUserDto) {
    this.assertCanManageRole(actingUser, dto.role);

    const existing = await this.findByEmail(dto.email);
    if (existing) throw new BadRequestException('Email already registered');

    const passwordHash = await this.hashPassword(dto.password);

    // Un SALES siempre debe quedar asociado a su propia cuenta de YCloud
    // (Account + credencial). Se crea todo en una unica transaccion: si
    // algo falla, no debe quedar un User huerfano sin Account, ni un
    // Account sin credencial.
    if (dto.role === Role.SALES) {
      const { accountName, wabaId, phoneE164, apiKey } = dto;
      if (!accountName || !wabaId || !phoneE164 || !apiKey) {
        throw new BadRequestException(
          'accountName, wabaId, phoneE164 y apiKey son obligatorios para crear un usuario SALES',
        );
      }

      return this.prisma.$transaction(async (tx) => {
        const existingAccount = await tx.account.findUnique({
          where: { wabaId_phoneE164: { wabaId, phoneE164 } },
        });
        if (existingAccount) {
          throw new BadRequestException(
            'An account with this wabaId and phone already exists',
          );
        }

        const account = await tx.account.create({
          data: { name: accountName, wabaId, phoneE164 },
        });

        const user = await tx.user.create({
          data: {
            email: dto.email,
            passwordHash,
            role: dto.role,
            accountId: account.id,
          },
          select: SAFE_USER_SELECT,
        });

        await tx.accountProviderCredential.create({
          data: {
            accountId: account.id,
            provider: ProviderType.YCLOUD,
            apiKeyEncrypted: this.credentialCrypto.encrypt(apiKey),
            apiKeyHint: this.credentialCrypto.buildHint(apiKey),
            isActive: true,
          },
        });

        return user;
      });
    }

    const user = await this.prisma.user.create({
      data: { email: dto.email, passwordHash, role: dto.role },
      select: SAFE_USER_SELECT,
    });

    return user;
  }

  async adminUpdateUser(actingUser: AuthUser, id: string, dto: UpdateUserDto) {
    const target = await this.prisma.user.findUnique({ where: { id } });
    if (!target) throw new NotFoundException('User not found');

    // Puede gestionar el usuario tal como esta hoy...
    this.assertCanManageRole(actingUser, target.role);
    // ...y, si intenta cambiarle el rol, tambien el rol de destino.
    if (dto.role && dto.role !== target.role) {
      this.assertCanManageRole(actingUser, dto.role);
    }

    if (dto.isActive === false && target.id === actingUser.userId) {
      throw new BadRequestException('No puedes desactivar tu propio usuario');
    }

    if (dto.email && dto.email !== target.email) {
      const existing = await this.findByEmail(dto.email);
      if (existing && existing.id !== target.id) {
        throw new BadRequestException('Email already registered');
      }
    }

    const data: Record<string, unknown> = {};
    if (dto.email !== undefined) data.email = dto.email;
    if (dto.role !== undefined) data.role = dto.role;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;
    if (dto.password) data.passwordHash = await this.hashPassword(dto.password);

    const updated = await this.prisma.user.update({
      where: { id },
      data,
      select: SAFE_USER_SELECT,
    });

    // Si se desactivo o se cambio la contrasena, se revocan sus refresh tokens
    // para forzar el cierre de sesion en cualquier dispositivo.
    if (dto.isActive === false || dto.password) {
      await this.prisma.refreshToken.updateMany({
        where: { userId: id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }

    return updated;
  }

  async setUserActive(actingUser: AuthUser, id: string, isActive: boolean) {
    return this.adminUpdateUser(actingUser, id, { isActive });
  }
}
