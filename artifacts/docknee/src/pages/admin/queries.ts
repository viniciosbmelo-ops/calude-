import { keepPreviousData, useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { 
  AdminAnalyticsData, FeatureFlag, Announcement, Faq, 
  Campaign, AdminAlert, ContactMessage,
  AllSurgery, ServiceInst, Conversation, Message, Assignee
} from "./types";

type CreateServiceInput = Partial<ServiceInst> & { senha: string };

// Helper for native fetch
async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { ...options, credentials: "same-origin" });
  } catch (error) {
    // Preserve the original error for the caller.  A request that never got a
    // response is different from a provider rejection returned by the API.
    throw error;
  }
  if (!res.ok) {
    let err = "Network Error";
    try { err = (await res.json()).error || err; } catch {}
    throw new HttpError(err, res.status);
  }
  return res.json();
}

export class HttpError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "HttpError";
    this.status = status;
  }
}

export function useAdminAnalytics(period: string) {
  return useQuery<AdminAnalyticsData>({
    queryKey: ["admin-analytics", period],
    queryFn: () => fetchJson(`/api/admin/analytics?period=${period}`)
  });
}

export function useFeatureFlags() {
  return useQuery<FeatureFlag[]>({
    queryKey: ["admin-feature-flags"],
    queryFn: () => fetchJson("/api/admin/feature-flags")
  });
}

export function useMutateFeatureFlag() {
  const queryClient = useQueryClient();
  return {
    create: useMutation({
      mutationFn: (data: Partial<FeatureFlag>) => fetchJson("/api/admin/feature-flags", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data)
      }),
      onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin-feature-flags"] })
    }),
    update: useMutation({
      mutationFn: ({ id, data }: { id: number; data: Partial<FeatureFlag> }) => fetchJson(`/api/admin/feature-flags/${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data)
      }),
      onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin-feature-flags"] })
    }),
    delete: useMutation({
      mutationFn: (id: number) => fetchJson(`/api/admin/feature-flags/${id}`, { method: "DELETE" }),
      onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin-feature-flags"] })
    })
  };
}

export function useAnnouncements() {
  return useQuery<Announcement[]>({
    queryKey: ["admin-announcements"],
    queryFn: () => fetchJson("/api/admin/announcements")
  });
}

export function useMutateAnnouncement() {
  const queryClient = useQueryClient();
  return {
    create: useMutation({
      mutationFn: (data: Partial<Announcement>) => fetchJson("/api/admin/announcements", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data)
      }),
      onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin-announcements"] })
    }),
    update: useMutation({
      mutationFn: ({ id, data }: { id: number; data: Partial<Announcement> }) => fetchJson(`/api/admin/announcements/${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data)
      }),
      onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin-announcements"] })
    }),
    delete: useMutation({
      mutationFn: (id: number) => fetchJson(`/api/admin/announcements/${id}`, { method: "DELETE" }),
      onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin-announcements"] })
    })
  };
}

export function useFaqs() {
  return useQuery<Faq[]>({
    queryKey: ["admin-faqs"],
    queryFn: () => fetchJson("/api/admin/faqs")
  });
}

export function useMutateFaq() {
  const queryClient = useQueryClient();
  return {
    create: useMutation({
      mutationFn: (data: Partial<Faq>) => fetchJson("/api/admin/faqs", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data)
      }),
      onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin-faqs"] })
    }),
    update: useMutation({
      mutationFn: ({ id, data }: { id: number; data: Partial<Faq> }) => fetchJson(`/api/admin/faqs/${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data)
      }),
      onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin-faqs"] })
    }),
    delete: useMutation({
      mutationFn: (id: number) => fetchJson(`/api/admin/faqs/${id}`, { method: "DELETE" }),
      onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin-faqs"] })
    })
  };
}

export function useCampaigns() {
  return useQuery<Campaign[]>({
    queryKey: ["admin-campaigns"],
    queryFn: () => fetchJson("/api/admin/campaigns")
  });
}

export function useMutateCampaign() {
  const queryClient = useQueryClient();
  return {
    create: useMutation({
      mutationFn: (data: Partial<Campaign>) => fetchJson("/api/admin/campaigns", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data)
      }),
      onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin-campaigns"] })
    }),
    update: useMutation({
      mutationFn: ({ id, data }: { id: number; data: Partial<Campaign> }) => fetchJson(`/api/admin/campaigns/${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data)
      }),
      onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin-campaigns"] })
    }),
    delete: useMutation({
      mutationFn: (id: number) => fetchJson(`/api/admin/campaigns/${id}`, { method: "DELETE" }),
      onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin-campaigns"] })
    })
  };
}

export function useAdminAlerts(showRead = false) {
  return useQuery<AdminAlert[]>({
    queryKey: ["admin-alerts", showRead],
    queryFn: () => fetchJson(`/api/admin/alerts?showRead=${showRead}`)
  });
}

export function useMarkAlertRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => fetchJson(`/api/admin/alerts/${id}/read`, { method: "PATCH" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin-alerts"] })
  });
}

export function useAdminMessages() {
  return useQuery<ContactMessage[]>({
    queryKey: ["admin-messages"],
    queryFn: () => fetchJson("/api/admin/contact-messages")
  });
}

export function useUpdateTicket() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<ContactMessage> }) => fetchJson(`/api/admin/contact-messages/${id}/ticket`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data)
    }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin-messages"] })
  });
}

export function useReplyMessage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, resposta }: { id: number; resposta: string }) => fetchJson(`/api/admin/contact-messages/${id}/reply`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ resposta })
    }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin-messages"] })
  });
}

export function useAllSurgeries() {
  return useQuery<AllSurgery[]>({
    queryKey: ["admin-surgeries"],
    queryFn: () => fetchJson("/api/admin/all-surgeries")
  });
}

export function useServices() {
  return useQuery<ServiceInst[]>({
    queryKey: ["admin-services"],
    queryFn: () => fetchJson("/api/admin/services")
  });
}

export function useMutateService() {
  const queryClient = useQueryClient();
  return {
    create: useMutation({
      mutationFn: (data: CreateServiceInput) => fetchJson<{ service: ServiceInst }>("/api/admin/services", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data)
      }),
      onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin-services"] })
    }),
    update: useMutation({
      mutationFn: ({ id, data }: { id: number; data: Partial<ServiceInst> }) => fetchJson(`/api/admin/services/${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data)
      }),
      onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin-services"] })
    }),
    delete: useMutation({
      mutationFn: (id: number) => fetchJson(`/api/admin/services/${id}`, { method: "DELETE" }),
      onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin-services"] })
    })
  };
}

export function useAuditLogs(days: number, doctorId?: string, method?: string) {
  return useQuery<{ logs: any[]; total: number }>({
    queryKey: ["admin-audit-logs", days, doctorId, method],
    queryFn: () => {
      const q = new URLSearchParams({ days: days.toString() });
      if (doctorId) q.set("doctorId", doctorId);
      if (method) q.set("method", method);
      return fetchJson<{ logs: any[]; total: number }>(`/api/admin/audit-logs?${q.toString()}`);
    }
  });
}

// TOTP Setup
export function useTotpSetup() {
  return useMutation({
    mutationFn: (currentPassword: string) => fetchJson<{ uri: string; secret: string }>("/api/auth/totp/setup", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ currentPassword })
    })
  });
}

export function useTotpConfirm() {
  return useMutation({
    mutationFn: (code: string) => fetchJson<{ success: boolean; recoveryCodes: string[]; message: string }>("/api/auth/totp/confirm", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code })
    })
  });
}

export function useTotpDisable() {
  return useMutation({
    mutationFn: (currentPassword: string) => fetchJson<{ success: boolean }>("/api/auth/totp/disable", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ currentPassword })
    })
  });
}

export function useDoctorAction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ path, method = "PATCH", body }: { path: string, method?: string, body?: unknown }) => fetchJson(path, {
      method,
      ...(body !== undefined
        ? {
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          }
        : {}),
    }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/reports/admin"] })
  });
}

export const WHATSAPP_LIST_POLL_INTERVAL_MS = 15_000;
export const WHATSAPP_DETAIL_POLL_INTERVAL_MS = 10_000;

/**
 * React Query also uses refetchIntervalInBackground below.  Keeping this
 * visibility check here makes the bounded polling policy explicit and keeps
 * it deterministic in tests/SSR.
 */
export function getWhatsappPollingInterval(intervalMs: number): number | false {
  if (typeof document !== "undefined" && document.visibilityState !== "visible") {
    return false;
  }
  return intervalMs;
}

export interface WhatsappConversationCounts {
  all: number;
  new: number;
  in_progress: number;
  waiting: number;
  closed: number;
  unread: number;
}

export interface WhatsappConversationsResponse {
  conversations: Conversation[];
  /**
   * Counts are calculated by the API using the same filters as the list.
   * Never derive a total from the rendered page: the endpoint may paginate or
   * apply a backend search limit.
   */
  counts: WhatsappConversationCounts;
}

export interface WhatsappConversationDetailResponse {
  conversation: Conversation;
  messages: Message[];
  readThroughMessageId: number | null;
}

/**
 * Merge only the selected conversation's message preview into already
 * mounted list caches. Existing rows are updated in place; filtered caches
 * never gain a row that did not match their own backend filters, and cache
 * counts remain owned by the next list response.
 */
export function mergeWhatsappConversationPreview(
  current: WhatsappConversationsResponse | undefined,
  detail: Conversation,
): WhatsappConversationsResponse | undefined {
  if (!current) return current;
  const index = current.conversations.findIndex((conversation) => conversation.id === detail.id);
  if (index < 0) return current;

  const existing = current.conversations[index];
  const existingTime = Date.parse(existing.lastMessageAt);
  const detailTime = Date.parse(detail.lastMessageAt);
  if (
    Number.isFinite(existingTime)
    && Number.isFinite(detailTime)
    && detailTime < existingTime
  ) {
    return current;
  }
  if (
    existing.lastMessagePreview === detail.lastMessagePreview
    && existing.lastMessageAt === detail.lastMessageAt
  ) {
    return current;
  }

  const conversations = current.conversations.slice();
  conversations[index] = {
    ...existing,
    lastMessagePreview: detail.lastMessagePreview,
    lastMessageAt: detail.lastMessageAt,
  };
  return { ...current, conversations };
}

// GET /api/admin/whatsapp/conversations?search=&status=&unreadOnly=true|false
export function useWhatsappConversations(search: string, status: string, unreadOnly: boolean) {
  return useQuery<WhatsappConversationsResponse>({
    queryKey: ["admin-whatsapp-conversations", search, status, unreadOnly],
    queryFn: () => {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      if (status) params.set("status", status);
      if (unreadOnly) params.set("unreadOnly", "true");
      return fetchJson<WhatsappConversationsResponse>(`/api/admin/whatsapp/conversations?${params.toString()}`);
    },
    placeholderData: keepPreviousData,
    staleTime: 2_000,
    refetchInterval: () => getWhatsappPollingInterval(WHATSAPP_LIST_POLL_INTERVAL_MS),
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    retry: 1,
  });
}

// GET /api/admin/whatsapp/conversations/:id
export function useWhatsappConversation(id: number | null) {
  return useQuery<WhatsappConversationDetailResponse>({
    queryKey: ["admin-whatsapp-conversation", id],
    queryFn: () => fetchJson<WhatsappConversationDetailResponse>(`/api/admin/whatsapp/conversations/${id}`),
    enabled: id !== null,
    staleTime: 2_000,
    refetchInterval: () => getWhatsappPollingInterval(WHATSAPP_DETAIL_POLL_INTERVAL_MS),
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    retry: 1,
  });
}

// PATCH /api/admin/whatsapp/conversations/:id
export function useUpdateWhatsappConversation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: { status?: string, tags?: string[], assignedTo?: number | null, patientId?: number | null } }) =>
      fetchJson<Conversation>(`/api/admin/whatsapp/conversations/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data)
      }),
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: ["admin-whatsapp-conversations"] });
      queryClient.invalidateQueries({ queryKey: ["admin-whatsapp-conversation", id] });
    }
  });
}

// POST /api/admin/whatsapp/conversations/:id/read
export function useReadWhatsappConversation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, readThroughMessageId }: { id: number; readThroughMessageId: number }) => fetchJson<Conversation>(`/api/admin/whatsapp/conversations/${id}/read`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ readThroughMessageId }),
    }),
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: ["admin-whatsapp-conversations"] });
      queryClient.invalidateQueries({ queryKey: ["admin-whatsapp-conversation", id] });
    }
  });
}

// POST /api/admin/whatsapp/conversations/:id/messages
export function useSendWhatsappMessage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, text, requestId }: { id: number; text: string; requestId: string }) => fetchJson<Message>(`/api/admin/whatsapp/conversations/${id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, requestId })
    }),
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: ["admin-whatsapp-conversations"] });
      queryClient.invalidateQueries({ queryKey: ["admin-whatsapp-conversation", id] });
    }
  });
}

// GET /api/admin/whatsapp/assignees
export function useWhatsappAssignees() {
  return useQuery({
    queryKey: ["admin-whatsapp-assignees"],
    queryFn: () => fetchJson<Assignee[]>("/api/admin/whatsapp/assignees")
  });
}
