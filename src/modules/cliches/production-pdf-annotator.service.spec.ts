import { ClicheCategory } from '@prisma/client';
import { ProductionPdfAnnotatorService } from './production-pdf-annotator.service';
import { ClicheLocationMatch } from './production-pdf.types';

type TextItem = {
  str: string;
  transform: number[];
  width: number;
  height: number;
};

type AnnotatorInternals = {
  findClientRows(items: TextItem[]): Array<{
    text: string;
    x: number;
    y: number;
  }>;
  formatLocation(matches: ClicheLocationMatch[]): string;
  findDailyInsertions(items: TextItem[]): Array<{
    splitY: number;
    dayLabel: string;
    clients: string[];
  }>;
};

function item(str: string, x: number, y: number): TextItem {
  return { str, transform: [1, 0, 0, 1, x, y], width: 30, height: 9 };
}

describe('ProductionPdfAnnotatorService', () => {
  const service =
    new ProductionPdfAnnotatorService() as unknown as AnnotatorInternals;

  it('finds client rows without treating material summaries as clients', () => {
    const rows = service.findClientRows([
      item('CAJA PIZZA', 26, 700),
      item('CLIENTE UNO', 352.5, 700),
      item('250', 566, 700),
      item('CAJA VASO', 26, 685),
      item('SIN CLICHE', 352.5, 685),
      item('100', 566, 685),
      item('CAJA PIZZA', 100, 600),
      item('350', 486, 600),
      item('14/06/2026', 52, 800),
      item('Pagina 2 de 8', 536, 800),
    ]);

    expect(rows).toEqual([
      { text: 'CLIENTE UNO', x: 352.5, y: 700 },
      { text: 'SIN CLICHE', x: 352.5, y: 685 },
    ]);
  });

  it('formats all locations in one line and marks missing cliches', () => {
    const matches: ClicheLocationMatch[] = [
      {
        id: 'one',
        name: 'CLIENTE UNO',
        category: ClicheCategory.PIZZA,
        year: 2025,
        letter: 'D1',
      },
      {
        id: 'two',
        name: 'CLIENTE UNO',
        category: ClicheCategory.VASOS,
        year: 2026,
        letter: 'F3',
      },
    ];

    expect(service.formatLocation(matches)).toBe(
      'Pizza, 2025, D1 | Vasos, 2026, F3',
    );
    expect(service.formatLocation([])).toBe('No encontrado');
  });

  it('places the daily table after the material summary without adding quantities to clients', () => {
    const insertions = service.findDailyInsertions([
      item('lunes 15 de junio de 2026', 235, 760),
      item('CAJA PIZZA', 26, 731.5),
      item('CLIENTE UNO', 352.5, 731.5),
      item('1.000', 559.5, 731.5),
      item('RESUMEN', 232, 600),
      item('DE MATERIALES', 288.5, 600),
      item('CAJA PIZZA', 102, 570),
      item('1.000', 479, 570),
    ]);

    expect(insertions).toEqual([
      {
        splitY: 561.5,
        dayLabel: 'lunes 15 de junio de 2026',
        clients: ['CLIENTE UNO'],
      },
    ]);
  });
});
