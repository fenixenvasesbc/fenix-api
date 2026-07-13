import { normalizeLeadName, resolveLeadDisplayName } from './lead-name';

describe('lead name resolver', () => {
  const baseLead = {
    ycloudNickname: null,
    whatsappContactName: null,
    whatsappProfileName: null,
    name: null,
    phoneE164: '+34600000000',
  };

  it('prioritizes the WhatsApp agenda name', () => {
    expect(
      resolveLeadDisplayName({
        ...baseLead,
        whatsappContactName: 'Nombre agenda',
        ycloudNickname: 'Nickname YCloud',
        whatsappProfileName: 'Perfil WhatsApp',
        name: 'Nombre historico',
      }),
    ).toEqual({
      displayName: 'Nombre agenda',
      displayNameSource: 'WHATSAPP_CONTACT',
    });
  });

  it('falls back through YCloud nickname, profile, legacy name and phone', () => {
    expect(
      resolveLeadDisplayName({
        ...baseLead,
        ycloudNickname: 'Nickname YCloud',
        whatsappProfileName: 'Perfil WhatsApp',
        name: 'Nombre historico',
      }).displayNameSource,
    ).toBe('YCLOUD_NICKNAME');

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
