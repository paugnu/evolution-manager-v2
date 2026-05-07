import "./style.css";
import { User, Search, MessageSquare, MoreVertical } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

import { useInstance } from "@/contexts/InstanceContext";

import { useFindChats } from "@/lib/queries/chat/findChats";
import { getToken, TOKEN_ID } from "@/lib/queries/token";

import { Chat as ChatType } from "@/types/evolution.types";

import React from "react";
import { getStructuredContactDisplay, getContactAliasName } from "@/lib/contact-aliases";
import { getCanonicalJid } from "@/lib/contactNormalization";
import { useMediaQuery } from "@/utils/useMediaQuery";

import { connectSocket, disconnectSocket } from "@/services/websocket/socket";

import { Messages } from "./messages";

// Simple utility function
const formatJid = (remoteJid: string): string => {
  return remoteJid.split("@")[0];
};

const getChatTimestamp = (chat: any): number => {
  if (chat.lastMessage?.messageTimestamp) {
    const ts = Number(chat.lastMessage.messageTimestamp);
    return ts > 100000000000 ? ts : ts * 1000;
  }
  if (chat.updatedAt) {
    const date = new Date(chat.updatedAt);
    if (!isNaN(date.getTime()) && date.getFullYear() < 2030) {
      return date.getTime();
    }
  }
  if (chat.createdAt) {
    const date = new Date(chat.createdAt);
    if (!isNaN(date.getTime())) {
      return date.getTime();
    }
  }
  return 0;
};

const getLastMessagePreview = (chat: any): string => {
  if (!chat?.lastMessage) {
    const rawPhone = chat?.remoteJid || "";
    return rawPhone ? rawPhone.split("@")[0] : "";
  }

  const lastMsg = chat.lastMessage;
  const fromMe = lastMsg.key?.fromMe ? "Tú: " : "";

  // 1. If it has a simplified text directly
  if (typeof lastMsg === "string") return `${fromMe}${lastMsg}`;
  if (lastMsg.messageText) return `${fromMe}${lastMsg.messageText}`;

  // 2. If it is a structured Baileys/Evolution message
  const msgBody = lastMsg.message;
  if (!msgBody) {
    return "Mensaje";
  }

  // Conversation & Extended Text
  if (typeof msgBody === "string") return `${fromMe}${msgBody}`;
  if (msgBody.conversation) return `${fromMe}${msgBody.conversation}`;
  if (msgBody.extendedTextMessage?.text) return `${fromMe}${msgBody.extendedTextMessage.text}`;

  // Media
  if (msgBody.imageMessage) return `${fromMe}📷 Foto`;
  if (msgBody.videoMessage) return `${fromMe}🎥 Video`;
  if (msgBody.audioMessage) return `${fromMe}🎵 Audio`;
  if (msgBody.documentMessage) return `${fromMe}📄 Documento`;
  if (msgBody.stickerMessage) return `${fromMe}🎨 Sticker`;
  if (msgBody.contactMessage) return `${fromMe}👤 Contacto`;
  if (msgBody.locationMessage) return `${fromMe}📍 Ubicación`;

  // Reaction/Interaction message (liked, pinned, etc.)
  if (msgBody.reactionMessage) {
    const react = msgBody.reactionMessage;
    return `Reaccionó: ${react.text || ""}`;
  }
  if (msgBody.pinInChatMessage) {
    return "📌 Mensaje fijado";
  }

  // Fallback to generic message preview
  return "Mensaje";
};

function Chat() {
  const isMD = useMediaQuery("(min-width: 768px)");
  const lastMessageRef = useRef<HTMLDivElement | null>(null);
  const [textareaHeight] = useState("auto");
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const { instance } = useInstance();

  // Local state for real-time chats (to supplement React Query data)
  const [realtimeChats, setRealtimeChats] = useState<ChatType[]>([]);

  const { data: chats, isSuccess } = useFindChats({
    instanceName: instance?.name,
    refetchInterval: 10000,
    staleTime: 0,
    refetchIntervalInBackground: true,
  });

  // Combine React Query chats with real-time updates
  const allChats = React.useMemo(() => {
    if (!chats) return realtimeChats;
    console.log("[DEBUG] chats from API:", chats);

    // Merge chats from React Query with real-time updates
    const rawChatMap = new Map();

    // First add all chats from React Query
    chats.forEach((chat) => rawChatMap.set(chat.remoteJid, chat));

    // Then add/update with real-time chats
    realtimeChats.forEach((chat) => {
      const existing = rawChatMap.get(chat.remoteJid);
      if (existing) {
        rawChatMap.set(chat.remoteJid, { ...existing, ...chat });
      } else {
        rawChatMap.set(chat.remoteJid, chat);
      }
    });

    const rawList = Array.from(rawChatMap.values()) as ChatType[];

    // Group and deduplicate LID and phone chats
    const resolvedMap = new Map<string, ChatType>();

    // Build a map of google alias -> phone JID, name/pushname -> phone JID, and profilePicUrl -> phone JID
    const aliasToPhoneJidMap = new Map<string, string>();
    const nameToPhoneJidMap = new Map<string, string>();
    const picToPhoneJidMap = new Map<string, string>();

    rawList.forEach((chat) => {
      const isPhone = chat.remoteJid.endsWith("@s.whatsapp.net");
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

    rawList.forEach((chat) => {
      let canonicalJid = getCanonicalJid(chat.remoteJid);

      // If it's a LID JID and was not resolved by getCanonicalJid (still ends with @lid)
      if (canonicalJid.endsWith("@lid")) {
        // Layer 1: Try to match by Profile Picture
        const pic = chat.profilePicUrl;
        if (pic && pic.includes("http") && !pic.includes("default") && !pic.includes("avatar")) {
          const matchedPhoneJid = picToPhoneJidMap.get(pic);
          if (matchedPhoneJid) {
            canonicalJid = matchedPhoneJid;
          }
        }

        // Layer 2: Try to match by Google Contacts Alias
        if (canonicalJid.endsWith("@lid")) {
          const googleAlias = getContactAliasName(chat.remoteJid);
          if (googleAlias) {
            const matchedPhoneJid = aliasToPhoneJidMap.get(googleAlias.toLowerCase());
            if (matchedPhoneJid) {
              canonicalJid = matchedPhoneJid;
            }
          }
        }

        // Layer 3: Try to match by Name Substring or Prefix
        if (canonicalJid.endsWith("@lid")) {
          const name = (chat.name || chat.pushName || "").toLowerCase().replace(/[^a-z0-9]/g, "");
          if (name && name.length >= 3) {
            let foundMatch = false;
            // First try substring matching
            for (const [phoneName, phoneJid] of nameToPhoneJidMap.entries()) {
              const cleanedPhoneName = phoneName.replace(/[^a-z0-9]/g, "");
              if (cleanedPhoneName && cleanedPhoneName.length >= 3) {
                if (name.includes(cleanedPhoneName) || cleanedPhoneName.includes(name)) {
                  canonicalJid = phoneJid;
                  foundMatch = true;
                  break;
                }
              }
            }

            // Second try prefix matching (first 4 characters)
            if (!foundMatch && name.length >= 4) {
              for (const [phoneName, phoneJid] of nameToPhoneJidMap.entries()) {
                const cleanedPhoneName = phoneName.replace(/[^a-z0-9]/g, "");
                if (cleanedPhoneName && cleanedPhoneName.length >= 4) {
                  if (name.substring(0, 4) === cleanedPhoneName.substring(0, 4)) {
                    canonicalJid = phoneJid;
                    break;
                  }
                }
              }
            }
          }
        }
      }

      const existing = resolvedMap.get(canonicalJid);
      if (!existing) {
        resolvedMap.set(canonicalJid, chat);
      } else {
        // Keep the newer chat (with the latest message/timestamp) and merge descriptive fields
        const tsExisting = getChatTimestamp(existing);
        const tsCurrent = getChatTimestamp(chat);
        if (tsCurrent > tsExisting) {
          resolvedMap.set(canonicalJid, {
            ...chat,
            pushName: existing.pushName || chat.pushName,
            profilePicUrl: existing.profilePicUrl || chat.profilePicUrl,
          });
        } else {
          resolvedMap.set(canonicalJid, {
            ...existing,
            pushName: existing.pushName || chat.pushName,
            profilePicUrl: existing.profilePicUrl || chat.profilePicUrl,
          });
        }
      }
    });

    const list = Array.from(resolvedMap.values());
    return list.sort((a, b) => getChatTimestamp(b) - getChatTimestamp(a));
  }, [chats, realtimeChats]);

  const [searchQuery, setSearchQuery] = useState("");

  const filteredChats = React.useMemo(() => {
    if (!searchQuery.trim()) return allChats;
    const query = searchQuery.toLowerCase();
    return allChats.filter((chat) => {
      const displayName = (chat.pushName || "").toLowerCase();
      const phone = (chat.remoteJid || "").split("@")[0].toLowerCase();
      const structured = getStructuredContactDisplay(chat);
      const title = (structured.title || "").toLowerCase();
      const subtitle = (structured.subtitle || "").toLowerCase();
      return displayName.includes(query) || phone.includes(query) || title.includes(query) || subtitle.includes(query);
    });
  }, [allChats, searchQuery]);

  const { instanceId, remoteJid } = useParams<{
    instanceId: string;
    remoteJid: string;
  }>();

  const navigate = useNavigate();

  // Add websocket functionality for real-time updates
  useEffect(() => {
    if (!instance?.name) return;

    const serverUrl = getToken(TOKEN_ID.API_URL);
    if (!serverUrl) {
      console.error("API URL not found in localStorage");
      return;
    }

    const socket = connectSocket(serverUrl);

    // Function to update chats from websocket events
    const updateChatsFromWebsocket = (_eventType: string, data: any) => {
      if (!instance) return;

      if (data.instance !== instance.name) {
        return;
      }

      const messageRemoteJid = data?.data?.key?.remoteJid;
      if (!messageRemoteJid) {
        return;
      }

      setRealtimeChats((prevChats) => {
        const existingChatIndex = prevChats.findIndex((chat) => chat.remoteJid === messageRemoteJid);

        // Create or update chat object
        const chatObject: ChatType = {
          id: messageRemoteJid,
          remoteJid: messageRemoteJid,
          pushName: data?.data?.pushName || formatJid(messageRemoteJid),
          profilePicUrl: data?.data?.key?.profilePictureUrl || "",
          // Add other required fields
          ...data?.data,
        };

        if (existingChatIndex !== -1) {
          // Update existing chat
          const updatedChats = [...prevChats];
          updatedChats[existingChatIndex] = {
            ...updatedChats[existingChatIndex],
            ...chatObject,
          };
          return updatedChats;
        } else {
          // Add new chat
          return [...prevChats, chatObject];
        }
      });
    };

    // Set up event listeners
    socket.on("messages.upsert", (data: any) => {
      updateChatsFromWebsocket("messages.upsert", data);
    });

    socket.on("send.message", (data: any) => {
      updateChatsFromWebsocket("send.message", data);
    });

    // socket.connect();

    // Cleanup function
    return () => {
      socket.off("messages.upsert");
      socket.off("send.message");
      disconnectSocket(socket);
    };
  }, [instance?.name]);

  const scrollToBottom = useCallback(() => {
    if (lastMessageRef.current) {
      lastMessageRef.current.scrollIntoView({});
    }
  }, []);

  const handleTextareaChange = () => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      const scrollHeight = textareaRef.current.scrollHeight;
      const lineHeight = parseInt(getComputedStyle(textareaRef.current).lineHeight);
      const maxHeight = lineHeight * 10;
      textareaRef.current.style.height = `${Math.min(scrollHeight, maxHeight)}px`;
    }
  };

  useEffect(() => {
    if (isSuccess) {
      scrollToBottom();
    }
  }, [isSuccess, scrollToBottom]);

  const handleChat = (id: string) => {
    navigate(`/manager/instance/${instanceId}/chat/${id}`);
  };

  return (
    <div className="h-[calc(100vh-72px)] overflow-hidden">
      <ResizablePanelGroup direction={isMD ? "horizontal" : "vertical"} className="h-full">
        <ResizablePanel defaultSize={20}>
          <div className="hidden h-full flex-col bg-[#111b21] text-foreground md:flex border-r border-slate-800">
            {/* Sidebar Header */}
            <div className="flex-shrink-0 flex items-center justify-between bg-[#202c33] px-3.5 py-3 border-b border-slate-800">
              <div className="flex items-center gap-2.5 min-w-0">
                <Avatar className="h-10 w-10 border border-slate-700 shrink-0">
                  <AvatarImage src={instance?.profilePicUrl} alt={instance?.name} />
                  <AvatarFallback className="bg-slate-700 text-slate-300">
                    <User className="h-5 w-5" />
                  </AvatarFallback>
                </Avatar>
                <div className="flex flex-col min-w-0">
                  <span className="text-sm font-semibold text-slate-200 truncate">{instance?.name || "WhatsApp"}</span>
                  <span className="text-[11px] text-emerald-400 font-medium">Conectado</span>
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0 text-slate-400">
                <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full text-slate-300 hover:bg-slate-800">
                  <MessageSquare className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full text-slate-300 hover:bg-slate-800">
                  <MoreVertical className="h-4 w-4" />
                </Button>
              </div>
            </div>

            {/* Search Input Bar */}
            <div className="p-2.5 bg-[#111b21] border-b border-slate-800/60 flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
                <input
                  type="text"
                  placeholder="Buscar o empezar un nuevo chat"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full bg-[#202c33] text-slate-200 placeholder-slate-500 text-xs rounded-lg pl-10 pr-4 py-2 outline-none focus:ring-1 focus:ring-emerald-500/50 border-none"
                />
              </div>
            </div>

            {/* Filter Tabs as WhatsApp Pills */}
            <Tabs defaultValue="contacts" className="flex flex-col flex-1 min-h-0">
              <TabsList className="tabs-chat flex-shrink-0 bg-[#111b21] p-2 px-3 gap-2 flex justify-start border-b border-slate-800/40">
                <TabsTrigger value="contacts" className="px-3.5 py-1 text-xs rounded-full border-none data-[state=active]:bg-[#00a884] data-[state=active]:text-[#111b21] bg-slate-800 text-slate-400 font-medium transition-all">
                  Contactos
                </TabsTrigger>
                <TabsTrigger value="groups" className="px-3.5 py-1 text-xs rounded-full border-none data-[state=active]:bg-[#00a884] data-[state=active]:text-[#111b21] bg-slate-800 text-slate-400 font-medium transition-all">
                  Grupos
                </TabsTrigger>
              </TabsList>

              <TabsContent value="contacts" className="flex-1 overflow-hidden m-0">
                <div className="h-full overflow-auto bg-[#111b21] message-list">
                  <div className="flex flex-col">
                    {filteredChats?.map(
                      (chat: ChatType) =>
                        !chat.remoteJid.includes("@g.us") && !chat.remoteJid.includes("@newsletter") && chat.remoteJid !== "status@broadcast" && (
                          <Link
                            key={chat.remoteJid}
                            to="#"
                            onClick={() => handleChat(chat.remoteJid)}
                            className={`chat-item flex items-center overflow-hidden gap-3 px-3 py-3 text-sm transition-colors border-b border-slate-800/40 ${
                              remoteJid === chat.remoteJid ? "active" : ""
                            }`}>
                            <span className="chat-avatar shrink-0">
                              <Avatar className="h-11 w-11 border border-slate-800">
                                <AvatarImage src={chat.profilePicUrl} alt={chat.pushName || chat.remoteJid.split("@")[0]} />
                                <AvatarFallback className="bg-slate-700 text-slate-300 border border-slate-600">
                                  <User className="h-5 w-5" />
                                </AvatarFallback>
                              </Avatar>
                            </span>
                            {(() => {
                              const info = getStructuredContactDisplay(chat);
                              return (
                                <div className="min-w-0 flex-1 flex flex-col gap-0.5">
                                  <div className="flex items-center justify-between">
                                    <span className="chat-title font-medium text-slate-200 truncate">{info.title}</span>
                                    <span className="text-[10px] text-slate-500 shrink-0">
                                      {chat.lastMessage?.messageTimestamp 
                                        ? new Date(getChatTimestamp(chat)).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
                                        : ""}
                                    </span>
                                  </div>
                                  <div className="flex items-center justify-between">
                                    <span className="chat-description text-xs text-slate-400 truncate">
                                      {getLastMessagePreview(chat)}
                                    </span>
                                  </div>
                                </div>
                              );
                            })()}
                          </Link>
                        ),
                    )}
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="groups" className="flex-1 overflow-hidden m-0">
                <div className="h-full overflow-auto bg-[#111b21] message-list">
                  <div className="flex flex-col">
                    {filteredChats?.map(
                      (chat: ChatType) =>
                        chat.remoteJid.includes("@g.us") && (
                          <Link
                            key={chat.remoteJid}
                            to="#"
                            onClick={() => handleChat(chat.remoteJid)}
                            className={`chat-item flex items-center overflow-hidden gap-3 px-3 py-3 text-sm transition-colors border-b border-slate-800/40 ${
                              remoteJid === chat.remoteJid ? "active" : ""
                            }`}>
                            <span className="chat-avatar shrink-0">
                              <Avatar className="h-11 w-11 border border-slate-800">
                                <AvatarImage src={chat.profilePicUrl} alt={chat.pushName || chat.remoteJid.split("@")[0]} />
                                <AvatarFallback className="bg-slate-700 text-slate-300 border border-slate-600">
                                  <User className="h-5 w-5" />
                                </AvatarFallback>
                              </Avatar>
                            </span>
                            <div className="min-w-0 flex-1 flex flex-col gap-0.5">
                              <div className="flex items-center justify-between">
                                <span className="chat-title font-medium text-slate-200 truncate">{chat.pushName || chat.remoteJid.split("@")[0]}</span>
                                <span className="text-[10px] text-slate-500 shrink-0">
                                  {chat.lastMessage?.messageTimestamp 
                                    ? new Date(getChatTimestamp(chat)).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
                                    : ""}
                                </span>
                              </div>
                              <span className="chat-description text-xs text-slate-400 truncate">
                                {getLastMessagePreview(chat)}
                              </span>
                            </div>
                          </Link>
                        ),
                    )}
                  </div>
                </div>
              </TabsContent>
            </Tabs>
          </div>
        </ResizablePanel>
        <ResizableHandle withHandle className="border border-black" />
        <ResizablePanel>
          {remoteJid && (
            <Messages textareaRef={textareaRef} handleTextareaChange={handleTextareaChange} textareaHeight={textareaHeight} lastMessageRef={lastMessageRef} />
          )}
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}

export { Chat };
