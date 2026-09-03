import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PURGE_CONFIRMATION_PHRASE } from './dto/purge.dto';

@Injectable()
export class TimeTrackingPurgeService {
  constructor(private readonly prisma: PrismaService) {}

  async preview() {
    const [employees, entries, auditRecords] = await this.prisma.$transaction([
      this.prisma.employee.count(),
      this.prisma.timeEntry.count(),
      this.prisma.timeEntryAudit.count(),
    ]);
    return { employees, entries, auditRecords };
  }

  async purge(confirmationPhrase: string) {
    if (confirmationPhrase !== PURGE_CONFIRMATION_PHRASE) {
      throw new BadRequestException('Frase de confirmación incorrecta');
    }

    // La auditoria de ediciones (TimeEntryAudit) NO se borra sola al
    // eliminar un TimeEntry (FK es ON DELETE SET NULL a proposito, ver
    // schema.prisma) -- solo el purge total del modulo la limpia, por eso
    // se borra explicitamente aqui.
    const [auditRecords, entries, employees] = await this.prisma.$transaction([
      this.prisma.timeEntryAudit.deleteMany({}),
      this.prisma.timeEntry.deleteMany({}),
      this.prisma.employee.deleteMany({}),
    ]);

    return {
      deletedAuditRecords: auditRecords.count,
      deletedEntries: entries.count,
      deletedEmployees: employees.count,
    };
  }
}
