import { Logger } from '@nestjs/common';

/**
 * Helpers de logging compartidos por workers, crons y flujos criticos.
 *
 * - errorMessage/errorStack: los logs de error deben llevar el mensaje en la
 *   linea principal y el stack como segundo argumento de Logger.error (Nest
 *   lo imprime debajo), en lugar de `String(err)` que pierde el stack.
 * - runCronWithSummary: envuelve un @Cron para que SIEMPRE deje una linea de
 *   inicio y otra de resumen (contadores + duracion), y para que un fallo
 *   global (p. ej. la query principal contra la BD) quede logueado con
 *   contexto propio en vez de depender del logger interno de @nestjs/schedule.
 */

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

export function errorStack(err: unknown): string | undefined {
  return err instanceof Error ? err.stack : undefined;
}

export type CronRunStats = Record<string, number>;

export function bump(stats: CronRunStats, key: string, by = 1): void {
  stats[key] = (stats[key] ?? 0) + by;
}

function formatStats(stats: CronRunStats): string {
  return Object.entries(stats)
    .map(([key, value]) => `${key}=${value}`)
    .join(' ');
}

export async function runCronWithSummary(
  logger: Logger,
  jobName: string,
  execute: (stats: CronRunStats) => Promise<void>,
): Promise<void> {
  const startedAt = Date.now();
  const stats: CronRunStats = {};

  logger.log(`[cron:${jobName}] started`);

  try {
    await execute(stats);

    const summary = `[cron:${jobName}] finished ${formatStats(stats)} durationMs=${Date.now() - startedAt}`;

    if ((stats.failed ?? 0) > 0) {
      logger.warn(summary);
    } else {
      logger.log(summary);
    }
  } catch (error) {
    logger.error(
      `[cron:${jobName}] aborted ${formatStats(stats)} durationMs=${Date.now() - startedAt} err=${errorMessage(error)}`,
      errorStack(error),
    );
  }
}
