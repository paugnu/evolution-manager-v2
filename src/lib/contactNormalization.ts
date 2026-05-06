import contactAliases from '@/data/contactAliases.json';
import contactJids from '@/data/contactJids.json';

/**
 * Interface describing the alias structure for a contact.
 */
export interface ContactAlias {
  /** The canonical phone JID (e.g., 34652894838@s.whatsapp.net) */
  primaryJid: string;
  /** Optional lid JID (e.g., 50405803319464@lid) */
  lidJid?: string;
  /** Any additional JID aliases (including @lid and phone) */
  aliases: string[];
  /** Human readable name (optional) */
  name?: string;
}

/**
 * Build a map where any known remoteJid resolves to its ContactAlias.
 */
function buildAliasMap(): Record<string, ContactAlias> {
  const map: Record<string, ContactAlias> = {};

  // First, walk through the explicit phone->lid mapping (contactJids.json)
  for (const [phoneJid, lidJid] of Object.entries(contactJids as Record<string, string>)) {
    const primary = phoneJid;
    const aliases = [phoneJid];
    if (lidJid) aliases.push(lidJid);
    map[phoneJid] = { primaryJid: primary, lidJid, aliases };
    if (lidJid) {
      map[lidJid] = { primaryJid: primary, lidJid, aliases };
    }
  }

  // Merge name information from contactAliases.json (keys are bare numbers)
  for (const [bare, info] of Object.entries(contactAliases as Record<string, any>)) {
    const phoneJid = `${bare}@s.whatsapp.net`;
    const existing = map[phoneJid] ?? { primaryJid: phoneJid, aliases: [phoneJid] };
    existing.name = info.name;
    // Ensure the mapping also contains any lid alias if previously added
    map[phoneJid] = existing;
    if (existing.lidJid) {
      map[existing.lidJid] = existing;
    }
  }

  return map;
}

/** Global alias map – built once at import time. */
const aliasMap = buildAliasMap();

/**
 * Return the canonical (primary) JID for any given remoteJid.
 */
export function getCanonicalJid(remoteJid: string): string {
  const entry = aliasMap[remoteJid];
  return entry?.primaryJid ?? remoteJid;
}

/**
 * Return every remoteJid that belongs to the same contact (including the original).
 */
export function getAllRemoteJids(remoteJid: string): string[] {
  const entry = aliasMap[remoteJid];
  return entry?.aliases ?? [remoteJid];
}

/**
 * Utility to check if two remoteJids refer to the same contact.
 */
export function isAlias(remoteJid: string, targetJid: string): boolean {
  const all = getAllRemoteJids(remoteJid);
  return all.includes(targetJid);
}

export default aliasMap;
