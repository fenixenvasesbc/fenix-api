export type LeadDisplayNameSource =
  | 'YCLOUD_NICKNAME'
  | 'WHATSAPP_PROFILE'
  | 'LEGACY_NAME'
  | 'PHONE';

export type LeadNameFields = {
  ycloudNickname: string | null;
  whatsappProfileName: string | null;
  name: string | null;
  phoneE164: string;
};

export function normalizeLeadName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

export function resolveLeadDisplayName(lead: LeadNameFields): {
  displayName: string;
  displayNameSource: LeadDisplayNameSource;
} {
  const ycloudNickname = normalizeLeadName(lead.ycloudNickname);
  if (ycloudNickname) {
    return {
      displayName: ycloudNickname,
      displayNameSource: 'YCLOUD_NICKNAME',
    };
  }

  const whatsappProfileName = normalizeLeadName(lead.whatsappProfileName);
  if (whatsappProfileName) {
    return {
      displayName: whatsappProfileName,
      displayNameSource: 'WHATSAPP_PROFILE',
    };
  }

  const legacyName = normalizeLeadName(lead.name);
  if (legacyName) {
    return { displayName: legacyName, displayNameSource: 'LEGACY_NAME' };
  }

  return { displayName: lead.phoneE164, displayNameSource: 'PHONE' };
}

export function withLeadDisplayName<T extends LeadNameFields>(lead: T) {
  return { ...lead, ...resolveLeadDisplayName(lead) };
}
