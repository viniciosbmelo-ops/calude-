/**
 * DocRegen — Detalhe do Caso
 * Tabs: Visão Geral | Procedimentos | PROMs
 * Tema claro — igual ao Dashboard principal
 */
import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useParams, useLocation } from "wouter";
import {
  ArrowLeft, Plus, AlertCircle, AlertTriangle, Info,
  CheckCircle2, Loader2, Activity, ClipboardList,
  User, ChevronDown, ChevronUp, Save, FlaskConical, Trash2,
  TrendingUp, TrendingDown, Minus, Brain, Sparkles, FileText,
  BarChart2, RefreshCw, MessageCircle, Copy, Calendar, Clock,
  Send, CheckCheck, Pencil, LayoutList, X,
} from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import { cn, sortByPtBrName, toDisplayDate } from "@/lib/utils";
import OrientacoesInline from "@/components/OrientacoesInline";
import {
  evaluateCompliance,
  patientAgeFromDob,
  prpComplianceProduct,
  type ComplianceFlag,
} from "@/lib/regen-compliance";
import { computeBioReadyScore, getBioReadyClinicalStatus, type BioReadyResult, type BioReadyFactor, type FactorStatus } from "@/lib/regen-bioready";
import { sharePdfBlobOrDownload, handlePdfOpenClick } from "@/lib/pdf-share";
import { useLanguage, useScopedTranslations } from "@/lib/i18n";
import { regenCoreMessages } from "@/locales/regen-core";
import { complianceFlagText } from "@/locales/regen-compliance";
import { parseApplicationSites } from "@/lib/regen-application-sites";

type RegenMessageKey = keyof typeof regenCoreMessages["pt-BR"];
const REGEN_SOURCE_KEYS = Object.fromEntries(
  Object.entries(regenCoreMessages["pt-BR"]).map(([key, value]) => [value, key]),
) as Record<string, RegenMessageKey>;

/** Exact authored-copy lookup. Stored clinical values and user-entered text bypass it. */
function useCaseTranslations() {
  const t = useScopedTranslations(regenCoreMessages);
  return useCallback((source: string) => {
    const key = REGEN_SOURCE_KEYS[source];
    return key ? t(key) : source;
  }, [t]);
}

function authHeaders() {
  return { "Content-Type": "application/json" };
}

// ─── Types ────────────────────────────────────────────────────────────────────
interface RegenCase {
  id: string;
  patient_id?: number;
  patient_name: string;
  patient_dob?: string;
  patient_sex?: string;
  weight_kg?: number;
  height_cm?: number;
  imc?: number;
  condition_code: string;
  condition_custom?: string;
  dm: boolean;
  hba1c?: number;
  anticoagulant: boolean;
  immunosuppressed: boolean;
  /** null = not yet assessed; false = confirmed absent; true = confirmed present */
  active_infection: boolean | null;
  /** null = not yet assessed; false = confirmed absent; true = confirmed present */
  malignancy: boolean | null;
  goal_vev: string[];
  goal_custom?: string;
  status: string;
  created_at: string;
  procedure_count?: number;
  prior_treatments?: string[];
  patient_phone?: string;
  anamnese_regen?: Record<string, any>;
  planned_products?: string[];
  lado_articulacao?: string;
  hospital_local?: string;
  data_caso?: string;
  co_meds?: { name: string; dose: string }[];
  assoc_procedures?: string[];
  product_details?: Record<string, string>;
}

interface Procedure {
  id: string;
  product_code: string;
  guidance_mode: string;
  access_route?: string;
  local_anesthesia: boolean;
  anesthesia_agent?: string;
  adverse_event: boolean;
  adverse_event_desc?: string;
  notes?: string;
  performed_at: string;
  biologic_details?: Record<string, unknown>;
}

interface PromResponse {
  id: number;
  instrument: string;
  timepoint: string;
  score?: number;
  answered_at: string;
}

// ─── Compliance flag badge (tema claro) ───────────────────────────────────────
function FlagBadge({ flag }: { flag: ComplianceFlag }) {
  const { locale } = useLanguage();
  const cfg = {
    block:   { bg: "#FEF2F2", border: "#FECACA", icon: AlertCircle,  color: "#DC2626", textColor: "#991B1B" },
    warning: { bg: "#FFFBEB", border: "#FDE68A", icon: AlertTriangle, color: "#D97706", textColor: "#92400E" },
    info:    { bg: "#F0F9FF", border: "#BAE6FD", icon: Info,          color: "#0284C7", textColor: "#0C4A6E" },
  }[flag.severity];
  const Icon = cfg.icon;
  return (
    <div className="flex items-start gap-2 rounded-lg p-2.5" style={{ background: cfg.bg, border: `1px solid ${cfg.border}` }}>
      <Icon className="h-3.5 w-3.5 shrink-0 mt-0.5" style={{ color: cfg.color }} />
      <p className="text-xs leading-relaxed" style={{ color: cfg.textColor }}>
        <span className="font-bold mr-1" style={{ color: cfg.color }}>[{flag.code}]</span>{complianceFlagText(locale, flag)}
      </p>
    </div>
  );
}

// ─── Status badge (tema claro) ────────────────────────────────────────────────
function StatusBadge({ status }: { status: string }) {
  const t = useScopedTranslations(regenCoreMessages);
  const cfg: Record<string, { label: string; color: string; bg: string }> = {
    draft:  { label: t("statusDraft"), color: "#64748B", bg: "#F1F5F9" },
    active: { label: t("statusActive"), color: "#059669", bg: "#ECFDF5" },
    closed: { label: t("statusClosed"), color: "#2563EB", bg: "#EFF6FF" },
  };
  const c = cfg[status] ?? cfg.draft;
  return (
    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold" style={{ color: c.color, background: c.bg }}>
      {c.label}
    </span>
  );
}

// ─── Light input field ────────────────────────────────────────────────────────
function Field({ label, value, onChange, type = "text", placeholder = "", unit = "" }: any) {
  return (
    <div className="space-y-1">
      <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">{label}</label>
      <div className="relative">
        <input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
          className="w-full px-3 py-2 rounded-xl text-sm text-gray-800 placeholder-gray-400 outline-none border border-gray-200 bg-white focus:border-blue-400 focus:ring-2 focus:ring-blue-50" />
        {unit && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400">{unit}</span>}
      </div>
    </div>
  );
}

// ─── Lab panels catalog ───────────────────────────────────────────────────────
interface LabAnalyte { name: string; unit: string; refMin?: number; refMax?: number }
interface LabPanel { group: string; note?: string; analytes: LabAnalyte[] }

const LAB_PANELS: LabPanel[] = [
  {
    group: "Hemograma",
    note: "Importação manual · Sistema destaca alterações automaticamente",
    analytes: [
      { name: "Hemoglobina",  unit: "g/dL",      refMin: 12,   refMax: 17   },
      { name: "Hematócrito",  unit: "%",          refMin: 37,   refMax: 51   },
      { name: "Leucócitos",   unit: "×10³/μL",   refMin: 4,    refMax: 11   },
      { name: "Plaquetas",    unit: "×10³/μL",   refMin: 150,  refMax: 400  },
      { name: "VCM",          unit: "fL",         refMin: 80,   refMax: 100  },
      { name: "HCM",          unit: "pg",         refMin: 27,   refMax: 33   },
    ],
  },
  {
    group: "Inflamação",
    analytes: [
      { name: "PCR",    unit: "mg/L",  refMin: 0, refMax: 5   },
      { name: "PCR-us", unit: "mg/L",  refMin: 0, refMax: 1   },
      { name: "VHS",    unit: "mm/h",  refMin: 0, refMax: 20  },
    ],
  },
  {
    group: "Metabólico",
    analytes: [
      { name: "HbA1c",    unit: "%",        refMin: 4.0,  refMax: 5.6   },
      { name: "Glicemia", unit: "mg/dL",    refMin: 70,   refMax: 99    },
      { name: "Insulina", unit: "μUI/mL",   refMin: 2.6,  refMax: 24.9  },
      { name: "HOMA",     unit: "",          refMin: 0,    refMax: 2.7   },
    ],
  },
  {
    group: "Vitaminas",
    analytes: [
      { name: "Vitamina D", unit: "ng/mL",  refMin: 30,  refMax: 100  },
      { name: "B12",        unit: "pg/mL",  refMin: 200, refMax: 900  },
      { name: "Folato",     unit: "ng/mL",  refMin: 3.1, refMax: 20.5 },
      { name: "Ferritina",  unit: "ng/mL",  refMin: 10,  refMax: 300  },
      { name: "Magnésio",   unit: "mg/dL",  refMin: 1.7, refMax: 2.2  },
      { name: "Zinco",      unit: "μg/dL",  refMin: 60,  refMax: 120  },
      { name: "Albumina",   unit: "g/dL",   refMin: 3.5, refMax: 5.0  },
    ],
  },
  {
    group: "Hormonal",
    note: "Quando clinicamente indicados",
    analytes: [
      { name: "TSH",          unit: "μUI/mL", refMin: 0.4,  refMax: 4.0   },
      { name: "T4 livre",     unit: "ng/dL",  refMin: 0.8,  refMax: 1.8   },
      { name: "Testosterona", unit: "ng/dL",  refMin: 15,   refMax: 1000  },
      { name: "SHBG",         unit: "nmol/L", refMin: 10,   refMax: 144   },
      { name: "Estradiol",    unit: "pg/mL",  refMin: 0,    refMax: 400   },
      { name: "IGF-1",        unit: "ng/mL",  refMin: 50,   refMax: 350   },
      { name: "DHEA-S",       unit: "μg/dL",  refMin: 35,   refMax: 500   },
      { name: "Cortisol",     unit: "μg/dL",  refMin: 6,    refMax: 20    },
    ],
  },
];

interface LabResult {
  id: number;
  analyte: string;
  value_num: number | null;
  unit: string | null;
  ref_min: number | null;
  ref_max: number | null;
  flag: string | null;
  collected_at: string | null;
  created_at: string;
}

function labFlag(val: number | null, refMin?: number, refMax?: number): "H" | "L" | "N" | null {
  if (val === null || val === undefined) return null;
  if (refMin !== undefined && val < refMin) return "L";
  if (refMax !== undefined && val > refMax) return "H";
  return "N";
}

// ─── Labs Tab ─────────────────────────────────────────────────────────────────
function LabsTab({ caseId, labs, onRefresh }: { caseId: string; labs: LabResult[]; onRefresh: () => void }) {
  const t = useScopedTranslations(regenCoreMessages);
  const tr = useCaseTranslations();
  const [entry, setEntry] = useState<Record<string, string>>({});   // analyte → value string
  const [date, setDate]   = useState<Record<string, string>>({});   // analyte → date string
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [deleting, setDeleting] = useState<Record<number, boolean>>({});

  // Latest result per analyte (by created_at desc)
  const latestByAnalyte = useMemo(() => {
    const map: Record<string, LabResult[]> = {};
    for (const r of labs) {
      if (!map[r.analyte]) map[r.analyte] = [];
      map[r.analyte].push(r);
    }
    // sort each group descending by date
    for (const a of Object.keys(map)) {
      map[a].sort((x, y) => new Date(y.created_at).getTime() - new Date(x.created_at).getTime());
    }
    return map;
  }, [labs]);

  const handleSave = async (analyte: string, panel: LabPanel) => {
    const val = parseFloat(entry[analyte] ?? "");
    if (isNaN(val)) return alert(t("numericValueRequired"));
    const a = panel.analytes.find(x => x.name === analyte)!;
    const flag = labFlag(val, a.refMin, a.refMax);
    setSaving(s => ({ ...s, [analyte]: true }));
    try {
      const res = await fetch(`/regen-api/regen/cases/${caseId}/labs`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          results: [{
            analyte,
            value:       val,
            unit:        a.unit || null,
            refMin:      a.refMin ?? null,
            refMax:      a.refMax ?? null,
            flag:        flag ?? null,
            collectedAt: date[analyte] || null,
          }],
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      setEntry(e => ({ ...e, [analyte]: "" }));
      setDate(d => ({ ...d, [analyte]: "" }));
      onRefresh();
    } catch (e: any) {
      alert(t("errorWithMessage", { message: e.message }));
    } finally {
      setSaving(s => ({ ...s, [analyte]: false }));
    }
  };

  const handleDelete = async (id: number) => {
    setDeleting(d => ({ ...d, [id]: true }));
    try {
      await fetch(`/regen-api/regen/cases/${caseId}/labs/${id}`, {
        method: "DELETE",
        credentials: "same-origin",
      });
      onRefresh();
    } catch {
      // silent
    } finally {
      setDeleting(d => ({ ...d, [id]: false }));
    }
  };

  return (
    <div className="space-y-4">
      {LAB_PANELS.map(panel => (
        <div key={panel.group} className="rounded-xl bg-white border border-gray-200 shadow-sm overflow-hidden">
          {/* Panel header */}
          <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
            <FlaskConical className="h-4 w-4 text-blue-500 shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-bold text-gray-900">{tr(panel.group)}</p>
              {panel.note && <p className="text-xs text-gray-400 mt-0.5">{tr(panel.note)}</p>}
            </div>
          </div>

          {/* Analytes list */}
          <div className="divide-y divide-gray-50">
            {panel.analytes.map(a => {
              const rows = latestByAnalyte[a.name] ?? [];
              const latest = rows[0] ?? null;
              const entryVal = entry[a.name] ?? "";
              const flag = entryVal !== "" ? labFlag(parseFloat(entryVal), a.refMin, a.refMax) : null;

              return (
                <div key={a.name} className="px-4 py-3 space-y-2">
                  {/* Analyte name + existing results */}
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-semibold text-gray-700 min-w-0">{tr(a.name)}</p>
                    {latest && (
                      <LabValueBadge value={latest.value_num} flag={latest.flag} unit={a.unit} date={latest.collected_at} />
                    )}
                  </div>

                  {/* History rows (beyond latest) */}
                  {rows.length > 1 && (
                    <div className="space-y-1 pl-2 border-l-2 border-gray-100">
                      {rows.slice(1, 4).map(r => (
                        <div key={r.id} className="flex items-center justify-between gap-2">
                          <LabValueBadge value={r.value_num} flag={r.flag} unit={a.unit} date={r.collected_at} small />
                          <button onClick={() => handleDelete(r.id)} disabled={deleting[r.id]}
                            className="text-gray-300 hover:text-red-400 transition-colors">
                            {deleting[r.id] ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Entry row */}
                  <div className="flex items-center gap-2">
                    <div className="relative flex-1">
                      <input
                        type="number"
                        step="any"
                        value={entryVal}
                        onChange={e => setEntry(en => ({ ...en, [a.name]: e.target.value }))}
                        placeholder={`${t("newValue")}${a.unit ? ` (${a.unit})` : ""}`}
                        className={cn(
                          "w-full px-3 py-1.5 rounded-lg text-xs border outline-none bg-white transition-all",
                          flag === "H" ? "border-red-300 bg-red-50 focus:ring-2 focus:ring-red-100 text-red-700" :
                          flag === "L" ? "border-amber-300 bg-amber-50 focus:ring-2 focus:ring-amber-100 text-amber-700" :
                          flag === "N" ? "border-green-300 bg-green-50 focus:ring-2 focus:ring-green-100 text-green-700" :
                          "border-gray-200 focus:border-blue-400 focus:ring-2 focus:ring-blue-50 text-gray-800"
                        )}
                      />
                      {flag && (
                        <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs font-bold">
                          {flag === "H" ? <TrendingUp className="h-3 w-3 text-red-500" /> :
                           flag === "L" ? <TrendingDown className="h-3 w-3 text-amber-500" /> :
                           <Minus className="h-3 w-3 text-green-500" />}
                        </span>
                      )}
                    </div>
                    <input
                      type="date"
                      value={date[a.name] ?? ""}
                      onChange={e => setDate(d => ({ ...d, [a.name]: e.target.value }))}
                      className="px-2 py-1.5 rounded-lg text-xs border border-gray-200 bg-white text-gray-600 outline-none focus:border-blue-400 w-[110px] shrink-0"
                    />
                    <button
                      onClick={() => handleSave(a.name, panel)}
                      disabled={saving[a.name] || !entryVal}
                      className="px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 transition-colors shrink-0 flex items-center gap-1">
                      {saving[a.name] ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                    </button>
                    {latest && (
                      <button onClick={() => handleDelete(latest.id)} disabled={deleting[latest.id]}
                        className="px-2 py-1.5 rounded-lg border border-gray-200 text-gray-400 hover:text-red-400 hover:border-red-200 transition-colors shrink-0">
                        {deleting[latest.id] ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                      </button>
                    )}
                  </div>

                  {/* Ref range hint */}
                  {(a.refMin !== undefined || a.refMax !== undefined) && (
                    <p className="text-[10px] text-gray-400">
                      {t("referenceShort")} {a.refMin ?? "—"} – {a.refMax ?? "—"} {a.unit}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

function LabValueBadge({ value, flag, unit, date, small }: {
  value: number | null; flag: string | null; unit: string; date: string | null; small?: boolean;
}) {
  const { locale } = useLanguage();
  if (value === null) return null;
  const cfg =
    flag === "H" ? { bg: "#FEF2F2", color: "#DC2626", border: "#FECACA", Icon: TrendingUp  } :
    flag === "L" ? { bg: "#FFFBEB", color: "#D97706", border: "#FDE68A", Icon: TrendingDown } :
                   { bg: "#F0FDF4", color: "#16A34A", border: "#BBF7D0", Icon: Minus        };
  const { bg, color, border, Icon } = cfg;
  return (
    <div className={cn("flex items-center gap-1 rounded-lg px-2 py-0.5", small ? "text-[10px]" : "text-xs")}
      style={{ background: bg, border: `1px solid ${border}` }}>
      <Icon className={small ? "h-2.5 w-2.5" : "h-3 w-3"} style={{ color }} />
      <span className="font-bold" style={{ color }}>{value}</span>
      {unit && <span style={{ color, opacity: 0.7 }}>{unit}</span>}
      {date && <span className="text-gray-400 ml-1">{toDisplayDate(date).toLocaleDateString(locale)}</span>}
    </div>
  );
}

// ─── Product catalog ──────────────────────────────────────────────────────────
const PRODUCTS: Record<string, string> = {
  PRP:              "PRP — Plasma Rico em Plaquetas",
  LP_PRP:           "LP-PRP — Pobre em Leucócitos",
  LR_PRP:           "LR-PRP — Rico em Leucócitos",
  PRF:              "PRF — Fibrina Rica em Plaquetas",
  AH:               "Ácido Hialurônico",
  COLAGENO:         "Colágeno / Scaffold",
  BMAC:             "BMA — Medula Óssea Concentrada",
  MFAT:             "MFAT — Gordura Micro-Fragmentada",
  NANOFAT:          "Nanofat",
  SVF:              "SVF — Fração Vascular Estromal",
  LISADO:           "Lisado Plaquetário",
  EXOSSOMO:         "Exossomos",
  SUBCONDROPLASTIA: "Subcondroplastia",
  HIDROGEL:         "Hidrogel",
  OUTRO:            "Outro produto",
};

// ─── Biologic technical sheet fields ─────────────────────────────────────────
type FieldDef = {
  key: string; label: string;
  type: "text" | "number" | "select";
  options?: string[]; unit?: string; placeholder?: string;
};

const PRP_FIELDS: FieldDef[] = [
  { key: "sistemaUtilizado", label: "Sistema utilizado",  type: "text",   placeholder: "ex: Arthrex ACP, Biomet GPS…" },
  { key: "centrifugacao",    label: "Centrifugação",      type: "select", options: ["Centrifugação única", "Dupla centrifugação"] },
  { key: "volumeColetado",   label: "Volume coletado",    type: "number", unit: "mL" },
  { key: "concentracao",     label: "Concentração",       type: "text",   placeholder: "ex: 5×10⁸ plt/mL" },
  { key: "leucocito",        label: "Leucócito",          type: "select", options: ["Rico (LR-PRP)", "Pobre (LP-PRP)"] },
  { key: "volumeFinal",      label: "Volume final",       type: "number", unit: "mL" },
];

const BIOLOGIC_FIELDS: Record<string, FieldDef[]> = {
  PRP:    PRP_FIELDS,
  LP_PRP: PRP_FIELDS,
  LR_PRP: PRP_FIELDS,
  PRF: [
    { key: "sistemaUtilizado", label: "Sistema utilizado",          type: "text" },
    { key: "volumeColetado",   label: "Volume coletado",            type: "number", unit: "mL" },
    { key: "centrifugacao",    label: "Protocolo de centrifugação", type: "text", placeholder: "ex: 2700 rpm × 12 min" },
  ],
  BMAC: [
    { key: "localColeta",        label: "Local da coleta",      type: "select",
      options: ["Crista ilíaca anterior", "Crista ilíaca posterior", "Tíbia proximal", "Outro"] },
    { key: "sistemaUtilizado",   label: "Sistema utilizado",    type: "text" },
    { key: "volumeAspirado",     label: "Volume aspirado",      type: "number", unit: "mL" },
    { key: "volumeConcentrado",  label: "Volume concentrado",   type: "number", unit: "mL" },
  ],
  MFAT: [
    { key: "sistema",       label: "Sistema",        type: "text", placeholder: "ex: Lipogems, Mfat Kit" },
    { key: "quantidade",    label: "Quantidade",     type: "number", unit: "mL" },
    { key: "processamento", label: "Processamento",  type: "text", placeholder: "ex: lavagem + microfragmentação" },
  ],
  NANOFAT: [
    { key: "sistema",       label: "Sistema",       type: "text" },
    { key: "quantidade",    label: "Quantidade",    type: "number", unit: "mL" },
    { key: "processamento", label: "Processamento", type: "text" },
  ],
  AH: [
    { key: "marca",          label: "Marca",           type: "text", placeholder: "ex: Synvisc, Durolane, Monovisc…" },
    { key: "pesoMolecular",  label: "Peso molecular",  type: "select",
      options: ["Alto (>2.000 kDa)", "Médio (800–2.000 kDa)", "Baixo (<800 kDa)", "Reticulado / cross-linked"] },
    { key: "volumeAplicado", label: "Volume aplicado", type: "number", unit: "mL" },
  ],
  COLAGENO: [
    { key: "marca", label: "Marca", type: "text" },
    { key: "tipo",  label: "Tipo",  type: "text", placeholder: "ex: colágeno tipo I, scaffold bifásico" },
    { key: "volume", label: "Volume", type: "number", unit: "mL" },
  ],
  SVF: [
    { key: "sistemaUtilizado", label: "Sistema utilizado", type: "text" },
    { key: "volume",           label: "Volume final",      type: "number", unit: "mL" },
  ],
  EXOSSOMO: [
    { key: "origem",       label: "Origem / fabricante",  type: "text" },
    { key: "volume",       label: "Volume",               type: "number", unit: "mL" },
    { key: "concentracao", label: "Concentração",         type: "text", placeholder: "ex: 1×10¹⁰ partículas/mL" },
  ],
  LISADO: [
    { key: "sistemaUtilizado", label: "Sistema / fabricante", type: "text" },
    { key: "volume",           label: "Volume",               type: "number", unit: "mL" },
  ],
  SUBCONDROPLASTIA: [
    { key: "produto", label: "Produto",       type: "text", placeholder: "ex: AccuFill, Bone Substitute" },
    { key: "volume",  label: "Volume",        type: "number", unit: "mL" },
    { key: "local",   label: "Local (lesão)", type: "text" },
  ],
  HIDROGEL: [
    { key: "marca",  label: "Marca",         type: "text" },
    { key: "volume", label: "Volume injetado", type: "number", unit: "mL" },
  ],
  OUTRO: [
    { key: "descricao", label: "Descrição do produto", type: "text", placeholder: "Nome e categoria do produto" },
    { key: "volume",    label: "Volume",               type: "number", unit: "mL" },
  ],
};

// ─── Biologic details section ─────────────────────────────────────────────────
function BiologicDetailsSection({
  productCode, values, onChange,
}: {
  productCode: string;
  values: Record<string, string>;
  onChange: (key: string, val: string) => void;
}) {
  const t = useScopedTranslations(regenCoreMessages);
  const tr = useCaseTranslations();
  const fields = BIOLOGIC_FIELDS[productCode];
  if (!fields || fields.length === 0) return null;

  return (
    <div className="space-y-3 rounded-xl p-4 bg-blue-50/60 border border-blue-100">
      <p className="text-xs font-semibold uppercase tracking-wide text-blue-600 flex items-center gap-1.5">
        <FileText className="h-3.5 w-3.5" /> {t("technicalSheet", { product: tr(PRODUCTS[productCode]) })}
      </p>
      <div className="grid gap-3">
        {fields.map(f => (
          <div key={f.key} className="space-y-1">
            <label className="text-xs font-medium text-gray-600">
              {tr(f.label)}{f.unit ? ` (${f.unit})` : ""}
            </label>
            {f.type === "select" ? (
              <div className="flex flex-wrap gap-1.5">
                {f.options!.map(opt => (
                  <button key={opt} type="button" onClick={() => onChange(f.key, opt)}
                    className="px-2.5 py-1 rounded-lg border text-xs font-medium transition-all"
                    style={{
                      background:  values[f.key] === opt ? "#EFF6FF" : "#F9FAFB",
                      borderColor: values[f.key] === opt ? "#93C5FD" : "#E5E7EB",
                      color:       values[f.key] === opt ? "#1E40AF" : "#6B7280",
                    }}>
                    {tr(opt)}
                  </button>
                ))}
              </div>
            ) : (
              <input
                type={f.type === "number" ? "number" : "text"}
                value={values[f.key] ?? ""}
                placeholder={f.placeholder ? tr(f.placeholder) : ""}
                onChange={e => onChange(f.key, e.target.value)}
                className="w-full px-3 py-2 rounded-xl text-sm text-gray-800 placeholder-gray-400
                           outline-none border border-gray-200 bg-white focus:border-blue-400
                           focus:ring-2 focus:ring-blue-50"
              />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Prior treatments checklist ───────────────────────────────────────────────
const PRIOR_TREATMENT_ITEMS = [
  { key: "fisioterapia",       label: "Fisioterapia" },
  { key: "perda_peso",         label: "Perda de peso" },
  { key: "corticoide",         label: "Infiltração corticoide" },
  { key: "acido_hialuronico",  label: "Ácido hialurônico" },
  { key: "prp",                label: "PRP" },
  { key: "bmac",               label: "BMA" },
  { key: "mfat",               label: "MFAT" },
  { key: "radiofrequencia",    label: "Radiofrequência" },
  { key: "bloqueios",          label: "Bloqueios geniculares" },
  { key: "cirurgia_previa",    label: "Cirurgia prévia" },
];

function PriorTreatmentsSection({
  caseId, initial,
}: {
  caseId: string;
  initial: string[];
}) {
  const t = useScopedTranslations(regenCoreMessages);
  const tr = useCaseTranslations();
  const [selected, setSelected] = useState<string[]>(initial);
  const [saving, setSaving] = useState(false);

  const toggle = async (key: string) => {
    const next = selected.includes(key)
      ? selected.filter(k => k !== key)
      : [...selected, key];
    setSelected(next);
    setSaving(true);
    try {
      await fetch(`/regen-api/regen/cases/${caseId}`, {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ priorTreatments: next }),
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-xl p-4 space-y-3 bg-white border border-gray-200 shadow-sm">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">{t("previousTreatmentPlanning")}</p>
        {saving && <Loader2 className="h-3 w-3 animate-spin text-gray-400" />}
      </div>
      <div className="grid grid-cols-2 gap-2">
        {PRIOR_TREATMENT_ITEMS.map(item => {
          const checked = selected.includes(item.key);
          return (
            <button key={item.key} type="button" onClick={() => toggle(item.key)}
              className="flex items-center gap-2 px-3 py-2 rounded-lg border transition-all text-left"
              style={{
                background:  checked ? "#EFF6FF" : "#F9FAFB",
                borderColor: checked ? "#93C5FD" : "#E5E7EB",
              }}>
              <div className="w-4 h-4 rounded flex items-center justify-center shrink-0 border-2 transition-colors"
                style={{ background: checked ? "#2563EB" : "transparent", borderColor: checked ? "#2563EB" : "#D1D5DB" }}>
                {checked && <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 12 12">
                  <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>}
              </div>
              <span className="text-xs font-medium" style={{ color: checked ? "#1E40AF" : "#374151" }}>
                {tr(item.label)}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

const GUIDANCE_MODES = ["Ultrassom", "Fluoroscopia", "Artroscopia", "Ás cegas (palpação)", "Outro"];
const ACCESS_ROUTES  = ["Intra-articular", "Periarticular", "Intratendinoso", "Subcutâneo", "Intramuscular", "Intradérmico"];

// ─── Procedure Form (tema claro) ──────────────────────────────────────────────
function ProcedureForm({ caseId, onSaved }: { caseId: string; onSaved: () => void }) {
  const t = useScopedTranslations(regenCoreMessages);
  const tr = useCaseTranslations();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [productCode, setProductCode]           = useState("");
  const [guidanceMode, setGuidanceMode]         = useState("ultrassom");
  const [accessRoute, setAccessRoute]           = useState("");
  const [localAnesthesia, setLocalAnesthesia]   = useState(false);
  const [anesthesiaAgent, setAnesthesiaAgent]   = useState("");
  const [adverseEvent, setAdverseEvent]         = useState(false);
  const [adverseEventDesc, setAdverseEventDesc] = useState("");
  const [notes, setNotes]                       = useState("");
  const [biologicDetails, setBiologicDetails]   = useState<Record<string, string>>({});

  const handleBiologicChange = (key: string, val: string) => {
    setBiologicDetails(prev => ({ ...prev, [key]: val }));
  };

  const reset = () => {
    setProductCode(""); setGuidanceMode("ultrassom"); setAccessRoute("");
    setLocalAnesthesia(false); setAnesthesiaAgent("");
    setAdverseEvent(false); setAdverseEventDesc(""); setNotes("");
    setBiologicDetails({});
  };

  const handleSave = async () => {
    if (!productCode) return alert(t("selectOrthobiologic"));
    setSaving(true);
    try {
      const res = await fetch(`/regen-api/regen/cases/${caseId}/procedures`, {
        method: "POST",
        credentials: "same-origin",
        headers: authHeaders(),
        body: JSON.stringify({
          productCode, guidanceMode, accessRoute: accessRoute || undefined,
          localAnesthesia, anesthesiaAgent: anesthesiaAgent || undefined,
          adverseEvent, adverseEventDesc: adverseEventDesc || undefined,
          notes: notes || undefined,
          biologicDetails: Object.keys(biologicDetails).length > 0 ? biologicDetails : undefined,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      setOpen(false);
      reset();
      onSaved();
    } catch (e: any) {
      alert(t("procedureSaveError", { message: e.message }));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <button onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-4 py-3 rounded-xl border-2 border-dashed border-blue-200 text-blue-600 bg-blue-50 hover:bg-blue-100 transition-all">
        <div className="flex items-center gap-2">
          <Plus className="h-4 w-4" />
          <span className="text-sm font-semibold">{t("registerProcedure")}</span>
        </div>
        {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
      </button>

      {open && (
        <div className="mt-3 rounded-xl p-4 space-y-4 bg-white border border-gray-200 shadow-sm">
          {/* Product */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">{t("orthobiologicProduct")}</label>
            <div className="grid gap-1.5">
              {sortByPtBrName(
                Object.entries(PRODUCTS).filter(([code]) => code !== "COLAGENO"),
                ([, name]) => name,
                ([code]) => code,
              ).map(([code, name]) => (
                <button key={code} type="button" onClick={() => setProductCode(code)}
                  className="text-left px-3 py-2 rounded-lg border-2 transition-all text-sm font-medium"
                  style={{
                    background:  productCode === code ? "#EFF6FF" : "#F9FAFB",
                    borderColor: productCode === code ? "#93C5FD" : "#E5E7EB",
                    color:       productCode === code ? "#1E40AF" : "#374151",
                  }}>
                  {productCode === code && <CheckCircle2 className="inline h-3 w-3 mr-1.5 text-blue-500" />}
                   {tr(name)}
                </button>
              ))}
            </div>
          </div>

          {/* Guidance mode */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">{t("imageGuidance")}</label>
            <div className="flex flex-wrap gap-1.5">
              {GUIDANCE_MODES.map(m => (
                <button key={m} type="button" onClick={() => setGuidanceMode(m.toLowerCase())}
                  className="px-3 py-1.5 rounded-lg border-2 text-xs font-medium transition-all"
                  style={{
                    background:  guidanceMode === m.toLowerCase() ? "#EFF6FF" : "#F9FAFB",
                    borderColor: guidanceMode === m.toLowerCase() ? "#93C5FD" : "#E5E7EB",
                    color:       guidanceMode === m.toLowerCase() ? "#1E40AF" : "#6B7280",
                   }}>{m === "Ás cegas (palpação)" ? t("blindPalpation") : tr(m)}</button>
              ))}
            </div>
          </div>

          {/* Access route */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">{t("accessRoute")}</label>
            <div className="flex flex-wrap gap-1.5">
              {ACCESS_ROUTES.map(r => (
                <button key={r} type="button" onClick={() => setAccessRoute(r)}
                  className="px-3 py-1.5 rounded-lg border-2 text-xs font-medium transition-all"
                  style={{
                    background:  accessRoute === r ? "#EFF6FF" : "#F9FAFB",
                    borderColor: accessRoute === r ? "#93C5FD" : "#E5E7EB",
                    color:       accessRoute === r ? "#1E40AF" : "#6B7280",
                   }}>{tr(r)}</button>
              ))}
            </div>
          </div>

          {/* Biologic technical sheet */}
          {productCode && (
            <BiologicDetailsSection
              productCode={productCode}
              values={biologicDetails}
              onChange={handleBiologicChange}
            />
          )}

          <div className="flex gap-3 flex-wrap">
            <button type="button" onClick={() => setLocalAnesthesia(v => !v)}
              className="px-3 py-2 rounded-xl border-2 text-xs font-medium transition-all"
              style={{
                background:  localAnesthesia ? "#EFF6FF" : "#F9FAFB",
                borderColor: localAnesthesia ? "#93C5FD" : "#E5E7EB",
                color:       localAnesthesia ? "#1E40AF" : "#6B7280",
              }}>
              {localAnesthesia && <CheckCircle2 className="inline h-3 w-3 mr-1 text-blue-500" />}
               {t("localAnesthesia")}
            </button>
            {localAnesthesia && (
              <Field label={t("anestheticAgent")} value={anesthesiaAgent} onChange={setAnesthesiaAgent} placeholder={t("exampleLidocaine")} />
            )}
            <button type="button" onClick={() => setAdverseEvent(v => !v)}
              className="px-3 py-2 rounded-xl border-2 text-xs font-medium transition-all"
              style={{
                background:  adverseEvent ? "#FEF2F2" : "#F9FAFB",
                borderColor: adverseEvent ? "#FECACA" : "#E5E7EB",
                color:       adverseEvent ? "#DC2626" : "#6B7280",
              }}>
               {adverseEvent && <AlertTriangle className="h-3.5 w-3.5" />}{t("adverseEvent")}
            </button>
          </div>

          {adverseEvent && (
            <Field label={t("describeAdverseEvent")} value={adverseEventDesc} onChange={setAdverseEventDesc} placeholder={t("adverseEventPlaceholder")} />
          )}

          <div className="space-y-1">
            <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">{t("observations")}</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} placeholder={t("procedureNotesPlaceholder")}
              className="w-full px-3 py-2 rounded-xl text-sm text-gray-800 placeholder-gray-400 outline-none resize-none border border-gray-200 bg-white focus:border-blue-400 focus:ring-2 focus:ring-blue-50" />
          </div>

          <div className="flex gap-2">
            <button type="button" onClick={() => setOpen(false)}
              className="flex-1 py-2.5 rounded-xl text-sm font-semibold border border-gray-200 bg-gray-50 text-gray-600 hover:bg-gray-100 transition-colors">
              {t("cancel")}
            </button>
            <button type="button" onClick={handleSave} disabled={saving}
              className="flex-1 py-2.5 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white transition-colors disabled:opacity-40">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {t("save")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── PROM instruments ─────────────────────────────────────────────────────────
// Escalas do joelho (KOOS, KOOS-JR, IKDC, Tegner, UCLA) retiradas; só dor (VAS)
const PROMS      = ["VAS"];
const TIMEPOINTS = ["Pré-operatório / Basal", "1 mês", "3 meses", "6 meses", "12 meses", "24 meses"];

function PromForm({ caseId, onSaved }: { caseId: string; onSaved: () => void }) {
  const t = useScopedTranslations(regenCoreMessages);
  const tr = useCaseTranslations();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [instrument, setInstrument] = useState("");
  const [timepoint, setTimepoint]   = useState("");
  const [score, setScore]           = useState("");

  const handleSave = async () => {
    if (!instrument || !timepoint) return alert(t("selectPromFields"));
    setSaving(true);
    try {
      const res = await fetch(`/regen-api/regen/cases/${caseId}/proms`, {
        method: "POST",
        credentials: "same-origin",
        headers: authHeaders(),
        body: JSON.stringify({ instrument, timepoint, score: parseFloat(score) || undefined }),
      });
      if (!res.ok) throw new Error(await res.text());
      setOpen(false); setInstrument(""); setTimepoint(""); setScore("");
      onSaved();
    } catch (e: any) {
      alert(t("errorWithMessage", { message: e.message }));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <button onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-4 py-3 rounded-xl border-2 border-dashed border-blue-200 text-blue-600 bg-blue-50 hover:bg-blue-100 transition-all">
        <div className="flex items-center gap-2">
          <Plus className="h-4 w-4" />
          <span className="text-sm font-semibold">{t("registerProm")}</span>
        </div>
        {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
      </button>

      {open && (
        <div className="mt-3 rounded-xl p-4 space-y-4 bg-white border border-gray-200 shadow-sm">
          <div className="space-y-1.5">
            <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">{t("instrument")}</label>
            <div className="flex flex-wrap gap-1.5">
              {PROMS.map(p => (
                <button key={p} type="button" onClick={() => setInstrument(p)}
                  className="px-3 py-1.5 rounded-lg border-2 text-xs font-medium transition-all"
                  style={{
                    background:  instrument === p ? "#EFF6FF" : "#F9FAFB",
                    borderColor: instrument === p ? "#93C5FD" : "#E5E7EB",
                    color:       instrument === p ? "#1E40AF" : "#6B7280",
                  }}>{p}</button>
              ))}
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">{t("timepoint")}</label>
            <div className="flex flex-wrap gap-1.5">
              {TIMEPOINTS.map(t => (
                <button key={t} type="button" onClick={() => setTimepoint(t)}
                  className="px-3 py-1.5 rounded-lg border-2 text-xs font-medium transition-all"
                  style={{
                    background:  timepoint === t ? "#EFF6FF" : "#F9FAFB",
                    borderColor: timepoint === t ? "#93C5FD" : "#E5E7EB",
                    color:       timepoint === t ? "#1E40AF" : "#6B7280",
                   }}>{tr(t)}</button>
              ))}
            </div>
          </div>
          <Field label={t("totalScore")} value={score} onChange={setScore} type="number" placeholder="0–100" />
          <div className="flex gap-2">
            <button type="button" onClick={() => setOpen(false)}
              className="flex-1 py-2.5 rounded-xl text-sm font-semibold border border-gray-200 bg-gray-50 text-gray-600 hover:bg-gray-100 transition-colors">
              {t("cancel")}
            </button>
            <button type="button" onClick={handleSave} disabled={saving}
              className="flex-1 py-2.5 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white transition-colors disabled:opacity-40">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {t("save")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Module 10: IA Clínica Tab ────────────────────────────────────────────────
// ─── Patient phone inline editor ─────────────────────────────────────────────
function PatientPhoneField({ caseId, initial }: { caseId: string; initial: string }) {
  const t = useScopedTranslations(regenCoreMessages);
  const [phone, setPhone] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    await fetch(`/regen-api/regen/cases/${caseId}`, {
      method: "PATCH",
      credentials: "same-origin",
      headers: authHeaders(),
      body: JSON.stringify({ patientPhone: phone }),
    });
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="flex gap-2">
      <input
        type="tel"
        placeholder="(11) 99999-9999"
        value={phone}
        onChange={e => setPhone(e.target.value)}
        className="flex-1 px-3 py-2 rounded-lg border border-gray-200 text-sm text-gray-800 placeholder-gray-400 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-50"
      />
      <button
        onClick={handleSave}
        disabled={saving}
        className="px-3 py-2 rounded-lg text-xs font-semibold bg-blue-600 text-white hover:bg-blue-700 transition-colors disabled:opacity-50 flex items-center gap-1"
      >
        {saved ? <CheckCircle2 className="h-3.5 w-3.5" /> : saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
        {saved ? t("saved") : t("save")}
      </button>
    </div>
  );
}

// ─── Regen Follow-up Timeline ─────────────────────────────────────────────────
const REGEN_SCHEDULE_META = [
  { periodo: "Pré-op (Baseline)", scales: ["VAS Dor"] },
  { periodo: "1 mês",             scales: ["VAS Dor"] },
  { periodo: "6 semanas (HA)",    scales: ["VAS Dor"] },
  { periodo: "3 meses",           scales: ["VAS Dor"] },
  { periodo: "6 meses ★",         scales: ["VAS Dor"] },
  { periodo: "12 meses",          scales: ["VAS Dor"] },
  { periodo: "24 meses",          scales: ["VAS Dor"] },
  { periodo: "4 anos",            scales: ["VAS Dor"] },
];
const ALL_SCALES = ["VAS Dor"];
type PreparedRegenFollowup = { link: string; message: string };

function showPopupStatus(popup: Window, message: string) {
  try {
    popup.document.title = "DocRegen";
    popup.document.body.style.cssText = "margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;background:#f8fafc;color:#1e3a5f;font:600 16px system-ui;text-align:center";
    popup.document.body.textContent = message;
  } catch {
    // The popup may already have navigated to a cross-origin page.
  }
}

function RegenFollowupTimeline({ caseId, patientPhone }: { caseId: string; patientPhone?: string }) {
  const t = useScopedTranslations(regenCoreMessages);
  const tr = useCaseTranslations();
  const { locale } = useLanguage();
  const [notifs, setNotifs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [initing, setIniting] = useState(false);
  const [preparing, setPreparing] = useState<string | null>(null);
  const [prepResult, setPrepResult] = useState<Record<string, PreparedRegenFollowup>>({});
  const [copied, setCopied] = useState<string | null>(null);
  const [actionError, setActionError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setActionError("");
    try {
      const r = await fetch(`/regen-api/regen/cases/${caseId}/notifications`, { credentials: "same-origin", headers: authHeaders() });
      const data = await r.json().catch(() => null);
      if (!r.ok || !Array.isArray(data)) throw new Error(t("loadError"));
      setNotifs(data);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : t("loadError"));
    } finally {
      setLoading(false);
    }
  }, [caseId, t]);

  useEffect(() => { load(); }, [load]);

  const handleInit = async () => {
    setIniting(true);
    setActionError("");
    try {
      const r = await fetch(`/regen-api/regen/cases/${caseId}/notifications/init`, {
        method: "POST",
        credentials: "same-origin",
        headers: authHeaders(),
        body: JSON.stringify({}),
      });
      const data = await r.json().catch(() => null);
      if (!r.ok || !Array.isArray(data)) {
        throw new Error(data?.error || t("connectionError"));
      }
      setNotifs(data);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : t("connectionError"));
    } finally {
      setIniting(false);
    }
  };

  const handlePrepare = async (notifId: string): Promise<PreparedRegenFollowup | null> => {
    if (prepResult[notifId]) return prepResult[notifId];
    setPreparing(notifId);
    setActionError("");
    try {
      const r = await fetch(`/regen-api/regen/cases/${caseId}/notifications/${notifId}/prepare-whatsapp`, {
        method: "POST",
        credentials: "same-origin",
        headers: authHeaders(),
        body: JSON.stringify({}),
      });
      const data = await r.json().catch(() => null);
      if (!r.ok || typeof data?.link !== "string" || typeof data?.message !== "string") {
        throw new Error(data?.error || t("patientLinkError"));
      }
      setPrepResult(prev => ({ ...prev, [notifId]: data }));
      return data;
    } catch (error) {
      setActionError(error instanceof Error ? error.message : t("patientLinkError"));
      return null;
    } finally {
      setPreparing(null);
    }
  };

  const handleOpenWhatsApp = async (notifId: string) => {
    // Open synchronously while the click still has browser activation. iOS may
    // block a new tab if window.open happens only after the API request.
    const popup = window.open("", "_blank");
    if (popup) {
      popup.opener = null;
      showPopupStatus(popup, t("preparingPatientLink"));
    }

    const data = prepResult[notifId] ?? await handlePrepare(notifId);
    if (!data) {
      if (popup) {
        showPopupStatus(popup, t("patientLinkError"));
        window.setTimeout(() => popup.close(), 1800);
      }
      return;
    }

    const rawPhone = (patientPhone ?? "").replace(/\D/g, "");
    const phone = rawPhone ? (rawPhone.startsWith("55") ? rawPhone : `55${rawPhone}`) : "";
    const waUrl = phone
      ? `https://wa.me/${phone}?text=${encodeURIComponent(data.message)}`
      : `https://wa.me/?text=${encodeURIComponent(data.message)}`;
    if (!popup) {
      setActionError(t("patientLinkError"));
      return;
    }
    popup.location.href = waUrl;

    const statusResponse = await fetch(`/regen-api/regen/cases/${caseId}/notifications/${notifId}`, {
      method: "PATCH",
      credentials: "same-origin",
      headers: authHeaders(),
      body: JSON.stringify({ status: "sent" }),
    });
    if (statusResponse.ok) await load();
  };

  const handleCopyLink = async (notifId: string) => {
    const data = prepResult[notifId] ?? await handlePrepare(notifId);
    if (!data?.link) return;
    try {
      await navigator.clipboard.writeText(data.link);
      setCopied(notifId);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      setActionError(t("patientLinkError"));
    }
  };

  if (loading) return (
    <div className="flex items-center justify-center py-12 gap-2 text-gray-400">
      <Loader2 className="h-5 w-5 animate-spin" /> <span className="text-sm">{t("loadingSchedule")}</span>
    </div>
  );

  return (
    <div className="min-w-0 space-y-5">
      {actionError && (
        <div role="alert" className="flex items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          <span>{actionError}</span>
          <button type="button" className="shrink-0 font-semibold underline" onClick={() => setActionError("")}>
            {t("hide")}
          </button>
        </div>
      )}
      {/* Schedule header / init button */}
      <div className="min-w-0 overflow-hidden rounded-xl border border-amber-200 bg-amber-50">
        <div className="flex flex-col items-start gap-2 border-b border-amber-200 bg-amber-100/80 px-3 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-4">
          <div className="flex min-w-0 items-center gap-2">
            <Calendar className="h-4 w-4 text-amber-700" />
            <p className="min-w-0 text-xs font-bold uppercase tracking-wide text-amber-800">
               {t("followupSchedule")}
            </p>
          </div>
          {notifs.length === 0 && (
            <button
              onClick={handleInit}
              disabled={initing}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-amber-600 hover:bg-amber-700 text-white transition-colors disabled:opacity-50"
            >
              {initing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
               {t("startSchedule")}
            </button>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-amber-50/80">
                <th className="text-left px-4 py-2 font-semibold text-amber-800">{t("moment")}</th>
                {ALL_SCALES.map(s => (
                   <th key={s} className="px-3 py-2 font-semibold text-amber-800 text-center">{tr(s)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {REGEN_SCHEDULE_META.map((row, i) => {
                const notif = notifs.find(n => n.periodo === row.periodo);
                return (
                  <tr key={row.periodo} className={i % 2 === 0 ? "bg-white" : "bg-amber-50/30"}>
                    <td className={`px-4 py-2 font-medium text-gray-800 whitespace-nowrap ${row.periodo.includes("★") ? "font-bold text-amber-700" : ""}`}>
                       {tr(row.periodo.replace(" ★", ""))}{row.periodo.includes("★") ? " ★" : ""}
                      {notif?.status === "completed" && <CheckCheck className="inline h-3 w-3 ml-1 text-green-500" />}
                    </td>
                    {ALL_SCALES.map(scale => {
                      const required = row.scales.includes(scale);
                      const completed = required && notif?.responses?.some((r: any) => r.nome_escala === scale);
                      return (
                        <td key={scale} className="px-3 py-2 text-center">
                          {!required ? (
                            <span className="text-gray-300">—</span>
                          ) : completed ? (
                            <CheckCircle2 className="h-4 w-4 text-green-500 mx-auto" />
                          ) : (
                            <div className="h-4 w-4 rounded border-2 border-amber-300 mx-auto" />
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="px-4 py-2 text-[10px] text-amber-700 border-t border-amber-200">
           {t("criticalPointNote")}
        </p>
      </div>

      {/* Timeline of notifications to send */}
      {notifs.length > 0 && (
        <div>
          <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-center gap-2">
              <Send className="h-4 w-4 text-blue-500" />
               <p className="min-w-0 text-xs font-bold uppercase tracking-wide text-gray-500">{t("scaleSendTimeline")}</p>
            </div>
            <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs">
              <span className="text-xs text-gray-400">{(() => { const count = notifs.filter(n => n.status === "pending").length; return t(count === 1 ? "pendingCountOne" : "pendingCount", { count }); })()}</span>
              <span className="text-gray-300">·</span>
              <span className="text-xs text-gray-400">{(() => { const count = notifs.filter(n => n.status === "sent" || n.status === "completed").length; return t(count === 1 ? "sentCountOne" : "sentCount", { count }); })()}</span>
            </div>
          </div>

          <div className="space-y-2">
            {notifs.map(n => {
              const isPending = n.status === "pending";
              const isSent    = n.status === "sent";
              const isDone    = n.status === "completed";
              const pr        = prepResult[n.id];
              const isCritical = n.periodo.includes("★");

              return (
                <div
                  key={n.id}
                  className={`min-w-0 space-y-3 rounded-xl border p-3 transition-colors sm:p-4 ${
                    isDone    ? "bg-green-50/60 border-green-200" :
                    isSent    ? "bg-blue-50/60 border-blue-200" :
                    isCritical ? "bg-amber-50/60 border-amber-300" :
                    "bg-white border-gray-200"
                  }`}
                >
                  <div className="flex min-w-0 items-start justify-between gap-2">
                    <div className="min-w-0">
                      {n.scheduled_date && (
                        <p className="text-[10px] font-mono text-gray-400 mb-0.5">
                           {toDisplayDate(n.scheduled_date).toLocaleDateString(locale, { day: "2-digit", month: "short", year: "numeric" })}
                        </p>
                      )}
                      <p className={`break-words text-sm font-semibold ${isCritical ? "text-amber-700" : "text-gray-900"}`}>
                         {tr(String(n.periodo).replace(" ★", ""))}{String(n.periodo).includes("★") ? " ★" : ""}
                      </p>
                      <p className="mt-0.5 break-words text-xs text-gray-500">
                         {(n.scales as string[]).map(tr).join(", ")}
                        {n.response_count > 0 && (
                           <span className="ml-2 text-green-600 font-semibold">· {t((n.response_count) === 1 ? "completedCountOne" : "completedCount", { count: n.response_count, total: n.scales.length })}</span>
                        )}
                      </p>
                    </div>
                    <div className="shrink-0">
                      {isDone && (
                        <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-green-100 text-green-700 border border-green-200">
                           <CheckCheck className="h-3 w-3" /> {t("completed")}
                        </span>
                      )}
                      {isSent && !isDone && (
                        <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-blue-100 text-blue-700 border border-blue-200">
                           <Send className="h-3 w-3" /> {t("sent")}
                        </span>
                      )}
                      {isPending && (
                        <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-gray-100 text-gray-500 border border-gray-200">
                           <Clock className="h-3 w-3" /> {t("pending")}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Link preview */}
                  {pr?.link && (
                    <div className="rounded-lg bg-gray-50 border border-gray-200 px-3 py-2">
                       <p className="text-[10px] text-gray-400 mb-0.5">{t("patientLink")}</p>
                      <p className="text-xs text-blue-600 truncate">{pr.link}</p>
                    </div>
                  )}

                  {/* Actions */}
                  <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                    <button
                      onClick={() => handleOpenWhatsApp(n.id)}
                      disabled={preparing === n.id}
                      className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-green-600 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-green-700 disabled:opacity-50 sm:w-auto"
                    >
                      {preparing === n.id
                        ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        : <MessageCircle className="h-3.5 w-3.5" />}
                       {t("openWhatsapp")}
                    </button>
                    <button
                      onClick={() => handleCopyLink(n.id)}
                      disabled={preparing === n.id}
                      className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50 sm:w-auto"
                    >
                      {copied === n.id
                        ? <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
                        : <Copy className="h-3.5 w-3.5" />}
                       {copied === n.id ? t("copied") : t("copyLink")}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {notifs.length === 0 && (
        <div className="flex flex-col items-center justify-center py-12 gap-3 text-gray-400 rounded-xl border border-dashed border-gray-200">
          <ClipboardList className="h-8 w-8" />
          <p className="text-sm text-center">
             {t("startScheduleEmpty")}<br />
             <span className="text-xs">{t("whatsappLinkNotice")}</span>
          </p>
        </div>
      )}
    </div>
  );
}

// ─── Anamnese Regen ───────────────────────────────────────────────────────────
function AnamneseRegenTab({
  caseId,
  initial,
  onSaved,
}: {
  caseId: string;
  initial: Record<string, any>;
  onSaved?: (updated: Record<string, any>) => void;
}) {
  const t = useScopedTranslations(regenCoreMessages);
  const tr = useCaseTranslations();
  const [form, setForm] = useState<Record<string, any>>(initial ?? {});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [open, setOpen] = useState<Record<string, boolean>>({
    inflamacao: true,
    sono: false,
    nutricao: false,
    atividade: false,
    medicacoes: false,
    historico: false,
  });

  const toggleSection = (k: string) =>
    setOpen(prev => ({ ...prev, [k]: !prev[k] }));

  const set = useCallback((key: string, val: any) => {
    setForm(prev => {
      const next = { ...prev, [key]: val };
      clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(async () => {
        setSaving(true);
        const res = await fetch(`/regen-api/regen/cases/${caseId}`, {
          method: "PATCH",
          credentials: "same-origin",
          headers: authHeaders(),
          body: JSON.stringify({ anamnese_regen: next }),
        });
        setSaving(false);
        if (res.ok) {
          setSaved(true);
          setTimeout(() => setSaved(false), 2000);
          onSaved?.(next);
        }
      }, 1500);
      return next;
    });
    setSaved(false);
  }, [caseId, onSaved]);

  // Mini UI helpers
  const Toggle = ({ fk, label }: { fk: string; label: string }) => (
    <button
      onClick={() => set(fk, !form[fk])}
      className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm transition-colors ${
        form[fk]
          ? "bg-red-50 border-red-300 text-red-700 font-semibold"
          : "bg-gray-50 border-gray-200 text-gray-600 hover:bg-gray-100"
      }`}
    >
      <span className={`h-3.5 w-3.5 rounded border-2 flex-shrink-0 flex items-center justify-center ${form[fk] ? "bg-red-500 border-red-500" : "border-gray-400"}`}>
        {form[fk] && <span className="text-white text-[8px] font-bold leading-none">✓</span>}
      </span>
      {label}
    </button>
  );

  type PillOpt = { value: string; label: string };
  const Pills = ({ fk, opts, className = "" }: { fk: string; opts: PillOpt[]; className?: string }) => (
    <div className={`flex flex-wrap gap-1.5 ${className}`}>
      {opts.map(o => (
        <button
          key={o.value}
          onClick={() => set(fk, o.value)}
          className={`px-3 py-1.5 rounded-full text-xs border transition-colors ${
            form[fk] === o.value
              ? "bg-blue-600 border-blue-600 text-white font-semibold"
              : "bg-white border-gray-200 text-gray-600 hover:bg-gray-50"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );

  const TextInput = ({ fk, placeholder, type = "text" }: { fk: string; placeholder?: string; type?: string }) => (
    <input
      type={type}
      value={form[fk] ?? ""}
      placeholder={placeholder}
      onChange={e => set(fk, type === "number" ? (e.target.value === "" ? undefined : Number(e.target.value)) : e.target.value)}
      className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm text-gray-800 placeholder-gray-400 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-50"
    />
  );

  const SectionHeader = ({ sKey, title, icon: Icon, subtitle }: { sKey: string; title: string; icon: any; subtitle?: string }) => (
    <button
      onClick={() => toggleSection(sKey)}
      className="w-full flex items-center justify-between px-4 py-3 rounded-xl bg-white border border-gray-200 shadow-sm hover:bg-gray-50 transition-colors"
    >
      <div className="flex items-center gap-2">
        <div className="h-7 w-7 rounded-lg bg-blue-50 flex items-center justify-center flex-shrink-0">
          <Icon className="h-4 w-4 text-blue-600" />
        </div>
        <div className="text-left">
          <p className="text-sm font-semibold text-gray-900">{title}</p>
          {subtitle && <p className="text-xs text-gray-400">{subtitle}</p>}
        </div>
      </div>
      {open[sKey] ? <ChevronUp className="h-4 w-4 text-gray-400" /> : <ChevronDown className="h-4 w-4 text-gray-400" />}
    </button>
  );

  const FieldRow = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <div className="space-y-1.5">
      <p className="text-xs font-medium text-gray-600">{label}</p>
      {children}
    </div>
  );

  return (
    <div className="space-y-3">
      {/* Save status */}
      <div className="flex items-center justify-between">
        <p className="text-xs text-gray-400">{t("autofillHelp")}</p>
        {saving && <span className="flex items-center gap-1 text-xs text-gray-400"><Loader2 className="h-3 w-3 animate-spin" /> {t("saving")}</span>}
        {saved && !saving && <span className="flex items-center gap-1 text-xs text-green-600"><CheckCircle2 className="h-3 w-3" /> {t("saved")}</span>}
      </div>

      {/* ── 1. Inflamação Sistêmica ── */}
      <SectionHeader sKey="inflamacao" title={t("systemicInflammation")} icon={AlertTriangle} subtitle={t("inflammationSubtitle")} />
      {open.inflamacao && (
        <div className="rounded-xl border border-gray-200 bg-white p-4 space-y-4">
          {/* Tabagismo */}
          <FieldRow label={t("smoking")}>
            <Pills fk="tabagismo" opts={[{ value: "não", label: t("no") }, { value: "sim", label: t("yes") }, { value: "ex-fumante", label: t("formerSmoker") }]} />
            {(form.tabagismo === "sim" || form.tabagismo === "ex-fumante") && (
              <div className="mt-2 grid grid-cols-2 gap-2">
                <TextInput fk="tabagismo_qtd" placeholder={t("caseCigarettesDay")} type="number" />
                <TextInput fk="tabagismo_pack_years" placeholder={t("packYearsExample")} type="number" />
              </div>
            )}
            {form.tabagismo === "sim" && (
              <p className="text-[11px] text-amber-600 mt-1">{t("smokingWarning")}</p>
            )}
          </FieldRow>
          {/* Álcool */}
          <FieldRow label={t("alcoholConsumption")}>
            <Pills fk="alcool" opts={[{ value: "não", label: t("no") }, { value: "social", label: t("social") }, { value: "frequente", label: t("frequentWeekly") }]} />
            {form.alcool === "frequente" && (
              <p className="text-[11px] text-amber-600 mt-1">{t("alcoholWarning")}</p>
            )}
          </FieldRow>
          {/* Obesidade */}
          <FieldRow label={t("obesity")}>
            <div className="flex flex-wrap gap-2 mb-2">
              <Toggle fk="obesidade" label="IMC ≥ 30 kg/m²" />
            </div>
            {form.obesidade && (
              <div className="grid grid-cols-2 gap-2 mt-1">
                <TextInput fk="obesidade_imc" placeholder={t("bmiExample")} type="number" />
                <TextInput fk="obesidade_ca" placeholder={t("bmiCircumference")} type="number" />
              </div>
            )}
            {form.obesidade && Number(form.obesidade_imc) >= 35 && (
              <p className="text-[11px] text-red-600 mt-1">{t("bmiWarning")}</p>
            )}
          </FieldRow>
          {/* Diabetes */}
          <FieldRow label={t("diabetesMellitus")}>
            <Pills fk="diabetes" opts={[{ value: "não", label: t("no") }, { value: "pré-diabetes", label: t("casePrediabetes") }, { value: "DM2", label: "DM2" }, { value: "DM1", label: "DM1" }]} />
            {(form.diabetes === "DM1" || form.diabetes === "DM2") && (
              <div className="mt-2">
                <TextInput fk="diabetes_hba1c" placeholder={t("hba1cExample")} type="number" />
                {Number(form.diabetes_hba1c) >= 8 && (
                  <p className="text-[11px] text-red-600 mt-1">{t("hba1cWarning")}</p>
                )}
              </div>
            )}
          </FieldRow>
          {/* Resistência à insulina */}
          <FieldRow label={t("insulinResistance")}>
            <div className="flex flex-wrap gap-2 mb-2">
              <Toggle fk="resistencia_insulina" label={t("yes")} />
            </div>
            {form.resistencia_insulina && (
              <TextInput fk="homa_ir" placeholder={t("homaExample")} type="number" />
            )}
          </FieldRow>
          {/* Doenças autoimunes */}
          <FieldRow label={t("autoimmuneDiseases")}>
            <div className="flex flex-wrap gap-2 mb-2">
              <Toggle fk="autoimune" label={t("yes")} />
            </div>
            {form.autoimune && (
              <>
                <TextInput fk="autoimune_qual" placeholder={t("autoimmunePlaceholder")} />
                <p className="text-[11px] text-amber-600 mt-1">{t("autoimmuneWarning")}</p>
              </>
            )}
          </FieldRow>
          {/* Infecção recente */}
          <FieldRow label={t("recentInfection")}>
            <div className="flex flex-wrap gap-2 mb-2">
              <Toggle fk="infeccao_recente" label={t("yes")} />
            </div>
            {form.infeccao_recente && (
              <>
                <TextInput fk="infeccao_qual" placeholder={t("infectionPlaceholder")} />
                <p className="text-[11px] text-red-600 mt-1">{t("infectionWarning")}</p>
              </>
            )}
          </FieldRow>
        </div>
      )}

      {/* ── 2. Sono ── */}
      <SectionHeader sKey="sono" title={t("sleep")} icon={Activity} subtitle={t("sleepSubtitle")} />
      {open.sono && (
        <div className="rounded-xl border border-gray-200 bg-white p-4 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <FieldRow label={t("caseSleepHours")}>
              <TextInput fk="sono_horas" placeholder={t("exampleSeven")} type="number" />
            </FieldRow>
            <FieldRow label={t("sleepQuality")}>
              <Pills fk="sono_qualidade" opts={[{ value: "boa", label: t("good") }, { value: "regular", label: t("regular") }, { value: "ruim", label: t("casePoor") }]} />
            </FieldRow>
          </div>
          <div className="flex flex-wrap gap-2">
            <Toggle fk="apneia" label={t("sleepApnea")} />
            <Toggle fk="cpap" label={t("usesCpap")} />
          </div>
        </div>
      )}

      {/* ── 3. Nutrição ── */}
      <SectionHeader sKey="nutricao" title={t("caseNutrition")} icon={TrendingUp} subtitle={t("nutritionSubtitle")} />
      {open.nutricao && (
        <div className="rounded-xl border border-gray-200 bg-white p-4 space-y-4">
          <FieldRow label={t("caseProteinIntake")}>
            <Pills fk="proteina" opts={[{ value: "adequada", label: t("adequate") }, { value: "insuficiente", label: t("caseInsufficient") }]} />
          </FieldRow>
          <FieldRow label={t("ultraProcessedDiet")}>
            <Pills fk="ultraprocessados" opts={[{ value: "raramente", label: t("rarely") }, { value: "às vezes", label: t("sometimes") }, { value: "frequente", label: t("frequent") }]} />
          </FieldRow>
          <FieldRow label={t("fruitVegetableIntake")}>
            <Pills fk="frutas_vegetais" opts={[{ value: "adequado", label: t("adequateServings") }, { value: "insuficiente", label: t("caseInsufficient") }]} />
          </FieldRow>
          <FieldRow label={t("recentWeightLoss")}>
            <div className="flex flex-wrap gap-2 mb-2">
              <Toggle fk="perda_peso_recente" label={t("yes")} />
            </div>
            {form.perda_peso_recente && (
              <TextInput fk="perda_peso_kg" placeholder={t("howManyKg")} type="number" />
            )}
          </FieldRow>
          <FieldRow label={t("supplements")}>
            <div className="flex flex-wrap gap-2 mb-2">
              <Toggle fk="suplementos" label={t("yes")} />
            </div>
            {form.suplementos && (
              <TextInput fk="suplementos_detalhe" placeholder={t("supplementsPlaceholder")} />
            )}
          </FieldRow>
        </div>
      )}

      {/* ── 4. Atividade Física ── */}
      <SectionHeader sKey="atividade" title={t("physicalActivity")} icon={TrendingUp} subtitle={t("activitySubtitle")} />
      {open.atividade && (
        <div className="rounded-xl border border-gray-200 bg-white p-4 space-y-4">
          <div className="flex flex-wrap gap-2">
            <Toggle fk="sedentarismo" label={t("caseSedentary")} />
            <Toggle fk="sobrecarga_ocupacional" label={t("occupationalOverload")} />
          </div>
          <FieldRow label={t("regularExercise")}>
            <div className="flex flex-wrap gap-2 mb-2">
              <Toggle fk="exercicio_regular" label={t("yes")} />
            </div>
            {form.exercicio_regular && (
              <TextInput fk="exercicio_freq" placeholder={t("exercisePlaceholder")} />
            )}
          </FieldRow>
        </div>
      )}

      {/* ── 5. Medicações em Uso ── */}
      <SectionHeader sKey="medicacoes" title={t("medicationsInUse")} icon={AlertCircle} subtitle={t("medicationSubtitle")} />
      {open.medicacoes && (
        <div className="rounded-xl border border-gray-200 bg-white p-4 space-y-4">
          <p className="text-xs text-gray-400">{t("markCurrentClasses")}</p>
          {/* Corticoides */}
          <div className="space-y-1.5">
            <Toggle fk="corticoides" label={t("corticosteroids")} />
            {form.corticoides && (
              <div className="ml-1 space-y-1.5">
                <TextInput fk="corticoides_detalhe" placeholder={t("corticosteroidPlaceholder")} />
                <p className="text-[11px] text-amber-600">{t("corticosteroidInterval")}</p>
              </div>
            )}
          </div>
          {/* AINEs */}
          <div className="space-y-1.5">
            <Toggle fk="aines" label={t("caseNsaids")} />
            {form.aines && (
              <div className="ml-1">
                <TextInput fk="aines_detalhe" placeholder={t("nsaidPlaceholder")} />
                <p className="text-[11px] text-amber-600 mt-1">{t("nsaidWarning")}</p>
              </div>
            )}
          </div>
          {/* Estatinas */}
          <div className="space-y-1.5">
            <Toggle fk="estatinas" label={t("statins")} />
            {form.estatinas && (
              <div className="ml-1">
                <TextInput fk="estatinas_detalhe" placeholder={t("statinPlaceholder")} />
              </div>
            )}
          </div>
          {/* Anticoagulantes */}
          <div className="space-y-1.5">
            <Toggle fk="anticoagulantes" label={t("anticoagulants")} />
            {form.anticoagulantes && (
              <div className="ml-1 space-y-1.5">
                <TextInput fk="anticoagulantes_detalhe" placeholder={t("anticoagulantPlaceholder")} />
                <TextInput fk="anticoagulantes_inr" placeholder={t("inrWarfarin")} type="number" />
                <p className="text-[11px] text-amber-600">{t("anticoagulantWarning")}</p>
              </div>
            )}
          </div>
          {/* Imunossupressores */}
          <div className="space-y-1.5">
            <Toggle fk="imunossupressores" label={t("caseImmunosuppressants")} />
            {form.imunossupressores && (
              <div className="ml-1 space-y-1.5">
                <TextInput fk="imunossupressores_detalhe" placeholder={t("immunosuppressantPlaceholder")} />
                <p className="text-[11px] text-red-600">{t("immunosuppressantWarning")}</p>
              </div>
            )}
          </div>
          {/* Canetas emagrecedoras — GLP-1/GIP agonistas */}
          <div className="space-y-1.5">
            <Toggle fk="glp1_agonistas" label={t("weightLossPens")} />
            {form.glp1_agonistas && (
              <div className="ml-1 space-y-1.5">
                <Pills fk="glp1_qual" opts={[
                  { value: "semaglutida", label: "Semaglutida (Ozempic/Wegovy)" },
                  { value: "tirzepatida", label: "Tirzepatida (Mounjaro/Zepbound)" },
                  { value: "liraglutida", label: "Liraglutida (Victoza/Saxenda)" },
                  { value: "outro", label: t("other") },
                ]} />
                <TextInput fk="glp1_dose" placeholder={t("currentDose")} />
                <p className="text-[11px] text-sky-600">{t("glp1Benefit")}</p>
              </div>
            )}
          </div>
          <FieldRow label={t("otherMedications")}>
            <TextInput fk="medicacoes_outras" placeholder={t("otherMedsPlaceholder")} />
          </FieldRow>
        </div>
      )}

      {/* ── 6. Histórico Ortopédico ── */}
      <SectionHeader sKey="historico" title={t("caseOrthopedicHistory")} icon={FileText} subtitle={t("orthopedicHistorySubtitle")} />
      {open.historico && (
        <div className="rounded-xl border border-gray-200 bg-white p-4 space-y-4">
          {/* Cirurgias */}
          <FieldRow label={t("priorSiteSurgeries")}>
            <div className="flex flex-wrap gap-2 mb-2">
              <Toggle fk="cirurgias_previas" label={t("yes")} />
            </div>
            {form.cirurgias_previas && (
              <div className="space-y-2">
                <TextInput fk="cirurgias_quais" placeholder={t("surgeriesPlaceholder")} />
                <TextInput fk="cirurgias_implantes" placeholder={t("implantsPlaceholder")} />
                <p className="text-[11px] text-gray-400">{t("repeatedSurgeryNote")}</p>
              </div>
            )}
          </FieldRow>
          {/* Infiltrações */}
          <FieldRow label={t("priorInjections")}>
            <div className="flex flex-wrap gap-2 mb-2">
              <Toggle fk="infiltracoes_anteriores" label={t("yes")} />
            </div>
            {form.infiltracoes_anteriores && (
              <div className="space-y-2">
                <Pills fk="infiltracoes_tipo" opts={[
                  { value: "corticoide", label: "Corticoide" },
                   { value: "HA", label: t("hyaluronicAcid") },
                  { value: "PRP", label: "PRP" },
                   { value: "misto", label: t("mixed") },
                ]} />
                <div className="grid grid-cols-2 gap-2">
                  <TextInput fk="infiltracoes_numero" placeholder={t("injectionCount")} type="number" />
                  <TextInput fk="infiltracoes_quando" placeholder={t("lastMonth")} />
                </div>
                {Number(form.infiltracoes_numero) >= 3 && form.infiltracoes_tipo === "corticoide" && (
                  <p className="text-[11px] text-red-600">{t("repeatedSteroidWarning")}</p>
                )}
              </div>
            )}
          </FieldRow>
          {/* PRP / HA prévio */}
          <FieldRow label={t("previousPrpHa")}>
            <div className="flex flex-wrap gap-2 mb-2">
              <Toggle fk="prp_ha_previo" label={t("yes")} />
            </div>
            {form.prp_ha_previo && (
              <div className="space-y-3">
                <Pills fk="prp_ha_tipo" opts={[
                  { value: "LP-PRP", label: t("lpPrpPoor") },
                  { value: "LR-PRP", label: t("lrPrpRich") },
                  { value: "PRF", label: "PRF" },
                  { value: "HA-reticulado", label: "HA reticulado" },
                  { value: "HA-linear", label: "HA linear" },
                   { value: "desconhecido", label: t("doesNotKnow") },
                ]} />
                <div className="grid grid-cols-2 gap-2">
                  <TextInput fk="prp_ha_sessoes" placeholder={t("sessionCount")} type="number" />
                  <TextInput fk="prp_ha_data" placeholder={t("lastDate")} />
                </div>
                <FieldRow label={t("treatmentResponse")}>
                  <Pills fk="prp_ha_resposta" opts={[
                     { value: "boa", label: t("good") },
                     { value: "parcial", label: t("casePartial") },
                     { value: "sem resposta", label: t("caseNoResponse") },
                  ]} />
                </FieldRow>
                {form.prp_ha_resposta && (
                  <TextInput fk="prp_ha_duracao" placeholder={t("effectDuration")} />
                )}
                {form.prp_ha_resposta === "sem resposta" && (
                  <p className="text-[11px] text-amber-600">{t("noResponseWarning")}</p>
                )}
              </div>
            )}
          </FieldRow>
        </div>
      )}
    </div>
  );
}

function IaTab({ caseId, proms }: { caseId: string; proms: PromResponse[] }) {
  const t = useScopedTranslations(regenCoreMessages);
  const tr = useCaseTranslations();
  const [summary,        setSummary]      = useState<string | null>(null);
  const [generating,     setGenerating]   = useState(false);
  const [err,            setErr]          = useState<string | null>(null);
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [pdfErr,         setPdfErr]       = useState<string | null>(null);
  const [downloadingClinicalPdf, setDownloadingClinicalPdf] = useState(false);
  const [clinicalPdfErr,         setClinicalPdfErr]         = useState<string | null>(null);
  const [clinicalPdfShareUrl, setClinicalPdfShareUrl] = useState<string | null>(null);
  const [pdfShareUrl, setPdfShareUrl] = useState<string | null>(null);

  const handleDownloadClinicalReport = async () => {
    setDownloadingClinicalPdf(true);
    setClinicalPdfErr(null);
    try {
      const res = await fetch(`/regen-api/regen/cases/${caseId}/clinical-report`, {
        credentials: "same-origin",
        headers: authHeaders(),
      });
      if (!res.ok) throw new Error(await res.text());
      const blob = await res.blob();
      const result = await sharePdfBlobOrDownload(
        blob,
        `laudo-clinico-${caseId}.pdf`,
        setClinicalPdfShareUrl,
      );
      if (result.deferred) {
        setClinicalPdfErr(null);
      }
    } catch (e: any) {
      setClinicalPdfErr(t("clinicalReportError", { message: e.message }));
    } finally {
      setDownloadingClinicalPdf(false);
    }
  };

  const handleDownloadReport = async () => {
    setDownloadingPdf(true);
    setPdfErr(null);
    try {
      const res = await fetch(`/regen-api/regen/cases/${caseId}/report`, {
        credentials: "same-origin",
        headers: authHeaders(),
      });
      if (!res.ok) throw new Error(await res.text());
      const blob = await res.blob();
      const result = await sharePdfBlobOrDownload(
        blob,
        `laudo-tecnico-${caseId}.pdf`,
        setPdfShareUrl,
      );
      if (result.deferred) {
        setPdfErr(null);
      }
    } catch (e: any) {
      setPdfErr(t("pdfError", { message: e.message }));
    } finally {
      setDownloadingPdf(false);
    }
  };

  const handleGenerate = async () => {
    setGenerating(true); setErr(null);
    try {
      const res = await fetch(`/regen-api/regen/cases/${caseId}/ai-summary`, {
        method: "POST",
        credentials: "same-origin",
        headers: authHeaders(),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setSummary(data.summary);
    } catch (e: any) {
      setErr(t("errorWithMessage", { message: e.message }));
    } finally {
      setGenerating(false);
    }
  };

  // Build chart data: group proms by timepoint, each instrument as a series
  const instruments = useMemo(() => [...new Set(proms.map(p => p.instrument))], [proms]);
  const timepoints  = useMemo(() => {
    const ORDER = ["Pré-operatório / Basal","1 mês","3 meses","6 meses","12 meses","24 meses"];
    const seen = [...new Set(proms.map(p => p.timepoint))];
    return seen.sort((a, b) => {
      const ai = ORDER.indexOf(a), bi = ORDER.indexOf(b);
      if (ai === -1 && bi === -1) return a.localeCompare(b);
      if (ai === -1) return 1; if (bi === -1) return -1;
      return ai - bi;
    });
  }, [proms]);

  const chartData = useMemo(() => timepoints.map(tp => {
    const row: Record<string, any> = { tp: tr(tp) };
    for (const inst of instruments) {
      const found = proms.filter(p => p.instrument === inst && p.timepoint === tp);
      if (found.length) {
        row[inst] = found[found.length - 1].score ?? null;
      }
    }
    return row;
  }), [timepoints, instruments, proms, tr]);

  const COLORS = ["#2563EB","#059669","#D97706","#DC2626","#7C3AED","#0891B2"];

  return (
    <div className="space-y-4">
      {/* AI Summary card */}
      <div className="rounded-xl bg-white border border-gray-200 shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Brain className="h-4 w-4 text-purple-500" />
            <p className="text-sm font-bold text-gray-900">{t("autoEvolutionSummary")}</p>
          </div>
          <button onClick={handleGenerate} disabled={generating}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-50 transition-colors">
            {generating
              ? <><Loader2 className="h-3 w-3 animate-spin" /> {t("generatingAi")}</>
              : summary
              ? <><RefreshCw className="h-3 w-3" /> {t("update")}</>
              : <><Sparkles className="h-3 w-3" /> {t("generateWithAi")}</>}
          </button>
        </div>

        {err && (
          <div className="flex items-center gap-2 m-4 p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
            <AlertCircle className="h-4 w-4 shrink-0" /> {err}
          </div>
        )}

        {!summary && !generating && !err && (
          <div className="flex flex-col items-center justify-center py-12 gap-3 text-gray-400">
            <Sparkles className="h-8 w-8" />
            <p className="text-sm text-center px-6">
              {t("aiSummaryEmpty")}
            </p>
          </div>
        )}

        {generating && (
          <div className="flex flex-col items-center justify-center py-12 gap-3 text-purple-400">
            <Loader2 className="h-8 w-8 animate-spin" />
            <p className="text-sm">{t("analyzingClinicalData")}</p>
          </div>
        )}

        {summary && !generating && (
          <div className="p-4 space-y-3">
            <div className="p-4 rounded-xl bg-purple-50 border border-purple-100">
              <p className="text-sm text-gray-800 leading-relaxed whitespace-pre-wrap">{summary}</p>
            </div>
            <p className="text-[10px] text-gray-400 text-center">
              {t("aiDisclaimer")}
            </p>
          </div>
        )}
      </div>

      {/* Evolution chart */}
      {proms.length > 0 && (
        <div className="rounded-xl bg-white border border-gray-200 shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
            <BarChart2 className="h-4 w-4 text-blue-500" />
            <p className="text-sm font-bold text-gray-900">{t("promEvolution")}</p>
          </div>
          <div className="p-4">
            {chartData.length < 2 ? (
              <p className="text-xs text-gray-400 text-center py-6">
                {t("promTwoPoints")}
              </p>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={chartData} margin={{ top: 5, right: 10, left: -20, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" />
                  <XAxis dataKey="tp" tick={{ fontSize: 10, fill: "#9CA3AF" }} />
                  <YAxis tick={{ fontSize: 10, fill: "#9CA3AF" }} />
                  <Tooltip
                    contentStyle={{ fontSize: 11, borderRadius: 8, border: "1px solid #E5E7EB" }}
                    labelStyle={{ fontWeight: 700, color: "#374151" }}
                  />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  {instruments.map((inst, i) => (
                    <Line
                      key={inst} type="monotone" dataKey={inst}
                      stroke={COLORS[i % COLORS.length]}
                      strokeWidth={2} dot={{ r: 4 }}
                      connectNulls
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      )}

      {proms.length === 0 && (
        <div className="rounded-xl bg-white border border-gray-200 shadow-sm p-6 text-center text-gray-400">
          <BarChart2 className="h-8 w-8 mx-auto mb-2" />
          <p className="text-sm">{t("promEmptyChart")}</p>
        </div>
      )}

      {/* Laudo Clínico PDF */}
      <div className="rounded-xl bg-white border border-gray-200 shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
          <FileText className="h-4 w-4 text-blue-700" />
          <p className="text-sm font-bold text-gray-900">{t("clinicalReport")}</p>
        </div>
        <div className="p-4 space-y-3">
          <p className="text-xs text-gray-500">
            {t("clinicalReportDescription")}
          </p>
          {clinicalPdfErr && (
            <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {clinicalPdfErr}
            </p>
          )}
          {clinicalPdfShareUrl && (
            <button
              onClick={() => handlePdfOpenClick(clinicalPdfShareUrl, () => setClinicalPdfShareUrl(null))}
              className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl text-sm font-semibold border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100 transition-colors"
            >
              <FileText className="h-4 w-4" /> {t("openPdfSafari")}
            </button>
          )}
          <button
            onClick={handleDownloadClinicalReport}
            disabled={downloadingClinicalPdf}
            className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl text-sm font-semibold bg-blue-700 text-white hover:bg-blue-800 disabled:opacity-50 transition-colors"
          >
            {downloadingClinicalPdf
              ? <><Loader2 className="h-4 w-4 animate-spin" /> {t("generatingReport")}</>
              : <><FileText className="h-4 w-4" /> {t("exportClinicalReport")}</>}
          </button>
        </div>
      </div>

      {/* Ficha Técnica PDF */}
      <div className="rounded-xl bg-white border border-gray-200 shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
          <FileText className="h-4 w-4 text-green-600" />
          <p className="text-sm font-bold text-gray-900">{t("orthobiologicSheet")}</p>
        </div>
        <div className="p-4 space-y-3">
          <p className="text-xs text-gray-500">
            {t("orthobiologicSheetDescription")}
          </p>
          {pdfErr && (
            <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {pdfErr}
            </p>
          )}
          {pdfShareUrl && (
            <button
              onClick={() => handlePdfOpenClick(pdfShareUrl, () => setPdfShareUrl(null))}
              className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl text-sm font-semibold border border-green-200 bg-green-50 text-green-700 hover:bg-green-100 transition-colors"
            >
              <FileText className="h-4 w-4" /> {t("openPdfSafari")}
            </button>
          )}
          <button
            onClick={handleDownloadReport}
            disabled={downloadingPdf}
            className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl text-sm font-semibold bg-green-600 text-white hover:bg-green-700 disabled:opacity-50 transition-colors"
          >
            {downloadingPdf
              ? <><Loader2 className="h-4 w-4 animate-spin" /> {t("generatingPdf")}</>
              : <><FileText className="h-4 w-4" /> {t("downloadTechnicalSheet")}</>}
          </button>
        </div>
      </div>

      {/* Consent shortcut */}
      <div className="rounded-xl bg-white border border-gray-200 shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
          <FileText className="h-4 w-4 text-blue-500" />
          <p className="text-sm font-bold text-gray-900">{t("consentTitle")}</p>
        </div>
        <div className="p-4">
          <p className="text-xs text-gray-500 mb-3">
            {t("consentCaseDescription")}
          </p>
          <a href={`${import.meta.env.BASE_URL}regen/consentimento?caseId=${caseId}`}
            className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl text-sm font-semibold bg-blue-600 text-white hover:bg-blue-700 transition-colors">
            <FileText className="h-4 w-4" /> {t("openConsents")}
          </a>
        </div>
      </div>
    </div>
  );
}

/**
 * Compact anamnesis summary card for the overview tab.
 * Handles both key-naming conventions (wizard vs AnamneseRegenTab) transparently.
 */
function AnamneseSummaryCard({
  anamnese,
  onGoToAnamnese,
}: {
  anamnese?: Record<string, any>;
  onGoToAnamnese: () => void;
}) {
  const t = useScopedTranslations(regenCoreMessages);
  const tr = useCaseTranslations();
  const a = anamnese ?? {};
  const isEmpty = Object.keys(a).length === 0;

  // ── Normalize cross-convention booleans ──
  const isTrue = (...keys: string[]) => keys.some(k => a[k] === true || a[k] === "sim" || a[k] === "frequente");
  const isFalse = (...keys: string[]) => keys.some(k => a[k] === false || a[k] === "não");
  const val = (...keys: string[]) => { for (const k of keys) if (a[k] != null && a[k] !== "") return a[k]; return null; };

  // ── Risk flags ──
  type RiskItem = { label: string; present: boolean; detail?: string; positive?: boolean };
  const risks: RiskItem[] = [
    {
      label: tr("Tabagismo"),
      present: isTrue("tabagismo") || a.tabagismo === "ex-fumante",
      detail: a.tabagismo === "ex-fumante" ? t("formerSmoker") : val("cigsDay", "tabagismo_qtd") ? `${val("cigsDay", "tabagismo_qtd")} cig/dia` : undefined,
    },
    {
      label: t("diabetes"),
      present: isTrue("diabetes") || ["DM1", "DM2", "pré-diabetes"].includes(a.diabetes ?? a.diabetesTipo ?? ""),
      detail: (() => {
        const tipo = a.diabetesTipo ?? (["DM1","DM2","pré-diabetes"].includes(a.diabetes) ? a.diabetes : undefined);
        const hba = val("diabetes_hba1c", "diabetesHba1c");
        return [tipo, hba ? `HbA1c ${hba}%` : undefined].filter(Boolean).join(" · ") || undefined;
      })(),
    },
    {
      label: t("obesity"),
      present: isTrue("obesidade") || (a.imc && Number(a.imc) >= 30) || (val("obesidade_imc", "obesidadeImc") && Number(val("obesidade_imc", "obesidadeImc")) >= 30),
      detail: val("obesidade_imc", "obesidadeImc") ? `IMC ${Number(val("obesidade_imc", "obesidadeImc")).toFixed(1)}` : undefined,
    },
    {
      label: t("insulinResistanceShort"),
      present: isTrue("resistencia_insulina", "resistIns"),
      detail: val("homa_ir", "homaIr") ? `HOMA-IR ${val("homa_ir", "homaIr")}` : undefined,
    },
    {
      label: t("autoimmuneDisease"),
      present: isTrue("autoimune"),
      detail: val("autoimune_qual", "autoimuneQual") as string | undefined,
    },
    {
      label: t("recentInfectionShort"),
      present: isTrue("infeccao_recente", "infeccaoRecente"),
      detail: val("infeccao_qual", "infeccaoQual") as string | undefined,
    },
    {
      label: t("caseFrequentAlcohol"),
      // wizard stores boolean true for "Uso de álcool frequente"; detail tab stores "frequente"
      present: a.alcool === "frequente" || a.alcool === true,
    },
    {
      label: t("corticosteroidsShort"),
      present: isTrue("corticoides", "medicCorticoide"),
    },
    {
      label: "AINEs",
      present: isTrue("aines", "medicAines"),
    },
    {
      label: t("anticoagulantsShort"),
      present: isTrue("anticoagulantes", "medicAnticoag"),
    },
    {
      label: t("immunosuppressantsShort"),
      present: isTrue("imunossupressores", "medicImunosupr"),
    },
    {
      label: t("statins"),
      present: isTrue("estatinas", "medicEstatinas"),
    },
    {
      label: t("sleepApnea"),
      present: isTrue("apneia"),
    },
    {
      label: t("caseSedentary"),
      present: isTrue("sedentarismo", "sedentario"),
    },
    // Nutrition risks
    {
      label: t("insufficientProtein"),
      // wizard: "insuficiente"; detail tab: "insuficiente"
      present: a.proteina === "insuficiente",
    },
    {
      label: t("highUltraProcessed"),
      // wizard stores boolean true for ToggleChip "Alto consumo ultraprocessados"
      // detail tab stores "frequente" string
      present: a.ultraproc === true || a.ultraprocessados === "frequente",
    },
    {
      label: t("caseLowFruitVegetables"),
      // wizard stores boolean true; detail tab stores "insuficiente"
      present: a.baixasFrutas === true || a.frutas_vegetais === "insuficiente",
    },
    // Positive factors
    {
      label: t("glp1Agonist"),
      present: isTrue("glp1_agonistas", "glp1Agonistas"),
      positive: true,
      detail: val("glp1_qual", "glp1Qual") as string | undefined,
    },
    {
      label: t("regularExercise"),
      present: isTrue("exercicio_regular", "exercRegular"),
      positive: true,
      detail: val("exercicio_freq", "exercFreq") as string | undefined,
    },
    {
      label: t("adequateProtein"),
      present: a.proteina === "adequada",
      positive: true,
    },
  ];

  const activeRisks    = risks.filter(r => !r.positive && r.present);
  const positiveFlags  = risks.filter(r =>  r.positive && r.present);
  const sleepHours     = val("sono_horas", "horasSono");
  const sleepQuality   = val("sono_qualidade", "qualidadeSono");
  const protein        = val("proteina");
  const anyData        = activeRisks.length > 0 || positiveFlags.length > 0 || sleepHours || sleepQuality;

  return (
    <div className="rounded-xl bg-white border border-gray-200 shadow-sm overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ClipboardList className="h-4 w-4 text-blue-500" />
          <p className="text-xs font-bold uppercase tracking-wider text-gray-600">{t("regenerativeHistory")}</p>
          {activeRisks.length > 0 && (
            <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-red-50 text-red-600 border border-red-200">
              {t("riskFactorCount", { count: activeRisks.length, suffix: activeRisks.length > 1 ? "es" : "" })}
            </span>
          )}
        </div>
        <button
          onClick={onGoToAnamnese}
          className="text-[10px] font-semibold text-blue-600 hover:text-blue-800 flex items-center gap-1 transition-colors"
        >
          <Pencil className="h-3 w-3" />
          {isEmpty ? t("fill") : t("edit")}
        </button>
      </div>

      <div className="px-4 py-3 space-y-3">
        {isEmpty ? (
          <div className="flex flex-col items-center justify-center py-6 gap-2 text-gray-400">
            <ClipboardList className="h-6 w-6" />
            <p className="text-xs text-center">
              {t("historyEmpty")}<br />
              <button onClick={onGoToAnamnese} className="text-blue-500 hover:underline font-medium">
                {t("clickToFill")}
              </button>
              {" "}{t("improveBioReady")}
            </p>
          </div>
        ) : (
          <>
            {/* Risk factors */}
            {activeRisks.length > 0 && (
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 mb-1.5">{t("riskFactors")}</p>
                <div className="flex flex-wrap gap-1.5">
                  {activeRisks.map(r => (
                    <span key={r.label}
                      className="flex items-center gap-1 px-2 py-1 rounded-full text-[11px] font-medium bg-red-50 text-red-700 border border-red-200">
                      <span className="h-1.5 w-1.5 rounded-full bg-red-500 shrink-0" />
                      {r.label}
                      {r.detail && <span className="opacity-70 ml-0.5">· {r.detail}</span>}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Positive factors */}
            {positiveFlags.length > 0 && (
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 mb-1.5">{t("favorableFactors")}</p>
                <div className="flex flex-wrap gap-1.5">
                  {positiveFlags.map(r => (
                    <span key={r.label}
                      className="flex items-center gap-1 px-2 py-1 rounded-full text-[11px] font-medium bg-green-50 text-green-700 border border-green-200">
                      <span className="h-1.5 w-1.5 rounded-full bg-green-500 shrink-0" />
                      {r.label}
                      {r.detail && <span className="opacity-70 ml-0.5">· {r.detail}</span>}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Quick metrics row */}
            {(sleepHours || sleepQuality || protein) && (
              <div className="flex flex-wrap gap-3 pt-1 border-t border-gray-100">
                {sleepHours && (
                  <div className="flex items-center gap-1.5 text-xs text-gray-600">
                    <Activity className="h-3 w-3 text-indigo-400 shrink-0" />
                    <span>{t("sleepMetric")} <strong>{sleepHours}{t("perNight")}</strong></span>
                    {sleepQuality && <span className={cn(
                      "px-1.5 py-0.5 rounded text-[10px] font-medium",
                      sleepQuality === "boa" ? "bg-green-50 text-green-700" :
                      sleepQuality === "regular" ? "bg-amber-50 text-amber-700" :
                      "bg-red-50 text-red-700"
                     )}>{tr(String(sleepQuality))}</span>}
                  </div>
                )}
                {protein && (
                  <div className="flex items-center gap-1.5 text-xs text-gray-600">
                    <TrendingUp className="h-3 w-3 text-emerald-400 shrink-0" />
                    <span>{t("proteinMetric")} <strong>{tr(String(protein))}</strong></span>
                  </div>
                )}
              </div>
            )}

            {/* No risks identified */}
            {activeRisks.length === 0 && anyData && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-green-50 border border-green-200 text-xs text-green-700">
                <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-green-500" />
                {t("noRiskFactors")}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
const STATUS_COLORS: Record<FactorStatus, { bg: string; border: string; dot: string; text: string }> = {
  green:  { bg: "#F0FDF4", border: "#BBF7D0", dot: "#16A34A", text: "#14532D" },
  yellow: { bg: "#FFFBEB", border: "#FDE68A", dot: "#D97706", text: "#78350F" },
  red:    { bg: "#FEF2F2", border: "#FECACA", dot: "#DC2626", text: "#7F1D1D" },
  na:     { bg: "#F8FAFC", border: "#E2E8F0", dot: "#94A3B8", text: "#475569" },
};

function BioReadyFactorRow({ factor }: { factor: BioReadyFactor }) {
  const t = useScopedTranslations(regenCoreMessages);
  const [expanded, setExpanded] = useState(false);
  const sc = STATUS_COLORS[factor.status];

  return (
    <div className="rounded-xl border overflow-hidden" style={{ borderColor: sc.border, background: sc.bg }}>
      <button
        className="w-full flex items-center gap-3 px-4 py-3 text-left"
        onClick={() => setExpanded(v => !v)}
      >
        {/* Dot indicator */}
        <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: sc.dot }} />

        {/* Label */}
        <span className="flex-1 text-sm font-medium" style={{ color: sc.text }}>{factor.label}</span>

        {/* Expand chevron */}
        {(factor.detail || factor.recommendation) && (
          expanded ? <ChevronUp className="h-3.5 w-3.5 shrink-0 text-gray-400" /> : <ChevronDown className="h-3.5 w-3.5 shrink-0 text-gray-400" />
        )}
      </button>

      {expanded && (
        <div className="px-4 pb-3 space-y-1.5 border-t" style={{ borderColor: sc.border }}>
          {factor.detail && (
            <p className="text-xs" style={{ color: sc.text }}>
              <span className="font-semibold">{t("currentSituation")}</span> {factor.detail}
            </p>
          )}
          {factor.recommendation && (
            <p className="text-xs" style={{ color: sc.text }}>
              <span className="font-semibold">{t("recommendation")}</span> {factor.recommendation}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function BioReadyScorePanel({
  result,
  onEditAnamnese,
}: {
  result: BioReadyResult;
  onEditAnamnese: () => void;
}) {
  const t = useScopedTranslations(regenCoreMessages);
  const { locale } = useLanguage();
  const [showFactors, setShowFactors] = useState(false);
  const clinicalStatus = getBioReadyClinicalStatus(result.grade);
  const clinicalLabel = locale === "es"
    ? ({ fit: "Apto", reassess: "Reevaluar", not_fit: "No apto" } as const)[clinicalStatus.status]
    : ({ fit: "Apto", reassess: "Reavaliar", not_fit: "Não apto" } as const)[clinicalStatus.status];

  // When too few factors are known, the score is not a reliable candidacy verdict.
  // Display a neutral "insufficient data" state rather than a potentially misleading grade.
  const incomplete = result.isIncomplete;

  const headerBg    = incomplete ? "#F9FAFB" : result.gradeBg;
  const headerColor = incomplete ? "#6B7280" : result.gradeColor;

  return (
    <div className="rounded-xl bg-white border shadow-sm overflow-hidden" style={{ borderColor: incomplete ? "#E5E7EB" : clinicalStatus.border }}>
      {/* Header */}
      <div className="px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3" style={{ background: headerBg, borderBottom: `1px solid ${headerColor}33` }}>
        <div className="flex items-center gap-2 flex-1">
          <FlaskConical className="h-4 w-4 shrink-0" style={{ color: headerColor }} />
          <div className="flex-1">
            <p className="text-xs font-bold uppercase tracking-wider" style={{ color: headerColor }}>
              BioReady Score®
            </p>
            <p className="text-[10px]" style={{ color: headerColor + "BB" }}>{t("biologicReadinessScore")}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <button
            type="button"
            onClick={onEditAnamnese}
            className="flex-1 sm:flex-none flex justify-center items-center gap-1.5 rounded-lg border border-blue-200 bg-white/80 px-2.5 py-1.5 text-xs sm:text-[10px] font-semibold text-blue-700 transition-colors hover:bg-white"
          >
            <Pencil className="h-3 w-3 shrink-0" />
             <span className="truncate">{incomplete ? t("fillHistory") : t("editHistory")}</span>
          </button>
          {incomplete && (
            <span className="flex-none text-[10px] px-2 py-1.5 sm:py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-200 font-medium whitespace-nowrap">
               {t("insufficientData")}
            </span>
          )}
        </div>
      </div>

      {/* Insufficient-data notice — replaces grade when < 4 factors are scored */}
      {incomplete && (
        <div className="px-5 py-4 space-y-3">
          <div className="flex items-start gap-3 rounded-xl bg-amber-50 border border-amber-200 px-4 py-3">
            <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
            <div>
              <p className="text-xs font-semibold text-amber-800">{t("insufficientHistoryScore")}</p>
              <p className="text-[11px] text-amber-700 mt-0.5">
                {t("completenessMessage", { percent: Math.round(result.dataCompleteness * 100), count: Math.round(result.dataCompleteness * 10) })}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onEditAnamnese}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-xs font-semibold text-white transition-colors hover:bg-blue-700"
          >
            <Pencil className="h-3.5 w-3.5" />
             {t("fillRegenHistory")}
          </button>

          {/* Still show factor rows so the clinician sees what's missing */}
          <button
            className="w-full flex items-center justify-center gap-1.5 text-xs text-gray-500 hover:text-gray-700 py-1 transition-colors"
            onClick={() => setShowFactors(v => !v)}
          >
            {showFactors ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
             {showFactors ? t("hide") : t("view")} {t("evaluatedFactorDetails")}
          </button>
          {showFactors && (
            <div className="space-y-2 pt-1">
              {result.factors.map(f => (
                <BioReadyFactorRow key={f.id} factor={f} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Full score panel — only shown when enough data is available */}
      {!incomplete && (
        <div className="px-5 py-4 space-y-4">
          <div
            className="flex items-center gap-3 rounded-xl border px-4 py-4"
            style={{ background: clinicalStatus.background, borderColor: clinicalStatus.border }}
          >
            <span className="h-4 w-4 shrink-0 rounded-full" style={{ background: clinicalStatus.color }} />
            <div className="flex-1">
              <p className="text-lg font-bold" style={{ color: clinicalStatus.color }}>{clinicalLabel}</p>

              {result.dataCompleteness < 1 && (
                <p className="text-[10px] text-amber-600 font-medium">
                   {t("evaluatedPercent", { percent: Math.round(result.dataCompleteness * 100) })}
                </p>
              )}
            </div>
          </div>

          {/* Top recommendations */}
          {result.topRecommendations.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-[10px] font-bold uppercase tracking-wide text-gray-500">
                 {t("recommendedActions")}
              </p>
              {result.topRecommendations.map((rec, i) => (
                <div key={i} className="flex items-start gap-2 text-xs text-gray-700 bg-gray-50 rounded-lg px-3 py-2 border border-gray-100">
                  <span className="shrink-0 font-bold text-gray-400">{i + 1}.</span>
                  <span>{rec}</span>
                </div>
              ))}
            </div>
          )}

          {/* Toggle factors */}
          <button
            className="w-full flex items-center justify-center gap-1.5 text-xs text-gray-500 hover:text-gray-700 py-1 transition-colors"
            onClick={() => setShowFactors(v => !v)}
          >
            {showFactors ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
             {showFactors ? t("hide") : t("view")} {t("tenFactorDetails")}
          </button>

          {showFactors && (
            <div className="space-y-2 pt-1">
              {result.factors.map(f => (
                <BioReadyFactorRow key={f.id} factor={f} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────
type Tab = "overview" | "anamnese" | "procedures" | "proms" | "ia";

export default function RegenCaso() {
  const t = useScopedTranslations(regenCoreMessages);
  const tr = useCaseTranslations();
  const { locale } = useLanguage();
  const params = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const caseId = params.id;

  const [tab, setTab]               = useState<Tab>("overview");
  const [c, setC]                   = useState<RegenCase | null>(null);
  const [procedures, setProcedures] = useState<Procedure[]>([]);
  const [proms, setProms]           = useState<PromResponse[]>([]);
  const [labs, setLabs]             = useState<LabResult[]>([]);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState<string | null>(null);
  const [anamneseOpen, setAnamneseOpen] = useState(false);

  const fetchCase = useCallback(async () => {
    try {
      const res = await fetch(`/regen-api/regen/cases/${caseId}`, { credentials: "same-origin", headers: authHeaders() });
      if (!res.ok) throw new Error(res.statusText);
      setC(await res.json());
    } catch {
      setError(t("caseNotFoundPermission"));
    }
  }, [caseId, t]);

  const fetchProcedures = useCallback(async () => {
    const res = await fetch(`/regen-api/regen/cases/${caseId}/procedures`, { credentials: "same-origin", headers: authHeaders() });
    if (res.ok) setProcedures(await res.json());
  }, [caseId]);

  const fetchProms = useCallback(async () => {
    const res = await fetch(`/regen-api/regen/cases/${caseId}/proms`, { credentials: "same-origin", headers: authHeaders() });
    if (res.ok) setProms(await res.json());
  }, [caseId]);

  const fetchLabs = useCallback(async () => {
    const res = await fetch(`/regen-api/regen/cases/${caseId}/labs`, { credentials: "same-origin", headers: authHeaders() });
    if (res.ok) setLabs(await res.json());
  }, [caseId]);

  useEffect(() => {
    setLoading(true);
    Promise.all([fetchCase(), fetchProcedures(), fetchProms(), fetchLabs()]).finally(() => setLoading(false));
  }, [fetchCase, fetchProcedures, fetchProms, fetchLabs]);

  const compCtx = useMemo(() => {
    if (!c) return {};
    const plateletLab = labs.find((lab) => /plaquet/i.test(lab.analyte));
    const hba1cLab = labs.find((lab) => /^HbA1c$/i.test(lab.analyte));
    const plateletCount = plateletLab?.value_num == null
      ? null
      : Number(plateletLab.value_num);
    const savedHba1c = c.hba1c == null ? null : Number(c.hba1c);
    const productCodes = [
      ...(c.planned_products ?? []),
      ...procedures.map((procedure) => procedure.product_code),
    ];
    return {
      // null = not yet assessed → no block until the clinician confirms it
      activeInfection: c.active_infection !== null ? c.active_infection : undefined,
      malignancy: c.malignancy !== null ? c.malignancy : undefined,
      anticoagulant: c.anticoagulant,
      immunosuppressed: c.immunosuppressed,
      dm: c.dm,
      hba1c: hba1cLab?.value_num == null
        ? (savedHba1c !== null && Number.isFinite(savedHba1c) ? savedHba1c : null)
        : Number(hba1cLab.value_num),
      imc: c.imc ? parseFloat(String(c.imc)) : null,
      patientAge: patientAgeFromDob(c.patient_dob),
      productCode: prpComplianceProduct(productCodes),
      plateletCount: plateletCount !== null && Number.isFinite(plateletCount)
        ? plateletCount
        : null,
      labFlagCount: labs.length === 0
        ? undefined
        : labs.filter((lab) => lab.flag === "H" || lab.flag === "L").length,
      adverseEvent: procedures.some((procedure) => procedure.adverse_event),
    };
  }, [c, labs, procedures]);

  const compliance = useMemo(() => evaluateCompliance(compCtx, "planejamento"), [compCtx]);

  // BioReady Score — computed from case + anamnese + labs + proms
  const bioReady = useMemo(() => {
    if (!c) return null;
    const latestVas  = [...proms].filter(p => p.instrument === "VAS").sort((a, b) => new Date(b.answered_at).getTime() - new Date(a.answered_at).getTime())[0]?.score ?? null;
    const plateletLab = labs.find(l => /plaquet/i.test(l.analyte));
    return computeBioReadyScore({
      // Only pass when explicitly confirmed (boolean); null = not yet assessed → scorer returns 'na'
      activeInfection: c.active_infection !== null ? c.active_infection : undefined,
      malignancy:      c.malignancy !== null ? c.malignancy : undefined,
      dm:              c.dm,
      hba1c:           c.hba1c ?? null,
      imc:             c.imc ? parseFloat(String(c.imc)) : null,
      anticoagulant:   c.anticoagulant,
      immunosuppressed: c.immunosuppressed,
      anamnese:        c.anamnese_regen ?? {},
      labFlagCount:    labs.length === 0 ? undefined : labs.filter(l => l.flag === "H" || l.flag === "L").length,
      plateletCount:   plateletLab ? parseFloat(String(plateletLab.value_num)) : null,
      latestVas,
      hasAdverseEvent: procedures.some(p => p.adverse_event),
      priorTreatments: c.prior_treatments ?? [],
    });
  }, [c, labs, proms, procedures]);

  const handleStatusChange = async (status: string) => {
    await fetch(`/regen-api/regen/cases/${caseId}`, {
      method: "PATCH", credentials: "same-origin", headers: authHeaders(),
      body: JSON.stringify({ status }),
    });
    await fetchCase();
  };

  const handleDelete = async () => {
    await fetch(`/regen-api/regen/cases/${caseId}`, {
      method: "DELETE", credentials: "same-origin", headers: authHeaders(),
    });
    navigate("/regen");
  };

  const handleAnamneseSaved = useCallback((updated: Record<string, any>) => {
    setC(prev => prev ? { ...prev, anamnese_regen: updated } : prev);
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
      </div>
    );
  }

  if (error || !c) {
    return (
      <div className="flex items-center justify-center py-24 px-6">
        <div className="text-center space-y-3">
          <AlertCircle className="h-10 w-10 mx-auto text-red-400" />
           <p className="text-gray-700 font-semibold">{error ?? t("caseNotFound")}</p>
          <button onClick={() => navigate("/regen")} data-analytics-destination="/regen"
            className="text-sm px-4 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors">
             {t("commonBack")}
          </button>
        </div>
      </div>
    );
  }

  const hasBlock = compliance.flags.some(f => f.severity === "block");

  return (
    <div className="max-w-5xl mx-auto w-full overflow-x-hidden sm:overflow-visible">

      {/* ── Mobile navy banner (hidden md+) ── */}
      <div className="md:hidden" style={{ background: "linear-gradient(135deg, #0B1F4B 0%, #0D2040 100%)" }}>
        <div className="px-4 pt-5 pb-3">
          <button
            onClick={() => navigate("/regen")}
            data-analytics-destination="/regen"
            style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, color: "rgba(14,154,167,0.85)", background: "none", border: "none", cursor: "pointer", padding: 0, marginBottom: 10 }}
          >
            <ArrowLeft className="h-3.5 w-3.5" /> {t("regenerative")}
          </button>
           <h1 style={{ fontSize: 20, fontWeight: 700, color: "#fff", margin: 0 }}>{t("regenerativeCase")}</h1>
          <p style={{ fontSize: 12, color: "rgba(255,255,255,0.55)", margin: "3px 0 0" }}>
            <span style={{ color: "#fff", fontWeight: 500 }}>{c.patient_name}</span>
            {" · "}{c.condition_code.replace(/_/g, " ")}
          </p>
        </div>
        <div className="px-4 pb-4 flex gap-2 flex-wrap">
          {c.patient_id && (
            <button onClick={() => navigate(`/patients/${c.patient_id}`)} data-analytics-destination="/patients/:id"
              style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, fontWeight: 500, padding: "8px 12px", borderRadius: 10, background: "rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.8)", border: "none", cursor: "pointer" }}>
               <ClipboardList className="h-4 w-4" /> {t("medicalRecord")}
            </button>
          )}
          <button onClick={() => navigate(`/regen/caso/novo?draft=${caseId}`)} data-analytics-destination="/regen/caso/novo"
            style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, fontWeight: 500, padding: "8px 12px", borderRadius: 10, background: "rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.8)", border: "none", cursor: "pointer" }}>
             <Pencil className="h-4 w-4" /> {t("edit")}
          </button>
        </div>
      </div>

      {/* ── Desktop header (hidden on mobile) ── */}
      <div className="hidden md:flex px-6 pt-6 pb-0 justify-between items-start gap-3">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate("/regen")}
            data-analytics-destination="/regen"
            className="w-9 h-9 rounded-lg flex items-center justify-center border border-gray-200 bg-white hover:bg-gray-50 transition-colors shrink-0"
          >
            <ArrowLeft className="h-4 w-4 text-gray-700" />
          </button>
          <div>
             <h1 className="text-2xl font-bold tracking-tight text-gray-900">{t("regenerativeCase")}</h1>
            <p className="text-sm text-gray-500 mt-0.5">
              <span className="font-medium text-gray-800">{c.patient_name}</span>
              {" · "}{c.condition_code.replace(/_/g, " ")}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <StatusBadge status={c.status} />
          {hasBlock && (
            <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-red-50 border border-red-200">
              <AlertCircle className="h-3.5 w-3.5 text-red-500" />
               <span className="text-xs text-red-700 font-semibold">{t("contraindication")}</span>
            </div>
          )}
          {c.patient_id && (
            <Button variant="outline" className="gap-2" onClick={() => navigate(`/patients/${c.patient_id}`)} data-analytics-destination="/patients/:id">
               <ClipboardList className="h-4 w-4" /> {t("medicalRecord")}
            </Button>
          )}
          <Button variant="outline" className="gap-2" onClick={() => navigate(`/regen/caso/novo?draft=${caseId}`)} data-analytics-destination="/regen/caso/novo">
             <Pencil className="h-4 w-4" /> {t("edit")}
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive" className="gap-2">
                 <Trash2 className="h-4 w-4" /> {t("delete")}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                 <AlertDialogTitle>{t("deleteCaseTitle")}</AlertDialogTitle>
                <AlertDialogDescription>
                   {t("deleteCaseDescription")}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                 <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
                <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                   {t("deletePermanently")}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>

      {/* ── Conteúdo simplificado: Status + Follow-up ── */}
      <div className="px-4 md:px-6 py-4 md:py-6 space-y-4">

        {/* BioReady Score + regenerative anamnesis access */}
        {bioReady && (
          <BioReadyScorePanel
            result={bioReady}
            onEditAnamnese={() => setAnamneseOpen(true)}
          />
        )}

        {compliance.flags.length > 0 && (
          <div className="rounded-xl p-4 space-y-3 bg-white border border-gray-200 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">
              {t("clinicalAlerts")}
            </p>
            <div className="space-y-2">
              {compliance.flags.map((flag) => <FlagBadge key={flag.code} flag={flag} />)}
            </div>
          </div>
        )}

        {/* Resumo do Caso */}
        {(() => {
          const PROD_LABELS: Record<string, string> = {
            PRP: "PRP", LP_PRP: "LP-PRP", LR_PRP: "LR-PRP", PRF: "PRF",
             AH: t("hyaluronicAcid"), COLAGENO: t("collagen"), BMAC: "BMA",
             MFAT: "MFAT", NANOFAT: "Nanofat", SVF: "SVF", LISADO: t("plateletLysate"),
             SUBCONDROPLASTIA: "Subcondroplastia", HIDROGEL: "Hidrogel", OUTRO: t("other"),
          };
          const rows: [string, string | null][] = [
             [t("condition"), c.condition_custom || c.condition_code.replace(/_/g, " ")],
             [t("side"), c.lado_articulacao ? ({
               direito: t("right"), Direito: t("right"),
               esquerdo: t("left"), Esquerdo: t("left"),
               bilateral: t("bilateral"), Bilateral: t("bilateral"),
             } as Record<string, string>)[c.lado_articulacao] ?? c.lado_articulacao : null],
             [t("hospital"), c.hospital_local ?? null],
             [t("date"), c.data_caso
               ? new Date(`${c.data_caso.slice(0, 10)}T12:00:00`).toLocaleDateString(locale)
               : null],
          ];
          const regionLabels: Record<string, string> = {
             quadril: t("hip"),
             pe_tornozelo: t("footAnkle"),
             punho_mao: t("wristHand"),
             coluna_cervical: t("cervicalSpine"),
             coluna_toracica: t("thoracicSpine"),
             coluna_lombar: t("lumbarSpine"),
             outras: t("otherRegions"),
          };
          const regionDiagnoses: [string, string][] = Object.entries(
            c.anamnese_regen?.diagnosticosPorRegiao ?? {},
          ).filter((entry): entry is [string, string] =>
            typeof entry[1] === "string" && entry[1].trim().length > 0,
          );
          const filled = rows.filter(([, v]) => v);
          const prods = c.planned_products ?? [];
          const applicationSites = parseApplicationSites(c.product_details);
          const applicationNotes = c.product_details?.observacoes ?? "";
          const meds = c.co_meds ?? [];
          const procedures = c.assoc_procedures ?? [];
          if (!filled.length && !regionDiagnoses.length && !prods.length && !applicationSites.length && !applicationNotes && !meds.length && !procedures.length) return null;
          return (
            <div className="rounded-xl p-4 space-y-3 bg-white border border-gray-200 shadow-sm">
               <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">{t("caseIdentification")}</p>
              {filled.length > 0 && (
                <div className="space-y-1.5">
                  {filled.map(([label, value]) => (
                    <div key={label} className="flex justify-between items-start gap-4 text-sm">
                      <span className="text-gray-500 shrink-0">{label}</span>
                      <span className="font-medium text-gray-900 text-right">{value}</span>
                    </div>
                  ))}
                </div>
              )}
              {regionDiagnoses.length > 0 && (
                <div>
                   <p className="text-xs text-gray-400 mb-1.5">{t("diagnosesByRegion")}</p>
                  <div className="space-y-1.5">
                    {regionDiagnoses.map(([regionId, diagnosis]) => (
                      <div key={regionId} className="text-sm">
                        <span className="font-medium text-gray-700">{regionLabels[regionId] ?? regionId}: </span>
                        <span className="text-gray-600">{diagnosis}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {prods.length > 0 && (
                <div>
                   <p className="text-xs text-gray-400 mb-1.5">{t("plannedProducts")}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {prods.map(code => (
                      <span key={code} className="text-xs px-2.5 py-1 rounded-full bg-blue-50 border border-blue-200 text-blue-700 font-medium">
                        {PROD_LABELS[code] ?? code}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {(applicationSites.length > 0 || applicationNotes) && (
                <div>
                  {applicationSites.length > 0 && (
                    <>
                      <p className="text-xs text-gray-400 mb-1.5">{t("applicationLocationNotes")}</p>
                      <div className="space-y-1.5">
                        {applicationSites.map((site, index) => (
                          <div key={index} className="flex flex-wrap justify-between items-start gap-x-4 gap-y-1 text-sm">
                            <span className="text-gray-700 font-medium">{t("applicationSite", { count: index + 1 })}</span>
                            <span className="text-gray-500 text-right">
                              {[site.localAplicacao, site.guia].filter(Boolean).map(tr).join(" · ")}
                            </span>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                  {applicationNotes && (
                    <p className="mt-1.5 text-sm text-gray-600 whitespace-pre-wrap">
                      <span className="font-medium text-gray-700">{t("observations")}: </span>
                      {applicationNotes}
                    </p>
                  )}
                </div>
              )}
              {meds.length > 0 && (
                <div>
                   <p className="text-xs text-gray-400 mb-1.5">{t("coadministeredMedications")}</p>
                  <div className="flex flex-col gap-1">
                    {meds.map((m, i) => (
                      <div key={i} className="flex justify-between items-center text-sm">
                        <span className="text-gray-700 font-medium">{m.name}</span>
                        {m.dose && <span className="text-gray-500 text-xs">{m.dose}</span>}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {procedures.length > 0 && (
                <div>
                   <p className="text-xs text-gray-400 mb-1.5">{t("associatedProcedures")}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {procedures.map(proc => (
                      <span key={proc} className="text-xs px-2.5 py-1 rounded-full bg-green-50 border border-green-200 text-green-700 font-medium">
                        {proc}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })()}

        {/* Status */}
        <div className="rounded-xl p-4 space-y-2 bg-white border border-gray-200 shadow-sm">
           <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">{t("caseStatus")}</p>
          <div className="flex gap-2 flex-wrap">
            {(["draft", "active", "closed"] as const).map(s => {
               const labels = { draft: t("statusDraft"), active: t("statusActive"), closed: t("statusClosed") };
              const isActive = c.status === s;
              return (
                <button key={s} onClick={() => handleStatusChange(s)}
                  className="px-3 py-1.5 rounded-lg border-2 text-xs font-semibold transition-all"
                  style={{
                    background:  isActive ? "#2563EB" : "#F9FAFB",
                    borderColor: isActive ? "#2563EB" : "#E5E7EB",
                    color:       isActive ? "#fff"    : "#6B7280",
                  }}>
                  {labels[s]}
                </button>
              );
            })}
          </div>
        </div>

        {/* Orientações Pós-Procedimento + Alertas — acima do follow-up */}
        {(c.planned_products ?? []).length > 0 && (() => {
          const PROC_MAP_POS: Record<string, string> = {
            PRP: "prp_articular", LP_PRP: "prp_articular", LR_PRP: "prp_articular",
            AH: "prp_articular", COLAGENO: "prp_articular",
            BMAC: "ctm_osso", MFAT: "ctm_osso", NANOFAT: "ctm_osso", SVF: "ctm_osso",
            SUBCONDROPLASTIA: "ctm_osso", HIDROGEL: "prp_articular", OUTRO: "prp_articular",
          };
          const seen = new Set<string>();
          const unique = (c.planned_products ?? []).filter(code => {
            const key = PROC_MAP_POS[code];
            if (!key) return false;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          });
          if (!unique.length) return null;
          return (
            <div className="space-y-2">
               <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 px-1">{t("postProcedureOrientations")}</p>
              {unique.map(code => (
                <OrientacoesInline
                  key={code}
                  productCode={code}
                  patientPhone={c.patient_phone ?? undefined}
                  defaultTab="pos"
                  defaultOpen={false}
                />
              ))}
            </div>
          );
        })()}

        {/* Follow-up */}
        <div className="pt-1">
          <div className="flex items-center gap-2 px-1 mb-3">
            <Send className="h-4 w-4 text-blue-500" />
            <p className="text-xs font-bold uppercase tracking-wide text-gray-500">{t("followup")}</p>
          </div>
          <RegenFollowupTimeline caseId={caseId} patientPhone={c?.patient_phone ?? undefined} />
        </div>

      </div>

      {anamneseOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-3 sm:p-6"
          role="presentation"
          onMouseDown={event => {
            if (event.target === event.currentTarget) setAnamneseOpen(false);
          }}
        >
          <div
            className="flex max-h-[calc(100vh-1.5rem)] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-gray-50 shadow-2xl sm:max-h-[calc(100vh-3rem)]"
            role="dialog"
            aria-modal="true"
            aria-labelledby="anamnese-regen-dialog-title"
          >
            <div className="flex items-center justify-between border-b border-gray-200 bg-white px-4 py-3 sm:px-5">
              <div>
                <p id="anamnese-regen-dialog-title" className="text-sm font-bold text-gray-900">
                   {t("regenerativeHistory")}
                </p>
                <p className="mt-0.5 text-xs text-gray-500">
                   {t("historyAutosaveHelp")}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setAnamneseOpen(false)}
                 aria-label={t("closeRegenHistory")}
                className="rounded-lg p-2 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="overflow-y-auto p-3 sm:p-5">
              <AnamneseRegenTab
                caseId={caseId}
                initial={c.anamnese_regen ?? {}}
                onSaved={handleAnamneseSaved}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
