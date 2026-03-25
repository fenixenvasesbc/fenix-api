import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useLogger(['log', 'error', 'warn', 'debug']);

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

  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();