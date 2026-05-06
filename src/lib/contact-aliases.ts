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

export interface ContactDisplay {
  title: string;
  subtitle?: string;
  phone?: string;
  source: "business" | "whatsapp" | "google" | "phone";
}

export function getStructuredContactDisplay(contact: any): ContactDisplay {
  if (!contact) {
    return { title: "", source: "phone" };
  }

  // 1. Get raw phone number
  const rawPhone =
    contact.remoteJid ||
    contact.id ||
    contact.jid ||
    contact.number ||
    contact.phone ||
    "";
  const phone = rawPhone ? rawPhone.split("@")[0] : "";

  // 2. Get Google Contacts Alias
  const googleAlias = rawPhone ? getContactAliasName(rawPhone) : null;

  // 3. Collect WhatsApp fields in order of priority for Business / Public profile
  const businessName =
    contact.businessProfile?.name ||
    contact.verifiedName ||
    contact.businessName ||
    contact.name;

  const personalPushName = contact.profileName || contact.pushName;

  // Normalization for comparison (lowercase, alphanumeric only)
  const normalizeForComparison = (str: string) => {
    if (!str) return "";
    return str.toLowerCase().replace(/[^a-z0-9]/g, "");
  };

  let title = "";
  let source: "business" | "whatsapp" | "google" | "phone" = "phone";

  if (businessName) {
    title = businessName;
    source = "business";
  } else if (personalPushName) {
    title = personalPushName;
    source = "whatsapp";
  } else if (googleAlias) {
    title = googleAlias;
    source = "google";
  } else {
    title = phone;
    source = "phone";
  }

  let subtitle: string | undefined;

  // If the title principal is NOT the Google alias and Google alias exists:
  // show "Guardado como: {alias}" (avoiding duplicates if they are equal or almost equal)
  if (googleAlias && source !== "google") {
    const titleNorm = normalizeForComparison(title);
    const googleNorm = normalizeForComparison(googleAlias);

    if (titleNorm !== googleNorm && !titleNorm.includes(googleNorm) && !googleNorm.includes(titleNorm)) {
      subtitle = `Guardado como: ${googleAlias}`;
    }
  }

  return {
    title,
    subtitle,
    phone: phone || undefined,
    source,
  };
}
