import {
  addDays,
  coarseUtcRange,
  isDateKey,
  madridDateKey,
  mondayOf,
  normalizeLandingSlug,
  weeksBetween,
} from './acquisition-week.util';

describe('acquisition-week.util (ADR-007)', () => {
  describe('normalizeLandingSlug', () => {
    it.each([
      ['/landing-pizza', '/landing-pizza'],
      ['  /Landing-Pizza/ ', '/landing-pizza'],
      ['landing-pizza', '/landing-pizza'],
      ['https://web.example.com/landing-pizza?utm_source=meta#top', '/landing-pizza'],
      ['/pizza.italia', '/pizza.italia'],
      ['//caja-envio-con-asa//', '/caja-envio-con-asa'],
    ])('%p -> %p', (raw, expected) => {
      expect(normalizeLandingSlug(raw)).toBe(expected);
    });

    it.each([[''], ['   '], ['/'], [null], [undefined], ['https://web.example.com/']])(
      'devuelve null para %p',
      (raw) => {
        expect(normalizeLandingSlug(raw as any)).toBeNull();
      },
    );
  });

  describe('semanas', () => {
    it('mondayOf devuelve el lunes de la semana (domingo pertenece a la semana anterior)', () => {
      expect(mondayOf('2026-11-23')).toBe('2026-11-23'); // lunes
      expect(mondayOf('2026-11-25')).toBe('2026-11-23'); // miercoles
      expect(mondayOf('2026-11-29')).toBe('2026-11-23'); // domingo
      expect(mondayOf('2026-11-30')).toBe('2026-11-30'); // lunes siguiente
    });

    it('madridDateKey usa la hora local de España (23:30 UTC del domingo ya es lunes en invierno)', () => {
      expect(madridDateKey(new Date('2026-11-29T23:30:00Z'))).toBe('2026-11-30');
      expect(madridDateKey(new Date('2026-11-29T22:30:00Z'))).toBe('2026-11-29');
      // verano (UTC+2)
      expect(madridDateKey(new Date('2026-07-05T22:30:00Z'))).toBe('2026-07-06');
    });

    it('weeksBetween incluye ambos extremos', () => {
      expect(weeksBetween('2026-11-02', '2026-11-23')).toEqual([
        '2026-11-02',
        '2026-11-09',
        '2026-11-16',
        '2026-11-23',
      ]);
    });

    it('coarseUtcRange deja un dia de margen a cada lado', () => {
      const r = coarseUtcRange('2026-11-16', '2026-11-23');
      expect(r.start.toISOString()).toBe('2026-11-15T00:00:00.000Z');
      expect(r.end.toISOString()).toBe('2026-12-01T00:00:00.000Z');
    });

    it('addDays e isDateKey', () => {
      expect(addDays('2026-12-30', 3)).toBe('2027-01-02');
      expect(isDateKey('2026-02-30')).toBe(false);
      expect(isDateKey('2026-11-23')).toBe(true);
    });
  });
});
