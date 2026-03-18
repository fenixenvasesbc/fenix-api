import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { ReengagementSchedulerService } from 'src/modules/reengagement/reengagement-scheduler-service.service';


function mockSystemDate(isoDate: string) {
  const RealDate = Date;
  const fixedDate = new RealDate(isoDate);

  class MockDate extends RealDate {
    constructor(...args: any[]) {
      if (args.length === 0) {
        super(fixedDate.getTime());
      } else {
        super(...(args as [any]));
      }
    }

    static now() {
      return fixedDate.getTime();
    }

    static parse(dateString: string) {
      return RealDate.parse(dateString);
    }

    static UTC(...args: any[]) {
      return RealDate.UTC(...(args as Parameters<typeof Date.UTC>));
    }
  }

  // @ts-ignore
  global.Date = MockDate;

  return () => {
    // @ts-ignore
    global.Date = RealDate;
  };
}

async function bootstrap() {
  const testDate = process.argv[2];

  if (!testDate) {
    throw new Error('Missing test date argument. Example: 2026-03-16T12:00:00+01:00');
  }

  console.log('Mocking system date with:', testDate);

  const restoreDate = mockSystemDate(testDate);

  try {
    const app = await NestFactory.createApplicationContext(AppModule);
    const scheduler = app.get(ReengagementSchedulerService);

    await scheduler.run();

    await app.close();
  } finally {
    restoreDate();
  }
}

bootstrap().catch((error) => {
  console.error(error);
  process.exit(1);
});