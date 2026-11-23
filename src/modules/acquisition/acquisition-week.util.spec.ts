import {
  addDays,
  coarseUtcRange,
  daysBetween,
  isDateKey,
  isSendDay,
  madridDateKey,
  sendDayOf,
  weekStartOf,
  weeksBetween,
} from './acquisition-week.util';

describe('acquisition-week.util (ADR-007)', () => {
  it('weekStartOf devuelve el martes que abre la semana martes-lunes', () => {
    expect(weekStartOf('2026-11-17')).toBe('2026-11-17'); // martes
    expect(weekStartOf('2026-11-20')).toBe('2026-11-17'); // viernes
    expect(weekStartOf('2026-11-22')).toBe('2026-11-17'); // domingo
    expect(weekStartOf('2026-11-23')).toBe('2026-11-17'); // lunes: cierra la semana
    expect(weekStartOf('2026-11-24')).toBe('2026-11-24'); // martes siguiente
  });

  it('sendDayOf agrega sabado y domingo al lunes siguiente', () => {
    expect(sendDayOf('2026-11-21')).toBe('2026-11-23'); // sabado
    expect(sendDayOf('2026-11-22')).toBe('2026-11-23'); // domingo
    expect(sendDayOf('2026-11-20')).toBe('2026-11-20'); // viernes
    expect(isSendDay('2026-11-22')).toBe(false);
    expect(isSendDay('2026-11-23')).toBe(true);
    // el fin de semana queda dentro de la misma semana martes-lunes
    expect(weekStartOf(sendDayOf('2026-11-21'))).toBe('2026-11-17');
  });

  it('madridDateKey usa la hora local de España (23:30 UTC del domingo ya es lunes en invierno)', () => {
    expect(madridDateKey(new Date('2026-11-29T23:30:00Z'))).toBe('2026-11-30');
    expect(madridDateKey(new Date('2026-11-29T22:30:00Z'))).toBe('2026-11-29');
    // verano (UTC+2)
    expect(madridDateKey(new Date('2026-07-05T22:30:00Z'))).toBe('2026-07-06');
  });

  it('weeksBetween y daysBetween incluyen ambos extremos', () => {
    expect(weeksBetween('2026-11-03', '2026-11-17')).toEqual(['2026-11-03', '2026-11-10', '2026-11-17']);
    expect(daysBetween('2026-11-21', '2026-11-23')).toEqual(['2026-11-21', '2026-11-22', '2026-11-23']);
  });

  it('coarseUtcRange deja margen a cada lado', () => {
    const r = coarseUtcRange('2026-11-17', '2026-11-23');
    expect(r.start.toISOString()).toBe('2026-11-16T00:00:00.000Z');
    expect(r.end.toISOString()).toBe('2026-11-25T00:00:00.000Z');
  });

  it('addDays e isDateKey', () => {
    expect(addDays('2026-12-30', 3)).toBe('2027-01-02');
    expect(isDateKey('2026-02-30')).toBe(false);
    expect(isDateKey('2026-11-23')).toBe(true);
  });
});
