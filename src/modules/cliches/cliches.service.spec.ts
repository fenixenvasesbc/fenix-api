import { NotFoundException } from '@nestjs/common';
import { ClicheCategory } from '@prisma/client';
import { ClichesService } from './cliches.service';

describe('ClichesService', () => {
  const prisma = {
    cliche: {
      create: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    $transaction: jest.fn((operations: Promise<unknown>[]) =>
      Promise.all(operations),
    ),
  };

  let service: ClichesService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ClichesService(prisma as never);
  });

  it('normalizes name and physical letter when creating', async () => {
    prisma.cliche.create.mockResolvedValue({ id: 'cliche-id' });

    await service.create({
      name: '  caja premium ',
      category: ClicheCategory.ENVIO,
      letter: ' d1 ',
      year: 2025,
    });

    expect(prisma.cliche.create).toHaveBeenCalledWith({
      data: {
        name: 'CAJA PREMIUM',
        category: ClicheCategory.ENVIO,
        letter: 'D1',
        year: 2025,
      },
    });
  });

  it('returns a filtered paginated list', async () => {
    prisma.cliche.findMany.mockResolvedValue([{ id: 'cliche-id' }]);
    prisma.cliche.count.mockResolvedValue(26);

    const result = await service.findAll({
      search: 'premium',
      category: ClicheCategory.PIZZA,
      year: 2025,
      page: 2,
      limit: 10,
    });

    expect(prisma.cliche.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 10, take: 10 }),
    );
    expect(result.pagination).toEqual({
      page: 2,
      limit: 10,
      total: 26,
      totalPages: 3,
    });
  });

  it('normalizes mutable text fields when updating', async () => {
    prisma.cliche.findUnique.mockResolvedValue({ id: 'cliche-id' });
    prisma.cliche.update.mockResolvedValue({ id: 'cliche-id' });

    await service.update('cliche-id', {
      name: ' nuevo nombre ',
      letter: ' f3 ',
    });

    expect(prisma.cliche.update).toHaveBeenCalledWith({
      where: { id: 'cliche-id' },
      data: {
        name: 'NUEVO NOMBRE',
        letter: 'F3',
      },
    });
  });

  it('throws 404 when a cliche does not exist', async () => {
    prisma.cliche.findUnique.mockResolvedValue(null);

    await expect(service.findOne('missing-id')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('deletes an existing cliche', async () => {
    prisma.cliche.findUnique.mockResolvedValue({ id: 'cliche-id' });
    prisma.cliche.delete.mockResolvedValue({ id: 'cliche-id' });

    await expect(service.remove('cliche-id')).resolves.toEqual({
      id: 'cliche-id',
      deleted: true,
    });
  });
});
