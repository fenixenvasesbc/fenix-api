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

  // Idioma para los países que no están en la lista. Antes se devolvía null
  // y las campañas (reenganche, repetición, reglas por etiqueta) se saltaban
  // con LEAD_WITHOUT_LANGUAGE; decisión del usuario (18-nov-2026): inglés.
  static readonly DEFAULT_LANGUAGE = 'en';

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
      this.logger.debug(
        `[LANG_RESOLVER] No prefix match for phone=${this.maskPhone(phoneE164)} → default language=${LeadLanguageResolverService.DEFAULT_LANGUAGE}`,
      );
      return LeadLanguageResolverService.DEFAULT_LANGUAGE;
    }

    this.logger.debug(
      `[LANG_RESOLVER] Resolved phone=${this.maskPhone(phoneE164)} → language=${match.language}`,
    );

    return match.language;
  }

  private maskPhone(phoneE164: string): string {
    if (phoneE164.length <= 6) return '***';
    return `${phoneE164.slice(0, 3)}***${phoneE164.slice(-3)}`;
  }
}
