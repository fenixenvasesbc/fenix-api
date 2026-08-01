import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PURGE_CONFIRMATION_PHRASE } from './dto/purge.dto';

@Injectable()
export class TimeTrackingPurgeService {
  constructor(private readonly prisma: PrismaService) {}

  async preview() {
    const [employees, entries] = await this.prisma.$transaction([
      this.prisma.employee.count(),
      this.prisma.timeEntry.count(),
    ]);
    return { employees, entries };
  }

  async purge(confirmationPhrase: string) {
    if (confirmationPhrase !== PURGE_CONFIRMATION_PHRASE) {
      throw new BadRequestException('Frase de confirmación incorrecta');
    }

    const [entries, employees] = await this.prisma.$transaction([
      this.prisma.timeEntry.deleteMany({}),
      this.prisma.employee.deleteMany({}),
    ]);

    return {
      deletedEntries: entries.count,
      deletedEmployees: employees.count,
    };
  }
}
