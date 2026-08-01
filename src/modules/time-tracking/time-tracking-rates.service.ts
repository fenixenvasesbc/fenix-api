import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { UpdateRatesDto } from './dto/rates.dto';

const RATES_ID = 'default';

@Injectable()
export class TimeTrackingRatesService {
  constructor(private readonly prisma: PrismaService) {}

  getRates() {
    return this.prisma.timeTrackingRate.upsert({
      where: { id: RATES_ID },
      update: {},
      create: { id: RATES_ID },
    });
  }

  async updateRates(dto: UpdateRatesDto, userId: string) {
    await this.getRates();
    return this.prisma.timeTrackingRate.update({
      where: { id: RATES_ID },
      data: {
        ...dto,
        updatedByUserId: userId,
      },
    });
  }
}
