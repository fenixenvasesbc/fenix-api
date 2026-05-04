import {
  Controller,
  ForbiddenException,
  Post,
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

  @Roles(Role.ADMIN, Role.SALES)
  @Post('upload')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: {
        fileSize: 16 * 1024 * 1024,
      },
    }),
  )
  async upload(
    @UploadedFile() file: Express.Multer.File,
    @Req() req: { user: AuthUser },
  ) {
    const accountId = this.resolveAccountId(req.user);

    return this.mediaUploadService.uploadToYcloud({
      accountId,
      file,
    });
  }

  private resolveAccountId(user: AuthUser): string {
    if (user.role === Role.SALES) {
      if (!user.accountId) {
        throw new ForbiddenException('User has no accountId');
      }

      return user.accountId;
    }

    if (user.role === Role.ADMIN) {
      if (!user.accountId) {
        throw new ForbiddenException(
          'Admin upload requires accountId context for now',
        );
      }

      return user.accountId;
    }

    throw new ForbiddenException('Invalid role');
  }
}
