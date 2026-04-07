import {
  Controller,
  Body,
  UseGuards,
  Post,
  Get,
  Patch,
  Param,
  Query,
  Req,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import {
  AccountDto,
  UpdateAccountWithUserDto,
  AccountIdParamDto,
  FindAccountsQueryDto,
} from './dto/account.dto';
import { AccountsService } from './accounts.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';

@Controller('accounts')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AccountsController {
  constructor(private readonly accountService: AccountsService) {}

  @Roles(Role.SALES)
  @Get('me/profile')
  getMyProfile(@Req() req: any) {
    return this.accountService.getMyProfile(req.user.userId);
  }

  @Roles(Role.SALES)
  @Get('me/leads')
  getMyLeads(@Req() req: any) {
    return this.accountService.getMyLeads(req.user.userId);
  }

  @Roles(Role.ADMIN)
  @Post('create')
  createAccount(@Body() dto: AccountDto) {
    return this.accountService.createAccount(dto);
  }

  @Roles(Role.ADMIN)
  @Get()
  findAllAccounts(@Query() query: FindAccountsQueryDto) {
    return this.accountService.findAllAccountsForAdmin(query);
  }

  @Roles(Role.ADMIN)
  @Get(':id')
  findAccountById(@Param() params: AccountIdParamDto) {
    return this.accountService.findAccountByIdForAdmin(params.id);
  }

  @Roles(Role.ADMIN)
  @Get(':id/leads')
  findAccountLeads(@Param() params: AccountIdParamDto) {
    return this.accountService.findAccountLeadsForAdmin(params.id);
  }

  @Roles(Role.ADMIN)
  @Patch(':id')
  updateAccountAndUser(
    @Param() params: AccountIdParamDto,
    @Body() dto: UpdateAccountWithUserDto,
  ) {
    return this.accountService.updateAccountAndUser(params.id, dto);
  }

  @Roles(Role.ADMIN)
  @Patch(':id/deactivate')
  deactivateAccountUser(@Param() params: AccountIdParamDto) {
    return this.accountService.deactivateAccountUser(params.id);
  }
}
