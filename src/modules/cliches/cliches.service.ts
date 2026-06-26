import { Injectable, NotFoundException } from '@nestjs/common';
import { ClicheCategory, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreateClicheDto,
  ListClichesQueryDto,
  UpdateClicheDto,
} from './dto/cliche.dto';

@Injectable()
export class ClichesService {
  constructor(private readonly prisma: PrismaService) {}

  create(dto: CreateClicheDto) {
    return this.prisma.cliche.create({
      data: {
        ...dto,
        name: this.normalize(dto.name),
        letter: this.normalize(dto.letter),
      },
    });
  }

  async findAll(query: ListClichesQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 25;
    const where: Prisma.ClicheWhereInput = {
      category: query.category,
      year: query.year,
    };

    if (query.search) {
      const search = query.search.trim();
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { letter: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [items, total] = await this.prisma.$transaction([
      this.prisma.cliche.findMany({
        where,
        orderBy: [{ year: 'desc' }, { name: 'asc' }, { createdAt: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.cliche.count({ where }),
    ]);

    return {
      items,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async findOne(id: string) {
    const cliche = await this.prisma.cliche.findUnique({ where: { id } });
    if (!cliche) throw new NotFoundException('Cliche not found');
    return cliche;
  }

  async update(id: string, dto: UpdateClicheDto) {
    await this.ensureExists(id);

    return this.prisma.cliche.update({
      where: { id },
      data: {
        ...dto,
        name: dto.name === undefined ? undefined : this.normalize(dto.name),
        letter:
          dto.letter === undefined ? undefined : this.normalize(dto.letter),
      },
    });
  }

  async remove(id: string) {
    await this.ensureExists(id);
    await this.prisma.cliche.delete({ where: { id } });
    return { id, deleted: true };
  }

  getCategories(): ClicheCategory[] {
    return Object.values(ClicheCategory);
  }

  private normalize(value: string) {
    return value.trim().toUpperCase();
  }

  private async ensureExists(id: string) {
    const exists = await this.prisma.cliche.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!exists) throw new NotFoundException('Cliche not found');
  }
}
