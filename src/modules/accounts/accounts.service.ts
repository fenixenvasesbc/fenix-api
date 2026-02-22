import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { Role, Account } from '@prisma/client';
import { AccountDto } from './dto/account.dto';

@Injectable()
export class AccountsService {

    constructor(private readonly prisma: PrismaService) {}

    async createAccount(accountDto: AccountDto): Promise<Account> {
        const { name, wabaId, phoneE164, assignToUserId } = accountDto;
        return this.prisma.$transaction(async (tx) => {
        // 1) validar user SALES
        const user = await tx.user.findUnique({ where: { id: assignToUserId } });
        if (!user) throw new NotFoundException('User not found');
        if (user.role !== Role.SALES) {
            throw new BadRequestException('Only SALES users can be assigned an account');
        }
        if (user.accountId) {
            throw new BadRequestException('This SALES user already has an assigned account');
        }
        const existingAccount = await tx.account.findUnique({
            where: { wabaId_phoneE164: { wabaId, phoneE164 } },
        });
        if (existingAccount) {
            throw new BadRequestException('An account with this wabaId and phone already exists');
        }
        const account = await tx.account.create({
            data: { name, wabaId, phoneE164 },
        });
        await tx.user.update({
            where: { id: assignToUserId },
            data: { accountId: account.id },
        });
        return account;
        });
    }
}
