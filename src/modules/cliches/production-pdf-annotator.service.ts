import { Injectable } from '@nestjs/common';
import { ClicheCategory } from '@prisma/client';
import { PDFDocument, PDFFont, rgb, StandardFonts } from 'pdf-lib';
import { normalizeClicheName } from './production-pdf-parser.service';
import { ClicheLocationMatch } from './production-pdf.types';

const CATEGORY_LABELS: Record<ClicheCategory, string> = {
  ENVIO: 'Envio',
  COMBO: 'Combo',
  HAMBURGUESA: 'Hamburguesa',
  PIZZA: 'Pizza',
  LONCHEADO: 'Loncheado',
  SOBRES: 'Sobres',
  BOLSAS: 'Bolsas',
  VASOS: 'Vasos',
  TARTAS: 'Tartas',
};

type PdfTextItem = {
  str: string;
  transform: number[];
  width: number;
  height: number;
};

type PositionedText = {
  text: string;
  x: number;
  y: number;
};

@Injectable()
export class ProductionPdfAnnotatorService {
  async annotate(
    source: Buffer,
    matchesByName: ReadonlyMap<string, ClicheLocationMatch[]>,
  ) {
    const pdfDocument = await PDFDocument.load(new Uint8Array(source));
    const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const sourceDocument = await getDocument({
      data: new Uint8Array(Buffer.from(source)),
    }).promise;
    const font = await pdfDocument.embedFont(StandardFonts.Helvetica);

    try {
      const pages = pdfDocument.getPages();
      const pageCount = Math.min(sourceDocument.numPages, pages.length);

      for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
        const sourcePage = await sourceDocument.getPage(pageNumber);
        const content = await sourcePage.getTextContent();
        const rows = this.findClientRows(
          content.items.filter(this.isTextItem) as PdfTextItem[],
        );

        for (const row of rows) {
          const matches =
            matchesByName.get(normalizeClicheName(row.text)) ?? [];
          const location = this.formatLocation(matches);
          const maxWidth = Math.max(
            80,
            pages[pageNumber - 1].getWidth() - row.x - 28,
          );
          const fontSize = this.fitFontSize(font, location, maxWidth);

          pages[pageNumber - 1].drawText(location, {
            x: row.x,
            y: row.y - 5.4,
            size: fontSize,
            font,
            color: matches.length ? rgb(0.04, 0.25, 0.65) : rgb(0.72, 0, 0.08),
          });
        }
      }

      return Buffer.from(await pdfDocument.save());
    } finally {
      await sourceDocument.destroy();
    }
  }

  private findClientRows(items: PdfTextItem[]): PositionedText[] {
    const lines = new Map<number, PdfTextItem[]>();

    for (const item of items) {
      if (!item.str.trim()) continue;
      const y = Math.round(item.transform[5] * 2) / 2;
      const line = lines.get(y) ?? [];
      line.push(item);
      lines.set(y, line);
    }

    const rows: PositionedText[] = [];
    for (const [y, line] of lines) {
      line.sort((left, right) => left.transform[4] - right.transform[4]);
      const hasDescription = line.some((item) => item.transform[4] < 220);
      if (!hasDescription) continue;

      const clientItems = line.filter((item) => {
        const x = item.transform[4];
        return x >= 330 && x < 560;
      });
      if (clientItems.length === 0) continue;
      if (clientItems[0].transform[4] > 400) continue;

      const text = clientItems
        .map((item) => item.str.trim())
        .filter(Boolean)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (!text) continue;

      rows.push({ text, x: clientItems[0].transform[4], y });
    }

    return rows;
  }

  private formatLocation(matches: ClicheLocationMatch[]) {
    if (matches.length === 0) return 'No encontrado';
    return matches
      .map(
        (match) =>
          `${CATEGORY_LABELS[match.category]}, ${match.year}, ${match.letter}`,
      )
      .join(' | ');
  }

  private fitFontSize(font: PDFFont, text: string, maxWidth: number) {
    const preferredSize = 4.2;
    const width = font.widthOfTextAtSize(text, preferredSize);
    if (width <= maxWidth) return preferredSize;
    return Math.max(1.8, (preferredSize * maxWidth) / width);
  }

  private isTextItem(item: unknown): item is PdfTextItem {
    if (!item || typeof item !== 'object') return false;
    const candidate = item as Partial<PdfTextItem>;
    return (
      typeof candidate.str === 'string' &&
      Array.isArray(candidate.transform) &&
      typeof candidate.width === 'number' &&
      typeof candidate.height === 'number'
    );
  }
}
