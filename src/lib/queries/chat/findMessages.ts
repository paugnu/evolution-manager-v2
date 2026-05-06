import { useQuery } from "@tanstack/react-query";

import { api } from "../api";
import { UseQueryParams } from "../types";
import { FindMessagesResponse } from "./types";

import { getAllRemoteJids } from "@/lib/contactNormalization";
import { normalizeMessages } from "@/lib/messageNormalization";

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
export const findMessagesAggregated = async ({ instanceName, remoteJid, canonicalRemoteJid }: IParams & { canonicalRemoteJid?: string | null }) => {
  const dynamicAliases = new Set<string>(getAllRemoteJids(remoteJid));
  if (canonicalRemoteJid) {
    dynamicAliases.add(canonicalRemoteJid);
  }

  // Load all chats to dynamically detect any other matching JID aliases (e.g., same name or pushName)
  try {
    const chatsResponse = await api.post(`/chat/findChats/${instanceName}`, { where: {} });
    const allChats = Array.isArray(chatsResponse.data) ? chatsResponse.data : [];
    
    // Find the active chat to get its identifier names
    const activeChat = allChats.find(c => c.remoteJid === remoteJid || (canonicalRemoteJid && c.remoteJid === canonicalRemoteJid));
    const activeChatName = activeChat?.name || activeChat?.pushName;
    
    if (activeChatName) {
      allChats.forEach(c => {
        const cName = c.name || c.pushName;
        if (cName && cName === activeChatName && c.remoteJid) {
          dynamicAliases.add(c.remoteJid);
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

