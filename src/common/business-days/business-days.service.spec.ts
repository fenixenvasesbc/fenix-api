import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from 'src/prisma/prisma.service';
import { BusinessDaysService } from './business-days.service';

describe('BusinessDaysService', () => {
  let service: BusinessDaysService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BusinessDaysService,
        { provide: PrismaService, useValue: { publicHoliday: { findMany: jest.fn() } } },
      ],
    }).compile();

    service = module.get<BusinessDaysService>(BusinessDaysService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ---------------------------------------------------------------
  // computeBusinessDueAt (ADR-004 §7, Submódulo 1)
  // ---------------------------------------------------------------

  // Pedido explicito del usuario, 28/oct/2026: el plazo son periodos
  // reales de 24h habiles -- el dia de entrada (el real, o el dia
  // calendario siguiente si llego en o despues del corte) NUNCA cuenta
  // como parte del plazo. El primer dia habil DESPUES de ese dia de
  // entrada son las primeras 24h, el segundo las 48h, etc. Reemplaza el
  // criterio anterior (06/oct/2026), donde el dia de `anchor` contaba
  // como "dia 1" si era antes del corte.
  describe('computeBusinessDueAt', () => {
    const empty = new Set<string>();

    it('nunca cuenta el dia de anchor como parte del plazo, aunque sea antes del corte (2+ dias habiles)', () => {
      // 2026-01-05 10:00 Europe/Madrid (CET, UTC+1) -> Monday, business day.
      const anchor = new Date('2026-01-05T09:00:00.000Z');

      const dueAt = service.computeBusinessDueAt(anchor, 2, empty, {
        cutoffHour: 14,
      });

      // Mon05 no cuenta -> Tue06=24h(1), Wed07=48h(2) -> 2026-01-07, 14:00
      // Europe/Madrid = 13:00 UTC (CET).
      expect(dueAt).toEqual(new Date('2026-01-07T13:00:00.000Z'));
    });

    it('si el anchor cae en o despues del corte, se trata como si hubiese entrado el dia siguiente y arranca un dia mas tarde', () => {
      // 2026-01-05 16:00 Europe/Madrid -> after the 14:00 cutoff.
      const anchor = new Date('2026-01-05T15:00:00.000Z');

      const dueAt = service.computeBusinessDueAt(anchor, 2, empty, {
        cutoffHour: 14,
      });

      // Dia efectivo de entrada: Tue06 (Mon05 + 1 por el corte). 24h=Wed07,
      // 48h=Thu08.
      expect(dueAt).toEqual(new Date('2026-01-08T13:00:00.000Z'));
    });

    it('skips the weekend when a 24h period would fall on it', () => {
      // 2026-01-02 is a Friday; 16:00 Madrid is after the cutoff.
      const anchor = new Date('2026-01-02T15:00:00.000Z');

      const dueAt = service.computeBusinessDueAt(anchor, 2, empty, {
        cutoffHour: 14,
      });

      // Dia efectivo de entrada: Sat03 (Fri02 + 1 por el corte). El primer
      // dia que puede contar es Sun04 (no habil) -> 24h=Mon05, 48h=Tue06.
      expect(dueAt).toEqual(new Date('2026-01-06T13:00:00.000Z'));
    });

    it('also skips holidays loaded in holidaySet', () => {
      const anchor = new Date('2026-01-02T15:00:00.000Z'); // Friday, after cutoff
      const holidaySet = new Set(['2026-01-05']); // Monday is a public holiday

      const dueAt = service.computeBusinessDueAt(anchor, 2, holidaySet, {
        cutoffHour: 14,
      });

      // Igual que el caso anterior, pero Mon05 tambien es feriado -> salta
      // fin de semana Y el feriado: 24h=Tue06, 48h=Wed07.
      expect(dueAt).toEqual(new Date('2026-01-07T13:00:00.000Z'));
    });

    it('counts multiple business days from the day after the anchor', () => {
      const anchor = new Date('2026-01-05T09:00:00.000Z'); // Monday, before cutoff

      const dueAt = service.computeBusinessDueAt(anchor, 3, empty, {
        cutoffHour: 14,
      });

      // Mon05 no cuenta -> Tue06=24h(1) Wed07=48h(2) Thu08=72h(3).
      expect(dueAt).toEqual(new Date('2026-01-08T13:00:00.000Z'));
    });

    // -------------------------------------------------------------
    // businessDays === 1 (MOD, REPET_MOD, REPET_ANADE, y el reinicio al
    // enviar a "Modificacion"): con el criterio de 24h reales, la
    // garantia de "un dia habil completo" ya es automatica para
    // cualquier plazo (el dia de entrada nunca cuenta), asi que ya NO
    // hace falta forzar el salto al dia siguiente sin importar la hora
    // (esa excepcion existia en el criterio anterior, 06/oct/2026, y se
    // elimino el 28/oct/2026). El corte de las `cutoffHour` ahora se
    // respeta igual que para cualquier otro plazo.
    // -------------------------------------------------------------
    describe('con 1 solo dia habil de plazo', () => {
      it('anchor antes del corte -> vence al dia habil siguiente (24h)', () => {
        // 2026-01-05 08:00 Europe/Madrid -> Monday, antes del corte de las 14:00.
        const anchor = new Date('2026-01-05T07:00:00.000Z');

        const dueAt = service.computeBusinessDueAt(anchor, 1, empty, {
          cutoffHour: 14,
        });

        // Debe vencer el martes 01-06 (24h despues del lunes).
        expect(dueAt).toEqual(new Date('2026-01-06T13:00:00.000Z'));
      });

      it('anchor justo antes del corte (13:59) vence al dia habil siguiente', () => {
        const anchor = new Date('2026-01-05T12:59:00.000Z'); // 13:59 Madrid

        const dueAt = service.computeBusinessDueAt(anchor, 1, empty, {
          cutoffHour: 14,
        });

        expect(dueAt).toEqual(new Date('2026-01-06T13:00:00.000Z'));
      });

      it('anchor despues del corte se trata como si hubiese entrado al dia siguiente -> vence un dia mas tarde', () => {
        const anchor = new Date('2026-01-05T15:00:00.000Z'); // 16:00 Madrid, after cutoff

        const dueAt = service.computeBusinessDueAt(anchor, 1, empty, {
          cutoffHour: 14,
        });

        // Dia efectivo de entrada: martes 01-06 (lunes + 1 por el corte) ->
        // vence el miercoles 01-07 (antes del cambio de criterio vencia el
        // martes 01-06, porque el corte se ignoraba para plazos de 1 dia).
        expect(dueAt).toEqual(new Date('2026-01-07T13:00:00.000Z'));
      });

      it('anchor un viernes antes del corte salta el fin de semana', () => {
        const anchor = new Date('2026-01-02T07:00:00.000Z'); // Friday, 08:00 Madrid

        const dueAt = service.computeBusinessDueAt(anchor, 1, empty, {
          cutoffHour: 14,
        });

        // Salta sabado/domingo -> vence el lunes 2026-01-05.
        expect(dueAt).toEqual(new Date('2026-01-05T13:00:00.000Z'));
      });
    });
  });

  // ---------------------------------------------------------------
  // businessDaysUntilDue (ADR-004 §8, semáforo de 3 colores)
  // ---------------------------------------------------------------

  describe('businessDaysUntilDue', () => {
    const empty = new Set<string>();

    it('returns 0 when now and dueAt fall on the same business day', () => {
      const now = new Date('2026-01-05T08:00:00.000Z');
      const dueAt = new Date('2026-01-05T13:00:00.000Z');

      expect(service.businessDaysUntilDue(now, dueAt, empty)).toBe(0);
    });

    it('returns 1 when dueAt is the next business day', () => {
      const now = new Date('2026-01-05T08:00:00.000Z'); // Monday
      const dueAt = new Date('2026-01-06T13:00:00.000Z'); // Tuesday

      expect(service.businessDaysUntilDue(now, dueAt, empty)).toBe(1);
    });

    it('returns more than 1 when several business days remain', () => {
      const now = new Date('2026-01-05T08:00:00.000Z'); // Monday
      const dueAt = new Date('2026-01-08T13:00:00.000Z'); // Thursday

      expect(service.businessDaysUntilDue(now, dueAt, empty)).toBe(3);
    });

    it('returns -1 when dueAt already fell on a previous day', () => {
      const now = new Date('2026-01-06T08:00:00.000Z');
      const dueAt = new Date('2026-01-05T13:00:00.000Z');

      expect(service.businessDaysUntilDue(now, dueAt, empty)).toBe(-1);
    });
  });
});
