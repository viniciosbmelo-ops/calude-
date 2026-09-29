/**
 * DocRegen — Novo Caso
 * Chrome idêntico ao wizard cirúrgico (surgery/new.tsx):
 *   header, barra de progresso, step-tabs, Card, rodapé Anterior | Rascunho | Próximo
 *
 * 6 etapas:
 *   1. Dados Básicos   — paciente, data, lado, local, condição
 *   2. Anamnese        — 6 seções (inflamação, sono, nutrição, atividade, medicações, ortopédico)
 *   3. Exames Lab.     — analitos pré-definidos + campo livre
 *   4. Plano           — fatores de risco + objetivos terapêuticos
 *   5. Procedimento    — rascunho do protocolo (bloqueios, compliance preview)
 *   6. Relatório       — resumo + ativar caso
 */
import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useLocation, Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  ArrowLeft, ArrowRight, Save, BookmarkCheck, Loader2,
  User, Search, X, CheckCircle2, AlertCircle, AlertTriangle, Info,
  ChevronDown, ChevronUp, FlaskConical, Sparkles, Plus, Trash2, FileText,
} from "lucide-react";
import {
  evaluateCompliance,
  calcImc,
  patientAgeFromDob,
  prpComplianceProduct,
  type ComplianceFlag,
} from "@/lib/regen-compliance";
import { computeBioReadyScore, getBioReadyClinicalStatus, type BioReadyFactor, type FactorStatus } from "@/lib/regen-bioready";
import {
  getRegenPlanningPayload,
  removeProductFromPlanning,
} from "@/lib/regen-case-payload";
import { cn, formatCalendarDate, formatLocalDate, formatPersonName, sortByPtBrName, toCalendarDateKey } from "@/lib/utils";
import { REGEN_CONDITION_REGIONS, regenConditionLabel, regenConditionRegion } from "@/lib/regen-conditions";
import { useSubscriptionStatus } from "@/hooks/use-subscription-status";
import { SubscriptionGate } from "@/components/subscription-gate";
import OrientacoesInline from "@/components/OrientacoesInline";
import { RegenPreopFollowupCard } from "@/components/preop-followup-card";
import { useLanguage, useScopedTranslations } from "@/lib/i18n";
import { regenCoreMessages } from "@/locales/regen-core";
import { complianceFlagText } from "@/locales/regen-compliance";
import {
  APPLICATION_GUIDES,
  APPLICATION_SITE_LOCATIONS,
  emptyApplicationSite,
  parseApplicationSites,
  syncApplicationSites,
  type RegenApplicationSite,
} from "@/lib/regen-application-sites";

function authHdr() {
  return {
    "Content-Type": "application/json",
  };
}

/* ─── Constants ─────────────────────────────────────────────────────────────── */
const TOTAL_STEPS = 6;
const GOAL_OPTIONS = [
  "Redução de dor",
  "Melhora funcional",
  "Bioestimulação / regeneração tecidual",
  "Retardo de progressão da doença",
  "Suporte a reparo cirúrgico",
  "Retorno esportivo",
  "Manutenção do espaço articular",
  "Evitar ou postergar prótese",
];

type RegenCondition = {
  code: string;
  name: string;
};

const CONDITION_GROUPS = REGEN_CONDITION_REGIONS.map(id => ({ id }));

/* ── Sistemas comuns de processamento ── */
const SISTEMA_OPTIONS: string[] = [];

/* ── Procedimentos associados (multi-select) ── */
const ASSOC_PROCEDURES_OPTIONS = [
  "Bloqueio de Nervos Geniculares",
  "Rizotomia de Nervos Geniculares",
  "Terapia de Onda de Choque",
  "Laser de Alta Intensidade",
  "Proloterapia Intra-articular (25%)",
  "Proloterapia Peri-articular (12%)",
  "Acupuntura",
  "TENS / Eletroestimulação",
  "Artroscopia Diagnóstica",
];

const RIZOTOMIA_PROCEDURE = "Rizotomia de Nervos Geniculares";
const RIZOTOMIA_TYPES = ["Pulsada", "Ablativa", "Crioablação"] as const;
const RIZOTOMIA_DETAILS_KEY = "RIZOTOMIA_GENICULAR__tipos";

function readRizotomiaTypes(value: string | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

/* ── Detalhes técnicos por produto ── */
type FieldDef = { key: string; label: string; type?: "text" | "number" | "select" | "textarea" | "sistema_select"; options?: string[] };
const PRODUCT_FIELDS: Record<string, FieldDef[]> = {
  PRP: [
    { key: "sistema",        label: "Sistema utilizado",            type: "sistema_select" },
    { key: "centrifugacao",  label: "Centrifugação",                 type: "select", options: ["Centrifugação única", "Dupla centrifugação"] },
    { key: "volumeColetado", label: "Volume coletado (mL)",         type: "number" },
    { key: "concentracao",   label: "Concentração plaquetária (×10³/μL)", type: "number" },
    { key: "leucocito",      label: "Leucócitos",                   type: "select", options: ["Rico em leucócitos (LR-PRP)", "Pobre em leucócitos (LP-PRP)"] },
    { key: "volumeFinal",    label: "Volume final (mL)",            type: "number" },
  ],
  LP_PRP: [
    { key: "sistema",        label: "Sistema utilizado",            type: "sistema_select" },
    { key: "centrifugacao",  label: "Centrifugação",                 type: "select", options: ["Centrifugação única", "Dupla centrifugação"] },
    { key: "volumeColetado", label: "Volume coletado (mL)",         type: "number" },
    { key: "concentracao",   label: "Concentração plaquetária (×10³/μL)", type: "number" },
    { key: "volumeFinal",    label: "Volume final (mL)",            type: "number" },
  ],
  LR_PRP: [
    { key: "sistema",        label: "Sistema utilizado",            type: "sistema_select" },
    { key: "centrifugacao",  label: "Centrifugação",                 type: "select", options: ["Centrifugação única", "Dupla centrifugação"] },
    { key: "volumeColetado", label: "Volume coletado (mL)",         type: "number" },
    { key: "concentracao",   label: "Concentração plaquetária (×10³/μL)", type: "number" },
    { key: "volumeFinal",    label: "Volume final (mL)",            type: "number" },
  ],
  PRF: [
    { key: "sistema",        label: "Sistema de centrifugação",     type: "sistema_select" },
    { key: "protocolo",      label: "Protocolo",                    type: "select", options: ["Low Speed (L-PRF)", "High Speed (H-PRF)", "LSCC / A-PRF", "Sticky Bone", "Outro"] },
    { key: "tipoMembrana",   label: "Tipo de membrana",             type: "text"   },
    { key: "volumeSangue",   label: "Volume de sangue coletado (mL)", type: "number" },
  ],
  AH: [
    { key: "marca",          label: "Marca",                        type: "text"   },
    { key: "pesoMolecular",  label: "Peso molecular",               type: "select", options: ["Baixo peso molecular", "Médio peso molecular", "Alto peso molecular"] },
    { key: "reticulado",     label: "Reticulado?",                  type: "select", options: ["Não reticulado", "Reticulado"] },
    { key: "volume",         label: "Volume (mL)",                  type: "number" },
    { key: "lote",           label: "Nº de lote",                   type: "text"   },
  ],
  BMAC: [
    { key: "localColeta",    label: "Local da coleta",              type: "select", options: ["Crista ilíaca posterior", "Crista ilíaca anterior", "Fêmur distal", "Tíbia proximal"] },
    { key: "sistema",        label: "Sistema utilizado",            type: "sistema_select" },
    { key: "volumeAspirado", label: "Volume aspirado (mL)",         type: "number" },
    { key: "volumeConc",     label: "Volume concentrado (mL)",      type: "number" },
  ],
  MFAT: [
    { key: "sistema",        label: "Sistema utilizado",            type: "sistema_select" },
    { key: "quantidade",     label: "Quantidade de gordura (mL)",   type: "number" },
    { key: "processamento",  label: "Processamento",                type: "select", options: ["Lipogems", "Coleman clássico", "Filtração simples", "Outro"] },
  ],
  NANOFAT: [
    { key: "volumeColetado", label: "Volume de gordura coletado (mL)", type: "number" },
    { key: "volumeFinal",    label: "Volume final após emulsificação (mL)", type: "number" },
    { key: "viaAplicacao",   label: "Via de aplicação",             type: "text"   },
  ],
  SVF: [
    { key: "sistema",        label: "Sistema de isolamento",        type: "sistema_select" },
    { key: "volumeGordura",  label: "Volume de gordura processado (mL)", type: "number" },
    { key: "volumeFinal",    label: "Volume final (mL)",            type: "number" },
    { key: "viabilidade",    label: "Viabilidade celular estimada (%)", type: "number" },
  ],
  LISADO: [
    { key: "origem",         label: "Origem",                       type: "select", options: ["Autólogo", "Alogênico"] },
    { key: "concentracao",   label: "Concentração de proteínas",    type: "text"   },
    { key: "volume",         label: "Volume (mL)",                  type: "number" },
    { key: "lote",           label: "Nº de lote",                   type: "text"   },
  ],
  EXOSSOMO: [
    { key: "fabricante",     label: "Fabricante / origem",          type: "text"   },
    { key: "concentracao",   label: "Concentração (partículas/mL)", type: "text"   },
    { key: "volume",         label: "Volume (mL)",                  type: "number" },
    { key: "viaAplicacao",   label: "Via de aplicação",             type: "text"   },
  ],
  SUBCONDROPLASTIA: [
    { key: "produto",        label: "Produto injetado",             type: "select", options: ["Fosfato de cálcio (CaP)", "Ácido hialurônico", "Outro"] },
    { key: "volumeInjetado", label: "Volume injetado (mL)",         type: "number" },
    { key: "nivelTratado",   label: "Região / nível tratado",       type: "text"   },
  ],
  HIDROGEL: [
    { key: "produto",        label: "Produto / Marca",              type: "text"   },
    { key: "concentracao",   label: "Concentração",                 type: "text"   },
    { key: "volume",         label: "Volume (mL)",                  type: "number" },
    { key: "temperatura",    label: "Temperatura de aplicação",     type: "text"   },
  ],
  COLAGENO: [
    { key: "produto",        label: "Produto / Marca",              type: "text"   },
    { key: "tipo",           label: "Tipo de colágeno",             type: "text"   },
    { key: "volume",         label: "Volume / Quantidade",          type: "text"   },
  ],
  OUTRO: [
    { key: "descricao",      label: "Descrição do produto",         type: "textarea" },
    { key: "volume",         label: "Volume / Quantidade",          type: "text"   },
  ],
};

const LAB_ANALYTES: { analyte: string; unit: string; refMin: number | null; refMax: number | null; category: string }[] = [
  // Hematologia
  { category: "Hematologia", analyte: "Hemoglobina",   unit: "g/dL",    refMin: 12.0, refMax: 17.5 },
  { category: "Hematologia", analyte: "Plaquetas",     unit: "×10³/μL", refMin: 150,  refMax: 450  },
  { category: "Hematologia", analyte: "VHS",           unit: "mm/h",    refMin: 0,    refMax: 20   },
  // Inflamação
  { category: "Inflamação",  analyte: "PCR",           unit: "mg/L",    refMin: 0,    refMax: 5    },
  { category: "Inflamação",  analyte: "Fibrinogênio",  unit: "mg/dL",   refMin: 200,  refMax: 400  },
  // Metabolismo
  { category: "Metabolismo", analyte: "Glicemia jejum",unit: "mg/dL",   refMin: 70,   refMax: 99   },
  { category: "Metabolismo", analyte: "HbA1c",         unit: "%",       refMin: 4.0,  refMax: 5.7  },
  { category: "Metabolismo", analyte: "Vitamina D",    unit: "ng/mL",   refMin: 30,   refMax: 100  },
  { category: "Metabolismo", analyte: "Albumina",      unit: "g/dL",    refMin: 3.5,  refMax: 5.0  },
  // Coagulação
  { category: "Coagulação",  analyte: "INR",           unit: "",        refMin: 0.8,  refMax: 1.2  },
  { category: "Coagulação",  analyte: "TTPa",          unit: "s",       refMin: 25,   refMax: 35   },
  // Renal/Hepático
  { category: "Renal/Hep.",  analyte: "Creatinina",    unit: "mg/dL",   refMin: 0.6,  refMax: 1.2  },
  { category: "Renal/Hep.",  analyte: "TGO/AST",       unit: "U/L",     refMin: 5,    refMax: 40   },
];

type RegenMessageKey = keyof typeof regenCoreMessages["pt-BR"];

const GOAL_MESSAGE_KEYS: Record<string, RegenMessageKey> = {
  "Redução de dor": "goalPain",
  "Melhora funcional": "goalFunction",
  "Bioestimulação / regeneração tecidual": "goalRegeneration",
  "Retardo de progressão da doença": "goalSlowDisease",
  "Suporte a reparo cirúrgico": "goalSurgicalRepair",
  "Retorno esportivo": "goalSport",
  "Manutenção do espaço articular": "goalJointSpace",
  "Evitar ou postergar prótese": "goalAvoidProsthesis",
};

const REGION_MESSAGE_KEYS: Record<string, RegenMessageKey> = {
  joelho: "regionKnee", quadril: "regionHip", ombro: "regionShoulder", cotovelo: "regionElbow",
  pe_tornozelo: "regionFootAnkle", punho_mao: "regionWristHand", coluna_cervical: "regionCervical",
  coluna_toracica: "regionThoracic", coluna_lombar: "regionLumbar", outras: "regionOther",
};

const PRODUCT_MESSAGE_KEYS: Record<string, RegenMessageKey> = {
  PRP: "productPrp", LP_PRP: "productLpPrp", LR_PRP: "productLrPrp", PRF: "productPrf",
  AH: "productHa", COLAGENO: "productCollagen", BMAC: "productBmac", MFAT: "productMfat",
  NANOFAT: "productNanofat", SVF: "productSvf", LISADO: "productLysate", EXOSSOMO: "productExosome",
  SUBCONDROPLASTIA: "productSubchondroplasty", HIDROGEL: "productHydrogel", OUTRO: "productOther",
};

/** Explicit display translations; keys remain the persisted Portuguese values. */
const ES_DISPLAY_LABELS: Record<string, string> = {
  "Sistema utilizado": "Sistema utilizado", "Centrifugação": "Centrifugación",
  "Centrifugação única": "Centrifugación única", "Dupla centrifugação": "Doble centrifugación",
  "Volume coletado (mL)": "Volumen recolectado (mL)", "Concentração plaquetária (×10³/μL)": "Concentración plaquetaria (×10³/μL)",
  "Leucócitos": "Leucocitos", "Rico em leucócitos (LR-PRP)": "Rico en leucocitos (LR-PRP)",
  "Pobre em leucócitos (LP-PRP)": "Pobre en leucocitos (LP-PRP)", "Volume final (mL)": "Volumen final (mL)",
  "Sistema de centrifugação": "Sistema de centrifugación", "Tipo de membrana": "Tipo de membrana",
  "Volume de sangue coletado (mL)": "Volumen de sangre recolectado (mL)", "Marca": "Marca",
  "Peso molecular": "Peso molecular", "Baixo peso molecular": "Bajo peso molecular", "Médio peso molecular": "Peso molecular medio",
  "Alto peso molecular": "Alto peso molecular", "Reticulado?": "¿Reticulado?", "Não reticulado": "No reticulado",
  "Reticulado": "Reticulado", "Volume (mL)": "Volumen (mL)", "Nº de lote": "N.º de lote",
  "Local da coleta": "Lugar de recolección", "Crista ilíaca posterior": "Cresta ilíaca posterior",
  "Crista ilíaca anterior": "Cresta ilíaca anterior", "Fêmur distal": "Fémur distal", "Tíbia proximal": "Tibia proximal",
  "Volume aspirado (mL)": "Volumen aspirado (mL)", "Volume concentrado (mL)": "Volumen concentrado (mL)",
  "Quantidade de gordura (mL)": "Cantidad de grasa (mL)", "Processamento": "Procesamiento",
  "Coleman clássico": "Coleman clásico", "Filtração simples": "Filtración simple", "Outro": "Otro",
  "Volume de gordura coletado (mL)": "Volumen de grasa recolectado (mL)",
  "Volume final após emulsificação (mL)": "Volumen final tras la emulsificación (mL)", "Via de aplicação": "Vía de aplicación",
  "Sistema de isolamento": "Sistema de aislamiento", "Volume de gordura processado (mL)": "Volumen de grasa procesado (mL)",
  "Viabilidade celular estimada (%)": "Viabilidad celular estimada (%)", "Origem": "Origen",
  "Autólogo": "Autólogo", "Alogênico": "Alogénico", "Concentração de proteínas": "Concentración de proteínas",
  "Fabricante / origem": "Fabricante / origen", "Concentração (partículas/mL)": "Concentración (partículas/mL)",
  "Produto injetado": "Producto inyectado", "Fosfato de cálcio (CaP)": "Fosfato de calcio (CaP)",
  "Ácido hialurônico": "Ácido hialurónico", "Volume injetado (mL)": "Volumen inyectado (mL)",
  "Região / nível tratado": "Región / nivel tratado", "Produto / Marca": "Producto / Marca",
  "Concentração": "Concentración", "Temperatura de aplicação": "Temperatura de aplicación",
  "Tipo de colágeno": "Tipo de colágeno", "Volume / Quantidade": "Volumen / Cantidad",
  "Descrição do produto": "Descripción del producto", "Intra-articular": "Intraarticular",
  "Tecido periarticular": "Tejido periarticular",
  "Tendão patelar": "Tendón rotuliano",
  "Ligamento": "Ligamento",
  "Ultrassom": "Ecografía", "Fluoroscopia": "Fluoroscopia", "Artroscopia": "Artroscopia",
  "Referência anatômica (às cegas)": "Referencia anatómica (a ciegas)",
  "Bloqueio de Nervos Geniculares": "Bloqueo de nervios geniculares",
  "Rizotomia de Nervos Geniculares": "Rizotomía de nervios geniculares", "Terapia de Onda de Choque": "Terapia de ondas de choque",
  "Pulsada": "Pulsada", "Ablativa": "Ablativa", "Crioablação": "Crioablación",
  "Laser de Alta Intensidade": "Láser de alta intensidad", "Proloterapia Intra-articular (25%)": "Proloterapia intraarticular (25%)",
  "Proloterapia Peri-articular (12%)": "Proloterapia periarticular (12%)", "Acupuntura": "Acupuntura",
  "TENS / Eletroestimulação": "TENS / Electroestimulación", "Artroscopia Diagnóstica": "Artroscopia diagnóstica",
  "Hematologia": "Hematología", "Inflamação": "Inflamación", "Metabolismo": "Metabolismo",
  "Coagulação": "Coagulación", "Renal/Hep.": "Renal/Hep.", "Hemoglobina": "Hemoglobina",
  "Plaquetas": "Plaquetas", "Glicemia jejum": "Glucemia en ayunas", "Vitamina D": "Vitamina D",
  "Fibrinogênio": "Fibrinógeno", "Creatinina": "Creatinina", "Albumina": "Albúmina",
  "Direito": "Derecho", "Esquerdo": "Izquierdo", "Bilateral": "Bilateral",
  "Ácido Hialurônico": "Ácido hialurónico", "Fisioterapia": "Fisioterapia", "PRP prévio": "PRP previo",
  "Viscossuplementação": "Viscosuplementación", "Infiltração corticoide": "Infiltración de corticoide", "Cirurgia prévia": "Cirugía previa",
  "Ex: 10": "Ej.: 10", "Ex: 32.4": "Ej.: 32,4", "Ex: 98": "Ej.: 98", "Ex: 6.8": "Ej.: 6,8",
  "Ex: 2.8 (anormal > 2,5)": "Ej.: 2,8 (anormal > 2,5)", "Ex: Lúpus, AR…": "Ej.: lupus, AR…",
  "Ex: COVID-19 — 2 semanas atrás": "Ej.: COVID-19 — hace 2 semanas", "Ex: 7": "Ej.: 7", "Ex: 5": "Ej.: 5",
  "Ex: Whey, Creatina, Cúrcuma, Ômega-3…": "Ej.: whey, creatina, cúrcuma, omega-3…",
  "Ex: Caminhada": "Ej.: caminata", "Ex: 3×/semana": "Ej.: 3×/semana",
  "Ex: metformina, colchicina, losartana…": "Ej.: metformina, colchicina, losartán…",
};


const BIOREADY_FACTOR_ES: Record<string, { label: string; detail: string; recommendation: string }> = {
  contraindications: { label: "Contraindicaciones absolutas", detail: "Verifique la ausencia de infección activa y neoplasia.", recommendation: "Confirme la ausencia de contraindicaciones absolutas antes de continuar." },
  smoking: { label: "Tabaquismo", detail: "Estado de tabaquismo registrado.", recommendation: "Recomiende la abstinencia del tabaco antes del procedimiento." },
  glycemic: { label: "Control glucémico", detail: "Control glucémico evaluado.", recommendation: "Optimice el control glucémico antes del procedimiento." },
  bmi: { label: "IMC / Composición corporal", detail: "Composición corporal evaluada.", recommendation: "Optimice el peso para mejorar la respuesta al tratamiento." },
  activity: { label: "Actividad física", detail: "Nivel de actividad física evaluado.", recommendation: "Indique actividad aeróbica y fortalecimiento muscular antes del procedimiento." },
  sleep: { label: "Calidad del sueño", detail: "Calidad del sueño evaluada.", recommendation: "Optimice la higiene del sueño y evalúe la apnea." },
  inflammatory: { label: "Perfil inflamatorio sistémico", detail: "Perfil inflamatorio evaluado.", recommendation: "Oriente una dieta antiinflamatoria y el control metabólico." },
  medications: { label: "Medicamentos interferentes", detail: "Medicamentos interferentes evaluados.", recommendation: "Revise los medicamentos con el equipo tratante antes del procedimiento." },
  priorResponse: { label: "Antecedentes de tratamiento", detail: "Respuesta a tratamientos anteriores evaluada.", recommendation: "Revise la técnica y los factores sistémicos antes de un nuevo ciclo." },
  labs: { label: "Estudios de laboratorio", detail: "Perfil de laboratorio evaluado.", recommendation: "Normalice los valores alterados antes del procedimiento." },
};

/* ─── Small shared components ────────────────────────────────────────────────── */
function FlagBadge({ flag }: { flag: ComplianceFlag }) {
  const { locale } = useLanguage();
  const cfg = {
    block:   { bg: "bg-red-50 border-red-200",   icon: AlertCircle,   iconCls: "text-red-500",   txt: "text-red-700"   },
    warning: { bg: "bg-amber-50 border-amber-200",icon: AlertTriangle, iconCls: "text-amber-500", txt: "text-amber-700" },
    info:    { bg: "bg-sky-50 border-sky-200",   icon: Info,          iconCls: "text-sky-500",   txt: "text-sky-700"   },
  }[flag.severity];
  const Icon = cfg.icon;
  return (
    <div className={cn("flex items-start gap-2 rounded-lg px-3 py-2.5 border text-xs", cfg.bg)}>
      <Icon className={cn("h-3.5 w-3.5 shrink-0 mt-0.5", cfg.iconCls)} />
      <p className={cfg.txt}><span className="font-bold mr-1">[{flag.code}]</span>{complianceFlagText(locale, flag)}</p>
    </div>
  );
}

function ToggleChip({ label, value, onChange, danger }: {
  label: string; value: boolean; onChange: (v: boolean) => void; danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!value)}
      className={cn(
        "text-sm text-left px-3 py-2.5 rounded-xl border-2 transition-all flex items-center gap-2 font-medium",
        value
          ? danger
            ? "bg-red-50 border-red-300 text-red-700"
            : "bg-blue-50 border-blue-300 text-blue-700"
          : "bg-gray-50 border-gray-200 text-gray-500 hover:border-gray-300",
      )}
    >
      <div className={cn(
        "w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 transition-all",
        value
          ? danger ? "border-red-400 bg-red-400" : "border-blue-500 bg-blue-500"
          : "border-gray-300 bg-white",
      )}>
        {value && <CheckCircle2 className="h-3 w-3 text-white" />}
      </div>
      {label}
    </button>
  );
}

const STATUS_COLORS_NOVO: Record<BioReadyFactor["status"], { bg: string; border: string; text: string; dot: string }> = {
  green:  { bg: "#F0FDF4", border: "#86EFAC", text: "#15803D", dot: "#22C55E" },
  yellow: { bg: "#FFFBEB", border: "#FCD34D", text: "#92400E", dot: "#F59E0B" },
  red:    { bg: "#FEF2F2", border: "#FCA5A5", text: "#991B1B", dot: "#EF4444" },
  na:     { bg: "#F8FAFC", border: "#E2E8F0", text: "#64748B", dot: "#94A3B8" },
};
/**
 * Derives BioReadyInput from the wizard's live data and calls the canonical scorer.
 * Lab flag count is computed from LAB_ANALYTES reference ranges; platelet count is
 * extracted by name. HbA1c from the lab panel overrides anam.diabetesHba1c if present.
 */
function BioReadyPanel({
  anam, labValues, imc,
}: { anam: Record<string, any>; labValues: Record<string, string>; imc: number | null }) {
  const [showAll, setShowAll] = useState(false);
  const t = useScopedTranslations(regenCoreMessages);
  const { locale } = useLanguage();

  const result = useMemo(() => {
    // Identify labs that were entered
    const enteredAnalytes = LAB_ANALYTES.filter(a => labValues[a.analyte]?.trim());
    const hasAnyLab = enteredAnalytes.length > 0;

    // Count flagged analytes (outside reference range)
    const labFlagCount: number | undefined = hasAnyLab
      ? enteredAnalytes.filter(a => {
          const v = parseFloat(labValues[a.analyte]);
          if (isNaN(v) || a.refMin === null || a.refMax === null) return false;
          return v < a.refMin || v > a.refMax;
        }).length
      : undefined;

    // Platelet count from named analyte
    const platStr = labValues["Plaquetas"]?.trim();
    const platRaw = platStr ? parseFloat(platStr) : NaN;
    const plateletCount: number | null = !isNaN(platRaw) ? platRaw : null;

    // HbA1c from lab panel (preferred) or anamnese field
    const hba1cLab = parseFloat(labValues["HbA1c"] ?? "");
    const hba1c: number | null = !isNaN(hba1cLab)
      ? hba1cLab
      : anam.diabetesHba1c ? parseFloat(String(anam.diabetesHba1c)) : null;

    return computeBioReadyScore({
      // activeInfection and malignancy are NOT passed: the wizard has no dedicated UI to
      // confirm these safety-critical fields, so the contraindications factor returns 'na'
      // until the case is saved and explicitly reviewed. All other clinical fields
      // (dm, corticosteroids, anticoagulants, etc.) are derived from the anamnese by
      // normalizeAnam() inside the scorer — do NOT !! coerce them here, which would
      // convert undefined to false and silently inflate the score.
      hba1c: !isNaN(hba1cLab) ? hba1cLab : null,
      imc,
      anamnese: anam,
      labFlagCount,
      plateletCount,
    });
  }, [anam, labValues, imc]);

  const incomplete = result.isIncomplete;
  const headerColor = incomplete ? "#6B7280" : result.gradeColor;
  const clinicalStatus = getBioReadyClinicalStatus(result.grade);
  const clinicalLabel = locale === "es"
    ? ({ fit: "Apto", reassess: "Reevaluar", not_fit: "No apto" } as const)[clinicalStatus.status]
    : ({ fit: "Apto", reassess: "Reavaliar", not_fit: "Não apto" } as const)[clinicalStatus.status];

  return (
    <div className="space-y-3">
      {/* Header card */}
      <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 flex flex-wrap sm:flex-nowrap items-center gap-2"
          style={{ background: incomplete ? "#F9FAFB" : result.gradeBg }}>
          <FlaskConical className="h-4 w-4 shrink-0" style={{ color: headerColor }} />
          <p className="text-sm font-bold shrink-0" style={{ color: headerColor }}>BioReady Score®</p>
          <span className="hidden sm:inline-block ml-auto text-[10px] text-gray-400 truncate">{t("biologicReadiness")}</span>
          {incomplete && (
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-200 font-medium ml-auto sm:ml-1 shrink-0">
              {t("insufficientScoreData")}
            </span>
          )}
        </div>

        {incomplete ? (
          /* Not enough data — show guidance, not a grade */
          <div className="px-4 py-4 space-y-2">
            <div className="flex items-start gap-3 rounded-xl bg-amber-50 border border-amber-200 px-4 py-3">
              <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-semibold text-amber-800">{t("insufficientScoreData")}</p>
                <p className="text-[11px] text-amber-700 mt-0.5">
                  {t("scoreInsufficientHelp")}
                </p>
              </div>
            </div>
          </div>
        ) : (
          /* Sufficient data — show clinical status without a numeric score */
          <div className="px-4 py-4">
            <div
              className="flex items-center gap-3 rounded-xl border px-4 py-4"
              style={{ color: clinicalStatus.color, borderColor: clinicalStatus.border, background: clinicalStatus.background }}
            >
              <span className="h-4 w-4 shrink-0 rounded-full" style={{ background: clinicalStatus.color }} />
              <div className="flex-1">
                <p className="text-lg font-bold">{clinicalLabel}</p>
              </div>
              {result.dataCompleteness < 1 && (
                <p className="text-[10px] text-amber-600">
                  {t("factorsEvaluated", { percent: Math.round(result.dataCompleteness * 100) })}
                </p>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Top recommendations */}
      {result.topRecommendations.length > 0 && (
        <div className="rounded-xl border border-violet-200 bg-violet-50 overflow-hidden">
          <div className="px-4 py-2.5 border-b border-violet-100 flex items-center gap-2">
            <Sparkles className="h-3.5 w-3.5 text-violet-600" />
            <p className="text-xs font-semibold text-violet-700">{t("optimizationPlan")}</p>
            <span className="ml-auto text-[10px] text-violet-400">{t("decisionSupport")}</span>
          </div>
          <ul className="px-4 py-3 space-y-1.5">
            {(locale === "es"
              ? result.factors
                  .filter(f => (f.status === "red" || f.status === "yellow") && f.recommendation && f.modifiable)
                  .sort((a, b) => (b.maxScore - b.score) - (a.maxScore - a.score))
                  .slice(0, 3)
                  .map(f => BIOREADY_FACTOR_ES[f.id]?.recommendation ?? f.recommendation!)
              : result.topRecommendations).map((rec, i) => (
              <li key={i} className="flex items-start gap-2 text-xs text-violet-800">
                <span className="mt-0.5 shrink-0">→</span>
                <span>{rec}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Factor rows (expandable) */}
      <button
        type="button"
        className="w-full flex items-center justify-center gap-1.5 text-xs text-gray-500 hover:text-gray-700 py-1 transition-colors"
        onClick={() => setShowAll(v => !v)}
      >
        {showAll ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        {showAll ? t("hideFactorDetails") : t("showFactorDetails")}
      </button>

      {showAll && (
        <div className="space-y-1.5">
          {result.factors.map(f => {
            const sc = STATUS_COLORS_NOVO[f.status];
            return (
              <div key={f.id} className="flex items-start gap-2.5 px-3 py-2.5 rounded-xl border text-xs"
                style={{ background: sc.bg, borderColor: sc.border }}>
                <span className="h-2 w-2 rounded-full mt-1 shrink-0" style={{ background: sc.dot }} />
                <div className="flex-1 min-w-0">
                   <span className="font-semibold" style={{ color: sc.text }}>{locale === "es" ? (BIOREADY_FACTOR_ES[f.id]?.label ?? f.label) : f.label}</span>
                   {f.detail && <span className="ml-1.5 opacity-75" style={{ color: sc.text }}>— {locale === "es" ? (BIOREADY_FACTOR_ES[f.id]?.detail ?? f.detail) : f.detail}</span>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {!incomplete && result.factors.filter(f => f.status === "red" || f.status === "yellow").length === 0 && (
        <div className="rounded-xl bg-green-50 border border-green-200 px-4 py-3 text-xs text-green-700 font-medium text-center">
          <CheckCircle2 className="h-4 w-4 inline-block mr-1.5" /> {t("novoNoRiskFactors")}
        </div>
      )}
    </div>
  );
}

/* ─── Patient selector (reused from old novo.tsx) ────────────────────────────── */
function PatientSelector({
  patients, selectedId, onSelect,
}: { patients: any[]; selectedId: number | null; onSelect: (p: any | null) => void }) {
  const [query, setQuery] = useState("");
  const t = useScopedTranslations(regenCoreMessages);
  const { locale } = useLanguage();
  const [open, setOpen]   = useState(false);
  const wrapRef           = useRef<HTMLDivElement>(null);
  const selected          = patients.find(p => p.id === selectedId) ?? null;

  const filtered = useMemo(() => {
    const q = query.toLowerCase();
    return sortByPtBrName(
      patients.filter(p => !q || p.nome?.toLowerCase().includes(q)),
      (patient) => String(patient.nome ?? ""),
      (patient) => patient.id,
    ).slice(0, 20);
  }, [query, patients]);

  useEffect(() => {
    const h = (e: MouseEvent) => { if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  if (selected) {
    return (
      <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 flex items-start gap-3">
        <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center shrink-0">
          <User className="h-5 w-5 text-blue-600" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-gray-900 text-sm">{formatPersonName(selected.nome)}</p>
          <p className="text-xs text-gray-500 mt-0.5">
            {selected.data_nascimento ? t("bornAbbreviation", { date: formatCalendarDate(selected.data_nascimento, locale, undefined, selected.data_nascimento) }) : ""}
            {selected.sexo ? ` · ${selected.sexo === "M" ? t("masculine") : selected.sexo === "F" ? t("feminine") : selected.sexo}` : ""}
          </p>
        </div>
        <button type="button" onClick={() => { onSelect(null); setQuery(""); }}
          className="w-7 h-7 rounded-lg flex items-center justify-center text-gray-400 hover:text-gray-700 hover:bg-white shrink-0">
          <X className="h-4 w-4" />
        </button>
      </div>
    );
  }

  return (
    <div ref={wrapRef} className="relative">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
        <input
          value={query}
          onChange={e => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          placeholder={t("patientSearchPlaceholder")}
          className="w-full pl-9 pr-3 py-2.5 rounded-xl text-sm outline-none border border-gray-200 bg-white focus:border-blue-400 focus:ring-2 focus:ring-blue-50 placeholder-gray-400"
        />
      </div>
      {open && filtered.length > 0 && (
        <div className="absolute z-50 w-full mt-1 bg-white border border-gray-200 rounded-xl shadow-lg overflow-hidden max-h-60 overflow-y-auto">
          {filtered.map(p => (
            <button key={p.id} type="button"
              className="w-full text-left px-4 py-3 hover:bg-blue-50 flex items-center gap-3 border-b border-gray-100 last:border-0"
              onClick={() => { onSelect(p); setOpen(false); setQuery(""); }}>
              <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center shrink-0">
                <User className="h-4 w-4 text-gray-500" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium text-gray-900 truncate">{p.nome}</p>
                <p className="text-xs text-gray-500">{formatCalendarDate(p.data_nascimento, locale, undefined, p.data_nascimento ?? "")}{p.sexo ? ` · ${p.sexo === "M" ? t("masculineShort") : t("feminineShort")}` : ""}</p>
              </div>
            </button>
          ))}
        </div>
      )}
      {open && patients.length > 0 && filtered.length === 0 && (
        <div className="absolute z-50 w-full mt-1 bg-white border border-gray-200 rounded-xl shadow-lg px-4 py-3 text-sm text-gray-500">
          {t("patientNotFound")}
        </div>
      )}
    </div>
  );
}

/* ─── Collapsible section wrapper for anamnese ──────────────────────────────── */
function AnamSection({ title, children, defaultOpen = false }: {
  title: string; children: React.ReactNode; defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden">
      <button type="button" onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 hover:bg-gray-100 transition-colors text-left">
        <span className="text-sm font-semibold text-gray-700">{title}</span>
        {open ? <ChevronUp className="h-4 w-4 text-gray-400" /> : <ChevronDown className="h-4 w-4 text-gray-400" />}
      </button>
      {open && <div className="px-4 py-4 space-y-3 bg-white">{children}</div>}
    </div>
  );
}

/* ─── Main ───────────────────────────────────────────────────────────────────── */
export default function RegenNovo() {
  const t = useScopedTranslations(regenCoreMessages);
  const { locale } = useLanguage();
  const displayLabel = useCallback((value: string) => locale === "es" ? (ES_DISPLAY_LABELS[value] ?? value) : value, [locale]);
  const productLabel = useCallback((code: string) => {
    const key = PRODUCT_MESSAGE_KEYS[code];
    return key ? t(key) : code;
  }, [t]);
  const goalLabel = useCallback((goal: string) => {
    const key = GOAL_MESSAGE_KEYS[goal];
    return key ? t(key) : goal;
  }, [t]);
  const conditionLabel = useCallback((condition: RegenCondition) =>
    regenConditionLabel(condition.code, locale) || condition.name, [locale]);
  const [, navigate] = useLocation();
  const { canWrite, loading: subLoading } = useSubscriptionStatus();

  const [step, setStep]     = useState(0);
  const [saving, setSaving] = useState(false);
  const [caseId, setCaseId] = useState<string | null>(null);

  /* remote data */
  const [conditions, setConditions]   = useState<RegenCondition[]>([]);
  const [patients, setPatients]       = useState<any[]>([]);
  const [loadingBase, setLoadingBase] = useState(true);

  /* ── Step 1: Dados Básicos ── */
  const [selectedPatient, setSelectedPatient] = useState<any | null>(null);
  const [dataCaso,        setDataCaso]        = useState(() => formatLocalDate());
  const [lado,            setLado]            = useState("");
  const [hospital,        setHospital]        = useState("");
  const [weightKg,        setWeightKg]        = useState("");
  const [heightCm,        setHeightCm]        = useState("");
  const [patientPhone,    setPatientPhone]     = useState("");
  const [conditionCode,   setConditionCode]   = useState("");
  const [conditionCustom, setConditionCustom] = useState("");
  const [expandedConditionGroup, setExpandedConditionGroup] = useState<string | null>(null);
  const [regionDiagnoses, setRegionDiagnoses] = useState<Record<string, string>>({});

  const groupedConditions = useMemo(() => CONDITION_GROUPS.map(group => ({
    ...group,
    conditions: sortByPtBrName(
      conditions.filter(condition => regenConditionRegion(condition.code) === group.id),
      (condition) => conditionLabel(condition),
      (condition) => condition.code,
    ),
  })), [conditionLabel, conditions]);

  /* ── Step 2: Anamnese ── */
  const [anam, setAnam] = useState<Record<string, any>>({});
  const setA = useCallback((key: string, val: any) => setAnam(prev => ({ ...prev, [key]: val })), []);

  /* ── Step 3: Exames Lab ── */
  const [labValues, setLabValues] = useState<Record<string, string>>({}); // analyte -> value string
  const [labNotes,  setLabNotes]  = useState("");
  const [labFiles,  setLabFiles]  = useState<File[]>([]);

  /* ── Step 4: Plano ── */
  const [planoNotas,   setPlanoNotas]   = useState("");
  const [planoGerado,  setPlanoGerado]  = useState("");
  const [gerandoPlano, setGerandoPlano] = useState(false);

  /* ── Step 5: Procedimento (risk + objectives) ── */
  const [dm,               setDm]               = useState(false);
  const [hba1c,            setHba1c]            = useState("");
  const [anticoagulant,    setAnticoagulant]    = useState(false);
  const [immunosuppressed, setImmunosuppressed] = useState(false);
  // null = clinician has not yet confirmed; false = confirmed absent; true = confirmed present
  const [activeInfection,  setActiveInfection]  = useState<boolean | null>(null);
  const [malignancy,       setMalignancy]       = useState<boolean | null>(null);
  const [goalVev,          setGoalVev]          = useState<string[]>([]);
  const [goalCustom,       setGoalCustom]       = useState("");
  const [priorTreats,      setPriorTreats]      = useState<string[]>([]);
  const [priorTreatDates,  setPriorTreatDates]  = useState<Record<string, string>>({});
  const [plannedProducts,  setPlannedProducts]  = useState<string[]>([]);
  const [productDetails,   setProductDetails]   = useState<Record<string, string>>({});
  const [applicationSites, setApplicationSites] = useState<RegenApplicationSite[]>([emptyApplicationSite()]);
  // coMeds: medicamentos co-administrados junto ao produto biológico
  const [coMeds,           setCoMeds]           = useState<{ name: string; dose: string }[]>([]);
  const [newMedName,       setNewMedName]        = useState("");
  const [newMedDose,       setNewMedDose]        = useState("");
  // assocProcedures: outros procedimentos associados ao procedimento biológico
  const [assocProcedures,  setAssocProcedures]  = useState<string[]>([]);
  const rizotomiaTypes = useMemo(
    () => readRizotomiaTypes(productDetails[RIZOTOMIA_DETAILS_KEY]),
    [productDetails],
  );

  const toggleRizotomiaType = useCallback((type: string) => {
    setProductDetails((previous) => {
      const selected = readRizotomiaTypes(previous[RIZOTOMIA_DETAILS_KEY]);
      const next = selected.includes(type)
        ? selected.filter((item) => item !== type)
        : [...selected, type];
      const updated = { ...previous };
      if (next.length > 0) updated[RIZOTOMIA_DETAILS_KEY] = JSON.stringify(next);
      else delete updated[RIZOTOMIA_DETAILS_KEY];
      return updated;
    });
  }, []);

  // Keys in productDetails are prefixed: "${PRODUCT_CODE}__${fieldKey}"
  const setPDFor = useCallback((productCode: string, key: string, val: string) =>
    setProductDetails(prev => ({ ...prev, [`${productCode}__${key}`]: val })), []);

  const togglePlannedProduct = useCallback((productCode: string) => {
    if (!plannedProducts.includes(productCode)) {
      setPlannedProducts(prev => [...prev, productCode]);
      return;
    }

    const next = removeProductFromPlanning({
      plannedProducts,
      productDetails,
      coMeds,
    }, productCode);
    setPlannedProducts(next.plannedProducts);
    setProductDetails(next.productDetails);
    if (next.plannedProducts.length === 0) setApplicationSites([emptyApplicationSite()]);
    setCoMeds(next.coMeds);
  }, [plannedProducts, productDetails, coMeds]);

  /* ─── Load reference data + optional draft ─── */
  useEffect(() => {
    const draftId = new URLSearchParams(window.location.search).get("draft");
    Promise.all([
      fetch("/regen-api/regen/conditions", { credentials: "same-origin", headers: authHdr() }).then(r => r.json()).catch(() => []),
      fetch("/regen-api/patients",         { credentials: "same-origin", headers: authHdr() }).then(r => r.json()).catch(() => []),
      draftId
        ? fetch(`/regen-api/regen/cases/${draftId}`, { credentials: "same-origin", headers: authHdr() }).then(r => r.ok ? r.json() : null).catch(() => null)
        : Promise.resolve(null),
    ]).then(([conds, pats, draft]) => {
      setConditions(Array.isArray(conds) ? conds : []);
      const patsList = Array.isArray(pats) ? pats : [];
      setPatients(patsList);

      if (draft && draftId) {
        setCaseId(draftId);
        setDataCaso(toCalendarDateKey(draft.data_caso) ?? formatLocalDate());
        setLado(draft.lado_articulacao ?? "");
        setHospital(draft.hospital_local ?? "");
        setWeightKg(draft.weight_kg != null ? String(draft.weight_kg) : "");
        setHeightCm(draft.height_cm != null ? String(draft.height_cm) : "");
        setPatientPhone(draft.patient_phone ?? "");
        setConditionCode(draft.condition_code ?? "");
        setConditionCustom(draft.condition_custom ?? "");
        const savedAnamnese = draft.anamnese_regen ?? {};
        const { diagnosticosPorRegiao, ...anamnesisFields } = savedAnamnese;
        setAnam(anamnesisFields);
        setRegionDiagnoses(
          diagnosticosPorRegiao && typeof diagnosticosPorRegiao === "object"
            ? diagnosticosPorRegiao as Record<string, string>
            : {},
        );
        setDm(draft.dm ?? false);
        setHba1c(draft.hba1c != null ? String(draft.hba1c) : "");
        setAnticoagulant(draft.anticoagulant ?? false);
        setImmunosuppressed(draft.immunosuppressed ?? false);
        setActiveInfection(draft.active_infection ?? false);
        setMalignancy(draft.malignancy ?? false);
        setGoalVev(Array.isArray(draft.goal_vev) ? draft.goal_vev : []);
        setGoalCustom(draft.goal_custom ?? "");
        setPriorTreats(Array.isArray(draft.prior_treatments) ? draft.prior_treatments : []);
        if (draft.prior_treat_dates && typeof draft.prior_treat_dates === "object") setPriorTreatDates(draft.prior_treat_dates as Record<string, string>);
        if (Array.isArray(draft.planned_products) && draft.planned_products.length) setPlannedProducts(draft.planned_products);
        if (draft.product_details && typeof draft.product_details === "object") {
          const details = draft.product_details as Record<string, string>;
          const sites = parseApplicationSites(details);
          setProductDetails(details);
          setApplicationSites(sites.length > 0 ? sites : [emptyApplicationSite()]);
        }
        if (Array.isArray(draft.co_meds)) setCoMeds(draft.co_meds);
        if (Array.isArray(draft.assoc_procedures)) setAssocProcedures(draft.assoc_procedures);
        if (draft.plano_otimizacao) {
          setPlanoNotas(draft.plano_otimizacao.notas ?? "");
          setPlanoGerado(draft.plano_otimizacao.gerado ?? "");
        }
        // Restore patient object from patients list
        if (draft.patient_id) {
          const found = patsList.find((p: any) => p.id === draft.patient_id);
          if (found) setSelectedPatient(found);
        }
        // Jump to step from URL param if provided (e.g. returning from consent page)
        const stepParam = parseInt(new URLSearchParams(window.location.search).get("step") ?? "0", 10);
        setStep(isNaN(stepParam) ? 0 : stepParam);
      }
    }).finally(() => setLoadingBase(false));
  }, []);

  useEffect(() => {
    if (!caseId) return;
    const url = new URL(window.location.href);
    const stepValue = String(step);
    if (url.searchParams.get("draft") === caseId && url.searchParams.get("step") === stepValue) return;
    url.searchParams.set("draft", caseId);
    url.searchParams.set("step", stepValue);
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  }, [caseId, step]);

  /* ─── Derived ─── */
  const imc = useMemo(
    () => calcImc(parseFloat(weightKg) || null, parseFloat(heightCm) || null),
    [weightKg, heightCm],
  );

  const compCtx = useMemo(() => {
    const enteredAnalytes = LAB_ANALYTES.filter((analyte) => labValues[analyte.analyte]?.trim());
    const labFlagCount = enteredAnalytes.length > 0
      ? enteredAnalytes.filter((analyte) => {
          const value = parseFloat(labValues[analyte.analyte]);
          if (Number.isNaN(value)) return false;
          return (
            (analyte.refMin !== null && value < analyte.refMin) ||
            (analyte.refMax !== null && value > analyte.refMax)
          );
        }).length
      : undefined;
    const plateletValue = parseFloat(labValues.Plaquetas ?? "");
    const labHba1c = parseFloat(labValues.HbA1c ?? "");
    const caseHba1c = parseFloat(hba1c);
    return {
      // null means "not yet assessed" — no block until the clinician confirms it
      activeInfection: activeInfection ?? undefined,
      malignancy: malignancy ?? undefined,
      anticoagulant,
      immunosuppressed,
      dm,
      hba1c: Number.isNaN(labHba1c)
        ? (Number.isNaN(caseHba1c) ? null : caseHba1c)
        : labHba1c,
      imc,
      conditionCode,
      patientAge: patientAgeFromDob(selectedPatient?.data_nascimento),
      productCode: prpComplianceProduct(plannedProducts),
      plateletCount: Number.isNaN(plateletValue) ? null : plateletValue,
      labFlagCount,
    };
  }, [
    activeInfection,
    malignancy,
    anticoagulant,
    immunosuppressed,
    dm,
    hba1c,
    imc,
    conditionCode,
    selectedPatient?.data_nascimento,
    plannedProducts,
    labValues,
  ]);

  const compliance = useMemo(() => evaluateCompliance(compCtx, "planejamento"), [compCtx]);

  const step1Valid = selectedPatient !== null && conditionCode.length > 0;

  /* ─── Build payload ─── */
  function buildPayload(status: "draft" | "active") {
    const persistedProductDetails = syncApplicationSites(productDetails, applicationSites);
    const planningPayload = getRegenPlanningPayload({
      plannedProducts,
      productDetails: persistedProductDetails,
      coMeds,
      assocProcedures,
    });
    const savedRegionDiagnoses = Object.fromEntries(
      Object.entries(regionDiagnoses)
        .map(([regionId, diagnosis]) => [regionId, diagnosis.trim()])
        .filter(([, diagnosis]) => diagnosis.length > 0),
    );
    const anamneseRegen = {
      ...anam,
      ...(Object.keys(savedRegionDiagnoses).length > 0
        ? { diagnosticosPorRegiao: savedRegionDiagnoses }
        : {}),
    };

    return {
      patientId:    selectedPatient?.id ?? undefined,
      patientName:  selectedPatient?.nome,
      patientDob:   selectedPatient?.data_nascimento ?? undefined,
      patientSex:   selectedPatient?.sexo ?? undefined,
      patientPhone: patientPhone.trim() || selectedPatient?.telefone || undefined,
      weightKg:     parseFloat(weightKg)  || undefined,
      heightCm:     parseFloat(heightCm)  || undefined,
      conditionCode,
      conditionCustom: conditionCustom || undefined,
      ladoArticulacao: lado || undefined,
      hospitalLocal:   hospital.trim() || undefined,
      dataCaso: dataCaso || undefined,
      anamnese_regen: Object.keys(anamneseRegen).length ? anamneseRegen : undefined,
      planoOtimizacao: (planoNotas || planoGerado) ? { notas: planoNotas, gerado: planoGerado } : undefined,
      dm, hba1c: parseFloat(hba1c) || undefined,
      anticoagulant, immunosuppressed, activeInfection, malignancy,
      goalVev, goalCustom: goalCustom || undefined,
      priorTreatments: priorTreats,
      priorTreatDates: Object.keys(priorTreatDates).length ? priorTreatDates : undefined,
      ...planningPayload,
      status,
    };
  }

  const updateApplicationSites = useCallback((next: RegenApplicationSite[]) => {
    setApplicationSites(next);
    setProductDetails(previous => syncApplicationSites(previous, next));
  }, []);

  const addApplicationSite = useCallback(() => {
    updateApplicationSites([...applicationSites, emptyApplicationSite()]);
  }, [applicationSites, updateApplicationSites]);

  const removeApplicationSite = useCallback((index: number) => {
    updateApplicationSites(applicationSites.filter((_, siteIndex) => siteIndex !== index));
  }, [applicationSites, updateApplicationSites]);

  /* ─── Create or patch draft ─── */
  async function upsertDraft(status: "draft" | "active" = "draft") {
    const payload = buildPayload(status);
    if (caseId) {
      const res = await fetch(`/regen-api/regen/cases/${caseId}`, {
        method: "PATCH", credentials: "same-origin", headers: authHdr(), body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(await res.text());
      return caseId;
    } else {
      const res = await fetch("/regen-api/regen/cases", {
        method: "POST", credentials: "same-origin", headers: authHdr(), body: JSON.stringify(payload),
      });
      if (res.status === 403) { alert(t("acceptTermsCreate")); navigate("/regen"); return null; }
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setCaseId(data.id);
      return data.id as string;
    }
  }

  async function ensureCurrentRegenCase(): Promise<string> {
    const id = await upsertDraft("draft");
    if (!id) throw new Error(t("saveRegenCaseError"));
    return id;
  }

  /* ─── Save labs against a case_id ─── */
  async function saveLabs(id: string) {
    const results = LAB_ANALYTES
      .filter(a => labValues[a.analyte]?.trim())
      .map(a => {
        const v = parseFloat(labValues[a.analyte]);
        return {
          analyte: a.analyte,
          value:   v,           // API field: "value" (not "value_num")
          unit:    a.unit,
          refMin:  a.refMin,    // API field: "refMin" (not "ref_min")
          refMax:  a.refMax,    // API field: "refMax" (not "ref_max")
          flag: a.refMin !== null && a.refMax !== null
            ? v < a.refMin ? "L"
            : v > a.refMax ? "H" : "N"
            : undefined,
        };
      });
    if (!results.length) return;
    const res = await fetch(`/regen-api/regen/cases/${id}/labs`, {
      method: "POST",
      credentials: "same-origin",
      headers: authHdr(),
      body: JSON.stringify({ results }),  // API expects { results: [...] }
    });
    if (!res.ok) {
      console.error("[saveLabs]", id, await res.text().catch(() => String(res.status)));
    }
  }

  /* ─── Navigation handlers ─── */
  async function handleSaveDraft() {
    if (!step1Valid) return;
    setSaving(true);
    try {
      const id = await upsertDraft("draft");
      if (id && step >= 2) await saveLabs(id);
    } catch (e: any) { alert(t("saveError", { message: e.message })); }
    finally { setSaving(false); }
  }

  async function handleNext() {
    if (step === 0 && step1Valid) {
      // auto-create draft on leaving step 1
      setSaving(true);
      try { await upsertDraft("draft"); }
      catch (e: any) { alert(t("draftSaveError", { message: (e as any).message })); return; }
      finally { setSaving(false); }
    }
    if (step === 2 && caseId) {
      // save labs before leaving
      setSaving(true);
      try { await saveLabs(caseId); }
      finally { setSaving(false); }
    }
    setStep(s => Math.min(s + 1, TOTAL_STEPS - 1));
  }

  async function handleActivate() {
    if (!compliance.can_save) return;
    setSaving(true);
    try {
      const id = await upsertDraft("active");
      if (id) { await saveLabs(id); navigate(`/regen/caso/${id}`); }
    } catch (e: any) { alert(t("finishError", { message: e.message })); }
    finally { setSaving(false); }
  }

  /* ─── AI plan generation ─── */
  async function handleGerarPlano() {
    if (!caseId) { alert(t("saveBeforePlan")); return; }
    setGerandoPlano(true);
    try {
      const res = await fetch(`/regen-api/regen/cases/${caseId}/report`, { credentials: "same-origin", headers: authHdr() });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setPlanoGerado(data.report ?? "");
    } catch { setPlanoGerado(t("planGenerationError")); }
    finally { setGerandoPlano(false); }
  }

  if (!subLoading && !canWrite) return <SubscriptionGate />;

  /* ─── Render ─────────────────────────────────────────────────────────────── */
  return (
    <div className="p-4 md:p-8 max-w-4xl mx-auto space-y-6 w-full overflow-x-hidden sm:overflow-visible">

      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3 sm:gap-4">
          <Link href="/regen">
            <Button variant="outline" size="icon" className="shrink-0"><ArrowLeft className="h-4 w-4" /></Button>
          </Link>
          <div className="min-w-0">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
               <h1 className="min-w-0 text-2xl font-bold tracking-tight sm:text-3xl">{t("newRegenCase")}</h1>
              {caseId && (
                <span className="text-xs font-semibold bg-amber-100 text-amber-700 border border-amber-300 px-2 py-0.5 rounded-full">
                   {t("draftSaved")}
                </span>
              )}
            </div>
             <p className="text-muted-foreground text-sm">{[t("basicData"), t("history"), t("labTests"), t("therapeuticPlan"), t("procedure"), t("report")][step]}</p>
          </div>
        </div>
        <span className="shrink-0 text-sm font-medium text-muted-foreground bg-muted px-3 py-1 rounded-full">
          {step + 1} / {TOTAL_STEPS}
        </span>
      </div>

      {/* Progress bar */}
      <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
        <div className="h-full bg-primary transition-all duration-300"
          style={{ width: `${((step + 1) / TOTAL_STEPS) * 100}%` }} />
      </div>

      {/* Step tabs */}
      <div className="hidden md:flex gap-1">
         {[t("basicData"), t("history"), t("labTests"), t("therapeuticPlan"), t("procedure"), t("report")].map((title, i) => (
          <div key={i} className={cn(
            "flex-1 text-center text-xs py-1 rounded font-medium transition-colors",
            i === step ? "bg-primary text-primary-foreground" :
            i < step   ? "bg-primary/20 text-primary" :
                         "bg-muted text-muted-foreground",
          )}>{title}</div>
        ))}
      </div>

      {/* Card content */}
      <Card className="min-w-0 border shadow-sm">
        <CardContent className="p-4 sm:p-6">

          {/* ──── STEP 0: Dados Básicos ──── */}
          {step === 0 && (
            <div className="space-y-6">
               <h2 className="text-xl font-semibold">{t("basicData")}</h2>

              {/* Paciente */}
              <div className="space-y-2">
                <Label>{t("patient")} <span className="text-destructive">*</span></Label>
                {loadingBase ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground py-3">
                     <Loader2 className="h-4 w-4 animate-spin" /> {t("patientLoading")}
                  </div>
                ) : (
                  <PatientSelector patients={patients} selectedId={selectedPatient?.id ?? null} onSelect={setSelectedPatient} />
                )}
                {patients.length === 0 && !loadingBase && (
                  <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                     {t("noPatients")}
                  </p>
                )}
              </div>

              {/* Dados complementares */}
              {selectedPatient && (
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                     <Label>{t("weight")}</Label>
                    <div className="relative">
                      <Input type="number" value={weightKg} onChange={e => setWeightKg(e.target.value)} placeholder="70" className="pr-10" />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">kg</span>
                    </div>
                  </div>
                  <div className="space-y-2">
                     <Label>{t("height")}</Label>
                    <div className="relative">
                      <Input type="number" value={heightCm} onChange={e => setHeightCm(e.target.value)} placeholder="170" className="pr-10" />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">cm</span>
                    </div>
                  </div>
                  {/* WhatsApp: exibir apenas se o cadastro não tiver telefone */}
                  {!selectedPatient.telefone && (
                    <div className="space-y-2">
                       <Label>{t("patientWhatsapp")}</Label>
                      <Input type="tel" value={patientPhone} onChange={e => setPatientPhone(e.target.value)} placeholder="(11) 99999-9999" />
                    </div>
                  )}
                  {selectedPatient.telefone && (
                    <div className="flex items-center gap-2 rounded-lg px-3 py-2 bg-green-50 border border-green-100 text-xs text-green-700">
                       <span>WhatsApp: <strong>{selectedPatient.telefone}</strong> ({t("fromRegistration")})</span>
                    </div>
                  )}
                  {imc !== null && (
                    <div className="sm:col-span-2 flex items-center gap-2 rounded-lg px-3 py-2 bg-sky-50 border border-sky-100">
                      <Info className="h-3.5 w-3.5 shrink-0 text-sky-500" />
                      <p className="text-xs text-sky-700">
                         {t("calculatedBmi")} <strong>{imc} kg/m²</strong>
                         {imc >= 40 && <span className="ml-1 text-red-600"> — {t("classThreeObesity")}</span>}
                         {imc >= 30 && imc < 40 && <span className="ml-1 text-amber-600"> — {t("obesity")}</span>}
                      </p>
                    </div>
                  )}
                </div>
              )}

              {/* Data, Lado, Hospital */}
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                   <Label>{t("caseDate")}</Label>
                  <Input type="date" value={dataCaso} onChange={e => setDataCaso(e.target.value)} />
                </div>
                <div className="space-y-2">
                   <Label>{t("jointSide")}</Label>
                  <Select value={lado} onValueChange={setLado}>
                     <SelectTrigger><SelectValue placeholder={t("select")} /></SelectTrigger>
                    <SelectContent>
                       <SelectItem value="Direito">{t("right")}</SelectItem>
                       <SelectItem value="Esquerdo">{t("left")}</SelectItem>
                       <SelectItem value="Bilateral">{t("bilateral")}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2 sm:col-span-2">
                   <Label>{t("hospitalLocation")}</Label>
                   <Input value={hospital} onChange={e => setHospital(e.target.value)} placeholder={t("hospitalPlaceholder")} />
                </div>
              </div>

              {/* Condição clínica */}
              <div className="space-y-2">
                 <Label>{t("clinicalCondition")} <span className="text-destructive">*</span></Label>
                <p className="text-xs text-muted-foreground">
                   {t("clinicalConditionHelp")}
                </p>
                <div className="space-y-3 mt-2">
                  {groupedConditions.map(group => (
                    <section key={group.id} className="overflow-hidden rounded-xl border border-gray-200 bg-white">
                      <button
                        type="button"
                        className="flex w-full items-center justify-between gap-3 bg-gray-50 px-4 py-3 text-left"
                        onClick={() => setExpandedConditionGroup(current =>
                          current === group.id ? null : group.id,
                        )}
                        aria-expanded={expandedConditionGroup === group.id}
                      >
                        <h3 className="text-sm font-semibold text-gray-800">{t(REGION_MESSAGE_KEYS[group.id])}</h3>
                        <span className="flex items-center gap-2 text-xs text-muted-foreground">
                           {group.conditions.length} {group.conditions.length === 1 ? t("conditionSingular") : t("conditionPlural")}
                          {expandedConditionGroup === group.id
                            ? <ChevronUp className="h-4 w-4" />
                            : <ChevronDown className="h-4 w-4" />}
                        </span>
                      </button>
                      {expandedConditionGroup === group.id && (
                        <div className="space-y-3 border-t border-gray-200 p-3">
                          {group.conditions.length > 0 ? (
                            <div className="grid gap-2 sm:grid-cols-2">
                              {group.conditions.map(c => (
                                <button key={c.code} type="button"
                                  onClick={() => setConditionCode(c.code)}
                                  className={cn(
                                    "text-left px-4 py-3 rounded-xl border-2 transition-all text-sm font-medium flex items-center gap-2",
                                    conditionCode === c.code
                                      ? "bg-blue-50 border-blue-300 text-blue-700"
                                      : "bg-gray-50 border-gray-200 text-gray-700 hover:border-gray-300",
                                  )}>
                                  {conditionCode === c.code && <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-blue-500" />}
                                  {conditionLabel(c)}
                                </button>
                              ))}
                            </div>
                          ) : (
                            <p className="text-xs text-muted-foreground">
                               {t("noDiagnosisArea")}
                            </p>
                          )}
                          <div className="space-y-1.5">
                            <Label htmlFor={`diagnostico-${group.id}`}>
                               {t("diagnosisArea")}
                            </Label>
                            <Textarea
                              id={`diagnostico-${group.id}`}
                              value={regionDiagnoses[group.id] ?? ""}
                              onChange={event => setRegionDiagnoses(current => ({
                                ...current,
                                [group.id]: event.target.value,
                              }))}
                               placeholder={t("diagnosisAreaPlaceholder", { area: t(REGION_MESSAGE_KEYS[group.id]).toLocaleLowerCase(locale) })}
                              className="min-h-20 resize-y"
                            />
                          </div>
                        </div>
                      )}
                    </section>
                  ))}
                </div>
                {conditionCode === "CUSTOM" && (
                  <div className="space-y-1.5 mt-2">
                     <Label>{t("specifyCondition")}</Label>
                     <Input value={conditionCustom} onChange={e => setConditionCustom(e.target.value)} placeholder={t("conditionPlaceholder")} />
                  </div>
                )}
              </div>

            </div>
          )}

          {/* ──── STEP 1: Anamnese ──── */}
          {step === 1 && (
            <div className="space-y-4">
              <div>
                 <h2 className="text-xl font-semibold">{t("directedHistory")}</h2>
                <p className="text-sm text-muted-foreground mt-1">
                   {t("historyHelp")}
                </p>
              </div>

              {/* Inflamação Sistêmica */}
              <AnamSection title={t("systemicInflammation")} defaultOpen>
                <div className="grid grid-cols-2 gap-2">
                  <ToggleChip label={t("smoking")} value={!!anam.tabagismo} onChange={v => setA("tabagismo", v)} />
                  <ToggleChip label={t("frequentAlcohol")} value={!!anam.alcool} onChange={v => setA("alcool", v)} />
                  <ToggleChip label={t("bmiObesity")} value={!!anam.obesidade} onChange={v => setA("obesidade", v)} />
                  <ToggleChip label={t("diabetes")} value={!!anam.diabetes} onChange={v => setA("diabetes", v)} />
                  <ToggleChip label={t("insulinResistance")} value={!!anam.resistIns} onChange={v => setA("resistIns", v)} />
                  <ToggleChip label={t("autoimmuneDisease")} value={!!anam.autoimune} onChange={v => setA("autoimune", v)} />
                  <ToggleChip label={t("recentInfection")} value={!!anam.infeccaoRecente} onChange={v => setA("infeccaoRecente", v)} />
                </div>
                {anam.tabagismo && (
                  <div className="space-y-1 max-w-[48%]">
                    <Label className="text-xs">{t("cigarettesDay")}</Label>
                    <Input type="number" value={anam.cigsDay ?? ""} onChange={e => setA("cigsDay", e.target.value)} placeholder={displayLabel("Ex: 10")} />
                  </div>
                )}
                {anam.obesidade && (
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <Label className="text-xs">IMC (kg/m²)</Label>
                      <Input type="number" value={anam.obesidadeImc ?? ""} onChange={e => setA("obesidadeImc", e.target.value)} placeholder={displayLabel("Ex: 32.4")} />
                    </div>
                    <div className="space-y-1">
                       <Label className="text-xs">{t("abdominalCircumference")}</Label>
                      <Input type="number" value={anam.circAbdominal ?? ""} onChange={e => setA("circAbdominal", e.target.value)} placeholder={displayLabel("Ex: 98")} />
                    </div>
                  </div>
                )}
                {anam.diabetes && (
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                       <Label className="text-xs">{t("type")}</Label>
                      <Select value={anam.diabetesTipo ?? ""} onValueChange={v => setA("diabetesTipo", v)}>
                         <SelectTrigger><SelectValue placeholder={t("select")} /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="DM1">DM1</SelectItem>
                          <SelectItem value="DM2">DM2</SelectItem>
                           <SelectItem value="Pre-DM">{t("prediabetes")}</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">HbA1c (%)</Label>
                      <Input type="number" value={anam.diabetesHba1c ?? ""} onChange={e => setA("diabetesHba1c", e.target.value)} placeholder={displayLabel("Ex: 6.8")} />
                    </div>
                  </div>
                )}
                {anam.resistIns && (
                  <div className="space-y-1">
                     <Label className="text-xs">{t("availableHoma")}</Label>
                    <Input type="number" value={anam.homaIr ?? ""} onChange={e => setA("homaIr", e.target.value)} placeholder={displayLabel("Ex: 2.8 (anormal > 2,5)")} />
                  </div>
                )}
                {anam.autoimune && (
                  <div className="space-y-1">
                     <Label className="text-xs">{t("whichAutoimmune")}</Label>
                    <Input value={anam.autoimuneQual ?? ""} onChange={e => setA("autoimuneQual", e.target.value)} placeholder={displayLabel("Ex: Lúpus, AR…")} />
                  </div>
                )}
                {anam.infeccaoRecente && (
                  <div className="space-y-1">
                     <Label className="text-xs">{t("whichInfectionWhen")}</Label>
                    <Input value={anam.infeccaoQual ?? ""} onChange={e => setA("infeccaoQual", e.target.value)} placeholder={displayLabel("Ex: COVID-19 — 2 semanas atrás")} />
                  </div>
                )}
              </AnamSection>

              {/* Sono */}
              <AnamSection title={t("sleep")}>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                     <Label className="text-xs">{t("sleepHours")}</Label>
                    <Input type="number" value={anam.horasSono ?? ""} onChange={e => setA("horasSono", e.target.value)} placeholder={displayLabel("Ex: 7")} />
                  </div>
                  <div className="space-y-1">
                     <Label className="text-xs">{t("quality")}</Label>
                    <Select value={anam.qualidadeSono ?? ""} onValueChange={v => setA("qualidadeSono", v)}>
                       <SelectTrigger><SelectValue placeholder={t("select")} /></SelectTrigger>
                      <SelectContent>
                         <SelectItem value="boa">{t("good")}</SelectItem>
                         <SelectItem value="regular">{t("fair")}</SelectItem>
                         <SelectItem value="ruim">{t("poor")}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                   <ToggleChip label={t("sleepApnea")} value={!!anam.apneia} onChange={v => setA("apneia", v)} />
                   <ToggleChip label={t("cpapUse")} value={!!anam.cpap} onChange={v => setA("cpap", v)} />
                </div>
              </AnamSection>

              {/* Nutrição */}
              <AnamSection title={t("nutrition")}>
                <div className="space-y-1">
                   <Label className="text-xs">{t("proteinIntake")}</Label>
                  <Select value={anam.proteina ?? ""} onValueChange={v => setA("proteina", v)}>
                     <SelectTrigger><SelectValue placeholder={t("select")} /></SelectTrigger>
                    <SelectContent>
                       <SelectItem value="adequada">{t("adequate")}</SelectItem>
                       <SelectItem value="insuficiente">{t("insufficient")}</SelectItem>
                       <SelectItem value="excessiva">{t("excessive")}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-2 gap-2">
                   <ToggleChip label={t("highProcessedFood")} value={!!anam.ultraproc} onChange={v => setA("ultraproc", v)} />
                   <ToggleChip label={t("lowFruitVegetables")} value={!!anam.baixasFrutas} onChange={v => setA("baixasFrutas", v)} />
                </div>
                <div className="space-y-1">
                   <Label className="text-xs">{t("recentWeightLoss")}</Label>
                  <Input type="number" value={anam.perdaPeso ?? ""} onChange={e => setA("perdaPeso", e.target.value)} placeholder={displayLabel("Ex: 5")} />
                </div>
                <div className="space-y-2">
                   <ToggleChip label={t("supplementsUse")} value={!!anam.suplementos} onChange={v => setA("suplementos", v)} />
                  {anam.suplementos && (
                    <div className="space-y-1">
                       <Label className="text-xs">{t("whichSupplements")}</Label>
                      <Input value={anam.suplementosDetalhe ?? ""} onChange={e => setA("suplementosDetalhe", e.target.value)} placeholder={displayLabel("Ex: Whey, Creatina, Cúrcuma, Ômega-3…")} />
                    </div>
                  )}
                </div>
              </AnamSection>

              {/* Atividade Física */}
              <AnamSection title={t("physicalActivity")}>
                <div className="grid grid-cols-2 gap-2">
                   <ToggleChip label={t("sedentary")} value={!!anam.sedentario} onChange={v => setA("sedentario", v)} />
                   <ToggleChip label={t("occupationalOverload")} value={!!anam.sobreCarga} onChange={v => setA("sobreCarga", v)} />
                   <ToggleChip label={t("regularExercise")} value={!!anam.exercRegular} onChange={v => setA("exercRegular", v)} />
                </div>
                {anam.exercRegular && (
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                       <Label className="text-xs">{t("whichActivity")}</Label>
                      <Input value={anam.exercQual ?? ""} onChange={e => setA("exercQual", e.target.value)} placeholder={displayLabel("Ex: Caminhada")} />
                    </div>
                    <div className="space-y-1">
                       <Label className="text-xs">{t("frequencyField")}</Label>
                      <Input value={anam.exercFreq ?? ""} onChange={e => setA("exercFreq", e.target.value)} placeholder={displayLabel("Ex: 3×/semana")} />
                    </div>
                  </div>
                )}
              </AnamSection>

              {/* Medicações */}
              <AnamSection title={t("currentMedications")}>
                <div className="grid grid-cols-2 gap-2">
                   <ToggleChip label={t("corticosteroids")} value={!!anam.medicCorticoide} onChange={v => setA("medicCorticoide", v)} />
                   <ToggleChip label={t("nsaids")} value={!!anam.medicAines} onChange={v => setA("medicAines", v)} />
                   <ToggleChip label={t("statins")} value={!!anam.medicEstatinas} onChange={v => setA("medicEstatinas", v)} />
                   <ToggleChip label={t("anticoagulants")} value={!!anam.medicAnticoag} onChange={v => setA("medicAnticoag", v)} />
                   <ToggleChip label={t("immunosuppressants")} value={!!anam.medicImunosupr} onChange={v => setA("medicImunosupr", v)} />
                   <ToggleChip label={t("weightLossPens")} value={!!anam.glp1Agonistas} onChange={v => setA("glp1Agonistas", v)} />
                </div>
                {anam.medicCorticoide && (
                   <p className="text-[11px] text-amber-600">{t("corticosteroidWarning")}</p>
                )}
                {anam.medicAines && (
                   <p className="text-[11px] text-amber-600">{t("nsaidWarning")}</p>
                )}
                {anam.medicImunosupr && (
                   <p className="text-[11px] text-red-600">{t("biologicsWarning")}</p>
                )}
                {anam.glp1Agonistas && (
                  <div className="space-y-1">
                     <Label className="text-xs">{t("which")}</Label>
                    <div className="flex flex-wrap gap-2">
                      {["Semaglutida", "Tirzepatida", "Liraglutida"].map(drug => (
                        <button key={drug} type="button"
                          onClick={() => setA("glp1Qual", anam.glp1Qual === drug ? "" : drug)}
                          className={cn(
                            "px-3 py-1.5 rounded-lg border text-sm transition-all",
                            anam.glp1Qual === drug
                              ? "bg-blue-100 border-blue-400 text-blue-700 font-medium"
                              : "bg-gray-50 border-gray-200 text-gray-600 hover:border-blue-300",
                          )}>
                          {drug}
                        </button>
                      ))}
                    </div>
                     <p className="text-[11px] text-sky-600">{t("glp1Help")}</p>
                  </div>
                )}
                <div className="space-y-1">
                   <Label className="text-xs">{t("otherRelevantMeds")}</Label>
                  <Input value={anam.medicOutras ?? ""} onChange={e => setA("medicOutras", e.target.value)} placeholder={displayLabel("Ex: metformina, colchicina, losartana…")} />
                </div>
              </AnamSection>

              {/* Histórico Ortopédico */}
              <AnamSection title={t("orthopedicHistory")}>
                <div className="grid grid-cols-2 gap-2">
                   <ToggleChip label={t("priorSurgery")} value={!!anam.ciruPrev} onChange={v => setA("ciruPrev", v)} />
                   <ToggleChip label={t("priorInjection")} value={!!anam.infiltPrev} onChange={v => setA("infiltPrev", v)} />
                   <ToggleChip label={t("priorPrpHa")} value={!!anam.prpPrev} onChange={v => setA("prpPrev", v)} />
                </div>
                {anam.ciruPrev && (
                  <div className="space-y-1">
                     <Label className="text-xs">{t("whichSurgery")}</Label>
                     <Input value={anam.ciruQual ?? ""} onChange={e => setA("ciruQual", e.target.value)} placeholder={t("describe")} />
                  </div>
                )}
                {anam.infiltPrev && (
                  <div className="space-y-2">
                     <Label className="text-xs">{t("whichInjection")}</Label>
                    <div className="flex flex-wrap gap-2">
                      {["Corticoide", "Ácido Hialurônico"].map(tipo => {
                        const sel = (anam.infiltTipos ?? []).includes(tipo);
                        return (
                          <button key={tipo} type="button"
                            onClick={() => {
                              const prev: string[] = anam.infiltTipos ?? [];
                              setA("infiltTipos", sel ? prev.filter(x => x !== tipo) : [...prev, tipo]);
                            }}
                            className={cn(
                              "px-3 py-1.5 rounded-lg border text-sm transition-all",
                              sel
                                ? "bg-blue-100 border-blue-400 text-blue-700 font-medium"
                                : "bg-gray-50 border-gray-200 text-gray-600 hover:border-blue-300",
                            )}>
                             {displayLabel(tipo)}
                          </button>
                        );
                      })}
                    </div>
                    <div className="space-y-1">
                       <Label className="text-xs">{t("when")}</Label>
                      <select
                        value={anam.infiltData ?? ""}
                        onChange={e => setA("infiltData", e.target.value)}
                        className="w-full text-xs px-3 py-1.5 rounded-lg border border-blue-200 bg-blue-50 text-blue-700 focus:outline-none focus:ring-1 focus:ring-blue-400 appearance-none"
                      >
                         <option value="">{t("selectPeriod")}</option>
                         <option value="Há menos de 1 mês">{t("lessOneMonth")}</option>
                         <option value="Há 1–3 meses">{t("oneThreeMonths")}</option>
                         <option value="Há 3–6 meses">{t("threeSixMonths")}</option>
                         <option value="Há mais de 6 meses">{t("moreSixMonths")}</option>
                      </select>
                    </div>
                  </div>
                )}
                {anam.prpPrev && (
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                       <Label className="text-xs">{t("when")}</Label>
                      <select
                        value={anam.prpData ?? ""}
                        onChange={e => setA("prpData", e.target.value)}
                        className="w-full text-xs px-3 py-1.5 rounded-lg border border-blue-200 bg-blue-50 text-blue-700 focus:outline-none focus:ring-1 focus:ring-blue-400 appearance-none"
                      >
                         <option value="">{t("select")}</option>
                        <option value="Há menos de 1 mês">{t("shortLessOneMonth")}</option>
                        <option value="Há 1–3 meses">1–3 meses</option>
                        <option value="Há 3–6 meses">3–6 meses</option>
                        <option value="Há mais de 6 meses">{"> 6 meses"}</option>
                      </select>
                    </div>
                    <div className="space-y-1">
                       <Label className="text-xs">{t("response")}</Label>
                      <Select value={anam.prpResposta ?? ""} onValueChange={v => setA("prpResposta", v)}>
                         <SelectTrigger><SelectValue placeholder={t("select")} /></SelectTrigger>
                        <SelectContent>
                           <SelectItem value="boa">{t("good")}</SelectItem>
                           <SelectItem value="parcial">{t("partial")}</SelectItem>
                           <SelectItem value="sem">{t("noResponse")}</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                )}
              </AnamSection>


              {/* ── Objetivos terapêuticos ── */}
              <div className="space-y-2 pt-1">
                 <p className="text-sm font-semibold text-gray-700">{t("therapeuticGoals")}</p>
                <div className="grid sm:grid-cols-2 gap-2">
                  {GOAL_OPTIONS.map(g => {
                    const sel = goalVev.includes(g);
                    return (
                      <button key={g} type="button"
                        onClick={() => setGoalVev(prev => sel ? prev.filter(x => x !== g) : [...prev, g])}
                        className={cn(
                          "text-left px-4 py-2.5 rounded-xl border-2 transition-all text-sm flex items-center gap-2",
                          sel ? "bg-blue-50 border-blue-300 text-blue-700" : "bg-gray-50 border-gray-200 text-gray-600 hover:border-gray-300",
                        )}>
                        {sel && <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-blue-500" />}
                         {goalLabel(g)}
                      </button>
                    );
                  })}
                </div>
                <Textarea value={goalCustom} onChange={e => setGoalCustom(e.target.value)} rows={2}
                   placeholder={t("otherGoalsPlaceholder")} className="mt-2" />
              </div>
            </div>
          )}

          {/* ──── STEP 2: Exames Laboratoriais ──── */}
          {step === 2 && (
            <div className="space-y-5">
              <div>
                 <h2 className="text-xl font-semibold">{t("laboratoryTests")}</h2>
                <p className="text-sm text-muted-foreground mt-1">
                   {t("labHelp")}
                </p>
              </div>

              {(() => {
                const categories = [...new Set(LAB_ANALYTES.map(a => a.category))];
                return categories.map(cat => (
                  <div key={cat} className="space-y-2">
                     <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground border-b pb-1">{displayLabel(cat)}</p>
                    <div className="grid sm:grid-cols-2 gap-3">
                      {LAB_ANALYTES.filter(a => a.category === cat).map(a => {
                        const raw   = labValues[a.analyte] ?? "";
                        const num   = parseFloat(raw);
                        const isLow  = raw && !isNaN(num) && a.refMin !== null && num < a.refMin;
                        const isHigh = raw && !isNaN(num) && a.refMax !== null && num > a.refMax;
                        return (
                          <div key={a.analyte} className="space-y-1">
                            <div className="flex items-baseline justify-between">
                               <Label className="text-xs">{displayLabel(a.analyte)}{a.unit ? ` (${a.unit})` : ""}</Label>
                              {a.refMin !== null && (
                                <span className="text-[10px] text-muted-foreground">
                                   {t("referenceAbbreviation")} {a.refMin}–{a.refMax}
                                </span>
                              )}
                            </div>
                            <Input
                              type="number"
                              value={raw}
                              onChange={e => setLabValues(prev => ({ ...prev, [a.analyte]: e.target.value }))}
                              placeholder="—"
                              className={cn(
                                isLow  && "border-blue-400 bg-blue-50",
                                isHigh && "border-red-400 bg-red-50",
                              )}
                            />
                             {isLow  && <p className="text-[10px] text-blue-600">{t("belowReference")}</p>}
                             {isHigh && <p className="text-[10px] text-red-600">{t("aboveReference")}</p>}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ));
              })()}

              {/* ── Anexar resultado dos exames ── */}
              <div className="space-y-2 border border-dashed border-blue-200 rounded-xl p-4 bg-blue-50/40">
                <div className="flex items-center gap-2">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-blue-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828L18 9.828M7 17H5a2 2 0 01-2-2V5a2 2 0 012-2h10a2 2 0 012 2v2" />
                  </svg>
                   <Label className="text-sm font-medium text-blue-700">{t("labResultFile")}</Label>
                </div>
                 <p className="text-[11px] text-muted-foreground">{t("labFileHelp")}</p>
                <label className="flex items-center justify-center gap-2 cursor-pointer rounded-lg border border-blue-300 bg-white px-4 py-2.5 text-sm text-blue-600 hover:bg-blue-50 transition-colors w-full">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1M12 12V4m0 0L8 8m4-4l4 4" />
                  </svg>
                   {t("selectFile")}
                  <input
                    type="file"
                    accept="image/*,application/pdf"
                    multiple
                    className="hidden"
                    onChange={e => {
                      if (e.target.files) {
                        setLabFiles(prev => [...prev, ...Array.from(e.target.files!)]);
                      }
                    }}
                  />
                </label>
                {labFiles.length > 0 && (
                  <ul className="space-y-1 mt-1">
                    {labFiles.map((f, i) => (
                      <li key={i} className="flex items-center justify-between text-xs bg-white rounded-lg border border-blue-100 px-3 py-1.5">
                        <span className="truncate text-gray-700">{f.name}</span>
                        <button type="button" className="ml-2 text-red-400 hover:text-red-600 shrink-0"
                          onClick={() => setLabFiles(prev => prev.filter((_, j) => j !== i))}>✕</button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="space-y-2">
                 <Label>{t("labObservations")}</Label>
                <Textarea
                  value={labNotes}
                  onChange={e => setLabNotes(e.target.value)}
                  rows={3}
                   placeholder={t("labObservationsPlaceholder")}
                />
              </div>
            </div>
          )}

          {/* ──── STEP 3: Plano Terapêutico ──── */}
          {step === 3 && (
            <div className="space-y-6">
              <div>
                 <h2 className="text-xl font-semibold">{t("therapeuticPlan")}</h2>
                <p className="text-sm text-muted-foreground mt-1">
                   {t("therapeuticPlanHelp")}
                </p>
              </div>

              <RegenPreopFollowupCard
                caseId={caseId}
                baseDate={dataCaso}
                patientPhone={patientPhone || selectedPatient?.telefone || undefined}
                ensureCurrentCase={ensureCurrentRegenCase}
              />

              <BioReadyPanel anam={anam} labValues={labValues} imc={imc} />

              {/* ── Orientações Pré-Procedimento ── */}
              {(() => {
                const PROC_MAP_PLAN: Record<string, string> = {
                  PRP: "prp_articular", LP_PRP: "prp_articular", LR_PRP: "prp_articular",
                  AH: "prp_articular", COLAGENO: "prp_articular", HIDROGEL: "prp_articular", OUTRO: "prp_articular",
                  BMAC: "ctm_osso", MFAT: "ctm_osso", NANOFAT: "ctm_osso", SVF: "ctm_osso",
                  SUBCONDROPLASTIA: "ctm_osso",
                };
                const seen = new Set<string>();
                const base = plannedProducts.length > 0 ? plannedProducts : ["prp_articular"];
                const unique = base.filter(code => {
                  const key = PROC_MAP_PLAN[code] ?? code;
                  if (seen.has(key)) return false;
                  seen.add(key);
                  return true;
                });
                return (
                  <div className="space-y-2">
                     <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 px-1">{t("preProcedureOrientations")}</p>
                    {unique.map(code => (
                      <OrientacoesInline
                        key={code}
                        productCode={code}
                        patientPhone={patientPhone || selectedPatient?.telefone || undefined}
                        defaultTab="pre"
                        defaultOpen={true}
                      />
                    ))}
                  </div>
                );
              })()}

              <Textarea
                value={planoNotas}
                onChange={e => setPlanoNotas(e.target.value)}
                rows={3}
                 placeholder={t("doctorPreparationNotes")}
                className="text-xs"
              />

              {/* ── Consentimentos ── */}
              <div className="rounded-xl border border-purple-100 bg-purple-50/50 p-4 flex items-start justify-between gap-4">
                <div>
                   <p className="text-sm font-semibold text-purple-800 flex items-center gap-1.5"><FileText className="h-4 w-4" /> {t("consentTerms")}</p>
                   <p className="text-xs text-purple-600 mt-0.5">{t("consentTermsHelp")}</p>
                </div>
                <button
                  type="button"
                  onClick={() => navigate(caseId ? `/regen/consentimento?caseId=${caseId}&returnTo=${encodeURIComponent(`/regen/caso/novo?draft=${caseId}&step=3`)}` : `/regen/consentimento`)}
                  data-analytics-destination="/regen/consentimento"
                  className="shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold text-white bg-purple-600 hover:bg-purple-700 transition-colors"
                >
                   {t("openConsents")}
                </button>
              </div>
            </div>
          )}

          {/* ──── STEP 4: Procedimento ──── */}
          {step === 4 && (
            <div className="space-y-6">
              <div>
                 <h2 className="text-xl font-semibold">{t("procedurePlanning")}</h2>
                <p className="text-sm text-muted-foreground mt-1">
                   {t("procedurePlanningHelp")}
                </p>
              </div>

              {/* Compliance flags */}
              {compliance.flags.length > 0 && (
                <div className="space-y-2">{compliance.flags.map(f => <FlagBadge key={f.code} flag={f} />)}</div>
              )}

              {/* ─── Confirmação de Contraindicações Absolutas ────────────────────── */}
              <div className="space-y-3">
                <div>
                   <p className="text-sm font-semibold text-gray-700">{t("absoluteContraindicationsConfirmation")}</p>
                  <p className="text-xs text-gray-500 mt-0.5">
                     {t("contraindicationsConfirmationHelp")}
                  </p>
                </div>
                {(
                  [
                    {
                       label: t("activeInfection"),
                       desc: t("activeInfectionDescription"),
                      value: activeInfection,
                      set: setActiveInfection,
                    },
                    {
                       label: t("activeMalignancy"),
                       desc: t("activeMalignancyDescription"),
                      value: malignancy,
                      set: setMalignancy,
                    },
                  ] as const
                ).map(({ label, desc, value, set }) => (
                  <div
                    key={label}
                    className="flex items-center gap-3 rounded-xl border px-4 py-3"
                    style={{
                      background: value === true ? "#FEF2F2" : value === false ? "#F0FDF4" : "#FFFBEB",
                      borderColor: value === true ? "#FCA5A5" : value === false ? "#86EFAC" : "#FCD34D",
                    }}
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900">{label}</p>
                      <p className="text-[11px] text-gray-500">{desc}</p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => set(v => v === false ? null : false)}
                        className={cn(
                          "text-xs px-3 py-1.5 rounded-lg border font-medium transition-all",
                          value === false
                            ? "bg-green-500 border-green-500 text-white"
                            : "bg-white border-gray-200 text-gray-600 hover:border-green-300",
                        )}
                      >
                         {t("absent")}
                      </button>
                      <button
                        type="button"
                        onClick={() => set(v => v === true ? null : true)}
                        className={cn(
                          "text-xs px-3 py-1.5 rounded-lg border font-medium transition-all",
                          value === true
                            ? "bg-red-500 border-red-500 text-white"
                            : "bg-white border-gray-200 text-gray-600 hover:border-red-300",
                        )}
                      >
                         {t("present")}
                      </button>
                    </div>
                    {value === null && (
                       <span className="text-[10px] text-amber-600 font-medium ml-1 shrink-0">{t("notAssessed")}</span>
                    )}
                  </div>
                ))}
              </div>

              {/* Produto ortobiológico planejado — multi-select */}
              <div className="space-y-3">
                 <p className="text-sm font-semibold text-gray-700">{t("novoOrthobiologicProduct")}</p>
                 <p className="text-xs text-muted-foreground">{t("productSelectionHelp")}</p>
                <div className="grid sm:grid-cols-2 gap-2">
                   {Object.keys(PRODUCT_MESSAGE_KEYS).filter(code => code !== "COLAGENO").map(code => {
                    const selected = plannedProducts.includes(code);
                    return (
                      <button
                        key={code}
                        type="button"
                        onClick={() => togglePlannedProduct(code)}
                        className={cn(
                          "text-left px-4 py-3 rounded-xl border-2 transition-all text-sm flex items-center gap-2",
                          selected
                            ? "bg-blue-50 border-blue-400 text-blue-700 font-semibold"
                            : "bg-gray-50 border-gray-200 text-gray-600 hover:border-gray-300 hover:bg-white",
                        )}
                      >
                        {selected && <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-blue-500" />}
                         {productLabel(code)}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* ── Detalhes técnicos de cada produto selecionado ── */}
              {plannedProducts.map(productCode => {
                const fields = PRODUCT_FIELDS[productCode];
                if (!fields) return null;
                const pfx = (key: string) => `${productCode}__${key}`;
                return (
                  <div key={productCode} className="rounded-xl border border-blue-100 overflow-hidden">
                   <div className="space-y-3 p-3">
                    <p className="text-sm font-semibold text-blue-700">
                       {t("technicalDetails", { product: productLabel(productCode) })}
                    </p>
                    <div className="grid sm:grid-cols-2 gap-3">
                      {fields.map(f => (
                        <div key={f.key} className={cn("flex flex-col gap-1", f.type === "textarea" && "sm:col-span-2")}>
                           <label className="text-xs font-medium text-gray-600">{displayLabel(f.label)}</label>
                          {f.type === "select" ? (
                            <select
                              value={productDetails[pfx(f.key)] ?? ""}
                              onChange={e => setPDFor(productCode, f.key, e.target.value)}
                              className="text-sm px-3 py-2 rounded-lg border border-gray-200 bg-white text-gray-800 focus:outline-none focus:ring-1 focus:ring-blue-400"
                            >
                               <option value="">{t("selectDash")}</option>
                               {f.options!.map(o => <option key={o} value={o}>{displayLabel(o)}</option>)}
                            </select>
                          ) : f.type === "textarea" ? (
                            <textarea
                              rows={3}
                              value={productDetails[pfx(f.key)] ?? ""}
                              onChange={e => setPDFor(productCode, f.key, e.target.value)}
                              className="text-sm px-3 py-2 rounded-lg border border-gray-200 bg-white focus:outline-none focus:ring-1 focus:ring-blue-400 resize-none"
                            />
                          ) : f.type === "sistema_select" ? (
                            <div className="space-y-1.5">
                              <div className="flex flex-wrap gap-1.5">
                                {SISTEMA_OPTIONS.map(s => {
                                  const active = productDetails[pfx(f.key)] === s;
                                  return (
                                    <button
                                      key={s}
                                      type="button"
                                      onClick={() => setPDFor(productCode, f.key, active ? "" : s)}
                                      className={cn(
                                        "text-xs px-2.5 py-1 rounded-full border transition-all",
                                        active
                                          ? "bg-blue-600 border-blue-600 text-white"
                                          : "bg-white border-gray-300 text-gray-600 hover:border-blue-300",
                                      )}
                                    >
                                      {s}
                                    </button>
                                  );
                                })}
                              </div>
                              <input
                                type="text"
                                 placeholder={t("typeSystemPlaceholder")}
                                value={productDetails[pfx(f.key)] ?? ""}
                                onChange={e => setPDFor(productCode, f.key, e.target.value)}
                                className="w-full text-sm px-3 py-2 rounded-lg border border-gray-200 bg-white text-gray-800 focus:outline-none focus:ring-1 focus:ring-blue-400"
                              />
                            </div>
                          ) : (
                            <input
                              type={f.type ?? "text"}
                              value={productDetails[pfx(f.key)] ?? ""}
                              onChange={e => setPDFor(productCode, f.key, e.target.value)}
                              className="text-sm px-3 py-2 rounded-lg border border-gray-200 bg-white text-gray-800 focus:outline-none focus:ring-1 focus:ring-blue-400"
                            />
                          )}
                        </div>
                      ))}
                    </div>
                   </div>
                   {/* ── Orientações pré/pós-procedimento ── */}
                   <OrientacoesInline productCode={productCode} patientPhone={patientPhone || selectedPatient?.telefone || undefined} />
                  </div>
                );
              })}

               {/* Local de aplicação e notas ── */}
              {plannedProducts.length > 0 && (
                <div className="space-y-3 border-t border-gray-100 pt-2">
                   <p className="text-sm font-semibold text-gray-700">{t("applicationLocationNotes")}</p>
                   <p className="text-xs text-gray-500">{t("applicationSitesHelp")}</p>
                   {applicationSites.map((site, index) => (
                     <div key={index} className="rounded-xl border border-gray-200 bg-gray-50 p-3 space-y-3">
                       <div className="flex items-center justify-between gap-2">
                         <p className="text-xs font-semibold text-gray-600">{t("applicationSite", { count: index + 1 })}</p>
                         <button
                           type="button"
                           onClick={() => removeApplicationSite(index)}
                           aria-label={t("removeApplicationSite", { count: index + 1 })}
                           className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-red-600 hover:bg-red-50"
                         >
                           <Trash2 className="h-3.5 w-3.5" /> {t("removeApplicationSite", { count: index + 1 })}
                         </button>
                       </div>
                       <div className="grid gap-3 sm:grid-cols-2">
                         <div className="flex flex-col gap-1">
                           <label className="text-xs font-medium text-gray-600">{t("anatomicalCompartment")}</label>
                           <select
                             value={site.localAplicacao}
                             onChange={e => updateApplicationSites(applicationSites.map((current, siteIndex) =>
                               siteIndex === index ? { ...current, localAplicacao: e.target.value } : current,
                             ))}
                             className="text-sm px-3 py-2 rounded-lg border border-gray-200 bg-white focus:outline-none focus:ring-1 focus:ring-blue-400"
                           >
                             <option value="">{t("selectDash")}</option>
                             {APPLICATION_SITE_LOCATIONS.map(option => <option key={option} value={option}>{displayLabel(option)}</option>)}
                           </select>
                         </div>
                         <div className="flex flex-col gap-1">
                           <label className="text-xs font-medium text-gray-600">{t("applicationGuide")}</label>
                           <select
                             value={site.guia}
                             onChange={e => updateApplicationSites(applicationSites.map((current, siteIndex) =>
                               siteIndex === index ? { ...current, guia: e.target.value } : current,
                             ))}
                             className="text-sm px-3 py-2 rounded-lg border border-gray-200 bg-white focus:outline-none focus:ring-1 focus:ring-blue-400"
                           >
                             <option value="">{t("selectDash")}</option>
                             {APPLICATION_GUIDES.map(option => <option key={option} value={option}>{displayLabel(option)}</option>)}
                           </select>
                         </div>
                       </div>
                     </div>
                   ))}
                   <button
                     type="button"
                     onClick={addApplicationSite}
                     className="inline-flex min-h-10 items-center gap-1.5 rounded-xl border-2 border-dashed border-blue-200 bg-blue-50 px-3 py-2 text-sm font-medium text-blue-700 hover:bg-blue-100"
                   >
                     <Plus className="h-4 w-4" /> {t("addApplicationSite")}
                   </button>
                  <Textarea
                    value={productDetails["observacoes"] ?? ""}
                    onChange={e => setProductDetails(prev => ({ ...prev, observacoes: e.target.value }))}
                    rows={2}
                     placeholder={t("procedureObservationsPlaceholder")}
                    className="text-xs"
                  />
                </div>
              )}

              {/* ── Medicamentos co-administrados ── */}
              {plannedProducts.length > 0 && (
                <div className="space-y-3 border-t border-gray-100 pt-3">
                  <div>
                     <p className="text-sm font-semibold text-gray-700">{t("coadministeredMedications")}</p>
                     <p className="text-xs text-gray-500 mt-0.5">{t("coadministeredHelp")}</p>
                  </div>
                  {/* Add row */}
                  <div className="flex flex-col sm:flex-row gap-2 sm:items-end">
                    <div className="flex gap-2 w-full">
                      <div className="flex-1 flex flex-col gap-1 min-w-0">
                         <label className="text-xs font-medium text-gray-600">{t("medication")}</label>
                        <input
                          type="text"
                           placeholder={t("medicationPlaceholder")}
                          value={newMedName}
                          onChange={e => setNewMedName(e.target.value)}
                          className="w-full text-sm px-3 py-2 rounded-lg border border-gray-200 bg-white text-gray-800 focus:outline-none focus:ring-1 focus:ring-teal-400"
                        />
                      </div>
                      <div className="w-24 sm:w-40 shrink-0 flex flex-col gap-1">
                         <label className="text-xs font-medium text-gray-600">{t("dose")}</label>
                        <input
                          type="text"
                           placeholder={t("dosePlaceholder")}
                          value={newMedDose}
                          onChange={e => setNewMedDose(e.target.value)}
                          className="w-full text-sm px-3 py-2 rounded-lg border border-gray-200 bg-white text-gray-800 focus:outline-none focus:ring-1 focus:ring-teal-400"
                        />
                      </div>
                    </div>
                    <button
                      type="button"
                      disabled={!newMedName.trim()}
                      onClick={() => {
                        if (!newMedName.trim()) return;
                        setCoMeds(prev => [...prev, { name: newMedName.trim(), dose: newMedDose.trim() }]);
                        setNewMedName("");
                        setNewMedDose("");
                      }}
                      className="w-full sm:w-auto flex items-center justify-center gap-1 px-3 py-2 rounded-lg bg-teal-600 text-white text-sm font-medium hover:bg-teal-700 disabled:opacity-40 transition-colors shrink-0"
                    >
                       <Plus className="h-4 w-4 shrink-0" /> {t("add")}
                    </button>
                  </div>
                  {/* Medication list */}
                  {coMeds.length > 0 && (
                    <div className="space-y-1.5">
                      {coMeds.map((m, i) => (
                        <div key={i} className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-teal-50 border border-teal-200">
                          <span className="text-sm font-medium text-teal-800">{m.name}</span>
                          {m.dose && <span className="text-xs text-teal-600 font-mono bg-white border border-teal-200 rounded px-2 py-0.5">{m.dose}</span>}
                          <button
                            type="button"
                            onClick={() => setCoMeds(prev => prev.filter((_, idx) => idx !== i))}
                            className="text-red-400 hover:text-red-600 ml-auto transition-colors"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* ── Outros procedimentos associados ── */}
              <div className="space-y-3 border-t border-gray-100 pt-3">
                <div>
                   <p className="text-sm font-semibold text-gray-700">{t("otherAssociatedProcedures")}</p>
                   <p className="text-xs text-gray-500 mt-0.5">{t("associatedProceduresHelp")}</p>
                </div>
                <div className="grid sm:grid-cols-2 gap-2">
                  {ASSOC_PROCEDURES_OPTIONS.map(proc => {
                    const sel = assocProcedures.includes(proc);
                    return (
                      <button
                        key={proc}
                        type="button"
                        onClick={() => {
                          setAssocProcedures(prev =>
                            prev.includes(proc) ? prev.filter(p => p !== proc) : [...prev, proc]
                          );
                          if (proc === RIZOTOMIA_PROCEDURE && sel) {
                            setProductDetails((previous) => {
                              const updated = { ...previous };
                              delete updated[RIZOTOMIA_DETAILS_KEY];
                              return updated;
                            });
                          }
                        }}
                        className={cn(
                          "text-left px-3 py-2.5 rounded-xl border-2 transition-all text-sm flex items-center gap-2",
                          sel
                            ? "bg-purple-50 border-purple-400 text-purple-700 font-semibold"
                            : "bg-gray-50 border-gray-200 text-gray-600 hover:border-gray-300 hover:bg-white",
                        )}
                      >
                        {sel && <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-purple-500" />}
                         {displayLabel(proc)}
                      </button>
                    );
                  })}
                </div>
                {assocProcedures.includes(RIZOTOMIA_PROCEDURE) && (
                  <div className="rounded-xl border border-purple-200 bg-purple-50/60 p-3">
                    <p className="mb-2 text-xs font-semibold text-purple-800">
                      {locale === "es" ? "Tipo de rizotomía" : "Tipo de rizotomia"}
                    </p>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                      {RIZOTOMIA_TYPES.map((type) => {
                        const selected = rizotomiaTypes.includes(type);
                        return (
                          <button
                            key={type}
                            type="button"
                            onClick={() => toggleRizotomiaType(type)}
                            className={cn(
                              "flex min-h-10 items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-colors",
                              selected
                                ? "border-purple-500 bg-white font-semibold text-purple-800"
                                : "border-purple-200 bg-white/70 text-gray-600 hover:border-purple-400",
                            )}
                          >
                            <span className={cn(
                              "flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                              selected ? "border-purple-500 bg-purple-500 text-white" : "border-gray-300",
                            )}>
                              {selected && <CheckCircle2 className="h-3 w-3" />}
                            </span>
                            {displayLabel(type)}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

            </div>
          )}

          {/* ──── STEP 5: Relatório / Resumo ──── */}
          {step === 5 && (
            <div className="space-y-5">
               <h2 className="text-xl font-semibold">{t("caseSummary")}</h2>

              {/* Compliance block */}
              {!compliance.can_save && (
                <div className="rounded-xl p-3 flex items-start gap-2 bg-red-50 border border-red-200">
                  <AlertCircle className="h-4 w-4 shrink-0 mt-0.5 text-red-500" />
                   <p className="text-xs text-red-700">{t("absoluteContraindicationsWarning")}</p>
                </div>
              )}
              {compliance.flags.length > 0 && (
                <div className="space-y-2">{compliance.flags.map(f => <FlagBadge key={f.code} flag={f} />)}</div>
              )}

              {/* ── Identificação ── */}
              <div>
                 <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">{t("identification")}</p>
                <div className="rounded-xl border border-gray-200 overflow-hidden">
                  {([
                     [t("patient"), selectedPatient?.nome ?? "—"],
                     [t("condition"), conditions.find(c => c.code === conditionCode) ? conditionLabel(conditions.find(c => c.code === conditionCode)!) : conditionCode],
                     [t("side"), lado ? displayLabel(lado) : "—"],
                     [t("hospital"), hospital || "—"],
                     [t("date"), dataCaso || "—"],
                    ["IMC",        imc ? `${imc} kg/m²` : "—"],
                  ] as [string,string][]).map(([label, value], i) => (
                    <div key={label} className={cn(
                      "flex justify-between items-start gap-4 px-4 py-2.5 text-sm",
                      i % 2 === 0 ? "bg-white" : "bg-gray-50",
                    )}>
                      <span className="text-muted-foreground shrink-0">{label}</span>
                      <span className="font-medium text-gray-900 text-right break-words min-w-0">{value}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* ── Objetivos e tratamentos anteriores ── */}
              {(goalVev.length > 0 || priorTreats.length > 0) && (
                <div>
                   <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">{t("goalsHistory")}</p>
                  <div className="rounded-xl border border-gray-200 overflow-hidden">
                    {goalVev.length > 0 && (
                      <div className="px-4 py-2.5 text-sm bg-white">
                         <span className="text-muted-foreground">{t("goals")}</span>
                        <div className="flex flex-wrap gap-1.5 mt-1.5">
                           {goalVev.map(g => <span key={g} className="px-2 py-0.5 rounded-full text-xs bg-blue-50 border border-blue-200 text-blue-700">{goalLabel(g)}</span>)}
                        </div>
                      </div>
                    )}
                    {priorTreats.length > 0 && (
                      <div className="px-4 py-2.5 text-sm bg-gray-50">
                         <span className="text-muted-foreground">{t("previousTreatments")}</span>
                        <div className="flex flex-wrap gap-1.5 mt-1.5">
                          {priorTreats.map(t => (
                            <span key={t} className="px-2 py-0.5 rounded-full text-xs bg-gray-100 border border-gray-300 text-gray-700">
                               {displayLabel(t)}{priorTreatDates[t] ? ` (${priorTreatDates[t]})` : ""}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* ── Anamnese ── */}
              {Object.values(anam).some(Boolean) && (
                <div>
                   <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">{t("history")}</p>
                  <div className="rounded-xl border border-gray-200 overflow-hidden">
                    {([
                       [t("smoking"), anam.tabagismo ? t("yes") + (anam.tabagismoCigarrosDia ? ` — ${t("cigarettesPerDay", { count: anam.tabagismoCigarrosDia })}` : "") : null, "orange"],
                       [t("diabetes"), anam.diabetes ? t("yesType", { type: anam.diabetesTipo ?? t("typeNotInformed") }) : null, "red"],
                       [t("alcoholUse"), anam.alcool ? t("yes") : null, "amber"],
                       [t("autoimmuneDisease"), anam.autoimune ? t("yes") : null, "purple"],
                       [t("corticosteroids"), anam.medicCorticoide ? t("yes") : null, "red"],
                       [t("sedentary"), anam.sedentario ? t("yes") : null, "gray"],
                       [t("sleepDisorder"), anam.sonoDisturbio ? t("yes") : null, "indigo"],
                       [t("bmiObesity"), imc && parseFloat(String(imc)) >= 30 ? `IMC ${imc} kg/m²` : null, "orange"],
                       [displayLabel("Vitamina D"), anam.vitaminaDNivel ? anam.vitaminaDNivel : null, "yellow"],
                       [t("priorCorticosteroidInjection"), anam.infiltracaoCorticoide ? t("yes") : null, "red"],
                       [t("priorPrpHa"), anam.prpPrev ? t("yes") : null, "blue"],
                       ["GLP-1", anam.glp1 ? t("yes") : null, "green"],
                    ] as [string, string|null, string][]).filter(([,v]) => v).map(([label, value, color], i) => (
                      <div key={label} className={cn(
                        "flex justify-between items-start gap-4 px-4 py-2.5 text-sm",
                        i % 2 === 0 ? "bg-white" : "bg-gray-50",
                      )}>
                        <span className="text-muted-foreground shrink-0">{label}</span>
                        <span className={cn("font-medium text-right", `text-${color}-700`)}>{value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* ── Procedimento planejado ── */}
              {plannedProducts.length > 0 && (
                <div className="space-y-3">
                   <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">{t("plannedProcedure")}</p>
                  {/* Product list badges */}
                  <div className="flex flex-wrap gap-1.5">
                    {plannedProducts.map(code => (
                      <span key={code} className="text-xs px-2.5 py-1 rounded-full bg-blue-50 border border-blue-200 text-blue-700 font-medium">
                         {productLabel(code)}
                      </span>
                    ))}
                  </div>
                  {/* Details per product */}
                  {plannedProducts.map(code => {
                    const fields = (PRODUCT_FIELDS[code] ?? []).filter(f => productDetails[`${code}__${f.key}`]?.trim());
                    if (!fields.length) return null;
                    return (
                      <div key={code} className="rounded-xl border border-gray-200 overflow-hidden">
                         <div className="px-4 py-2 bg-blue-50 text-xs font-semibold text-blue-700">{productLabel(code)}</div>
                        {fields.map((f, i) => (
                          <div key={f.key} className={cn(
                            "flex justify-between items-start gap-4 px-4 py-2.5 text-sm",
                            i % 2 === 0 ? "bg-white" : "bg-gray-50",
                          )}>
                             <span className="text-muted-foreground shrink-0">{displayLabel(f.label)}</span>
                             <span className="font-medium text-gray-900 text-right">{displayLabel(productDetails[`${code}__${f.key}`])}</span>
                          </div>
                        ))}
                      </div>
                    );
                  })}
                   {/* Application locations + guides (legacy singular values are read by parseApplicationSites) */}
                   {(parseApplicationSites(productDetails).length > 0 || productDetails["observacoes"]) && (
                    <div className="rounded-xl border border-gray-200 overflow-hidden">
                       {parseApplicationSites(productDetails).map((site, index) => (
                         <div key={index} className={cn("space-y-1 px-4 py-2.5 text-sm", index % 2 === 0 ? "bg-white" : "bg-gray-50")}>
                           <span className="text-muted-foreground">{t("applicationSite", { count: index + 1 })}</span>
                           {site.localAplicacao && <div className="flex justify-between items-start gap-4"><span className="text-muted-foreground">{t("anatomicalLocation")}</span><span className="font-medium text-gray-900 text-right">{displayLabel(site.localAplicacao)}</span></div>}
                           {site.guia && <div className="flex justify-between items-start gap-4"><span className="text-muted-foreground">{t("applicationGuide")}</span><span className="font-medium text-gray-900 text-right">{displayLabel(site.guia)}</span></div>}
                         </div>
                       ))}
                       {productDetails["observacoes"] && (
                         <div className="flex justify-between items-start gap-4 px-4 py-2.5 text-sm bg-gray-50">
                           <span className="text-muted-foreground shrink-0">{t("observations")}</span>
                           <span className="font-medium text-gray-900 text-right whitespace-pre-wrap">{productDetails["observacoes"]}</span>
                         </div>
                       )}
                    </div>
                  )}
                  {/* Co-medications */}
                  {coMeds.length > 0 && (
                    <div className="rounded-xl border border-teal-200 overflow-hidden">
                       <div className="px-4 py-2 bg-teal-50 text-xs font-semibold text-teal-700">{t("coadministeredMedications")}</div>
                      {coMeds.map((m, i) => (
                        <div key={i} className={cn(
                          "flex justify-between items-center gap-4 px-4 py-2.5 text-sm",
                          i % 2 === 0 ? "bg-white" : "bg-gray-50",
                        )}>
                          <span className="text-muted-foreground">{m.name}</span>
                          <span className="font-medium text-teal-700">{m.dose || "—"}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {/* Associated procedures */}
                  {assocProcedures.length > 0 && (
                    <div>
                       <p className="text-xs font-semibold text-gray-500 mb-1.5">{t("associatedProcedures")}</p>
                      <div className="flex flex-wrap gap-1.5">
                        {assocProcedures.map(p => (
                           <span key={p} className="text-xs px-2.5 py-1 rounded-full bg-purple-50 border border-purple-200 text-purple-700">{displayLabel(p)}</span>
                        ))}
                      </div>
                      {assocProcedures.includes(RIZOTOMIA_PROCEDURE) && rizotomiaTypes.length > 0 && (
                        <p className="mt-2 text-xs text-purple-700">
                          <span className="font-semibold">
                            {locale === "es" ? "Tipo de rizotomía:" : "Tipo de rizotomia:"}
                          </span>{" "}
                          {rizotomiaTypes.map(displayLabel).join(", ")}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}


              {/* ── Exames laboratoriais ── */}
              {Object.values(labValues).some(v => v?.trim()) && (
                <div>
                   <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">{t("laboratoryTests")}</p>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                    {LAB_ANALYTES.filter(a => labValues[a.analyte]?.trim()).map(a => {
                      const num = parseFloat(labValues[a.analyte]);
                      const isLow  = !isNaN(num) && a.refMin !== null && num < a.refMin;
                      const isHigh = !isNaN(num) && a.refMax !== null && num > a.refMax;
                      return (
                        <div key={a.analyte} className={cn(
                          "text-xs px-2 py-1.5 rounded-lg border",
                          isLow  ? "bg-blue-50 border-blue-200 text-blue-700" :
                          isHigh ? "bg-red-50 border-red-200 text-red-700" :
                                   "bg-white border-gray-200 text-gray-700",
                        )}>
                           <span className="font-medium">{displayLabel(a.analyte)}:</span>{" "}
                          {labValues[a.analyte]} {a.unit}
                          {isLow && " ↓"}{isHigh && " ↑"}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* ── Alertas de compliance ── */}
              <div className="rounded-xl border border-gray-200 overflow-hidden">
                <div className={cn(
                  "flex justify-between items-start gap-4 px-4 py-2.5 text-sm",
                  compliance.flags.length > 0 ? "bg-orange-50" : "bg-green-50",
                )}>
                   <span className="text-muted-foreground">{t("clinicalAlerts")}</span>
                  <span className={cn("font-medium", compliance.flags.length > 0 ? "text-orange-700" : "text-green-700")}>
                     {compliance.flags.length === 0 ? t("none") : t((compliance.flags.length) === 1 ? "alertCountOne" : "alertCount", { count: compliance.flags.length })}
                  </span>
                </div>
              </div>

              {planoNotas?.trim() && (
                <div className="rounded-xl bg-blue-50 border border-blue-200 p-4">
                   <p className="text-xs font-semibold uppercase tracking-wide text-blue-600 mb-1">{t("therapeuticPlanNotes")}</p>
                  <p className="text-sm text-blue-900 whitespace-pre-wrap">{planoNotas}</p>
                </div>
              )}
            </div>
          )}

        </CardContent>
      </Card>

      {/* Navigation footer */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
        <Button variant="outline" onClick={() => setStep(s => Math.max(s - 1, 0))} disabled={step === 0} className="w-full gap-2 sm:w-auto">
          <ArrowLeft className="h-4 w-4" /> {t("previous")}
        </Button>

        <div className="grid w-full gap-2 sm:flex sm:w-auto sm:items-center">
          <Button
            type="button"
            variant="outline"
            onClick={handleSaveDraft}
            disabled={saving || !step1Valid}
            className="w-full gap-2 border-amber-300 text-amber-700 hover:bg-amber-50 sm:w-auto"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <BookmarkCheck className="h-4 w-4" />}
            {saving ? t("saving") : caseId ? t("updatingDraft") : t("savingDraft")}
          </Button>

          {step < TOTAL_STEPS - 1 ? (
            <Button onClick={handleNext} disabled={step === 0 && !step1Valid || saving} className="w-full gap-2 sm:w-auto">
              {t("next")} <ArrowRight className="h-4 w-4" />
            </Button>
          ) : (
            <Button onClick={handleActivate} disabled={saving || !compliance.can_save} className="w-full gap-2 sm:w-auto">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {t("saveCase")}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
