import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  normalizeClicheName,
  ProductionPdfParserService,
} from './production-pdf-parser.service';
import {
  ClicheLocationMatch,
  ProductionPlanEntry,
} from './production-pdf.types';

@Injectable()
export class ClicheProductionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly parser: ProductionPdfParserService,
  ) {}

  async importPdf(file?: Express.Multer.File) {
    this.validateFile(file);
    const parsed = await this.parser.parse(file!.buffer);
    const cliches = await this.prisma.cliche.findMany({
      select: {
        id: true,
        name: true,
        category: true,
        year: true,
        letter: true,
      },
    });
    const matchesByName = new Map<string, ClicheLocationMatch[]>();

    for (const cliche of cliches) {
      const key = normalizeClicheName(cliche.name);
      const matches = matchesByName.get(key) ?? [];
      matches.push(cliche);
      matchesByName.set(key, matches);
    }

    for (const matches of matchesByName.values()) {
      matches.sort(
        (left, right) =>
          left.category.localeCompare(right.category) ||
          right.year - left.year ||
          left.letter.localeCompare(right.letter, undefined, { numeric: true }),
      );
    }

    const entries: ProductionPlanEntry[] = parsed.entries.map((entry) => ({
      ...entry,
      matches: matchesByName.get(normalizeClicheName(entry.clientName)) ?? [],
    }));
    const matchedEntries = entries.filter(
      (entry) => entry.matches.length > 0,
    ).length;

    return {
      document: {
        fileName: file!.originalname,
        pageCount: parsed.pageCount,
      },
      summary: {
        totalEntries: entries.length,
        matchedEntries,
        unmatchedEntries: entries.length - matchedEntries,
      },
      entries,
    };
  }

  private validateFile(
    file?: Express.Multer.File,
  ): asserts file is Express.Multer.File {
    if (!file) throw new BadRequestException('file is required');
    if (!file.buffer.subarray(0, 5).equals(Buffer.from('%PDF-'))) {
      throw new BadRequestException('The uploaded file is not a valid PDF');
    }
  }
}
