import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { registerProcessErrorHandlers } from './common/utils/process-handlers';
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
  registerProcessErrorHandlers('worker');

  const app = await NestFactory.createApplicationContext(WorkerModule, {
    logger: ['log', 'error', 'warn', 'debug'],
  });
  // Ejecuta onModuleDestroy (cierre ordenado de RabbitMQ) en SIGTERM.
  app.enableShutdownHooks();
  new Logger('Bootstrap').log('Worker started');
}
bootstrap().catch((error: unknown) => {
  // Si el arranque falla (BD/RabbitMQ/env), salir con 1 para que el
  // orquestador reinicie el contenedor en vez de dejar un proceso zombi.
  new Logger('Bootstrap').error(
    `Worker failed to start: ${error instanceof Error ? error.message : String(error)}`,
    error instanceof Error ? error.stack : undefined,
  );
  process.exit(1);
});
