import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Role, User } from '@prisma/client';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  findByEmail(email: string) {
    return this.prisma.user.findUnique({ where: { email } });
  }

  findById(id: string) {
    return this.prisma.user.findUnique({ where: { id } });
  }

  async createUser(params: { email: string; passwordHash: string; role: Role }): Promise<User> {
    const { email, passwordHash, role } = params;
    return this.prisma.user.create({
      data: { email, passwordHash, role },
    });
  }

  async getSales() {
    return this.prisma.user.findMany({ where: { role: Role.SALES } });
  }
}