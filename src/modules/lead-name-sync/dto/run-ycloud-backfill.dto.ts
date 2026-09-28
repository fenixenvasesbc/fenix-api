import { Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

// Mismas flags que el script de CLI (pnpm ycloud:backfill-lead-names), ver
// src/scripts/backfill-lead-names-from-ycloud.ts / ycloud-lead-name-sync.core.ts.
export class RunYcloudBackfillDto {
  // false (default) = dry run: no escribe nada, solo devuelve el resumen de
  // que cambiaria. true = aplica los cambios.
  @IsOptional()
  @IsBoolean()
  apply?: boolean;

  @IsOptional()
  @IsUUID()
  accountId?: string;

  // Limite de leads a escanear en esta corrida. Recomendado para probar
  // desde la UI antes de correr contra todos los leads; sin limite, una
  // cuenta con muchos leads puede tardar y arriesgar el timeout del proxy.
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20000)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  concurrency?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(60000)
  delayMs?: number;
}
