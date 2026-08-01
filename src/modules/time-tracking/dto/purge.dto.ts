import { IsString } from 'class-validator';

// Frase exacta que el script de escritorio debe enviar para confirmar el borrado total.
export const PURGE_CONFIRMATION_PHRASE = 'ELIMINAR TODOS LOS FICHAJES';

export class PurgeTimeTrackingDto {
  @IsString()
  confirmationPhrase: string;
}
