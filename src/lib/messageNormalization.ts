import { Message } from '@/types/evolution.types';
import { getCanonicalJid } from './contactNormalization';

/**
 * Normaliza un conjunto de mensajes:
 *   - deduplica por key.id
 *   - añade originalRemoteJid y canonicalRemoteJid
 *   - ordena por messageTimestamp (ascendente por defecto)
 *   - registra advertencias si aparecen varios remoteJid diferentes para la misma conversación
 */
export function normalizeMessages(messages: Message[]): Message[] {
  const dedupMap = new Map<string, Message>();
  const remoteJidSet = new Set<string>();

  for (const msg of messages) {
    // deduplication
    if (msg.key?.id && dedupMap.has(msg.key.id)) {
      // keep the newer one (higher timestamp)
      const existing = dedupMap.get(msg.key.id)!;
      if ((msg.messageTimestamp ?? 0) > (existing.messageTimestamp ?? 0)) {
        dedupMap.set(msg.key.id, msg);
      }
      continue;
    }

    // record remoteJid variations
    if (msg.key?.remoteJid) remoteJidSet.add(msg.key.remoteJid);

    // add extra fields (casting to any to keep type simple)
    const extended = msg as any;
    extended.originalRemoteJid = msg.key?.remoteJid ?? '';
    extended.canonicalRemoteJid = getCanonicalJid(msg.key?.remoteJid ?? '');
    dedupMap.set(msg.key?.id ?? Math.random().toString(), extended);
  }

  // Log mixed JIDs if more than one appears for the same conversation
  if (remoteJidSet.size > 1) {
    console.warn('[WARN] Mixed remoteJids detected in conversation:', Array.from(remoteJidSet));
  }

  const result = Array.from(dedupMap.values()) as Message[];
  // Orden ascendente (más antiguo primero) – UI puede invertir si lo necesita
  result.sort((a, b) => {
    const aTs = Number((a as any).messageTimestamp ?? 0);
    const bTs = Number((b as any).messageTimestamp ?? 0);
    return aTs - bTs;
  });
  return result;
}
