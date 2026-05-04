import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { YcloudService } from '../ycloud/ycloud.service';
import { PrismaService } from 'src/prisma/prisma.service';

@Injectable()
export class MediaUploadService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ycloudService: YcloudService,
  ) {}

  async uploadToYcloud(input: {
    accountId: string;
    file: Express.Multer.File;
  }) {
    const { accountId, file } = input;

    if (!file) {
      throw new BadRequestException('file is required');
    }

    const allowedMimeTypes = [
      'image/jpeg',
      'image/png',
      'image/webp',
      'application/pdf',
    ];

    if (!allowedMimeTypes.includes(file.mimetype)) {
      throw new BadRequestException(`Unsupported file type: ${file.mimetype}`);
    }

    const account = await this.prisma.account.findUnique({
      where: { id: accountId },
      select: {
        id: true,
        phoneE164: true,
      },
    });

    if (!account) {
      throw new NotFoundException('Account not found');
    }

    if (!account.phoneE164) {
      throw new BadRequestException('Account has no phoneE164');
    }

    const response = await this.ycloudService.uploadMedia({
      accountId,
      phoneNumber: account.phoneE164,
      file,
    });

    return {
      provider: 'YCLOUD',
      accountId,
      phoneE164: account.phoneE164,
      originalName: file.originalname,
      mimeType: file.mimetype,
      size: file.size,
      ycloud: response,
    };
  }
}
