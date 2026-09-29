import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

// ─── TYPES ──────────────────────────────────────────────────────────────────

export interface PreConsultAnswers {
  sobreVoce: string;
  queixaPrincipal: string;
  tempoProblema: string;
  inicioSintomasTipo: "trauma" | "atividade_fisica" | "progressivo" | "pos_cirurgia" | "outro" | "";
  inicioSintomasDescricao: string;
  localProblema: string;
  caracteristicaDor: string;
  intensidadeDor: number | null;
  pioraSintomas: string[];
  pioraSintomasOutro: string;
  melhoraSintomas: string;
  limitacoesDiarias: string;
  condicoesSaude: string;
  medicamentos: string;
  alergias: string;
  cirurgiasPrevias: string;
  complicacoes: string;
  tratamentosPrevios: string[];
  tratamentosDescricao: string;
  cirurgiaRegiaoAfetada: string;
  ortobiologicos: string[];
  ortobiologicosDescricao: string;
  examesPossui: string[];
  examesInfo: string;
  outrasInformacoesMedicas: string;
  objetivoTratamento: "reduzir_dor" | "caminhar_melhor" | "retornar_trabalho" | "atividade_fisica" | "retornar_esporte" | "evitar_cirurgia" | "avaliar_cirurgia" | "outro" | "";
  objetivoTratamentoOutro: string;
  preocupacaoCirurgia: string;
  expectativaConsulta: string;
  observacoes: string;
}

export const emptyPreConsultAnswers: PreConsultAnswers = {
  sobreVoce: "",
  queixaPrincipal: "",
  tempoProblema: "",
  inicioSintomasTipo: "",
  inicioSintomasDescricao: "",
  localProblema: "",
  caracteristicaDor: "",
  intensidadeDor: null,
  pioraSintomas: [],
  pioraSintomasOutro: "",
  melhoraSintomas: "",
  limitacoesDiarias: "",
  condicoesSaude: "",
  medicamentos: "",
  alergias: "",
  cirurgiasPrevias: "",
  complicacoes: "",
  tratamentosPrevios: [],
  tratamentosDescricao: "",
  cirurgiaRegiaoAfetada: "",
  ortobiologicos: [],
  ortobiologicosDescricao: "",
  examesPossui: [],
  examesInfo: "",
  outrasInformacoesMedicas: "",
  objetivoTratamento: "",
  objetivoTratamentoOutro: "",
  preocupacaoCirurgia: "",
  expectativaConsulta: "",
  observacoes: "",
};

export interface PreConsultAttachment {
  id: number;
  fileName: string;
  fileSize: number;
  mimeType: string;
  url: string;
  createdAt: string;
}

export interface PatientPreConsultForm {
  status: "draft" | "submitted";
  answers: PreConsultAnswers;
  attachments: PreConsultAttachment[];
  questionnaireVersion: number;
  lastSavedAt: string | null;
}

async function parseError(res: Response, defaultMessage: string) {
  let msg = defaultMessage;
  try {
    const err = await res.json();
    msg = err.message || err.error || msg;
  } catch (e) {
    msg = res.statusText || msg;
  }
  return new Error(msg);
}

// ─── PATIENT HOOKS ────────────────────────────────────────────────────────

export function useGetPreConsultInvite(token: string) {
  return useQuery({
    queryKey: ["pre-consult", token],
    queryFn: async () => {
      const res = await fetch(`/regen-api/pre-consult/${token}`);
      if (!res.ok) throw await parseError(res, "Convite inválido");
      return res.json() as Promise<{
        valid: boolean;
        submitted: boolean;
        questionnaireVersion: number;
        expiresAt: string;
      }>;
    },
    retry: false,
  });
}

export function useVerifyPreConsult(token: string) {
  return useMutation({
    mutationFn: async (cpf: string) => {
      const res = await fetch(`/regen-api/pre-consult/${token}/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cpf }),
      });
      if (!res.ok) throw await parseError(res, "CPF inválido para este convite");
      return res.json() as Promise<{ verified: boolean }>;
    },
  });
}

export function useGetPreConsultForm(token: string, verified: boolean) {
  return useQuery({
    queryKey: ["pre-consult-form", token],
    queryFn: async () => {
      const res = await fetch(`/regen-api/pre-consult/${token}/form`);
      if (!res.ok) throw await parseError(res, "Erro ao buscar formulário");
      return res.json() as Promise<PatientPreConsultForm>;
    },
    enabled: verified,
  });
}

export function useSavePreConsultAnswers(token: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (answers: Partial<PreConsultAnswers>) => {
      const res = await fetch(`/regen-api/pre-consult/${token}/answers`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers }),
      });
      if (!res.ok) throw await parseError(res, "Erro ao salvar respostas");
      return res.json() as Promise<{ saved: boolean; lastSavedAt: string }>;
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["pre-consult-form", token], (old: any) => 
        old ? { ...old, lastSavedAt: data.lastSavedAt } : old
      );
    }
  });
}

export function useSubmitPreConsult(token: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (answers: PreConsultAnswers) => {
      const res = await fetch(`/regen-api/pre-consult/${token}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers }),
      });
      if (!res.ok) throw await parseError(res, "Erro ao enviar questionário");
      return res.json() as Promise<{ submitted: boolean; submittedAt: string }>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pre-consult-form", token] });
    }
  });
}

export function useUploadPreConsultAttachment(token: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (file: File) => {
      // 1. Request URL
      const urlRes = await fetch(`/regen-api/pre-consult/${token}/uploads/request-url`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: file.name, size: file.size, mimeType: file.type }),
      });
      if (!urlRes.ok) throw await parseError(urlRes, "Erro ao solicitar upload");
      const { uploadUrl, uploadToken } = await urlRes.json();

      // 2. Upload file
      const uploadRes = await fetch(uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!uploadRes.ok) throw new Error("Erro ao enviar arquivo");

      // 3. Register attachment
      const attachRes = await fetch(`/regen-api/pre-consult/${token}/attachments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uploadToken }),
      });
      if (!attachRes.ok) throw await parseError(attachRes, "Erro ao registrar arquivo");
      return attachRes.json() as Promise<PreConsultAttachment>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pre-consult-form", token] });
    }
  });
}

// ─── PHYSICIAN HOOKS ────────────────────────────────────────────────────────

export interface PhysicianPreConsultInvite {
  id: number;
  status: "active" | "revoked" | "submitted" | "expired";
  expiresAt: string;
  createdAt: string;
}

export interface PhysicianPreConsultQuestionnaire {
  status: "draft" | "submitted";
  patientAnswers: PreConsultAnswers | null;
  currentAnswers: PreConsultAnswers | null;
  submittedAt: string | null;
  lastPatientSavedAt: string | null;
  doctorEditedAt: string | null;
  questionnaireVersion: number;
}

export interface PhysicianPreConsultData {
  questionnaire: PhysicianPreConsultQuestionnaire | null;
  invite: PhysicianPreConsultInvite | null;
  attachments: PreConsultAttachment[];
}

export async function fetchPhysicianPreConsult(patientId: number): Promise<PhysicianPreConsultData> {
  const res = await fetch(`/regen-api/patients/${patientId}/pre-consult`, { credentials: "same-origin" });
  if (!res.ok) throw await parseError(res, "Erro ao buscar pré-consulta");
  return res.json() as Promise<PhysicianPreConsultData>;
}

export function physicianPreConsultQueryKey(patientId: number) {
  return ["physician-pre-consult", patientId] as const;
}

export function useGetPhysicianPreConsult(patientId: number) {
  return useQuery({
    queryKey: physicianPreConsultQueryKey(patientId),
    queryFn: () => fetchPhysicianPreConsult(patientId),
    enabled: !!patientId,
  });
}

export function useCreatePreConsultInvite(patientId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const res = await fetch(`/regen-api/patients/${patientId}/pre-consult/invite`, {
        method: "POST",
        credentials: "same-origin",
      });
      if (!res.ok) throw await parseError(res, "Erro ao gerar convite");
      return res.json() as Promise<{ link: string; whatsappMessage: string; expiresAt: string; inviteId: number }>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["physician-pre-consult", patientId] });
    }
  });
}

export function useRevokePreConsultInvite(patientId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (inviteId: number) => {
      const res = await fetch(`/regen-api/patients/${patientId}/pre-consult/invite/${inviteId}/revoke`, {
        method: "POST",
        credentials: "same-origin",
      });
      if (!res.ok) throw await parseError(res, "Erro ao revogar convite");
      return res.json() as Promise<{ revoked: boolean }>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["physician-pre-consult", patientId] });
    }
  });
}

export function useUpdatePhysicianPreConsult(patientId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (answers: Partial<PreConsultAnswers>) => {
      const res = await fetch(`/regen-api/patients/${patientId}/pre-consult`, {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers }),
      });
      if (!res.ok) throw await parseError(res, "Erro ao salvar questionário");
      return res.json() as Promise<{ questionnaire: PhysicianPreConsultQuestionnaire }>;
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["physician-pre-consult", patientId], (old: any) => 
        old ? { ...old, questionnaire: data.questionnaire } : old
      );
    }
  });
}
