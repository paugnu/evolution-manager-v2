import { DropdownMenu, DropdownMenuTrigger } from "@radix-ui/react-dropdown-menu";
import { ArrowRightIcon, ChevronDownIcon, SparkleIcon, User, ZapIcon, ClockIcon, TrashIcon, CalendarIcon, SendIcon, AlertCircleIcon, Search, MoreVertical } from "lucide-react";
import { RefObject, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

import { useInstance } from "@/contexts/InstanceContext";

import { useFindChat } from "@/lib/queries/chat/findChat";
import { useAggregatedMessages } from "@/lib/queries/chat/findMessages";
import { useSendMessage, useSendMedia } from "@/lib/queries/chat/sendMessage";

import {
  useCreateScheduledMessage,
  useFindScheduledMessages,
  useCancelScheduledMessage,
  useSendScheduledMessageNow
} from "@/lib/queries/chat/scheduledMessages";

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { toast } from "react-toastify";

import { getToken, TOKEN_ID } from "@/lib/queries/token";
import { api } from "@/lib/queries/api";

import { Message } from "@/types/evolution.types";
import { getContactDisplayName, getStructuredContactDisplay } from "@/lib/contact-aliases";

import { connectSocket, disconnectSocket } from "@/services/websocket/socket";

// Import components from EmbedChatMessage for attachment functionality
import { MediaOptions } from "../EmbedChatMessage/InputMessage/media-options";
import { SelectedMedia } from "../EmbedChatMessage/InputMessage/selected-media";

type MessagesProps = {
  textareaRef: RefObject<HTMLTextAreaElement>;
  handleTextareaChange: () => void;
  textareaHeight: string;
  lastMessageRef: RefObject<HTMLDivElement>;
  scrollToBottom: () => void;
};

// Utility function to format dates like WhatsApp
const formatDateSeparator = (date: Date): string => {
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  const messageDate = new Date(date);

  // Check if it's today
  if (messageDate.toDateString() === today.toDateString()) {
    return "Hoje";
  }

  // Check if it's yesterday
  if (messageDate.toDateString() === yesterday.toDateString()) {
    return "Ontem";
  }

  // Check if it's within the last week
  const daysDiff = Math.floor((today.getTime() - messageDate.getTime()) / (1000 * 60 * 60 * 24));
  if (daysDiff < 7) {
    return messageDate.toLocaleDateString("pt-BR", { weekday: "long" });
  }

  // For older dates, show the full date
  return messageDate.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
};

// Utility function to get timestamp from message
const getMessageTimestamp = (message: Message): Date => {
  try {
    if (!message.messageTimestamp) {
      return new Date();
    }

    // Handle case where timestamp is an object
    if (typeof message.messageTimestamp === "object") {
      const possibleTimestamps = [
        (message.messageTimestamp as any).low,
        (message.messageTimestamp as any).seconds,
        (message.messageTimestamp as any).timestamp,
        (message.messageTimestamp as any).time,
        (message.messageTimestamp as any).value,
      ];

      const timestamp = possibleTimestamps.find((val) => typeof val === "number" && !isNaN(val)) || Date.now() / 1000;

      return new Date(timestamp * 1000);
    }
    // Handle number or numeric string
    else if (!isNaN(Number(message.messageTimestamp))) {
      const timestamp = Number(message.messageTimestamp);

      // Check if it's milliseconds format (13 digits) or seconds format (10 digits)
      if (timestamp > 1000000000000) {
        return new Date(timestamp);
      } else {
        return new Date(timestamp * 1000);
      }
    }
    // If it's an ISO date string format
    else if (typeof message.messageTimestamp === "string" && message.messageTimestamp.includes("T")) {
      return new Date(message.messageTimestamp);
    }

    return new Date();
  } catch (error) {
    return new Date();
  }
};

// Component for date separator
const DateSeparator = ({ date }: { date: string }) => (
  <div className="flex items-center justify-center my-3 select-none">
    <div className="rounded-lg bg-[#182229]/85 px-3 py-1.5 border border-slate-800/20 shadow-sm">
      <span className="text-[11px] font-normal text-slate-300 uppercase tracking-wider">{date}</span>
    </div>
  </div>
);

// Helper function to extract text content from message
const getMessageText = (messageObj: any): string => {
  if (!messageObj) return "";

  // Try to parse if it's a string
  if (typeof messageObj === "string") {
    try {
      const parsed = JSON.parse(messageObj);
      return parsed.conversation || parsed.text || messageObj;
    } catch {
      return messageObj;
    }
  }

  // If it's already an object, extract conversation or text
  if (typeof messageObj === "object") {
    return messageObj.conversation || messageObj.text || "";
  }

  return String(messageObj);
};

// Helper to safely format file length
const formatFileLength = (length: any) => {
  const num = Number(length);
  if (isNaN(num) || num <= 0) return "Tamaño desconocido";
  return `${(num / 1024 / 1024).toFixed(2)} MB`;
};

// Component for clean media placeholder with on-demand fetching
const MediaPlaceholder = ({
  type,
  message,
  onMediaLoaded,
}: {
  type: string;
  message?: Message;
  onMediaLoaded?: (base64: string) => void;
}) => {
  const { instance } = useInstance();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  const handleFetchMedia = async () => {
    if (!message?.key?.id || !instance?.name || loading) return;
    setLoading(true);
    setError(false);
    try {
      // 1. Try first structure with message containing key only
      const response = await api.post(`/chat/getBase64FromMediaMessage/${instance.name}`, {
        message: {
          key: message.key,
        },
        convertToMp4: false,
      });

      const base64Data = response.data?.base64;
      if (base64Data) {
        let prefix = "";
        if (type === "image") prefix = "data:image/jpeg;base64,";
        else if (type === "video") prefix = "data:video/mp4;base64,";
        else if (type === "audio") prefix = "data:audio/mpeg;base64,";
        else if (type === "document") {
          const mime = message.message?.documentMessage?.mimetype || "application/pdf";
          prefix = `data:${mime};base64,`;
        }

        const fullBase64 = base64Data.startsWith("data:") ? base64Data : `${prefix}${base64Data}`;
        onMediaLoaded?.(fullBase64);
      } else {
        // 2. Try second structure with entire message if first failed
        const responseAlt = await api.post(`/chat/getBase64FromMediaMessage/${instance.name}`, {
          message: message,
          convertToMp4: false,
        });
        const base64DataAlt = responseAlt.data?.base64;
        if (base64DataAlt) {
          let prefix = "";
          if (type === "image") prefix = "data:image/jpeg;base64,";
          else if (type === "video") prefix = "data:video/mp4;base64,";
          else if (type === "audio") prefix = "data:audio/mpeg;base64,";
          else if (type === "document") {
            const mime = message.message?.documentMessage?.mimetype || "application/pdf";
            prefix = `data:${mime};base64,`;
          }
          const fullBase64 = base64DataAlt.startsWith("data:") ? base64DataAlt : `${prefix}${base64DataAlt}`;
          onMediaLoaded?.(fullBase64);
        } else {
          setError(true);
        }
      }
    } catch (err) {
      console.error("Error fetching media from Evolution API:", err);
      setError(true);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rounded bg-muted p-3 max-w-xs text-center flex flex-col items-center justify-center gap-2">
      <span className="text-xs text-muted-foreground">
        {type === "image" ? "Imagen no disponible" :
         type === "video" ? "Video no disponible" :
         type === "audio" ? "Audio no disponible" :
         type === "sticker" ? "Sticker no disponible" :
         type === "document" ? "Archivo no disponible" :
         "Multimedia no disponible"}
      </span>
      {message?.key?.id && instance?.name && (
        <button
          onClick={handleFetchMedia}
          disabled={loading}
          className="text-[10px] bg-primary text-primary-foreground hover:bg-primary/90 px-2.5 py-1 rounded transition-colors flex items-center gap-1 active:scale-95 disabled:opacity-50 font-medium">
          {loading ? (
            <>
              <svg className="animate-spin h-3 w-3 text-current" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              <span>Descargando...</span>
            </>
          ) : error ? (
            <span>Reintentar descarga</span>
          ) : (
            <span>Recuperar archivo</span>
          )}
        </button>
      )}
    </div>
  );
};

// Component to render different message types based on messageType
const MessageContent = ({ message }: { message: Message }) => {
  const messageType = message?.messageType as string;
  const msgData = message?.message;
  const [loadedMediaSrc, setLoadedMediaSrc] = useState<string | null>(null);

  if (!msgData) {
    return (
      <div className="rounded bg-muted p-3 max-w-xs text-center">
        <span className="text-xs text-muted-foreground">Mensaje vacío</span>
      </div>
    );
  }

  switch (messageType) {
    case "conversation":
      if (msgData.contactMessage) {
        const contactMsg = msgData.contactMessage;
        return (
          <div className="p-3 bg-muted rounded-lg max-w-xs">
            <div className="flex items-center gap-2 mb-2">
              <div className="text-xl">👤</div>
              <span className="font-medium">Contacto</span>
            </div>
            {contactMsg.displayName && <p className="text-sm font-medium">{contactMsg.displayName}</p>}
            {contactMsg.vcard && <p className="text-xs text-muted-foreground">Tarjeta de contacto</p>}
          </div>
        );
      }

      if (msgData.locationMessage) {
        const locationMsg = msgData.locationMessage;
        return (
          <div className="p-3 bg-muted rounded-lg max-w-xs">
            <div className="flex items-center gap-2 mb-2">
              <div className="text-xl">📍</div>
              <span className="font-medium">Ubicación</span>
            </div>
            {locationMsg.name && <p className="text-sm font-medium">{locationMsg.name}</p>}
            {locationMsg.address && <p className="text-xs text-muted-foreground">{locationMsg.address}</p>}
            {locationMsg.degreesLatitude && locationMsg.degreesLongitude && (
              <a
                href={`https://maps.google.com/?q=${locationMsg.degreesLatitude},${locationMsg.degreesLongitude}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline text-sm mt-1 inline-block">
                Ver en Google Maps
              </a>
            )}
          </div>
        );
      }

      return <span>{getMessageText(msgData)}</span>;

    case "extendedTextMessage":
      return <span>{msgData.conversation ?? msgData.extendedTextMessage?.text ?? ""}</span>;

    case "imageMessage":
      // Use base64 data or mediaUrl for images
      const imageBase64 = msgData.base64 ? (msgData.base64.startsWith("data:") ? msgData.base64 : `data:image/jpeg;base64,${msgData.base64}`) : null;
      const imageSrc = loadedMediaSrc || imageBase64 || msgData.mediaUrl;

      return (
        <div className="flex flex-col gap-2">
          {imageSrc ? (
            <img
              src={imageSrc}
              alt="Image"
              className="rounded-lg max-w-full h-auto"
              style={{
                maxWidth: "400px",
                maxHeight: "400px",
                objectFit: "contain",
              }}
              loading="lazy"
            />
          ) : (
            <MediaPlaceholder type="image" message={message} onMediaLoaded={setLoadedMediaSrc} />
          )}
          {msgData.imageMessage?.caption && <p className="text-sm">{msgData.imageMessage.caption}</p>}
        </div>
      );

    case "videoMessage":
      // Use base64 data or mediaUrl for videos
      const videoBase64 = msgData.base64 ? (msgData.base64.startsWith("data:") ? msgData.base64 : `data:video/mp4;base64,${msgData.base64}`) : null;
      const videoSrc = loadedMediaSrc || videoBase64 || msgData.mediaUrl;

      return (
        <div className="flex flex-col gap-2">
          {videoSrc ? (
            <video
              src={videoSrc}
              controls
              className="rounded-lg max-w-full h-auto"
              style={{
                maxWidth: "400px",
                maxHeight: "400px",
              }}
            />
          ) : (
            <MediaPlaceholder type="video" message={message} onMediaLoaded={setLoadedMediaSrc} />
          )}
          {msgData.videoMessage?.caption && <p className="text-sm">{msgData.videoMessage.caption}</p>}
        </div>
      );

    case "audioMessage":
      // Use base64 data or mediaUrl for audio
      const audioBase64 = msgData.base64 ? (msgData.base64.startsWith("data:") ? msgData.base64 : `data:audio/mpeg;base64,${msgData.base64}`) : null;
      const audioSrc = loadedMediaSrc || audioBase64 || msgData.mediaUrl;

      return audioSrc ? (
        <audio controls className="w-full max-w-xs">
          <source src={audioSrc} type="audio/mpeg" />
          Su navegador no soporta el elemento de audio.
        </audio>
      ) : (
        <MediaPlaceholder type="audio" message={message} onMediaLoaded={setLoadedMediaSrc} />
      );

    case "documentMessage":
      const docBase64 = msgData.base64 ? (msgData.base64.startsWith("data:") ? msgData.base64 : `data:${msgData.documentMessage?.mimetype || "application/pdf"};base64,${msgData.base64}`) : null;
      const docSrc = loadedMediaSrc || docBase64 || msgData.mediaUrl;

      return (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2 p-3 bg-muted rounded-lg max-w-xs">
            <div className="text-2xl">📄</div>
            <div className="flex-1 min-w-0">
              <p className="font-medium truncate">{msgData.documentMessage?.fileName || "Documento"}</p>
              <p className="text-xs text-muted-foreground">{formatFileLength(msgData.documentMessage?.fileLength)}</p>
            </div>
          </div>
          {docSrc ? (
            <a
              href={docSrc}
              download={msgData.documentMessage?.fileName || "documento"}
              className="text-[10px] bg-primary text-primary-foreground hover:bg-primary/90 px-2.5 py-1 rounded transition-colors text-center inline-block active:scale-95 font-medium max-w-[120px] self-start">
              Descargar archivo
            </a>
          ) : (
            <MediaPlaceholder type="document" message={message} onMediaLoaded={setLoadedMediaSrc} />
          )}
        </div>
      );

    case "stickerMessage":
      const stickerSrc = loadedMediaSrc || msgData.mediaUrl;
      return stickerSrc ? (
        <img src={stickerSrc} alt="Sticker" className="max-w-32 max-h-32 object-contain" />
      ) : (
        <MediaPlaceholder type="sticker" message={message} onMediaLoaded={setLoadedMediaSrc} />
      );

    default:
      // Fallback for unknown message types
      return (
        <div className="text-xs text-muted-foreground bg-muted p-2 rounded max-w-xs">
          <details>
            <summary>Tipo de mensaje no reconocido: {messageType}</summary>
            <pre className="mt-2 whitespace-pre-wrap break-all text-xs">{JSON.stringify(msgData, null, 2)}</pre>
          </details>
        </div>
      );
  }
};

function Messages({ textareaRef, handleTextareaChange, textareaHeight, lastMessageRef, scrollToBottom }: MessagesProps) {
  const { instance } = useInstance();
  const [messageText, setMessageText] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [selectedMedia, setSelectedMedia] = useState<File | null>(null);
  const [realtimeMessages, setRealtimeMessages] = useState<Message[]>([]);
  const { sendText: sendTextMutation } = useSendMessage();
  const { sendMedia: sendMediaMutation } = useSendMedia();

  const { remoteJid } = useParams<{ remoteJid: string }>();

  const scrollContainerRef = useRef<HTMLDivElement | null>(null);

  // Helper to scroll to bottom
  const localScrollToBottom = useCallback((force = false) => {
    if (scrollContainerRef.current) {
      const container = scrollContainerRef.current;
      const isAtBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 150;
      if (force || isAtBottom) {
        setTimeout(() => {
          container.scrollTop = container.scrollHeight;
        }, 50);
      }
    } else if (lastMessageRef.current) {
      lastMessageRef.current.scrollIntoView({});
    }
  }, [lastMessageRef]);

  // Handle sending text messages
  const sendTextMessage = async () => {
    if (!messageText.trim() || !remoteJid || !instance?.name || !instance?.token || isSending) return;

    try {
      setIsSending(true);
      await sendTextMutation({
        instanceName: instance.name,
        token: instance.token,
        data: {
          number: remoteJid,
          text: messageText.trim(),
        },
      });

      // Clear the input after sending
      setMessageText("");
      if (textareaRef.current) {
        textareaRef.current.value = "";
        handleTextareaChange(); // Reset height
      }
      localScrollToBottom(true);
    } catch (error) {
      console.error("Error sending message:", error);
    } finally {
      setIsSending(false);
    }
  };

  // Handle sending media messages
  const sendMediaMessage = async () => {
    if (!selectedMedia || !remoteJid || !instance?.name || !instance?.token || isSending) return;

    try {
      setIsSending(true);

      // Convert media to base64
      const base64Data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(selectedMedia);
        reader.onload = () => {
          const base64 = reader.result as string;
          // Strip the data URI prefix (data:image/xyz;base64,)
          const base64Data = base64.split(",")[1];
          resolve(base64Data);
        };
        reader.onerror = reject;
      });

      await sendMediaMutation({
        instanceName: instance.name,
        token: instance.token,
        data: {
          number: remoteJid,
          mediaMessage: {
            mediatype: selectedMedia.type.split("/")[0] === "application" ? "document" : (selectedMedia.type.split("/")[0] as "audio" | "video" | "image" | "document"),
            mimetype: selectedMedia.type,
            caption: messageText.trim(),
            media: base64Data,
            fileName: selectedMedia.name,
          },
        },
      });

      // Clear the input and media after sending
      setSelectedMedia(null);
      setMessageText("");
      if (textareaRef.current) {
        textareaRef.current.value = "";
        handleTextareaChange(); // Reset height
      }
      localScrollToBottom(true);
    } catch (error) {
      console.error("Error sending media:", error);
    } finally {
      setIsSending(false);
    }
  };

  // Handle message sending (decides between text or media)
  const sendMessage = async () => {
    if (selectedMedia) {
      await sendMediaMessage();
    } else {
      await sendTextMessage();
    }
  };

  // Handle Enter key press
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  // Handle input change
  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setMessageText(e.target.value);
    handleTextareaChange();
  };
  const { data: chat } = useFindChat({
    remoteJid,
    instanceName: instance?.name,
  });

  const { data: messages, isSuccess } = useAggregatedMessages({
    remoteJid,
    instanceName: instance?.name,
    refetchInterval: 5000,
    staleTime: 0,
    refetchIntervalInBackground: true,
  });

  // Scheduled messages state and hooks
  const [isScheduleModalOpen, setIsScheduleModalOpen] = useState(false);
  const [scheduleMode, setScheduleMode] = useState<'delay' | 'date'>('delay');
  const [scheduleDelay, setScheduleDelay] = useState(30);
  const [scheduleDate, setScheduleDate] = useState(() => {
    const d = new Date(Date.now() + 30 * 60 * 1000);
    const offset = d.getTimezoneOffset() * 60000;
    const local = new Date(d.getTime() - offset);
    return local.toISOString().slice(0, 16);
  });
  const [scheduleText, setScheduleText] = useState("");
  const [isScheduling, setIsScheduling] = useState(false);

  const { data: scheduledMessages } = useFindScheduledMessages({
    remoteJid: remoteJid || "",
    canonicalRemoteJid: chat?.canonicalRemoteJid || null,
  });

  const createScheduled = useCreateScheduledMessage();
  const cancelScheduled = useCancelScheduledMessage();
  const sendScheduledNow = useSendScheduledMessageNow();

  const handleOpenScheduleModal = () => {
    setScheduleText(messageText);
    setIsScheduleModalOpen(true);
  };

  const handleCreateSchedule = async () => {
    if (!scheduleText.trim() || !remoteJid || !instance?.name || !instance?.token) {
      toast.error("Por favor, rellene todos los campos requeridos.");
      return;
    }

    try {
      setIsScheduling(true);
      const apiUrl = getToken(TOKEN_ID.API_URL) || "https://evolution.yogabond.es";
      const params: any = {
        instanceName: instance.name,
        instanceToken: instance.token,
        instanceUrl: apiUrl,
        remoteJid,
        canonicalRemoteJid: chat?.canonicalRemoteJid || null,
        messageText: scheduleText.trim(),
      };

      if (scheduleMode === 'delay') {
        params.delayMinutes = scheduleDelay;
      } else {
        params.scheduledAtLocal = scheduleDate;
      }

      await createScheduled(params);
      toast.success("Mensaje programado con éxito.");
      setMessageText("");
      setScheduleText("");
      setIsScheduleModalOpen(false);
    } catch (error: any) {
      const err = error.response?.data?.error || "Error al programar el mensaje";
      toast.error(err);
    } finally {
      setIsScheduling(false);
    }
  };

  const handleCancelSchedule = async (id: string) => {
    try {
      await cancelScheduled(id);
      toast.success("Mensaje programado cancelado.");
    } catch (error: any) {
      toast.error("Error al cancelar la programación.");
    }
  };

  const handleSendScheduleNow = async (id: string) => {
    try {
      await sendScheduledNow(id);
      toast.success("Procesando envío de mensaje inmediato.");
    } catch (error: any) {
      toast.error("Error al forzar el envío.");
    }
  };

  // Combine React Query messages with real-time updates
  const allMessages = useMemo(() => {
    if (!messages) return realtimeMessages;

    // Merge messages from React Query with real-time updates
    const messageMap = new Map();

    // First add all messages from React Query
    messages.forEach((message) => messageMap.set(message.key.id, message));

    // Then add/update with real-time messages
    realtimeMessages.forEach((message) => {
      messageMap.set(message.key.id, message);
    });

    return Array.from(messageMap.values());
  }, [messages, realtimeMessages]);

  // Add websocket functionality for real-time message updates
  useEffect(() => {
    if (!instance?.name || !remoteJid) return;

    const serverUrl = getToken(TOKEN_ID.API_URL);
    if (!serverUrl) {
      console.error("API URL not found in localStorage");
      return;
    }

    const socket = connectSocket(serverUrl);

    // Function to update messages from websocket events
    const updateMessagesFromWebsocket = (_eventType: string, data: any) => {
      if (!instance) return;

      if (data.instance !== instance.name) {
        return;
      }

      if (data?.data?.key?.remoteJid !== remoteJid) {
        return;
      }

      const message = data.data;

      setRealtimeMessages((prevMessages) => {
        // Check if message already exists
        const existingIndex = prevMessages.findIndex((msg) => msg.key.id === message.key.id);

        if (existingIndex !== -1) {
          // Update existing message
          const updatedMessages = [...prevMessages];
          updatedMessages[existingIndex] = message;
          return updatedMessages;
        } else {
          // Add new message
          return [...prevMessages, message];
        }
      });
    };

    // Function to update message status (simplified - just log for now)
    const updateMessageStatus = (data: any) => {
      if (!instance) return;
      if (data.instance !== instance.name) return;

      console.log("Received message status update:", data);
      // TODO: Implement proper message status updates when Message type supports it
    };

    // Set up event listeners
    socket.on("messages.upsert", (data: any) => {
      updateMessagesFromWebsocket("messages.upsert", data);
    });

    socket.on("send.message", (data: any) => {
      updateMessagesFromWebsocket("send.message", data);
    });

    socket.on("messages.update", (data: any) => {
      updateMessageStatus(data);
    });

    // socket.connect();

    // Cleanup function
    return () => {
      socket.off("messages.upsert");
      socket.off("send.message");
      socket.off("messages.update");
      disconnectSocket(socket);
    };
  }, [instance?.name, remoteJid]);

  // Group messages by date
  const groupedMessages = useMemo(() => {
    if (!allMessages) return [];

    // Sort messages by timestamp first
    const sortedMessages = [...allMessages].sort((a, b) => {
      const aTime = getMessageTimestamp(a).getTime();
      const bTime = getMessageTimestamp(b).getTime();
      return aTime - bTime;
    });

    const grouped: { date: string; messages: Message[] }[] = [];
    let currentDate = "";
    let currentGroup: Message[] = [];

    sortedMessages.forEach((message) => {
      const messageDate = getMessageTimestamp(message);
      const dateString = messageDate.toDateString();

      if (dateString !== currentDate) {
        if (currentGroup.length > 0) {
          grouped.push({
            date: formatDateSeparator(new Date(currentDate)),
            messages: currentGroup,
          });
        }
        currentDate = dateString;
        currentGroup = [message];
      } else {
        currentGroup.push(message);
      }
    });

    if (currentGroup.length > 0) {
      grouped.push({
        date: formatDateSeparator(new Date(currentDate)),
        messages: currentGroup,
      });
    }

    return grouped;
  }, [allMessages]);

  const hasScrolledRef = useRef(false);

  useEffect(() => {
    if (isSuccess && allMessages && allMessages.length > 0) {
      if (!hasScrolledRef.current) {
        localScrollToBottom(true);
        hasScrolledRef.current = true;
      } else {
        localScrollToBottom(false);
      }
    }
  }, [isSuccess, allMessages, localScrollToBottom]);

  // Clear selected media and real-time messages when switching chats
  useEffect(() => {
    setSelectedMedia(null);
    setMessageText("");
    setRealtimeMessages([]); // Clear real-time messages when switching chats
    hasScrolledRef.current = false;
    if (textareaRef.current) {
      textareaRef.current.value = "";
      handleTextareaChange();
    }
    localScrollToBottom(true);
  }, [remoteJid, localScrollToBottom]);

  const renderBubbleRight = (message: Message) => {
    return (
      <div key={message.key.id} className="bubble-right flex justify-end w-full mb-1">
        <div className="relative rounded-lg px-3 py-1.5 pb-5 bg-[#005c4b] max-w-[70%] md:max-w-[55%] shadow-sm flex flex-col gap-1 min-w-[80px]">
          <div className="text-[14px] text-slate-100 leading-relaxed pr-6">
            <MessageContent message={message} />
          </div>
          <div className="absolute bottom-1 right-2 flex items-center gap-1 select-none pointer-events-none">
            <span className="text-[9px] text-slate-300 font-normal">
              {getMessageTimestamp(message).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}
            </span>
            <span className="text-[11px] text-[#53bdeb] font-bold">✓✓</span>
          </div>
        </div>
      </div>
    );
  };

  const renderBubbleLeft = (message: Message) => {
    return (
      <div key={message.key.id} className="bubble-left flex justify-start w-full mb-1">
        <div className="relative rounded-lg px-3 py-1.5 pb-5 bg-[#202c33] max-w-[70%] md:max-w-[55%] shadow-sm flex flex-col gap-1 min-w-[80px]">
          <div className="text-[14px] text-slate-100 leading-relaxed pr-6">
            <MessageContent message={message} />
          </div>
          <div className="absolute bottom-1 right-2 flex items-center gap-1 select-none pointer-events-none">
            <span className="text-[9px] text-slate-400 font-normal">
              {getMessageTimestamp(message).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}
            </span>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="flex h-full flex-col">
      <div className="sticky top-0 bg-[#202c33] border-b border-slate-800 p-3 flex-shrink-0 z-10 select-none">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <Avatar className="h-10 w-10 border border-slate-700 shrink-0">
              <AvatarImage src={chat?.profilePicUrl} alt={chat?.pushName || chat?.remoteJid?.split("@")[0]} />
              <AvatarFallback className="bg-slate-700 text-slate-300 border border-slate-600">
                <User className="h-5 w-5" />
              </AvatarFallback>
            </Avatar>
            {(() => {
              const info = getStructuredContactDisplay(chat || { remoteJid });
              return (
                <div className="flex-1 min-w-0 flex flex-col">
                  <div className="font-semibold text-sm text-slate-200 truncate">{info.title}</div>
                  {info.subtitle ? (
                    <div className="text-[11px] text-amber-500/90 font-medium truncate mt-0.5">
                      {info.subtitle} <span className="text-slate-400 font-normal ml-1">({info.phone})</span>
                    </div>
                  ) : (
                    <div className="text-[11px] text-slate-400 truncate mt-0.5">{info.phone}</div>
                  )}
                </div>
              );
            })()}
          </div>
          {/* Action icons on the right */}
          <div className="flex items-center gap-1 text-slate-400 shrink-0">
            <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full text-slate-300 hover:bg-slate-800">
              <Search className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full text-slate-300 hover:bg-slate-800">
              <MoreVertical className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
      <div ref={scrollContainerRef} className="message-container mx-auto flex max-w-4xl flex-1 flex-col gap-2 overflow-y-auto px-2">
        {groupedMessages.map((group, groupIndex) => (
          <div key={groupIndex}>
            <DateSeparator date={group.date} />
            <div className="flex flex-col gap-2">
              {group.messages.map((message) => {
                if (message.key.fromMe) {
                  return renderBubbleRight(message);
                } else {
                  return renderBubbleLeft(message);
                }
              })}
            </div>
          </div>
        ))}
        <div ref={lastMessageRef as never} />
      </div>
      <div className="sticky bottom-0 mx-auto flex w-full max-w-2xl flex-col gap-1.5 bg-background px-2 py-2">
        {selectedMedia && <SelectedMedia selectedMedia={selectedMedia} setSelectedMedia={setSelectedMedia} />}
        
        {/* Scheduled Messages Panel */}
        {scheduledMessages && scheduledMessages.length > 0 && (
          <div className="rounded-xl border border-border bg-card/60 backdrop-blur-sm p-3 max-h-[160px] overflow-y-auto flex flex-col gap-1.5 text-xs">
            <div className="font-semibold text-muted-foreground flex items-center gap-1.5 mb-1 text-[11px] uppercase tracking-wider">
              <ClockIcon className="h-3.5 w-3.5 text-amber-500" />
              Mensajes Programados ({scheduledMessages.filter(m => m.status === 'pending').length} pendientes)
            </div>
            <div className="flex flex-col gap-1">
              {scheduledMessages.map((msg) => (
                <div key={msg.id} className="flex items-center justify-between gap-3 p-2 rounded-lg bg-background/50 hover:bg-background border border-border/40">
                  <div className="flex-1 min-w-0">
                    <div className="truncate font-medium text-foreground">{msg.messageText}</div>
                    <div className="text-[10px] text-muted-foreground flex items-center gap-1 mt-0.5">
                      <CalendarIcon className="h-3 w-3 shrink-0" />
                      <span>{new Date(msg.scheduledAtUtc).toLocaleString('es-ES', { timeZone: 'Europe/Madrid' })} (Madrid)</span>
                      {msg.attempts > 0 && (
                        <span className="text-amber-500">({msg.attempts} intentos)</span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <Badge variant={
                      msg.status === 'pending' ? 'secondary' :
                      msg.status === 'sent' ? 'default' :
                      msg.status === 'failed' ? 'destructive' : 'outline'
                    } className="text-[10px] py-0.5 px-1.5">
                      {msg.status === 'pending' ? 'pendiente' :
                       msg.status === 'sent' ? 'enviado' :
                       msg.status === 'failed' ? 'fallado' : 'cancelado'}
                    </Badge>
                    {msg.status === 'pending' && (
                      <>
                        <Button variant="ghost" size="icon" onClick={() => handleSendScheduleNow(msg.id)} className="h-6 w-6 text-emerald-500 hover:text-emerald-600 hover:bg-emerald-500/10 rounded-full" title="Enviar ahora">
                          <SendIcon className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => handleCancelSchedule(msg.id)} className="h-6 w-6 text-destructive hover:text-destructive hover:bg-destructive/10 rounded-full" title="Cancelar">
                          <TrashIcon className="h-3.5 w-3.5" />
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="flex items-center rounded-3xl border border-border bg-background px-2 py-1">
          {instance && <MediaOptions instance={instance} setSelectedMedia={setSelectedMedia} />}
          <Textarea
            placeholder="Enviar mensaje..."
            name="message"
            id="message"
            rows={1}
            ref={textareaRef}
            value={messageText}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            disabled={isSending}
            style={{ height: textareaHeight }}
            className="min-h-0 w-full resize-none border-none p-3 focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-transparent focus-visible:ring-offset-0 focus-visible:ring-offset-transparent"
          />
          <Button type="button" size="icon" variant="ghost" onClick={handleOpenScheduleModal} disabled={isSending} className="rounded-full p-2 text-muted-foreground hover:text-foreground mr-1">
            <ClockIcon className="h-5 w-5" />
            <span className="sr-only">Programar</span>
          </Button>
          <Button type="button" size="icon" onClick={sendMessage} disabled={(!messageText.trim() && !selectedMedia) || isSending} className="rounded-full p-2 disabled:opacity-50">
            <ArrowRightIcon className="h-6 w-6" />
            <span className="sr-only">Enviar</span>
          </Button>
        </div>
      </div>

      {/* Programar Mensaje Dialog */}
      <Dialog open={isScheduleModalOpen} onOpenChange={setIsScheduleModalOpen}>
        <DialogContent className="max-w-md bg-background border border-border shadow-2xl rounded-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-lg font-semibold text-foreground">
              <ClockIcon className="h-5 w-5 text-amber-500" />
              Programar Envío de Mensaje
            </DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-3 text-sm">
            <div className="flex flex-col gap-1.5">
              <label className="font-semibold text-muted-foreground text-xs uppercase tracking-wider">Mensaje a Enviar</label>
              <Textarea
                value={scheduleText}
                onChange={(e) => setScheduleText(e.target.value)}
                placeholder="Escribe el mensaje programado..."
                className="min-h-[100px] bg-background border border-border p-3 rounded-lg focus-visible:ring-1 focus-visible:ring-amber-500 focus-visible:ring-offset-0"
              />
            </div>

            <div className="flex flex-col gap-2">
              <label className="font-semibold text-muted-foreground text-xs uppercase tracking-wider">Método de Programación</label>
              <div className="grid grid-cols-2 gap-2">
                <Button
                  type="button"
                  variant={scheduleMode === 'delay' ? 'default' : 'outline'}
                  onClick={() => setScheduleMode('delay')}
                  className="w-full justify-center"
                >
                  Retraso Relativo
                </Button>
                <Button
                  type="button"
                  variant={scheduleMode === 'date' ? 'default' : 'outline'}
                  onClick={() => setScheduleMode('date')}
                  className="w-full justify-center"
                >
                  Fecha y Hora Exacta
                </Button>
              </div>
            </div>

            {scheduleMode === 'delay' ? (
              <div className="flex flex-col gap-1.5">
                <label className="font-semibold text-muted-foreground text-xs uppercase tracking-wider">Enviar dentro de (minutos)</label>
                <input
                  type="number"
                  min={1}
                  value={scheduleDelay}
                  onChange={(e) => setScheduleDelay(Math.max(1, parseInt(e.target.value, 10) || 1))}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-amber-500 disabled:cursor-not-allowed disabled:opacity-50"
                />
              </div>
            ) : (
              <div className="flex flex-col gap-1.5">
                <label className="font-semibold text-muted-foreground text-xs uppercase tracking-wider">Fecha y Hora de Envío (Hora de Madrid)</label>
                <input
                  type="datetime-local"
                  value={scheduleDate}
                  onChange={(e) => setScheduleDate(e.target.value)}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-amber-500 disabled:cursor-not-allowed disabled:opacity-50"
                />
              </div>
            )}
          </div>
          <DialogFooter className="flex gap-2 sm:justify-end">
            <Button type="button" variant="outline" onClick={() => setIsScheduleModalOpen(false)}>
              Cancelar
            </Button>
            <Button
              type="button"
              disabled={isScheduling || !scheduleText.trim()}
              onClick={handleCreateSchedule}
              className="bg-amber-600 hover:bg-amber-700 text-white"
            >
              {isScheduling ? "Programando..." : "Confirmar Programación"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export { Messages };
