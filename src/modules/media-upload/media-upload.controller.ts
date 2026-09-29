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

  private resolveAccountId(user: AuthUser, accountIdFromQuery?: string): string {
    if (user.role === Role.SALES || user.role === Role.SALES_MANAGER) {
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
