import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { Role, Account } from '@prisma/client';
import {
  AccountDto,
  UpdateAccountWithUserDto,
  FindAccountsQueryDto,
} from './dto/account.dto';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { log } from 'console';

@Injectable()
export class AccountsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  private async hashPassword(password: string): Promise<string> {
    const rounds = Number(
      this.config.get<string>('BCRYPT_SALT_ROUNDS') ?? '10',
    );
    return bcrypt.hash(password, rounds);
  }

  async createAccount(accountDto: AccountDto): Promise<Account> {
    const { name, wabaId, phoneE164, assignToUserId } = accountDto;

    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({
        where: { id: assignToUserId },
      });

      if (!user) throw new NotFoundException('User not found');

      if (user.role !== Role.SALES) {
        throw new BadRequestException(
          'Only SALES users can be assigned an account',
        );
      }

      if (user.accountId) {
        throw new BadRequestException(
          'This SALES user already has an assigned account',
        );
      }

      const existingAccount = await tx.account.findUnique({
        where: {
          wabaId_phoneE164: {
            wabaId,
            phoneE164,
          },
        },
      });

      if (existingAccount) {
        throw new BadRequestException(
          'An account with this wabaId and phone already exists',
        );
      }

      const account = await tx.account.create({
        data: {
          name,
          wabaId,
          phoneE164,
        },
      });

      await tx.user.update({
        where: { id: assignToUserId },
        data: {
          accountId: account.id,
        },
      });

      return account;
    });
  }

  async findAllAccountsForAdmin(query: FindAccountsQueryDto) {
    const where: any = {};

    if (query?.search) {
      where.OR = [
        { name: { contains: query.search, mode: 'insensitive' } },
        { wabaId: { contains: query.search, mode: 'insensitive' } },
        { phoneE164: { contains: query.search, mode: 'insensitive' } },
        {
          user: {
            email: { contains: query.search, mode: 'insensitive' },
          },
        },
      ];
    }

    if (query?.isActive !== undefined) {
      const activeValue = query.isActive === 'true';
      where.user = {
        ...(where.user ?? {}),
        isActive: activeValue,
      };
    }

    return this.prisma.account.findMany({
      where,
      orderBy: {
        createdAt: 'desc',
      },
      select: {
        id: true,
        name: true,
        wabaId: true,
        phoneE164: true,
        createdAt: true,
        updatedAt: true,
        user: {
          select: {
            id: true,
            email: true,
            role: true,
            isActive: true,
            createdAt: true,
            updatedAt: true,
          },
        },
      },
    });
  }

  async findAccountByIdForAdmin(accountId: string) {
    const account = await this.prisma.account.findUnique({
      where: { id: accountId },
      select: {
        id: true,
        name: true,
        wabaId: true,
        phoneE164: true,
        createdAt: true,
        updatedAt: true,
        user: {
          select: {
            id: true,
            email: true,
            role: true,
            isActive: true,
            createdAt: true,
            updatedAt: true,
          },
        },
      },
    });

    if (!account) {
      throw new NotFoundException('Account not found');
    }

    return account;
  }

  async updateAccountAndUser(accountId: string, dto: UpdateAccountWithUserDto) {
    const account = await this.prisma.account.findUnique({
      where: { id: accountId },
      include: { user: true },
    });

    if (!account) {
      throw new NotFoundException('Account not found');
    }

    if (!account.user) {
      throw new BadRequestException('This account has no associated user');
    }

    if (dto.email && dto.email !== account.user.email) {
      const existingUser = await this.prisma.user.findUnique({
        where: { email: dto.email },
      });

      if (existingUser && existingUser.id !== account.user.id) {
        throw new BadRequestException('Email already registered');
      }
    }

    const nextWabaId = dto.wabaId ?? account.wabaId;
    const nextPhoneE164 = dto.phoneE164 ?? account.phoneE164;

    if (nextWabaId !== account.wabaId || nextPhoneE164 !== account.phoneE164) {
      const existingAccount = await this.prisma.account.findUnique({
        where: {
          wabaId_phoneE164: {
            wabaId: nextWabaId,
            phoneE164: nextPhoneE164,
          },
        },
      });

      if (existingAccount && existingAccount.id !== account.id) {
        throw new BadRequestException(
          'An account with this wabaId and phone already exists',
        );
      }
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.account.update({
        where: { id: accountId },
        data: {
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(dto.wabaId !== undefined ? { wabaId: dto.wabaId } : {}),
          ...(dto.phoneE164 !== undefined ? { phoneE164: dto.phoneE164 } : {}),
        },
      });

      const userData: Record<string, any> = {
        ...(dto.email !== undefined ? { email: dto.email } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      };

      if (dto.password) {
        userData.passwordHash = await this.hashPassword(dto.password);
      }

      if (Object.keys(userData).length > 0) {
        await tx.user.update({
          where: { id: account.user!.id },
          data: userData,
        });
      }

      return tx.account.findUnique({
        where: { id: accountId },
        select: {
          id: true,
          name: true,
          wabaId: true,
          phoneE164: true,
          createdAt: true,
          updatedAt: true,
          user: {
            select: {
              id: true,
              email: true,
              role: true,
              isActive: true,
              createdAt: true,
              updatedAt: true,
            },
          },
        },
      });
    });
  }

  async deactivateAccountUser(accountId: string) {
    const account = await this.prisma.account.findUnique({
      where: { id: accountId },
      include: { user: true },
    });

    if (!account) {
      throw new NotFoundException('Account not found');
    }

    if (!account.user) {
      throw new BadRequestException('This account has no associated user');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: account.user!.id },
        data: { isActive: false },
      });

      await tx.refreshToken.updateMany({
        where: {
          userId: account.user!.id,
          revokedAt: null,
        },
        data: {
          revokedAt: new Date(),
        },
      });
    });

    return {
      message: 'Associated user deactivated successfully',
    };
  }

  async findAccountLeadsForAdmin(accountId: string) {
    const account = await this.prisma.account.findUnique({
      where: { id: accountId },
      select: {
        id: true,
      },
    });

    if (!account) {
      throw new NotFoundException('Account not found');
    }

    return this.prisma.lead.findMany({
      where: {
        accountId,
      },
      orderBy: {
        createdAt: 'desc',
      },
      select: {
        id: true,
        name: true,
        phoneE164: true,
        email: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        lastInboundAt: true,
        lastOutboundAt: true,
        lastMessageAt: true,
      },
    });
  }

  async getMyProfile(userId: string) {
    Logger.debug(`Fetching profile for user ID: ${userId}`, 'AccountsService.getMyProfile');
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        role: true,
        isActive: true,
        accountId: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (!user.isActive) {
      throw new ForbiddenException(
        'Tu cuenta está desactivada. Contacta al administrador.',
      );
    }

    const account = user.accountId
      ? await this.prisma.account.findUnique({
          where: { id: user.accountId },
          select: {
            id: true,
            name: true,
            wabaId: true,
            phoneE164: true,
            createdAt: true,
            updatedAt: true,
          },
        })
      : null;

    return {
      user,
      account,
    };
  }

  async getMyLeads(userId: string) {
    Logger.debug(`Fetching leads for user ID: ${userId}`, 'AccountsService.getMyLeads');
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        role: true,
        isActive: true,
        accountId: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (!user.isActive) {
      throw new ForbiddenException(
        'Tu cuenta está desactivada. Contacta al administrador.',
      );
    }

    if (user.role !== Role.SALES) {
      throw new ForbiddenException('Only SALES users can access their leads');
    }

    if (!user.accountId) {
      throw new BadRequestException('Your user has no associated account');
    }

    const leads = await this.prisma.lead.findMany({
      where: {
        accountId: user.accountId,
      },
      orderBy: {
        createdAt: 'desc',
      },
      select: {
        id: true,
        name: true,
        phoneE164: true,
        email: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        lastInboundAt: true,
        lastOutboundAt: true,
        lastMessageAt: true,
      },
    });

    return {
      accountId: user.accountId,
      leads,
    };
  }
}
