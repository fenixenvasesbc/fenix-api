import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ProviderType } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { YcloudService } from '../ycloud/ycloud.service';
import { MessageMediaService } from '../message-media/message-media.service';
import { MediaUploadService } from './media-upload.service';

function buildFile(overrides: Partial<Express.Multer.File> = {}): Express.Multer.File {
  return {
    fieldname: 'file',
    originalname: 'nota.ogg',
    encoding: '7bit',
    mimetype: 'audio/webm',
    size: 1234,
    buffer: Buffer.from('fake'),
    stream: undefined as unknown as Express.Multer.File['stream'],
    destination: '',
    filename: '',
    path: '',
    ...overrides,
  };
}

describe('MediaUploadService', () => {
  let service: MediaUploadService;
  let prisma: {
    account: { findUnique: jest.Mock };
    mediaUpload: { create: jest.Mock; update: jest.Mock };
  };
  let ycloudService: { uploadMedia: jest.Mock };
  let messageMedia: { storeUploadedMedia: jest.Mock };

  beforeEach(async () => {
    prisma = {
      account: { findUnique: jest.fn() },
      mediaUpload: {
        create: jest.fn().mockResolvedValue({ id: 'media-upload-1' }),
        update: jest.fn().mockResolvedValue({ id: 'media-upload-1' }),
      },
    };
    ycloudService = { uploadMedia: jest.fn() };
    messageMedia = {
      storeUploadedMedia: jest.fn().mockResolvedValue({
        mediaUrl: 'https://cdn.fenixcrm.site/media/nota.ogg',
        mediaStorageDriver: 'local',
        mediaStorageKey: 'acc/upload/nota.ogg',
        mediaSizeBytes: 1234,
        mediaStoredAt: new Date('2026-01-01T00:00:00.000Z'),
        mediaExpiresAt: new Date('2026-07-01T00:00:00.000Z'),
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MediaUploadService,
        { provide: PrismaService, useValue: prisma },
        { provide: YcloudService, useValue: ycloudService },
        { provide: MessageMediaService, useValue: messageMedia },
      ],
    }).compile();

    service = module.get<MediaUploadService>(MediaUploadService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('uploadInternal', () => {
    // Regresion del bug reportado: grabar una nota de voz desde el
    // navegador produce audio/webm (lo unico que soporta MediaRecorder en
    // la mayoria de navegadores), y uploadToYcloud() lo rechazaba porque
    // la API real de YCloud no acepta ese tipo en su endpoint de upload --
    // aunque el adjunto nunca iba a enviarse al lead. uploadInternal() no
    // debe tocar YCloud en absoluto.
    it('stores audio/webm without calling YcloudService', async () => {
      prisma.account.findUnique.mockResolvedValue({ id: 'account-1' });

      const result = await service.uploadInternal({
        accountId: 'account-1',
        file: buildFile({ mimetype: 'audio/webm' }),
      });

      expect(ycloudService.uploadMedia).not.toHaveBeenCalled();
      expect(messageMedia.storeUploadedMedia).toHaveBeenCalledWith({
        accountId: 'account-1',
        file: expect.objectContaining({ mimetype: 'audio/webm' }),
      });
      expect(prisma.mediaUpload.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ provider: ProviderType.INTERNAL }),
        }),
      );
      expect(result).toEqual(
        expect.objectContaining({
          provider: 'INTERNAL',
          mediaUrl: 'https://cdn.fenixcrm.site/media/nota.ogg',
        }),
      );
    });

    it('does not require account.phoneE164 (unlike uploadToYcloud)', async () => {
      prisma.account.findUnique.mockResolvedValue({ id: 'account-1' });

      await expect(
        service.uploadInternal({
          accountId: 'account-1',
          file: buildFile({ mimetype: 'image/png' }),
        }),
      ).resolves.toBeDefined();

      expect(prisma.account.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'account-1' } }),
      );
    });

    it('rejects a mime type outside the internal allowlist', async () => {
      prisma.account.findUnique.mockResolvedValue({ id: 'account-1' });

      await expect(
        service.uploadInternal({
          accountId: 'account-1',
          file: buildFile({ mimetype: 'application/x-msdownload' }),
        }),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(messageMedia.storeUploadedMedia).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the account does not exist', async () => {
      prisma.account.findUnique.mockResolvedValue(null);

      await expect(
        service.uploadInternal({
          accountId: 'missing',
          file: buildFile(),
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
