import { Role } from '@prisma/client';
import { Controller,  Body, UseGuards, Post} from '@nestjs/common';
import { Roles } from '../auth/decorators/roles.decorator';
import { AccountDto } from './dto/account.dto';
import { AccountsService } from './accounts.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';

@Controller('accounts')
export class AccountsController {
    constructor(private readonly accountService: AccountsService) {}

    // Protegido: SOLO ADMIN puede crear Account
    @UseGuards(JwtAuthGuard, RolesGuard)
    @Roles(Role.ADMIN)
    @Post('create/')
    createAccount(@Body() dto: AccountDto) {
        return this.accountService.createAccount(dto);
    }

}
