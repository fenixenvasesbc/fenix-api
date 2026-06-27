import { BadRequestException } from '@nestjs/common';
import { ClicheCategory } from '@prisma/client';
import { ClicheProductionService } from './cliche-production.service';

describe('ClicheProductionService', () => {
  const prisma = { cliche: { findMany: jest.fn() } };
  const parser = { parse: jest.fn() };
  let service: ClicheProductionService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ClicheProductionService(prisma as never, parser as never);
  });

  it('returns every location matching the client name', async () => {
    parser.parse.mockResolvedValue({
      pageCount: 1,
      entries: [
        {
          machineNumber: 1,
          machineLabel: 'MAQUINA_1',
          date: '2026-06-15',
          dayOfWeek: 'lunes',
          clientName: 'CAFÉ ROMA',
        },
      ],
    });
    prisma.cliche.findMany.mockResolvedValue([
      {
        id: 'one',
        name: 'CAFE ROMA',
        category: ClicheCategory.PIZZA,
        year: 2025,
        letter: 'D1',
      },
      {
        id: 'two',
        name: 'CAFÉ ROMA',
        category: ClicheCategory.VASOS,
        year: 2026,
        letter: 'F3',
      },
    ]);

    const result = await service.importPdf({
      originalname: 'plan.pdf',
      buffer: Buffer.from('%PDF-test'),
    } as Express.Multer.File);

    expect(result.entries[0].matches).toHaveLength(2);
    expect(result.summary).toEqual({
      totalEntries: 1,
      matchedEntries: 1,
      unmatchedEntries: 0,
    });
  });

  it('rejects files without a PDF signature', async () => {
    await expect(
      service.importPdf({
        originalname: 'fake.pdf',
        buffer: Buffer.from('not-a-pdf'),
      } as Express.Multer.File),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
