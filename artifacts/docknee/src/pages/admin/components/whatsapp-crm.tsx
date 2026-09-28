import React, { useState, useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { 
  useWhatsappConversations, 
  useWhatsappConversation, 
  useUpdateWhatsappConversation,
  useReadWhatsappConversation,
  useSendWhatsappMessage,
  useWhatsappAssignees,
  HttpError,
  mergeWhatsappConversationPreview,
  type WhatsappConversationsResponse,
} from "../queries";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { 
  Search, 
  ArrowLeft, 
  Send, 
  UserCircle, 
  Tag as TagIcon, 
  CheckCheck, 
  Check, 
  CircleAlert,
  CircleX,
  LoaderCircle,
  Phone,
  User,
  Stethoscope,
  Info,
  CheckCircle2,
  MessageCircle
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  canApplyWhatsappSendCompletion,
  getWhatsappMessageStatusPresentation,
  getRecoverableWhatsappSends,
  shouldClearWhatsappDraft,
  type Assignee,
  type Conversation,
  type Message,
} from "../types";
import { SUPPORT_WHATSAPP_NUMBER, SUPPORT_WHATSAPP_URL } from "@/lib/support-contact";

const STATUS_LABELS = {
  new: "Novo",
  in_progress: "Em Andamento",
  waiting: "Aguardando",
  closed: "Fechado"
} as const;

const STATUS_COLORS = {
  new: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800",
  in_progress: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400 border-blue-200 dark:border-blue-800",
  waiting: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400 border-amber-200 dark:border-amber-800",
  closed: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800/50 dark:text-zinc-400 border-zinc-200 dark:border-zinc-700"
};

type DraftStore = Map<number, string>;

type PendingSendState = {
  text: string;
  requestId: string;
  status: "sending" | "uncertain" | "failed" | "sent" | "delivered" | "read";
};

type PendingSendStore = Map<number, PendingSendState[]>;

type ConversationUpdate = {
  status?: Conversation["status"];
  tags?: string[];
  assignedTo?: number | null;
  patientId?: number | null;
};

function createWhatsappRequestId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  // The API only needs a client-stable, sufficiently long opaque key.  This
  // fallback is for older browsers where randomUUID is not available.
  return `admin-whatsapp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function isConfirmedMessageStatus(status: string): status is "sent" | "delivered" | "read" {
  return status === "sent" || status === "delivered" || status === "read";
}

function getPendingSendStatus(status: string): PendingSendState["status"] | null {
  if (status === "pending" || status === "uncertain") return "uncertain";
  if (status === "failed") return "failed";
  if (status === "sending") return "sending";
  if (isConfirmedMessageStatus(status)) return status;
  return null;
}

function shouldApplyServerSendState(
  current: PendingSendState | null,
  serverStatus: PendingSendState["status"],
): boolean {
  if (!current) return true;
  if (
    current.status === "sending"
    && serverStatus === "failed"
  ) {
    return false;
  }
  if (
    current.status === "failed"
    && serverStatus === "sending"
  ) {
    return false;
  }
  if (
    isConfirmedMessageStatus(current.status)
    && !isConfirmedMessageStatus(serverStatus)
  ) {
    return false;
  }
  return true;
}

function getLatestSendState(store: PendingSendStore, conversationId: number): PendingSendState | null {
  const states = store.get(conversationId);
  return states && states.length > 0 ? states[states.length - 1] : null;
}

function getSendStateByText(
  store: PendingSendStore,
  conversationId: number,
  text: string,
): PendingSendState | null {
  const states = store.get(conversationId) ?? [];
  for (let index = states.length - 1; index >= 0; index -= 1) {
    if (states[index].text === text) return states[index];
  }
  return null;
}

function getSendStateByRequestId(
  store: PendingSendStore,
  conversationId: number,
  requestId: string,
): PendingSendState | null {
  return (store.get(conversationId) ?? []).find((state) => state.requestId === requestId) ?? null;
}

function upsertSendState(
  store: PendingSendStore,
  conversationId: number,
  nextState: PendingSendState,
): void {
  const states = store.get(conversationId) ?? [];
  const index = states.findIndex((state) => state.requestId === nextState.requestId);
  if (index >= 0) states[index] = nextState;
  else states.push(nextState);
  store.set(conversationId, states);
}

export function WhatsappCrm() {
  const { toast } = useToast();
  
  // List State
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  // These stores live above the detail component so a mobile back navigation,
  // desktop conversation switch, or a poll re-render cannot discard a draft
  // or replace an in-flight request key.
  const draftsRef = useRef<DraftStore>(new Map());
  const pendingSendsRef = useRef<PendingSendStore>(new Map());

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 500);
    return () => clearTimeout(t);
  }, [search]);

  // Queries
  const {
    data: listData,
    isLoading: listLoading,
    isFetching: listFetching,
    isError: listHasError,
    error: listError,
  } = useWhatsappConversations(debouncedSearch, statusFilter, unreadOnly);
  const { data: assignees } = useWhatsappAssignees();
  const conversations = listData?.conversations ?? [];
  const listCount = listData?.counts?.all ?? conversations.length;
  const searchWaiting = search !== debouncedSearch;
  const listErrorMessage = listError instanceof Error
    ? listError.message
    : "Não foi possível carregar as conversas.";

  return (
    <div className="flex h-[calc(100vh-140px)] w-full min-w-0 overflow-hidden bg-background rounded-xl border shadow-sm">
      {/* LEFT PANE - List */}
      <div 
        className={cn(
          "w-full md:w-[380px] lg:w-[420px] flex-col border-r bg-card flex shrink-0 transition-all duration-300",
          selectedId !== null ? "hidden md:flex" : "flex"
        )}
      >
        <div className="p-4 border-b space-y-4 bg-slate-50/50 dark:bg-slate-900/20">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-bold text-lg text-primary flex items-center gap-2">
                <MessageCircle className="w-5 h-5 text-sidebar-primary" />
                Atendimento Clínico
              </h2>
              <p className="text-xs text-muted-foreground mt-1 ml-7">CRM de WhatsApp do Admin</p>
            </div>
            <a
              href={SUPPORT_WHATSAPP_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1.5 text-xs font-medium text-emerald-700 transition-colors hover:bg-emerald-100 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-400 dark:hover:bg-emerald-950/50"
              title="Abrir WhatsApp do Admin"
            >
              <Phone className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">(28) 3199-2105</span>
              <span className="sm:hidden">{SUPPORT_WHATSAPP_NUMBER.slice(-4)}</span>
            </a>
          </div>
          
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input 
              placeholder="Buscar paciente ou telefone..." 
              className="pl-9 bg-background"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <div className="flex items-center gap-2 overflow-x-auto pb-1 no-scrollbar">
            <Badge 
              variant={statusFilter === "" ? "default" : "outline"} 
              className="cursor-pointer whitespace-nowrap"
              onClick={() => setStatusFilter("")}
            >
              Todos
            </Badge>
            {Object.entries(STATUS_LABELS).map(([val, label]) => (
              <Badge 
                key={val}
                variant={statusFilter === val ? "default" : "outline"} 
                className="cursor-pointer whitespace-nowrap"
                onClick={() => setStatusFilter(val)}
              >
                {label}
              </Badge>
            ))}
          </div>

          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <button 
              onClick={() => setUnreadOnly(!unreadOnly)}
              className={cn(
                "flex items-center gap-1.5 px-2 py-1 rounded-md transition-colors",
                unreadOnly ? "bg-sidebar-primary/10 text-sidebar-primary font-medium" : "hover:bg-muted"
              )}
            >
              <CheckCircle2 className="w-4 h-4" />
              Apenas Não Lidas
            </button>
            <div className="ml-auto text-xs font-mono">
              {searchWaiting
                ? "Aguardando busca..."
                : listFetching
                  ? "Atualizando..."
                  : `${listCount} encontrada${listCount === 1 ? "" : "s"}`}
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {listHasError && conversations.length > 0 && (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
              Não foi possível atualizar a busca: {listErrorMessage}
            </div>
          )}
          {listLoading ? (
            <div className="p-4 text-center text-sm text-muted-foreground">Carregando conversas...</div>
          ) : listHasError && conversations.length === 0 ? (
            <div className="p-8 text-center text-sm text-destructive flex flex-col items-center gap-2">
              <CircleAlert className="w-8 h-8 opacity-70" />
              <p>{listErrorMessage}</p>
              <p className="text-xs text-muted-foreground">Tente novamente em alguns instantes.</p>
            </div>
          ) : conversations.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground flex flex-col items-center gap-2">
              <Info className="w-8 h-8 opacity-20" />
              {search || statusFilter || unreadOnly
                ? "Nenhuma conversa corresponde aos filtros."
                : "Nenhuma conversa encontrada."}
            </div>
          ) : (
            conversations.map(conv => (
              <button
                key={conv.id}
                onClick={() => setSelectedId(conv.id)}
                aria-label={`Abrir conversa com ${conv.patientName || conv.displayName || conv.profileName || conv.phone}`}
                aria-pressed={selectedId === conv.id}
                className={cn(
                  "w-full text-left p-3 rounded-lg transition-all border outline-none text-sm group",
                  selectedId === conv.id 
                    ? "bg-blue-50 border-blue-200 dark:bg-blue-900/20 dark:border-blue-800" 
                    : "bg-card border-transparent hover:bg-muted hover:border-border"
                )}
              >
                <div className="flex justify-between items-start mb-1">
                  <div className="font-semibold text-foreground truncate pr-2 flex items-center gap-1.5">
                    {conv.patientName || conv.displayName || conv.profileName || conv.phone}
                    {conv.unreadCount > 0 && (
                      <span className="bg-sidebar-primary text-white text-[10px] px-1.5 py-0.5 rounded-full font-bold">
                        {conv.unreadCount}
                      </span>
                    )}
                  </div>
                  <span className="text-[10px] text-muted-foreground whitespace-nowrap mt-1">
                    {conv.lastMessageAt ? format(new Date(conv.lastMessageAt), "HH:mm", { locale: ptBR }) : ""}
                  </span>
                </div>
                
                <div className="text-muted-foreground text-xs truncate mb-2">
                  {conv.lastMessagePreview || "Nenhuma mensagem"}
                </div>
                
                <div className="flex items-center gap-2 mt-2">
                  <span className={cn("text-[10px] px-1.5 py-0.5 rounded border font-medium", STATUS_COLORS[conv.status])}>
                    {STATUS_LABELS[conv.status]}
                  </span>
                  {conv.assignedName && (
                    <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                      <User className="w-3 h-3" />
                      {conv.assignedName.split(' ')[0]}
                    </span>
                  )}
                </div>
              </button>
            ))
          )}
        </div>
      </div>

      {/* RIGHT PANE - Detail */}
      <div 
        className={cn(
          "flex-1 flex-col bg-[#F0F2F5] dark:bg-[#0B141A] transition-all duration-300 relative",
          selectedId === null ? "hidden md:flex" : "flex"
        )}
      >
        {selectedId === null ? (
          <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground space-y-4">
            <div className="w-24 h-24 rounded-full bg-slate-200 dark:bg-slate-800 flex items-center justify-center">
              <MessageCircle className="w-10 h-10 text-slate-400" />
            </div>
            <p>Selecione uma conversa para visualizar o histórico</p>
          </div>
        ) : (
          <ConversationDetail
            key={selectedId}
            id={selectedId} 
            onBack={() => setSelectedId(null)} 
            assignees={assignees || []}
            drafts={draftsRef.current}
            pendingSends={pendingSendsRef.current}
          />
        )}
      </div>
    </div>
  );
}

function MessageStatusIndicator({ status }: { status: string }) {
  const presentation = getWhatsappMessageStatusPresentation(status);
  const Icon = status === "sending"
    ? LoaderCircle
    : status === "uncertain" || status === "pending"
      ? CircleAlert
      : status === "failed"
        ? CircleX
        : status === "delivered" || status === "read"
          ? CheckCheck
          : Check;
  const toneClass = {
    muted: "text-slate-500 dark:text-slate-400",
    warning: "text-amber-700 dark:text-amber-300",
    danger: "text-red-700 dark:text-red-300",
    sent: "text-slate-600 dark:text-slate-300",
    delivered: "text-slate-600 dark:text-slate-300",
    read: "text-blue-600 dark:text-blue-300",
  }[presentation.tone];

  return (
    <span
      className={cn("inline-flex items-center gap-1", toneClass)}
      title={presentation.description}
      aria-label={presentation.label}
    >
      <Icon className={cn("w-3 h-3", status === "sending" && "animate-spin")} />
      <span>{presentation.label}</span>
    </span>
  );
}

function ConversationDetail({
  id,
  onBack,
  assignees,
  drafts,
  pendingSends,
}: {
  id: number;
  onBack: () => void;
  assignees: Assignee[];
  drafts: DraftStore;
  pendingSends: PendingSendStore;
}) {
  const {
    data,
    isLoading,
    isFetching,
    isError,
    error,
  } = useWhatsappConversation(id);
  const updateConv = useUpdateWhatsappConversation();
  const sendMsg = useSendWhatsappMessage();
  const readConv = useReadWhatsappConversation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  
  const [text, setText] = useState(() => drafts.get(id) ?? "");
  const [sendState, setSendState] = useState<PendingSendState | null>(
    () => getLatestSendState(pendingSends, id),
  );
  const scrollRef = useRef<HTMLDivElement>(null);
  const isNearBottomRef = useRef(true);
  const lastMessageSignatureRef = useRef<string | null>(null);
  const lastReadWatermarkRef = useRef<number | null>(null);
  const mountedRef = useRef(true);

  const conv = data?.conversation;
  const messages = data?.messages || [];
  const readThroughMessageId = data?.readThroughMessageId ?? null;
  const latestServerMessage = messages.reduce<Message | null>((latest, message) => {
    if (!latest) return message;
    const latestTime = Date.parse(latest.createdAt);
    const messageTime = Date.parse(message.createdAt);
    return messageTime > latestTime || (messageTime === latestTime && message.id > latest.id)
      ? message
      : latest;
  }, null);
  const listConversation = conv && latestServerMessage
    && Number.isFinite(Date.parse(latestServerMessage.createdAt))
    && Date.parse(latestServerMessage.createdAt) > Date.parse(conv.lastMessageAt)
    ? {
        ...conv,
        lastMessagePreview: latestServerMessage.content.slice(0, 240),
        lastMessageAt: latestServerMessage.createdAt,
      }
    : conv;
  const messageSignature = messages
    .map((message) => `${message.id}:${message.status}:${message.clientRequestId ?? ""}`)
    .join("|");

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Detail polling is authoritative for the selected conversation. Reconcile
  // durable sending/pending/failed rows after a remount before a composer
  // submission can create another key. The map remains memory-only; no
  // message text or request key is written to localStorage.
  useEffect(() => {
    const recovered = getRecoverableWhatsappSends(messages);
    for (const recoveredState of recovered) {
      const existing = getSendStateByRequestId(pendingSends, id, recoveredState.requestId);
      if (!shouldApplyServerSendState(existing, recoveredState.status)) {
        // A retry can be in flight while the poll still exposes the old
        // row. Its explicit mutation result owns the transition.
        continue;
      }
      upsertSendState(pendingSends, id, recoveredState);
    }

    const currentBeforeMessageReconcile = sendState
      ? getSendStateByRequestId(pendingSends, id, sendState.requestId)
      : null;
    for (const message of messages) {
      if (message.direction !== "outbound" || !message.clientRequestId) continue;
      const current = getSendStateByRequestId(pendingSends, id, message.clientRequestId);
      const serverStatus = getPendingSendStatus(message.status);
      if (
        !current
        || !serverStatus
        || !shouldApplyServerSendState(current, serverStatus)
        || current.status === serverStatus
      ) {
        continue;
      }
      upsertSendState(pendingSends, id, {
        ...current,
        status: serverStatus,
      });
    }

    const current = currentBeforeMessageReconcile
      ? getSendStateByRequestId(pendingSends, id, currentBeforeMessageReconcile.requestId)
      : null;
    const nextState = current ?? recovered[recovered.length - 1] ?? getLatestSendState(pendingSends, id);
    if (
      nextState
      && (
        !sendState
        || sendState.requestId !== nextState.requestId
        || sendState.status !== nextState.status
        || sendState.text !== nextState.text
      )
      && mountedRef.current
    ) {
      setSendState(nextState);
    }
  }, [id, messageSignature, pendingSends, sendState?.requestId, sendState?.status, sendState?.text]);

  // Detail polling can observe a new inbound message before the list's
  // bounded poll. Patch only the row already present in each filtered cache;
  // do not invalidate or add rows, which would lose search/status filters or
  // create a refetch loop.
  useEffect(() => {
    if (!listConversation) return;
    queryClient.setQueriesData<WhatsappConversationsResponse>(
      { queryKey: ["admin-whatsapp-conversations"] },
      (current) => mergeWhatsappConversationPreview(current, listConversation),
    );
  }, [
    listConversation?.id,
    listConversation?.lastMessageAt,
    listConversation?.lastMessagePreview,
    queryClient,
  ]);

  // Mark only the visible inbound watermark as read.  This avoids clearing a
  // newer inbound message that arrived while the request was in flight.
  useEffect(() => {
    if (
      !conv
      || conv.unreadCount <= 0
      || readThroughMessageId === null
      || readConv.isPending
      || lastReadWatermarkRef.current === readThroughMessageId
    ) {
      return;
    }
    lastReadWatermarkRef.current = readThroughMessageId;
    readConv.mutate(
      { id, readThroughMessageId },
      {
        onError: (readError) => {
          lastReadWatermarkRef.current = null;
          toast({
            title: "Não foi possível marcar como lida",
            description: readError instanceof Error ? readError.message : "Tente novamente.",
            variant: "destructive",
          });
        },
      },
    );
  }, [id, conv?.unreadCount, readThroughMessageId, readConv.isPending, toast]);

  // Follow new messages only while the operator is already near the bottom.
  // Reading older history therefore survives polling and conversation updates.
  useEffect(() => {
    const element = scrollRef.current;
    if (!element || lastMessageSignatureRef.current === messageSignature) return;
    const hadPreviousMessages =
      lastMessageSignatureRef.current !== null
      && lastMessageSignatureRef.current.length > 0;
    lastMessageSignatureRef.current = messageSignature;

    const scroll = () => {
      if (!scrollRef.current) return;
      if (!hadPreviousMessages || isNearBottomRef.current) {
        scrollRef.current.scrollTo({
          top: scrollRef.current.scrollHeight,
          behavior: hadPreviousMessages ? "smooth" : "auto",
        });
      }
    };
    if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
      const frame = window.requestAnimationFrame(scroll);
      return () => window.cancelAnimationFrame(frame);
    }
    scroll();
    return undefined;
  }, [messageSignature]);

  if (isLoading) {
    return (
      <div className="flex-1 flex flex-col">
        <div className="h-16 px-2 bg-card border-b flex items-center shrink-0">
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden"
            onClick={onBack}
            aria-label="Voltar para a lista de conversas"
          >
            <ArrowLeft className="w-5 h-5" />
          </Button>
        </div>
        <div className="flex-1 flex items-center justify-center text-muted-foreground">
          Carregando dados...
        </div>
      </div>
    );
  }

  if (!conv) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-2 text-muted-foreground">
        <CircleAlert className="w-8 h-8 opacity-70" />
        <p>{isError ? (error instanceof Error ? error.message : "Não foi possível carregar a conversa.") : "Conversa não encontrada"}</p>
        <Button variant="ghost" onClick={onBack}>Voltar para conversas</Button>
      </div>
    );
  }

  const displayedMessages = (() => {
    if (
      !sendState
      || (sendState.status !== "sending"
        && sendState.status !== "uncertain"
        && sendState.status !== "failed")
      || messages.some((message) => message.clientRequestId === sendState.requestId)
    ) {
      return messages;
    }
    const optimisticMessage: Message = {
      id: -1,
      clientRequestId: sendState.requestId,
      direction: "outbound",
      content: sendState.text,
      status: sendState.status,
      messageType: "text",
      createdAt: new Date().toISOString(),
      sentByName: null,
    };
    return [...messages, optimisticMessage];
  })();

  const handleSend = async () => {
    const trimmed = text.trim();
    if (!trimmed) return;

    const existing = getSendStateByText(pendingSends, id, trimmed);
    if (existing?.text === trimmed && existing.status === "sending") {
      return;
    }
    if (existing?.text === trimmed && existing.status === "uncertain") {
      toast({
        title: "Envio incerto",
        description: "Confirme o status no histórico antes de tentar enviar novamente.",
        variant: "destructive",
      });
      return;
    }
    const pending: PendingSendState = existing?.text === trimmed && existing.status === "failed"
      ? { ...existing, status: "sending" }
      : { text: trimmed, requestId: createWhatsappRequestId(), status: "sending" };
    upsertSendState(pendingSends, id, pending);
    if (getLatestSendState(pendingSends, id)?.requestId === pending.requestId) {
      setSendState(pending);
    }

    // Clear only the draft that was submitted.  If the operator types another
    // draft while the request is in flight, its value remains in the store.
    if (shouldClearWhatsappDraft(drafts.get(id), text)) {
      drafts.delete(id);
      setText("");
    }

    try {
      const result = await sendMsg.mutateAsync({
        id,
        text: pending.text,
        requestId: pending.requestId,
      });
      const current = getSendStateByRequestId(pendingSends, id, pending.requestId);
      if (!current || !canApplyWhatsappSendCompletion(current.requestId, pending.requestId)) return;
      const active = getLatestSendState(pendingSends, id);
      const isActiveRequest = Boolean(
        active && canApplyWhatsappSendCompletion(active.requestId, pending.requestId),
      );
      const nextStatus: PendingSendState["status"] = result.status === "pending" || result.status === "uncertain"
        ? "uncertain"
        : result.status === "failed"
          ? "failed"
          : isConfirmedMessageStatus(result.status)
            ? result.status
            : "sending";
      const next = { ...pending, status: nextStatus };
      upsertSendState(pendingSends, id, next);
      if (isActiveRequest && mountedRef.current) setSendState(next);
      if (isActiveRequest && nextStatus === "uncertain") {
        toast({
          title: "Envio sem confirmação",
          description: "A mensagem foi registrada, mas a entrega não pôde ser confirmada. Não tente novamente sem verificar.",
          variant: "destructive",
        });
      }
    } catch (sendError) {
      const current = getSendStateByRequestId(pendingSends, id, pending.requestId);
      if (!current || !canApplyWhatsappSendCompletion(current.requestId, pending.requestId)) return;
      const active = getLatestSendState(pendingSends, id);
      const isActiveRequest = Boolean(
        active && canApplyWhatsappSendCompletion(active.requestId, pending.requestId),
      );
      // A response with an explicit HTTP status is a known rejection.  A
      // network/transport error is ambiguous and keeps this same key without
      // silently retrying.
      const nextStatus: PendingSendState["status"] = sendError instanceof HttpError ? "failed" : "uncertain";
      const next = { ...pending, status: nextStatus };
      upsertSendState(pendingSends, id, next);
      if (isActiveRequest && !drafts.has(id)) {
        drafts.set(id, pending.text);
        if (mountedRef.current) setText(pending.text);
      }
      if (isActiveRequest && mountedRef.current) setSendState(next);
      if (isActiveRequest) toast({
        title: nextStatus === "uncertain" ? "Não foi possível confirmar o envio" : "Envio recusado",
        description: sendError instanceof Error
          ? sendError.message
          : "Verifique o histórico antes de tentar novamente.",
        variant: "destructive",
      });
    }
  };

  const handleUpdate = (data: ConversationUpdate, title: string) => {
    updateConv.mutate(
      { id, data },
      {
        onError: (updateError) => {
          toast({
            title,
            description: updateError instanceof Error ? updateError.message : "Tente novamente.",
            variant: "destructive",
          });
        },
      },
    );
  };

  const handleStatusChange = (status: Conversation["status"]) => {
    handleUpdate({ status }, "Não foi possível atualizar o status");
  };

  const handleAssign = (assignedTo: number | null) => {
    handleUpdate({ assignedTo }, "Não foi possível atualizar o responsável");
  };

  const handlePatientPrompt = () => {
    const res = window.prompt("ID do Paciente (vazio para remover):", conv.patientId?.toString() || "");
    if (res !== null) {
      const pid = res.trim() ? parseInt(res.trim(), 10) : null;
      if (pid === null || !isNaN(pid)) {
        handleUpdate({ patientId: pid }, "Não foi possível atualizar o paciente");
      } else {
        toast({ title: "ID inválido", variant: "destructive" });
      }
    }
  };

  const handleTagsPrompt = () => {
    const res = window.prompt("Tags (separadas por vírgula):", conv.tags?.join(", ") || "");
    if (res !== null) {
      const tags = res.split(",").map(t => t.trim()).filter(Boolean);
      handleUpdate({ tags }, "Não foi possível atualizar as tags");
    }
  };

  return (
    <>
      {/* Header */}
      <div className="min-h-16 px-2 sm:px-4 py-2 bg-card border-b flex items-center justify-between gap-2 shrink-0 shadow-sm z-10">
        <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden -ml-1 shrink-0"
            onClick={onBack}
            aria-label="Voltar para a lista de conversas"
          >
            <ArrowLeft className="w-5 h-5" />
          </Button>
          
          <div className="w-10 h-10 bg-slate-100 dark:bg-slate-800 rounded-full flex items-center justify-center text-slate-500 shrink-0">
            <UserCircle className="w-6 h-6" />
          </div>
          
          <div className="min-w-0">
            <div className="font-semibold text-sm flex items-center gap-2 truncate">
              {conv.patientName || conv.displayName || conv.profileName || conv.phone}
              {conv.patientId && (
                <Badge variant="secondary" className="text-[10px] px-1 py-0 h-4 bg-sidebar-primary/10 text-sidebar-primary border-sidebar-primary/20">
                  <Stethoscope className="w-3 h-3 mr-1" />
                  Paciente
                </Badge>
              )}
            </div>
            <div className="text-xs text-muted-foreground font-mono flex items-center gap-1 truncate">
              <Phone className="w-3 h-3" /> {conv.phone}
            </div>
          </div>
        </div>

        <div className="flex max-w-[62%] shrink-0 items-center justify-end gap-1 overflow-x-auto sm:max-w-none sm:gap-2">
          <select 
            className="max-w-[104px] sm:max-w-none text-xs bg-background border rounded px-1.5 sm:px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-primary"
            value={conv.status}
            onChange={(e) => handleStatusChange(e.target.value as Conversation["status"])}
            aria-label="Status da conversa"
            disabled={updateConv.isPending}
          >
            {Object.entries(STATUS_LABELS).map(([val, label]) => (
              <option key={val} value={val}>{label}</option>
            ))}
          </select>
          
          <select 
            className="max-w-[110px] sm:max-w-none text-xs bg-background border rounded px-1.5 sm:px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-primary"
            value={conv.assignedTo || ""}
            onChange={(e) => handleAssign(e.target.value ? parseInt(e.target.value, 10) : null)}
            aria-label="Responsável pela conversa"
            disabled={updateConv.isPending}
          >
            <option value="">Atribuir a...</option>
            {assignees.map(a => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>

          <Button variant="ghost" size="icon" onClick={handleTagsPrompt} title="Gerenciar Tags">
            <TagIcon className="w-4 h-4 text-muted-foreground" />
          </Button>
          
          <Button variant="ghost" size="icon" onClick={handlePatientPrompt} title="Vincular Paciente">
            <Stethoscope className="w-4 h-4 text-muted-foreground" />
          </Button>
        </div>
      </div>

      {/* Info Bar if tags exist */}
      {conv.tags && conv.tags.length > 0 && (
        <div className="bg-slate-100/80 dark:bg-slate-800/80 border-b px-4 py-2 flex items-center gap-2 text-xs overflow-x-auto shrink-0 z-0">
          <TagIcon className="w-3 h-3 text-slate-400 shrink-0" />
          {conv.tags.map(t => (
            <span key={t} className="bg-white dark:bg-slate-700 px-2 py-0.5 rounded shadow-sm border border-slate-200 dark:border-slate-600">
              {t}
            </span>
          ))}
        </div>
      )}

      {/* Messages */}
      <div
        className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4"
        ref={scrollRef}
        onScroll={(event) => {
          const element = event.currentTarget;
          isNearBottomRef.current =
            element.scrollHeight - element.scrollTop - element.clientHeight <= 96;
        }}
        aria-live="polite"
      >
        {isError && (
          <div className="mb-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
            Histórico desatualizado: {error instanceof Error ? error.message : "não foi possível atualizar agora"}.
          </div>
        )}
        {isFetching && !isLoading && (
          <div className="sticky top-0 z-[1] mx-auto w-fit rounded-full bg-card/90 px-3 py-1 text-[10px] text-muted-foreground shadow-sm">
            Atualizando histórico...
          </div>
        )}
        {displayedMessages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-muted-foreground opacity-50">
            <MessageCircle className="w-12 h-12 mb-4" />
            <p>Histórico vazio</p>
          </div>
        ) : (
          displayedMessages.map((msg, idx) => {
            const isOutbound = msg.direction === "outbound";
            const showDate = idx === 0 || new Date(displayedMessages[idx-1].createdAt).toDateString() !== new Date(msg.createdAt).toDateString();
            
            return (
              <React.Fragment key={msg.clientRequestId || msg.id}>
                {showDate && (
                  <div className="flex justify-center my-4">
                    <span className="text-[10px] font-medium bg-slate-200/50 dark:bg-slate-800 text-slate-500 px-3 py-1 rounded-md shadow-sm">
                      {format(new Date(msg.createdAt), "dd 'de' MMMM, yyyy", { locale: ptBR })}
                    </span>
                  </div>
                )}
                <div className={cn("flex", isOutbound ? "justify-end" : "justify-start")}>
                  <div 
                    className={cn(
                      "max-w-[85%] sm:max-w-[75%] rounded-lg px-3 py-2 text-sm shadow-sm relative group",
                      isOutbound 
                        ? "bg-[#D9FDD3] dark:bg-[#005C4B] text-slate-900 dark:text-slate-100 rounded-tr-none" 
                        : "bg-white dark:bg-[#202C33] text-slate-900 dark:text-slate-100 rounded-tl-none border border-slate-100 dark:border-slate-800"
                    )}
                  >
                    {!isOutbound && conv.patientName && (
                      <div className="text-[10px] font-bold text-teal-600 dark:text-teal-400 mb-0.5">
                        {conv.patientName}
                      </div>
                    )}
                    {isOutbound && msg.sentByName && (
                      <div className="text-[10px] font-bold text-emerald-700 dark:text-emerald-400 mb-0.5">
                        {msg.sentByName}
                      </div>
                    )}
                    
                    <div className="whitespace-pre-wrap break-words leading-relaxed">
                      {msg.content}
                    </div>
                    
                    <div className="text-[10px] text-slate-500 dark:text-slate-400 mt-1 flex items-center justify-end gap-1">
                      {format(new Date(msg.createdAt), "HH:mm")}
                      {isOutbound && (
                        <MessageStatusIndicator status={msg.status} />
                      )}
                    </div>
                  </div>
                </div>
              </React.Fragment>
            );
          })
        )}
      </div>

      {/* Input */}
      <div className="bg-card p-3 flex gap-2 items-end shrink-0 border-t">
        <textarea
          className="flex-1 bg-background border rounded-lg p-3 text-sm min-h-[44px] max-h-32 resize-none focus:outline-none focus:ring-1 focus:ring-sidebar-primary"
          placeholder="Digite uma mensagem..."
          value={text}
          onChange={e => {
            const nextText = e.target.value;
            setText(nextText);
            if (nextText) drafts.set(id, nextText);
            else drafts.delete(id);
          }}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
          rows={1}
        />
        <Button 
          className="h-11 w-11 shrink-0 rounded-full bg-sidebar-primary hover:bg-sidebar-primary/90 text-white" 
          onClick={handleSend}
          disabled={
            !text.trim()
            || (sendState?.status === "sending" && sendState.text === text.trim())
            || (sendState?.status === "uncertain" && sendState.text === text.trim())
          }
          aria-label="Enviar mensagem"
        >
          <Send className="w-5 h-5 ml-1" />
        </Button>
      </div>
    </>
  );
}
