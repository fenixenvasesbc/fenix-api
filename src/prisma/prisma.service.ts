import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
  constructor(config: ConfigService) {
    const url = config.get<string>('DATABASE_URL');
    if (!url) throw new Error('DATABASE_URL is missing');

    const adapter = new PrismaPg({ connectionString: url });

    super({ adapter });
  }

  async onModuleInit() {
    await this.$connect();
  }
}