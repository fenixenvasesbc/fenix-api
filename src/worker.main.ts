import { NestFactory } from '@nestjs/core';
import { WorkerModule } from './modules/worker/worker.module';

// Ver src/main.ts: mismo fix para que BigInt (p. ej. DesignRequest.pausedTotalMs)
// no rompa si algun job del worker llega a serializar el modelo a JSON.
declare global {
  interface BigInt {
    toJSON(): number;
  }
}
(BigInt.prototype as unknown as { toJSON: () => number }).toJSON = function (
  this: bigint,
) {
  return Number(this);
};

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(WorkerModule, {
    logger: ['log', 'error', 'warn', 'debug'],
  });
}
bootstrap();