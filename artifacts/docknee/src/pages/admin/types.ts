export interface AdminPhysio {
  id: number;
  nome: string;
  email: string;
  celular: string;
  crefito: string | null;
  clinica: string | null;
  cidade: string | null;
  plan: string;
  subscriptionStatus: string;
  patientsCreatedTotal: number;
  ativo: boolean;
  createdAt: string;
  patientsCount: number;
}

export interface ContactMessage {
  id: number;
  doctorId: number | null;
  nome: string | null;
  email: string | null;
  celular: string | null;
  crm: string | null;
  mensagem: string;
  lida: boolean;
  createdAt: string;
  resposta: string | null;
  respondidaEm: string | null;
  respostaLida: boolean;
  ticketStatus: "open" | "in_progress" | "resolved" | "closed" | null;
  ticketPriority: "low" | "medium" | "high" | "critical" | null;
  ticketTags: string | null;
  assignedTo: number | null;
  slaDueAt: string | null;
  firstResponseAt: string | null;
}

export interface AllSurgery {
  id: number;
  dataCirurgia: string | null;
  hospital: string | null;
  tipoCaso: string | null;
  tiposProcedimento: string[];
  createdAt: string;
  doctorId: number;
  doctorNome: string | null;
  doctorCrm: string | null;
  doctorCrmEstado: string | null;
  patientId: number;
  patientNome: string | null;
  patientSexo: string | null;
}

export interface AdminAnalyticsData {
  meta: {
    period: string;
    timezone: string;
    range: { start: string; end: string; days: number };
    priorRange: { start: string; end: string; days: number };
    dataAvailability: {
      doctors: string | null;
      analytics: string | null;
      auditLogs: string | null;
      note: string | null;
    };
    generatedAt: string;
  };
  kpis: {
    activeUsers: { current: number; prior: number; deltaPercent: number | null; source: string };
    newDoctors: { current: number; prior: number; deltaPercent: number | null; source: string };
    activationRate: { current: number | null; source: string; unavailableReason?: string };
    subscriptions: {
      active: number;
      trial: number;
      pastDue: number;
      canceled: number;
      distribution: { status: string; count: number }[];
      source: string;
      unavailableReason?: string;
    };
    revenue: {
      mrrCents: number | null;
      arrCents: number | null;
      arpuCents: number | null;
      churnRate: number | null;
      churnUnavailableReason: string | null;
      ltvCents: number | null;
      ltvUnavailableReason: string | null;
      source: string;
      unavailableReason?: string;
    };
    visits: {
      current: number;
      prior: number;
      uniqueCurrent: number;
      uniquePrior: number;
      conversionRate: number | null;
      source: string;
      unavailableReason?: string;
    };
    support: { openTickets: number; criticalTickets: number; source: string };
    api: {
      requestsCurrent: number;
      requestsPrior: number;
      errorRateCurrent: number | null;
      p95DurationMs: number | null;
      source: string;
      unavailableReason?: string;
    };
  };
  funnel: {
    acquisitionVisit: number;
    register: number;
    checkoutStarted: number;
    subscriptionActivated: number;
    acquisitionToRegisterPct: number | null;
    registerToCheckoutPct: number | null;
    checkoutToSubscriptionPct: number | null;
    totalConversionPct: number | null;
  };
  topFeatures: {
    data: { featureName: string; count: number }[];
    source: string;
    unavailableReason?: string;
  };
  topPages: {
    data: { pagePath: string; count: number }[];
    source: string;
    unavailableReason?: string;
  };
  timeSeries: {
    dailyRegistrations: { day: string; newDoctors: number }[];
    dailySessions: { day: string; sessions: number; activeUsers: number }[];
    dailyApiRequests: { day: string; requests: number; errors: number }[];
    dailyRevenue: { day: string; amountPaidCents: number }[];
  };
  retention: {
    source: string;
    unavailableReason?: string;
    cohorts: {
      cohortWeek: string;
      cohortSize: number;
      week1Percent: number | null;
      week2Percent: number | null;
      week4Percent: number | null;
    }[];
  };
  campaigns: {
    id: number;
    name: string;
    status: string;
    channel: string;
    utmCampaign: string | null;
    budgetCents: number | null;
    acquisitionVisits: number | null;
    registrations: number | null;
    cacCents: number | null;
    revenueCents: number | null;
    roiPercent: number | null;
    source: string;
    unavailableReason?: string;
  }[];
  webVitals: {
    lcpP75Ms: number | null;
    clsP75: number | null;
    source: string;
    unavailableReason?: string;
  };
  usageFunnel?: {
    period: { start: string; end: string; timezone: string };
    coverage: {
      documentationSources: string[];
      clickSource: string;
      documentationLimitations: string[];
      start: string | null;
      empty: boolean;
      unavailableReason?: string;
    };
    activeDoctors: number;
    enteredWithoutDocumentationDoctors: number;
    documentedDoctors: number;
    enteredWithoutDocumentationDoctorList: { name: string; email: string }[];
  };
  navigationClickRanking?: {
    coverageStart: string | null;
    empty: boolean;
      unavailableReason?: string;
    items: {
      route: string;
      feature: string;
      count: number;
      uniqueDoctors: number;
    }[];
  };
}

export interface FeatureFlag {
  id: number;
  key: string;
  description: string | null;
  enabled: boolean;
  variant: string | null;
  version: number;
  updatedBy: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface Conversation {
  id: number;
  phone: string;
  displayName: string | null;
  profileName: string | null;
  patientId: number | null;
  patientName: string | null;
  status: "new" | "in_progress" | "waiting" | "closed";
  unreadCount: number;
  lastMessagePreview: string | null;
  lastMessageAt: string;
  tags: string[];
  assignedTo: number | null;
  assignedName: string | null;
  createdAt: string;
}

export type WhatsappMessageStatus =
  | "sending"
  | "pending"
  | "uncertain"
  | "failed"
  | "sent"
  | "delivered"
  | "read"
  | "received"
  | (string & {});

export interface WhatsappMessageStatusPresentation {
  label: string;
  description: string;
  tone: "muted" | "warning" | "danger" | "sent" | "delivered" | "read";
}

/** A late response must not update the newer attempt for this conversation. */
export function canApplyWhatsappSendCompletion(
  activeRequestId: string | null | undefined,
  completedRequestId: string,
): boolean {
  return activeRequestId === completedRequestId;
}

/** Do not erase text typed after an earlier message was submitted. */
export function shouldClearWhatsappDraft(
  currentDraft: string | undefined,
  submittedDraft: string,
): boolean {
  return currentDraft === submittedDraft;
}

/**
 * Keep provider delivery states distinct in the UI.  In particular, pending
 * is not a successful single-check state: it means that the outcome could not
 * be confirmed and must not trigger an automatic retry.
 */
export function getWhatsappMessageStatusPresentation(
  status: string | null | undefined,
): WhatsappMessageStatusPresentation {
  switch (status) {
    case "sending":
      return {
        label: "Enviando",
        description: "O envio ainda está em andamento.",
        tone: "muted",
      };
    case "pending":
    case "uncertain":
      return {
        label: "Incerto",
        description: "Não foi possível confirmar a entrega. Não tente enviar novamente sem confirmar.",
        tone: "warning",
      };
    case "failed":
      return {
        label: "Falhou",
        description: "O provedor recusou o envio.",
        tone: "danger",
      };
    case "sent":
      return {
        label: "Enviada",
        description: "A mensagem foi aceita pelo provedor.",
        tone: "sent",
      };
    case "delivered":
      return {
        label: "Entregue",
        description: "A mensagem foi entregue ao destinatário.",
        tone: "delivered",
      };
    case "read":
      return {
        label: "Lida",
        description: "A mensagem foi lida pelo destinatário.",
        tone: "read",
      };
    case "received":
      return {
        label: "Recebida",
        description: "Mensagem recebida do paciente.",
        tone: "muted",
      };
    default:
      return {
        label: status ? `Status: ${status}` : "Status desconhecido",
        description: "O status desta mensagem não foi reconhecido.",
        tone: "muted",
      };
  }
}

export interface Message {
  id: number;
  direction: "inbound" | "outbound";
  content: string;
  status: WhatsappMessageStatus;
  messageType: string;
  createdAt: string;
  sentByName: string | null;
  clientRequestId?: string | null;
}

export interface RecoverableWhatsappSend {
  text: string;
  requestId: string;
  status: "sending" | "uncertain" | "failed";
}

/**
 * A reload loses the in-memory request map, but the detail endpoint still
 * returns the durable outbound row. Keep every recoverable key so retyping an
 * older ambiguous message cannot silently create a second provider attempt.
 */
export function getRecoverableWhatsappSends(messages: Message[]): RecoverableWhatsappSend[] {
  return messages
    .filter(
      (message) =>
        message.direction === "outbound"
        && typeof message.clientRequestId === "string"
        && message.clientRequestId.length > 0
        && (message.status === "sending"
          || message.status === "pending"
          || message.status === "uncertain"
          || message.status === "failed"),
    )
    .sort((left, right) => left.id - right.id)
    .map((message) => ({
      text: message.content,
      requestId: message.clientRequestId as string,
      status: message.status === "pending" || message.status === "uncertain"
        ? "uncertain"
        : message.status === "failed"
          ? "failed"
          : "sending",
    }));
}

export interface Assignee {
  id: number;
  name: string;
  role: string;
}

export interface Announcement {
  id: number;
  title: string;
  body: string;
  type: "info" | "warning" | "success" | "error";
  active: boolean;
  startsAt: string | null;
  expiresAt: string | null;
  createdBy: number | null;
  updatedBy: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface Faq {
  id: number;
  question: string;
  answer: string;
  category: string | null;
  sortOrder: number;
  active: boolean;
  createdBy: number | null;
  updatedBy: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface Campaign {
  id: number;
  name: string;
  description: string | null;
  channel: "email" | "in_app" | "social" | "other";
  budgetCents: number | null;
  utmCampaign: string | null;
  startsAt: string | null;
  endsAt: string | null;
  status: "draft" | "active" | "paused" | "ended";
  notes: string | null;
  createdBy: number | null;
  updatedBy: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface AdminAlert {
  id: number;
  title: string;
  message: string;
  severity: "info" | "warning" | "error" | "critical";
  source: string;
  read: boolean;
  readBy: number | null;
  readAt: string | null;
  createdAt: string;
}

export interface ServiceInst {
  id: number;
  nome: string;
  cnpj: string | null;
  email: string;
  clinica?: string | null;
  cidade?: string | null;
  crefito?: string | null;
  plan_type?: string | null;
  is_active?: boolean;
  last_login_at?: string | null;
  created_at?: string | null;
  responsavelNome: string | null;
  responsavelCpf: string | null;
  responsavelCrm: string | null;
  plan: string;
  ativo: boolean;
  createdAt: string;
  doctorsCount: number;
  patientsCount: number;
  medicos_vinculados?: number;
}
