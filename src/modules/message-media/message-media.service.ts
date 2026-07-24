import { Injectable, Logger } from '@nestjs/common';
import { MediaUploadStatus, MessageType } from '@prisma/client';
import axios from 'axios';
import { randomUUID } from 'crypto';
import { mkdir, readFile, stat, unlink, writeFile } from 'fs/promises';
import { dirname, normalize, resolve } from 'path';
import { PrismaService } from 'src/prisma/prisma.service';

type ArchiveMessageMediaInput = {
  accountId: string;
  messageId: string;
  sourceUrl?: string | null;
  mimeType?: string | null;
  fileName?: string | null;
  messageType: MessageType;
  providerEventId?: string | null;
};

type StoreUploadedMediaInput = {
  accountId: string;
  file: Express.Multer.File;
};

@Injectable()
export class MessageMediaService {
  private readonly logger = new Logger(MessageMediaService.name);
  private readonly driver = process.env.MEDIA_STORAGE_DRIVER ?? 'local';
  private readonly localDir =
    process.env.MEDIA_STORAGE_LOCAL_DIR ?? '/app/storage/media';
  private readonly publicBaseUrl =
    process.env.MEDIA_PUBLIC_BASE_URL ?? '/media-files';
  private readonly maxFileBytes =
    this.toPositiveInt(process.env.MEDIA_MAX_FILE_MB, 25) * 1024 * 1024;
  private readonly retentionDays = this.toPositiveInt(
    process.env.MEDIA_RETENTION_DAYS,
    180,
  );
  private readonly downloadTimeoutMs = this.toPositiveInt(
    process.env.MEDIA_DOWNLOAD_TIMEOUT_MS,
    30000,
  );

  constructor(private readonly prisma: PrismaService) {}

  async archiveMessageMedia(input: ArchiveMessageMediaInput) {
    if (this.driver !== 'local') return null;

    const sourceUrl = this.nonEmpty(input.sourceUrl);
    if (!sourceUrl || this.isOwnMediaUrl(sourceUrl)) return null;

    try {
      const downloaded = await this.download(sourceUrl);
      const mimeType =
        this.nonEmpty(input.mimeType) ??
        this.nonEmpty(downloaded.mimeType) ??
        'application/octet-stream';
      const extension = this.resolveExtension({
        fileName: input.fileName,
        mimeType,
        sourceUrl,
        messageType: input.messageType,
      });
      const now = new Date();
      const expiresAt = new Date(
        now.getTime() + this.retentionDays * 24 * 60 * 60 * 1000,
      );
      const key = this.buildStorageKey({
        accountId: input.accountId,
        messageId: input.messageId,
        extension,
        now,
      });
      const absolutePath = this.resolveLocalPath(key);

      await mkdir(dirname(absolutePath), { recursive: true });
      await writeFile(absolutePath, downloaded.buffer);

      const publicUrl = this.buildPublicUrl(key);

      await this.prisma.message.update({
        where: { id: input.messageId },
        data: {
          mediaUrl: publicUrl,
          mediaOriginalUrl: sourceUrl,
          mediaStorageDriver: 'local',
          mediaStorageKey: key,
          mediaSizeBytes: downloaded.buffer.length,
          mediaStoredAt: now,
          mediaExpiresAt: expiresAt,
          mimeType,
        },
      });

      this.logger.log(
        `Message media archived messageId=${input.messageId} accountId=${input.accountId} key=${key} size=${downloaded.buffer.length}`,
      );

      return {
        mediaUrl: publicUrl,
        mediaOriginalUrl: sourceUrl,
        mediaStorageDriver: 'local',
        mediaStorageKey: key,
        mediaSizeBytes: downloaded.buffer.length,
        mediaStoredAt: now,
        mediaExpiresAt: expiresAt,
      };
    } catch (error) {
      this.logger.warn(
        `Message media archive failed messageId=${input.messageId} accountId=${input.accountId} providerEventId=${input.providerEventId ?? '-'} reason=${this.formatError(error)}`,
      );
      return null;
    }
  }

  async storeUploadedMedia(input: StoreUploadedMediaInput) {
    if (this.driver !== 'local') return null;

    const now = new Date();
    const expiresAt = new Date(
      now.getTime() + this.retentionDays * 24 * 60 * 60 * 1000,
    );
    const extension = this.resolveExtension({
      fileName: input.file.originalname,
      mimeType: input.file.mimetype,
      sourceUrl: input.file.originalname,
      messageType: this.mapMimeToMessageType(input.file.mimetype),
    });
    const key = this.buildStorageKey({
      accountId: input.accountId,
      messageId: 'upload',
      extension,
      now,
    });
    const absolutePath = this.resolveLocalPath(key);

    await mkdir(dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, input.file.buffer);

    return {
      mediaUrl: this.buildPublicUrl(key),
      mediaStorageDriver: 'local',
      mediaStorageKey: key,
      mediaSizeBytes: input.file.size,
      mediaStoredAt: now,
      mediaExpiresAt: expiresAt,
      mimeType: input.file.mimetype,
      fileName: input.file.originalname,
    };
  }

  async getLocalMedia(key: string) {
    const safeKey = this.normalizeStorageKey(key);
    const absolutePath = this.resolveLocalPath(safeKey);
    const [metadata, buffer] = await Promise.all([
      stat(absolutePath),
      readFile(absolutePath),
    ]);

    return {
      buffer,
      size: metadata.size,
      mimeType: this.resolveMimeTypeFromKey(safeKey),
    };
  }

  async cleanupExpiredLocalMedia(limit = 500) {
    if (this.driver !== 'local') return { inspected: 0, deleted: 0, failed: 0 };

    const now = new Date();
    const expired = await this.prisma.message.findMany({
      where: {
        mediaStorageDriver: 'local',
        mediaStorageKey: { not: null },
        mediaExpiresAt: { lte: now },
        mediaExpiredAt: null,
      },
      select: {
        id: true,
        mediaStorageKey: true,
      },
      take: limit,
      orderBy: { mediaExpiresAt: 'asc' },
    });

    let deleted = 0;
    let failed = 0;

    for (const message of expired) {
      const key = message.mediaStorageKey;
      if (!key) continue;

      try {
        await unlink(this.resolveLocalPath(key)).catch((error: any) => {
          if (error?.code !== 'ENOENT') throw error;
        });

        await this.prisma.message.update({
          where: { id: message.id },
          data: {
            mediaUrl: null,
            mediaStorageKey: null,
            mediaStorageDriver: null,
            mediaExpiredAt: now,
          },
        });

        deleted += 1;
      } catch (error) {
        failed += 1;
        this.logger.warn(
          `Expired media cleanup failed messageId=${message.id} key=${key} reason=${this.formatError(error)}`,
        );
      }
    }

    const remainingLimit = Math.max(limit - expired.length, 0);
    const expiredUploads =
      remainingLimit > 0
        ? await this.prisma.mediaUpload.findMany({
            where: {
              status: {
                in: [MediaUploadStatus.UPLOADED, MediaUploadStatus.FAILED],
              },
              mediaStorageDriver: 'local',
              mediaStorageKey: { not: null },
              mediaExpiresAt: { lte: now },
              expiredAt: null,
            },
            select: {
              id: true,
              mediaStorageKey: true,
            },
            take: remainingLimit,
            orderBy: { mediaExpiresAt: 'asc' },
          })
        : [];

    for (const upload of expiredUploads) {
      const key = upload.mediaStorageKey;
      if (!key) continue;

      try {
        await unlink(this.resolveLocalPath(key)).catch((error: any) => {
          if (error?.code !== 'ENOENT') throw error;
        });

        await this.prisma.mediaUpload.update({
          where: { id: upload.id },
          data: {
            status: MediaUploadStatus.EXPIRED,
            mediaUrl: null,
            mediaStorageKey: null,
            mediaStorageDriver: null,
            expiredAt: now,
          },
        });

        deleted += 1;
      } catch (error) {
        failed += 1;
        this.logger.warn(
          `Expired media upload cleanup failed mediaUploadId=${upload.id} key=${key} reason=${this.formatError(error)}`,
        );
      }
    }

    const inspected = expired.length + expiredUploads.length;

    if (inspected > 0) {
      this.logger.log(
        `Expired media cleanup finished inspected=${inspected} deleted=${deleted} failed=${failed}`,
      );
    }

    return { inspected, deleted, failed };
  }

  private async download(sourceUrl: string) {
    const response = await axios.get<ArrayBuffer>(sourceUrl, {
      responseType: 'arraybuffer',
      timeout: this.downloadTimeoutMs,
      maxContentLength: this.maxFileBytes,
      maxBodyLength: this.maxFileBytes,
      validateStatus: (status) => status >= 200 && status < 300,
    });

    const buffer = Buffer.from(response.data);
    if (buffer.length > this.maxFileBytes) {
      throw new Error(`Downloaded media exceeds ${this.maxFileBytes} bytes`);
    }

    return {
      buffer,
      mimeType:
        typeof response.headers['content-type'] === 'string'
          ? response.headers['content-type'].split(';')[0]
          : null,
    };
  }

  private buildStorageKey(input: {
    accountId: string;
    messageId: string;
    extension: string;
    now: Date;
  }) {
    const year = String(input.now.getUTCFullYear());
    const month = String(input.now.getUTCMonth() + 1).padStart(2, '0');
    return [
      this.safeSegment(input.accountId),
      year,
      month,
      `${this.safeSegment(input.messageId)}-${randomUUID()}${input.extension}`,
    ].join('/');
  }

  private resolveLocalPath(key: string) {
    const safeKey = this.normalizeStorageKey(key);
    const root = resolve(this.localDir);
    const absolutePath = resolve(root, safeKey);

    if (!absolutePath.startsWith(root)) {
      throw new Error('Invalid media storage key');
    }

    return absolutePath;
  }

  private normalizeStorageKey(key: string) {
    const normalized = normalize(key).replace(/^(\.\.(\/|\\|$))+/, '');
    if (normalized.includes('..')) throw new Error('Invalid media storage key');
    return normalized.replace(/\\/g, '/');
  }

  private buildPublicUrl(key: string) {
    const base = this.publicBaseUrl.replace(/\/+$/, '');
    const encodedKey = key
      .split('/')
      .map((segment) => encodeURIComponent(segment))
      .join('/');
    return `${base}/${encodedKey}`;
  }

  private isOwnMediaUrl(url: string) {
    const base = this.publicBaseUrl.replace(/\/+$/, '');
    return base !== '' && url.startsWith(`${base}/`);
  }

  private resolveExtension(input: {
    fileName?: string | null;
    mimeType: string;
    sourceUrl: string;
    messageType: MessageType;
  }) {
    const fromName =
      this.extensionFromText(input.fileName) ??
      this.extensionFromText(input.sourceUrl.split('?')[0]);
    if (fromName) return fromName;

    const fromMime = this.extensionFromMime(input.mimeType);
    if (fromMime) return fromMime;

    switch (input.messageType) {
      case MessageType.IMAGE:
        return '.jpg';
      case MessageType.AUDIO:
        return '.ogg';
      case MessageType.VIDEO:
        return '.mp4';
      case MessageType.DOCUMENT:
        return '.bin';
      default:
        return '.bin';
    }
  }

  private mapMimeToMessageType(mimeType: string) {
    if (mimeType.startsWith('image/')) return MessageType.IMAGE;
    if (mimeType.startsWith('audio/')) return MessageType.AUDIO;
    if (mimeType.startsWith('video/')) return MessageType.VIDEO;
    return MessageType.DOCUMENT;
  }

  private extensionFromText(value?: string | null) {
    const text = this.nonEmpty(value);
    if (!text) return null;
    const match = text.match(/\.([a-zA-Z0-9]{2,8})$/);
    return match ? `.${match[1].toLowerCase()}` : null;
  }

  private extensionFromMime(mimeType: string) {
    const map: Record<string, string> = {
      'image/jpeg': '.jpg',
      'image/png': '.png',
      'image/webp': '.webp',
      'image/gif': '.gif',
      'audio/ogg': '.ogg',
      'audio/mpeg': '.mp3',
      'audio/mp4': '.m4a',
      'audio/webm': '.webm',
      'video/mp4': '.mp4',
      'application/pdf': '.pdf',
    };
    return map[mimeType.toLowerCase()] ?? null;
  }

  private resolveMimeTypeFromKey(key: string) {
    const extension = this.extensionFromText(key);
    const map: Record<string, string> = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.webp': 'image/webp',
      '.gif': 'image/gif',
      '.ogg': 'audio/ogg',
      '.mp3': 'audio/mpeg',
      '.m4a': 'audio/mp4',
      '.webm': 'audio/webm',
      '.mp4': 'video/mp4',
      '.pdf': 'application/pdf',
    };
    return extension
      ? (map[extension] ?? 'application/octet-stream')
      : 'application/octet-stream';
  }

  private safeSegment(value: string) {
    return value.replace(/[^a-zA-Z0-9_-]/g, '_');
  }

  private nonEmpty(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }

  private toPositiveInt(value: string | undefined, fallback: number) {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
  }

  private formatError(error: unknown) {
    if (error instanceof Error) return error.message;
    return String(error);
  }
}
