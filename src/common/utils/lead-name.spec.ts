import { normalizeLeadName, resolveLeadDisplayName } from './lead-name';

describe('lead name resolver', () => {
  const baseLead = {
    ycloudNickname: null,
    whatsappProfileName: null,
    name: null,
    phoneE164: '+34600000000',
  };

  it('prioritizes the YCloud nickname', () => {
    expect(
      resolveLeadDisplayName({
        ...baseLead,
        ycloudNickname: 'Nombre agenda',
        whatsappProfileName: 'Perfil WhatsApp',
        name: 'Nombre historico',
      }),
    ).toEqual({
      displayName: 'Nombre agenda',
      displayNameSource: 'YCLOUD_NICKNAME',
    });
  });

  it('falls back through profile, legacy name and phone', () => {
    expect(
      resolveLeadDisplayName({
        ...baseLead,
        whatsappProfileName: 'Perfil WhatsApp',
        name: 'Nombre historico',
      }).displayNameSource,
    ).toBe('WHATSAPP_PROFILE');

    expect(
      resolveLeadDisplayName({
        ...baseLead,
        name: 'Nombre historico',
      }).displayNameSource,
    ).toBe('LEGACY_NAME');

    expect(resolveLeadDisplayName(baseLead)).toEqual({
      displayName: '+34600000000',
      displayNameSource: 'PHONE',
    });
  });

  it('ignores empty names and trims valid ones', () => {
    expect(normalizeLeadName('   ')).toBeNull();
    expect(normalizeLeadName('  Cliente  ')).toBe('Cliente');
    expect(
      resolveLeadDisplayName({
        ...baseLead,
        ycloudNickname: ' ',
        whatsappProfileName: '  Perfil  ',
      }).displayName,
    ).toBe('Perfil');
  });
});
