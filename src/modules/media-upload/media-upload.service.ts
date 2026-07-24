import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { MediaUploadStatus, ProviderType } from '@prisma/client';
import { YcloudService } from '../ycloud/ycloud.service';
import { PrismaService } from 'src/prisma/prisma.service';
import { MessageMediaService } from '../message-media/message-media.service';

@Injectable()
export class MediaUploadService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ycloudService: YcloudService,
    private readonly messageMedia: MessageMediaService,
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
      'video/mp4',
      'video/3gpp',
      'audio/aac',
      'audio/mp4',
      'audio/mpeg',
      'audio/amr',
      'audio/ogg',
      'audio/webm',
      'text/plain',
      'application/pdf',
      'application/msword',
      'application/vnd.ms-excel',
      'application/vnd.ms-powerpoint',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
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

    const storedMedia = await this.messageMedia.storeUploadedMedia({
      accountId,
      file,
    });

    const mediaUpload = await this.prisma.mediaUpload.create({
      data: {
        accountId,
        provider: ProviderType.YCLOUD,
        originalName: file.originalname,
        mimeType: file.mimetype,
        sizeBytes: file.size,
        mediaUrl: storedMedia?.mediaUrl ?? null,
        mediaStorageDriver: storedMedia?.mediaStorageDriver ?? null,
        mediaStorageKey: storedMedia?.mediaStorageKey ?? null,
        mediaExpiresAt: storedMedia?.mediaExpiresAt ?? null,
        status: MediaUploadStatus.UPLOADED,
      },
      select: { id: true },
    });

    try {
      const response = await this.ycloudService.uploadMedia({
        accountId,
        phoneNumber: account.phoneE164,
        file,
      });
      const mediaId = this.extractMediaId(response);

      await this.prisma.mediaUpload.update({
        where: { id: mediaUpload.id },
        data: {
          providerMediaId: mediaId,
          status: MediaUploadStatus.UPLOADED,
          lastError: null,
        },
      });

      return {
        provider: 'YCLOUD',
        accountId,
        mediaUploadId: mediaUpload.id,
        phoneE164: account.phoneE164,
        originalName: file.originalname,
        mimeType: file.mimetype,
        size: file.size,
        mediaId,
        mediaUrl: storedMedia?.mediaUrl ?? null,
        mediaStorageDriver: storedMedia?.mediaStorageDriver ?? null,
        mediaStorageKey: storedMedia?.mediaStorageKey ?? null,
        mediaSizeBytes: storedMedia?.mediaSizeBytes ?? null,
        mediaStoredAt: storedMedia?.mediaStoredAt?.toISOString() ?? null,
        mediaExpiresAt: storedMedia?.mediaExpiresAt?.toISOString() ?? null,
        ycloud: response,
      };
    } catch (error) {
      await this.prisma.mediaUpload.update({
        where: { id: mediaUpload.id },
        data: {
          status: MediaUploadStatus.FAILED,
          lastError: this.formatError(error),
        },
      });

      throw error;
    }
  }

  private extractMediaId(response: unknown): string | null {
    if (!response || typeof response !== 'object') return null;
    const candidate = response as {
      id?: unknown;
      mediaId?: unknown;
      media_id?: unknown;
    };

    for (const value of [candidate.id, candidate.mediaId, candidate.media_id]) {
      if (typeof value === 'string' && value.trim()) return value.trim();
    }

    return null;
  }

  private formatError(error: unknown) {
    if (error instanceof Error) return error.message;
    return String(error);
  }
}
