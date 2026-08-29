import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { OutboundService } from './outbound.service';
import {
  CreateTemplateDto,
  DeleteTemplateQueryDto,
  ListOutboundTemplatesQueryDto,
  SendMediaDto,
  SendTemplateDto,
  SendTextDto,
} from './dto/outbound-message.dto';

type AuthUser = {
  userId: string;
  role: Role;
  accountId?: string | null;
};

@Controller('outbound')
@UseGuards(JwtAuthGuard, RolesGuard)
export class OutboundController {
  constructor(private readonly outboundMessageService: OutboundService) {}

  @Roles(Role.ADMIN, Role.SALES)
  @Get('templates')
  listTemplates(
    @Query() query: ListOutboundTemplatesQueryDto,
    @Req() req: { user: AuthUser },
  ) {
    const accountId = this.resolveAccountId(req.user, query.accountId);

    return this.outboundMessageService.listTemplates({
      accountId,
      search: query.search ?? null,
      category: query.category ?? null,
      language: query.language ?? null,
      status: query.status ?? 'APPROVED',
      limit: query.limit ?? 20,
      offset: query.offset ?? 0,
    });
  }

  @Roles(Role.ADMIN, Role.SALES)
  @Post('template')
  sendTemplate(@Body() body: SendTemplateDto, @Req() req: { user: AuthUser }) {
    const accountId = this.resolveAccountId(req.user, body.accountId);

    return this.outboundMessageService.sendTemplateMessage({
      accountId,
      leadId: body.leadId,
      clientRequestId: body.clientRequestId,
      templateName: body.templateName,
      languageCode: body.languageCode ?? null,
    });
  }

  @Roles(Role.ADMIN, Role.SALES)
  @Post('text')
  sendText(@Body() body: SendTextDto, @Req() req: { user: AuthUser }) {
    const accountId = this.resolveAccountId(req.user, body.accountId);

    return this.outboundMessageService.sendTextMessage({
      accountId,
      leadId: body.leadId,
      clientRequestId: body.clientRequestId,
      text: body.text,
    });
  }
  @Roles(Role.ADMIN, Role.SALES)
  @Post('media')
  sendMedia(@Body() body: SendMediaDto, @Req() req: { user: AuthUser }) {
    const accountId = this.resolveAccountId(req.user, body.accountId);

    return this.outboundMessageService.sendMediaMessage({
      accountId,
      leadId: body.leadId,
      clientRequestId: body.clientRequestId,
      type: body.type,
      mediaUrl: body.mediaUrl,
      providerMediaId: body.providerMediaId ?? null,
      mediaUploadId: body.mediaUploadId ?? null,
      mediaStorageKey: body.mediaStorageKey ?? null,
      mediaSizeBytes: body.mediaSizeBytes ?? null,
      mediaExpiresAt: body.mediaExpiresAt ?? null,
      caption: body.caption ?? null,
      fileName: body.fileName ?? null,
    });
  }

  // Gestion de plantillas de WhatsApp (crear/borrar). Solo ADMIN y
  // SALES_MANAGER pueden gestionarlas; un SALES normal solo puede listarlas
  // y usarlas para enviar (ver @Roles arriba en listTemplates/sendTemplate).
  @Roles(Role.ADMIN, Role.SALES_MANAGER)
  @Post('templates')
  createTemplate(@Body() body: CreateTemplateDto, @Req() req: { user: AuthUser }) {
    const accountId = this.resolveAccountId(req.user, body.accountId);

    return this.outboundMessageService.createTemplate({
      accountId,
      name: body.name,
      language: body.language,
      category: body.category,
      headerText: body.headerText ?? null,
      headerFormat: body.headerFormat ?? null,
      headerMediaUrl: body.headerMediaUrl ?? null,
      bodyText: body.bodyText,
      bodyExamples: body.bodyExamples ?? null,
      footerText: body.footerText ?? null,
      buttons:
        body.buttons?.map((button) => ({
          type: button.type,
          text: button.text,
          url: button.url ?? null,
          phoneNumber: button.phoneNumber ?? null,
        })) ?? null,
    });
  }

  @Roles(Role.ADMIN, Role.SALES_MANAGER)
  @Delete('templates/:name')
  deleteTemplate(
    @Param('name') name: string,
    @Query() query: DeleteTemplateQueryDto,
    @Req() req: { user: AuthUser },
  ) {
    const accountId = this.resolveAccountId(req.user, query.accountId);

    return this.outboundMessageService.deleteTemplate({
      accountId,
      name,
      language: query.language,
    });
  }

  private resolveAccountId(user: AuthUser, accountIdFromBody?: string): string {
    if (user.role === Role.ADMIN) {
      if (!accountIdFromBody) {
        throw new ForbiddenException(
          'accountId is required for admin requests',
        );
      }

      return accountIdFromBody;
    }

    if (user.role === Role.SALES || user.role === Role.SALES_MANAGER) {
      if (!user.accountId) {
        throw new ForbiddenException('User has no accountId');
      }

      if (accountIdFromBody && accountIdFromBody !== user.accountId) {
        throw new ForbiddenException(
          'You cannot send messages from another account',
        );
      }

      return user.accountId;
    }

    throw new ForbiddenException('Invalid role');
  }
}
