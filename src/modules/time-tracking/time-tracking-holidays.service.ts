import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateHolidayDto } from './dto/holiday.dto';

@Injectable()
export class TimeTrackingHolidaysService {
  constructor(private readonly prisma: PrismaService) {}

  list(year?: number) {
    if (!year) {
      return this.prisma.publicHoliday.findMany({ orderBy: { date: 'asc' } });
    }

    return this.prisma.publicHoliday.findMany({
      where: {
        date: {
          gte: new Date(`${year}-01-01T00:00:00.000Z`),
          lt: new Date(`${year + 1}-01-01T00:00:00.000Z`),
        },
      },
      orderBy: { date: 'asc' },
    });
  }

  async create(dto: CreateHolidayDto, userId: string) {
    const date = this.parseDateOnly(dto.date);

    const existing = await this.prisma.publicHoliday.findUnique({
      where: { date },
    });
    if (existing) {
      throw new BadRequestException(
        `Ya existe un festivo cargado para el ${dto.date} (${existing.name})`,
      );
    }

    return this.prisma.publicHoliday.create({
      data: {
        date,
        name: dto.name,
        scope: dto.scope ?? 'NATIONAL',
        region: dto.region,
        createdByUserId: userId,
      },
    });
  }

  // Ignora fechas ya cargadas en vez de fallar todo el lote (util para
  // pegar el calendario completo del año sin tener que filtrar a mano
  // lo que ya se habia cargado antes).
  async bulkCreate(dtos: CreateHolidayDto[], userId: string) {
    let created = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (const dto of dtos) {
      try {
        const date = this.parseDateOnly(dto.date);
        const existing = await this.prisma.publicHoliday.findUnique({
          where: { date },
        });
        if (existing) {
          skipped += 1;
          continue;
        }

        await this.prisma.publicHoliday.create({
          data: {
            date,
            name: dto.name,
            scope: dto.scope ?? 'NATIONAL',
            region: dto.region,
            createdByUserId: userId,
          },
        });
        created += 1;
      } catch (error) {
        errors.push(
          `${dto.date}: ${error instanceof Error ? error.message : 'error desconocido'}`,
        );
      }
    }

    return { created, skipped, errors };
  }

  async remove(id: string) {
    const holiday = await this.prisma.publicHoliday.findUnique({
      where: { id },
    });
    if (!holiday) throw new NotFoundException('Festivo no encontrado');

    await this.prisma.publicHoliday.delete({ where: { id } });
    return { id };
  }

  private parseDateOnly(value: string): Date {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match) {
      throw new BadRequestException(`Fecha invalida: ${value} (esperado YYYY-MM-DD)`);
    }
    return new Date(`${value}T00:00:00.000Z`);
  }
}
