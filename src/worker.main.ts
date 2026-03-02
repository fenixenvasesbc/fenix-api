import { NestFactory } from '@nestjs/core';
import { WorkerModule } from './modules/worker/worker.module';


async function bootstrap() {
  const app = await NestFactory.createApplicationContext(WorkerModule, {
    logger: ['log', 'error', 'warn', 'debug'],
  });
}
bootstrap();