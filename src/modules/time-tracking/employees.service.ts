import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreateEmployeeDto,
  ListEmployeesQueryDto,
  UpdateEmployeeDto,
} from './dto/employee.dto';

@Injectable()
export class EmployeesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: ListEmployeesQueryDto) {
    const employees = await this.prisma.employee.findMany({
      where: query.includeInactive ? {} : { isActive: true },
      orderBy: { name: 'asc' },
    });

    const openEntries = await this.prisma.timeEntry.findMany({
      where: {
        employeeId: { in: employees.map((employee) => employee.id) },
        clockOutAt: null,
      },
      select: { id: true, employeeId: true, clockInAt: true },
    });
    const openByEmployee = new Map(
      openEntries.map((entry) => [entry.employeeId, entry]),
    );

    return employees.map((employee) => {
      const open = openByEmployee.get(employee.id);
      return {
        ...employee,
        activeEntry: open ? { id: open.id, clockInAt: open.clockInAt } : null,
      };
    });
  }

  async findOne(id: string) {
    const employee = await this.prisma.employee.findUnique({ where: { id } });
    if (!employee) throw new NotFoundException('Employee not found');
    return employee;
  }

  create(dto: CreateEmployeeDto) {
    return this.prisma.employee.create({ data: dto });
  }

  async update(id: string, dto: UpdateEmployeeDto) {
    await this.ensureExists(id);
    return this.prisma.employee.update({ where: { id }, data: dto });
  }

  async remove(id: string) {
    await this.ensureExists(id);

    const openEntry = await this.prisma.timeEntry.findFirst({
      where: { employeeId: id, clockOutAt: null },
      select: { id: true },
    });
    if (openEntry) {
      throw new BadRequestException(
        'El empleado tiene un fichaje abierto. Debe fichar la salida antes de eliminarlo.',
      );
    }

    const entryCount = await this.prisma.timeEntry.count({
      where: { employeeId: id },
    });
    if (entryCount === 0) {
      await this.prisma.employee.delete({ where: { id } });
      return { id, deleted: true, deactivated: false };
    }

    await this.prisma.employee.update({
      where: { id },
      data: { isActive: false },
    });
    return { id, deleted: false, deactivated: true };
  }

  private async ensureExists(id: string) {
    const exists = await this.prisma.employee.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!exists) throw new NotFoundException('Employee not found');
  }
}
