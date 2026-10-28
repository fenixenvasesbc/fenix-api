import {
  Controller,
  ForbiddenException,
  Post,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Role } from '@prisma/client';
import { memoryStorage } from 'multer';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { MediaUploadService } from './media-upload.service';
import { Roles } from '../auth/decorators/roles.decorator';

type AuthUser = {
  userId: string;
  role: Role;
  accountId?: string | null;
};

@Controller('media')
@UseGuards(JwtAuthGuard, RolesGuard)
export class MediaUploadController {
  constructor(private readonly mediaUploadService: MediaUploadService) {}

  @Roles(Role.ADMIN, Role.SALES, Role.DESIGNER, Role.DESIGNER_MANAGER)
  @Post('upload')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: {
        fileSize: 100 * 1024 * 1024,
      },
    }),
  )
  async upload(
    @UploadedFile() file: Express.Multer.File,
    @Query('accountId') accountIdFromQuery: string | undefined,
    @Req() req: { user: AuthUser },
  ) {
    const accountId = this.resolveAccountId(req.user, accountIdFromQuery);

    return this.mediaUploadService.uploadToYcloud({
      accountId,
      file,
    });
  }

  // Adjuntos internos (hoy: tablero de bocetos) que no deben depender de
  // YCloud -- ver el comentario largo en MediaUploadService.uploadInternal.
  // Mismos roles/resolucion de accountId que /media/upload.
  @Roles(Role.ADMIN, Role.SALES, Role.DESIGNER, Role.DESIGNER_MANAGER)
  @Post('upload-internal')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: {
        fileSize: 100 * 1024 * 1024,
      },
    }),
  )
  async uploadInternal(
    @UploadedFile() file: Express.Multer.File,
    @Query('accountId') accountIdFromQuery: string | undefined,
    @Req() req: { user: AuthUser },
  ) {
    const accountId = this.resolveAccountId(req.user, accountIdFromQuery);

    return this.mediaUploadService.uploadInternal({
      accountId,
      file,
    });
  }

  private resolveAccountId(user: AuthUser, accountIdFromQuery?: string): string {
    // Pedido explicito del usuario, 28/oct/2026: SALES_MANAGER puede subir
    // adjuntos (ej. al chatear) para CUALQUIER comercial de la
    // organizacion, cuando la UI le pasa un accountId explicito -- antes
    // esta rama ignoraba por completo accountIdFromQuery para SALES/
    // SALES_MANAGER y siempre usaba user.accountId, lo que habria subido
    // el adjunto a la cuenta equivocada al chatear como otra comercial.
    // Si no manda accountId, cae a su propia cuenta (SALES se queda
    // exactamente igual que antes).
    if (user.role === Role.SALES_MANAGER) {
      if (accountIdFromQuery) {
        return accountIdFromQuery;
      }

      if (user.accountId) {
        return user.accountId;
      }

      throw new ForbiddenException('User has no accountId');
    }

    if (user.role === Role.SALES) {
      if (!user.accountId) {
        throw new ForbiddenException('User has no accountId');
      }

      return user.accountId;
    }

    // SUPPORT ve todo lo que ve ADMIN (herencia de roles en el backend).
    // DESIGNER/DESIGNER_MANAGER no tienen accountId propio (no son cuentas
    // comerciales): suben adjuntos para una DesignRequest puntual, y el
    // frontend manda el accountId de esa solicitud (ver
    // DesignRequestAttachmentPicker), igual que hace ADMIN.
    if (
      user.role === Role.ADMIN ||
      user.role === Role.SUPPORT ||
      user.role === Role.DESIGNER ||
      user.role === Role.DESIGNER_MANAGER
    ) {
      if (!accountIdFromQuery) {
        throw new ForbiddenException(
          'Upload requires accountId context for now',
        );
      }

      return accountIdFromQuery;
    }

    throw new ForbiddenException('Invalid role');
  }
}
