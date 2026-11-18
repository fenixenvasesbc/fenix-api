import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { registerProcessErrorHandlers } from './common/utils/process-handlers';

// Node no serializa BigInt a JSON de forma nativa (p. ej. DesignRequest.pausedTotalMs).
// Se convierte a Number aca, de forma global, para que cualquier campo BigInt
// presente o futuro no rompa las respuestas HTTP con 'Do not know how to serialize a BigInt'.
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
  registerProcessErrorHandlers('api');

  const app = await NestFactory.create(AppModule);
  app.useLogger(['log', 'error', 'warn', 'debug']);
  // Ejecuta onModuleDestroy (cierre ordenado de RabbitMQ) en SIGTERM.
  app.enableShutdownHooks();

  // CORS (debe ir antes de listen)
  app.enableCors({
    origin: true, // refleja el Origin que llega (permite todos)
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: false,
  });
  // app.enableCors({
  //   origin: process.env.CORS_ORIGIN || 'https://v0-postman-to-app.vercel.app',
  //   methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  //   allowedHeaders: ['Content-Type', 'Authorization'],
  //   credentials: false, // pon true SOLO si usas cookies/sesión
  // });

  // Fallback opcional: responde preflight siempre (no debería hacer falta, pero evita el 404 en OPTIONS)
  // app.use((req: any, res: any, next: any) => {
  //   if (req.method === 'OPTIONS') return res.sendStatus(204);
  //   next();
  // });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const port = process.env.PORT ?? 3000;
  await app.listen(port);
  new Logger('Bootstrap').log(`API listening on port ${port}`);
}
bootstrap().catch((error: unknown) => {
  // Si el arranque falla (BD/RabbitMQ/env), salir con 1 para que el
  // orquestador reinicie el contenedor en vez de dejar un proceso zombi.
  new Logger('Bootstrap').error(
    `API failed to start: ${error instanceof Error ? error.message : String(error)}`,
    error instanceof Error ? error.stack : undefined,
  );
  process.exit(1);
});
