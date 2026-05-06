import contactAliases from "../data/contactAliases.json";

const aliases = contactAliases as Record<string, { name: string; source: string }>;

export function normalizeContactNumber(value: string): string {
  if (!value) return "";
  let digits = value.replace(/\D/g, "");
  if (digits.startsWith("00")) {
    digits = digits.slice(2);
  }
  if (digits.length === 9 && /^[6789]/.test(digits)) {
    digits = "34" + digits;
  }
  return digits;
}

export function getContactAliasName(value: string): string | null {
  if (!value) return null;
  const normalized = normalizeContactNumber(value);
  const alias = aliases[normalized];
  return alias ? alias.name : null;
}

export function getContactDisplayName(contact: any): string {
  if (!contact) return "";

  const phoneValue =
    contact.remoteJid ||
    contact.id ||
    contact.jid ||
    contact.number ||
    contact.phone;

  if (phoneValue) {
    const aliasName = getContactAliasName(phoneValue);
    if (aliasName) {
      return aliasName;
    }
  }

  const fallbackName = contact.pushName || contact.profileName || contact.name;
  if (fallbackName) {
    return fallbackName;
  }

  if (phoneValue) {
    return phoneValue.split("@")[0];
  }

  return "";
}
