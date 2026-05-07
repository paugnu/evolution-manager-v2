import { useQuery } from "@tanstack/react-query";

import { api } from "../api";
import { UseQueryParams } from "../types";
import { FindMessagesResponse } from "./types";

import { getAllRemoteJids } from "@/lib/contactNormalization";
import { normalizeMessages } from "@/lib/messageNormalization";
import { getContactAliasName } from "@/lib/contact-aliases";
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

  try {
    const chatsResponse = await api.post(`/chat/findChats/${instanceName}`, { where: {} });
    const allChats = Array.isArray(chatsResponse.data) ? chatsResponse.data : [];

    // Let's build maps from allChats to find matching JIDs
    const aliasToPhoneJidMap = new Map<string, string>();
    const nameToPhoneJidMap = new Map<string, string>();
    const picToPhoneJidMap = new Map<string, string>();

    allChats.forEach((chat: any) => {
      const isPhone = chat.remoteJid?.endsWith("@s.whatsapp.net");
      if (isPhone) {
        const googleAlias = getContactAliasName(chat.remoteJid);
        if (googleAlias) {
          aliasToPhoneJidMap.set(googleAlias.toLowerCase(), chat.remoteJid);
        }
        const name = (chat.name || chat.pushName || "").toLowerCase();
        if (name && name !== chat.remoteJid.split("@")[0]) {
          nameToPhoneJidMap.set(name, chat.remoteJid);
        }
        const pic = chat.profilePicUrl;
        if (pic && pic.includes("http") && !pic.includes("default") && !pic.includes("avatar")) {
          picToPhoneJidMap.set(pic, chat.remoteJid);
        }
      }
    });

    // Determine the phone JID of our active chat
    let activePhoneJid = remoteJid.endsWith("@s.whatsapp.net") ? remoteJid : "";
    if (!activePhoneJid && canonicalRemoteJid?.endsWith("@s.whatsapp.net")) {
      activePhoneJid = canonicalRemoteJid;
    }

    if (!activePhoneJid) {
      const googleAlias = getContactAliasName(remoteJid);
      if (googleAlias) {
        activePhoneJid = aliasToPhoneJidMap.get(googleAlias.toLowerCase()) || "";
      }
      if (!activePhoneJid) {
        const activeChat = allChats.find((c: any) => c.remoteJid === remoteJid);
        const rawName =
          activeChat?.name ||
          activeChat?.pushName ||
          activeChat?.lastMessage?.pushName ||
          activeChat?.lastMessage?.message?.pushName ||
          activeChat?.lastMessage?.key?.pushName ||
          "";
        const name = rawName.toLowerCase();
        if (name) {
          activePhoneJid = nameToPhoneJidMap.get(name) || "";
        }
      }
    }

    if (activePhoneJid) {
      dynamicAliases.add(activePhoneJid);

      const targetGoogleAlias = getContactAliasName(activePhoneJid);
      const targetPhoneChat = allChats.find((c: any) => c.remoteJid === activePhoneJid);
      const targetRawName =
        targetPhoneChat?.name ||
        targetPhoneChat?.pushName ||
        targetPhoneChat?.lastMessage?.pushName ||
        targetPhoneChat?.lastMessage?.message?.pushName ||
        targetPhoneChat?.lastMessage?.key?.pushName ||
        "";
      const targetName = targetRawName.toLowerCase().replace(/[^a-z0-9]/g, "");

      allChats.forEach((chat: any) => {
        if (!chat.remoteJid) return;
        if (chat.remoteJid === activePhoneJid) return;

        let matches = false;

        const pic = chat.profilePicUrl;
        const targetPic = targetPhoneChat?.profilePicUrl;
        if (pic && targetPic && pic.includes("http") && pic === targetPic && !pic.includes("default") && !pic.includes("avatar")) {
          matches = true;
        }

        if (!matches && targetGoogleAlias) {
          const googleAlias = getContactAliasName(chat.remoteJid);
          if (googleAlias && googleAlias.toLowerCase() === targetGoogleAlias.toLowerCase()) {
            matches = true;
          }
        }

        if (!matches && chat.remoteJid.endsWith("@lid")) {
          const rawName =
            chat.name ||
            chat.pushName ||
            chat.lastMessage?.pushName ||
            chat.lastMessage?.message?.pushName ||
            chat.lastMessage?.key?.pushName ||
            "";
          const name = rawName.toLowerCase().replace(/[^a-z0-9]/g, "");
          if (name && name.length >= 3) {
            if (targetName && targetName.length >= 3) {
              if (name.includes(targetName) || targetName.includes(name)) {
                matches = true;
              }
            }
            if (!matches && name.length >= 4 && targetName && targetName.length >= 4) {
              if (name.substring(0, 4) === targetName.substring(0, 4)) {
                matches = true;
              }
            }
          }
        }

        if (matches) {
          dynamicAliases.add(chat.remoteJid);
        }
      });
    }

    if (dynamicAliases.size <= 1) {
      const activeChat = allChats.find(c => c.remoteJid === remoteJid || (canonicalRemoteJid && c.remoteJid === canonicalRemoteJid));
      const activeNames = new Set<string>();
      if (activeChat?.name) activeNames.add(cleanString(activeChat.name));
      if (activeChat?.pushName) activeNames.add(cleanString(activeChat.pushName));
      const barePhone = remoteJid.split("@")[0];
      const aliasInfo = (contactAliases as any)[barePhone];
      if (aliasInfo?.name) activeNames.add(cleanString(aliasInfo.name));

      if (activeNames.size > 0) {
        allChats.forEach(c => {
          if (!c.remoteJid) return;
          const cName = cleanString(c.name || c.pushName || "");
          if (!cName) return;
          for (const name of activeNames) {
            if (cName === name || cName.includes(name) || name.includes(cName)) {
              dynamicAliases.add(c.remoteJid);
              break;
            }
          }
        });
      }
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

