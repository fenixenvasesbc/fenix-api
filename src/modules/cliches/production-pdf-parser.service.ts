import { BadRequestException, Injectable } from '@nestjs/common';
import { PDFParse } from 'pdf-parse';
import { ParsedProductionEntry } from './production-pdf.types';

const MONTHS: Record<string, number> = {
  enero: 1,
  febrero: 2,
  marzo: 3,
  abril: 4,
  mayo: 5,
  junio: 6,
  julio: 7,
  agosto: 8,
  septiembre: 9,
  octubre: 10,
  noviembre: 11,
  diciembre: 12,
};

const COLOR_PREFIXES = new Set([
  'AMARILLO',
  'AZUL',
  'BLANCO',
  'FUCSIA',
  'GRANATE',
  'MORADO',
  'NARANJA',
  'NEGRO',
  'ROJO',
  'ROSA',
  'VERDE',
  'VIOLETA',
]);

const DATE_LINE =
  /^(lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo)\s+(\d{1,2})\s+de\s+([a-záéíóú]+)\s+de\s+(\d{4})$/i;

@Injectable()
export class ProductionPdfParserService {
  async parse(buffer: Buffer) {
    const parser = new PDFParse({ data: new Uint8Array(buffer) });

    try {
      const result = await parser.getText();
      const entries = this.parsePageTexts(
        result.pages.map((page) => page.text),
      );

      if (entries.length === 0) {
        throw new BadRequestException(
          'The PDF does not contain recognizable production rows',
        );
      }

      return {
        pageCount: result.total,
        entries,
      };
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      throw new BadRequestException('The PDF could not be read');
    } finally {
      await parser.destroy();
    }
  }

  parsePageTexts(pageTexts: string[]): ParsedProductionEntry[] {
    const entries = new Map<string, ParsedProductionEntry>();

    for (const pageText of pageTexts) {
      const lines = pageText
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
      const machineMatch = lines
        .map((line) => /^M[ÁA]QUINA\s+(\d+)$/i.exec(line))
        .find(Boolean);
      const machineNumber = machineMatch ? Number(machineMatch[1]) : null;
      let currentDate: { date: string; dayOfWeek: string } | null = null;

      for (const line of lines) {
        const parsedDate = this.parseDateLine(line);
        if (parsedDate) {
          currentDate = parsedDate;
          continue;
        }

        if (!currentDate) continue;
        const columns = line.split('\t').map((column) => column.trim());
        if (columns.length < 3 || !this.isQuantity(columns[0])) continue;

        const rawClient = columns.slice(1, -1).join(' ');
        const clientName = this.cleanClientName(rawClient);
        if (!clientName) continue;

        const entry: ParsedProductionEntry = {
          machineNumber,
          machineLabel:
            machineNumber === null ? 'SIN_MAQUINA' : `MAQUINA_${machineNumber}`,
          date: currentDate.date,
          dayOfWeek: currentDate.dayOfWeek,
          clientName,
        };
        const key = [
          machineNumber ?? 'NONE',
          entry.date,
          normalizeClicheName(clientName),
        ].join('|');
        if (!entries.has(key)) entries.set(key, entry);
      }
    }

    return [...entries.values()];
  }

  private parseDateLine(line: string) {
    const match = DATE_LINE.exec(line);
    if (!match) return null;

    const month = MONTHS[this.removeAccents(match[3]).toLowerCase()];
    if (!month) return null;

    const day = Number(match[2]);
    const year = Number(match[4]);
    return {
      date: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
      dayOfWeek: this.removeAccents(match[1]).toLowerCase(),
    };
  }

  private isQuantity(value: string) {
    return /^\d+(?:\.\d{3})*$/.test(value.replace(/\s/g, ''));
  }

  private cleanClientName(value: string) {
    const normalized = value.replace(/\s+/g, ' ').trim();
    const [first, ...rest] = normalized.split(' ');
    if (
      rest.length > 0 &&
      COLOR_PREFIXES.has(this.removeAccents(first).toUpperCase())
    ) {
      return rest.join(' ');
    }
    return normalized;
  }

  private removeAccents(value: string) {
    return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }
}

export function normalizeClicheName(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}
