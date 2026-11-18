import { LeadLanguageResolverService } from './lead-language-resolver.service';

describe('LeadLanguageResolverService', () => {
  const service = new LeadLanguageResolverService();

  it.each([
    ['+34600000000', 'es_ES'],
    ['+33600000000', 'fr'],
    ['+39300000000', 'it'],
    ['+49150000000', 'de'],
    ['+41790000000', 'en'],
  ])('resolves %s to %s', (phone, language) => {
    expect(service.resolveFromPhone(phone)).toBe(language);
  });

  it('defaults to English for countries not in the list', () => {
    expect(service.resolveFromPhone('+447736788243')).toBe('en');
    expect(service.resolveFromPhone('+351912345678')).toBe('en');
  });

  it('still returns null when there is no phone', () => {
    expect(service.resolveFromPhone(null)).toBeNull();
    expect(service.resolveFromPhone(undefined)).toBeNull();
  });
});
