import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class LeadLanguageResolverService {
  private readonly logger = new Logger(LeadLanguageResolverService.name);
  private readonly mappings = [
    { prefix: '+34', language: 'es_ES' },
    { prefix: '+33', language: 'fr' },
    { prefix: '+39', language: 'it' },
    { prefix: '+49', language: 'de' },
    { prefix: '+41', language: 'en' },
  ];

  resolveFromPhone(phoneE164: string | null | undefined): string | null {
    if (!phoneE164) {
      this.logger.warn(
        `[LANG_RESOLVER] Missing phoneE164 → cannot resolve language`,
      );
      return null;
    }

    const match = this.mappings.find((item) =>
      phoneE164.startsWith(item.prefix),
    );

    if (!match) {
      this.logger.warn(
        `[LANG_RESOLVER] No language match for phone=${phoneE164}`,
      );
      return null;
    }

    this.logger.debug(
      `[LANG_RESOLVER] Resolved phone=${phoneE164} → language=${match.language}`,
    );

    return match.language;
  }
}
