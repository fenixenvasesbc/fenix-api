import { Injectable } from '@nestjs/common';
import { ClicheCategory } from '@prisma/client';
import { PDFDocument, PDFFont, PDFPage, rgb, StandardFonts } from 'pdf-lib';
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

const DAY_LINE =
  /^(LUNES|MARTES|MIERCOLES|JUEVES|VIERNES|SABADO|DOMINGO)\s+\d{1,2}\s+DE\s+/;

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

type TextLine = {
  y: number;
  text: string;
  items: PdfTextItem[];
};

type DailyInsertion = {
  splitY: number;
  dayLabel: string;
  clients: string[];
};

@Injectable()
export class ProductionPdfAnnotatorService {
  async annotate(
    source: Buffer,
    matchesByName: ReadonlyMap<string, ClicheLocationMatch[]>,
  ) {
    const sourcePdf = await PDFDocument.load(new Uint8Array(source));
    const outputPdf = await PDFDocument.create();
    const regularFont = await outputPdf.embedFont(StandardFonts.Helvetica);
    const boldFont = await outputPdf.embedFont(StandardFonts.HelveticaBold);
    const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const textDocument = await getDocument({
      data: new Uint8Array(Buffer.from(source)),
    }).promise;

    try {
      const sourcePages = sourcePdf.getPages();
      const pageCount = Math.min(textDocument.numPages, sourcePages.length);

      for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
        const textPage = await textDocument.getPage(pageNumber);
        const content = await textPage.getTextContent();
        const items = content.items.filter(this.isTextItem) as PdfTextItem[];
        const insertions = this.findDailyInsertions(items);

        await this.composePage({
          outputPdf,
          sourcePage: sourcePages[pageNumber - 1],
          insertions,
          matchesByName,
          regularFont,
          boldFont,
        });
      }

      outputPdf.setTitle('Plan de fabricacion con ubicaciones de cliches');
      outputPdf.setProducer('Fenix CRM');
      return Buffer.from(await outputPdf.save());
    } finally {
      await textDocument.destroy();
    }
  }

  private async composePage(params: {
    outputPdf: PDFDocument;
    sourcePage: PDFPage;
    insertions: DailyInsertion[];
    matchesByName: ReadonlyMap<string, ClicheLocationMatch[]>;
    regularFont: PDFFont;
    boldFont: PDFFont;
  }) {
    const {
      outputPdf,
      sourcePage,
      insertions,
      matchesByName,
      regularFont,
      boldFont,
    } = params;
    const width = sourcePage.getWidth();
    const height = sourcePage.getHeight();
    const createTargetPage = () => {
      const page = outputPdf.addPage([width, height]);
      page.drawRectangle({
        x: 0,
        y: 0,
        width,
        height,
        color: rgb(1, 1, 1),
      });
      return page;
    };
    let targetPage = createTargetPage();
    let cursorY = height;

    const newPage = () => {
      targetPage = createTargetPage();
      cursorY = height;
    };
    const ensureSpace = (requiredHeight: number) => {
      if (cursorY - requiredHeight < 0) newPage();
    };
    const drawFragment = async (top: number, bottom: number) => {
      const fragmentHeight = top - bottom;
      if (fragmentHeight <= 0.5) return;
      ensureSpace(fragmentHeight);
      const embedded = await outputPdf.embedPage(sourcePage, {
        left: 0,
        right: width,
        bottom,
        top,
      });
      targetPage.drawPage(embedded, {
        x: 0,
        y: cursorY - fragmentHeight,
        width,
        height: fragmentHeight,
      });
      cursorY -= fragmentHeight;
    };

    let sourceTop = height;
    for (const insertion of insertions) {
      await drawFragment(sourceTop, insertion.splitY);
      this.drawLocationTable({
        dayLabel: insertion.dayLabel,
        clients: insertion.clients,
        matchesByName,
        regularFont,
        boldFont,
        width,
        height,
        getPage: () => targetPage,
        getCursor: () => cursorY,
        setCursor: (value) => {
          cursorY = value;
        },
        newPage,
      });
      cursorY -= 8;
      sourceTop = insertion.splitY;
    }

    await drawFragment(sourceTop, 0);
  }

  private drawLocationTable(params: {
    dayLabel: string;
    clients: string[];
    matchesByName: ReadonlyMap<string, ClicheLocationMatch[]>;
    regularFont: PDFFont;
    boldFont: PDFFont;
    width: number;
    height: number;
    getPage: () => PDFPage;
    getCursor: () => number;
    setCursor: (value: number) => void;
    newPage: () => void;
  }) {
    const {
      matchesByName,
      regularFont,
      boldFont,
      width,
      getPage,
      getCursor,
      setCursor,
      newPage,
    } = params;
    const dayLabel = this.sanitizeForFont(boldFont, params.dayLabel);
    const clients = params.clients.length
      ? params.clients
      : ['Sin clientes detectados'];
    const x = 26;
    const tableWidth = width - x * 2;
    const clientWidth = tableWidth * 0.4;
    const titleHeight = 17;
    const headerHeight = 16;
    const rowHeight = 15;
    const borderColor = rgb(0.1, 0.1, 0.1);

    const drawTableHeader = (continuation = false) => {
      if (getCursor() < titleHeight + headerHeight + rowHeight) newPage();
      let cursor = getCursor();
      const page = getPage();

      page.drawRectangle({
        x,
        y: cursor - titleHeight,
        width: tableWidth,
        height: titleHeight,
        color: rgb(0.82, 0.82, 0.82),
        borderColor,
        borderWidth: 0.7,
      });
      const title = `UBICACION DE CLICHES - ${dayLabel.toUpperCase()}${
        continuation ? ' - CONTINUACION' : ''
      }`;
      const titleSize = this.fitFontSize(boldFont, title, tableWidth - 8, 9, 6);
      page.drawText(title, {
        x: x + (tableWidth - boldFont.widthOfTextAtSize(title, titleSize)) / 2,
        y: cursor - titleHeight + 4.5,
        size: titleSize,
        font: boldFont,
      });
      cursor -= titleHeight;

      page.drawRectangle({
        x,
        y: cursor - headerHeight,
        width: tableWidth,
        height: headerHeight,
        color: rgb(0.93, 0.93, 0.93),
        borderColor,
        borderWidth: 0.7,
      });
      page.drawLine({
        start: { x: x + clientWidth, y: cursor },
        end: { x: x + clientWidth, y: cursor - headerHeight },
        color: borderColor,
        thickness: 0.7,
      });
      page.drawText('CLIENTE', {
        x: x + 4,
        y: cursor - headerHeight + 4.5,
        size: 8,
        font: boldFont,
      });
      page.drawText('UBICACION', {
        x: x + clientWidth + 4,
        y: cursor - headerHeight + 4.5,
        size: 8,
        font: boldFont,
      });
      setCursor(cursor - headerHeight);
    };

    drawTableHeader();
    for (const client of clients) {
      if (getCursor() < rowHeight) {
        newPage();
        drawTableHeader(true);
      }
      const page = getPage();
      const cursor = getCursor();
      const matches = matchesByName.get(normalizeClicheName(client)) ?? [];
      const location =
        client === 'Sin clientes detectados'
          ? ''
          : this.formatLocation(matches);

      page.drawRectangle({
        x,
        y: cursor - rowHeight,
        width: tableWidth,
        height: rowHeight,
        borderColor,
        borderWidth: 0.7,
      });
      page.drawLine({
        start: { x: x + clientWidth, y: cursor },
        end: { x: x + clientWidth, y: cursor - rowHeight },
        color: borderColor,
        thickness: 0.7,
      });

      const safeClient = this.sanitizeForFont(regularFont, client);
      const safeLocation = this.sanitizeForFont(regularFont, location);
      page.drawText(safeClient, {
        x: x + 4,
        y: cursor - rowHeight + 4.2,
        size: this.fitFontSize(
          regularFont,
          safeClient,
          clientWidth - 8,
          7.5,
          4.5,
        ),
        font: regularFont,
      });
      page.drawText(safeLocation, {
        x: x + clientWidth + 4,
        y: cursor - rowHeight + 4.2,
        size: this.fitFontSize(
          regularFont,
          safeLocation,
          tableWidth - clientWidth - 8,
          7.5,
          3.5,
        ),
        font: regularFont,
        color: matches.length ? rgb(0.04, 0.25, 0.65) : rgb(0.72, 0, 0.08),
      });
      setCursor(cursor - rowHeight);
    }
  }

  private findDailyInsertions(items: PdfTextItem[]): DailyInsertion[] {
    const lines = this.groupLines(items);
    const dates = lines.filter((line) => this.isDayLine(line.text));
    const summaries = lines.filter(
      (line) => normalizeClicheName(line.text) === 'RESUMEN DE MATERIALES',
    );
    const clientRows = this.findClientRows(items);
    const insertions: DailyInsertion[] = [];

    for (const summary of summaries) {
      const date = dates
        .filter((line) => line.y > summary.y)
        .sort((left, right) => left.y - right.y)[0];
      if (!date) continue;
      const nextDate = dates
        .filter((line) => line.y < summary.y)
        .sort((left, right) => right.y - left.y)[0];
      const lowerBound = nextDate?.y ?? 20;
      const materialRows = lines.filter(
        (line) =>
          line.y < summary.y &&
          line.y > lowerBound &&
          this.isMaterialSummaryRow(line),
      );
      if (materialRows.length === 0) continue;

      const clients = new Map<string, string>();
      for (const row of clientRows.filter(
        (row) => row.y < date.y && row.y > summary.y,
      )) {
        const key = normalizeClicheName(row.text);
        if (key && !clients.has(key)) clients.set(key, row.text);
      }

      insertions.push({
        splitY: Math.max(
          0,
          Math.min(...materialRows.map((line) => line.y)) - 8.5,
        ),
        dayLabel: date.text,
        clients: [...clients.values()],
      });
    }

    return insertions.sort((left, right) => right.splitY - left.splitY);
  }

  private groupLines(items: PdfTextItem[]): TextLine[] {
    const grouped = new Map<number, PdfTextItem[]>();
    for (const item of items) {
      if (!item.str.trim()) continue;
      const y = Math.round(item.transform[5] * 2) / 2;
      const line = grouped.get(y) ?? [];
      line.push(item);
      grouped.set(y, line);
    }

    return [...grouped.entries()]
      .map(([y, lineItems]) => {
        lineItems.sort((left, right) => left.transform[4] - right.transform[4]);
        return {
          y,
          items: lineItems,
          text: lineItems
            .map((item) => item.str.trim())
            .filter(Boolean)
            .join(' ')
            .replace(/\s+/g, ' ')
            .trim(),
        };
      })
      .sort((left, right) => right.y - left.y);
  }

  private findClientRows(items: PdfTextItem[]): PositionedText[] {
    const rows: PositionedText[] = [];
    for (const line of this.groupLines(items)) {
      const hasDescription = line.items.some((item) => item.transform[4] < 220);
      if (!hasDescription) continue;

      const clientItems = line.items.filter((item) => {
        const x = item.transform[4];
        return x >= 330 && x < 550;
      });
      if (clientItems.length === 0 || clientItems[0].transform[4] > 400) {
        continue;
      }

      const text = clientItems
        .map((item) => item.str.trim())
        .filter(Boolean)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (text) rows.push({ text, x: clientItems[0].transform[4], y: line.y });
    }
    return rows;
  }

  private isDayLine(value: string) {
    return DAY_LINE.test(normalizeClicheName(value));
  }

  private isMaterialSummaryRow(line: TextLine) {
    const hasMaterial = line.items.some((item) => {
      const x = item.transform[4];
      return x >= 75 && x < 300 && /[A-Z]/i.test(item.str);
    });
    const hasQuantity = line.items.some((item) => {
      const x = item.transform[4];
      return x >= 450 && /^\d+(?:\.\d+)*$/.test(item.str.trim());
    });
    return hasMaterial && hasQuantity;
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

  private fitFontSize(
    font: PDFFont,
    text: string,
    maxWidth: number,
    preferredSize: number,
    minimumSize: number,
  ) {
    if (!text) return preferredSize;
    const width = font.widthOfTextAtSize(text, preferredSize);
    if (width <= maxWidth) return preferredSize;
    return Math.max(minimumSize, (preferredSize * maxWidth) / width);
  }

  private sanitizeForFont(font: PDFFont, value: string) {
    try {
      font.encodeText(value);
      return value;
    } catch {
      return [...value]
        .map((character) => {
          try {
            font.encodeText(character);
            return character;
          } catch {
            return '?';
          }
        })
        .join('');
    }
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
