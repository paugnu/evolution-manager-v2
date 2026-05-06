import { useQuery } from "@tanstack/react-query";

import { api } from "../api";
import { UseQueryParams } from "../types";
import { FindMessagesResponse } from "./types";
import { getContactJidAliases, getCanonicalJid } from "../../contact-aliases";

interface IParams {
  instanceName: string;
  remoteJid: string;
}

const queryKey = (params: Partial<IParams>) => ["chats", "findMessages", JSON.stringify(params)];

export const findMessages = async ({ instanceName, remoteJid }: IParams) => {
  const aliases = getContactJidAliases(remoteJid);
  const canonicalJid = getCanonicalJid(remoteJid);

  console.log(`[DEBUG] Fetching messages for canonical JID: ${canonicalJid} using aliases:`, aliases);

  const fetchPromises = aliases.map(async (aliasJid) => {
    try {
      const response = await api.post(`/chat/findMessages/${instanceName}`, {
        limit: 100,
        where: { key: { remoteJid: aliasJid } },
      });
      const records = response.data?.messages?.records || response.data?.records || [];
      return records.map((msg: any) => ({
        ...msg,
        originalRemoteJid: msg.key?.remoteJid || aliasJid,
        canonicalRemoteJid: canonicalJid,
      }));
    } catch (err) {
      console.error(`[ERROR] Failed to fetch messages for alias ${aliasJid}:`, err);
      return [];
    }
  });

  const results = await Promise.all(fetchPromises);
  const allMerged = results.flat();

  // Deduplicate by key.id
  const seenIds = new Set<string>();
  const deduplicated: any[] = [];
  let hasLid = false;
  let hasPhone = false;

  allMerged.forEach((msg) => {
    const msgId = msg.key?.id;
    if (msgId && !seenIds.has(msgId)) {
      seenIds.add(msgId);
      deduplicated.push(msg);

      // Detect mixed messages
      const remoteJidVal = msg.key?.remoteJid || "";
      if (remoteJidVal.includes("@lid")) {
        hasLid = true;
      } else if (remoteJidVal.includes("@s.whatsapp.net")) {
        hasPhone = true;
      }
    }
  });

  // Log temporary message mix detection
  if (hasLid && hasPhone) {
    console.log(`[DEBUG] Mixed JID conversation detected for canonical JID: ${canonicalJid}. Contains both @lid and @s.whatsapp.net messages.`);
  }

  // Sort messages by messageTimestamp ascending (temporal order)
  const getTimestampNum = (msg: any): number => {
    if (!msg.messageTimestamp) return 0;
    const ts = Number(msg.messageTimestamp);
    return ts > 100000000000 ? ts : ts * 1000;
  };

  deduplicated.sort((a, b) => getTimestampNum(a) - getTimestampNum(b));

  return deduplicated;
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
