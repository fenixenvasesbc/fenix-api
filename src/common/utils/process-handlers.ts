import { Logger } from '@nestjs/common';
import { errorMessage, errorStack } from './logging';

/**
 * Registra handlers de ultimo recurso para errores que escapan a cualquier
 * try/catch (promesas sin await, callbacks de librerias, etc.). Sin esto,
 * un unhandledRejection termina el proceso en Node >= 15 sin contexto util.
 *
 * - unhandledRejection: se loguea como error y el proceso sigue vivo.
 * - uncaughtException: se loguea como error y se sale con codigo 1 (el
 *   estado puede ser inconsistente); Docker/PM2 lo reinicia.
 */
export function registerProcessErrorHandlers(processName: string): void {
  const logger = new Logger(`Process:${processName}`);

  process.on('unhandledRejection', (reason) => {
    logger.error(
      `Unhandled promise rejection: ${errorMessage(reason)}`,
      errorStack(reason),
    );
  });

  process.on('uncaughtException', (error) => {
    logger.error(
      `Uncaught exception, exiting: ${errorMessage(error)}`,
      errorStack(error),
    );
    // Deja tiempo a que se vacie stdout antes de salir.
    setTimeout(() => process.exit(1), 200);
  });

  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(signal, () => {
      logger.warn(`Received ${signal}, shutting down`);
    });
  }
}
