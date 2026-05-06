import { useQuery } from "@tanstack/react-query";
import axios from "axios";
import { useManageMutation } from "../mutateQuery";

export interface ScheduledMessage {
  id: string;
  instanceName: string;
  remoteJid: string;
  canonicalRemoteJid?: string | null;
  messageText: string;
  scheduledAtUtc: string;
  timezone: string;
  status: 'pending' | 'processing' | 'sent' | 'failed' | 'cancelled';
  attempts: number;
  maxAttempts: number;
  lastError?: string | null;
  sentAtUtc?: string | null;
  createdAt: string;
  updatedAt: string;
  evolutionMessageId?: string | null;
}

interface CreateScheduledMessageParams {
  instanceName: string;
  instanceToken: string;
  remoteJid: string;
  canonicalRemoteJid?: string | null;
  messageText: string;
  scheduledAtLocal?: string; // "YYYY-MM-DDTHH:MM:SS"
  delayMinutes?: number;
}

// -------------------------------------------------------------
// API CALLS
// -------------------------------------------------------------

const createScheduledMessage = async (params: CreateScheduledMessageParams): Promise<ScheduledMessage> => {
  const response = await axios.post("/api/scheduled-messages", params);
  return response.data;
};

const findScheduledMessages = async ({ remoteJid, canonicalRemoteJid }: { remoteJid: string; canonicalRemoteJid?: string | null }): Promise<ScheduledMessage[]> => {
  const response = await axios.get("/api/scheduled-messages", {
    params: { remoteJid, canonicalRemoteJid }
  });
  return response.data;
};

const cancelScheduledMessage = async (id: string): Promise<{ message: string }> => {
  const response = await axios.post(`/api/scheduled-messages/${id}/cancel`);
  return response.data;
};

const sendScheduledMessageNow = async (id: string): Promise<{ message: string }> => {
  const response = await axios.post(`/api/scheduled-messages/${id}/send-now`);
  return response.data;
};

// -------------------------------------------------------------
// REACT QUERY HOOKS
// -------------------------------------------------------------

export function useCreateScheduledMessage() {
  return useManageMutation(createScheduledMessage, {
    invalidateKeys: [["chats", "scheduledMessages"]],
  });
}

export function useFindScheduledMessages({ remoteJid, canonicalRemoteJid }: { remoteJid: string; canonicalRemoteJid?: string | null }) {
  return useQuery<ScheduledMessage[]>({
    queryKey: ["chats", "scheduledMessages", remoteJid, canonicalRemoteJid],
    queryFn: () => findScheduledMessages({ remoteJid, canonicalRemoteJid }),
    refetchInterval: 10000, // Refresh every 10 seconds to show updated statuses
    staleTime: 0,
  });
}

export function useCancelScheduledMessage() {
  return useManageMutation(cancelScheduledMessage, {
    invalidateKeys: [["chats", "scheduledMessages"]],
  });
}

export function useSendScheduledMessageNow() {
  return useManageMutation(sendScheduledMessageNow, {
    invalidateKeys: [["chats", "scheduledMessages"]],
  });
}
