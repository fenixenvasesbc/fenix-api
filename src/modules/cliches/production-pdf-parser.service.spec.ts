import {
  normalizeClicheName,
  ProductionPdfParserService,
} from './production-pdf-parser.service';

describe('ProductionPdfParserService', () => {
  const service = new ProductionPdfParserService();

  it('extracts clients, dates and machine while ignoring summaries', () => {
    const result = service.parsePageTexts([
      [
        'FABRICACIÓN DEL 15/06/2026 AL 19/06/2026',
        'MÁQUINA 2',
        'miércoles 17 de junio de 2026',
        'MAÑANA',
        '1.000\tROJO FORNO GUSTO\tCAJA PIZZA BLANCA 31*31+4',
        '1.000\tROJO FORNO GUSTO\tCAJA PIZZA BLANCA 26*26+3.5',
        '500\tCASA JOSE\tCAJA PIZZA KRAFT 30*30+3.5',
        'RESUMEN DE MATERIALES',
        '1.500\tCAJA PIZZA KRAFT 30*30+3.5',
      ].join('\n'),
    ]);

    expect(result).toEqual([
      {
        machineNumber: 2,
        machineLabel: 'MAQUINA_2',
        date: '2026-06-17',
        dayOfWeek: 'miercoles',
        clientName: 'FORNO GUSTO',
      },
      {
        machineNumber: 2,
        machineLabel: 'MAQUINA_2',
        date: '2026-06-17',
        dayOfWeek: 'miercoles',
        clientName: 'CASA JOSE',
      },
    ]);
  });

  it('includes pages without a machine number', () => {
    const [entry] = service.parsePageTexts([
      ['lunes 15 de junio de 2026', '3\tRESET FITNESS\tVASO IMPRESO 7OZ'].join(
        '\n',
      ),
    ]);

    expect(entry.machineNumber).toBeNull();
    expect(entry.machineLabel).toBe('SIN_MAQUINA');
  });

  it('normalizes accents and punctuation for matching', () => {
    expect(normalizeClicheName("  LOLO'S CAFÉ ")).toBe('LOLO S CAFE');
  });
});
