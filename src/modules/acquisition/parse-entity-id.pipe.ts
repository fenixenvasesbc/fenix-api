import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';
import { ENTITY_ID_PATTERN } from './dto/acquisition.dto';

/**
 * Valida que un :id tenga formato UUID (8-4-4-4-12 hex) sin exigir version
 * RFC 4122. Sustituye a ParseUUIDPipe porque los IDs sembrados en migraciones
 * (md5(...)::uuid) no cumplen los bits de version/variante.
 */
@Injectable()
export class ParseEntityIdPipe implements PipeTransform<string, string> {
  transform(value: string): string {
    if (typeof value !== 'string' || !ENTITY_ID_PATTERN.test(value)) {
      throw new BadRequestException('Invalid id');
    }
    return value;
  }
}
