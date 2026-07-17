import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { NotificationsService } from '../modules/notifications/notifications.service';

function parseArgs(argv: string[]) {
  const nowArg = argv.find((arg) => arg.startsWith('--now='));
  const nowValue = nowArg?.slice('--now='.length);

  if (!nowValue) return { now: undefined };

  const now = new Date(nowValue);

  if (Number.isNaN(now.getTime())) {
    throw new Error(
      'Invalid --now value. Use an ISO date, for example --now=2026-07-17T07:00:00+02:00',
    );
  }

  return { now };
}

async function bootstrap() {
  const { now } = parseArgs(process.argv.slice(2));
  const app = await NestFactory.createApplicationContext(AppModule);

  try {
    const notificationsService = app.get(NotificationsService);
    const result = await notificationsService.runLabelAlerts(now);

    console.log(
      JSON.stringify(
        {
          ok: true,
          executedAt: (now ?? new Date()).toISOString(),
          ...result,
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
