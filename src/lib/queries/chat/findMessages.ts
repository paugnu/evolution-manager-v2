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
export const findMessagesAggregated = async ({ instanceName, remoteJid }: IParams) => {
  const allJids = getAllRemoteJids(remoteJid);
  const promises = allJids.map((jid) =>
    api.post(`/chat/findMessages/${instanceName}`, {
      limit: 100,
      where: { key: { remoteJid: jid } },
    })
  );
  const responses = await Promise.all(promises);

  const allRecords: any[] = [];
  responses.forEach((resp) => {
    if (resp.data?.messages?.records) {
      allRecords.push(...resp.data.messages.records);
    } else if (resp.data) {
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
export const useAggregatedMessages = (props: UseQueryParams<any> & Partial<IParams>) => {
  const { instanceName, remoteJid, ...rest } = props;
  return useQuery<any>({
    ...rest,
    queryKey: ["aggregatedMessages", instanceName, remoteJid],
    queryFn: () => findMessagesAggregated({ instanceName: instanceName!, remoteJid: remoteJid! }),
    enabled: !!instanceName && !!remoteJid,
  });
};

