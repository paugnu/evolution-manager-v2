import contactAliases from "../data/contactAliases.json";
import { getCanonicalJid } from "./contactNormalization";

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
  const canonical = getCanonicalJid(value);
  const normalized = normalizeContactNumber(canonical || value);
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

  // 1. Get raw JID and normalize
  const rawJid =
    contact.remoteJid ||
    contact.id ||
    contact.jid ||
    contact.number ||
    contact.phone ||
    "";

  const canonicalJid = rawJid ? getCanonicalJid(rawJid) : "";
  const phone = canonicalJid ? canonicalJid.split("@")[0] : (rawJid ? rawJid.split("@")[0] : "");

  // 2. Get Google Contacts Alias
  const googleAlias = rawJid ? getContactAliasName(rawJid) : null;

  // 3. Collect WhatsApp fields
  const businessName =
    contact.businessProfile?.name ||
    contact.verifiedName ||
    contact.businessName ||
    contact.name;

  const personalPushName = contact.profileName || contact.pushName;
  const whatsappName = businessName || personalPushName;

  let title = "";
  let source: "business" | "whatsapp" | "google" | "phone" = "phone";

  // First Priority: Google Contacts Alias
  if (googleAlias) {
    title = googleAlias;
    source = "google";
  } else {
    // Second Priority: WhatsApp Name + Phone with Prefix (like WhatsApp Web)
    const formattedPhone = phone ? (phone.length > 13 ? phone : `+${phone}`) : "";
    if (whatsappName) {
      title = formattedPhone ? `${whatsappName} (${formattedPhone})` : whatsappName;
      source = "whatsapp";
    } else {
      title = formattedPhone || phone;
      source = "phone";
    }
  }

  let subtitle: string | undefined;

  // Show secondary info if Google Alias was chosen as main title
  if (googleAlias && whatsappName && whatsappName !== googleAlias) {
    subtitle = `WhatsApp: ${whatsappName}`;
  }

  return {
    title,
    subtitle,
    phone: phone || undefined,
    source,
  };
}
