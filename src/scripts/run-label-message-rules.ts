import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { LabelMessageRuleSchedulerService } from '../modules/label-message-rule/label-message-rule-scheduler.service';
import { PrismaService } from '../prisma/prisma.service';

// Dispara manualmente el job de LabelMessageRule (normalmente solo corre
// via @Cron('30 9 * * *', { timeZone: 'Europe/Madrid' })), util para
// pruebas o para forzar una corrida fuera de horario sin esperar al cron.
//
// Uso:
//   npm run label-message-rule:run
//
// El job en si no acepta una fecha "now" simulada (usa new Date() por
// dentro), asi que para probarlo hay que dejar vencida de verdad la
// asignacion (LeadLabelAssignment.assignedAt) en la base de datos antes de
// correr esto.

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);

  try {
    const prisma = app.get(PrismaService);
    const scheduler = app.get(LabelMessageRuleSchedulerService);

    const before = await prisma.leadCampaign.count({
      where: { type: 'LABEL_RULE' },
    });

    await scheduler.run();

    const after = await prisma.leadCampaign.count({
      where: { type: 'LABEL_RULE' },
    });

    const created = await prisma.leadCampaign.findMany({
      where: { type: 'LABEL_RULE' },
      orderBy: { enqueuedAt: 'desc' },
      take: Math.max(after - before, 0) || 5,
      select: {
        id: true,
        leadId: true,
        accountId: true,
        status: true,
        skipReason: true,
        businessWindowKey: true,
        enqueuedAt: true,
      },
    });

    console.log(
      JSON.stringify(
        {
          ok: true,
          executedAt: new Date().toISOString(),
          leadCampaignsBefore: before,
          leadCampaignsAfter: after,
          leadCampaignsCreated: Math.max(after - before, 0),
          recentLeadCampaigns: created,
        },
        null,
        2,
      ),
    );
  } finally {
    await app.close();
  }
}

bootstrap().catch((error) => {
  console.error(error);
  process.exit(1);
});
