import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { BadRequestException } from '@nestjs/common';
import { SaveSpendFormDto, UpdateAcquisitionTemplateDto } from './acquisition.dto';
import { ParseEntityIdPipe } from '../parse-entity-id.pipe';

// ID sembrado por migracion: md5('family:LANDING COMBO')::uuid (no es UUID v1-v5)
const SEEDED_ID = 'ff764efe-8009-2ba2-9fb4-1846cb844de8';

describe('IDs de familias/plantillas sembrados con md5', () => {
  it('SaveSpendFormDto acepta familyId generado con md5 y objetivo null', () => {
    const dto = plainToInstance(SaveSpendFormDto, {
      date: '2026-11-16',
      items: [
        { familyId: SEEDED_ID, dailyAmountCents: 12345, targetCentsPerLead: 300 },
        { familyId: SEEDED_ID, targetCentsPerLead: null },
      ],
    });
    expect(dto.items[1].targetCentsPerLead).toBeNull();
    const errors = validateSync(dto, { whitelist: true, forbidNonWhitelisted: true });
    expect(errors).toHaveLength(0);
  });

  it('rechaza un familyId con formato invalido', () => {
    const dto = plainToInstance(UpdateAcquisitionTemplateDto, { familyId: 'no-es-un-id' });
    expect(validateSync(dto)).not.toHaveLength(0);
  });

  it('ParseEntityIdPipe acepta el ID sembrado y rechaza basura', () => {
    const pipe = new ParseEntityIdPipe();
    expect(pipe.transform(SEEDED_ID)).toBe(SEEDED_ID);
    expect(() => pipe.transform('abc')).toThrow(BadRequestException);
  });
});
