import { useQuery } from "@tanstack/react-query";

import { api } from "../api";
import { UseQueryParams } from "../types";
import { FindMessagesResponse } from "./types";

import { getAllRemoteJids } from "@/lib/contactNormalization";
import { normalizeMessages } from "@/lib/messageNormalization";
import contactAliases from "@/data/contactAliases.json";

interface IParams {
  instanceName: string;
  remoteJid: string;
}

const queryKey = (params: Partial<IParams>) => ["chats", "findMessages", JSON.stringify(params)];

/**
 * Simple fetch for a single remoteJid.
 */
export const findMessages = async ({ instanceName, remoteJid }: IParams) => {
  const response = await api.post(`/chat/findMessages/${instanceName}`, {
    limit: 100,
    where: { key: { remoteJid } },
  });
  console.log(`[DEBUG] findMessages for ${remoteJid}:`, response.data);
  if (response.data?.messages?.records) {
    return response.data.messages.records;
  }
  return response.data;
};

/**
 * Aggregated fetch – resolves all known JID aliases for the contact,
 * performs a request per alias, merges and normalises the result.
 */
const cleanString = (str: string): string => {
  return str
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
};

export const findMessagesAggregated = async ({ instanceName, remoteJid, canonicalRemoteJid }: IParams & { canonicalRemoteJid?: string | null }) => {
  const dynamicAliases = new Set<string>(getAllRemoteJids(remoteJid));
  if (canonicalRemoteJid) {
    dynamicAliases.add(canonicalRemoteJid);
  }

  // Load all chats to dynamically detect any other matching JID aliases (e.g., same name, pushName, fuzzy match)
  try {
    const chatsResponse = await api.post(`/chat/findChats/${instanceName}`, { where: {} });
    const allChats = Array.isArray(chatsResponse.data) ? chatsResponse.data : [];
    
    // Find the active chat
    const activeChat = allChats.find(c => c.remoteJid === remoteJid || (canonicalRemoteJid && c.remoteJid === canonicalRemoteJid));
    
    // Collect possible identifiers for the active contact
    const activeNames = new Set<string>();
    if (activeChat?.name) activeNames.add(cleanString(activeChat.name));
    if (activeChat?.pushName) activeNames.add(cleanString(activeChat.pushName));
    
    // Include normalized name from Google Contacts aliases database
    const barePhone = remoteJid.split("@")[0];
    const aliasInfo = (contactAliases as any)[barePhone];
    if (aliasInfo?.name) activeNames.add(cleanString(aliasInfo.name));

    if (activeNames.size > 0) {
      allChats.forEach(c => {
        if (!c.remoteJid) return;
        const cName = cleanString(c.name || c.pushName || "");
        if (!cName) return;

        // Substring and fuzzy check: match if exact, contains, or is contained by
        for (const name of activeNames) {
          if (cName === name || cName.includes(name) || name.includes(cName)) {
            dynamicAliases.add(c.remoteJid);
            break;
          }
        }
      });
    }
  } catch (err) {
    console.error("Error loading chats for dynamic alias resolution:", err);
  }

  const allJids = Array.from(dynamicAliases);

  const promises = allJids.map((jid) =>
    api.post(`/chat/findMessages/${instanceName}`, {
      limit: 100,
      where: { key: { remoteJid: jid } },
    })
  );
  const responses = await Promise.all(promises);

  const allRecords: any[] = [];
  responses.forEach((resp) => {
    if (!resp.data) return;

    if (Array.isArray(resp.data)) {
      allRecords.push(...resp.data);
    } else if (resp.data.messages?.records && Array.isArray(resp.data.messages.records)) {
      allRecords.push(...resp.data.messages.records);
    } else if (resp.data.records && Array.isArray(resp.data.records)) {
      allRecords.push(...resp.data.records);
    } else if (resp.data.messages && Array.isArray(resp.data.messages)) {
      allRecords.push(...resp.data.messages);
    } else {
      allRecords.push(resp.data);
    }
  });

  // Normalise (dedup, add canonicalRemoteJid, sort, log mixed JIDs)
  return normalizeMessages(allRecords as any);
};

export const useFindMessages = (props: UseQueryParams<FindMessagesResponse> & Partial<IParams>) => {
  const { instanceName, remoteJid, ...rest } = props;
  return useQuery<FindMessagesResponse>({
    ...rest,
    queryKey: queryKey({ instanceName, remoteJid }),
    queryFn: () => findMessages({ instanceName: instanceName!, remoteJid: remoteJid! }),
    enabled: !!instanceName && !!remoteJid,
  });
};

/**
 * Hook that uses the aggregated version – returns an array of messages
 * already normalised (canonicalRemoteJid, deduped, sorted).
 */
export const useAggregatedMessages = (props: UseQueryParams<any> & Partial<IParams> & { canonicalRemoteJid?: string | null }) => {
  const { instanceName, remoteJid, canonicalRemoteJid, ...rest } = props;
  return useQuery<any>({
    ...rest,
    queryKey: ["aggregatedMessages", instanceName, remoteJid, canonicalRemoteJid],
    queryFn: () => findMessagesAggregated({ instanceName: instanceName!, remoteJid: remoteJid!, canonicalRemoteJid }),
    enabled: !!instanceName && !!remoteJid,
  });
};

