import { useState, useEffect, useMemo, useRef } from "react";
import { useLocation, Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { useCreateSurgery, useListPatients, useCalculateKrirs, useCalculatePics } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, ArrowRight, Save, Activity, CheckCircle2, AlertTriangle, ChevronDown, Camera, BookmarkCheck, Loader2 } from "lucide-react";
import { useSubscriptionStatus } from "@/hooks/use-subscription-status";
import { SubscriptionGate } from "@/components/subscription-gate";
// Permissive aliases: this form contains additional clinical fields not yet
// described in the OpenAPI spec; we keep them open to avoid blocking real clinical work.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CreateSurgeryBody = Record<string, any>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type KrirsInput = Record<string, any>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PicsInput = Record<string, any>;
import { cn, sortByPtBrName } from "@/lib/utils";
import { XRayAnalyzer } from "@/components/xray-analyzer";
import { PTSAnalyzer } from "@/components/pts-analyzer";
import { classifyPTS } from "@/lib/pts-classification";
import { AclDecisionModule } from "@/components/acl-decision-module";
import { SurgeryMedia } from "@/components/surgery-media";
import { SurgeryPreopFollowupCard } from "@/components/preop-followup-card";
import { runOcdAlgorithm, buildOcdInputFromForm, type OcdOutput } from "@/lib/ocd-algorithm";
import { useLanguage, useScopedTranslations } from "@/lib/i18n";
import { surgeryCoreMessages } from "@/locales/surgery-core";
import { surgeryNewDisplayLabels, surgeryNewMessages } from "@/locales/surgery-new";
import { surgeryNewExamLabels } from "@/locales/surgery-new-exam";
import { surgeryNewArthroplastyDisplayLabels, surgeryNewArthroplastyMessages } from "@/locales/surgery-new-arthroplasty";
import { surgeryNewTraumaDisplayLabels, surgeryNewTraumaMessages } from "@/locales/surgery-new-trauma";
import {
  CPM_LCM_RECONSTRUCTION_TECHNIQUES,
  displayOcdPlanningText,
  displaySurgeryTechniqueOption,
  surgeryNewTechniquesMessages,
} from "@/locales/surgery-new-techniques";
import { getKrirsDisplayJustification, getKrirsRiskLabel, getKrirsRiskLevel } from "@/lib/krirs-risk";
import {
  clearMeniscalProcedureDetails,
  getMeniscalSideDetails,
  removeMeniscalSideDetails,
  sideDetailsKey,
  sideSelectionKey,
  type MeniscalSide,
  type MeniscalSideDetails,
} from "@/lib/meniscal-details";
import {
  createLimbSnapshot,
  hasSubstantiveLimbDocumentation,
  readBilateralDocumentation,
  updateStoredLimbSnapshot,
  writeBilateralDocumentation,
  type LimbSnapshot,
  type SurgeryLimb,
} from "@/lib/bilateral-surgery";

// ── HospitalField: dropdown com serviços vinculados + locais favoritos + texto livre ──
function HospitalField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const t = useScopedTranslations(surgeryNewMessages);
  const { locale } = useLanguage();
  const [services, setServices] = useState<{ id: number; nome: string }[]>([]);
  const [locations, setLocations] = useState<{ id: number; nome: string }[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const fetchOpts = { credentials: "same-origin" as const };
    Promise.all([
      fetch("/api/doctor/services", fetchOpts).then(r => r.json()).catch(() => []),
      fetch("/api/doctor/locations", fetchOpts).then(r => r.json()).catch(() => []),
    ]).then(([s, l]) => {
      setServices(Array.isArray(s) ? sortByPtBrName(s, (service) => service.nome, (service) => service.id) : []);
      setLocations(Array.isArray(l) ? sortByPtBrName(l, (location) => location.nome, (location) => location.id) : []);
    });
  }, []);

  const suggestions = [
    ...services.map(s => ({ label: s.nome, group: "Serviços Vinculados" })),
    ...locations.map(l => ({ label: l.nome, group: "Locais Favoritos" })),
  ];

  const filtered = suggestions.filter(s => s.label.toLowerCase().includes(value.toLowerCase()));
  const showDropdown = open && filtered.length > 0;

  return (
    <div className="relative">
      <Input
        placeholder={t("hospitalPlaceholder")}
        value={value}
        onChange={e => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        autoComplete="off"
      />
      {showDropdown && (
        <div className="absolute z-50 mt-1 w-full rounded-lg border border-border bg-popover shadow-lg overflow-hidden">
          {(() => {
            let lastGroup = "";
            return filtered.map((s, i) => {
              const showHeader = s.group !== lastGroup;
              lastGroup = s.group;
              return (
                <div key={i}>
                  {showHeader && (
                    <div className="px-3 py-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide bg-muted/40">
                      {surgeryNewDisplayLabels[locale][s.group] ?? s.group}
                    </div>
                  )}
                  <button
                    type="button"
                    className="w-full text-left px-3 py-2 text-sm hover:bg-muted/60 transition-colors"
                    onMouseDown={() => { onChange(s.label); setOpen(false); }}
                  >
                    {s.label}
                  </button>
                </div>
              );
            });
          })()}
        </div>
      )}
    </div>
  );
}

async function apiDraft(body: Record<string, any>, errorMessage: string): Promise<{ id: number }> {
  const res = await fetch("/api/surgeries/draft", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error((await res.json()).error ?? errorMessage);
  return res.json();
}

async function apiFinalize(id: number, body: Record<string, any>, errorMessage: string): Promise<{ id: number }> {
  const res = await fetch(`/api/surgeries/${id}/finalize`, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error((await res.json()).error ?? errorMessage);
  return res.json();
}

async function apiGetSurgery(id: number): Promise<any> {
  const res = await fetch(`/api/surgeries/${id}`, {
    credentials: "same-origin",
  });
  if (!res.ok) return null;
  return res.json();
}

const ENXERTOS_LIGAMENTAR = [
  "Tendão Patelar (BTB)",
  "Isquiotibiais (Grácil + Semitendíneo)",
  "Tendão Quadricipital",
  "Tendão do Reto Femoral",
  "Grácil",
  "Semitendíneo",
  "Fibular Longo",
  "Hemifibular",
  "Aloenxerto",
  "Ligamento Sintético (LARS)",
  "Outro",
];

const TIPOS_CASO = [
  { value: "Lesão Ligamentar", label: "Lesão Ligamentar", desc: "LCA, LCP, CPL, CPM" },
  { value: "Lesão Meniscal", label: "Lesão Meniscal", desc: "Meniscectomia, sutura, transplante" },
  { value: "Instabilidade Patelar", label: "Instabilidade Patelar", desc: "MPFL, tibialização, trocleoplastia" },
  { value: "Osteotomia", label: "Osteotomia", desc: "Tibial, femoral, dupla, correção SLOP — isolada ou associada" },
  { value: "Lesões Osteocondrais", label: "Lesões Osteocondrais", desc: "Lesão osteocondral, microfraturas, mosaicoplastia" },
  { value: "Artroplastias", label: "Artroplastias", desc: "Artroplastia total, unicompartimental, revisão" },
  { value: "Ortobiológicos", label: "Ortobiológicos", desc: "PRP, células-tronco, scaffold" },
  { value: "Outros Procedimentos", label: "Outros Procedimentos", desc: "Bloqueio genicular, rizotomia, onda de choque, laser" },
  { value: "Fraturas", label: "Fraturas", desc: "Platô tibial, patela, fêmur distal, periprotética" },
  { value: "Rupturas Tendíneas", label: "Rupturas Tendíneas", desc: "Tendão patelar, tendão quadricipital" },
];

const FRATURAS_ITEMS = [
  "Fratura do Platô Tibial",
  "Fratura de Patela",
  "Fratura do Fêmur Distal",
  "Fratura de Eminência Tibial (Avulsão do LCA)",
  "Fratura Osteocondral",
  "Fratura Periprotética",
];

const TENDOES_ITEMS = [
  "Ruptura do Tendão Patelar",
  "Ruptura do Tendão Quadríceps",
];

const DISTAL_FEMUR_AO_OTA: { value: string; label: string }[] = [
  { value: "33A", label: "33A — Extra-articular" },
  { value: "33B", label: "33B — Partial articular (unicondilar)" },
  { value: "33C", label: "33C — Completa articular (bicondilar)" },
];
const DISTAL_FEMUR_ACESSO = ["Anterolateral", "Lateral", "Medial", "Anteromedial", "Duplo (medial e lateral)", "Minimamente invasivo"];
const DISTAL_FEMUR_CIRURGIA = [
  "Placa bloqueada lateral",
  "Placa bloqueada medial",
  "Haste intramedular retrógrada",
  "Haste intramedular anterógrada",
  "Parafusos canulados 4,5",
  "Parafusos canulados 7,0",
  "Parafuso hebert",
  "Fixador externo circular",
];
const DISTAL_FEMUR_LESOES_ASSOCIADAS = ["LCA", "LCP", "LCM", "LCL", "LPFM", "Menisco medial", "Menisco lateral", "Lesão osteocondral"];

const TIBIAL_PLATEAU_SCHATZKER: { value: string; label: string }[] = [
  { value: "I",   label: "I — Cisalhamento lateral puro" },
  { value: "II",  label: "II — Cisalhamento + depressão lateral" },
  { value: "III", label: "III — Depressão central (sem fratura da cortical)" },
  { value: "IV",  label: "IV — Fratura do platô medial" },
  { value: "V",   label: "V — Bicondilar (sem dissociação metafisária)" },
  { value: "VI",  label: "VI — Bicondilar + dissociação metafisária" },
];
const TIBIAL_PLATEAU_ACESSO = ["Anterolateral", "Anteromedial", "Posteromedial", "Posterolateral", "Duplo (anterolateral e posteromedial)", "Minimamente invasivo"];
const TIBIAL_PLATEAU_CIRURGIA = [
  "Placa bloqueada lateral",
  "Placa medial",
  "Placa posterior",
  "Parafuso canulado 4,5",
  "Parafuso canulado 7,0",
  "Parafuso hebert",
  "Fios de Kirschner",
  "Placa em cinta",
  "Haste intramedular bloqueada",
];
const TIBIAL_PLATEAU_LESOES_ASSOCIADAS = ["LCA", "LCP", "LCM", "LCL", "LPFM", "Menisco medial", "Menisco lateral", "Lesão osteocondral"];

const PATELLA_AO_OTA: { value: string; label: string }[] = [
  { value: "34A", label: "34A — Extra-articular (avulsão polar ou sleeve)" },
  { value: "34B", label: "34B — Parcial articular (osteocondral ou vertical)" },
  { value: "34C", label: "34C — Articular completa (transversa ou cominutiva)" },
];
const PATELLA_ACESSO = ["Longitudinal anterior", "Parapatelar medial", "Parapatelar lateral", "Minimamente invasivo"];
const PATELLA_CIRURGIA = ["Banda de tensão com fio de aço", "Parafusos canulados", "Parafusos de Herbert", "Fio de aço", "Fiber tape", "Placa patelar anterior", "Patelectomia parcial", "Patelectomia total"];
const PATELLA_LESOES_ASSOCIADAS = ["LCA", "LCP", "LCM", "LCL", "LPFM", "Menisco medial", "Menisco lateral", "Lesão osteocondral"];

const TIBIAL_SPINE_MEYERS: { value: string; label: string }[] = [
  { value: "I",   label: "I — Sem deslocamento" },
  { value: "II",  label: "II — Levantamento anterior (dobradiça posterior intacta)" },
  { value: "III", label: "III — Deslocamento completo sem rotação" },
  { value: "IV",  label: "IV — Deslocamento completo com rotação (Zaricznyj)" },
];
const TIBIAL_SPINE_TECNICA = ["Artroscópica (vídeo)", "Aberta", "Conversão artroscópica → aberta"];
const TIBIAL_SPINE_MATERIAL_SUTURA = ["Ethibond", "FiberWire"];
const TIBIAL_SPINE_LESOES_ASSOCIADAS = ["LCA", "LCP", "LCM", "LCL", "LPFM", "Menisco medial", "Menisco lateral", "Lesão osteocondral"];
const TIBIAL_SPINE_LCA_SUBTIPO = ["Lesão de alongamento", "Lesão parcial", "Lesão completa"];

const LIGAMENTOS = [
  { value: "LCA", label: "LCA", desc: "Ligamento Cruzado Anterior" },
  { value: "LCP", label: "LCP", desc: "Ligamento Cruzado Posterior" },
  { value: "CPL", label: "CPL", desc: "Canto Póstero-Lateral (LCL + Tend. Poplíteo + LPF)" },
  { value: "CPM", label: "CPM", desc: "Canto Póstero-Medial (LCM ± LOP)" },
];

const MAX_WIZARD_STEPS = 7;

export default function NewSurgeryWizard() {
  const t = useScopedTranslations(surgeryCoreMessages);
  const tn = useScopedTranslations(surgeryNewMessages);
  const ta = useScopedTranslations(surgeryNewArthroplastyMessages);
  const tt = useScopedTranslations(surgeryNewTraumaMessages);
  const ttech = useScopedTranslations(surgeryNewTechniquesMessages);
  const { locale } = useLanguage();
  const displayOption = (value: string) => surgeryNewDisplayLabels[locale][value] ?? value;
  const displayTechniqueOption = (value: string) => displaySurgeryTechniqueOption(locale, value);
  const displayPlanningText = (value: string) => displayOcdPlanningText(locale, value);
  const examLabel = (value: string) => surgeryNewExamLabels[locale][value] ?? value;
  const displayArthroplastyOption = (value: string) => surgeryNewArthroplastyDisplayLabels[locale][value] ?? displayOption(value);
  const traumaOption = (value: string) => surgeryNewTraumaDisplayLabels[locale][value] ?? value;
  const { canWrite, loading: subLoading } = useSubscriptionStatus();
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const [{ initialPatientId, draftIdParam, initialStep }] = useState(() => {
    const searchParams = new URLSearchParams(window.location.search);
    const requestedStep = Number(searchParams.get("step"));
    return {
      initialPatientId: searchParams.get("patientId") ? parseInt(searchParams.get("patientId")!, 10) : undefined,
      draftIdParam: searchParams.get("draft") ? parseInt(searchParams.get("draft")!, 10) : undefined,
      initialStep: Number.isInteger(requestedStep) && requestedStep >= 1 && requestedStep <= MAX_WIZARD_STEPS
        ? requestedStep
        : 1,
    };
  });

  const { data: patients } = useListPatients();
  const createSurgeryMutation = useCreateSurgery();
  const krirsMutation = useCalculateKrirs();
  const picsMutation = useCalculatePics();

  const [step, setStep] = useState(initialStep);
  const [rxTab, setRxTab] = useState<"panoramic" | "pts">("panoramic");
  const [draftId, setDraftId] = useState<number | undefined>(draftIdParam);
  const [isDraftSaving, setIsDraftSaving] = useState(false);
  const [draftLoaded, setDraftLoaded] = useState(false);
  const [activeLimb, setActiveLimb] = useState<SurgeryLimb>("direito");
  const activeLimbRef = useRef<SurgeryLimb>("direito");
  const [limbSnapshots, setLimbSnapshots] = useState<Partial<Record<SurgeryLimb, LimbSnapshot>>>({});
  const limbSnapshotsRef = useRef<Partial<Record<SurgeryLimb, LimbSnapshot>>>({});
  const initialLimbSnapshotRef = useRef<LimbSnapshot | null>(null);

  useEffect(() => {
    if (!draftId) return;
    const url = new URL(window.location.href);
    const stepValue = String(step);
    if (url.searchParams.get("draft") === String(draftId) && url.searchParams.get("step") === stepValue) return;
    url.searchParams.set("draft", String(draftId));
    url.searchParams.set("step", stepValue);
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  }, [draftId, step]);

  const [formData, setFormData] = useState<Partial<CreateSurgeryBody>>({
    patientId: initialPatientId,
    dataCirurgia: new Date().toISOString().split("T")[0],
    hospital: "",
    tipoCaso: "",
    diagnostico: "",
    alinhamento: "",
    grauAlinhamento: "",
    tiposProcedimento: [],
    ligamentosAcometidos: [],
    enxerto: "",
    diametroEnxerto: "",
    tunelFemoral: "",
    tunelFemoralPediatrico: "",
    tunelTibialPediatrico: "",
    fixacaoFemoral: "",
    fixacaoTibial: "",
    flipCutter: "",
    internalBrace: "",
    tipoLca: "Reconstrução",
    localizacaoLesaoLca: "",
    fixacaoReparoLca: "",
    preservacaoRemanescente: "",
    reforco: "",
    procedimentoRealizado: "",
    observacoes: "",
    rxAnaliseJson: "",
    rxImageUrl: "",
    slopeTibialJson: "",
    exameLigamentar: {},
    lcaAlgorithm: {},
    aclLeapDecision: null as any,
    procedimentoMeniscal: {},
    examePatelar: {},
    picsScore: {},
  });

  // Clinical data used for KRIRS calculation (not sent directly in body, fed to algorithm)
  const [clinicalData, setClinicalData] = useState({
    esportePivot: false,
    beightonScore: 0,
    revisao: false,
    lesaoCronica: false,
    nivelAtividade: "",
    lado: "",
  });

  // Structured procedure sections state
  const [activeProcSections, setActiveProcSections] = useState<Set<string>>(new Set());
  const [activeMeniscalSide, setActiveMeniscalSide] = useState<MeniscalSide | null>(null);
  const [extraArticular, setExtraArticular] = useState({ let: false, lal: false, lalBanda: "", lalEnxerto: "", lalFixacao: "", loa: false, loaEnxerto: "", loaFixacao: "", leap: "", letTecnica: "", letEnxerto: "", letFixacao: "" });
  const [osteotomia, setOsteotomia] = useState({
    tibial: false, tibialTipo: "", tibialLado: "", tibialAngulo: "",
    femoral: false, femoralTipo: "", femoralLado: "", femoralAngulo: "",
    dupla: false,
    duplaFemoralTipo: "", duplaFemoralLado: "", duplaFemoralAngulo: "",
    duplaTibialTipo: "", duplaTibialLado: "", duplaTibialAngulo: "",
    slop: false, slopGrau: "",
    enxertoOsseo: false, enxertoOsseoTipo: "",
  });
  const [ortobiologico, setOrtobiologico] = useState<{
    bma: boolean; ha: boolean; prp: boolean;
    hidrogel: boolean; gorduraMicroFragmentada: boolean; svf: boolean; exossomos: boolean;
    diagnosticoTipos: string[]; diagnosticoAhlback: string;
    diagnosticoLigamento: string; diagnosticoEdemaLocal: string;
  }>({ bma: false, ha: false, prp: false, hidrogel: false, gorduraMicroFragmentada: false, svf: false, exossomos: false, diagnosticoTipos: [], diagnosticoAhlback: "", diagnosticoLigamento: "", diagnosticoEdemaLocal: "" });
  const [outrosProcedimentos, setOutrosProcedimentos] = useState<string[]>([]);
  const [fraturas, setFraturas] = useState<string[]>([]);
  const [tendoes, setTendoes] = useState<string[]>([]);
  const [patelarTendon, setPatelarTendon] = useState({
    classificacao: "",
    dataLesao: "",
    dataCirurgiaDefinitiva: "",
    cirurgia: [] as string[],
    cirurgiaOutro: "",
    reforco: false,
    reforcoTipo: [] as string[],
    reforcoTendao: [] as string[],
    reforcoTendaoOutro: "",
    imageUrls: [] as string[],
    observacoes: "",
  });
  const [quadricepsTendon, setQuadricepsTendon] = useState({
    classificacao: "",
    dataLesao: "",
    dataCirurgiaDefinitiva: "",
    cirurgia: [] as string[],
    cirurgiaOutro: "",
    reforco: false,
    reforcoTipo: [] as string[],
    reforcoTendao: [] as string[],
    reforcoTendaoOutro: "",
    imageUrls: [] as string[],
    observacoes: "",
  });
  const [tendinopatiaSubtipos, setTendinopatiaSubtipos] = useState<string[]>([]);
  const [patelarTecnica, setPatelarTecnica] = useState({
    tecnicas: [] as string[],
    mpflEnxerto: "",
    mpflFixacaoPatelar: "",
    mpflFixacaoFemoral: "",
    mpflTensao: "",
    ttoTipo: "",
    ttoFixacao: "",
    trocleoplastiaTipo: "",
    trocleoplastiaFixacao: "",
    retinaculoLateral: "",
    observacoes: "",
  });
  const [osteocondralTecnica, setOsteocondralTecnica] = useState({
    procedimentos: [] as string[],
    nanofraturasTecnica: "",
    oatsDiametroMm: "",
    oatsNumPlugs: "",
    fixacaoOcdTipo: "",
    adjuvantes: [] as string[],
    observacoes: "",
  });
  const [artroplastiaTecnica, setArtroplastiaTecnica] = useState({
    alinhamentoMembro: [] as string[],
    gonartroseMedial: "",
    gonartroseMedialAhlback: "",
    gonartroseLateral: "",
    femoropatelar: "",
    flexaoGraus: "",
    extensaoGraus: "",
    instabilidade: "",
    instabilidadeGrau: "",
    instabilidadeAhlback: "",
    tipo: "",
    compartimento: "",
    tecnologia: "",
    tipoImplante: "",
    tipoAcesso: "",
    protesePatelar: "",
    marca: "",
    fixacao: "",
    garrote: "",
    txa: "",
    revisaoComponentes: "",
    componenteFemoral: "",
    componenteTibial: "",
    polietileno: "",
    hasteFemoral: "",
    hasteFemoralTamanho: "",
    hasteFemoralEspessura: "",
    hasteTibial: "",
    hasteTibialTamanho: "",
    hasteTibialEspessura: "",
    calcosFemoral: [] as string[],
    calcosTibial: [] as string[],
    coneMetafisario: "",
    coneMetafisarioLocal: "",
    defeitoOsseo: false,
    aoriGrauFemoral: "",
    aoriGrauTibial: "",
    observacoes: "",
    infeccao: false,
    infeccaoTempo: "" as "" | "1 Tempo" | "2 Tempos" | "Outras Opções",
    infeccaoEtapa: "" as "" | "Retirada de Prótese e Colocação de Espaçador" | "Troca de Espaçador" | "Retirada de Espaçador e Colocação de Prótese",
    infeccaoOutrasOpcao: "" as "" | "Artrodese" | "Amputação",
    infeccaoArtrodese: "" as "" | "Fixador externo circular" | "Fixador externo linear" | "Placa e parafusos" | "Parafusos canulados" | "Haste intramedular",
  });
  const [lcpTecnica, setLcpTecnica] = useState({ grauLesao: "", tecnica: "", tecnicaCustom: "", enxerto: "", diametroEnxerto: "", flipCutter: "", fixacaoFemoral: "", fixacaoTibial: "", fixacaoAnteromedial: "", fixacaoPosterolateral: "", justificativa: "" });
  const [cpmTecnica, setCpmTecnica] = useState({
    abordagem: "" as "" | "lcm_isolado" | "lcm_lop" | "reparo_lcm" | "recon_reparo",
    lcmTecnica: "",
    lcmTecnicaCustom: "",
    lcmEnxerto: "",
    lcmFixacaoProximal: "",
    lcmFixacaoDistal: "",
    lcmReparoTecnica: "",
    lcmReparoTecnicaCustom: "",
    lopTecnica: "",
    lopTecnicaCustom: "",
    lopEnxerto: "",
    lopFixacao: "",
    justificativa: "",
  });
  const [cplTecnica, setCplTecnica] = useState({
    tecnica: "",
    tecnicaCustom: "",
    enxertos: [{ nome: "", diametro: "" }] as { nome: string; diametro: string }[],
    fixacaoFemoral1: "",
    fixacaoFemoral2: "",
    fixacaoFibular: "",
    fixacaoTibial: "",
    reaAssociada: false,
    reaTipo: "",
    justificativa: "",
  });
  const [periprosthetic, setPeriprosthetic] = useState({
    classificacaoFemur: "",
    classificacaoTibia: "",
    classificacaoPatela: "",
    estoquePatelarMm: "",
    controleDanos: false,
    controleDanosData: "",
    controleDanosIndicacao: [] as string[],
    controleDanosIndicacaoOutro: "",
    controleDanosProcedimento: [] as string[],
    controleDanosProcedimentoOutro: "",
    definitivaData: "",
    localizacao: [] as { estrutura: string; lado: string; classificacao: string; tipo: string }[],
    acessoFemur: [] as string[],
    acessoFemurOutro: "",
    extensaoAbordagem: false,
    extensaoAbordagemTipo: "",
    extensaoAbordagemOutro: "",
    acessoTibia: [] as string[],
    cirurgia: [] as string[],
    cirurgiaOutro: "",
    complicacoesAgudas: [] as string[],
    complicacoesAgudasOutro: "",
    complicacoesTardias: [] as string[],
    complicacoesTardiasOutro: "",
    observacoes: "",
  });
  const [legacyPeriprostheticComplications, setLegacyPeriprostheticComplications] = useState<{
    agudas: unknown[] | null;
    tardias: unknown[] | null;
  }>({ agudas: null, tardias: null });

  // On mobile, a vertical swipe that starts on a selectable button can
  // occasionally produce a click on touchend. Keep that gesture from
  // toggling the button the user used to start scrolling.
  const pointerGestureRef = useRef<{ pointerId: number; pointerType: string; x: number; y: number } | null>(null);
  const suppressTapAfterScrollRef = useRef(false);
  const handleWizardPointerDownCapture = (event: React.PointerEvent<HTMLFormElement>) => {
    if (event.pointerType === "touch" || event.pointerType === "pen") {
      pointerGestureRef.current = {
        pointerId: event.pointerId,
        pointerType: event.pointerType,
        x: event.clientX,
        y: event.clientY,
      };
      suppressTapAfterScrollRef.current = false;
    }
  };
  const handleWizardPointerMoveCapture = (event: React.PointerEvent<HTMLFormElement>) => {
    const gesture = pointerGestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId || gesture.pointerType !== event.pointerType) return;
    if (Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) > 8) {
      suppressTapAfterScrollRef.current = true;
    }
  };
  const handleWizardClickCapture = (event: React.MouseEvent<HTMLFormElement>) => {
    if (!suppressTapAfterScrollRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    suppressTapAfterScrollRef.current = false;
  };

  const [distalFemur, setDistalFemur] = useState({
    classificacaoAoOta: "",
    classificacaoSubtipo: "",
    controleDanos: false,
    controleDanosData: "",
    dataLesao: "",
    dataCirurgiaDefinitiva: "",
    acesso: [] as string[],
    acessoOutro: "",
    cirurgia: [] as string[],
    cirurgiaOutro: "",
    opme: [] as string[],
    enxertoOsseo: false,
    complicacoesAgudas: [] as string[],
    complicacoesAgudasOutro: "",
    complicacoesTardias: [] as string[],
    complicacoesTardiasOutro: "",
    lesoesAssociadas: [] as string[],
    lesoesAssociadasOutro: "",
    observacoes: "",
  });

  const [tibialPlateau, setTibialPlateau] = useState({
    classificacaoSchatzker: "",
    controleDanos: false,
    controleDanosData: "",
    dataLesao: "",
    dataCirurgiaDefinitiva: "",
    acesso: [] as string[],
    acessoOutro: "",
    cirurgia: [] as string[],
    cirurgiaOutro: "",
    opme: [] as { item: string; quantidade: string }[],
    enxertoOsseo: false,
    complicacoesAgudas: [] as string[],
    complicacoesAgudasOutro: "",
    complicacoesTardias: [] as string[],
    complicacoesTardiasOutro: "",
    lesoesAssociadas: [] as string[],
    lesoesAssociadasOutro: "",
    observacoes: "",
  });

  const [patella, setPatella] = useState({
    classificacaoAoOta: "",
    classificacaoSubtipo: "",
    dataLesao: "",
    dataCirurgiaDefinitiva: "",
    acesso: [] as string[],
    acessoOutro: "",
    cirurgia: [] as string[],
    cirurgiaOutro: "",
    complicacoesAgudas: [] as string[],
    complicacoesAgudasOutro: "",
    complicacoesTardias: [] as string[],
    complicacoesTardiasOutro: "",
    lesoesAssociadas: [] as string[],
    lesoesAssociadasOutro: "",
    observacoes: "",
  });

  const [tibialSpine, setTibialSpine] = useState({
    classificacaoMeyers: "",
    dataLesao: "",
    dataCirurgiaDefinitiva: "",
    tecnica: "",
    opme: [] as { item: string; quantidade: string }[],
    materialSutura: "",
    lesoesAssociadas: [] as string[],
    lcaSubtipo: "",
    lesoesAssociadasOutro: "",
    observacoes: "",
  });

  // Load draft data from URL param
  useEffect(() => {
    if (!draftIdParam || draftLoaded) return;
    apiGetSurgery(draftIdParam).then((data) => {
      if (!data) return;
      if (data.procedimentoMeniscal?.ladoMedial) setActiveMeniscalSide("medial");
      else if (data.procedimentoMeniscal?.ladoLateral) setActiveMeniscalSide("lateral");
      setFormData((prev) => ({
        ...prev,
        patientId: data.patientId ?? prev.patientId,
        dataCirurgia: data.dataCirurgia ?? prev.dataCirurgia,
        hospital: data.hospital ?? prev.hospital,
        tipoCaso: data.tipoCaso ?? prev.tipoCaso,
        diagnostico: data.diagnostico ?? prev.diagnostico,
        alinhamento: data.alinhamento ?? prev.alinhamento,
        grauAlinhamento: data.grauAlinhamento ?? prev.grauAlinhamento,
        tiposProcedimento: data.tiposProcedimento ?? prev.tiposProcedimento,
        ligamentosAcometidos: data.ligamentosAcometidos ?? prev.ligamentosAcometidos,
        enxerto: data.enxerto ?? prev.enxerto,
        diametroEnxerto: data.diametroEnxerto ?? prev.diametroEnxerto,
        tunelFemoral: data.tunelFemoral ?? prev.tunelFemoral,
        tunelFemoralPediatrico: (data as any).tunelFemoralPediatrico ?? prev.tunelFemoralPediatrico,
        tunelTibialPediatrico: (data as any).tunelTibialPediatrico ?? prev.tunelTibialPediatrico,
        fixacaoFemoral: data.fixacaoFemoral ?? prev.fixacaoFemoral,
        fixacaoTibial: data.fixacaoTibial ?? prev.fixacaoTibial,
         flipCutter: (data as any).flipCutter ?? prev.flipCutter,
        internalBrace: data.internalBrace ?? prev.internalBrace,
        tipoLca: data.tipoLca ?? prev.tipoLca,
        localizacaoLesaoLca: data.localizacaoLesaoLca ?? prev.localizacaoLesaoLca,
        fixacaoReparoLca: data.fixacaoReparoLca ?? prev.fixacaoReparoLca,
        preservacaoRemanescente: data.preservacaoRemanescente ?? prev.preservacaoRemanescente,
        reforco: data.reforco ?? prev.reforco,
        procedimentoRealizado: data.procedimentoRealizado ?? prev.procedimentoRealizado,
        procedimentosDetalhados: data.procedimentosDetalhados ?? prev.procedimentosDetalhados,
        observacoes: data.observacoes ?? prev.observacoes,
        rxAnaliseJson: data.rxAnaliseJson ?? prev.rxAnaliseJson,
        rxImageUrl: data.rxImageUrl ?? prev.rxImageUrl,
        slopeTibialJson: data.slopeTibialJson ?? prev.slopeTibialJson,
        exameLigamentar: data.exameLigamentar ?? prev.exameLigamentar,
        lcaAlgorithm: data.lcaAlgorithm ?? prev.lcaAlgorithm,
        aclLeapDecision: data.aclLeapDecision ?? prev.aclLeapDecision,
        procedimentoMeniscal: data.procedimentoMeniscal ?? prev.procedimentoMeniscal,
        examePatelar: data.examePatelar ?? prev.examePatelar,
        picsScore: data.picsScore ?? prev.picsScore,
        exameOsteocondral: data.exameOsteocondral ?? prev.exameOsteocondral,
      }));
      // Reinforcement details are persisted in the JSON `reforco` column.
      // Restore them for the ordinary (non-bilateral) draft path as well as
      // the side snapshot path below; otherwise a reload loses LOA choices
      // such as the femoral fixation method from the visible form.
      try {
        const reinforcement = typeof data.reforco === "string" ? JSON.parse(data.reforco) : null;
        if (reinforcement && typeof reinforcement === "object" && !Array.isArray(reinforcement)) {
          setExtraArticular((prev) => ({ ...prev, ...reinforcement }));
        }
      } catch { /* legacy free text */ }
      if (data.lado) setClinicalData((prev) => ({ ...prev, lado: data.lado }));
      if (data.lcpReconstruction) setLcpTecnica((prev) => ({ ...prev, ...data.lcpReconstruction }));
      if (data.cpmReconstruction) setCpmTecnica((prev) => ({
        ...prev,
        ...data.cpmReconstruction,
        lcmTecnica: data.cpmReconstruction.lcmTecnica === "Laprade Medial"
          ? "Laprade"
          : data.cpmReconstruction.lcmTecnica,
      }));
      if (data.cplReconstruction) setCplTecnica((prev) => ({ ...prev, ...data.cplReconstruction }));
      if (data.periprostheticFracture) {
        const pf = data.periprostheticFracture;
        // opme column now stores cirurgia string[]; handle legacy object format
        const loadedCirurgia = Array.isArray(pf.opme)
          ? (pf.opme as any[]).every((o) => typeof o === "string") ? (pf.opme as string[]) : []
          : [];
        const rawAgudas = Array.isArray(pf.complicacoesAgudas) ? [...pf.complicacoesAgudas] : [];
        const rawTardias = Array.isArray(pf.complicacoesTardias) ? [...pf.complicacoesTardias] : [];
        const loadedAgudas = rawAgudas.filter((item): item is string => typeof item === "string");
        const loadedTardias = rawTardias.filter((item): item is string => typeof item === "string");
        setLegacyPeriprostheticComplications({
          agudas: rawAgudas.some((item) => typeof item !== "string") ? rawAgudas : null,
          tardias: rawTardias.some((item) => typeof item !== "string") ? rawTardias : null,
        });
        setPeriprosthetic((prev) => ({
          ...prev,
          classificacaoFemur: pf.classificacaoFemur ?? "",
          classificacaoTibia: pf.classificacaoTibia ?? "",
          classificacaoPatela: pf.classificacaoPatela ?? "",
          estoquePatelarMm: pf.estoquePatelarMm != null ? String(pf.estoquePatelarMm) : "",
          controleDanos: pf.controleDanos ?? false,
          controleDanosData: pf.controleDanosData ?? "",
          controleDanosIndicacao: Array.isArray(pf.controleDanosIndicacao) ? pf.controleDanosIndicacao : [],
          controleDanosIndicacaoOutro: pf.controleDanosIndicacaoOutro ?? "",
          controleDanosProcedimento: Array.isArray(pf.controleDanosProcedimento) ? pf.controleDanosProcedimento : [],
          controleDanosProcedimentoOutro: pf.controleDanosProcedimentoOutro ?? "",
          definitivaData: pf.definitivaData ?? "",
          localizacao: Array.isArray(pf.localizacao) ? pf.localizacao : [],
          acessoFemur: Array.isArray(pf.acessoFemur) ? pf.acessoFemur : [],
          acessoFemurOutro: pf.acessoFemurOutro ?? "",
          extensaoAbordagem: pf.extensaoAbordagem ?? false,
          extensaoAbordagemTipo: pf.extensaoAbordagemTipo ?? "",
          extensaoAbordagemOutro: pf.extensaoAbordagemOutro ?? "",
          acessoTibia: Array.isArray(pf.acessoTibia) ? pf.acessoTibia : [],
          cirurgia: loadedCirurgia,
          cirurgiaOutro: "",
          complicacoesAgudas: loadedAgudas,
          complicacoesAgudasOutro: "",
          complicacoesTardias: loadedTardias,
          complicacoesTardiasOutro: "",
          observacoes: pf.observacoes ?? "",
        }));
      }
      if (data.distalFemurFracture) {
        const df = data.distalFemurFracture;
        setDistalFemur((prev) => ({
          ...prev,
          ...df,
          acesso: Array.isArray(df.acesso) ? df.acesso : [],
          cirurgia: Array.isArray(df.cirurgia) ? df.cirurgia : [],
          opme: Array.isArray(df.opme) ? df.opme : [],
          complicacoesAgudas: Array.isArray(df.complicacoesAgudas) ? df.complicacoesAgudas : [],
          complicacoesTardias: Array.isArray(df.complicacoesTardias) ? df.complicacoesTardias : [],
          lesoesAssociadas: Array.isArray(df.lesoesAssociadas) ? df.lesoesAssociadas : [],
        }));
      }
      if (data.tibialPlateauFracture) {
        const tp = data.tibialPlateauFracture;
        setTibialPlateau((prev) => ({
          ...prev,
          ...tp,
          acesso: Array.isArray(tp.acesso) ? tp.acesso : [],
          cirurgia: Array.isArray(tp.cirurgia) ? tp.cirurgia : [],
          opme: Array.isArray(tp.opme) ? tp.opme : [],
          complicacoesAgudas: Array.isArray(tp.complicacoesAgudas) ? tp.complicacoesAgudas : [],
          complicacoesTardias: Array.isArray(tp.complicacoesTardias) ? tp.complicacoesTardias : [],
          lesoesAssociadas: Array.isArray(tp.lesoesAssociadas) ? tp.lesoesAssociadas : [],
        }));
      }
      if (data.patellaFracture) {
        const pt = data.patellaFracture;
        setPatella((prev) => ({
          ...prev,
          ...pt,
          acesso: Array.isArray(pt.acesso) ? pt.acesso : [],
          cirurgia: Array.isArray(pt.cirurgia) ? pt.cirurgia : [],
          complicacoesAgudas: Array.isArray(pt.complicacoesAgudas) ? pt.complicacoesAgudas : [],
          complicacoesTardias: Array.isArray(pt.complicacoesTardias) ? pt.complicacoesTardias : [],
          lesoesAssociadas: Array.isArray(pt.lesoesAssociadas) ? pt.lesoesAssociadas : [],
        }));
      }
      if (data.tibialSpineFracture) {
        const ts = data.tibialSpineFracture;
        setTibialSpine((prev) => ({
          ...prev,
          ...ts,
          opme: Array.isArray(ts.opme) ? ts.opme : [],
          lesoesAssociadas: Array.isArray(ts.lesoesAssociadas) ? ts.lesoesAssociadas : [],
        }));
      }
      if (data.patelarTendonRupture) {
        const pt = data.patelarTendonRupture;
        setPatelarTendon((prev) => ({
          ...prev,
          classificacao: pt.classificacao ?? "",
          dataLesao: pt.dataLesao ?? "",
          dataCirurgiaDefinitiva: pt.dataCirurgiaDefinitiva ?? "",
          cirurgia: Array.isArray(pt.cirurgia) ? pt.cirurgia : [],
          cirurgiaOutro: pt.cirurgiaOutro ?? "",
          reforco: pt.reforco ?? false,
          reforcoTipo: Array.isArray(pt.reforcoTipo) ? pt.reforcoTipo : [],
          reforcoTendao: Array.isArray(pt.reforcoTendao) ? pt.reforcoTendao : [],
          reforcoTendaoOutro: pt.reforcoTendaoOutro ?? "",
          imageUrls: Array.isArray(pt.imageUrls) ? pt.imageUrls : [],
          observacoes: pt.observacoes ?? "",
        }));
      }
      if (data.quadricepsTendonRupture) {
        const qt = data.quadricepsTendonRupture;
        setQuadricepsTendon((prev) => ({
          ...prev,
          classificacao: qt.classificacao ?? "",
          dataLesao: qt.dataLesao ?? "",
          dataCirurgiaDefinitiva: qt.dataCirurgiaDefinitiva ?? "",
          cirurgia: Array.isArray(qt.cirurgia) ? qt.cirurgia : [],
          cirurgiaOutro: qt.cirurgiaOutro ?? "",
          reforco: qt.reforco ?? false,
          reforcoTipo: Array.isArray(qt.reforcoTipo) ? qt.reforcoTipo : [],
          reforcoTendao: Array.isArray(qt.reforcoTendao) ? qt.reforcoTendao : [],
          reforcoTendaoOutro: qt.reforcoTendaoOutro ?? "",
          imageUrls: Array.isArray(qt.imageUrls) ? qt.imageUrls : [],
          observacoes: qt.observacoes ?? "",
        }));
      }
      if (data.procedimentosDetalhados) {
        try {
          const det = JSON.parse(data.procedimentosDetalhados);
          const bilateral = readBilateralDocumentation(det);
          if (data.lado === "Bilateral" && bilateral) {
            limbSnapshotsRef.current = bilateral.byLimb;
            setLimbSnapshots(bilateral.byLimb);
            setActiveLimb("direito");
            activeLimbRef.current = "direito";
            queueMicrotask(() => applyLimbSnapshot(bilateral.byLimb.direito));
          }
          if (det.osteotomia) setOsteotomia((prev) => ({ ...prev, ...det.osteotomia }));
          if (det.ortobiologico) {
            const ortoData = { ...det.ortobiologico };
            // Migração: converte diagnosticoTipo (string legado) → diagnosticoTipos (array)
            if (typeof ortoData.diagnosticoTipo === "string" && ortoData.diagnosticoTipo && !Array.isArray(ortoData.diagnosticoTipos)) {
              ortoData.diagnosticoTipos = [ortoData.diagnosticoTipo];
            }
            if (!Array.isArray(ortoData.diagnosticoTipos)) ortoData.diagnosticoTipos = [];
            setOrtobiologico((prev) => ({ ...prev, ...ortoData }));
          }
          if (det.patelar) setPatelarTecnica((prev) => ({ ...prev, ...det.patelar }));
          if (det.osteocondral) setOsteocondralTecnica((prev) => ({ ...prev, ...det.osteocondral }));
          if (det.artroplastia) setArtroplastiaTecnica((prev) => ({ ...prev, ...det.artroplastia }));
          if (Array.isArray(det.outrosProcedimentos)) setOutrosProcedimentos(det.outrosProcedimentos);
          if (Array.isArray(det.fraturas)) setFraturas(det.fraturas);
          if (Array.isArray(det.tendoes)) setTendoes(det.tendoes);
          if (Array.isArray(det.tendinopatiaSubtipos)) setTendinopatiaSubtipos(det.tendinopatiaSubtipos);
        } catch { /* ignore parse errors */ }
      }
    }).catch(() => {
      toast({
        title: tn("draftLoadError"),
        description: tn("draftLoadErrorDescription"),
        variant: "destructive",
      });
    }).finally(() => {
      setDraftLoaded(true);
    });
  }, [draftIdParam, draftLoaded]);

  const buildFlatDraftPayload = () => {
    const activeProcsArr: string[] = [];
    (formData.ligamentosAcometidos || []).forEach((lig: string) => activeProcsArr.push(`Reconstrução de ${lig}`));
    if (activeProcSections.has("sutura")) activeProcsArr.push("Sutura Meniscal");
    if (extraArticular.lal || extraArticular.let || extraArticular.loa) activeProcsArr.push("LEAP");
    if (activeProcSections.has("osteotomia")) activeProcsArr.push("Osteotomia");
    if (activeProcSections.has("ortobiologico")) activeProcsArr.push("Ortobiológico");
    if (outrosProcedimentos.length > 0) activeProcsArr.push("Outros Procedimentos");
    if (fraturas.length > 0) activeProcsArr.push("Fraturas");
    return {
      ...(draftId ? { id: draftId } : {}),
      ...formData,
      flipCutter: hasLca && (formData.tipoLca || "Reconstrução") === "Reconstrução"
        ? formData.flipCutter || null
        : null,
      ocdAnalysis: isOsteocondral ? ocdAnalysis : undefined,
      lado: clinicalData.lado || undefined,
      procedimentoRealizado: activeProcsArr.join(", ") || formData.procedimentoRealizado,
      reforco: (extraArticular.lal || extraArticular.let || extraArticular.loa) ? JSON.stringify(extraArticular) : formData.reforco,
      procedimentosDetalhados: JSON.stringify({
        ...(formData.examePatelar?.jSign === true && formData.examePatelar?.jSignGrau != null
          ? { jSignGrau: Number(formData.examePatelar.jSignGrau) }
          : {}),
        osteotomia,
        ortobiologico,
        outrosProcedimentos: outrosProcedimentos.length > 0 ? outrosProcedimentos : undefined,
        fraturas: fraturas.length > 0 ? fraturas : undefined,
        tendoes: tendoes.length > 0 ? tendoes : undefined,
        tendinopatiaSubtipos: tendinopatiaSubtipos.length > 0 ? tendinopatiaSubtipos : undefined,
        patelar: isPatelar ? patelarTecnica : undefined,
        osteocondral: isOsteocondral ? osteocondralTecnica : undefined,
        artroplastia: isArtroplastia ? { ...artroplastiaTecnica, alinhamentoMembro: artroplastiaTecnica.alinhamentoMembro.join(", ") } : undefined,
      }),
      lcpReconstruction: lcpTecnica,
      cpmReconstruction: cpmTecnica,
      cplReconstruction: { ...cplTecnica, enxertos: cplTecnica.enxertos.filter(e => e.nome) },
      aclLeapDecision: formData.aclLeapDecision || undefined,
      periprostheticFracture: fraturas.includes("Fratura Periprotética") ? {
        classificacaoFemur: periprosthetic.classificacaoFemur || undefined,
        classificacaoTibia: periprosthetic.classificacaoTibia || undefined,
        classificacaoPatela: periprosthetic.classificacaoPatela || undefined,
        estoquePatelarMm: periprosthetic.estoquePatelarMm ? parseFloat(periprosthetic.estoquePatelarMm) : undefined,
        controleDanos: periprosthetic.controleDanos,
        controleDanosData: periprosthetic.controleDanosData || undefined,
        controleDanosIndicacao: periprosthetic.controleDanosIndicacao,
        controleDanosIndicacaoOutro: periprosthetic.controleDanosIndicacaoOutro || undefined,
        controleDanosProcedimento: periprosthetic.controleDanosProcedimento,
        controleDanosProcedimentoOutro: periprosthetic.controleDanosProcedimentoOutro || undefined,
        definitivaData: periprosthetic.definitivaData || undefined,
        localizacao: [],
        acessoFemur: periprosthetic.acessoFemur,
        acessoFemurOutro: periprosthetic.acessoFemurOutro || undefined,
        extensaoAbordagem: periprosthetic.extensaoAbordagem,
        extensaoAbordagemTipo: periprosthetic.extensaoAbordagemTipo || undefined,
        extensaoAbordagemOutro: periprosthetic.extensaoAbordagemOutro || undefined,
        acessoTibia: periprosthetic.acessoTibia,
        // opme jsonb column repurposed to store cirurgia string[]
        opme: periprosthetic.cirurgiaOutro.trim()
          ? [...periprosthetic.cirurgia, `Outro: ${periprosthetic.cirurgiaOutro.trim()}`]
          : periprosthetic.cirurgia,
        complicacoesAgudas: legacyPeriprostheticComplications.agudas
          ?? (periprosthetic.complicacoesAgudasOutro.trim()
            ? [...periprosthetic.complicacoesAgudas, `Outro: ${periprosthetic.complicacoesAgudasOutro.trim()}`]
            : periprosthetic.complicacoesAgudas),
        complicacoesTardias: legacyPeriprostheticComplications.tardias
          ?? (periprosthetic.complicacoesTardiasOutro.trim()
            ? [...periprosthetic.complicacoesTardias, `Outro: ${periprosthetic.complicacoesTardiasOutro.trim()}`]
            : periprosthetic.complicacoesTardias),
        observacoes: periprosthetic.observacoes || undefined,
      } : undefined,
      distalFemurFracture: fraturas.includes("Fratura do Fêmur Distal") ? {
        ...distalFemur,
        opme: distalFemur.opme.filter((o) => o),
      } : undefined,
      tibialPlateauFracture: fraturas.includes("Fratura do Platô Tibial") ? {
        ...tibialPlateau,
        opme: tibialPlateau.opme.filter((o) => o.item),
      } : undefined,
      patellaFracture: fraturas.includes("Fratura de Patela") ? {
        ...patella,
      } : undefined,
      tibialSpineFracture: fraturas.includes("Fratura de Eminência Tibial (Avulsão do LCA)") ? {
        ...tibialSpine,
        opme: tibialSpine.opme.filter((o) => o.item),
      } : undefined,
      patelarTendonRupture: tendoes.includes("Ruptura do Tendão Patelar") ? {
        classificacao: patelarTendon.classificacao || undefined,
        dataLesao: patelarTendon.dataLesao || undefined,
        dataCirurgiaDefinitiva: patelarTendon.dataCirurgiaDefinitiva || undefined,
        cirurgia: patelarTendon.cirurgia,
        cirurgiaOutro: patelarTendon.cirurgiaOutro || undefined,
        reforco: patelarTendon.reforco,
        reforcoTipo: patelarTendon.reforcoTipo,
        reforcoTendao: patelarTendon.reforcoTendao,
        reforcoTendaoOutro: patelarTendon.reforcoTendaoOutro || undefined,
        imageUrls: patelarTendon.imageUrls.length > 0 ? patelarTendon.imageUrls : undefined,
        observacoes: patelarTendon.observacoes || undefined,
      } : undefined,
      quadricepsTendonRupture: tendoes.includes("Ruptura do Tendão Quadríceps") ? {
        classificacao: quadricepsTendon.classificacao || undefined,
        dataLesao: quadricepsTendon.dataLesao || undefined,
        dataCirurgiaDefinitiva: quadricepsTendon.dataCirurgiaDefinitiva || undefined,
        cirurgia: quadricepsTendon.cirurgia,
        cirurgiaOutro: quadricepsTendon.cirurgiaOutro || undefined,
        reforco: quadricepsTendon.reforco,
        reforcoTipo: quadricepsTendon.reforcoTipo,
        reforcoTendao: quadricepsTendon.reforcoTendao,
        reforcoTendaoOutro: quadricepsTendon.reforcoTendaoOutro || undefined,
        imageUrls: quadricepsTendon.imageUrls.length > 0 ? quadricepsTendon.imageUrls : undefined,
        observacoes: quadricepsTendon.observacoes || undefined,
      } : undefined,
    };
  };

  const captureCurrentLimb = (): LimbSnapshot => createLimbSnapshot(
    buildFlatDraftPayload(),
    {
      activeProcSections: [...activeProcSections],
      activeMeniscalSide,
      clinicalData,
      extraArticular,
      osteotomia,
      ortobiologico,
      outrosProcedimentos,
      fraturas,
      tendoes,
      tendinopatiaSubtipos,
      patelarTecnica,
      osteocondralTecnica,
      artroplastiaTecnica,
      lcpTecnica,
      cpmTecnica,
      cplTecnica,
      periprosthetic,
      distalFemur,
      tibialPlateau,
      patella,
      tibialSpine,
      patelarTendon,
      quadricepsTendon,
    },
  );

  const applyLimbSnapshot = (snapshot?: LimbSnapshot) => {
    const source = { ...(initialLimbSnapshotRef.current ?? {}), ...(snapshot ?? {}) } as Record<string, any>;
    const { detalhesProcedimentos, _wizardUi, ...fields } = source;
    setFormData((prev) => ({
      ...prev,
      ...fields,
      patientId: prev.patientId,
      dataCirurgia: prev.dataCirurgia,
      hospital: prev.hospital,
    }));

    const details = (detalhesProcedimentos && typeof detalhesProcedimentos === "object")
      ? detalhesProcedimentos as Record<string, any>
      : {};
    if (details.osteotomia) setOsteotomia((prev) => ({ ...prev, ...details.osteotomia }));
    if (details.ortobiologico) setOrtobiologico((prev) => ({ ...prev, ...details.ortobiologico }));
    setOutrosProcedimentos(Array.isArray(details.outrosProcedimentos) ? details.outrosProcedimentos : []);
    setFraturas(Array.isArray(details.fraturas) ? details.fraturas : []);
    setTendoes(Array.isArray(details.tendoes) ? details.tendoes : []);
    setTendinopatiaSubtipos(Array.isArray(details.tendinopatiaSubtipos) ? details.tendinopatiaSubtipos : []);
    if (details.patelar) setPatelarTecnica((prev) => ({ ...prev, ...details.patelar }));
    if (details.osteocondral) setOsteocondralTecnica((prev) => ({ ...prev, ...details.osteocondral }));
    if (details.artroplastia) {
      setArtroplastiaTecnica((prev) => ({
        ...prev,
        ...details.artroplastia,
        alinhamentoMembro: Array.isArray(details.artroplastia.alinhamentoMembro)
          ? details.artroplastia.alinhamentoMembro
          : String(details.artroplastia.alinhamentoMembro ?? "").split(", ").filter(Boolean),
      }));
    }
    if (source.lcpReconstruction) setLcpTecnica((prev) => ({ ...prev, ...source.lcpReconstruction }));
    if (source.cpmReconstruction) setCpmTecnica((prev) => ({ ...prev, ...source.cpmReconstruction }));
    if (source.cplReconstruction) setCplTecnica((prev) => ({ ...prev, ...source.cplReconstruction }));
    if (source.periprostheticFracture) setPeriprosthetic((prev) => ({ ...prev, ...source.periprostheticFracture }));
    if (source.distalFemurFracture) setDistalFemur((prev) => ({ ...prev, ...source.distalFemurFracture }));
    if (source.tibialPlateauFracture) setTibialPlateau((prev) => ({ ...prev, ...source.tibialPlateauFracture }));
    if (source.patellaFracture) setPatella((prev) => ({ ...prev, ...source.patellaFracture }));
    if (source.tibialSpineFracture) setTibialSpine((prev) => ({ ...prev, ...source.tibialSpineFracture }));
    if (source.patelarTendonRupture) setPatelarTendon((prev) => ({ ...prev, ...source.patelarTendonRupture }));
    if (source.quadricepsTendonRupture) setQuadricepsTendon((prev) => ({ ...prev, ...source.quadricepsTendonRupture }));
    try {
      const reinforcement = typeof source.reforco === "string" ? JSON.parse(source.reforco) : null;
      if (reinforcement) setExtraArticular((prev) => ({ ...prev, ...reinforcement }));
    } catch { /* legacy free text */ }
    const ui = _wizardUi as Record<string, any> | undefined;
    if (ui?.extraArticular) setExtraArticular(ui.extraArticular);
    if (ui?.osteotomia) setOsteotomia(ui.osteotomia);
    if (ui?.ortobiologico) setOrtobiologico(ui.ortobiologico);
    if (Array.isArray(ui?.outrosProcedimentos)) setOutrosProcedimentos(ui.outrosProcedimentos);
    if (Array.isArray(ui?.fraturas)) setFraturas(ui.fraturas);
    if (Array.isArray(ui?.tendoes)) setTendoes(ui.tendoes);
    if (Array.isArray(ui?.tendinopatiaSubtipos)) setTendinopatiaSubtipos(ui.tendinopatiaSubtipos);
    if (ui?.patelarTecnica) setPatelarTecnica(ui.patelarTecnica);
    if (ui?.osteocondralTecnica) setOsteocondralTecnica(ui.osteocondralTecnica);
    if (ui?.artroplastiaTecnica) setArtroplastiaTecnica(ui.artroplastiaTecnica);
    if (ui?.lcpTecnica) setLcpTecnica(ui.lcpTecnica);
    if (ui?.cpmTecnica) setCpmTecnica(ui.cpmTecnica);
    if (ui?.cplTecnica) setCplTecnica(ui.cplTecnica);
    if (ui?.periprosthetic) setPeriprosthetic(ui.periprosthetic);
    if (ui?.distalFemur) setDistalFemur(ui.distalFemur);
    if (ui?.tibialPlateau) setTibialPlateau(ui.tibialPlateau);
    if (ui?.patella) setPatella(ui.patella);
    if (ui?.tibialSpine) setTibialSpine(ui.tibialSpine);
    if (ui?.patelarTendon) setPatelarTendon(ui.patelarTendon);
    if (ui?.quadricepsTendon) setQuadricepsTendon(ui.quadricepsTendon);
    setActiveProcSections(new Set(Array.isArray(ui?.activeProcSections) ? ui.activeProcSections : []));
    setActiveMeniscalSide(ui?.activeMeniscalSide === "medial" || ui?.activeMeniscalSide === "lateral" ? ui.activeMeniscalSide : null);
    if (ui?.clinicalData) setClinicalData((prev) => ({ ...prev, ...ui.clinicalData, lado: "Bilateral" }));
  };

  const switchLimb = (next: SurgeryLimb) => {
    if (next === activeLimb) return;
    const current = captureCurrentLimb();
    const updated = { ...limbSnapshotsRef.current, [activeLimb]: current };
    limbSnapshotsRef.current = updated;
    setLimbSnapshots(updated);
    setActiveLimb(next);
    activeLimbRef.current = next;
    applyLimbSnapshot(updated[next]);
    setStep(1);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleLateralityChange = (value: string) => {
    if (value === "Bilateral" && clinicalData.lado !== "Bilateral") {
      const right = captureCurrentLimb();
      limbSnapshotsRef.current = { direito: right };
      setLimbSnapshots({ direito: right });
      setActiveLimb("direito");
      activeLimbRef.current = "direito";
    }
    setClinicalData((previous) => ({ ...previous, lado: value }));
  };

  const buildDraftPayload = () => {
    const flat = buildFlatDraftPayload();
    if (clinicalData.lado !== "Bilateral") return flat;
    const byLimb = { ...limbSnapshotsRef.current, [activeLimb]: captureCurrentLimb() };
    limbSnapshotsRef.current = byLimb;
    return {
      ...flat,
      procedimentosDetalhados: writeBilateralDocumentation(flat.procedimentosDetalhados, byLimb),
    };
  };

  const updateFormForLimb = (
    target: SurgeryLimb | null,
    updater: (current: Record<string, any>) => Record<string, any>,
  ) => {
    if (!target || target === activeLimbRef.current) {
      setFormData((previous) => updater(previous as Record<string, any>));
      return;
    }
    const updated = updateStoredLimbSnapshot(
      limbSnapshotsRef.current,
      target,
      initialLimbSnapshotRef.current ?? {},
      updater,
    );
    limbSnapshotsRef.current = updated;
    setLimbSnapshots(updated);
  };

  const updateOsteotomyForLimb = (target: SurgeryLimb | null, value: typeof osteotomia) => {
    if (!target || target === activeLimbRef.current) {
      setOsteotomia(value);
      return;
    }
    updateFormForLimb(target, (current) => ({
      ...current,
      detalhesProcedimentos: {
        ...(current.detalhesProcedimentos ?? {}),
        osteotomia: value,
      },
      _wizardUi: {
        ...(current._wizardUi ?? {}),
        osteotomia: value,
      },
    }));
  };

  useEffect(() => {
    if (!initialLimbSnapshotRef.current) {
      initialLimbSnapshotRef.current = captureCurrentLimb();
    }
  }, []);

  const saveDraft = async () => {
    if (!formData.patientId) {
      toast({ title: t("selectPatientBeforeDraft"), variant: "destructive" });
      return;
    }
    setIsDraftSaving(true);
    try {
      const payload = buildDraftPayload();
      const result = await apiDraft(payload, tn("draftSaveError"));
      setDraftId(result.id);
      toast({ title: t("draftSaved"), description: t("draftContinue") });
    } catch (err: any) {
      toast({ title: tn("draftSaveError"), description: err.message, variant: "destructive" });
    } finally {
      setIsDraftSaving(false);
    }
  };

  const persistExistingDraft = async (): Promise<boolean> => {
    if (!formData.patientId) return true;
    if (isDraftSaving) {
      toast({ title: tn("waitForDraftSave") });
      return false;
    }

    setIsDraftSaving(true);
    try {
      const result = await apiDraft(buildDraftPayload(), tn("draftSaveError"));
      if (!draftId) {
        setDraftId(result.id);
      }
      return true;
    } catch (error) {
      toast({
        title: tn("draftUpdateError"),
        description: error instanceof Error ? error.message : tn("tryAgain"),
        variant: "destructive",
      });
      return false;
    } finally {
      setIsDraftSaving(false);
    }
  };

  const ensureDraftForMedia = async (): Promise<number> => {
    if (draftId) return draftId;
    if (!formData.patientId) {
      throw new Error(tn("selectPatientBeforeMedia"));
    }
    if (isDraftSaving) {
      throw new Error(tn("waitForDraftSaveAndRetry"));
    }

    setIsDraftSaving(true);
    try {
      const result = await apiDraft(buildDraftPayload(), tn("draftSaveError"));
      setDraftId(result.id);
      toast({
        title: tn("draftCreatedAutomatically"),
        description: tn("uploadsWillContinue"),
      });
      return result.id;
    } catch (error) {
      throw new Error(error instanceof Error ? error.message : tn("mediaDraftCreateError"));
    } finally {
      setIsDraftSaving(false);
    }
  };

  const ensureDraftForPreop = async (): Promise<number> => {
    if (!formData.patientId) {
      throw new Error(tn("selectPatientBeforePreop"));
    }
    if (isDraftSaving) {
      throw new Error(tn("waitForDraftSaveAndRetry"));
    }

    setIsDraftSaving(true);
    try {
      const result = await apiDraft(buildDraftPayload(), tn("draftSaveError"));
      setDraftId(result.id);
      return result.id;
    } catch (error) {
      throw new Error(error instanceof Error ? error.message : tn("draftCouldNotBeSaved"));
    } finally {
      setIsDraftSaving(false);
    }
  };

  const toggleProcSection = (key: string, sideEffect?: () => void) => {
    setActiveProcSections(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
    sideEffect?.();
  };

  // ── Osteotomy: pre-fill from surgical plan selection ─────────────────────
  const parseTecnicaStr = (tecnica: string): { tipo: string; lado: string } => {
    const parts = tecnica.toLowerCase().split(" ");
    const tipo = parts[0] === "abertura" ? "Abertura" : "Fechamento";
    const lado = parts[1] === "medial" ? "Medial" : "Lateral";
    return { tipo, lado };
  };

  const handleOsteotomiaChoose = (opcao: Record<string, unknown> | null, idx: number | null, target: SurgeryLimb | null = null) => {
    // Persist selected index inside rxAnaliseJson
    if (formData.rxAnaliseJson) {
      try {
        const analysis = JSON.parse(formData.rxAnaliseJson);
        analysis._selectedOsteotomiaIdx = idx;
        analysis._selectedOsteotomiaId = idx === null ? null : String(opcao?.id ?? "");
        updateFormForLimb(target, (current) => ({ ...current, rxAnaliseJson: JSON.stringify(analysis) }));
      } catch { /* ignore */ }
    }
    const empty = {
      tibial: false, tibialTipo: "", tibialLado: "", tibialAngulo: "",
      femoral: false, femoralTipo: "", femoralLado: "", femoralAngulo: "",
      dupla: false,
      duplaFemoralTipo: "", duplaFemoralLado: "", duplaFemoralAngulo: "",
      duplaTibialTipo: "", duplaTibialLado: "", duplaTibialAngulo: "",
      slop: false, slopGrau: "",
      enxertoOsseo: false, enxertoOsseoTipo: "",
    };
    if (!opcao) { updateOsteotomyForLimb(target, empty); return; }

    const id = String(opcao.id ?? "");
    const newState = { ...empty };

    if (id.startsWith("dupla")) {
      newState.dupla = true;
      if (opcao.tecnicaFemoral) {
        const { tipo, lado } = parseTecnicaStr(String(opcao.tecnicaFemoral));
        newState.duplaFemoralTipo = tipo;
        newState.duplaFemoralLado = lado;
        // Femoral: 1° ≈ 1,26 mm — use precomputed wedgeFemoral_mm
        newState.duplaFemoralAngulo = String(opcao.wedgeFemoral_mm ?? "");
      }
      if (opcao.tecnicaTibial) {
        const { tipo, lado } = parseTecnicaStr(String(opcao.tecnicaTibial));
        newState.duplaTibialTipo = tipo;
        newState.duplaTibialLado = lado;
        // Tibial: 1° ≈ 1 mm — use precomputed wedgeTibial_mm
        newState.duplaTibialAngulo = String(opcao.wedgeTibial_mm ?? "");
      }
    } else if (id.startsWith("hto")) {
      newState.tibial = true;
      if (opcao.tecnica) {
        const { tipo, lado } = parseTecnicaStr(String(opcao.tecnica));
        newState.tibialTipo = tipo;
        newState.tibialLado = lado;
      }
      // Tibial: 1° ≈ 1 mm
      newState.tibialAngulo = String(opcao.wedge_mm ?? opcao.correcao ?? "");
    } else if (id.startsWith("dfo")) {
      newState.femoral = true;
      if (opcao.tecnica) {
        const { tipo, lado } = parseTecnicaStr(String(opcao.tecnica));
        newState.femoralTipo = tipo;
        newState.femoralLado = lado;
      }
      // Femoral: 1° ≈ 1,26 mm — use precomputed wedge_mm
      newState.femoralAngulo = String(opcao.wedge_mm ?? "");
    }

    updateOsteotomyForLimb(target, newState);
    if (!target || target === activeLimbRef.current) {
      setActiveProcSections(prev => { const n = new Set(prev); n.add("osteotomia"); return n; });
    } else {
      updateFormForLimb(target, (current) => {
        const ui = current._wizardUi ?? {};
        const sections = new Set(Array.isArray(ui.activeProcSections) ? ui.activeProcSections : []);
        sections.add("osteotomia");
        return { ...current, _wizardUi: { ...ui, activeProcSections: [...sections] } };
      });
    }
  };

  // Derived
  const sortedPatients = useMemo(
    () => sortByPtBrName(patients ?? [], (patient) => patient.nome, (patient) => patient.id),
    [patients],
  );
  const selectedPatient = patients?.find((p) => p.id === formData.patientId);
  const tiposSelected = formData.tiposProcedimento || [];
  const isLigamentar = tiposSelected.includes("Lesão Ligamentar");
  const isMeniscal = tiposSelected.includes("Lesão Meniscal");
  const isPatelar = tiposSelected.includes("Instabilidade Patelar");
  const hasLca = formData.ligamentosAcometidos?.includes("LCA");
  const hasLcp = formData.ligamentosAcometidos?.includes("LCP");
  const hasPlc = formData.ligamentosAcometidos?.includes("CPL");
  const hasCpm = formData.ligamentosAcometidos?.includes("CPM");
  const isMultiligamentar = (formData.ligamentosAcometidos?.length || 0) >= 2;
  const isOrtobiologico = tiposSelected.includes("Ortobiológicos");
  const isOsteocondral = tiposSelected.includes("Lesões Osteocondrais");
  const isArtroplastia = tiposSelected.includes("Artroplastias");
  const hasOsteocondralPlanning = isOsteocondral;
  const techniqueStep = hasOsteocondralPlanning ? 6 : 5;
  const observationsStep = hasOsteocondralPlanning ? 7 : 6;
  const hasConfirmedTissueBank = formData.exameOsteocondral?.bancoTecidosDisponivel === true;
  useEffect(() => {
    if (draftIdParam && !draftLoaded) return;
    if (step > observationsStep) setStep(observationsStep);
  }, [draftIdParam, draftLoaded, step, observationsStep]);

  // ── OCD algorithm ─────────────────────────────────────────────────────────
  const ocdAnalysis = useMemo((): OcdOutput | null => {
    if (!isOsteocondral || !formData.exameOsteocondral) return null;
    const exam = formData.exameOsteocondral as Record<string, unknown>;
    if (exam.sintomatica === undefined && exam.falhaConservador === undefined) return null;
    return runOcdAlgorithm(buildOcdInputFromForm(exam, {
      alinhamentoFrontal: formData.alinhamento,
      grauMedida: formData.grauMedida,
      isMeniscal,
      isLigamentar,
      exameLigamentar: formData.exameLigamentar,
    }));
  }, [isOsteocondral, formData.exameOsteocondral, formData.alinhamento, formData.grauMedida, isMeniscal, isLigamentar, formData.exameLigamentar]);
  useEffect(() => {
    if (!isOsteocondral || hasConfirmedTissueBank) return;
    setOsteocondralTecnica((current) => current.procedimentos.includes("Aloenxerto osteocondral fresco")
      ? { ...current, procedimentos: current.procedimentos.filter((procedure) => procedure !== "Aloenxerto osteocondral fresco") }
      : current,
    );
  }, [isOsteocondral, hasConfirmedTissueBank]);
  const isOsteotomia = tiposSelected.includes("Osteotomia");
  const isOutrosProcedimentos = tiposSelected.includes("Outros Procedimentos");
  // Keep the pre-op follow-up invariant even while a draft is loading or when
  // the fracture category is inferred from the selected fracture details.
  const isFraturas = tiposSelected.some((type: string) => type.toLocaleLowerCase("pt-BR").includes("fratur"))
    || fraturas.length > 0
    || Boolean(
      formData.periprostheticFracture
      || formData.distalFemurFracture
      || formData.tibialPlateauFracture
      || formData.patellaFracture
      || formData.tibialSpineFracture,
    );
  const isOrtobiologicoIsolado = isOrtobiologico && !isLigamentar && !isMeniscal && !isPatelar && !isOsteocondral && !isOsteotomia;
  const isOutrosProcedimentosIsolado = isOutrosProcedimentos && !isLigamentar && !isMeniscal && !isPatelar && !isOsteocondral && !isOsteotomia && !isOrtobiologico && !isArtroplastia;
  const isFraturasIsolado = isFraturas && !isLigamentar && !isMeniscal && !isPatelar && !isOsteocondral && !isOsteotomia && !isOrtobiologico && !isArtroplastia && !isOutrosProcedimentos;
  const isTendoes = tiposSelected.includes("Rupturas Tendíneas");
  const isTendonesIsolado = isTendoes && !isLigamentar && !isPatelar && !isOsteocondral && !isOrtobiologico && !isArtroplastia && !isOutrosProcedimentos && !isFraturas;

  // Auto-ativa a seção ortobiológico em step 5 quando tipo foi selecionado em step 2
  useEffect(() => {
    if (step === techniqueStep && isOrtobiologico) {
      setActiveProcSections(prev => {
        if (prev.has("ortobiologico")) return prev;
        const next = new Set(prev);
        next.add("ortobiologico");
        return next;
      });
    }
  }, [step, techniqueStep, isOrtobiologico]);

  // Auto-ativa a seção osteotomia em step 5 quando tipo foi selecionado em step 2
  useEffect(() => {
    if (step === techniqueStep && isOsteotomia) {
      setActiveProcSections(prev => {
        if (prev.has("osteotomia")) return prev;
        const next = new Set(prev);
        next.add("osteotomia");
        return next;
      });
    }
  }, [step, techniqueStep, isOsteotomia]);

  const toggleTipoCaso = (val: string) => {
    const current = formData.tiposProcedimento || [];
    const next = current.includes(val) ? current.filter((x: string) => x !== val) : [...current, val];
    setFormData((prev) => ({
      ...prev,
      tiposProcedimento: next,
      tipoCaso: next[0] || "",
    }));
  };

  const updateData = (field: keyof CreateSurgeryBody, value: any) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const updateNested = (section: keyof CreateSurgeryBody, field: string, value: any) => {
    setFormData((prev) => ({
      ...prev,
      [section]: { ...((prev[section] as any) || {}), [field]: value },
    }));
  };

  const updateMeniscalSide = (
    side: MeniscalSide,
    field: keyof MeniscalSideDetails,
    value: unknown,
  ) => {
    setFormData((prev) => {
      const procedure = { ...((prev.procedimentoMeniscal as Record<string, unknown>) || {}) };
      const currentDetails = getMeniscalSideDetails(procedure, side);
      const nextDetails = { ...currentDetails, [field]: value };
      const otherSide: MeniscalSide = side === "medial" ? "lateral" : "medial";
      const otherDetails = getMeniscalSideDetails(procedure, otherSide);

      return {
        ...prev,
        procedimentoMeniscal: {
          ...procedure,
          [sideDetailsKey(side)]: nextDetails,
          // Keep aggregate legacy flags accurate for older consumers while all
          // new clinical detail remains independently stored by side.
          sutura: !!(nextDetails.sutura || otherDetails.sutura),
          meniscectomia: !!(nextDetails.meniscectomia || otherDetails.meniscectomia),
          estimuloBiologico: !!(nextDetails.estimuloBiologico || otherDetails.estimuloBiologico),
        },
      };
    });
  };

  const removeMeniscalSide = (side: MeniscalSide) => {
    setFormData((prev) => ({
      ...prev,
      procedimentoMeniscal: removeMeniscalSideDetails(
        prev.procedimentoMeniscal as Record<string, unknown> | null | undefined,
        side,
      ),
    }));
  };

  const clearMeniscalProcedure = () => {
    setFormData((prev) => ({
      ...prev,
      procedimentoMeniscal: clearMeniscalProcedureDetails(
        prev.procedimentoMeniscal as Record<string, unknown> | null | undefined,
      ),
    }));
    setActiveMeniscalSide(null);
  };

  const toggleLigamento = (val: string, checked: boolean) => {
    const current = formData.ligamentosAcometidos || [];
    updateData("ligamentosAcometidos", checked ? [...current, val] : current.filter((x: string) => x !== val));
  };

  const getPatientAge = () => {
    if (!selectedPatient?.dataNascimento) return 30;
    const birth = new Date(selectedPatient.dataNascimento);
    const today = new Date();
    let age = today.getFullYear() - birth.getFullYear();
    const m = today.getMonth() - birth.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
    return age;
  };
  const isJovem = getPatientAge() <= 15; // Paciente ≤ 15 anos → mostra Tanner + opções pediátricas
  const sexoPaciente = selectedPatient?.sexo || "F"; // "M" ou "F"

  const handleCalculateKrirs = async () => {
    const targetLimb = clinicalData.lado === "Bilateral" ? activeLimbRef.current : null;
    const input: KrirsInput = {
      idade: getPatientAge(),
      esportePivot: clinicalData.esportePivot,
      pivotShift: formData.exameLigamentar?.pivotShift || 0,
      revisao: clinicalData.revisao,
      hiperlaxidade: clinicalData.beightonScore >= 4,
      meniscoLateral: isMeniscal,
      lesaoCronica: clinicalData.lesaoCronica,
      aderTest: formData.exameLigamentar?.aderTest || false,
      gavetaRotInterna: formData.exameLigamentar?.gavetaRotInterna || false,
    };
    try {
      const res = await krirsMutation.mutateAsync({ data: input as never });
      updateFormForLimb(targetLimb, (prev) => ({
        ...prev,
        lcaAlgorithm: {
          krirsInterpretacao: res.nivelRisco,
          tecnicaRecomendada: res.tecnica,
          justificativa: res.justificativa,
          flagAltoRisco: res.flagAltoRisco,
          idade: input.idade,
          esportePivot: input.esportePivot,
          pivotShift: input.pivotShift,
          revisao: input.revisao,
          hiperlaxidade: input.hiperlaxidade,
          meniscoLateral: input.meniscoLateral,
          recomendacaoExtra: (res as any).recomendacao as string[] | undefined,
          alerta: (res as any).alerta as string | null | undefined,
          instabAnteromedial: (res as any).instabAnteromedial as boolean | undefined,
          instabAnterolateral: (res as any).instabAnterolateral as boolean | undefined,
        },
      }));
    } catch (e) {
      toast({ title: tn("krirsCalculationError"), variant: "destructive" });
    }
  };

  const handleCalculatePics = async () => {
    const targetLimb = clinicalData.lado === "Bilateral" ? activeLimbRef.current : null;
    const input: PicsInput = {
      dejourTipo: formData.examePatelar?.dejourTipo || "A",
      numEpisodios: formData.examePatelar?.numEpisodios || 1,
      luxacaoCronica: formData.examePatelar?.luxacaoCronica || false,
      idade: getPatientAge(),
      ttTgMm: formData.examePatelar?.ttTgMm || 15,
      catonDeschamps: formData.examePatelar?.catonDeschamps || 1.0,
      maltrackingDinamico: formData.examePatelar?.maltrackingDinamico || false,
      inclinacaoPatelarGraus: formData.examePatelar?.inclinacaoPatelarCategoria === "bascula" ? 5 : formData.examePatelar?.inclinacaoPatelarCategoria === "limitrofe" ? 9 : formData.examePatelar?.inclinacaoPatelarGraus || 15,
      lesaoCondral: formData.examePatelar?.lesaoCondral || false,
      hiperlaxidade: clinicalData.beightonScore >= 4,
      sexo: selectedPatient?.sexo || "F",
    };
    try {
      const res = await picsMutation.mutateAsync({ data: input as never });
      updateFormForLimb(targetLimb, (prev) => ({
        ...prev,
        picsScore: {
          ptsTotal: res.picsTotal,
          ptsRisco: res.picsRisco,
          ptsConduta: res.picsConduta,
          fatorDominante: res.fatorDominante,
        },
      }));
    } catch (e) {
      toast({ title: tn("picsCalculationError"), variant: "destructive" });
    }
  };

  // Casos osteocondrais usam esta etapa para confirmar o banco de tecidos antes do planejamento.
  const shouldSkipAlgStep = !hasLca && !isPatelar && !isOsteocondral;
  const shouldSkipBothMiddleSteps = !hasOsteocondralPlanning && (
    isOrtobiologicoIsolado || isArtroplastia || isOutrosProcedimentosIsolado || isFraturasIsolado || isTendonesIsolado
  );

  const handleNext = async () => {
    if (!(await persistExistingDraft())) return;
    if (step === 2 && isMultiligamentar) {
      toast({ title: tn("multiligamentInjury"), description: tn("multiligamentWarning") });
    }
    // Pula steps 3 (Alinhamento) e 4 (Algoritmos) quando só há ortobiológico, artroplastia ou outros procedimentos isolado
    if (step === 2 && shouldSkipBothMiddleSteps) {
      setStep(techniqueStep);
      return;
    }
    // Pula step 4 (Algoritmos) quando não há algoritmo aplicável
    if (step === 3 && shouldSkipAlgStep) {
      setStep(techniqueStep);
      return;
    }
    setStep((s) => Math.min(s + 1, observationsStep));
  };

  const handleBack = () => {
    // Pula steps 4 (Algoritmos) e 3 (Alinhamento) ao voltar quando só há ortobiológico, artroplastia ou outros procedimentos isolado
    if (step === techniqueStep && shouldSkipBothMiddleSteps) {
      setStep(2);
      return;
    }
    // Pula step 4 (Algoritmos) ao voltar quando não há algoritmo aplicável
    if (step === techniqueStep && shouldSkipAlgStep) {
      setStep(3);
      return;
    }
    setStep((s) => Math.max(s - 1, 1));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.patientId) {
      toast({ title: t("selectPatient"), variant: "destructive" });
      return;
    }
    const serializedPayload = buildDraftPayload();
    if (clinicalData.lado === "Bilateral") {
      const documentation = readBilateralDocumentation(serializedPayload.procedimentosDetalhados);
      const missing = (["direito", "esquerdo"] as const).find(
        (limb) => !hasSubstantiveLimbDocumentation(documentation?.byLimb[limb]),
      );
      if (missing) {
        switchLimb(missing);
        const side = locale === "es"
          ? (missing === "direito" ? "derecha" : "izquierda")
          : (missing === "direito" ? "direito" : "esquerdo");
        toast({
          title: locale === "es" ? `Falta documentación de la rodilla ${side}` : `Falta documentação do joelho ${side}`,
          description: locale === "es"
            ? "Registre al menos un diagnóstico, examen, procedimiento u observación para este lado."
            : "Registre ao menos um diagnóstico, exame, procedimento ou observação para este lado.",
          variant: "destructive",
        });
        return;
      }
    }
    // Build procedimento list from active sections + ligament reconstructions
    const activeProcsArr: string[] = [];
    (formData.ligamentosAcometidos || []).forEach((lig: string) => activeProcsArr.push(`Reconstrução de ${lig}`));
    if (activeProcSections.has("sutura")) activeProcsArr.push("Sutura Meniscal");
    if (extraArticular.lal || extraArticular.let || extraArticular.loa) activeProcsArr.push("LEAP");
    if (activeProcSections.has("osteotomia")) activeProcsArr.push("Osteotomia");
    if (activeProcSections.has("ortobiologico")) activeProcsArr.push("Ortobiológico");
    if (outrosProcedimentos.length > 0) activeProcsArr.push("Outros Procedimentos");
    if (fraturas.length > 0) activeProcsArr.push("Fraturas");
    if (tendoes.length > 0) activeProcsArr.push("Rupturas Tendíneas");

    const hasLcpData = formData.ligamentosAcometidos?.includes("LCP") &&
      (lcpTecnica.grauLesao || lcpTecnica.tecnica || lcpTecnica.enxerto || lcpTecnica.flipCutter);

    const body: CreateSurgeryBody = {
      ...(formData as CreateSurgeryBody),
      flipCutter: hasLca && (formData.tipoLca || "Reconstrução") === "Reconstrução"
        ? formData.flipCutter || null
        : null,
      ocdAnalysis: isOsteocondral ? ocdAnalysis : undefined,
      lado: clinicalData.lado || undefined,
      alinhamento: formData.alinhamento || undefined,
      procedimentoRealizado: activeProcsArr.join(", "),
      reforco: (extraArticular.lal || extraArticular.let || extraArticular.loa)
        ? JSON.stringify(extraArticular)
        : undefined,
      procedimentosDetalhados: clinicalData.lado === "Bilateral"
        ? serializedPayload.procedimentosDetalhados
        : JSON.stringify({
        osteotomia,
        ortobiologico,
        outrosProcedimentos: outrosProcedimentos.length > 0 ? outrosProcedimentos : undefined,
        fraturas: fraturas.length > 0 ? fraturas : undefined,
        tendoes: tendoes.length > 0 ? tendoes : undefined,
        tendinopatiaSubtipos: tendinopatiaSubtipos.length > 0 ? tendinopatiaSubtipos : undefined,
        patelar: isPatelar ? patelarTecnica : undefined,
        osteocondral: isOsteocondral ? osteocondralTecnica : undefined,
        artroplastia: isArtroplastia ? { ...artroplastiaTecnica, alinhamentoMembro: artroplastiaTecnica.alinhamentoMembro.join(", ") } : undefined,
        }),
      lcpReconstruction: hasLcpData ? lcpTecnica : undefined,
      cpmReconstruction: formData.ligamentosAcometidos?.includes("CPM") && (cpmTecnica.abordagem || cpmTecnica.lcmTecnica || cpmTecnica.lcmReparoTecnica || cpmTecnica.lopTecnica)
        ? cpmTecnica
        : undefined,
      cplReconstruction: formData.ligamentosAcometidos?.includes("CPL") && (cplTecnica.tecnica || cplTecnica.enxertos.some(e => e.nome))
        ? { ...cplTecnica, enxertos: cplTecnica.enxertos.filter(e => e.nome) }
        : undefined,
      patelarTendonRupture: tendoes.includes("Ruptura do Tendão Patelar") ? {
        classificacao: patelarTendon.classificacao || undefined,
        dataLesao: patelarTendon.dataLesao || undefined,
        dataCirurgiaDefinitiva: patelarTendon.dataCirurgiaDefinitiva || undefined,
        cirurgia: patelarTendon.cirurgia,
        cirurgiaOutro: patelarTendon.cirurgiaOutro || undefined,
        reforco: patelarTendon.reforco,
        reforcoTipo: patelarTendon.reforcoTipo,
        reforcoTendao: patelarTendon.reforcoTendao,
        reforcoTendaoOutro: patelarTendon.reforcoTendaoOutro || undefined,
        imageUrls: patelarTendon.imageUrls.length > 0 ? patelarTendon.imageUrls : undefined,
        observacoes: patelarTendon.observacoes || undefined,
      } : undefined,
      quadricepsTendonRupture: tendoes.includes("Ruptura do Tendão Quadríceps") ? {
        classificacao: quadricepsTendon.classificacao || undefined,
        dataLesao: quadricepsTendon.dataLesao || undefined,
        dataCirurgiaDefinitiva: quadricepsTendon.dataCirurgiaDefinitiva || undefined,
        cirurgia: quadricepsTendon.cirurgia,
        cirurgiaOutro: quadricepsTendon.cirurgiaOutro || undefined,
        reforco: quadricepsTendon.reforco,
        reforcoTipo: quadricepsTendon.reforcoTipo,
        reforcoTendao: quadricepsTendon.reforcoTendao,
        reforcoTendaoOutro: quadricepsTendon.reforcoTendaoOutro || undefined,
        imageUrls: quadricepsTendon.imageUrls.length > 0 ? quadricepsTendon.imageUrls : undefined,
        observacoes: quadricepsTendon.observacoes || undefined,
      } : undefined,
    };

    // If editing a draft, finalize it
    if (draftId) {
      try {
        const result = await apiFinalize(draftId, body as any, tn("finalizeError"));
        toast({ title: tn("surgeryRegistered") });
        setLocation(`/surgeries/${result.id}`);
      } catch (err: any) {
        toast({ title: tn("surgeryRegistrationError"), description: err.message, variant: "destructive" });
      }
      return;
    }

    createSurgeryMutation.mutate(
      { data: body as never },
      {
        onSuccess: (data) => {
          toast({ title: tn("surgeryRegistered") });
          setLocation(`/surgeries/${data.id}`);
        },
        onError: () => {
          toast({ title: tn("surgeryRegistrationError"), variant: "destructive" });
        },
      }
    );
  };

  const stepTitles = [
    t("basicData"),
    t("caseType"),
    t("memberAlignment"),
    t("algorithms"),
    ...(hasOsteocondralPlanning ? [t("planning")] : []),
    t("surgicalTechnique"),
    t("observations"),
  ];
  // Ajusta contagem de steps conforme o que é pulado
  const skippedStepsCount = shouldSkipBothMiddleSteps ? 2 : shouldSkipAlgStep ? 1 : 0;
  const effectiveTotal = stepTitles.length - skippedStepsCount;
  const effectiveStep = shouldSkipBothMiddleSteps && step > 4
    ? step - 2
    : shouldSkipAlgStep && !shouldSkipBothMiddleSteps && step > 4
    ? step - 1
    : step;

  if (!subLoading && !canWrite) return <SubscriptionGate />;
  if (draftIdParam && !draftLoaded) {
    return (
      <div className="w-full max-w-4xl mx-auto p-4 sm:p-6 md:p-8">
        <Card>
          <CardContent className="flex items-center justify-center gap-3 py-12 text-sm text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
            {t("loadingDraft")}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="w-full min-w-0 max-w-4xl mx-auto space-y-6 p-4 pb-24 sm:p-6 md:p-8 md:pb-8">
      {/* Header */}
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3 sm:gap-4">
          <Link href="/surgeries">
            <Button variant="outline" size="icon">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div className="min-w-0">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <h1 className="min-w-0 break-words text-2xl font-bold tracking-tight sm:text-3xl">{t("procedureRegistration")}</h1>
              {draftId && (
                <span className="shrink-0 rounded-full border border-amber-300 bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700">
                   {tn("draftNumber", { id: draftId })}
                </span>
              )}
            </div>
            <p className="text-muted-foreground text-sm">{stepTitles[step - 1]}</p>
          </div>
        </div>
        <span className="shrink-0 rounded-full bg-muted px-2 py-1 text-xs font-medium text-muted-foreground sm:px-3 sm:text-sm">
          {effectiveStep} / {effectiveTotal}
        </span>
      </div>

      {/* Progress */}
      <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
        <div
          className="h-full bg-primary transition-all duration-300"
          style={{ width: `${(effectiveStep / effectiveTotal) * 100}%` }}
        />
      </div>

      {clinicalData.lado === "Bilateral" && (
        <div className="sticky top-2 z-30 rounded-xl border-2 border-primary/30 bg-background/95 p-2 shadow-sm backdrop-blur">
          <p className="mb-1.5 text-center text-xs font-semibold uppercase tracking-wide text-primary">
            {locale === "es" ? "Documentando rodilla" : "Documentando joelho"}
          </p>
          <div className="grid grid-cols-2 gap-2" role="tablist" aria-label={locale === "es" ? "Rodilla documentada" : "Joelho documentado"}>
            {(["direito", "esquerdo"] as const).map((limb) => (
              <Button
                key={limb}
                type="button"
                role="tab"
                aria-selected={activeLimb === limb}
                variant={activeLimb === limb ? "default" : "outline"}
                className="h-11 w-full"
                onClick={() => switchLimb(limb)}
              >
                {locale === "es"
                  ? (limb === "direito" ? "Derecho" : "Izquierdo")
                  : (limb === "direito" ? "Direito" : "Esquerdo")}
              </Button>
            ))}
          </div>
        </div>
      )}

      {/* Step indicators */}
      <div className="hidden md:flex gap-1">
        {stepTitles.map((title, i) => {
          const stepNum = i + 1;
          // Oculta steps pulados conforme tipo de procedimento
          if ((isOrtobiologicoIsolado || isOutrosProcedimentosIsolado || isFraturasIsolado || isTendonesIsolado) && (stepNum === 3 || stepNum === 4)) return null;
          if (!isOrtobiologicoIsolado && !isOutrosProcedimentosIsolado && !isFraturasIsolado && !isTendonesIsolado && shouldSkipAlgStep && stepNum === 4) return null;
          return (
            <div key={i} className={cn("flex-1 text-center text-xs py-1 rounded font-medium transition-colors",
              stepNum === step ? "bg-primary text-primary-foreground" :
              stepNum < step ? "bg-primary/20 text-primary" :
              "bg-muted text-muted-foreground"
            )}>
              {title}
            </div>
          );
        })}
      </div>

      <Card className="w-full min-w-0 border shadow-sm">
        <CardContent className="min-w-0 p-4 sm:p-6">
            <form
              id="surgery-form"
              onSubmit={handleSubmit}
              onPointerDownCapture={handleWizardPointerDownCapture}
              onPointerMoveCapture={handleWizardPointerMoveCapture}
              onClickCapture={handleWizardClickCapture}
              className="min-w-0"
            >

            {/* STEP 1: Dados Básicos */}
            {step === 1 && (
              <div className="space-y-6">
                 <h2 className="text-xl font-semibold">{t("basicData")}</h2>
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2 md:col-span-2">
                     <Label>{t("patient")} *</Label>
                    <Select
                      value={formData.patientId?.toString() ?? ""}
                      onValueChange={(v) => updateData("patientId", parseInt(v))}
                    >
                       <SelectTrigger><SelectValue placeholder={t("selectPatient")} /></SelectTrigger>
                      <SelectContent>
                        {sortedPatients.map((p) => (
                          <SelectItem key={p.id} value={p.id.toString()}>{p.nome}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                     <Label>{t("procedureDate")}</Label>
                    <Input type="date" value={formData.dataCirurgia} onChange={(e) => updateData("dataCirurgia", e.target.value)} />
                  </div>
                  <div className="space-y-2">
                     <Label>{tn("surgerySide")}</Label>
                     <Select value={clinicalData.lado} onValueChange={handleLateralityChange}>
                       <SelectTrigger><SelectValue placeholder={tn("select")} /></SelectTrigger>
                      <SelectContent>
                         <SelectItem value="Direito">{t("right")}</SelectItem>
                         <SelectItem value="Esquerdo">{t("left")}</SelectItem>
                         <SelectItem value="Bilateral">{tn("bilateral")}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2 md:col-span-2">
                     <Label>{t("hospital")}</Label>
                    <HospitalField
                      value={formData.hospital ?? ""}
                      onChange={(v) => updateData("hospital", v)}
                    />
                  </div>
                </div>

                {/* Diagnóstico */}
                <div className="border rounded-xl p-4 bg-muted/20 space-y-3">
                  <div>
                     <p className="text-sm font-semibold">{t("diagnosis")}</p>
                     <p className="text-xs text-muted-foreground">{tn("selectAllDiagnoses")}</p>
                  </div>
                  <div className="grid sm:grid-cols-2 gap-2">
                    {([
                      ["Osteoartrose",        "Osteoartrose"],
                      ["Condromalacia Patelar","Condromalacia Patelar"],
                      ["Lesão Meniscal",       "Lesão Meniscal"],
                      ["Lesão Ligamentar",     "Lesão Ligamentar"],
                      ["Lesão Muscular",       "Lesão Muscular"],
                      ["Lesão Osteocondral",    "Lesão Osteocondral"],
                      ["Fraturas",             "Fraturas"],
                      ["Instabilidade Patelar","Instabilidade Patelar"],
                    ] as [string, string][]).map(([val, label]) => {
                      const current = (formData.diagnostico ?? "").split(",").map((s: string) => s.trim()).filter(Boolean);
                      const isSelected = current.includes(val);
                      return (
                        <button key={val} type="button"
                          onClick={() => {
                            const next = isSelected
                              ? current.filter((v: string) => v !== val)
                              : [...current, val];
                            setFormData((prev: Partial<CreateSurgeryBody>) => ({ ...prev, diagnostico: next.join(", ") }));
                          }}
                          className={cn("text-sm text-left px-3 py-2 rounded-lg border-2 transition-all",
                            isSelected
                              ? "border-primary bg-primary/5 font-medium text-primary"
                              : "border-border hover:border-primary/40")}>
                           {isSelected && <CheckCircle2 className="inline h-3 w-3 mr-1" />}{displayOption(label)}
                        </button>
                      );
                    })}
                    {/* Tendinopatia como diagnóstico */}
                    {(() => {
                      const current = (formData.diagnostico ?? "").split(",").map((s: string) => s.trim()).filter(Boolean);
                      const isSelected = current.includes("Tendinopatia");
                      return (
                        <button type="button"
                          onClick={() => {
                            const next = isSelected
                              ? current.filter((v: string) => v !== "Tendinopatia")
                              : [...current, "Tendinopatia"];
                            if (isSelected) setTendinopatiaSubtipos([]);
                            setFormData((prev: Partial<CreateSurgeryBody>) => ({ ...prev, diagnostico: next.join(", ") }));
                          }}
                          className={cn("text-sm text-left px-3 py-2 rounded-lg border-2 transition-all",
                            isSelected
                              ? "border-primary bg-primary/5 font-medium text-primary sm:col-span-2"
                              : "border-border hover:border-primary/40")}>
                           {isSelected && <CheckCircle2 className="inline h-3 w-3 mr-1" />}{tn("tendinopathy")}
                          {isSelected && (
                            <span className="block mt-2 -mb-1">
                               <span className="text-xs font-normal text-muted-foreground block mb-1.5">{tn("selectAffectedTendons")}</span>
                              <span className="flex flex-wrap gap-2" onClick={e => e.stopPropagation()}>
                                {["Quadríceps", "Patelar", "Trato Iliotibial", "Pata de Ganso"].map(tendao => {
                                  const sel = tendinopatiaSubtipos.includes(tendao);
                                  return (
                                    <span key={tendao}
                                      onClick={e => { e.stopPropagation(); setTendinopatiaSubtipos(prev => sel ? prev.filter(t => t !== tendao) : [...prev, tendao]); }}
                                      className={cn("inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium border cursor-pointer transition-all",
                                        sel ? "bg-primary text-white border-primary" : "bg-background border-border hover:border-primary/50 text-foreground")}>
                                       {sel && <CheckCircle2 className="h-3 w-3" />}{displayOption(tendao)}
                                    </span>
                                  );
                                })}
                              </span>
                            </span>
                          )}
                        </button>
                      );
                    })()}
                  </div>
                </div>
              </div>
            )}

            {/* STEP 2: Tipo do Caso */}
            {step === 2 && (
              <div className="space-y-6">
                 <h2 className="text-xl font-semibold">{t("caseType")}</h2>
                 <p className="text-sm text-muted-foreground">{tn("caseTypeHelp")}</p>

                {tiposSelected.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {tiposSelected.map((t: string) => (
                      <span key={t} className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-primary/10 text-primary text-xs font-medium border border-primary/20">
                        <CheckCircle2 className="h-3 w-3" /> {displayOption(t)}
                      </span>
                    ))}
                  </div>
                )}
                <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3">
                  {TIPOS_CASO.map((tipo) => {
                    const selected = tiposSelected.includes(tipo.value);
                    const isRegen = tipo.value === "Ortobiológicos";
                    return (
                      <button
                        key={tipo.value}
                        type="button"
                        onClick={() => toggleTipoCaso(tipo.value)}
                        className={cn(
                          "relative text-left p-4 rounded-xl border-2 transition-all duration-150 hover:border-primary/50",
                          selected
                            ? "border-primary bg-primary/5 shadow-sm"
                            : "border-border bg-card"
                        )}
                      >
                        {selected && (
                          <CheckCircle2 className="absolute top-2 right-2 h-4 w-4 text-primary" />
                        )}
                        {isRegen && !selected && (
                          <span className="absolute top-2 right-2 text-[9px] font-bold px-1.5 py-0.5 rounded tracking-wider" style={{ background: "rgba(41,182,246,0.18)", color: "#29B6F6" }}>NEW</span>
                        )}
                        <p className="font-semibold text-sm">{displayOption(tipo.label)}</p>
                        <p className="text-xs text-muted-foreground mt-1">{displayOption(tipo.desc)}</p>
                      </button>
                    );
                  })}
                </div>

                {/* Exame Físico por tipo — expandido inline */}
                {tiposSelected.length > 0 && (
                  <div className="space-y-6 border-t pt-6">
                     <h3 className="text-lg font-semibold">{tn("physicalExamForTypes", { types: tiposSelected.map(displayOption).join(" + ") })}</h3>

                    {/* ── Classificação de Tanner — paciente ≤ 15 anos ── */}
                    {isJovem && (
                      <div className="rounded-xl border-2 border-orange-400 bg-orange-50 p-4 space-y-4">
                        <div className="flex items-center gap-2">
                          <span className="text-lg">🧒</span>
                          <div>
                             <p className="font-bold text-orange-900 text-sm">{tn("tannerTitle")}</p>
                             <p className="text-xs text-orange-700">{tn("tannerAgeHelp", { age: getPatientAge() })}</p>
                          </div>
                        </div>

                        {/* Pelos Pubianos — ambos os sexos */}
                        <div className="space-y-2">
                          <p className="text-xs font-semibold text-orange-800 uppercase tracking-wide">{examLabel("Pelos Pubianos (P) — ambos os sexos")}</p>
                          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-5">
                            {[
                              { val: "P1", label: "P1", desc: "Pré-puberal — ausente" },
                              { val: "P2", label: "P2", desc: "Esparsos, base do pênis / lábios maiores" },
                              { val: "P3", label: "P3", desc: "Escuros, grossos, encaracolados — espalhados" },
                              { val: "P4", label: "P4", desc: "Distribuição adulta, não atinge coxas" },
                              { val: "P5", label: "P5", desc: "Adulto — face medial das coxas" },
                            ].map(({ val, label, desc }) => {
                              const sel = (formData.exameLigamentar as any)?.tannerPelos === val;
                              return (
                                <button key={val} type="button"
                                  onClick={() => updateNested("exameLigamentar", "tannerPelos", sel ? "" : val)}
                                  className={cn("rounded-lg border-2 py-2 px-1 text-center transition-all",
                                    sel ? "border-orange-500 bg-orange-100" : "border-orange-200 bg-white hover:border-orange-400")}>
                                  <p className={cn("text-sm font-bold", sel ? "text-orange-900" : "text-foreground")}>{label}</p>
                                  <p className="text-[9px] text-muted-foreground leading-tight mt-0.5">{examLabel(desc)}</p>
                                </button>
                              );
                            })}
                          </div>
                        </div>

                        {/* Mamas — meninas */}
                        {(sexoPaciente === "F" || sexoPaciente === "feminino") && (
                          <div className="space-y-2">
                            <p className="text-xs font-semibold text-orange-800 uppercase tracking-wide">{examLabel("Mamas (M) — meninas")}</p>
                            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-5">
                              {[
                                { val: "M1", label: "M1", desc: "Pré-puberal — só elevação do mamilo" },
                                { val: "M2", label: "M2", desc: "Botão mamário — aréola maior" },
                                { val: "M3", label: "M3", desc: "Mama e aréola aumentadas, contornos contínuos" },
                                { val: "M4", label: "M4", desc: "Aréola e papila: montículo secundário" },
                                { val: "M5", label: "M5", desc: "Fase adulta — só mamilo projetado" },
                              ].map(({ val, label, desc }) => {
                                const sel = (formData.exameLigamentar as any)?.tannerMamas === val;
                                return (
                                  <button key={val} type="button"
                                    onClick={() => updateNested("exameLigamentar", "tannerMamas", sel ? "" : val)}
                                    className={cn("rounded-lg border-2 py-2 px-1 text-center transition-all",
                                      sel ? "border-orange-500 bg-orange-100" : "border-orange-200 bg-white hover:border-orange-400")}>
                                    <p className={cn("text-sm font-bold", sel ? "text-orange-900" : "text-foreground")}>{label}</p>
                                    <p className="text-[9px] text-muted-foreground leading-tight mt-0.5">{examLabel(desc)}</p>
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        )}

                        {/* Genitália — meninos */}
                        {(sexoPaciente === "M" || sexoPaciente === "masculino") && (
                          <div className="space-y-2">
                            <p className="text-xs font-semibold text-orange-800 uppercase tracking-wide">{examLabel("Genitália (G) — meninos")}</p>
                            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-5">
                              {[
                                { val: "G1", label: "G1", desc: "Pré-puberal — testículos infantis < 4 mL" },
                                { val: "G2", label: "G2", desc: "Testículos 4–8 mL, escroto avermelhado" },
                                { val: "G3", label: "G3", desc: "Pênis mais longo, testículos 9–12 mL" },
                                { val: "G4", label: "G4", desc: "Glande desenvolvida, testículos 12–20 mL" },
                                { val: "G5", label: "G5", desc: "Genitália adulta — testículos > 20 mL" },
                              ].map(({ val, label, desc }) => {
                                const sel = (formData.exameLigamentar as any)?.tannerGenitalia === val;
                                return (
                                  <button key={val} type="button"
                                    onClick={() => updateNested("exameLigamentar", "tannerGenitalia", sel ? "" : val)}
                                    className={cn("rounded-lg border-2 py-2 px-1 text-center transition-all",
                                      sel ? "border-orange-500 bg-orange-100" : "border-orange-200 bg-white hover:border-orange-400")}>
                                    <p className={cn("text-sm font-bold", sel ? "text-orange-900" : "text-foreground")}>{label}</p>
                                    <p className="text-[9px] text-muted-foreground leading-tight mt-0.5">{examLabel(desc)}</p>
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        )}

                        {/* Resumo do estágio selecionado */}
                        {((formData.exameLigamentar as any)?.tannerPelos || (formData.exameLigamentar as any)?.tannerMamas || (formData.exameLigamentar as any)?.tannerGenitalia) && (
                          <div className="rounded-lg bg-orange-100 border border-orange-300 px-3 py-2">
                            <p className="text-xs font-semibold text-orange-900">
                              {examLabel("Estágio registrado:")}{" "}
                              {[(formData.exameLigamentar as any)?.tannerPelos, (formData.exameLigamentar as any)?.tannerMamas, (formData.exameLigamentar as any)?.tannerGenitalia].filter(Boolean).join(" · ")}
                              {" "}— {examLabel("Estágio")}{" "}
                              {(() => {
                                const p = parseInt(((formData.exameLigamentar as any)?.tannerPelos || "P0").replace("P","")) || 0;
                                const m = parseInt(((formData.exameLigamentar as any)?.tannerMamas || "M0").replace("M","")) || 0;
                                const g = parseInt(((formData.exameLigamentar as any)?.tannerGenitalia || "G0").replace("G","")) || 0;
                                const max = Math.max(p, m, g);
                                 return examLabel(max <= 2 ? "pré-puberal / início — fise amplamente aberta" :
                                        max === 3 ? "puberal médio — fise ainda aberta" :
                                        max === 4 ? "puberal avançado — fise em fechamento" :
                                        "puberal final / fise em fechamento");
                              })()}
                            </p>
                          </div>
                        )}
                      </div>
                    )}

                {/* Lesão Ligamentar */}
                {isLigamentar && (
                  <div className="space-y-6">
                    <div>
                       <h3 className="font-semibold mb-3">{examLabel("Ligamentos Acometidos")}</h3>
                      {isMultiligamentar && (
                        <div className="mb-3 px-3 py-2 bg-yellow-50 border border-yellow-200 text-yellow-800 rounded-lg text-sm font-medium">
                           {examLabel("Lesão Multiligamentar —")} {formData.ligamentosAcometidos?.join(", ")}
                        </div>
                      )}
                      <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3">
                        {LIGAMENTOS.map((lig) => {
                          const checked = formData.ligamentosAcometidos?.includes(lig.value) || false;
                          return (
                            <button
                              key={lig.value}
                              type="button"
                              onClick={() => toggleLigamento(lig.value, !checked)}
                              className={cn(
                                "relative text-left p-4 rounded-xl border-2 transition-all duration-150 hover:border-primary/50",
                                checked ? "border-primary bg-primary/5" : "border-border bg-card"
                              )}
                            >
                              {checked && <CheckCircle2 className="absolute top-2 right-2 h-4 w-4 text-primary" />}
                              <p className="font-bold text-base">{displayOption(lig.label)}</p>
                              <p className="text-xs text-muted-foreground">{displayOption(lig.desc)}</p>
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {hasLca && (
                      <div className="border rounded-xl p-4 bg-muted/20 space-y-4">
                         <h3 className="font-semibold text-primary">{examLabel("Dados Clínicos para Algoritmo LCA")}</h3>
                        <div className="grid sm:grid-cols-2 gap-4">
                          <div className="flex items-center space-x-3">
                            <Switch
                              id="esportePivot"
                              checked={clinicalData.esportePivot}
                              onCheckedChange={(c) => setClinicalData((p) => ({ ...p, esportePivot: c }))}
                            />
                             <Label htmlFor="esportePivot">{examLabel("Esporte de Pivot")}</Label>
                          </div>
                          <div className="flex items-center space-x-3">
                            <Switch
                              id="revisao"
                              checked={clinicalData.revisao}
                              onCheckedChange={(c) => setClinicalData((p) => ({ ...p, revisao: c }))}
                            />
                             <Label htmlFor="revisao">{examLabel("Cirurgia de Revisão")}</Label>
                          </div>
                          <div className="flex items-center space-x-3">
                            <Switch
                              id="lesaoCronica"
                              checked={clinicalData.lesaoCronica}
                              onCheckedChange={(c) => setClinicalData((p) => ({ ...p, lesaoCronica: c }))}
                            />
                             <Label htmlFor="lesaoCronica">{examLabel("Lesão Crônica")}</Label>
                          </div>
                          <div className="space-y-2">
                             <Label>{examLabel("Nível de Atividade")}</Label>
                            <Select value={clinicalData.nivelAtividade} onValueChange={(v) => setClinicalData((p) => ({ ...p, nivelAtividade: v }))}>
                               <SelectTrigger><SelectValue placeholder={examLabel("Selecione")} /></SelectTrigger>
                              <SelectContent>
                                 <SelectItem value="Sedentário">{examLabel("Sedentário")}</SelectItem>
                                 <SelectItem value="Recreacional">{examLabel("Recreacional")}</SelectItem>
                                 <SelectItem value="Atleta">{examLabel("Atleta")}</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Testes Ligamentares */}
                    {hasLca && (
                      <div className="border rounded-xl p-4 bg-muted/20 space-y-4">
                         <h3 className="font-bold text-primary">{examLabel("LCA — Ligamento Cruzado Anterior")}</h3>
                        <div className="grid sm:grid-cols-2 gap-4">
                          <div className="space-y-2">
                             <Label>{examLabel("Lachman (0 = neg · 1 · 2 · 3 = +++)")}</Label>
                            <Select value={formData.exameLigamentar?.lachman?.toString() ?? ""} onValueChange={(v) => updateNested("exameLigamentar", "lachman", parseInt(v))}>
                               <SelectTrigger><SelectValue placeholder={examLabel("Grau")} /></SelectTrigger>
                              <SelectContent>
                                 {[0, 1, 2, 3].map((g) => <SelectItem key={g} value={g.toString()}>{g === 0 ? examLabel("0 — Negativo") : `${g}`}</SelectItem>)}
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="space-y-2">
                             <Label>{examLabel("Pivot Shift (0 · 1 · 2 = glide · 3 = crash)")}</Label>
                            <Select value={formData.exameLigamentar?.pivotShift?.toString() ?? ""} onValueChange={(v) => updateNested("exameLigamentar", "pivotShift", parseInt(v))}>
                               <SelectTrigger><SelectValue placeholder={examLabel("Grau")} /></SelectTrigger>
                              <SelectContent>
                                 {[0, 1, 2, 3].map((g) => <SelectItem key={g} value={g.toString()}>{g === 0 ? examLabel("0 — Negativo") : g === 2 ? "2 — Glide" : g === 3 ? "3 — Crash" : `${g}`}</SelectItem>)}
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="space-y-2">
                             <Label>{examLabel("Gaveta Anterior em Rotação Neutra")}</Label>
                            <Select value={formData.exameLigamentar?.gavetaNeutra?.toString() ?? ""} onValueChange={(v) => updateNested("exameLigamentar", "gavetaNeutra", parseInt(v))}>
                               <SelectTrigger><SelectValue placeholder={examLabel("Grau")} /></SelectTrigger>
                              <SelectContent>
                                 {[0, 1, 2, 3].map((g) => <SelectItem key={g} value={g.toString()}>{g === 0 ? examLabel("0 — Negativo") : `${g}`}</SelectItem>)}
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="flex items-center space-x-3">
                            <Switch checked={!!formData.exameLigamentar?.aderTest} onCheckedChange={(c) => updateNested("exameLigamentar", "aderTest", c)} />
                             <Label>{examLabel("ADER Test Positivo")}</Label>
                          </div>
                          <div className="flex items-center space-x-3">
                            <Switch checked={!!formData.exameLigamentar?.gavetaRotInterna} onCheckedChange={(c) => updateNested("exameLigamentar", "gavetaRotInterna", c)} />
                             <Label>{examLabel("Gaveta Rotação Interna Positiva")}</Label>
                          </div>

                          {/* Hiperextensão do Joelho */}
                          <div className="space-y-2 sm:col-span-2">
                             <Label className="font-semibold">{examLabel("Hiperextensão do Joelho")}</Label>
                            <div className="flex gap-2 flex-wrap">
                              {([
                                { value: "<5", label: "< 5°", desc: "Normal" },
                                { value: "5-6.5", label: "5 – 6,5°", desc: "Limítrofe" },
                                { value: ">6.5", label: "≥ 6,5°", desc: "Hiperlaxidade" },
                              ] as const).map((opt) => {
                                const selected = formData.exameLigamentar?.hiperextensao === opt.value;
                                return (
                                  <button
                                    key={opt.value}
                                    type="button"
                                    onClick={() => updateNested("exameLigamentar", "hiperextensao",
                                      selected ? undefined : opt.value
                                    )}
                                    className={`flex flex-col items-center px-5 py-2.5 rounded-lg border-2 text-sm font-medium transition-all ${
                                      selected
                                        ? opt.value === ">6.5"
                                          ? "border-red-500 bg-red-50 text-red-700"
                                          : opt.value === "5-6.5"
                                          ? "border-amber-400 bg-amber-50 text-amber-700"
                                          : "border-green-500 bg-green-50 text-green-700"
                                        : "border-border bg-background text-muted-foreground hover:border-primary/50"
                                    }`}
                                  >
                                    <span className="text-base font-bold">{opt.label}</span>
                                     <span className="text-xs mt-0.5">{examLabel(opt.desc)}</span>
                                  </button>
                                );
                              })}
                            </div>
                          </div>


                          {/* Alerta para ≥ 6,5° */}
                          {formData.exameLigamentar?.hiperextensao === ">6.5" && (
                            <div className="flex items-start gap-2 p-3 rounded-lg bg-red-50 border border-red-300 text-red-800 sm:col-span-2">
                              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-red-600" />
                              <p className="text-xs font-medium">
                                 {examLabel("Hiperextensão ≥ 6,5° — indicada")} <strong>{examLabel("tenodese lateral ou reconstrução do ligamento anterolateral (LAL)")}</strong> {examLabel("para reduzir o índice de falha do LCA.")}
                              </p>
                            </div>
                          )}

                          {/* Fatores de Risco Adicionais para o LEAP */}
                          <div className="sm:col-span-2 pt-2 space-y-3">
                             <Label className="font-semibold text-indigo-800">{examLabel("Fatores de Risco — LEAP")}</Label>
                            <div className="grid sm:grid-cols-2 gap-3">
                              <div className="flex items-center space-x-3">
                                <Switch checked={!!formData.exameLigamentar?.esqueletoImaturo} onCheckedChange={(c) => updateNested("exameLigamentar", "esqueletoImaturo", c)} />
                                 <Label className="text-sm">{examLabel("Esqueleto Imaturo")}</Label>
                              </div>
                              <div className="flex items-center space-x-3">
                                <Switch checked={!!formData.exameLigamentar?.contralateralLca} onCheckedChange={(c) => updateNested("exameLigamentar", "contralateralLca", c)} />
                                 <Label className="text-sm">{examLabel("História de LCA Contralateral")}</Label>
                              </div>
                              <div className="flex items-center space-x-3">
                                <Switch checked={!!formData.exameLigamentar?.tabagismo} onCheckedChange={(c) => updateNested("exameLigamentar", "tabagismo", c)} />
                                 <Label className="text-sm">{examLabel("Tabagismo")}</Label>
                              </div>
                              <div className="flex items-center space-x-3">
                                <Switch checked={!!formData.exameLigamentar?.earlyRtsPivot} onCheckedChange={(c) => updateNested("exameLigamentar", "earlyRtsPivot", c)} />
                                 <Label className="text-sm">{examLabel("Retorno precoce a esporte de pivô planejado")}</Label>
                              </div>
                              <div className="flex items-center space-x-3">
                                <Switch checked={!!formData.exameLigamentar?.segondFratura} onCheckedChange={(c) => updateNested("exameLigamentar", "segondFratura", c)} />
                                 <Label className="text-sm">{examLabel("Fratura de Segond")}</Label>
                              </div>
                              <div className="flex items-center space-x-3">
                                <Switch checked={!!formData.exameLigamentar?.notchEstreito} onCheckedChange={(c) => updateNested("exameLigamentar", "notchEstreito", c)} />
                                 <Label className="text-sm">{examLabel("Chanfradura Estreita (Notch) / Sinal do Notch")}</Label>
                              </div>
                              <div className="flex items-center space-x-3">
                                <Switch checked={!!formData.exameLigamentar?.lesaoAlcImagem} onCheckedChange={(c) => updateNested("exameLigamentar", "lesaoAlcImagem", c)} />
                                 <Label className="text-sm">{examLabel("Lesão do Complexo Anterolateral em RM/US")}</Label>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                    {hasLcp && (
                      <div className="border-2 border-primary/30 rounded-xl p-4 bg-primary/5 space-y-4">
                         <h3 className="font-bold text-primary">{examLabel("LCP — Ligamento Cruzado Posterior")}</h3>

                        <div className="grid sm:grid-cols-2 gap-4">
                          <div className="space-y-2">
                             <Label className="font-semibold">{examLabel("Gaveta Posterior ★ (Ouro)")}</Label>
                            <Select value={formData.exameLigamentar?.gavetaPosterior?.toString() ?? ""} onValueChange={(v) => updateNested("exameLigamentar", "gavetaPosterior", parseInt(v))}>
                               <SelectTrigger><SelectValue placeholder={examLabel("Grau")} /></SelectTrigger>
                              <SelectContent>
                                 <SelectItem value="0">{examLabel("0 — Negativo")}</SelectItem>
                                 <SelectItem value="1">{examLabel("Grau I — 0–5 mm")}</SelectItem>
                                 <SelectItem value="2">{examLabel("Grau II — 5–10 mm")}</SelectItem>
                                 <SelectItem value="3">{examLabel("Grau III — >10 mm")}</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="flex items-center space-x-3">
                            <Switch checked={!!formData.exameLigamentar?.sagSign} onCheckedChange={(c) => updateNested("exameLigamentar", "sagSign", c)} />
                             <Label>{examLabel("Sag Sign / Godfrey (queda posterior)")}</Label>
                          </div>
                          <div className="flex items-center space-x-3">
                            <Switch checked={!!formData.exameLigamentar?.quadricepsAtivo} onCheckedChange={(c) => updateNested("exameLigamentar", "quadricepsAtivo", c)} />
                             <Label>{examLabel("Quadríceps Ativo Positivo")}</Label>
                          </div>
                          <div className="flex items-center space-x-3">
                            <Switch checked={!!(formData.exameLigamentar as any)?.lachmantPosterior} onCheckedChange={(c) => updateNested("exameLigamentar", "lachmantPosterior", c)} />
                             <Label>{examLabel("Lachman Posterior")}</Label>
                          </div>
                        </div>

                        {/* Dial Test específico para LCP */}
                        <div>
                           <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 block">{examLabel("Dial Test (Rotação Externa)")}</Label>
                           <p className="text-xs text-muted-foreground mb-2">{examLabel("Positivo a 30° apenas = CPL isolado · Positivo a 30° e 90° = LCP + CPL")}</p>
                          <div className="flex flex-wrap gap-4">
                            <div className="flex items-center space-x-3">
                              <Switch checked={!!(formData.exameLigamentar as any)?.dialTest30} onCheckedChange={(c) => updateNested("exameLigamentar", "dialTest30", c)} />
                               <Label>{examLabel("Positivo a 30°")}</Label>
                            </div>
                            <div className="flex items-center space-x-3">
                              <Switch checked={!!(formData.exameLigamentar as any)?.dialTest90} onCheckedChange={(c) => updateNested("exameLigamentar", "dialTest90", c)} />
                               <Label>{examLabel("Positivo a 90°")}</Label>
                            </div>
                          </div>
                          {(formData.exameLigamentar as any)?.dialTest30 && (formData.exameLigamentar as any)?.dialTest90 && (
                            <p className="mt-2 text-xs font-semibold text-red-700 bg-red-50 border border-red-200 rounded px-3 py-1">
                               {examLabel("⚠ Dial Test positivo a 30° e 90° — suspeita de lesão combinada LCP + CPL")}
                            </p>
                          )}
                          {(formData.exameLigamentar as any)?.dialTest30 && !(formData.exameLigamentar as any)?.dialTest90 && (
                            <p className="mt-2 text-xs font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-1">
                               {examLabel("Dial Test positivo apenas a 30° — provável lesão isolada de CPL")}
                            </p>
                          )}
                        </div>
                      </div>
                    )}
                    {/* CPL — Canto Póstero-Lateral */}
                    {hasPlc && (
                      <div className="border rounded-xl p-4 bg-muted/20 space-y-4">
                         <h3 className="font-bold text-primary">{examLabel("CPL — Canto Póstero-Lateral")}</h3>
                        <div className="grid sm:grid-cols-2 gap-4">
                          <div className="flex items-center space-x-3">
                            <Switch checked={!!formData.exameLigamentar?.dialTest} onCheckedChange={(c) => updateNested("exameLigamentar", "dialTest", c)} />
                             <Label>{examLabel("Dial Test Positivo")}</Label>
                          </div>
                          <div className="flex items-center space-x-3">
                            <Switch checked={!!formData.exameLigamentar?.recurvato} onCheckedChange={(c) => updateNested("exameLigamentar", "recurvato", c)} />
                             <Label>{examLabel("Recurvatum em Rotação Externa")}</Label>
                          </div>
                          <div className="flex items-center space-x-3">
                            <Switch checked={!!formData.exameLigamentar?.gavetaRotatoria} onCheckedChange={(c) => updateNested("exameLigamentar", "gavetaRotatoria", c)} />
                             <Label>{examLabel("Gaveta Rotatória Póstero-Lateral")}</Label>
                          </div>
                          <div className="space-y-2">
                             <Label>{examLabel("Estresse Varo 30° (0–3)")}</Label>
                            <Select value={formData.exameLigamentar?.estresseVaro30?.toString() ?? ""} onValueChange={(v) => updateNested("exameLigamentar", "estresseVaro30", parseInt(v))}>
                               <SelectTrigger><SelectValue placeholder={examLabel("Grau")} /></SelectTrigger>
                              <SelectContent>
                                 {[0, 1, 2, 3].map((g) => <SelectItem key={g} value={g.toString()}>{g === 0 ? examLabel("0 — Negativo") : `${g}`}</SelectItem>)}
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="space-y-2">
                             <Label>{examLabel("Estresse Varo 0° (0–3)")}</Label>
                            <Select value={formData.exameLigamentar?.estresseVaro0?.toString() ?? ""} onValueChange={(v) => updateNested("exameLigamentar", "estresseVaro0", parseInt(v))}>
                               <SelectTrigger><SelectValue placeholder={examLabel("Grau")} /></SelectTrigger>
                              <SelectContent>
                                 {[0, 1, 2, 3].map((g) => <SelectItem key={g} value={g.toString()}>{g === 0 ? examLabel("0 — Negativo") : `${g}`}</SelectItem>)}
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* CPM — Canto Póstero-Medial */}
                    {hasCpm && (
                      <div className="border rounded-xl p-4 bg-muted/20 space-y-4">
                         <h3 className="font-bold text-primary">{examLabel("CPM — Canto Póstero-Medial")}</h3>
                        <div className="grid sm:grid-cols-2 gap-4">
                          <div className="space-y-2">
                             <Label>{examLabel("Estresse Valgo 30° (0–3)")}</Label>
                            <Select value={formData.exameLigamentar?.estresseValgo30?.toString() ?? ""} onValueChange={(v) => updateNested("exameLigamentar", "estresseValgo30", parseInt(v))}>
                               <SelectTrigger><SelectValue placeholder={examLabel("Grau")} /></SelectTrigger>
                              <SelectContent>
                                 {[0, 1, 2, 3].map((g) => <SelectItem key={g} value={g.toString()}>{g === 0 ? examLabel("0 — Negativo") : `${g}`}</SelectItem>)}
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="space-y-2">
                             <Label>{examLabel("Estresse Valgo 0° (0–3)")}</Label>
                            <Select value={formData.exameLigamentar?.estresseValgo0?.toString() ?? ""} onValueChange={(v) => updateNested("exameLigamentar", "estresseValgo0", parseInt(v))}>
                               <SelectTrigger><SelectValue placeholder={examLabel("Grau")} /></SelectTrigger>
                              <SelectContent>
                                 {[0, 1, 2, 3].map((g) => <SelectItem key={g} value={g.toString()}>{g === 0 ? examLabel("0 — Negativo") : `${g}`}</SelectItem>)}
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                        <p className="text-xs text-muted-foreground bg-muted/40 rounded px-3 py-1.5">
                           {examLabel("3,2–9,8 mm: lesão isolada de LCM · > 9,8 mm: LCM + LOP (radiografia com estresse)")}
                        </p>
                      </div>
                    )}
                    {formData.ligamentosAcometidos?.length === 0 && (
                       <p className="text-muted-foreground text-sm">{examLabel("Nenhum ligamento selecionado. Volte ao passo anterior para selecionar.")}</p>
                    )}
                  </div>
                )}

                {/* Instabilidade Patelar */}
                {isPatelar && (
                  <div className="space-y-5">
                    <div className="flex items-center gap-2">
                      <div className="h-6 w-1.5 rounded-full bg-pink-500" />
                       <h3 className="font-bold text-base">{examLabel("Avaliação — Instabilidade Patelofemoral (IPF)")}</h3>
                    </div>

                    {/* FATORES DE RISCO ANATÔMICOS */}
                    <div className="border-2 border-pink-200 rounded-xl p-4 space-y-4 bg-pink-50/40">
                       <p className="text-xs font-bold uppercase tracking-widest text-pink-700">{examLabel("Fatores de Risco Anatômicos")}</p>
                      <div className="grid sm:grid-cols-2 gap-4">
                        <div className="space-y-2">
                           <Label className="text-sm">{examLabel("Displasia da Tróclea — Tipo Dejour")}</Label>
                          <Select value={formData.examePatelar?.dejourTipo || ""} onValueChange={(v) => updateNested("examePatelar", "dejourTipo", v)}>
                             <SelectTrigger><SelectValue placeholder={examLabel("Tipo A / B / C / D")} /></SelectTrigger>
                            <SelectContent>
                               <SelectItem value="A">{examLabel("Tipo A — sulco raso simétrico (leve)")}</SelectItem>
                               <SelectItem value="B">{examLabel("Tipo B — sulco plano (moderado)")}</SelectItem>
                               <SelectItem value="C">{examLabel("Tipo C — hipoplasia côndilo medial (grave)")}</SelectItem>
                               <SelectItem value="D">{examLabel("Tipo D — assimétrico + cliff sign (muito grave)")}</SelectItem>
                            </SelectContent>
                          </Select>
                           <p className="text-xs text-muted-foreground">{examLabel("Cirurgia indicada: Tipo B/C/D → considerar trocleoplastia")}</p>
                        </div>
                        <div className="space-y-2">
                           <Label className="text-sm">{examLabel("Índice de Altura Patelar — Caton-Deschamps (CDI)")}</Label>
                           <Input type="number" step="0.01" placeholder={examLabel("Normal: ≤1.20")} value={formData.examePatelar?.catonDeschamps || ""} onChange={(e) => updateNested("examePatelar", "catonDeschamps", parseFloat(e.target.value))} />
                           <p className="text-xs text-muted-foreground">{examLabel("Patela alta: CDI > 1.40 → distalização")}</p>
                        </div>
                        <div className="space-y-2">
                           <Label className="text-sm">{examLabel("TT-TG — Distância Tubérculo Tibial / Sulco Troclear (mm)")}</Label>
                           <Input type="number" step="0.5" placeholder={examLabel("Normal: <15mm")} value={formData.examePatelar?.ttTgMm || ""} onChange={(e) => updateNested("examePatelar", "ttTgMm", parseFloat(e.target.value))} />
                           <p className="text-xs text-muted-foreground">{examLabel("> 15mm moderado; ≥ 20mm indica tibialização (TAT)")}</p>
                        </div>
                        <div className="space-y-2">
                           <Label className="text-sm">{examLabel("Inclinação Patelar")}</Label>
                          <Select
                            value={formData.examePatelar?.inclinacaoPatelarCategoria ?? ""}
                            onValueChange={(v) => updateNested("examePatelar", "inclinacaoPatelarCategoria", v || null)}
                          >
                             <SelectTrigger><SelectValue placeholder={examLabel("Selecione")} /></SelectTrigger>
                            <SelectContent>
                               <SelectItem value="normal">{examLabel("Normal (> 11°)")}</SelectItem>
                               <SelectItem value="limitrofe">{examLabel("8 – 11° — Limítrofe")}</SelectItem>
                               <SelectItem value="bascula">{examLabel("Báscula Patelar (< 8°)")}</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2">
                           <Label className="text-sm">{examLabel("Rotação Femoral (°)")}</Label>
                           <Input type="number" placeholder={examLabel("Aumentada: >20°")} value={formData.examePatelar?.rotacaoFemoral || ""} onChange={(e) => updateNested("examePatelar", "rotacaoFemoral", parseFloat(e.target.value))} />
                        </div>
                      </div>
                      {/* Risk factor checkboxes */}
                      <div>
                         <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">{examLabel("Outros Fatores de Risco")}</p>
                        <div className="grid sm:grid-cols-2 gap-3">
                          {[
                            ["valgoQuadril", "Valgo de quadril dinâmico"],
                            ["pePronado", "Pé pronado"],
                            ["genuValgo", "Genu valgo / valgo dinâmico"],
                          ].map(([key, label]) => (
                            <div key={key} className="flex items-center space-x-3">
                              <Switch checked={!!formData.examePatelar?.[key as keyof typeof formData.examePatelar]} onCheckedChange={(c) => updateNested("examePatelar", key, c)} />
                               <Label className="text-sm">{examLabel(label)}</Label>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>

                    {/* EPISÓDIOS DE INSTABILIDADE */}
                    <div className="border rounded-xl p-4 space-y-4 bg-muted/20">
                       <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">{examLabel("Histórico de Instabilidade")}</p>
                      <div className="grid sm:grid-cols-2 gap-4">
                        <div className="space-y-2">
                           <Label className="text-sm">{examLabel("Número de Episódios de Luxação")}</Label>
                           <Input type="number" min={1} placeholder={examLabel("1, 2, 3...")} value={formData.examePatelar?.numEpisodios || ""} onChange={(e) => updateNested("examePatelar", "numEpisodios", parseInt(e.target.value))} />
                        </div>
                        <div className="space-y-2">
                           <Label className="text-sm">{examLabel("Tipo do Primeiro Episódio")}</Label>
                          <Select value={formData.examePatelar?.tipoPrimeiroEpisodio || ""} onValueChange={(v) => updateNested("examePatelar", "tipoPrimeiroEpisodio", v)}>
                             <SelectTrigger><SelectValue placeholder={examLabel("Selecione")} /></SelectTrigger>
                            <SelectContent>
                               <SelectItem value="Traumático">{examLabel("Traumático (impacto direto)")}</SelectItem>
                               <SelectItem value="Espontâneo">{examLabel("Espontâneo / movimento trivial")}</SelectItem>
                               <SelectItem value="Rotacional">{examLabel("Rotacional sem contato")}</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="flex items-center space-x-3">
                          <Switch checked={!!formData.examePatelar?.luxacaoCronica} onCheckedChange={(c) => updateNested("examePatelar", "luxacaoCronica", c)} />
                           <Label className="text-sm">{examLabel("Luxação Crônica / Habitual")}</Label>
                        </div>
                        <div className="flex items-center space-x-3">
                          <Switch checked={!!formData.examePatelar?.subluxacaoSemLuxacao} onCheckedChange={(c) => updateNested("examePatelar", "subluxacaoSemLuxacao", c)} />
                           <Label className="text-sm">{examLabel("Subluxação sem luxação completa")}</Label>
                        </div>
                      </div>
                    </div>

                    {/* EXAME FEMOROPATELAR */}
                    <div className="border rounded-xl p-4 space-y-4 bg-muted/20">
                       <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">{examLabel("Exame Femoropatelar")}</p>
                      <div className="grid sm:grid-cols-2 gap-4">
                        <div className="flex items-center space-x-3">
                          <Switch checked={!!formData.examePatelar?.apprehensionTest} onCheckedChange={(c) => updateNested("examePatelar", "apprehensionTest", c)} />
                           <Label className="text-sm">{examLabel("Sinal de Apreensão Positivo")}</Label>
                        </div>
                        <div className="flex items-center space-x-3">
                          <Switch
                            checked={!!formData.examePatelar?.jSign}
                            onCheckedChange={(checked) => setFormData((prev) => ({
                              ...prev,
                              examePatelar: {
                                ...((prev.examePatelar as any) || {}),
                                jSign: checked,
                                ...(checked ? {} : { jSignGrau: null }),
                              },
                            }))}
                          />
                           <Label className="text-sm">{examLabel("J Sign Positivo (trajetória em J)")}</Label>
                        </div>
                        {!!formData.examePatelar?.jSign && (
                          <div className="space-y-2">
                            <Label className="text-sm" htmlFor="j-sign-grau">{examLabel("Grau do J Sign")}</Label>
                            <Select
                              value={formData.examePatelar?.jSignGrau != null ? String(formData.examePatelar.jSignGrau) : "none"}
                              onValueChange={(value) => updateNested(
                                "examePatelar",
                                "jSignGrau",
                                value === "none" ? null : Number(value),
                              )}
                            >
                              <SelectTrigger id="j-sign-grau" aria-label={examLabel("Grau do J Sign")}>
                                <SelectValue placeholder={examLabel("Não informado")} />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="none">{examLabel("Não informado")}</SelectItem>
                                {[1, 2, 3, 4].map((grade) => (
                                  <SelectItem key={grade} value={String(grade)}>{grade}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        )}
                        <div className="flex items-center space-x-3">
                          <Switch checked={!!formData.examePatelar?.maltrackingDinamico} onCheckedChange={(c) => updateNested("examePatelar", "maltrackingDinamico", c)} />
                           <Label className="text-sm">{examLabel("Maltracking Dinâmico")}</Label>
                        </div>
                        <div className="flex items-center space-x-3">
                          <Switch checked={!!formData.examePatelar?.retinaculoTenso} onCheckedChange={(c) => updateNested("examePatelar", "retinaculoTenso", c)} />
                           <Label className="text-sm">{examLabel("Retináculo Lateral Tenso")}</Label>
                        </div>
                        <div className="flex items-center space-x-3">
                          <Switch checked={!!formData.examePatelar?.clarkSign} onCheckedChange={(c) => updateNested("examePatelar", "clarkSign", c)} />
                           <Label className="text-sm">{examLabel("Sinal de Clarke Positivo (crepitação)")}</Label>
                        </div>
                        <div className="space-y-2">
                           <Label className="text-sm">{examLabel("Tilt Patelar")}</Label>
                          <Select value={formData.examePatelar?.tiltPatelar || ""} onValueChange={(v) => updateNested("examePatelar", "tiltPatelar", v)}>
                             <SelectTrigger><SelectValue placeholder={examLabel("Selecione")} /></SelectTrigger>
                            <SelectContent>
                               <SelectItem value="Normal">{examLabel("Normal")}</SelectItem>
                               <SelectItem value="Positivo">{examLabel("Positivo (inclinação lateral)")}</SelectItem>
                               <SelectItem value="Negativo">{examLabel("Negativo")}</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2">
                           <Label className="text-sm">{examLabel("Glide Test Patelar")}</Label>
                          <Select value={formData.examePatelar?.glideTest || ""} onValueChange={(v) => updateNested("examePatelar", "glideTest", v)}>
                             <SelectTrigger><SelectValue placeholder={examLabel("Selecione")} /></SelectTrigger>
                            <SelectContent>
                               <SelectItem value="Normal">{examLabel("Normal (1-2 quadrantes)")}</SelectItem>
                               <SelectItem value="Hipermobilidade">{examLabel("Hipermobilidade lateral (> 3 quadrantes)")}</SelectItem>
                               <SelectItem value="Restrição medial">{examLabel("Restrição medial")}</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="flex items-center space-x-3">
                          <Switch checked={!!formData.examePatelar?.lesaoCondral} onCheckedChange={(c) => updateNested("examePatelar", "lesaoCondral", c)} />
                           <Label className="text-sm">{examLabel("Lesão Condral Associada")}</Label>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Exame Físico Meniscal */}
                {isMeniscal && (
                  <div className="border rounded-xl p-4 space-y-4 bg-muted/20">
                     <h3 className="font-semibold">{examLabel("Exame Físico — Lesão Meniscal")}</h3>

                    {/* Dor à palpação */}
                    <div className="space-y-2">
                       <Label className="text-sm font-medium text-muted-foreground">{examLabel("Dor à Palpação da Interlinha")}</Label>
                      <div className="flex flex-wrap gap-2">
                        {["Medial", "Lateral", "Ambas", "Ausente"].map((opt) => {
                          const sel = formData.procedimentoMeniscal?.dorInterlinha === opt;
                          return (
                            <button key={opt} type="button"
                              onClick={() => updateNested("procedimentoMeniscal", "dorInterlinha", sel ? "" : opt)}
                              className={cn("text-sm px-3 py-1.5 rounded-lg border-2 transition-all",
                                sel ? "border-primary bg-primary/5 font-medium text-primary" : "border-border hover:border-primary/40")}>
                               {examLabel(opt)}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Testes meniscais — switches */}
                    <div className="space-y-2">
                       <Label className="text-sm font-medium text-muted-foreground">{examLabel("Testes Meniscais")}</Label>
                      <div className="grid sm:grid-cols-2 gap-3">
                        {[
                          { key: "mcMurrayMedial",  label: "McMurray — Medial" },
                          { key: "mcMurrayLateral", label: "McMurray — Lateral" },
                          { key: "apleyCompressao", label: "Apley Compressão (↓)" },
                          { key: "apleyTracao",     label: "Apley Tração (↑)" },
                          { key: "marchaPato",      label: "Marcha do Pato" },
                          { key: "steinmann1",      label: "Steinmann I" },
                          { key: "steinmann2",      label: "Steinmann II" },
                        ].map(({ key, label }) => (
                          <div key={key} className="flex items-center space-x-2">
                            <Switch
                              checked={!!formData.procedimentoMeniscal?.[key as keyof typeof formData.procedimentoMeniscal]}
                              onCheckedChange={(c) => updateNested("procedimentoMeniscal", key, c)}
                            />
                             <Label className="text-sm">{examLabel(label)}</Label>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Teste de Childress (marcha do pato com grau de flexão) */}
                    <div className="space-y-2">
                       <Label className="text-xs text-muted-foreground">{examLabel("Observações do Exame Meniscal")}</Label>
                      <Input
                         placeholder={examLabel("Ex: McMurray positivo com dor medial em extensão, Thessaly positivo a 20°...")}
                        value={(formData.procedimentoMeniscal?.observacoesExame as string) || ""}
                        onChange={(e) => updateNested("procedimentoMeniscal", "observacoesExame", e.target.value)}
                      />
                    </div>
                  </div>
                )}

                {/* ── LESÕES OSTEOCONDRAIS — Exame Físico ── */}
                {isOsteocondral && (
                  <div className="space-y-5">
                    <div className="flex items-center gap-2">
                      <div className="h-6 w-1.5 rounded-full bg-teal-500" />
                       <h3 className="font-bold text-base">{examLabel("Avaliação — Lesões Osteocondrais do Joelho")}</h3>
                    </div>

                    {/* Gate clínico */}
                    <div className="border-2 border-sky-200 rounded-xl p-4 space-y-3 bg-sky-50/40">
                       <p className="text-xs font-bold uppercase tracking-widest text-sky-700">{examLabel("Decisão de Candidatura ao Tratamento")}</p>
                      <div className="grid sm:grid-cols-2 gap-4">
                        <div className="space-y-2">
                           <Label className="text-sm">{examLabel("Lesão sintomática e clinicamente relevante?")}</Label>
                          <Select
                            value={formData.exameOsteocondral?.sintomatica === true ? "sim" : formData.exameOsteocondral?.sintomatica === false ? "nao" : ""}
                            onValueChange={(v) => updateNested("exameOsteocondral", "sintomatica", v === "sim")}
                          >
                             <SelectTrigger><SelectValue placeholder={examLabel("Selecione")} /></SelectTrigger>
                            <SelectContent>
                               <SelectItem value="sim">{examLabel("Sim — sintomática")}</SelectItem>
                               <SelectItem value="nao">{examLabel("Não — achado incidental")}</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2">
                           <Label className="text-sm">{examLabel("Falha do tratamento conservador otimizado?")}</Label>
                          <Select
                            value={formData.exameOsteocondral?.falhaConservador === true ? "sim" : formData.exameOsteocondral?.falhaConservador === false ? "nao" : ""}
                            onValueChange={(v) => updateNested("exameOsteocondral", "falhaConservador", v === "sim")}
                          >
                             <SelectTrigger><SelectValue placeholder={examLabel("Selecione")} /></SelectTrigger>
                            <SelectContent>
                               <SelectItem value="sim">{examLabel("Sim — falha documentada")}</SelectItem>
                               <SelectItem value="nao">{examLabel("Não — conservador ainda em curso")}</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2">
                           <Label className="text-sm">{examLabel("Artrose difusa / avançada?")}</Label>
                          <Select
                            value={formData.exameOsteocondral?.artroseDifusa === true ? "sim" : formData.exameOsteocondral?.artroseDifusa === false ? "nao" : ""}
                            onValueChange={(v) => updateNested("exameOsteocondral", "artroseDifusa", v === "sim")}
                          >
                             <SelectTrigger><SelectValue placeholder={examLabel("Selecione")} /></SelectTrigger>
                            <SelectContent>
                               <SelectItem value="nao">{examLabel("Não — defeito focal")}</SelectItem>
                               <SelectItem value="sim">{examLabel("Sim — doença articular difusa")}</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2">
                           <Label className="text-sm">{examLabel("Objetivo principal do paciente")}</Label>
                          <Select
                            value={formData.exameOsteocondral?.objetivo || ""}
                            onValueChange={(v) => updateNested("exameOsteocondral", "objetivo", v)}
                          >
                             <SelectTrigger><SelectValue placeholder={examLabel("Selecione")} /></SelectTrigger>
                            <SelectContent>
                               <SelectItem value="long_term">{examLabel("Resultado a longo prazo / preservação articular")}</SelectItem>
                               <SelectItem value="quick_return">{examLabel("Priorizar retorno mais rápido")}</SelectItem>
                               <SelectItem value="balanced">{examLabel("Equilíbrio entre retorno e durabilidade")}</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    </div>

                    {/* Classificação Etiológica */}
                    <div className="border-2 border-teal-200 rounded-xl p-4 space-y-4 bg-teal-50/40">
                       <p className="text-xs font-bold uppercase tracking-widest text-teal-700">{examLabel("Classificação Etiológica e Graduação")}</p>
                      <div className="grid sm:grid-cols-2 gap-4">
                        <div className="space-y-2">
                           <Label className="text-sm">{examLabel("Grau ICRS (International Cartilage Repair Society)")}</Label>
                          <Select value={formData.exameOsteocondral?.icrsGrau || ""} onValueChange={(v) => updateNested("exameOsteocondral", "icrsGrau", v)}>
                             <SelectTrigger><SelectValue placeholder={examLabel("Grau I — IV")} /></SelectTrigger>
                            <SelectContent>
                               <SelectItem value="I">{examLabel("Grau I — Amolecimento / fibrilação superficial")}</SelectItem>
                               <SelectItem value="II">{examLabel("Grau II — Lesão parcial < 50% espessura")}</SelectItem>
                               <SelectItem value="III">{examLabel("Grau III — Lesão > 50% espessura, sem osso exposto")}</SelectItem>
                               <SelectItem value="IV">{examLabel("Grau IV — Osso subcondral exposto")}</SelectItem>
                            </SelectContent>
                          </Select>
                           <p className="text-xs text-muted-foreground">{examLabel("Grau III/IV → indicação cirúrgica de restauração")}</p>
                        </div>
                        <div className="space-y-2">
                           <Label className="text-sm">{examLabel("Localização da Lesão")}</Label>
                          <Select value={formData.exameOsteocondral?.localizacao || ""} onValueChange={(v) => updateNested("exameOsteocondral", "localizacao", v)}>
                             <SelectTrigger><SelectValue placeholder={examLabel("Selecione")} /></SelectTrigger>
                            <SelectContent>
                               <SelectItem value="CFM">{examLabel("Côndilo Femoral Medial (CFM) — mais comum")}</SelectItem>
                               <SelectItem value="CFL">{examLabel("Côndilo Femoral Lateral (CFL)")}</SelectItem>
                               <SelectItem value="Tróclea">{examLabel("Tróclea Femoral")}</SelectItem>
                               <SelectItem value="Patela">{examLabel("Patela")}</SelectItem>
                               <SelectItem value="PTM">{examLabel("Platô Tibial Medial (PTM)")}</SelectItem>
                               <SelectItem value="PTL">{examLabel("Platô Tibial Lateral (PTL)")}</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2">
                           <Label className="text-sm">{examLabel("Tamanho da Lesão (cm²)")}</Label>
                           <Input type="number" step="0.1" placeholder={examLabel("ex: 2.5 cm²")} value={formData.exameOsteocondral?.tamanhoMm2 || ""} onChange={(e) => updateNested("exameOsteocondral", "tamanhoMm2", e.target.value)} />
                           <p className="text-xs text-muted-foreground">{examLabel("< 2 cm²: microfraturas; 2–4 cm²: OATS; > 4 cm²: aloenxerto / AMIC")}</p>
                        </div>
                        <div className="space-y-2">
                           <Label className="text-sm">{examLabel("Etiologia")}</Label>
                          <Select value={formData.exameOsteocondral?.etiologia || ""} onValueChange={(v) => updateNested("exameOsteocondral", "etiologia", v)}>
                             <SelectTrigger><SelectValue placeholder={examLabel("Selecione")} /></SelectTrigger>
                            <SelectContent>
                               <SelectItem value="traumatica">{examLabel("Traumática")}</SelectItem>
                               <SelectItem value="pos_traumatica">{examLabel("Pós-traumática")}</SelectItem>
                               <SelectItem value="degenerativa">{examLabel("Atraumática / degenerativa")}</SelectItem>
                               <SelectItem value="OCD">{examLabel("Osteocondrite Dissecante (OCD)")}</SelectItem>
                               <SelectItem value="iatrogenica">{examLabel("Iatrogênica / pós-procedimento")}</SelectItem>
                               <SelectItem value="indeterminada">{examLabel("Indeterminada")}</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2">
                           <Label className="text-sm">{examLabel("Padrão da Lesão")}</Label>
                          <Select value={formData.exameOsteocondral?.padrao || ""} onValueChange={(v) => updateNested("exameOsteocondral", "padrao", v)}>
                             <SelectTrigger><SelectValue placeholder={examLabel("Selecione")} /></SelectTrigger>
                            <SelectContent>
                               <SelectItem value="chondral">{examLabel("Condral — cartilagem apenas")}</SelectItem>
                               <SelectItem value="osteochondral">{examLabel("Osteocondral — envolve osso subcondral")}</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2">
                           <Label className="text-sm">{examLabel("Estado do Osso Subcondral")}</Label>
                          <Select value={formData.exameOsteocondral?.osseoStatus || ""} onValueChange={(v) => updateNested("exameOsteocondral", "osseoStatus", v)}>
                             <SelectTrigger><SelectValue placeholder={examLabel("Selecione")} /></SelectTrigger>
                            <SelectContent>
                               <SelectItem value="preserved">{examLabel("Preservado / íntegro")}</SelectItem>
                               <SelectItem value="compromised">{examLabel("Comprometido")}</SelectItem>
                               <SelectItem value="significant_loss">{examLabel("Perda óssea significativa")}</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2">
                           <Label className="text-sm">{examLabel("Profundidade da Lesão")}</Label>
                          <Select value={formData.exameOsteocondral?.profundidade || ""} onValueChange={(v) => updateNested("exameOsteocondral", "profundidade", v)}>
                             <SelectTrigger><SelectValue placeholder={examLabel("Selecione")} /></SelectTrigger>
                            <SelectContent>
                               <SelectItem value="superficial">{examLabel("Superficial")}</SelectItem>
                               <SelectItem value="parcial">{examLabel("Parcial")}</SelectItem>
                               <SelectItem value="profunda">{examLabel("Profunda")}</SelectItem>
                               <SelectItem value="full_thickness">{examLabel("Full-thickness / espessura total")}</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    </div>

                    {/* Achados de Imagem */}
                    <div className="border-2 border-emerald-200 rounded-xl p-4 space-y-4 bg-emerald-50/30">
                       <p className="text-xs font-bold uppercase tracking-widest text-emerald-700">{examLabel("Achados de Imagem e Estabilidade")}</p>
                      <div className="grid sm:grid-cols-2 gap-4">
                        <div className="space-y-2">
                           <Label className="text-sm">{examLabel("Continência da Lesão")}</Label>
                          <Select value={formData.exameOsteocondral?.continencia || ""} onValueChange={(v) => updateNested("exameOsteocondral", "continencia", v)}>
                             <SelectTrigger><SelectValue placeholder={examLabel("Selecione")} /></SelectTrigger>
                            <SelectContent>
                               <SelectItem value="Contida">{examLabel("Contida (margens íntegras)")}</SelectItem>
                               <SelectItem value="Não contida">{examLabel("Não contida (déficit de borda)")}</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2">
                           <Label className="text-sm">{examLabel("Estabilidade OCD (se aplicável)")}</Label>
                          <Select value={formData.exameOsteocondral?.estabilidadeOcd || ""} onValueChange={(v) => updateNested("exameOsteocondral", "estabilidadeOcd", v)}>
                             <SelectTrigger><SelectValue placeholder={examLabel("Selecione")} /></SelectTrigger>
                            <SelectContent>
                               <SelectItem value="Estável">{examLabel("Estável — sem sinal de líquido sob fragmento")}</SelectItem>
                               <SelectItem value="Instável">{examLabel("Instável — sinal de líquido / fragmento solto")}</SelectItem>
                               <SelectItem value="Não aplicável">{examLabel("Não aplicável (não é OCD)")}</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                      <div className="grid sm:grid-cols-2 gap-3 mt-2">
                        {([
                          ["edemaOsseo", "Edema ósseo / lesão osteocondral (RM)"],
                          ["cistoSubcondral", "Cisto subcondral"],
                          ["fragmentoSolto", "Fragmento osteocondral solto (corpo livre)"],
                          ["lesaoMeniscalAssociada", "Deficiência / lesão meniscal"],
                          ["lesaoLigamentarAssociada", "Instabilidade ligamentar associada"],
                          ["desvioAxial", "Desvio axial (valgo / varo)"],
                          ["instabilidadePatelar", "Instabilidade patelar"],
                          ["sobrecargaPatelofemoral", "Sobrecarga patelofemoral"],
                          ["ttTgAlterado", "TT-TG alterado / fator de tracking"],
                          ["displasiaToglentar", "Displasia troclear"],
                          ["rmDisponivel", "RM disponível / confirmatória"],
                          ["procedimentoPrevioFalhou", "Falha de procedimento condral prévio"],
                          ["bipolareMultipla", "Lesões bipolares ou múltiplas"],
                          ["patelofemoralSemAvaliacao", "Lesão PF sem avaliação biomecânica adequada"],
                        ] as [string, string][]).map(([key, label]) => (
                          <div key={key} className="flex items-center space-x-3">
                            <Switch checked={!!formData.exameOsteocondral?.[key as keyof typeof formData.exameOsteocondral]} onCheckedChange={(c) => updateNested("exameOsteocondral", key, c)} />
                             <Label className="text-sm">{examLabel(label)}</Label>
                          </div>
                        ))}
                      </div>

                      {/* Ligament sub-selector */}
                      {formData.exameOsteocondral?.lesaoLigamentarAssociada && (
                        <div className="border border-amber-200 rounded-xl p-3 bg-amber-50/40 space-y-2">
                           <p className="text-xs font-semibold text-amber-800 uppercase tracking-wide">{examLabel("Qual ligamento instável?")}</p>
                          <div className="flex flex-wrap gap-2">
                            {(["LCA", "LCP", "LCM", "CPL"] as const).map((lig) => {
                              const selected = (formData.exameOsteocondral?.ligamentosOCD as string[] | undefined)?.includes(lig);
                              return (
                                <button
                                  key={lig}
                                  type="button"
                                  onClick={() => {
                                    const cur: string[] = (formData.exameOsteocondral?.ligamentosOCD as string[] | undefined) ?? [];
                                    const next = selected ? cur.filter((x) => x !== lig) : [...cur, lig];
                                    updateNested("exameOsteocondral", "ligamentosOCD", next);
                                  }}
                                  className={cn(
                                    "px-3 py-1.5 rounded-lg border-2 text-sm font-semibold transition-all",
                                    selected
                                      ? "border-amber-500 bg-amber-100 text-amber-900"
                                      : "border-border hover:border-amber-300 text-muted-foreground"
                                  )}
                                >
                                  {selected && <span className="mr-1">✓</span>}{lig}
                                </button>
                              );
                            })}
                          </div>
                           <p className="text-xs text-amber-700">{examLabel("O algoritmo incluirá o(s) ligamento(s) no gate biomecânico e nos dados pendentes.")}</p>
                        </div>
                      )}
                    </div>

                    {/* Dor / Clínica */}
                    <div className="border rounded-xl p-4 space-y-3 bg-muted/20">
                       <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">{examLabel("Avaliação Clínica e Sintomas")}</p>
                      <div className="grid sm:grid-cols-2 gap-4">
                        <div className="space-y-2">
                           <Label className="text-sm">{examLabel("Localização da Dor")}</Label>
                          <Select value={formData.exameOsteocondral?.localizacaoDor || ""} onValueChange={(v) => updateNested("exameOsteocondral", "localizacaoDor", v)}>
                             <SelectTrigger><SelectValue placeholder={examLabel("Selecione")} /></SelectTrigger>
                            <SelectContent>
                               <SelectItem value="Medial">{examLabel("Medial")}</SelectItem>
                               <SelectItem value="Lateral">{examLabel("Lateral")}</SelectItem>
                               <SelectItem value="Anterior / patelofemoral">{examLabel("Anterior / patelofemoral")}</SelectItem>
                               <SelectItem value="Difusa">{examLabel("Difusa")}</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2">
                           <Label className="text-sm">{examLabel("Teste de Wilson (OCD)")}</Label>
                          <Select value={formData.exameOsteocondral?.testeWilson || ""} onValueChange={(v) => updateNested("exameOsteocondral", "testeWilson", v)}>
                             <SelectTrigger><SelectValue placeholder={examLabel("Selecione")} /></SelectTrigger>
                            <SelectContent>
                               <SelectItem value="Positivo">{examLabel("Positivo")}</SelectItem>
                               <SelectItem value="Negativo">{examLabel("Negativo")}</SelectItem>
                               <SelectItem value="Não realizado">{examLabel("Não realizado")}</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                      <div className="grid sm:grid-cols-2 gap-3 mt-1">
                        {([
                          ["bloqueioMecanico", "Bloqueio mecânico"],
                          ["derrameSinvial", "Derrame sinovial"],
                          ["crepitacaoPalpavel", "Crepitação palpável"],
                          ["hipersensibilidadeLinha", "Hipersensibilidade na linha articular"],
                        ] as [string, string][]).map(([key, label]) => (
                          <div key={key} className="flex items-center space-x-3">
                            <Switch checked={!!formData.exameOsteocondral?.[key as keyof typeof formData.exameOsteocondral]} onCheckedChange={(c) => updateNested("exameOsteocondral", key, c)} />
                             <Label className="text-sm">{examLabel(label)}</Label>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                    {/* Outros tipos */}
                    {!isLigamentar && !isMeniscal && !isPatelar && !isOsteocondral && (
                      <div className="space-y-2">
                         <Label>{examLabel("Descrição / Detalhes do Caso")}</Label>
                        <Textarea
                           placeholder={`${examLabel("Descreva os detalhes específicos")}${tiposSelected.length > 0 ? `${examLabel(" desta ")}${tiposSelected.map(displayOption).join(" + ")}` : ""}...`}
                          rows={5}
                          value={formData.observacoes}
                          onChange={(e) => updateData("observacoes", e.target.value)}
                        />
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* STEP 3: Alinhamento */}
            {step === 3 && (
              <div className="space-y-6">
                <h2 className="text-xl font-semibold">{examLabel("Alinhamento do Membro")}</h2>
                <div className="grid sm:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <Label>{examLabel("Lado Acometido")}</Label>
                    <Select value={clinicalData.lado} onValueChange={(v) => setClinicalData((p) => ({ ...p, lado: v }))}>
                      <SelectTrigger><SelectValue placeholder={examLabel("Selecione...")} /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Direito">{examLabel("Direito")}</SelectItem>
                        <SelectItem value="Esquerdo">{examLabel("Esquerdo")}</SelectItem>
                        <SelectItem value="Bilateral">{examLabel("Bilateral")}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>{examLabel("Alinhamento Frontal")}</Label>
                    <Select value={formData.alinhamento} onValueChange={(v) => updateData("alinhamento", v)}>
                      <SelectTrigger><SelectValue placeholder={examLabel("Selecione...")} /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Neutro">{examLabel("Neutro")}</SelectItem>
                        <SelectItem value="Varo">{examLabel("Varo")}</SelectItem>
                        <SelectItem value="Valgo">{examLabel("Valgo")}</SelectItem>
                        <SelectItem value="Recurvatum">{examLabel("Recurvatum")}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>{examLabel("Grau / Medida (ex: 5°, 10 mm)")}</Label>
                    <Input
                      placeholder={examLabel("Grau ou medida do desvio")}
                      value={formData.grauAlinhamento}
                      onChange={(e) => updateData("grauAlinhamento", e.target.value)}
                    />
                  </div>

                  {/* PTS — auto-preenchido pelo RX Perfil abaixo */}
                  <div className="space-y-2 sm:col-span-2">
                    <Label className="font-semibold">{examLabel("Slope Tibial Posterior (PTS, graus)")}</Label>
                    {formData.exameLigamentar?.slopeTibialPts != null ? (() => {
                      const ptsValue = formData.exameLigamentar.slopeTibialPts;
                      const classification = classifyPTS(ptsValue);
                      const classificationLabel = classification === "pathological"
                        ? examLabel("Patológico")
                        : classification === "borderline"
                          ? examLabel("Limítrofe")
                          : classification === "normal"
                            ? examLabel("Normal")
                            : examLabel("Não classificado");
                      return (
                        <div className="flex items-center gap-3 flex-wrap">
                          <div className={cn(
                            "flex items-center gap-2 rounded-lg px-3 py-2 border font-semibold text-sm",
                            classification === "pathological"
                              ? "bg-red-50 border-red-300 text-red-800"
                              : classification === "borderline"
                                ? "bg-amber-50 border-amber-300 text-amber-800"
                                : classification === "normal"
                                  ? "bg-green-50 border-green-300 text-green-800"
                                  : "bg-muted border-border text-muted-foreground"
                          )}>
                            <span className="text-2xl font-bold">{ptsValue}°</span>
                            <span className="text-xs font-medium">{classificationLabel}</span>
                          </div>
                          {classification !== null && ptsValue > 12 && (
                            <p className="text-xs font-medium text-red-700">
                              {examLabel("PTS > 12° — fator de risco para falha do LCA; considerar reforço extra-articular ou osteotomia de redução de slope.")}
                            </p>
                          )}
                          <button type="button" className="text-xs text-muted-foreground underline"
                            onClick={() => updateNested("exameLigamentar", "slopeTibialPts", undefined)}>
                            {examLabel("Limpar")}
                          </button>
                        </div>
                      );
                    })() : (
                      <div className="flex items-center gap-2">
                        <Input
                          type="number" step="0.1" min="0" max="30" placeholder={examLabel("ex: 11")}
                          className="w-36"
                          value=""
                          onChange={(e) => updateNested("exameLigamentar", "slopeTibialPts", e.target.value === "" ? undefined : parseFloat(e.target.value))}
                        />
                        <p className="text-xs text-muted-foreground">{examLabel("ou meça pelo RX Perfil — PTS abaixo ↓")}</p>
                      </div>
                    )}
                  </div>
                </div>

                {/* RX tab switcher — RX Panorâmico só aparece quando há desvio (Varo ou Valgo) */}
                {(() => {
                  const hasMisalignment = formData.alinhamento === "Varo" || formData.alinhamento === "Valgo";
                  const effectiveTab = hasMisalignment ? rxTab : "pts";
                  return (
                    <div className="flex gap-1 p-1 bg-slate-100 rounded-xl w-full sm:w-auto sm:inline-flex">
                      {hasMisalignment && (
                        <button
                          type="button"
                          onClick={() => setRxTab("panoramic")}
                          className={cn(
                            "flex-1 sm:flex-none text-xs sm:text-sm font-medium px-3 py-2 rounded-lg transition-colors",
                            effectiveTab === "panoramic" ? "bg-white text-primary shadow-sm" : "text-muted-foreground hover:text-foreground"
                          )}
                        >
                          📐 {examLabel("RX Panorâmico")}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => setRxTab("pts")}
                        className={cn(
                          "flex-1 sm:flex-none text-xs sm:text-sm font-medium px-3 py-2 rounded-lg transition-colors",
                          effectiveTab === "pts" ? "bg-white text-teal-700 shadow-sm" : "text-muted-foreground hover:text-foreground"
                        )}
                      >
                        📏 {examLabel("RX Perfil — PTS")}
                      </button>
                    </div>
                  );
                })()}

                {rxTab === "panoramic" && (formData.alinhamento === "Varo" || formData.alinhamento === "Valgo") && (
                  <div className="-mx-6 -mb-6">
                    <XRayAnalyzer
                      analysisContext="surgery"
                      savedAnalysis={formData.rxAnaliseJson ? JSON.parse(formData.rxAnaliseJson) : null}
                      savedImageUrl={formData.rxImageUrl || null}
                      patientName={selectedPatient?.nome}
                      defaultStep="upload"
                      defaultLado={clinicalData.lado === "Esquerdo" ? "esquerdo" : "direito"}
                      savedSelectedOsteotomiaIdx={
                        formData.rxAnaliseJson
                          ? (() => { try { return JSON.parse(formData.rxAnaliseJson)._selectedOsteotomiaIdx ?? null; } catch { return null; } })()
                          : null
                      }
                      onAnalysisComplete={(analysis) => {
                        const target = clinicalData.lado === "Bilateral" ? activeLimb : null;
                        updateFormForLimb(target, (current) => {
                          const deviation = analysis.eixoMecanico?.desvio;
                          const degrees = analysis.eixoMecanico?.graus;
                          return {
                            ...current,
                            rxAnaliseJson: JSON.stringify(analysis),
                            ...(deviation && deviation !== "Neutro" ? {
                              alinhamento: deviation === "Varo" ? "Varo" : "Valgo",
                              grauAlinhamento: `${Math.abs(degrees ?? 0)}°`,
                            } : {}),
                          };
                        });
                      }}
                      onImageSaved={(imageUrl) => {
                        const target = clinicalData.lado === "Bilateral" ? activeLimb : null;
                        updateFormForLimb(target, (current) => ({ ...current, rxImageUrl: imageUrl }));
                      }}
                      onOsteotomiaChoose={(option, index) => handleOsteotomiaChoose(
                        option,
                        index,
                        clinicalData.lado === "Bilateral" ? activeLimb : null,
                      )}
                    />
                  </div>
                )}

                {rxTab === "pts" && (
                  <div className="-mx-6 -mb-6 px-6 pb-6">
                    <PTSAnalyzer
                      onResult={(result) => {
                        const target = clinicalData.lado === "Bilateral" ? activeLimb : null;
                        updateFormForLimb(target, (current) => ({
                          ...current,
                          slopeTibialJson: JSON.stringify(result),
                          exameLigamentar: {
                            ...(current.exameLigamentar ?? {}),
                            slopeTibialPts: result.pts,
                          },
                        }));
                      }}
                    />
                  </div>
                )}

              </div>
            )}

            {/* STEP 4: Algoritmos */}
            {step === 4 && (
              <div className="space-y-6">
                <h2 className="text-xl font-semibold">{examLabel("Algoritmos")}</h2>

                {isOsteocondral && (
                  <div className="border-2 border-teal-200 rounded-xl p-4 space-y-3 bg-teal-50/40">
                    <div>
                      <p className="text-xs font-bold uppercase tracking-widest text-teal-700">{examLabel("Disponibilidade de banco de tecidos")}</p>
                      <p className="mt-1 text-sm font-medium">{examLabel("Há disponibilidade confirmada de banco de tecidos para aloenxerto osteocondral fresco?")}</p>
                      <p className="mt-1 text-xs text-muted-foreground">{examLabel("A confirmação é necessária antes de o aloenxerto fresco ser sugerido ou selecionado no planejamento.")}</p>
                    </div>
                    <Select
                      value={formData.exameOsteocondral?.bancoTecidosDisponivel === true ? "sim" : formData.exameOsteocondral?.bancoTecidosDisponivel === false ? "nao" : "nao_informado"}
                      onValueChange={(value) => {
                        const confirmed = value === "sim";
                        updateNested("exameOsteocondral", "bancoTecidosDisponivel", confirmed ? true : value === "nao" ? false : undefined);
                        if (!confirmed && osteocondralTecnica.procedimentos.includes("Aloenxerto osteocondral fresco")) {
                          setOsteocondralTecnica((current) => ({
                            ...current,
                            procedimentos: current.procedimentos.filter((procedure) => procedure !== "Aloenxerto osteocondral fresco"),
                          }));
                          toast({
                            title: examLabel("Aloenxerto fresco removido do planejamento"),
                            description: examLabel("Confirme a disponibilidade do banco de tecidos para selecioná-lo novamente."),
                          });
                        }
                      }}
                    >
                      <SelectTrigger className="max-w-md"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="sim">{examLabel("Sim — disponibilidade confirmada")}</SelectItem>
                        <SelectItem value="nao">{examLabel("Não — indisponível neste caso")}</SelectItem>
                        <SelectItem value="nao_informado">{examLabel("Não informado")}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}

                {!hasLca && !isPatelar && !isOsteocondral && (
                  <p className="text-muted-foreground text-sm">{examLabel("Nenhum algoritmo específico aplicável para este caso. Avance para finalizar.")}</p>
                )}

                {hasLca && (
                  <div className="space-y-4">
                    <div className="border-2 border-slate-200 rounded-xl p-4 bg-slate-50/40">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <h3 className="font-semibold text-sm sm:text-base">{examLabel("KRIRS — Técnica de Reconstrução do LCA")}</h3>
                          <p className="text-xs text-muted-foreground">{examLabel("Knee Reconstruction Instability Risk Score")}</p>
                        </div>
                        <Button type="button" onClick={handleCalculateKrirs} variant="secondary" size="sm" disabled={krirsMutation.isPending} className="w-full sm:w-auto shrink-0">
                          <Activity className="mr-2 h-4 w-4" />
                          {examLabel(krirsMutation.isPending ? "Calculando..." : "Calcular KRIRS")}
                        </Button>
                      </div>
                    </div>

                    {(formData.lcaAlgorithm?.krirsInterpretacao !== undefined || formData.lcaAlgorithm?.krirsScore !== undefined) && (() => {
                      const riskLevel = getKrirsRiskLevel(
                        formData.lcaAlgorithm.krirsScore,
                        formData.lcaAlgorithm.flagAltoRisco,
                        formData.lcaAlgorithm.krirsInterpretacao,
                      );
                      const riskStyle = riskLevel === "alto"
                        ? "border-red-300 bg-red-50 text-red-700"
                        : riskLevel === "intermediario"
                          ? "border-amber-300 bg-amber-50 text-amber-800"
                          : "border-emerald-300 bg-emerald-50 text-emerald-700";
                      return (
                      <div className="space-y-3">
                        <div className="grid sm:grid-cols-2 gap-3">
                          <div className={cn("rounded-xl p-4 border-2", riskStyle)}>
                            <p className="text-xs font-medium opacity-75">{examLabel("Classificação KRIRS")}</p>
                            <p className="text-xl font-bold mt-1">
                              {getKrirsRiskLabel(riskLevel, locale)}
                            </p>
                          </div>
                          <div className="rounded-xl p-4 border bg-card">
                            <p className="text-xs font-medium text-muted-foreground">{examLabel("Técnica Recomendada")}</p>
                            <p className="text-xl font-bold mt-1">{formData.lcaAlgorithm.tecnicaRecomendada}</p>
                          </div>
                        </div>
                        <div className="rounded-lg bg-muted p-3 text-sm">
                          <span className="font-medium">{examLabel("Justificativa:")} </span>
                          {getKrirsDisplayJustification(formData.lcaAlgorithm.justificativa, riskLevel, locale)}
                        </div>
                      </div>
                      );
                    })()}

                    {/* ── ADER Test Positivo — alerta LOA ── */}
                    {formData.exameLigamentar?.aderTest && (
                      <div className="flex items-start gap-3 rounded-xl border-2 border-orange-300 bg-orange-50 p-4">
                        <AlertTriangle className="h-5 w-5 text-orange-600 mt-0.5 shrink-0" />
                        <div>
                          <p className="font-semibold text-orange-900">{examLabel("ADER Test Positivo — Instabilidade Rotatória Anteromedial")}</p>
                          <p className="text-sm text-orange-800 mt-1">
                            {examLabel("O ADER Test positivo identifica instabilidade rotatória anteromedial do joelho.")}{" "}
                            {examLabel("Considerar Reconstrução do Ligamento Oblíquo Anterior (LOA) como procedimento complementar para controle da instabilidade anteromedial.")}
                          </p>
                        </div>
                      </div>
                    )}

                    <AclDecisionModule
                      idade={getPatientAge()}
                      sexo={selectedPatient?.sexo}
                      enxerto={formData.enxerto}
                      hiperextensao={formData.exameLigamentar?.hiperextensao}
                      slopeTibialPts={formData.exameLigamentar?.slopeTibialPts}
                      pivotShift={formData.exameLigamentar?.pivotShift}
                      lachman={formData.exameLigamentar?.lachman}
                      revisao={clinicalData.revisao}
                      lesaoCronica={clinicalData.lesaoCronica}
                      esportePivot={clinicalData.esportePivot}
                      meniscalConcomitante={isMeniscal}
                      esqueletoImaturo={!!formData.exameLigamentar?.esqueletoImaturo}
                      contralateralLca={!!formData.exameLigamentar?.contralateralLca}
                      tabagismo={!!formData.exameLigamentar?.tabagismo}
                      earlyRtsPivot={!!formData.exameLigamentar?.earlyRtsPivot}
                      segondFratura={!!formData.exameLigamentar?.segondFratura}
                      notchEstreito={!!formData.exameLigamentar?.notchEstreito}
                      lesaoAlcImagem={!!formData.exameLigamentar?.lesaoAlcImagem}
                      value={formData.aclLeapDecision}
                      draftLoaded={draftLoaded}
                      onChange={(record) => setFormData((prev) => ({ ...prev, aclLeapDecision: record }))}
                    />
                  </div>
                )}

                {isPatelar && (
                  <div className="space-y-4 pt-2">
                    <div className="flex items-center justify-between">
                      <div>
                        <h3 className="font-semibold">{examLabel("PICS 2.0 — Instabilidade Patelar")}</h3>
                        <p className="text-xs text-muted-foreground">{examLabel("Patellar Instability Comprehensive Score")}</p>
                      </div>
                      <Button type="button" onClick={handleCalculatePics} variant="secondary" size="sm" disabled={picsMutation.isPending}>
                        <Activity className="mr-2 h-4 w-4" />
                        {examLabel(picsMutation.isPending ? "Calculando..." : "Calcular PICS")}
                      </Button>
                    </div>

                    {formData.picsScore?.ptsTotal !== undefined && (
                      <div className="space-y-3">
                        <div className="grid sm:grid-cols-3 gap-3">
                          <div className="rounded-xl p-4 border-2 border-primary/30 bg-primary/5">
                            <p className="text-xs font-medium text-muted-foreground">{examLabel("PICS Total")}</p>
                            <p className="text-4xl font-bold text-primary">{formData.picsScore.ptsTotal}</p>
                          </div>
                          <div className="rounded-xl p-4 border bg-card">
                            <p className="text-xs font-medium text-muted-foreground">{examLabel("Risco")}</p>
                            <p className="text-lg font-bold mt-1">{formData.picsScore.ptsRisco}</p>
                          </div>
                          <div className="rounded-xl p-4 border bg-card">
                            <p className="text-xs font-medium text-muted-foreground">{examLabel("Conduta")}</p>
                            <p className="text-lg font-bold mt-1">{formData.picsScore.ptsConduta}</p>
                          </div>
                        </div>
                        <div className="rounded-lg bg-muted p-3 text-sm">
                          <span className="font-medium">{examLabel("Fator dominante:")} </span>
                          {formData.picsScore.fatorDominante}
                        </div>
                      </div>
                    )}
                  </div>
                )}

              </div>
            )}

            {/* STEP 5 (osteocondral only): Planejamento */}
            {hasOsteocondralPlanning && step === 5 && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-xl font-semibold">{ttech("planningTitle")}</h2>
                  <p className="text-sm text-muted-foreground mt-1">{ttech("planningDescription")}</p>
                </div>

                {ocdAnalysis ? (
                  <div className="space-y-3">
                    <div className="border-2 border-teal-300 rounded-xl p-4 bg-teal-50/30">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="text-xs font-bold uppercase tracking-widest text-teal-700">DocKnee Cartilage Algorithm v1.0</p>
                          <p className="font-mono text-sm font-bold text-teal-900 mt-1">{ocdAnalysis.classification}</p>
                        </div>
                        <span className={cn(
                          "text-sm font-bold rounded-full px-2 py-0.5",
                          ocdAnalysis.completenessProfile.score >= 70 ? "bg-teal-100 text-teal-800"
                            : ocdAnalysis.completenessProfile.score >= 40 ? "bg-amber-100 text-amber-800"
                              : "bg-red-100 text-red-800",
                        )}>
                          {ttech("completeness")} {ocdAnalysis.completenessProfile.score}/100
                        </span>
                      </div>
                      <div className={cn(
                        "mt-3 rounded-lg border-2 px-3 py-2 text-sm font-semibold",
                        ocdAnalysis.clinicalStatus.includes("RESTAURAÇÃO FOCAL") ? "border-teal-400 bg-teal-50/60 text-teal-800"
                          : ocdAnalysis.clinicalStatus.includes("BIOMECÂN") ? "border-amber-400 bg-amber-50 text-amber-800"
                            : ocdAnalysis.clinicalStatus.includes("CONSERVADOR") ? "border-sky-400 bg-sky-50 text-sky-800"
                              : "border-rose-400 bg-rose-50 text-rose-800",
                      )}>
                        {displayPlanningText(ocdAnalysis.clinicalStatus)}
                      </div>
                    </div>

                    {ocdAnalysis.warnings.map((warning, index) => (
                      <div key={index} className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                        <span aria-hidden="true" className="shrink-0">⚠</span>
                        <span>{displayPlanningText(warning)}</span>
                      </div>
                    ))}

                    {ocdAnalysis.redFlags.length > 0 && (
                      <div className="border border-red-300 rounded-xl p-3 bg-red-50/60 space-y-1.5">
                        <p className="text-xs font-bold uppercase tracking-widest text-red-700">{ttech("redFlags")}</p>
                        {ocdAnalysis.redFlags.map((flag, index) => <p key={index} className="text-sm text-red-800">• {displayPlanningText(flag)}</p>)}
                      </div>
                    )}

                    {ocdAnalysis.biomechanicalGate.present && (
                      <div className="border border-orange-300 rounded-xl p-3 bg-orange-50/50">
                        <p className="text-xs font-bold uppercase tracking-widest text-orange-700 mb-2">{ttech("biomechanicalGate")}</p>
                        <p className="text-sm text-orange-800">{displayPlanningText(ocdAnalysis.biomechanicalGate.action)}</p>
                        <div className="flex flex-wrap gap-1.5 mt-2">
                          {ocdAnalysis.biomechanicalGate.factors.map((factor, index) => (
                            <span key={index} className="text-xs px-2 py-0.5 rounded-full bg-orange-100 border border-orange-300 text-orange-800">{displayPlanningText(factor)}</span>
                          ))}
                        </div>
                      </div>
                    )}

                    {ocdAnalysis.recommendations.length > 0 && (
                      <div className="space-y-2">
                        <p className="text-xs font-bold uppercase tracking-widest text-teal-700">{ttech("suggestedStrategies")}</p>
                        {ocdAnalysis.recommendations.map((recommendation, index) => (
                          <div key={index} className="border rounded-xl p-3 bg-white/70 space-y-1">
                            <div className="flex flex-wrap items-start justify-between gap-2">
                              <p className="text-sm font-semibold text-foreground">{displayPlanningText(recommendation.procedure)}</p>
                              <span className="text-xs px-2 py-0.5 rounded-full font-medium shrink-0 bg-muted text-muted-foreground border">{displayPlanningText(recommendation.status)}</span>
                            </div>
                            <p className="text-xs text-muted-foreground leading-relaxed">{displayPlanningText(recommendation.rationale)}</p>
                          </div>
                        ))}
                      </div>
                    )}

                    {ocdAnalysis.nextDataNeeded.length > 0 && (
                      <div className="border border-dashed border-slate-300 rounded-xl p-3 bg-slate-50/50">
                        <p className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-1.5">{ttech("pendingDecisionData")}</p>
                        <div className="flex flex-wrap gap-1.5">
                          {ocdAnalysis.nextDataNeeded.map((item, index) => <span key={index} className="text-xs px-2 py-0.5 rounded-full bg-slate-200 text-slate-700">{displayPlanningText(item)}</span>)}
                        </div>
                      </div>
                    )}
                    <p className="text-xs text-muted-foreground italic">{displayPlanningText(ocdAnalysis.disclaimer)}</p>
                  </div>
                ) : (
                  <div className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
                    {ttech("completeOcdAssessment")}
                  </div>
                )}

                <div className="border-2 border-teal-200 rounded-xl p-4 space-y-3 bg-teal-50/40">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-widest text-teal-700">{ttech("mainProcedure")}</p>
                    {!hasConfirmedTissueBank && (
                      <p className="mt-1 text-xs text-amber-800">{ttech("tissueBankRequired")}</p>
                    )}
                  </div>
                  <div className="grid sm:grid-cols-2 gap-2">
                    {([
                      ["Nanofraturas", "Nanofraturas"],
                      ["OATS", "OATS — Mosaicoplastia Autóloga"],
                      ["Aloenxerto osteocondral fresco", "Aloenxerto Osteocondral Fresco"],
                      ["MACI", "AMIC — Membrana de Indução de Condrócitos Autólogos"],
                      ["ACI", "ACI — Implante Autólogo de Condrócitos"],
                      ["Autocart", "Autocart — Cartilagem Particulada Autóloga"],
                      ["Fixação OCD", "Fixação do Fragmento OCD"],
                    ] as [string, string][]).map(([value, label]) => {
                      const selected = osteocondralTecnica.procedimentos.includes(value);
                      const unavailable = value === "Aloenxerto osteocondral fresco" && !hasConfirmedTissueBank;
                      return (
                        <button
                          key={value}
                          type="button"
                          disabled={unavailable}
                          onClick={() => setOsteocondralTecnica((current) => ({
                            ...current,
                            procedimentos: selected ? current.procedimentos.filter((procedure) => procedure !== value) : [...current.procedimentos, value],
                          }))}
                          className={cn(
                            "text-sm px-3 py-2.5 rounded-lg border-2 text-left transition-all",
                            selected ? "bg-teal-100 border-teal-500 text-teal-800 font-semibold" : "border-muted hover:border-teal-300 text-muted-foreground",
                            unavailable && "cursor-not-allowed opacity-50 hover:border-muted",
                          )}
                        >
                          {selected ? "✓ " : ""}{displayTechniqueOption(label)}{unavailable ? ttech("unavailableWithoutBank") : ""}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            {/* Técnica Cirúrgica */}
            {step === techniqueStep && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-xl font-semibold">{ttech("techniqueTitle")}</h2>
                  <p className="text-sm text-muted-foreground mt-1">{ttech("techniqueDescription")}</p>
                </div>

                <SurgeryPreopFollowupCard
                  draftId={draftId ?? null}
                  patientPhone={selectedPatient?.telefone ?? undefined}
                  ensureCurrentDraft={ensureDraftForPreop}
                  ready={!draftIdParam || draftLoaded}
                  showFollowup={!isFraturas}
                />

                {/* ── PROCEDIMENTOS REALIZADOS ───────────────────── */}
                {!isArtroplastia && (
                <div className="space-y-4">
                  <Label className="text-base font-semibold">{ttech("performedProcedures")}</Label>

                  {/* Ligament reconstructions — auto from step 2 */}
                  {(formData.ligamentosAcometidos?.length ?? 0) > 0 && (
                    <div className="space-y-2">
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{ttech("ligamentReconstruction")}</p>
                      <div className="flex flex-wrap gap-2">
                        {formData.ligamentosAcometidos!.map((lig: string) => (
                          <span key={lig} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-primary/10 text-primary text-sm font-semibold border border-primary/20">
                            <CheckCircle2 className="h-4 w-4" /> {ttech("reconstructionOf")} {lig}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* ── LCP Technique (when LCP is selected) ── */}
                  {formData.ligamentosAcometidos?.includes("LCP") && (
                    <div className="border-2 border-primary/30 rounded-xl p-4 bg-primary/5 space-y-4">
                      <p className="font-semibold text-primary text-sm">{ttech("pclReconstruction")}</p>

                      <div className="grid sm:grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label className="text-xs text-muted-foreground uppercase tracking-wide font-semibold">{ttech("technique")}</Label>
                          <Select value={lcpTecnica.tecnica} onValueChange={(v) => setLcpTecnica(prev => ({ ...prev, tecnica: v, tecnicaCustom: v !== "Outra" ? "" : prev.tecnicaCustom }))}>
                            <SelectTrigger><SelectValue placeholder={ttech("selectTechnique")} /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="Inlay">Inlay</SelectItem>
                              <SelectItem value="Transtibial — Banda Única">{displayTechniqueOption("Transtibial — Banda Única")}</SelectItem>
                              <SelectItem value="Transtibial — Banda Dupla">{displayTechniqueOption("Transtibial — Banda Dupla")}</SelectItem>
                              <SelectItem value="Outra">{displayTechniqueOption("Outra")}</SelectItem>
                            </SelectContent>
                          </Select>
                          {lcpTecnica.tecnica === "Outra" && (
                            <input
                              type="text"
                              autoFocus
                              className="w-full border rounded-lg px-3 py-2 text-sm mt-1"
                              placeholder={ttech("describeTechnique")}
                              value={lcpTecnica.tecnicaCustom}
                              onChange={(e) => setLcpTecnica(prev => ({ ...prev, tecnicaCustom: e.target.value }))}
                            />
                          )}
                        </div>

                        <div className="space-y-2">
                            <Label className="text-xs text-muted-foreground uppercase tracking-wide font-semibold">{ttech("graft")}</Label>
                            <Select value={lcpTecnica.enxerto} onValueChange={(v) => setLcpTecnica(prev => ({ ...prev, enxerto: v }))}>
                              <SelectTrigger><SelectValue placeholder={ttech("selectGraft")} /></SelectTrigger>
                              <SelectContent>
                                {ENXERTOS_LIGAMENTAR.map(o => (
                                  <SelectItem key={o} value={o}>{displayOption(o)}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="space-y-2">
                            <Label className="text-xs text-muted-foreground uppercase tracking-wide font-semibold">{ttech("graftDiameter")}</Label>
                            <Select value={lcpTecnica.diametroEnxerto} onValueChange={(v) => setLcpTecnica(prev => ({ ...prev, diametroEnxerto: v }))}>
                              <SelectTrigger><SelectValue placeholder={ttech("selectDiameter")} /></SelectTrigger>
                              <SelectContent>
                                {["8mm", "8,5mm", "9mm", "9,5mm", "10mm", "10,5mm", "11mm", "Outro"].map(d => (
                                  <SelectItem key={d} value={d}>{d}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                           <div className="space-y-2">
                             <Label className="text-xs text-muted-foreground uppercase tracking-wide font-semibold">{t("flipCutter")}</Label>
                             <div className="flex gap-2">
                               {["Sim", "Não"].map((opt) => {
                                 const selected = lcpTecnica.flipCutter === opt;
                                 return (
                                   <button
                                     key={opt}
                                     type="button"
                                     onClick={() => setLcpTecnica(prev => ({ ...prev, flipCutter: selected ? "" : opt }))}
                                     className={`px-5 py-2 rounded-xl border-2 text-sm font-semibold transition-all ${
                                       selected
                                         ? "border-primary bg-primary/10 text-primary"
                                         : "border-border bg-background text-muted-foreground hover:border-primary/50"
                                     }`}
                                   >
                                     {selected && <CheckCircle2 className="inline h-3.5 w-3.5 mr-1.5" />}
                                     {traumaOption(opt)}
                                   </button>
                                 );
                               })}
                             </div>
                           </div>
                          <div className="space-y-2">
                            <Label className="text-xs text-muted-foreground uppercase tracking-wide font-semibold">{ttech("femoralFixation")}</Label>
                            <Select value={lcpTecnica.fixacaoFemoral} onValueChange={(v) => setLcpTecnica(prev => ({ ...prev, fixacaoFemoral: v }))}>
                              <SelectTrigger><SelectValue placeholder={ttech("femoralFixation")} /></SelectTrigger>
                              <SelectContent>
                                {["Parafuso bioabsorvível", "Parafuso metálico", "Endobutton", "Endoboton Ajustável", "Botão cortical", "Âncora de sutura", "Outro"].map(o => (
                                  <SelectItem key={o} value={o}>{displayTechniqueOption(o)}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="space-y-2">
                            <Label className="text-xs text-muted-foreground uppercase tracking-wide font-semibold">{ttech("tibialFixation")}</Label>
                            <Select value={lcpTecnica.fixacaoTibial} onValueChange={(v) => setLcpTecnica(prev => ({ ...prev, fixacaoTibial: v }))}>
                              <SelectTrigger><SelectValue placeholder={ttech("tibialFixation")} /></SelectTrigger>
                              <SelectContent>
                                {["Parafuso bioabsorvível", "Parafuso metálico", "Endobutton", "Endoboton Ajustável", "Botão cortical", "Âncora de sutura", "Poste", "Outro"].map(o => (
                                  <SelectItem key={o} value={o}>{displayTechniqueOption(o)}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>

                          {lcpTecnica.tecnica === "Transtibial — Banda Dupla" && (
                            <>
                              <div className="space-y-2">
                                <Label className="text-xs text-muted-foreground uppercase tracking-wide font-semibold">{ttech("amBundleFixation")}</Label>
                                <Select value={lcpTecnica.fixacaoAnteromedial} onValueChange={(v) => setLcpTecnica(prev => ({ ...prev, fixacaoAnteromedial: v }))}>
                                  <SelectTrigger><SelectValue placeholder={ttech("fixationAM")} /></SelectTrigger>
                                  <SelectContent>
                                    {["Parafuso bioabsorvível", "Parafuso metálico", "Endobutton", "Botão cortical", "Outro"].map(o => (
                                      <SelectItem key={o} value={o}>{displayTechniqueOption(o)}</SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </div>
                              <div className="space-y-2">
                                <Label className="text-xs text-muted-foreground uppercase tracking-wide font-semibold">{ttech("plBundleFixation")}</Label>
                                <Select value={lcpTecnica.fixacaoPosterolateral} onValueChange={(v) => setLcpTecnica(prev => ({ ...prev, fixacaoPosterolateral: v }))}>
                                  <SelectTrigger><SelectValue placeholder={ttech("fixationPL")} /></SelectTrigger>
                                  <SelectContent>
                                    {["Parafuso bioabsorvível", "Parafuso metálico", "Endobutton", "Botão cortical", "Outro"].map(o => (
                                      <SelectItem key={o} value={o}>{displayTechniqueOption(o)}</SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </div>
                            </>
                          )}

                          <div className="space-y-2 sm:col-span-2">
                            <Label className="text-xs text-muted-foreground uppercase tracking-wide font-semibold">{ttech("techniqueNotes")}</Label>
                            <input
                              type="text"
                              className="w-full border rounded-lg px-3 py-2 text-sm"
                              placeholder={ttech("pclNotesPlaceholder")}
                              value={lcpTecnica.justificativa}
                              onChange={(e) => setLcpTecnica(prev => ({ ...prev, justificativa: e.target.value }))}
                            />
                          </div>
                        </div>
                    </div>
                  )}

                  {/* ── CPL Technique (when CPL is selected) ── */}
                  {formData.ligamentosAcometidos?.includes("CPL") && (
                    <div className="border-2 border-primary/30 rounded-xl p-4 bg-primary/5 space-y-5">
                      <div>
                        <p className="font-semibold text-primary text-sm">{ttech("plcReconstruction")}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">{ttech("plcComponents")}</p>
                      </div>

                      {/* Técnica */}
                      <div className="space-y-2">
                        <Label className="text-xs text-muted-foreground uppercase tracking-wide font-semibold">{ttech("technique")}</Label>
                        <div className="flex flex-wrap gap-2">
                          {["Laprade", "Arcieiro", "Fanelli", "Outra"].map(t => (
                            <button key={t} type="button"
                              onClick={() => setCplTecnica(prev => ({ ...prev, tecnica: prev.tecnica === t ? "" : t, tecnicaCustom: t !== "Outra" ? "" : prev.tecnicaCustom }))}
                              className={`px-4 py-2 rounded-xl border-2 text-sm font-semibold transition-all ${
                                cplTecnica.tecnica === t
                                  ? "border-primary bg-primary/10 text-primary"
                                  : "border-border bg-background text-muted-foreground hover:border-primary/50"
                              }`}>
                              {displayTechniqueOption(t)}
                            </button>
                          ))}
                        </div>
                        {cplTecnica.tecnica === "Laprade" && (
                          <p className="text-xs text-muted-foreground bg-muted/40 rounded px-3 py-1.5">{ttech("lapradeDescription")}</p>
                        )}
                        {cplTecnica.tecnica === "Arcieiro" && (
                          <p className="text-xs text-muted-foreground bg-muted/40 rounded px-3 py-1.5">{ttech("arcieiroDescription")}</p>
                        )}
                        {cplTecnica.tecnica === "Fanelli" && (
                          <p className="text-xs text-muted-foreground bg-muted/40 rounded px-3 py-1.5">{ttech("fanelliDescription")}</p>
                        )}
                        {cplTecnica.tecnica === "Outra" && (
                          <input
                            type="text"
                            autoFocus
                            className="w-full border rounded-lg px-3 py-2 text-sm"
                            placeholder={ttech("describeTechnique")}
                            value={cplTecnica.tecnicaCustom}
                            onChange={(e) => setCplTecnica(prev => ({ ...prev, tecnicaCustom: e.target.value }))}
                          />
                        )}
                      </div>

                      {/* Enxertos (múltiplos) */}
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <Label className="text-xs text-muted-foreground uppercase tracking-wide font-semibold">{ttech("grafts")}</Label>
                          <button type="button"
                            onClick={() => setCplTecnica(prev => ({ ...prev, enxertos: [...prev.enxertos, { nome: "", diametro: "" }] }))}
                            className="text-xs text-primary font-semibold hover:underline">
                            {ttech("addGraft")}
                          </button>
                        </div>
                        {cplTecnica.enxertos.map((enx, i) => (
                          <div key={i} className="flex gap-2 items-center">
                            <div className="flex-1">
                              <Select value={enx.nome} onValueChange={(v) => setCplTecnica(prev => {
                                const e = [...prev.enxertos]; e[i] = { ...e[i], nome: v }; return { ...prev, enxertos: e };
                              })}>
                                <SelectTrigger><SelectValue placeholder={ttech("graftNumber", { number: i + 1 })} /></SelectTrigger>
                                <SelectContent>
                                  {ENXERTOS_LIGAMENTAR.map(o => (
                                    <SelectItem key={o} value={o}>{displayTechniqueOption(o)}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                            <div className="w-32">
                              <Select value={enx.diametro} onValueChange={(v) => setCplTecnica(prev => {
                                const e = [...prev.enxertos]; e[i] = { ...e[i], diametro: v }; return { ...prev, enxertos: e };
                              })}>
                                <SelectTrigger><SelectValue placeholder="Ø" /></SelectTrigger>
                                <SelectContent>
                                  {["5mm", "5,5mm", "6mm", "6,5mm", "7mm", "7,5mm", "8mm", "8,5mm", "9mm", "9,5mm", "10mm", "Outro"].map(d => (
                                    <SelectItem key={d} value={d}>{d}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                            {cplTecnica.enxertos.length > 1 && (
                              <button type="button" onClick={() => setCplTecnica(prev => ({ ...prev, enxertos: prev.enxertos.filter((_, j) => j !== i) }))}
                                className="text-red-500 text-xs font-bold px-2">✕</button>
                            )}
                          </div>
                        ))}
                      </div>

                      {/* Fixações */}
                      {cplTecnica.tecnica && (
                        <div className="grid sm:grid-cols-2 gap-4 border-t pt-4">
                          {/* Fixação Femoral 1 — todas as técnicas */}
                          <div className="space-y-2">
                            <Label className="text-xs text-muted-foreground uppercase tracking-wide font-semibold">
                               {ttech("femoralFixation")} {cplTecnica.tecnica !== "Fanelli" ? "1" : ""}{" "}
                              <span className="font-normal normal-case tracking-normal">(LCL)</span>
                            </Label>
                            <Select value={cplTecnica.fixacaoFemoral1} onValueChange={(v) => setCplTecnica(prev => ({ ...prev, fixacaoFemoral1: v }))}>
                              <SelectTrigger><SelectValue placeholder={ttech("femoralFixation")} /></SelectTrigger>
                              <SelectContent>
                                {["Parafuso bioabsorvível", "Parafuso metálico", "Endobutton", "Endoboton Ajustável", "Botão cortical", "Âncora de sutura", "Poste", "Sem fixação", "Outro"].map(o => (
                                  <SelectItem key={o} value={o}>{displayTechniqueOption(o)}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>

                          {/* Fixação Femoral 2 — Laprade e Arcieiro */}
                          {(cplTecnica.tecnica === "Laprade" || cplTecnica.tecnica === "Arcieiro") && (
                            <div className="space-y-2">
                              <Label className="text-xs text-muted-foreground uppercase tracking-wide font-semibold">{ttech("femoralFixation2")} <span className="font-normal normal-case tracking-normal">({ttech("poplitealTendonAbbrev")})</span></Label>
                              <Select value={cplTecnica.fixacaoFemoral2} onValueChange={(v) => setCplTecnica(prev => ({ ...prev, fixacaoFemoral2: v }))}>
                                <SelectTrigger><SelectValue placeholder={ttech("femoralFixation2")} /></SelectTrigger>
                                <SelectContent>
                                  {["Parafuso bioabsorvível", "Parafuso metálico", "Endobutton", "Endoboton Ajustável", "Botão cortical", "Âncora de sutura", "Poste", "Sem fixação", "Outro"].map(o => (
                                    <SelectItem key={o} value={o}>{displayTechniqueOption(o)}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                          )}

                          {/* Fixação Fibular — Laprade e Arcieiro */}
                          {(cplTecnica.tecnica === "Laprade" || cplTecnica.tecnica === "Arcieiro") && (
                            <div className="space-y-2">
                              <Label className="text-xs text-muted-foreground uppercase tracking-wide font-semibold">
                                 {ttech("fibularFixation")}{" "}
                                <span className="font-normal normal-case tracking-normal">
                                  {cplTecnica.tecnica === "Laprade" ? "(LCL + LPF)" : "(LCL)"}
                                </span>
                              </Label>
                              <Select value={cplTecnica.fixacaoFibular} onValueChange={(v) => setCplTecnica(prev => ({ ...prev, fixacaoFibular: v }))}>
                                <SelectTrigger><SelectValue placeholder={ttech("fibularFixation")} /></SelectTrigger>
                                <SelectContent>
                                  {["Parafuso bioabsorvível", "Parafuso metálico", "Endobutton", "Endoboton Ajustável", "Botão cortical", "Âncora de sutura", "Poste", "Sem fixação", "Outro"].map(o => (
                                    <SelectItem key={o} value={o}>{displayTechniqueOption(o)}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                          )}

                          {/* Fixação Tibial — somente Laprade */}
                          {cplTecnica.tecnica === "Laprade" && (
                            <div className="space-y-2">
                              <Label className="text-xs text-muted-foreground uppercase tracking-wide font-semibold">{ttech("tibialFixation")} <span className="font-normal normal-case tracking-normal">(LPF)</span></Label>
                              <Select value={cplTecnica.fixacaoTibial} onValueChange={(v) => setCplTecnica(prev => ({ ...prev, fixacaoTibial: v }))}>
                                <SelectTrigger><SelectValue placeholder={ttech("tibialFixation")} /></SelectTrigger>
                                <SelectContent>
                                  {["Parafuso bioabsorvível", "Parafuso metálico", "Endobutton", "Endoboton Ajustável", "Botão cortical", "Âncora de sutura", "Poste", "Sem fixação", "Outro"].map(o => (
                                    <SelectItem key={o} value={o}>{displayTechniqueOption(o)}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                          )}

                          <div className="space-y-2 sm:col-span-2">
                            <Label className="text-xs text-muted-foreground uppercase tracking-wide font-semibold">{ttech("notes")}</Label>
                            <input type="text" className="w-full border rounded-lg px-3 py-2 text-sm"
                              placeholder={ttech("plcNotesPlaceholder")}
                              value={cplTecnica.justificativa}
                              onChange={(e) => setCplTecnica(prev => ({ ...prev, justificativa: e.target.value }))} />
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* ── CPM Technique (when CPM is selected) ── */}
                  {hasCpm && (
                    <div className="border-2 border-primary/30 rounded-xl p-4 bg-primary/5 space-y-5">
                      <div>
                        <p className="font-semibold text-primary text-sm">{ttech("pmcTitle")}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">{ttech("pmcDescription")}</p>
                      </div>

                      {/* Abordagem */}
                      <div className="space-y-2">
                        <Label className="text-xs text-muted-foreground uppercase tracking-wide font-semibold">{ttech("approach")}</Label>
                        <div className="flex flex-wrap gap-2">
                          {[
                            { value: "lcm_isolado",  label: "LCM Isolado",           sub: "Canuto / Bosworth" },
                            { value: "lcm_lop",      label: "LCM + LOP",             sub: "Laprade / Stannard" },
                            { value: "reparo_lcm",   label: "Reparo do LCM",          sub: "Âncoras / Transósseo / FiberTape" },
                            { value: "recon_reparo", label: "Reconstrução + Reparo",  sub: "Enxerto + Reforço Biológico" },
                          ].map(op => (
                            <button key={op.value} type="button"
                              onClick={() => setCpmTecnica(prev => ({
                                ...prev,
                                abordagem: prev.abordagem === op.value ? "" : op.value as typeof prev.abordagem,
                                lcmTecnica: "",
                                lcmReparoTecnica: "",
                              }))}
                              className={`px-4 py-2.5 rounded-xl border-2 text-sm font-semibold transition-all text-left ${
                                cpmTecnica.abordagem === op.value
                                  ? "border-primary bg-primary/10 text-primary"
                                  : "border-border bg-background text-muted-foreground hover:border-primary/50"
                              }`}>
                              <span className="block">{displayTechniqueOption(op.label)}</span>
                              <span className="block text-xs font-normal opacity-70">{displayTechniqueOption(op.sub)}</span>
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* ── Bloco de Reconstrução LCM (lcm_isolado, lcm_lop, recon_reparo) ── */}
                      {(cpmTecnica.abordagem === "lcm_isolado" || cpmTecnica.abordagem === "lcm_lop" || cpmTecnica.abordagem === "recon_reparo") && (
                        <div className="border rounded-xl p-4 bg-background/60 space-y-4">
                          <p className="text-sm font-semibold text-primary">
                            {ttech("mclReconstruction")}{cpmTecnica.abordagem === "recon_reparo" ? ttech("reconstructiveComponent") : ""}
                          </p>
                          <div className="grid sm:grid-cols-2 gap-4">
                            <div className="space-y-2">
                              <Label className="text-xs text-muted-foreground uppercase tracking-wide font-semibold">{ttech("technique")}</Label>
                              <Select value={cpmTecnica.lcmTecnica} onValueChange={(v) => setCpmTecnica(prev => ({ ...prev, lcmTecnica: v, lcmTecnicaCustom: v !== "Outra" ? "" : prev.lcmTecnicaCustom }))}>
                                <SelectTrigger><SelectValue placeholder={ttech("selectTechnique")} /></SelectTrigger>
                                <SelectContent>
                                  {CPM_LCM_RECONSTRUCTION_TECHNIQUES.map(o => (
                                    <SelectItem key={o} value={o}>{displayTechniqueOption(o)}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              {cpmTecnica.lcmTecnica === "Outra" && (
                                <input type="text" autoFocus className="w-full border rounded-lg px-3 py-2 text-sm mt-1"
                                  placeholder={ttech("describeTechnique")}
                                  value={cpmTecnica.lcmTecnicaCustom}
                                  onChange={(e) => setCpmTecnica(prev => ({ ...prev, lcmTecnicaCustom: e.target.value }))} />
                              )}
                            </div>
                            <div className="space-y-2">
                              <Label className="text-xs text-muted-foreground uppercase tracking-wide font-semibold">{ttech("graft")}</Label>
                              <Select value={cpmTecnica.lcmEnxerto} onValueChange={(v) => setCpmTecnica(prev => ({ ...prev, lcmEnxerto: v }))}>
                                <SelectTrigger><SelectValue placeholder={ttech("selectGraft")} /></SelectTrigger>
                                <SelectContent>
                                  {[...ENXERTOS_LIGAMENTAR, "Reparo Direto (sem enxerto)"].map(o => (
                                    <SelectItem key={o} value={o}>{displayTechniqueOption(o)}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                            <div className="space-y-2">
                              <Label className="text-xs text-muted-foreground uppercase tracking-wide font-semibold">{ttech("proximalFixation")}</Label>
                              <Select value={cpmTecnica.lcmFixacaoProximal} onValueChange={(v) => setCpmTecnica(prev => ({ ...prev, lcmFixacaoProximal: v }))}>
                                <SelectTrigger><SelectValue placeholder={ttech("proximalFixation")} /></SelectTrigger>
                                <SelectContent>
                                  {["Parafuso bioabsorvível", "Parafuso metálico", "Parafuso com Arruela", "Âncora de sutura", "Botão cortical"].map(o => (
                                    <SelectItem key={o} value={o}>{displayTechniqueOption(o)}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                            <div className="space-y-2">
                              <Label className="text-xs text-muted-foreground uppercase tracking-wide font-semibold">{ttech("distalFixation")}</Label>
                              <Select value={cpmTecnica.lcmFixacaoDistal} onValueChange={(v) => setCpmTecnica(prev => ({ ...prev, lcmFixacaoDistal: v }))}>
                                <SelectTrigger><SelectValue placeholder={ttech("distalFixation")} /></SelectTrigger>
                                <SelectContent>
                                  {["Parafuso bioabsorvível", "Parafuso metálico", "Parafuso com Arruela", "Âncora de sutura", "Botão cortical", "Furos Transósseos", "Mantida a Inserção do Semitendíneo"].map(o => (
                                    <SelectItem key={o} value={o}>{displayTechniqueOption(o)}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* ── Bloco de Reparo LCM (reparo_lcm, recon_reparo) ── */}
                      {(cpmTecnica.abordagem === "reparo_lcm" || cpmTecnica.abordagem === "recon_reparo") && (
                        <div className="border rounded-xl p-4 bg-background/60 space-y-4">
                          <p className="text-sm font-semibold text-primary">
                             {ttech("mclRepair")}{cpmTecnica.abordagem === "recon_reparo" ? ttech("reinforcementComponent") : ""}
                          </p>
                          <div className="grid sm:grid-cols-2 gap-4">
                            <div className="space-y-2">
                              <Label className="text-xs text-muted-foreground uppercase tracking-wide font-semibold">{ttech("repairFixationTechnique")}</Label>
                              <Select value={cpmTecnica.lcmReparoTecnica} onValueChange={(v) => setCpmTecnica(prev => ({ ...prev, lcmReparoTecnica: v, lcmReparoTecnicaCustom: v !== "Outra" ? "" : prev.lcmReparoTecnicaCustom }))}>
                                <SelectTrigger><SelectValue placeholder={ttech("selectTechnique")} /></SelectTrigger>
                                <SelectContent>
                                  {[
                                    "Âncoras de Sutura",
                                    "Suturas Transósseas",
                                    "Reforço com FiberTape",
                                    "Âncoras + FiberTape",
                                    "Suturas Transósseas + FiberTape",
                                    "Reparo Primário sem reforço",
                                    "Outra",
                                  ].map(o => <SelectItem key={o} value={o}>{displayTechniqueOption(o)}</SelectItem>)}
                                </SelectContent>
                              </Select>
                              {cpmTecnica.lcmReparoTecnica === "Outra" && (
                                <input type="text" autoFocus className="w-full border rounded-lg px-3 py-2 text-sm mt-1"
                                  placeholder={ttech("describeRepairTechnique")}
                                  value={cpmTecnica.lcmReparoTecnicaCustom}
                                  onChange={(e) => setCpmTecnica(prev => ({ ...prev, lcmReparoTecnicaCustom: e.target.value }))} />
                              )}
                            </div>
                          </div>
                          <p className="text-xs text-muted-foreground bg-muted/40 rounded px-3 py-1.5">
                            {ttech("repairTechniqueHelp")}
                          </p>
                        </div>
                      )}

                      {/* LOP — só quando abordagem LCM + LOP */}
                      {cpmTecnica.abordagem === "lcm_lop" && (
                        <div className="border rounded-xl p-4 bg-background/60 space-y-4">
                           <p className="text-sm font-semibold text-primary">{ttech("polTitle")}</p>
                          <div className="grid sm:grid-cols-2 gap-4">
                            <div className="space-y-2">
                              <Label className="text-xs text-muted-foreground uppercase tracking-wide font-semibold">{ttech("technique")}</Label>
                              <Select value={cpmTecnica.lopTecnica} onValueChange={(v) => setCpmTecnica(prev => ({ ...prev, lopTecnica: v, lopTecnicaCustom: v !== "Outra" ? "" : prev.lopTecnicaCustom }))}>
                                <SelectTrigger><SelectValue placeholder={ttech("selectTechnique")} /></SelectTrigger>
                                <SelectContent>
                                  {["Reparo Primário", "Reconstrução com Enxerto", "Tensionamento", "Reparo + Reforço", "Outra"].map(o => (
                                    <SelectItem key={o} value={o}>{displayTechniqueOption(o)}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              {cpmTecnica.lopTecnica === "Outra" && (
                                <input type="text" autoFocus className="w-full border rounded-lg px-3 py-2 text-sm mt-1"
                                  placeholder={ttech("describeTechnique")}
                                  value={cpmTecnica.lopTecnicaCustom}
                                  onChange={(e) => setCpmTecnica(prev => ({ ...prev, lopTecnicaCustom: e.target.value }))} />
                              )}
                            </div>
                            <div className="space-y-2">
                              <Label className="text-xs text-muted-foreground uppercase tracking-wide font-semibold">{ttech("graft")}</Label>
                              <Select value={cpmTecnica.lopEnxerto} onValueChange={(v) => setCpmTecnica(prev => ({ ...prev, lopEnxerto: v }))}>
                                <SelectTrigger><SelectValue placeholder={ttech("selectGraft")} /></SelectTrigger>
                                <SelectContent>
                                  {[...ENXERTOS_LIGAMENTAR.filter(o => o !== "Ligamento Sintético (LARS)"), "Não utilizado"].map(o => (
                                    <SelectItem key={o} value={o}>{displayTechniqueOption(o)}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                            <div className="space-y-2">
                              <Label className="text-xs text-muted-foreground uppercase tracking-wide font-semibold">{ttech("fixation")}</Label>
                              <Select value={cpmTecnica.lopFixacao} onValueChange={(v) => setCpmTecnica(prev => ({ ...prev, lopFixacao: v }))}>
                                <SelectTrigger><SelectValue placeholder={ttech("fixationType")} /></SelectTrigger>
                                <SelectContent>
                                  {["Âncora de sutura", "Parafuso com Arruela", "Furos Transósseos", "Parafuso bioabsorvível", "Parafuso metálico", "Botão cortical"].map(o => (
                                    <SelectItem key={o} value={o}>{displayTechniqueOption(o)}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Justificativa */}
                      {cpmTecnica.abordagem && (
                        <div className="space-y-2">
                           <Label className="text-xs text-muted-foreground uppercase tracking-wide font-semibold">{ttech("notes")}</Label>
                          <input type="text" className="w-full border rounded-lg px-3 py-2 text-sm"
                            placeholder={
                              cpmTecnica.abordagem === "lcm_isolado"  ? ttech("cpmPlaceholderIsolated") :
                              cpmTecnica.abordagem === "lcm_lop"      ? ttech("cpmPlaceholderPol") :
                              cpmTecnica.abordagem === "reparo_lcm"   ? ttech("cpmPlaceholderRepair") :
                                                                        ttech("cpmPlaceholderCombined")
                            }
                            value={cpmTecnica.justificativa}
                            onChange={(e) => setCpmTecnica(prev => ({ ...prev, justificativa: e.target.value }))} />
                        </div>
                      )}
                    </div>
                  )}

                  {/* Expandable procedure cards */}
                  <div className="space-y-3">

                    {/* ── 1. Reparo / Sutura Meniscal ── */}
                    {!isOrtobiologicoIsolado && !isOutrosProcedimentosIsolado && !isFraturasIsolado && (() => {
                      const active = activeProcSections.has("sutura");
                      const meniscalProcedure = (formData.procedimentoMeniscal || {}) as Record<string, unknown>;
                      const activeSideSelected = activeMeniscalSide
                        ? meniscalProcedure[sideSelectionKey(activeMeniscalSide)] === true
                        : false;
                      const activeMeniscalDetails = activeMeniscalSide
                        ? getMeniscalSideDetails(meniscalProcedure, activeMeniscalSide)
                        : {};
                      return (
                        <div className={cn("border-2 rounded-xl transition-all", active ? "border-primary" : "border-border")}>
                          <button type="button"
                            onClick={() => {
                              toggleProcSection("sutura");
                              if (active) clearMeniscalProcedure();
                            }}
                            className="w-full text-left p-4 flex items-center justify-between">
                            <div className="flex items-center gap-3">
                              {active && <CheckCircle2 className="h-5 w-5 text-primary shrink-0" />}
                              <div>
                                <p className={cn("font-semibold", active ? "text-primary" : "")}>{ttech("meniscalRepair")}</p>
                                {active && <p className="text-xs text-muted-foreground mt-0.5">{ttech("expandDetails")}</p>}
                              </div>
                            </div>
                            <ChevronDown className={cn("h-4 w-4 shrink-0 transition-transform", active ? "rotate-180 text-primary" : "text-muted-foreground")} />
                          </button>
                          {active && (
                            <div className="px-4 pb-4 space-y-4 border-t">
                              <div className="pt-3">
                                <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 block">{ttech("affectedMeniscus")}</Label>
                                <div className="flex gap-3">
                                  {([["medial", "Medial"], ["lateral", "Lateral"]] as const).map(([side, label]) => {
                                    const key = sideSelectionKey(side);
                                    const selected = meniscalProcedure[key] === true;
                                    const isActiveSide = selected && activeMeniscalSide === side;
                                    return (
                                      <button key={side} type="button"
                                        aria-pressed={isActiveSide}
                                        onClick={() => {
                                          if (isActiveSide) {
                                            removeMeniscalSide(side);
                                            const otherSide: MeniscalSide = side === "medial" ? "lateral" : "medial";
                                            setActiveMeniscalSide(
                                              meniscalProcedure[sideSelectionKey(otherSide)] === true ? otherSide : null,
                                            );
                                          } else {
                                            if (!selected) {
                                              updateNested("procedimentoMeniscal", key, true);
                                              updateMeniscalSide(side, "sutura", true);
                                            }
                                            setActiveMeniscalSide(side);
                                          }
                                        }}
                                        className={cn("px-4 py-2 rounded-lg border-2 text-sm font-medium transition-all",
                                          isActiveSide
                                            ? "border-primary bg-primary text-primary-foreground shadow-sm"
                                            : selected
                                            ? "border-primary bg-primary/5 text-primary"
                                            : "border-border hover:border-primary/40")}>
                                        {selected && <CheckCircle2 className="inline h-3.5 w-3.5 mr-1.5" />}{displayTechniqueOption(label)}
                                      </button>
                                    );
                                  })}
                                </div>
                              </div>
                              {!activeSideSelected && (
                                <p className="rounded-lg border border-dashed px-3 py-4 text-center text-sm text-muted-foreground">
                                  {ttech("selectMeniscusToDetail")}
                                </p>
                              )}
                              {activeMeniscalSide && activeSideSelected && (
                                <>
                                  <div className="rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-sm font-semibold text-primary">
                                    {ttech(activeMeniscalSide === "medial" ? "detailingMedialMeniscus" : "detailingLateralMeniscus")}
                                  </div>
                                  <div className="grid gap-3 sm:grid-cols-2">
                                    <div className="flex items-center space-x-2 rounded-lg border px-3 py-2.5">
                                      <Switch
                                        checked={!!activeMeniscalDetails.sutura}
                                        onCheckedChange={(checked) => updateMeniscalSide(activeMeniscalSide, "sutura", checked)}
                                      />
                                      <Label>{ttech("performedMeniscalSuture")}</Label>
                                    </div>
                                    <div className="flex items-center space-x-2 rounded-lg border px-3 py-2.5">
                                      <Switch
                                        checked={!!activeMeniscalDetails.meniscectomia}
                                        onCheckedChange={(checked) => updateMeniscalSide(activeMeniscalSide, "meniscectomia", checked)}
                                      />
                                      <Label>{ttech("performedMeniscectomy")}</Label>
                                    </div>
                                  </div>
                              <div>
                                <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 block">{ttech("lesionLocation")}</Label>
                                <div className="flex flex-wrap gap-2">
                                  {[
                                    ["lesaoRampa","Rampa"],["lesaoRaiz","Raiz Posterior"],["lesaoRaizAnterior","Raiz Anterior"],
                                    ["lesaoCornoAnterior","Corno Anterior"],["lesaoCornoPosterior","Corno Posterior"],
                                    ["lesaoAlcaBalde","Alça de Balde"],["lesaoRadial","Radial"],["lesaoCorpo","Corpo"],
                                    ...(isJovem ? [["lesaoDiscoide","Menisco Discoide 🧒"]] : []),
                                  ].map(([key, label]) => (
                                    <button key={key} type="button"
                                      onClick={() => updateMeniscalSide(activeMeniscalSide, key as keyof MeniscalSideDetails, !(activeMeniscalDetails as any)[key])}
                                      className={cn("text-sm px-3 py-1.5 rounded-lg border-2 transition-all",
                                        (activeMeniscalDetails as any)[key]
                                          ? key === "lesaoDiscoide" ? "border-orange-500 bg-orange-50 font-medium text-orange-700" : "border-primary bg-primary/5 font-medium text-primary"
                                          : key === "lesaoDiscoide" ? "border-orange-200 hover:border-orange-400" : "border-border hover:border-primary/40")}>
                                      {(activeMeniscalDetails as any)[key] && <CheckCircle2 className="inline h-3 w-3 mr-1" />}{displayTechniqueOption(label)}
                                    </button>
                                  ))}
                                </div>
                              </div>
                              {/* ── Centralização da Raiz (aparece só quando Raiz Posterior está selecionada) ── */}
                              {activeMeniscalDetails.lesaoRaiz && (
                                <div className="rounded-lg border-2 border-amber-300 bg-amber-50/60 p-3 space-y-3">
                                  {/* 1. Método de Fixação da Raiz — sempre visível ao selecionar Raiz Posterior */}
                                  <div>
                                    <Label className="text-xs font-semibold text-amber-800 uppercase tracking-wide mb-2 block">{ttech("rootFixationMethod")}</Label>
                                    <div className="flex flex-wrap gap-2">
                                      {["Parafuso Poste", "Âncora", "Endoboton", "Parafuso de Interferência", "Fixado na Placa"].map((metodo) => {
                                        const selected = activeMeniscalDetails.fixacaoRaiz === metodo;
                                        return (
                                          <button key={metodo} type="button"
                                            onClick={() => updateMeniscalSide(activeMeniscalSide, "fixacaoRaiz", selected ? "" : metodo)}
                                            className={cn("text-sm px-3 py-2 rounded-lg border-2 transition-all font-medium",
                                              selected ? "border-amber-500 bg-amber-100 text-amber-900" : "border-amber-200 hover:border-amber-400 bg-white text-slate-700")}>
                                             {selected && <CheckCircle2 className="inline h-3.5 w-3.5 mr-1.5 text-amber-600" />}{displayTechniqueOption(metodo)}
                                          </button>
                                        );
                                      })}
                                    </div>
                                  </div>

                                  {/* 2. Centralização — Sim/Não; se Sim → método da centralização */}
                                  <div>
                                    <Label className="text-xs font-semibold text-amber-800 uppercase tracking-wide mb-2 block">{ttech("rootCentralizationQuestion")}</Label>
                                    <div className="flex gap-3">
                                      {[["Sim", true], ["Não", false]].map(([label, val]) => {
                                        const current = activeMeniscalDetails.centralizacaoRaiz;
                                        const selected = current === val;
                                        return (
                                          <button key={String(label)} type="button"
                                            onClick={() => {
                                              updateMeniscalSide(activeMeniscalSide, "centralizacaoRaiz", val);
                                              if (val === false) updateMeniscalSide(activeMeniscalSide, "centralizacaoMetodo", "");
                                            }}
                                            className={cn("px-4 py-2 rounded-lg border-2 text-sm font-medium transition-all",
                                              selected ? "border-amber-500 bg-amber-100 text-amber-900" : "border-amber-200 hover:border-amber-400 bg-white text-slate-700")}>
                                             {selected && <CheckCircle2 className="inline h-3.5 w-3.5 mr-1.5 text-amber-600" />}{displayTechniqueOption(String(label))}
                                          </button>
                                        );
                                      })}
                                    </div>
                                    {activeMeniscalDetails.centralizacaoRaiz === true && (
                                      <div className="mt-3">
                                        <Label className="text-xs font-semibold text-amber-800 uppercase tracking-wide mb-2 block">{ttech("centralizationFixationMethod")}</Label>
                                        <div className="flex flex-wrap gap-2">
                                          {["Túnel Trans-ósseo", "Âncora"].map((met) => {
                                            const sel = activeMeniscalDetails.centralizacaoMetodo === met;
                                            return (
                                              <button key={met} type="button"
                                                onClick={() => updateMeniscalSide(activeMeniscalSide, "centralizacaoMetodo", sel ? "" : met)}
                                                className={cn("text-sm px-4 py-2 rounded-lg border-2 transition-all font-medium",
                                                  sel ? "border-amber-500 bg-amber-100 text-amber-900" : "border-amber-200 hover:border-amber-400 bg-white text-slate-700")}>
                                                 {sel && <CheckCircle2 className="inline h-3.5 w-3.5 mr-1.5 text-amber-600" />}{displayTechniqueOption(met)}
                                              </button>
                                            );
                                          })}
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              )}

                              {/* Técnica de Sutura — oculta quando Raiz Posterior selecionada (já documentado no bloco de fixação) */}
                              {!activeMeniscalDetails.lesaoRaiz && (
                                <div>
                                  <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 block">{ttech("sutureTechnique")}</Label>
                                  <div className="grid grid-cols-2 gap-2">
                                    {["All-inside", "Inside-out", "Outside-in", "Túnel ósseo"].map((tec) => {
                                      const currentTecs: string[] = activeMeniscalDetails.tecnicasSutura || [];
                                      const selected = currentTecs.includes(tec);
                                      return (
                                        <button key={tec} type="button"
                                          onClick={() => {
                                            const next = selected ? currentTecs.filter((t) => t !== tec) : [...currentTecs, tec];
                                            updateMeniscalSide(activeMeniscalSide, "tecnicasSutura", next);
                                            if (selected) {
                                              const pts = JSON.parse(activeMeniscalDetails.pontosPorTecnica || "{}");
                                              delete pts[tec];
                                              updateMeniscalSide(activeMeniscalSide, "pontosPorTecnica", JSON.stringify(pts));
                                            }
                                          }}
                                          className={cn("text-sm text-left px-3 py-2 rounded-lg border-2 transition-all",
                                            selected ? "border-primary bg-primary/5 font-medium text-primary" : "border-border hover:border-primary/40")}>
                                           {selected && <CheckCircle2 className="inline h-3 w-3 mr-1 text-primary" />}{displayTechniqueOption(tec)}
                                        </button>
                                      );
                                    })}
                                  </div>
                                  {(activeMeniscalDetails.tecnicasSutura || []).length > 0 && (
                                    <div className="mt-3 space-y-2">
                                      <Label className="text-xs text-muted-foreground">{ttech("pointsPerTechnique")}</Label>
                                      <div className="grid grid-cols-2 gap-2">
                                      {(activeMeniscalDetails.tecnicasSutura || []).map((tec) => {
                                        const pts = JSON.parse(activeMeniscalDetails.pontosPorTecnica || "{}");
                                          return (
                                            <div key={tec} className="flex items-center gap-2">
                                              <span className="text-xs text-muted-foreground flex-1 truncate">{tec}</span>
                                              <Input type="number" min={0} className="w-20 h-8 text-sm" placeholder="pts"
                                                value={pts[tec] ?? ""}
                                                onChange={(e) => {
                                                  const updated = { ...pts, [tec]: parseInt(e.target.value) || 0 };
                                                  updateMeniscalSide(activeMeniscalSide, "pontosPorTecnica", JSON.stringify(updated));
                                                }} />
                                            </div>
                                          );
                                        })}
                                      </div>
                                    </div>
                                  )}
                                </div>
                              )}

                              {/* Estímulo Biológico */}
                              <div>
                                <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 block">{ttech("biologicalStimulation")}</Label>
                                <div className="flex flex-wrap gap-2">
                                  {[
                                    ["estimuloPerfuracaoIntercondilo", "Perfuração do Intercôndilo"],
                                    ["estimuloCoaguloFibrina", "Coágulo de Fibrina"],
                                  ].map(([key, label]) => {
                                    const active = !!(activeMeniscalDetails as any)[key];
                                    return (
                                      <button key={key} type="button"
                                        onClick={() => {
                                          const next = !active;
                                          updateMeniscalSide(activeMeniscalSide, key as keyof MeniscalSideDetails, next);
                                          const otherKey = key === "estimuloPerfuracaoIntercondilo"
                                            ? "estimuloCoaguloFibrina" : "estimuloPerfuracaoIntercondilo";
                                          const otherActive = !!(activeMeniscalDetails as any)[otherKey];
                                          updateMeniscalSide(activeMeniscalSide, "estimuloBiologico", next || otherActive);
                                        }}
                                        className={cn("text-sm px-3 py-1.5 rounded-lg border-2 transition-all",
                                          active
                                            ? "border-green-500 bg-green-50 font-medium text-green-700"
                                            : "border-border hover:border-primary/40")}>
                                         {active && <CheckCircle2 className="inline h-3 w-3 mr-1 text-green-600" />}{displayTechniqueOption(label)}
                                      </button>
                                    );
                                  })}
                                </div>
                              </div>

                              {/* Saucerização — apenas pacientes pediátricos com menisco discoide */}
                              {isJovem && (
                                <div className="rounded-lg border-2 border-orange-300 bg-orange-50/60 px-3 py-2.5 space-y-1.5">
                                  <p className="text-xs font-semibold text-orange-800 uppercase tracking-wide">{ttech("saucerization")}</p>
                                  <div className="flex items-center space-x-2">
                                    <Switch
                                      checked={!!activeMeniscalDetails.saucerizacao}
                                      onCheckedChange={(c) => updateMeniscalSide(activeMeniscalSide, "saucerizacao", c)} />
                                    <Label className="text-sm text-orange-900">{ttech("performedSaucerization")}</Label>
                                  </div>
                                  {activeMeniscalDetails.saucerizacao && (
                                    <p className="text-xs text-orange-700">{ttech("saucerizationHelp")}</p>
                                  )}
                                </div>
                              )}

                                </>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })()}

                    {/* ── 3. Osteotomia ── */}

                    {((!isOrtobiologicoIsolado && !isOutrosProcedimentosIsolado && !isFraturasIsolado) || isOsteotomia) && (() => {
                      const active = activeProcSections.has("osteotomia");
                      const OstBtn = ({ label, field, stateKey }: { label: string; field: boolean; stateKey: keyof typeof osteotomia }) => (
                        <button type="button"
                          onClick={() => setOsteotomia((prev) => ({ ...prev, [stateKey]: !prev[stateKey] }))}
                          className={cn("w-full text-left px-4 py-3 rounded-lg border-2 text-sm font-medium transition-all",
                            field ? "border-primary bg-primary/5 text-primary" : "border-border hover:border-primary/40")}>
                          {field && <CheckCircle2 className="inline h-4 w-4 mr-2" />}{displayTechniqueOption(label)}
                        </button>
                      );
                      const OstPills = ({ field, options, stateKey }: { field: string; options: string[]; stateKey: keyof typeof osteotomia }) => (
                        <div className="flex flex-wrap gap-2">
                          {options.map((opt) => (
                            <button key={opt} type="button"
                              onClick={() => setOsteotomia((prev) => ({ ...prev, [stateKey]: prev[stateKey] === opt ? "" : opt }))}
                              className={cn("px-3 py-1.5 rounded-lg border-2 text-sm font-medium transition-all",
                                field === opt ? "border-primary bg-primary/5 text-primary" : "border-border hover:border-primary/40")}>
                              {field === opt && <CheckCircle2 className="inline h-3.5 w-3.5 mr-1.5" />}{displayTechniqueOption(opt)}
                            </button>
                          ))}
                        </div>
                      );
                      return (
                        <div className={cn("border-2 rounded-xl transition-all", active ? "border-primary" : "border-border")}>
                          <button type="button" onClick={() => toggleProcSection("osteotomia")}
                            className="w-full text-left p-4 flex items-center justify-between">
                            <div className="flex items-center gap-3">
                              {active && <CheckCircle2 className="h-5 w-5 text-primary shrink-0" />}
                              <p className={cn("font-semibold", active ? "text-primary" : "")}>{ttech("osteotomy")}</p>
                            </div>
                            <ChevronDown className={cn("h-4 w-4 shrink-0 transition-transform", active ? "rotate-180 text-primary" : "text-muted-foreground")} />
                          </button>
                          {active && (
                            <div className="px-4 pb-4 space-y-4 border-t pt-3">

                              {/* Tibial */}
                              <div className="space-y-3">
                                <OstBtn label="Tibial" field={osteotomia.tibial} stateKey="tibial" />
                                {osteotomia.tibial && (
                                  <div className="ml-4 space-y-3 border-l-2 border-primary/30 pl-4">
                                    <div>
                                      <Label className="text-xs text-muted-foreground mb-2 block">{ttech("side")}</Label>
                                      <OstPills field={osteotomia.tibialLado} options={["Medial", "Lateral"]} stateKey="tibialLado" />
                                    </div>
                                    <div>
                                      <Label className="text-xs text-muted-foreground mb-2 block">{ttech("type")}</Label>
                                      <OstPills field={osteotomia.tibialTipo} options={["Abertura", "Fechamento"]} stateKey="tibialTipo" />
                                    </div>
                                    <div>
                                      <Label className="text-xs text-muted-foreground mb-1 block">{ttech("correctionMm")}</Label>
                                      <Input
                                        type="number" min="0" max="30" step="0.5" placeholder="Ex: 8 mm"
                                        value={osteotomia.tibialAngulo}
                                        onChange={(e) => setOsteotomia((prev) => ({ ...prev, tibialAngulo: e.target.value }))}
                                        className="w-36"
                                      />
                                    </div>
                                  </div>
                                )}
                              </div>

                              {/* Femoral */}
                              <div className="space-y-3">
                                <OstBtn label="Femoral" field={osteotomia.femoral} stateKey="femoral" />
                                {osteotomia.femoral && (
                                  <div className="ml-4 space-y-3 border-l-2 border-primary/30 pl-4">
                                    <div>
                                      <Label className="text-xs text-muted-foreground mb-2 block">{ttech("side")}</Label>
                                      <OstPills field={osteotomia.femoralLado} options={["Medial", "Lateral"]} stateKey="femoralLado" />
                                    </div>
                                    <div>
                                      <Label className="text-xs text-muted-foreground mb-2 block">{ttech("type")}</Label>
                                      <OstPills field={osteotomia.femoralTipo} options={["Abertura", "Fechamento"]} stateKey="femoralTipo" />
                                    </div>
                                    <div>
                                      <Label className="text-xs text-muted-foreground mb-1 block">{ttech("correctionMm")}</Label>
                                      <Input
                                        type="number" min="0" max="40" step="0.5" placeholder="Ex: 7,6 mm"
                                        value={osteotomia.femoralAngulo}
                                        onChange={(e) => setOsteotomia((prev) => ({ ...prev, femoralAngulo: e.target.value }))}
                                        className="w-36"
                                      />
                                    </div>
                                  </div>
                                )}
                              </div>

                              {/* Dupla */}
                              <div className="space-y-3">
                                <OstBtn label="Dupla Osteotomia" field={osteotomia.dupla} stateKey="dupla" />
                                {osteotomia.dupla && (
                                  <div className="ml-4 space-y-4 border-l-2 border-primary/30 pl-4">
                                    <div className="space-y-3">
                                      <p className="text-xs font-bold text-primary uppercase tracking-wide">{ttech("tibialComponent")}</p>
                                      <div>
                                        <Label className="text-xs text-muted-foreground mb-2 block">{ttech("side")}</Label>
                                        <OstPills field={osteotomia.duplaTibialLado} options={["Medial", "Lateral"]} stateKey="duplaTibialLado" />
                                      </div>
                                      <div>
                                        <Label className="text-xs text-muted-foreground mb-2 block">{ttech("type")}</Label>
                                        <OstPills field={osteotomia.duplaTibialTipo} options={["Abertura", "Fechamento"]} stateKey="duplaTibialTipo" />
                                      </div>
                                      <div>
                                        <Label className="text-xs text-muted-foreground mb-1 block">{ttech("correctionMm")}</Label>
                                        <Input
                                          type="number" min="0" max="30" step="0.5" placeholder="Ex: 5 mm"
                                          value={osteotomia.duplaTibialAngulo}
                                          onChange={(e) => setOsteotomia((prev) => ({ ...prev, duplaTibialAngulo: e.target.value }))}
                                          className="w-36"
                                        />
                                      </div>
                                    </div>
                                    <div className="space-y-3">
                                      <p className="text-xs font-bold text-primary uppercase tracking-wide">{ttech("femoralComponent")}</p>
                                      <div>
                                        <Label className="text-xs text-muted-foreground mb-2 block">{ttech("side")}</Label>
                                        <OstPills field={osteotomia.duplaFemoralLado} options={["Medial", "Lateral"]} stateKey="duplaFemoralLado" />
                                      </div>
                                      <div>
                                        <Label className="text-xs text-muted-foreground mb-2 block">{ttech("type")}</Label>
                                        <OstPills field={osteotomia.duplaFemoralTipo} options={["Abertura", "Fechamento"]} stateKey="duplaFemoralTipo" />
                                      </div>
                                      <div>
                                        <Label className="text-xs text-muted-foreground mb-1 block">{ttech("correctionMm")}</Label>
                                        <Input
                                          type="number" min="0" max="40" step="0.5" placeholder="Ex: 3,8 mm"
                                          value={osteotomia.duplaFemoralAngulo}
                                          onChange={(e) => setOsteotomia((prev) => ({ ...prev, duplaFemoralAngulo: e.target.value }))}
                                          className="w-36"
                                        />
                                      </div>
                                    </div>
                                  </div>
                                )}
                              </div>

                              {/* SLOP */}
                              <div className="space-y-3">
                                <OstBtn label="Correção do SLOP Tibial" field={osteotomia.slop} stateKey="slop" />
                                {osteotomia.slop && (
                                  <div className="ml-4 border-l-2 border-primary/30 pl-4">
                                    <Label className="text-xs text-muted-foreground mb-1 block">{ttech("slopeCorrectionDegree")}</Label>
                                    <Input
                                      type="number" min="0" max="20" step="0.5" placeholder="Ex: 5"
                                      value={osteotomia.slopGrau}
                                      onChange={(e) => setOsteotomia((prev) => ({ ...prev, slopGrau: e.target.value }))}
                                      className="w-36"
                                    />
                                  </div>
                                )}
                              </div>

                              {/* Enxerto Ósseo Associado */}
                              <div className="space-y-3">
                                <OstBtn label="Enxerto Ósseo Associado" field={osteotomia.enxertoOsseo} stateKey="enxertoOsseo" />
                                {osteotomia.enxertoOsseo && (
                                  <div className="ml-4 border-l-2 border-primary/30 pl-4 space-y-2">
                                    <Label className="text-xs text-muted-foreground mb-2 block">{ttech("graftType")}</Label>
                                    <div className="flex flex-wrap gap-2">
                                      {[
                                        "Autoenxerto (Ilíaco)",
                                        "Autoenxerto (Local)",
                                        "Aloenxerto",
                                        "BMA (Aspirado de Medula Óssea)",
                                        "Substituto Sintético (Hidroxiapatita)",
                                      ].map((opt) => (
                                        <button key={opt} type="button"
                                          onClick={() => setOsteotomia((prev) => ({ ...prev, enxertoOsseoTipo: prev.enxertoOsseoTipo === opt ? "" : opt }))}
                                          className={cn("px-3 py-1.5 rounded-lg border-2 text-sm font-medium transition-all",
                                            osteotomia.enxertoOsseoTipo === opt
                                              ? "border-primary bg-primary/5 text-primary"
                                              : "border-border hover:border-primary/40")}>
                                           {osteotomia.enxertoOsseoTipo === opt && <CheckCircle2 className="inline h-3.5 w-3.5 mr-1.5" />}{displayTechniqueOption(opt)}
                                        </button>
                                      ))}
                                    </div>
                                  </div>
                                )}
                              </div>

                            </div>
                          )}
                        </div>
                      );
                    })()}

                    {/* ── 4. Ortobiológico ── */}
                    {isOrtobiologico && (() => {
                      const active = activeProcSections.has("ortobiologico");
                      return (
                        <div className={cn("border-2 rounded-xl transition-all", active ? "border-primary" : "border-border")}>
                          <button type="button" onClick={() => toggleProcSection("ortobiologico")}
                            className="w-full text-left p-4 flex items-center justify-between">
                            <div className="flex items-center gap-3">
                              {active && <CheckCircle2 className="h-5 w-5 text-primary shrink-0" />}
                              <p className={cn("font-semibold", active ? "text-primary" : "")}>{ttech("orthobiologic")}</p>
                            </div>
                            <ChevronDown className={cn("h-4 w-4 shrink-0 transition-transform", active ? "rotate-180 text-primary" : "text-muted-foreground")} />
                          </button>
                          {active && (
                            <div className="px-4 pb-4 space-y-4 border-t pt-3">
                              <div className="space-y-2">
                                <p className="text-xs text-muted-foreground">{ttech("selectOrthobiologics")}</p>
                                <div className="grid sm:grid-cols-2 gap-2">
                                  {([
                                    ["bma",                   "BMA — Aspirado de Medula Óssea"],
                                    ["ha",                    "Ácido Hialurônico"],
                                    ["prp",                   "PRP — Plasma Rico em Plaquetas"],
                                    ["hidrogel",              "Hidrogel"],
                                    ["gorduraMicroFragmentada","Gordura Micro Fragmentada"],
                                    ["svf",                   "SVF — Fração Vascular Estromal"],
                                    ["exossomos",             "Exossomos"],
                                  ] as [keyof typeof ortobiologico, string][]).map(([key, label]) => {
                                    const sel = ortobiologico[key as keyof typeof ortobiologico];
                                    return (
                                      <button key={key} type="button"
                                        onClick={() => setOrtobiologico((prev) => ({ ...prev, [key]: !prev[key as keyof typeof ortobiologico] }))}
                                        className={cn("text-sm text-left px-3 py-2 rounded-lg border-2 transition-all",
                                          sel ? "border-primary bg-primary/5 font-medium text-primary" : "border-border hover:border-primary/40")}>
                                        {sel && <CheckCircle2 className="inline h-3 w-3 mr-1" />}{displayTechniqueOption(label)}
                                      </button>
                                    );
                                  })}
                                </div>
                              </div>

                              {/* ── DocKnee Regenerativa entry ── */}
                              <a href="/regen" onClick={e => e.stopPropagation()} className="block">
                                <div className="rounded-xl p-3.5 flex items-center gap-3 hover:brightness-110 transition-all cursor-pointer"
                                  style={{ background: "linear-gradient(135deg, rgba(13,27,62,0.9) 0%, rgba(21,101,192,0.25) 100%)", border: "1px solid rgba(41,182,246,0.3)" }}>
                                  <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ background: "rgba(41,182,246,0.12)" }}>
                                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#29B6F6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                      <path d="M9 3H5a2 2 0 0 0-2 2v4m6-6h10a2 2 0 0 1 2 2v4M9 3v18m0 0h10a2 2 0 0 0 2-2V9M9 21H5a2 2 0 0 1-2-2V9m0 0h18"/>
                                    </svg>
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-1.5">
                                      <p className="text-sm font-semibold text-white">{ttech("regenerativeTitle")}</p>
                                      <span className="text-[9px] font-bold px-1.5 py-0.5 rounded tracking-wider" style={{ background: "rgba(41,182,246,0.2)", color: "#29B6F6" }}>{ttech("newBadge")}</span>
                                    </div>
                                    <p className="text-xs" style={{ color: "rgba(255,255,255,0.5)" }}>{ttech("regenerativeDescription")}</p>
                                  </div>
                                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
                                </div>
                              </a>

                            </div>
                          )}
                        </div>
                      );
                    })()}

                    {/* ── 5. Outros Procedimentos ── */}
                    {isOutrosProcedimentos && (() => {
                      const OUTROS_ITEMS = [
                        "Bloqueio de Nervos Geniculares",
                        "Rizotomia de Nervos Geniculares",
                        "Terapias de Onda de Choque",
                        "Laser de Alta Intensidade",
                      ];
                      const PROLOTERAPIA_OPCOES = [
                        { value: "Intra-articular", label: "Intra-articular (25%)" },
                        { value: "Peri-articular", label: "Peri-articular (12%)" },
                      ];
                      const setProloterapia = (opcao: { value: string; label: string }) => {
                        const label = `Proloterapia - ${opcao.label}`;
                        setOutrosProcedimentos((prev) =>
                          prev.includes(label) ? prev.filter((x) => x !== label) : [...prev, label]
                        );
                      };
                      return (
                        <div className="border-2 rounded-xl border-border">
                          <div className="p-4">
                            <p className="font-semibold mb-2">{ttech("otherProcedures")}</p>
                            <p className="text-xs text-muted-foreground mb-3">{ttech("selectApplicableProcedures")}</p>
                            <div className="grid sm:grid-cols-2 gap-2">
                              {OUTROS_ITEMS.map((item) => {
                                const sel = outrosProcedimentos.includes(item);
                                return (
                                  <button key={item} type="button"
                                    onClick={() => setOutrosProcedimentos((prev) =>
                                      prev.includes(item) ? prev.filter((x) => x !== item) : [...prev, item]
                                    )}
                                    className={cn("text-sm text-left px-3 py-2 rounded-lg border-2 transition-all",
                                      sel ? "border-primary bg-primary/5 font-medium text-primary" : "border-border hover:border-primary/40")}>
                                    {sel && <CheckCircle2 className="inline h-3 w-3 mr-1" />}{displayTechniqueOption(item)}
                                  </button>
                                );
                              })}
                            </div>

                            <div className="mt-3 pt-3 border-t border-border/40">
                              <p className="text-sm font-medium mb-2">{ttech("prolotherapy")}</p>
                              <div className="flex flex-wrap gap-2">
                                {PROLOTERAPIA_OPCOES.map((opt) => {
                                  const sel = outrosProcedimentos.includes(`Proloterapia - ${opt.label}`);
                                  return (
                                    <button key={opt.value} type="button"
                                      onClick={() => setProloterapia(opt)}
                                      className={cn("text-sm px-3 py-2 rounded-lg border-2 transition-all",
                                        sel ? "border-primary bg-primary/5 font-medium text-primary" : "border-border hover:border-primary/40")}>
                                      {sel && <CheckCircle2 className="inline h-3 w-3 mr-1" />}{displayTechniqueOption(opt.label)}
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })()}

                    {/* ── 6. Fraturas ── */}
                    {isFraturas && (() => {
                      return (
                        <div className="border-2 rounded-xl border-border">
                          <div className="p-4">
                            <p className="font-semibold mb-2">{tt("fractures")}</p>
                            <p className="text-xs text-muted-foreground mb-3">{tt("selectFractures")}</p>
                            <div className="grid sm:grid-cols-2 gap-2">
                              {FRATURAS_ITEMS.map((item) => {
                                const sel = fraturas.includes(item);
                                return (
                                  <button key={item} type="button"
                                    onClick={() => setFraturas((prev) =>
                                      prev.includes(item) ? prev.filter((x) => x !== item) : [...prev, item]
                                    )}
                                    className={cn("text-sm text-left px-3 py-2 rounded-lg border-2 transition-all",
                                      sel ? "border-primary bg-primary/5 font-medium text-primary" : "border-border hover:border-primary/40")}>
                                    {sel && <CheckCircle2 className="inline h-3 w-3 mr-1" />}{traumaOption(item)}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        </div>
                      );
                    })()}

                    {/* ── 7. Rupturas Tendíneas ── */}
                    {isTendoes && (() => {
                      return (
                        <div className="border-2 rounded-xl border-border">
                          <div className="p-4">
                            <p className="font-semibold mb-2">{tt("tendonRuptures")}</p>
                            <p className="text-xs text-muted-foreground mb-3">{tt("selectTendonRuptures")}</p>
                            <div className="grid sm:grid-cols-2 gap-2">
                              {TENDOES_ITEMS.map((item) => {
                                const sel = tendoes.includes(item);
                                return (
                                  <button key={item} type="button"
                                    onClick={() => setTendoes((prev) =>
                                      prev.includes(item) ? prev.filter((x) => x !== item) : [...prev, item]
                                    )}
                                    className={cn("text-sm text-left px-3 py-2 rounded-lg border-2 transition-all",
                                      sel ? "border-primary bg-primary/5 font-medium text-primary" : "border-border hover:border-primary/40")}>
                                    {sel && <CheckCircle2 className="inline h-3 w-3 mr-1" />}{traumaOption(item)}
                                  </button>
                                );
                              })}
                            </div>
                            {/* Procedimentos associados */}
                            <div className="mt-4 pt-4 border-t border-border">
                              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">{tt("associatedProcedures")}</p>
                              <div className="grid sm:grid-cols-2 gap-2">
                                {(["Lesão Meniscal", "Osteotomia"] as const).map((proc) => {
                                  const sel = tiposSelected.includes(proc);
                                  return (
                                    <button key={proc} type="button"
                                      onClick={() => toggleTipoCaso(proc)}
                                      className={cn("text-sm text-left px-3 py-2 rounded-lg border-2 transition-all",
                                        sel ? "border-primary bg-primary/5 font-medium text-primary" : "border-border hover:border-primary/40")}>
                                      {sel && <CheckCircle2 className="inline h-3 w-3 mr-1" />}
                                      {proc === "Lesão Meniscal" ? tt("meniscalRepair") : traumaOption(proc)}
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })()}

                    {/* ── Ruptura do Tendão Patelar (detalhamento) ── */}
                    {tendoes.includes("Ruptura do Tendão Patelar") && (() => {
                      const pp = patelarTendon;
                      const set = (patch: Partial<typeof patelarTendon>) => setPatelarTendon((prev) => ({ ...prev, ...patch }));
                      const toggleArr = (field: "cirurgia" | "reforcoTipo" | "reforcoTendao", val: string) => {
                        const cur = pp[field] as string[];
                        set({ [field]: cur.includes(val) ? cur.filter((x) => x !== val) : [...cur, val] } as any);
                      };
                      const CIRURGIA_OPTS = ["Sutura trans óssea", "Âncoras de sutura", "Sutura primária"];
                      const REFORCO_TIPO_OPTS = ["Tendão", "Fibertape", "Fio de Cerclagem"];
                      const REFORCO_TENDAO_OPTS = ["Reto femoral", "Semitendinoso", "Grácil", "Outro"];
                      return (
                        <div className="border-2 border-amber-400/60 rounded-xl">
                          <div className="p-4 bg-amber-50/50 dark:bg-amber-950/20 rounded-t-xl border-b border-amber-200/50">
                            <p className="font-bold text-amber-800 dark:text-amber-300">{tt("patellarTendonRupture")}</p>
                            <p className="text-xs text-amber-600 dark:text-amber-400 mt-0.5">{tt("completeRuptureData")}</p>
                          </div>
                          <div className="p-4 space-y-5">
                            {/* Localização */}
                            <div className="space-y-2">
                              <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{tt("ruptureLocation")}</Label>
                              <div className="flex flex-wrap gap-2">
                                {["Avulsão na Patela", "Trans Tendão", "Avulsão na TAT"].map((opt) => (
                                  <button key={opt} type="button"
                                    onClick={() => set({ classificacao: pp.classificacao === opt ? "" : opt })}
                                    className={cn("px-3 py-1.5 rounded-lg border-2 text-sm font-medium transition-all",
                                      pp.classificacao === opt ? "border-amber-500 bg-amber-50 dark:bg-amber-950/30 text-amber-800 dark:text-amber-300" : "border-border hover:border-amber-400/60")}>
                                    {pp.classificacao === opt && <CheckCircle2 className="inline h-3.5 w-3.5 mr-1.5 text-amber-600" />}{traumaOption(opt)}
                                  </button>
                                ))}
                              </div>
                            </div>
                            {/* Datas */}
                            <div className="grid sm:grid-cols-2 gap-4">
                              <div className="space-y-2">
                                <Label className="text-xs">{tt("injuryDate")}</Label>
                                <Input type="date" value={pp.dataLesao} onChange={(e) => set({ dataLesao: e.target.value })} />
                              </div>
                              <div className="space-y-2">
                                <Label className="text-xs">{tt("definitiveSurgeryDate")}</Label>
                                <Input type="date" value={pp.dataCirurgiaDefinitiva} onChange={(e) => set({ dataCirurgiaDefinitiva: e.target.value })} />
                              </div>
                            </div>
                            {/* Técnica cirúrgica */}
                            <div className="space-y-2">
                              <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{tt("surgicalTechniqueMultiple")}</Label>
                              <div className="flex flex-wrap gap-2">
                                {CIRURGIA_OPTS.map((opt) => (
                                  <button key={opt} type="button"
                                    onClick={() => toggleArr("cirurgia", opt)}
                                    className={cn("px-3 py-1.5 rounded-lg border-2 text-sm font-medium transition-all",
                                      pp.cirurgia.includes(opt) ? "border-primary bg-primary/5 text-primary" : "border-border hover:border-primary/40")}>
                                    {pp.cirurgia.includes(opt) && <CheckCircle2 className="inline h-3.5 w-3.5 mr-1.5" />}{traumaOption(opt)}
                                  </button>
                                ))}
                              </div>
                              <Input placeholder={tt("otherSpecify")} value={pp.cirurgiaOutro} onChange={(e) => set({ cirurgiaOutro: e.target.value })} />
                            </div>
                            {/* Reforço biológico */}
                            <div className="space-y-3 border rounded-xl p-4 bg-muted/20">
                              <div className="flex items-center gap-3">
                                <Switch checked={pp.reforco} onCheckedChange={(c) => set({ reforco: c })} />
                                <Label className="text-sm font-medium">{tt("biologicalReinforcement")}</Label>
                              </div>
                              {pp.reforco && (
                                <div className="space-y-4 pt-1">
                                  <div className="space-y-2">
                                    <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{tt("reinforcementType")}</Label>
                                    <div className="flex flex-wrap gap-2">
                                      {REFORCO_TIPO_OPTS.map((opt) => (
                                        <button key={opt} type="button"
                                          onClick={() => toggleArr("reforcoTipo", opt)}
                                          className={cn("px-3 py-1.5 rounded-lg border-2 text-sm font-medium transition-all",
                                            pp.reforcoTipo.includes(opt) ? "border-primary bg-primary/5 text-primary" : "border-border hover:border-primary/40")}>
                                          {pp.reforcoTipo.includes(opt) && <CheckCircle2 className="inline h-3.5 w-3.5 mr-1.5" />}{traumaOption(opt)}
                                        </button>
                                      ))}
                                    </div>
                                  </div>
                                  {pp.reforcoTipo.includes("Tendão") && (
                                    <div className="space-y-2">
                                      <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{tt("tendonUsed")}</Label>
                                      <div className="flex flex-wrap gap-2">
                                        {REFORCO_TENDAO_OPTS.map((opt) => (
                                          <button key={opt} type="button"
                                            onClick={() => toggleArr("reforcoTendao", opt)}
                                            className={cn("px-3 py-1.5 rounded-lg border-2 text-sm font-medium transition-all",
                                              pp.reforcoTendao.includes(opt) ? "border-primary bg-primary/5 text-primary" : "border-border hover:border-primary/40")}>
                                            {pp.reforcoTendao.includes(opt) && <CheckCircle2 className="inline h-3.5 w-3.5 mr-1.5" />}{traumaOption(opt)}
                                          </button>
                                        ))}
                                      </div>
                                      {pp.reforcoTendao.includes("Outro") && (
                                        <Input placeholder={tt("specifyTendon")} value={pp.reforcoTendaoOutro} onChange={(e) => set({ reforcoTendaoOutro: e.target.value })} />
                                      )}
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                            {/* Imagens */}
                            <div className="space-y-2">
                              <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{tt("images")}</Label>
                              <div className="flex flex-wrap gap-2">
                                {pp.imageUrls.map((url, i) => (
                                  <div key={i} className="relative group">
                                    <img src={url} alt={`img-${i}`} className="w-16 h-16 object-cover rounded-lg border" />
                                    <button type="button"
                                      onClick={() => set({ imageUrls: pp.imageUrls.filter((_, idx) => idx !== i) })}
                                      className="absolute -top-1 -right-1 bg-destructive text-destructive-foreground rounded-full w-4 h-4 text-xs flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">×</button>
                                  </div>
                                ))}
                                <label className="w-16 h-16 border-2 border-dashed border-muted-foreground/30 rounded-lg flex flex-col items-center justify-center cursor-pointer hover:border-primary/50 transition-colors">
                                  <span className="text-xl text-muted-foreground leading-none">+</span>
                                  <span className="text-[9px] text-muted-foreground mt-0.5">{tt("photo")}</span>
                                  <input type="file" accept="image/*" multiple className="hidden"
                                    onChange={(e) => {
                                      const files = Array.from(e.target.files || []);
                                      files.forEach((file) => {
                                        const reader = new FileReader();
                                        reader.onload = (ev) => {
                                          const url = ev.target?.result as string;
                                          if (url) setPatelarTendon((prev) => ({ ...prev, imageUrls: [...prev.imageUrls, url] }));
                                        };
                                        reader.readAsDataURL(file);
                                      });
                                      e.target.value = "";
                                    }}
                                  />
                                </label>
                              </div>
                            </div>
                            {/* Observações */}
                            <div className="space-y-2">
                              <Label className="text-xs">{tt("observations")}</Label>
                              <Textarea rows={3} placeholder={tt("additionalObservations")} value={pp.observacoes} onChange={(e) => set({ observacoes: e.target.value })} />
                            </div>
                          </div>
                        </div>
                      );
                    })()}

                    {/* ── Ruptura do Tendão Quadríceps (detalhamento) ── */}
                    {tendoes.includes("Ruptura do Tendão Quadríceps") && (() => {
                      const qq = quadricepsTendon;
                      const set = (patch: Partial<typeof quadricepsTendon>) => setQuadricepsTendon((prev) => ({ ...prev, ...patch }));
                      const toggleArr = (field: "cirurgia" | "reforcoTipo" | "reforcoTendao", val: string) => {
                        const cur = qq[field] as string[];
                        set({ [field]: cur.includes(val) ? cur.filter((x) => x !== val) : [...cur, val] } as any);
                      };
                      const CIRURGIA_OPTS = ["Sutura trans óssea", "Âncoras de sutura", "Sutura primária"];
                      const REFORCO_TIPO_OPTS = ["Tendão", "Fibertape", "Fio de Cerclagem"];
                      const REFORCO_TENDAO_OPTS = ["Reto femoral", "Semitendinoso", "Grácil", "Outro"];
                      return (
                        <div className="border-2 border-indigo-400/60 rounded-xl">
                          <div className="p-4 bg-indigo-50/50 dark:bg-indigo-950/20 rounded-t-xl border-b border-indigo-200/50">
                            <p className="font-bold text-indigo-800 dark:text-indigo-300">{tt("quadricepsTendonRupture")}</p>
                            <p className="text-xs text-indigo-600 dark:text-indigo-400 mt-0.5">{tt("completeRuptureData")}</p>
                          </div>
                          <div className="p-4 space-y-5">
                            {/* Classificação */}
                            <div className="space-y-2">
                              <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{tt("ruptureLocation")}</Label>
                              <div className="flex flex-wrap gap-2">
                                {["Avulsão da Patela", "Trans Tendão"].map((opt) => (
                                  <button key={opt} type="button"
                                    onClick={() => set({ classificacao: qq.classificacao === opt ? "" : opt })}
                                    className={cn("px-3 py-1.5 rounded-lg border-2 text-sm font-medium transition-all",
                                      qq.classificacao === opt ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-950/30 text-indigo-800 dark:text-indigo-300" : "border-border hover:border-indigo-400/60")}>
                                    {qq.classificacao === opt && <CheckCircle2 className="inline h-3.5 w-3.5 mr-1.5 text-indigo-600" />}{traumaOption(opt)}
                                  </button>
                                ))}
                              </div>
                            </div>
                            {/* Datas */}
                            <div className="grid sm:grid-cols-2 gap-4">
                              <div className="space-y-2">
                                <Label className="text-xs">{tt("injuryDate")}</Label>
                                <Input type="date" value={qq.dataLesao} onChange={(e) => set({ dataLesao: e.target.value })} />
                              </div>
                              <div className="space-y-2">
                                <Label className="text-xs">{tt("definitiveSurgeryDate")}</Label>
                                <Input type="date" value={qq.dataCirurgiaDefinitiva} onChange={(e) => set({ dataCirurgiaDefinitiva: e.target.value })} />
                              </div>
                            </div>
                            {/* Técnica cirúrgica */}
                            <div className="space-y-2">
                              <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{tt("surgicalTechniqueMultiple")}</Label>
                              <div className="flex flex-wrap gap-2">
                                {CIRURGIA_OPTS.map((opt) => (
                                  <button key={opt} type="button"
                                    onClick={() => toggleArr("cirurgia", opt)}
                                    className={cn("px-3 py-1.5 rounded-lg border-2 text-sm font-medium transition-all",
                                      qq.cirurgia.includes(opt) ? "border-primary bg-primary/5 text-primary" : "border-border hover:border-primary/40")}>
                                    {qq.cirurgia.includes(opt) && <CheckCircle2 className="inline h-3.5 w-3.5 mr-1.5" />}{traumaOption(opt)}
                                  </button>
                                ))}
                              </div>
                              <Input placeholder={tt("otherSpecify")} value={qq.cirurgiaOutro} onChange={(e) => set({ cirurgiaOutro: e.target.value })} />
                            </div>
                            {/* Reforço biológico */}
                            <div className="space-y-3 border rounded-xl p-4 bg-muted/20">
                              <div className="flex items-center gap-3">
                                <Switch checked={qq.reforco} onCheckedChange={(c) => set({ reforco: c })} />
                                <Label className="text-sm font-medium">{tt("biologicalReinforcement")}</Label>
                              </div>
                              {qq.reforco && (
                                <div className="space-y-4 pt-1">
                                  <div className="space-y-2">
                                    <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{tt("reinforcementType")}</Label>
                                    <div className="flex flex-wrap gap-2">
                                      {REFORCO_TIPO_OPTS.map((opt) => (
                                        <button key={opt} type="button"
                                          onClick={() => toggleArr("reforcoTipo", opt)}
                                          className={cn("px-3 py-1.5 rounded-lg border-2 text-sm font-medium transition-all",
                                            qq.reforcoTipo.includes(opt) ? "border-primary bg-primary/5 text-primary" : "border-border hover:border-primary/40")}>
                                          {qq.reforcoTipo.includes(opt) && <CheckCircle2 className="inline h-3.5 w-3.5 mr-1.5" />}{traumaOption(opt)}
                                        </button>
                                      ))}
                                    </div>
                                  </div>
                                  {qq.reforcoTipo.includes("Tendão") && (
                                    <div className="space-y-2">
                                      <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{tt("tendonUsed")}</Label>
                                      <div className="flex flex-wrap gap-2">
                                        {REFORCO_TENDAO_OPTS.map((opt) => (
                                          <button key={opt} type="button"
                                            onClick={() => toggleArr("reforcoTendao", opt)}
                                            className={cn("px-3 py-1.5 rounded-lg border-2 text-sm font-medium transition-all",
                                              qq.reforcoTendao.includes(opt) ? "border-primary bg-primary/5 text-primary" : "border-border hover:border-primary/40")}>
                                            {qq.reforcoTendao.includes(opt) && <CheckCircle2 className="inline h-3.5 w-3.5 mr-1.5" />}{traumaOption(opt)}
                                          </button>
                                        ))}
                                      </div>
                                      {qq.reforcoTendao.includes("Outro") && (
                                        <Input placeholder={tt("specifyTendon")} value={qq.reforcoTendaoOutro} onChange={(e) => set({ reforcoTendaoOutro: e.target.value })} />
                                      )}
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                            {/* Imagens */}
                            <div className="space-y-2">
                              <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{tt("images")}</Label>
                              <div className="flex flex-wrap gap-2">
                                {qq.imageUrls.map((url, i) => (
                                  <div key={i} className="relative group">
                                    <img src={url} alt={`img-${i}`} className="w-16 h-16 object-cover rounded-lg border" />
                                    <button type="button"
                                      onClick={() => set({ imageUrls: qq.imageUrls.filter((_, idx) => idx !== i) })}
                                      className="absolute -top-1 -right-1 bg-destructive text-destructive-foreground rounded-full w-4 h-4 text-xs flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">×</button>
                                  </div>
                                ))}
                                <label className="w-16 h-16 border-2 border-dashed border-muted-foreground/30 rounded-lg flex flex-col items-center justify-center cursor-pointer hover:border-primary/50 transition-colors">
                                  <span className="text-xl text-muted-foreground leading-none">+</span>
                                  <span className="text-[9px] text-muted-foreground mt-0.5">{tt("photo")}</span>
                                  <input type="file" accept="image/*" multiple className="hidden"
                                    onChange={(e) => {
                                      const files = Array.from(e.target.files || []);
                                      files.forEach((file) => {
                                        const reader = new FileReader();
                                        reader.onload = (ev) => {
                                          const url = ev.target?.result as string;
                                          if (url) setQuadricepsTendon((prev) => ({ ...prev, imageUrls: [...prev.imageUrls, url] }));
                                        };
                                        reader.readAsDataURL(file);
                                      });
                                      e.target.value = "";
                                    }}
                                  />
                                </label>
                              </div>
                            </div>
                            {/* Observações */}
                            <div className="space-y-2">
                              <Label className="text-xs">{tt("observations")}</Label>
                              <Textarea rows={3} placeholder={tt("additionalObservations")} value={qq.observacoes} onChange={(e) => set({ observacoes: e.target.value })} />
                            </div>
                          </div>
                        </div>
                      );
                    })()}

                    {/* ── Fratura Periprotética (detalhamento) ── */}
                    {fraturas.includes("Fratura Periprotética") && (() => {
                      const pp = periprosthetic;
                      const set = (patch: Partial<typeof periprosthetic>) => setPeriprosthetic((prev) => ({ ...prev, ...patch }));
                      const toggleArr = (field: "controleDanosIndicacao" | "controleDanosProcedimento" | "acessoFemur" | "acessoTibia" | "cirurgia", val: string) => {
                        const cur = pp[field] as string[];
                        set({ [field]: cur.includes(val) ? cur.filter((x) => x !== val) : [...cur, val] } as any);
                      };

                      return (
                        <div className="border-2 border-primary/30 rounded-xl p-4 bg-primary/5 space-y-6">
                          <p className="font-semibold text-primary text-sm">{tt("periprostheticDetails")}</p>

                          {/* 1. Classificação */}
                          <div className="space-y-3">
                            <p className="text-sm font-medium">{tt("classification")}</p>
                            <div className="grid sm:grid-cols-3 gap-3">
                              <div className="space-y-1">
                                <Label className="text-xs">{tt("femurClassification")}</Label>
                                <Select value={pp.classificacaoFemur || "__none__"} onValueChange={(v) => set({ classificacaoFemur: v === "__none__" ? "" : v })}>
                                  <SelectTrigger><SelectValue placeholder={tt("select")} /></SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="__none__">{tt("select")}</SelectItem>
                                    <SelectItem value="I">{tt("rorabeckI")}</SelectItem>
                                    <SelectItem value="II">{tt("rorabeckII")}</SelectItem>
                                    <SelectItem value="III">{tt("rorabeckIII")}</SelectItem>
                                  </SelectContent>
                                </Select>
                              </div>
                              <div className="space-y-1">
                                <Label className="text-xs">{tt("tibiaClassification")}</Label>
                                <Select value={pp.classificacaoTibia || "__none__"} onValueChange={(v) => set({ classificacaoTibia: v === "__none__" ? "" : v })}>
                                  <SelectTrigger><SelectValue placeholder={tt("select")} /></SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="__none__">{tt("select")}</SelectItem>
                                    <SelectItem value="I">{tt("felixI")}</SelectItem>
                                    <SelectItem value="II">{tt("felixII")}</SelectItem>
                                    <SelectItem value="III">{tt("felixIII")}</SelectItem>
                                    <SelectItem value="IV">{tt("felixIV")}</SelectItem>
                                  </SelectContent>
                                </Select>
                              </div>
                              <div className="space-y-1">
                                <Label className="text-xs">{tt("patellaClassification")}</Label>
                                <Select value={pp.classificacaoPatela || "__none__"} onValueChange={(v) => set({ classificacaoPatela: v === "__none__" ? "" : v })}>
                                  <SelectTrigger><SelectValue placeholder={tt("select")} /></SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="__none__">{tt("select")}</SelectItem>
                                    <SelectItem value="I">{tt("ortigueraI")}</SelectItem>
                                    <SelectItem value="II">{tt("ortigueraII")}</SelectItem>
                                    <SelectItem value="IIIa">{tt("ortigueraIIIa")}</SelectItem>
                                    <SelectItem value="IIIb">{tt("ortigueraIIIb")}</SelectItem>
                                  </SelectContent>
                                </Select>
                              </div>
                            </div>
                            {(pp.classificacaoPatela === "IIIa" || pp.classificacaoPatela === "IIIb") && (
                              <div className="space-y-1 max-w-xs">
                                <Label className="text-xs">{tt("remainingPatellarBone")} <span className="text-destructive">*</span></Label>
                                <Input type="number" step="0.1" value={pp.estoquePatelarMm} onChange={(e) => set({ estoquePatelarMm: e.target.value })} placeholder={tt("requiredField")} />
                              </div>
                            )}
                          </div>

                          {/* 2. Controle de danos */}
                          <div className="space-y-3 pt-3 border-t border-border/40">
                            <div className="flex items-center justify-between">
                              <p className="text-sm font-medium">{tt("damageControlStaged")}</p>
                              <Switch checked={pp.controleDanos} onCheckedChange={(c) => set({ controleDanos: c })} />
                            </div>
                            {pp.controleDanos && (
                              <div className="space-y-3 pl-1">
                                <div className="space-y-1 max-w-xs">
                                  <Label className="text-xs">{tt("damageControlSurgeryDate")}</Label>
                                  <Input type="date" value={pp.controleDanosData} onChange={(e) => set({ controleDanosData: e.target.value })} />
                                </div>
                                <div className="space-y-1">
                                  <Label className="text-xs">{tt("indication")}</Label>
                                  <div className="flex flex-wrap gap-2">
                                    {["Instabilidade hemodinâmica", "Contaminação/infecção", "Perda óssea extensa", "Lesão de partes moles grave", "Outro"].map((opt) => {
                                      const sel = pp.controleDanosIndicacao.includes(opt);
                                      return (
                                        <button key={opt} type="button" onClick={() => toggleArr("controleDanosIndicacao", opt)}
                                          className={cn("text-xs px-2.5 py-1.5 rounded-lg border-2", sel ? "border-primary bg-primary/10 text-primary font-medium" : "border-border")}>
                                          {sel && <CheckCircle2 className="inline h-3 w-3 mr-1" />}{traumaOption(opt)}
                                        </button>
                                      );
                                    })}
                                  </div>
                                  {pp.controleDanosIndicacao.includes("Outro") && (
                                    <Input className="mt-2" value={pp.controleDanosIndicacaoOutro} onChange={(e) => set({ controleDanosIndicacaoOutro: e.target.value })} placeholder={tt("describeIndication")} />
                                  )}
                                </div>
                                <div className="space-y-1">
                                  <Label className="text-xs">{tt("stageOneProcedure")}</Label>
                                  <div className="flex flex-wrap gap-2">
                                    {["Fixação externa", "Desbridamento", "Espaçador com cimento", "Redução provisória", "Outro"].map((opt) => {
                                      const sel = pp.controleDanosProcedimento.includes(opt);
                                      return (
                                        <button key={opt} type="button" onClick={() => toggleArr("controleDanosProcedimento", opt)}
                                          className={cn("text-xs px-2.5 py-1.5 rounded-lg border-2", sel ? "border-primary bg-primary/10 text-primary font-medium" : "border-border")}>
                                          {sel && <CheckCircle2 className="inline h-3 w-3 mr-1" />}{traumaOption(opt)}
                                        </button>
                                      );
                                    })}
                                  </div>
                                  {pp.controleDanosProcedimento.includes("Outro") && (
                                    <Input className="mt-2" value={pp.controleDanosProcedimentoOutro} onChange={(e) => set({ controleDanosProcedimentoOutro: e.target.value })} placeholder={tt("describeProcedure")} />
                                  )}
                                </div>
                                <div className="space-y-1 max-w-xs">
                                  <Label className="text-xs">{tt("definitiveSurgeryDate")}</Label>
                                  <Input type="date" value={pp.definitivaData} onChange={(e) => set({ definitivaData: e.target.value })} />
                                </div>
                              </div>
                            )}
                          </div>

                          {/* 3. Acesso cirúrgico */}
                          <div className="space-y-3 pt-3 border-t border-border/40">
                            <p className="text-sm font-medium">{tt("surgicalApproach")}</p>
                            <div className="space-y-1">
                              <Label className="text-xs">{tt("femurApproach")}</Label>
                              <div className="flex flex-wrap gap-2">
                                {["Parapatelar medial", "Lateral", "Ampliação da via prévia", "Outro"].map((opt) => {
                                  const sel = pp.acessoFemur.includes(opt);
                                  return (
                                    <button key={opt} type="button" onClick={() => toggleArr("acessoFemur", opt)}
                                      className={cn("text-xs px-2.5 py-1.5 rounded-lg border-2", sel ? "border-primary bg-primary/10 text-primary font-medium" : "border-border")}>
                                      {sel && <CheckCircle2 className="inline h-3 w-3 mr-1" />}{traumaOption(opt)}
                                    </button>
                                  );
                                })}
                              </div>
                              {pp.acessoFemur.includes("Outro") && (
                                <Input className="mt-2" value={pp.acessoFemurOutro} onChange={(e) => set({ acessoFemurOutro: e.target.value })} placeholder={tt("describeApproach")} />
                              )}
                            </div>
                            <div className="flex items-center justify-between">
                              <Label className="text-xs">{tt("approachExtension")}</Label>
                              <Switch checked={pp.extensaoAbordagem} onCheckedChange={(c) => set({ extensaoAbordagem: c })} />
                            </div>
                            {pp.extensaoAbordagem && (
                              <div className="grid sm:grid-cols-2 gap-2">
                                <Input placeholder={tt("extensionType")} value={pp.extensaoAbordagemTipo} onChange={(e) => set({ extensaoAbordagemTipo: e.target.value })} />
                                <Input placeholder={tt("otherIfApplicable")} value={pp.extensaoAbordagemOutro} onChange={(e) => set({ extensaoAbordagemOutro: e.target.value })} />
                              </div>
                            )}
                            <div className="space-y-1">
                              <Label className="text-xs">{tt("tibiaApproach")}</Label>
                              <div className="flex flex-wrap gap-2">
                                {["Anterior padrão", "Ampliação da via prévia", "Outro"].map((opt) => {
                                  const sel = pp.acessoTibia.includes(opt);
                                  return (
                                    <button key={opt} type="button" onClick={() => toggleArr("acessoTibia", opt)}
                                      className={cn("text-xs px-2.5 py-1.5 rounded-lg border-2", sel ? "border-primary bg-primary/10 text-primary font-medium" : "border-border")}>
                                      {sel && <CheckCircle2 className="inline h-3 w-3 mr-1" />}{traumaOption(opt)}
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          </div>

                          {/* 4. Cirurgia / Materiais */}
                          <div className="space-y-3 pt-3 border-t border-border/40">
                            <p className="text-sm font-medium">{tt("surgeryMaterials")}</p>
                            {[
                              {
                                grupo: "ENDOPRÓTESE",
                                itens: ["Prótese/Implante", "Componente femoral revisão", "Haste femoral longa", "Componente tibial revisão", "Haste tibial longa", "Componente patelar"],
                              },
                              {
                                grupo: "OSTEOSSÍNTESE",
                                itens: ["Placa bloqueada periarticular", "Haste intramedular retrógrada", "Haste intramedular anterógrada", "Fios/cerclage", "Parafusos bloqueados"],
                              },
                              {
                                grupo: "ENXERTO ÓSSEO",
                                itens: ["Enxerto ósseo autólogo (crista/tíbia)", "Substituto ósseo sintético"],
                              },
                            ].map(({ grupo, itens }) => (
                              <div key={grupo} className="space-y-1.5">
                                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{traumaOption(grupo)}</p>
                                <div className="flex flex-wrap gap-2">
                                  {itens.map((opt) => {
                                    const sel = pp.cirurgia.includes(opt);
                                    return (
                                      <button key={opt} type="button" onClick={() => toggleArr("cirurgia", opt)}
                                        className={cn("text-xs px-2.5 py-1.5 rounded-lg border-2", sel ? "border-primary bg-primary/10 text-primary font-medium" : "border-border")}>
                                        {sel && <CheckCircle2 className="inline h-3 w-3 mr-1" />}{traumaOption(opt)}
                                      </button>
                                    );
                                  })}
                                </div>
                              </div>
                            ))}
                            <div className="space-y-1">
                              <Label className="text-xs">{tt("otherMaterial")}</Label>
                              <Input value={pp.cirurgiaOutro} onChange={(e) => set({ cirurgiaOutro: e.target.value })} placeholder={tt("describeOtherMaterial")} />
                            </div>
                          </div>

                          {/* Observações */}
                          <div className="space-y-1 pt-3 border-t border-border/40">
                            <Label className="text-xs">{tt("observations")}</Label>
                            <Textarea value={pp.observacoes} onChange={(e) => set({ observacoes: e.target.value })} rows={3} />
                          </div>
                        </div>
                      );
                    })()}

                    {/* ── Fratura do Fêmur Distal (detalhamento) ── */}
                    {fraturas.includes("Fratura do Fêmur Distal") && (() => {
                      const df = distalFemur;
                      const set = (patch: Partial<typeof distalFemur>) => setDistalFemur((prev) => ({ ...prev, ...patch }));
                      const toggleArr = (field: "acesso" | "cirurgia" | "lesoesAssociadas", val: string) => {
                        const cur = df[field] as string[];
                        set({ [field]: cur.includes(val) ? cur.filter((x) => x !== val) : [...cur, val] } as any);
                      };

                      return (
                        <div className="border-2 border-primary/30 rounded-xl p-4 bg-primary/5 space-y-6">
                          <p className="font-semibold text-primary text-sm">{tt("distalFemurDetails")}</p>

                          {/* 1. Classificação */}
                          <div className="space-y-3">
                            <p className="text-sm font-medium">{tt("ao33Classification")}</p>
                            <div className="grid sm:grid-cols-2 gap-3">
                              <div className="space-y-1">
                                <Label className="text-xs">{tt("type")}</Label>
                                <Select value={df.classificacaoAoOta || ""} onValueChange={(v) => set({ classificacaoAoOta: v })}>
                                  <SelectTrigger className="sm:w-72"><SelectValue placeholder={tt("select")} /></SelectTrigger>
                                  <SelectContent>
                                    {DISTAL_FEMUR_AO_OTA.map(({ value, label }) => (
                                      <SelectItem key={value} value={value}>{value} — {traumaOption(label.split(" — ")[1] ?? label)}</SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </div>
                              <div className="space-y-1">
                                <Label className="text-xs">{tt("subtype")}</Label>
                                <Select value={df.classificacaoSubtipo || ""} onValueChange={(v) => set({ classificacaoSubtipo: v })}>
                                  <SelectTrigger><SelectValue placeholder={tt("select")} /></SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="1">1 — {traumaOption("Simples (2 fragmentos)")}</SelectItem>
                                    <SelectItem value="2">2 — {traumaOption("Cunha / bifocal")}</SelectItem>
                                    <SelectItem value="3">3 — {traumaOption("Cominutivo (multifragmentário)")}</SelectItem>
                                  </SelectContent>
                                </Select>
                              </div>
                            </div>
                          </div>

                          {/* 2. Datas / Controle de danos */}
                          <div className="space-y-3">
                            <p className="text-sm font-medium">{tt("datesDamageControl")}</p>
                            <div className="grid sm:grid-cols-2 gap-3">
                              <div className="space-y-1">
                                <Label className="text-xs">{tt("injuryDate")}</Label>
                                <Input type="date" value={df.dataLesao} onChange={(e) => set({ dataLesao: e.target.value })} />
                              </div>
                              <div className="space-y-1">
                                <Label className="text-xs">{tt("definitiveSurgeryDate")}</Label>
                                <Input type="date" value={df.dataCirurgiaDefinitiva} onChange={(e) => set({ dataCirurgiaDefinitiva: e.target.value })} />
                              </div>
                            </div>
                            <label className="flex items-center gap-2 text-sm">
                              <Checkbox checked={df.controleDanos} onCheckedChange={(c) => set({ controleDanos: !!c })} />
                              {tt("damageControlOccurred")}
                            </label>
                            {df.controleDanos && (
                              <div className="space-y-1 sm:w-64">
                                <Label className="text-xs">{tt("damageControlDate")}</Label>
                                <Input type="date" value={df.controleDanosData} onChange={(e) => set({ controleDanosData: e.target.value })} />
                              </div>
                            )}
                          </div>

                          {/* 3. Acesso cirúrgico */}
                          <div className="space-y-2">
                            <p className="text-sm font-medium">{tt("surgicalApproach")}</p>
                            <div className="flex flex-wrap gap-2">
                              {DISTAL_FEMUR_ACESSO.map((opt) => {
                                const sel = df.acesso.includes(opt);
                                return (
                                  <button key={opt} type="button" onClick={() => toggleArr("acesso", opt)}
                                    className={cn("text-sm px-3 py-1.5 rounded-lg border-2 transition-all",
                                      sel ? "border-primary bg-primary/10 font-medium text-primary" : "border-border hover:border-primary/40")}>
                                    {sel && <CheckCircle2 className="inline h-3 w-3 mr-1" />}{traumaOption(opt)}
                                  </button>
                                );
                              })}
                            </div>
                            <Input placeholder={tt("otherApproachOptional")} value={df.acessoOutro} onChange={(e) => set({ acessoOutro: e.target.value })} />
                          </div>

                          {/* 4. Cirurgia */}
                          <div className="space-y-2">
                            <p className="text-sm font-medium">{tt("surgeryMultiple")}</p>
                            <div className="flex flex-wrap gap-2">
                              {DISTAL_FEMUR_CIRURGIA.map((opt) => {
                                const sel = df.cirurgia.includes(opt);
                                return (
                                  <button key={opt} type="button" onClick={() => toggleArr("cirurgia", opt)}
                                    className={cn("text-sm px-3 py-1.5 rounded-lg border-2 transition-all",
                                      sel ? "border-primary bg-primary/10 font-medium text-primary" : "border-border hover:border-primary/40")}>
                                    {sel && <CheckCircle2 className="inline h-3 w-3 mr-1" />}{traumaOption(opt)}
                                  </button>
                                );
                              })}
                            </div>
                            <Input placeholder={tt("otherMaterialOptional")} value={df.cirurgiaOutro} onChange={(e) => set({ cirurgiaOutro: e.target.value })} />
                            <label className="flex items-center gap-2 text-sm pt-1">
                              <Checkbox checked={df.enxertoOsseo} onCheckedChange={(c) => set({ enxertoOsseo: !!c })} />
                              {tt("boneGraftUsed")}
                            </label>
                          </div>

                          {/* 5. Lesões associadas */}
                          <div className="space-y-2">
                            <p className="text-sm font-medium">{tt("associatedLesions")}</p>
                            <div className="flex flex-wrap gap-2">
                              {DISTAL_FEMUR_LESOES_ASSOCIADAS.map((opt) => {
                                const sel = df.lesoesAssociadas.includes(opt);
                                return (
                                  <button key={opt} type="button" onClick={() => toggleArr("lesoesAssociadas", opt)}
                                    className={cn("text-sm px-3 py-1.5 rounded-lg border-2 transition-all",
                                      sel ? "border-primary bg-primary/10 font-medium text-primary" : "border-border hover:border-primary/40")}>
                                    {sel && <CheckCircle2 className="inline h-3 w-3 mr-1" />}{traumaOption(opt)}
                                  </button>
                                );
                              })}
                            </div>
                            <Input placeholder={tt("otherAssociatedLesion")} value={df.lesoesAssociadasOutro} onChange={(e) => set({ lesoesAssociadasOutro: e.target.value })} />
                          </div>

                          {/* Observações */}
                          <div className="space-y-1 pt-3 border-t border-border/40">
                            <Label className="text-xs">{tt("observations")}</Label>
                            <Textarea value={df.observacoes} onChange={(e) => set({ observacoes: e.target.value })} rows={3} />
                          </div>
                        </div>
                      );
                    })()}

                    {/* ── Fratura do Platô Tibial (detalhamento) ── */}
                    {fraturas.includes("Fratura do Platô Tibial") && (() => {
                      const tp = tibialPlateau;
                      const set = (patch: Partial<typeof tibialPlateau>) => setTibialPlateau((prev) => ({ ...prev, ...patch }));
                      const toggleArr = (field: "acesso" | "cirurgia" | "lesoesAssociadas", val: string) => {
                        const cur = tp[field] as string[];
                        set({ [field]: cur.includes(val) ? cur.filter((x) => x !== val) : [...cur, val] } as any);
                      };
                      const addOpme = () => set({ opme: [...tp.opme, { item: "", quantidade: "" }] });
                      const updOpme = (i: number, field: "item" | "quantidade", value: string) => {
                        const arr = [...tp.opme];
                        arr[i] = { ...arr[i], [field]: value };
                        set({ opme: arr });
                      };
                      const rmOpme = (i: number) => set({ opme: tp.opme.filter((_, idx) => idx !== i) });

                      return (
                        <div className="border-2 border-primary/30 rounded-xl p-4 bg-primary/5 space-y-6">
                          <p className="font-semibold text-primary text-sm">{tt("tibialPlateauDetails")}</p>

                          {/* 1. Classificação */}
                          <div className="space-y-1">
                            <p className="text-sm font-medium">{tt("schatzkerClassification")}</p>
                            <Select value={tp.classificacaoSchatzker || ""} onValueChange={(v) => set({ classificacaoSchatzker: v })}>
                              <SelectTrigger className="sm:w-96"><SelectValue placeholder={tt("select")} /></SelectTrigger>
                              <SelectContent>
                                {TIBIAL_PLATEAU_SCHATZKER.map(({ value, label }) => (
                                  <SelectItem key={value} value={value}>{value} — {traumaOption(label.split(" — ")[1] ?? label)}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>

                          {/* 2. Datas / Controle de danos */}
                          <div className="space-y-3">
                            <p className="text-sm font-medium">{tt("datesDamageControl")}</p>
                            <div className="grid sm:grid-cols-2 gap-3">
                              <div className="space-y-1">
                                <Label className="text-xs">{tt("injuryDate")}</Label>
                                <Input type="date" value={tp.dataLesao} onChange={(e) => set({ dataLesao: e.target.value })} />
                              </div>
                              <div className="space-y-1">
                                <Label className="text-xs">{tt("definitiveSurgeryDate")}</Label>
                                <Input type="date" value={tp.dataCirurgiaDefinitiva} onChange={(e) => set({ dataCirurgiaDefinitiva: e.target.value })} />
                              </div>
                            </div>
                            <label className="flex items-center gap-2 text-sm">
                              <Checkbox checked={tp.controleDanos} onCheckedChange={(c) => set({ controleDanos: !!c })} />
                              {tt("damageControlOccurred")}
                            </label>
                            {tp.controleDanos && (
                              <div className="space-y-1 sm:w-64">
                                <Label className="text-xs">{tt("damageControlDate")}</Label>
                                <Input type="date" value={tp.controleDanosData} onChange={(e) => set({ controleDanosData: e.target.value })} />
                              </div>
                            )}
                          </div>

                          {/* 3. Acesso cirúrgico */}
                          <div className="space-y-2">
                            <p className="text-sm font-medium">{tt("surgicalApproach")}</p>
                            <div className="flex flex-wrap gap-2">
                              {TIBIAL_PLATEAU_ACESSO.map((opt) => {
                                const sel = tp.acesso.includes(opt);
                                return (
                                  <button key={opt} type="button" onClick={() => toggleArr("acesso", opt)}
                                    className={cn("text-sm px-3 py-1.5 rounded-lg border-2 transition-all",
                                      sel ? "border-primary bg-primary/10 font-medium text-primary" : "border-border hover:border-primary/40")}>
                                    {sel && <CheckCircle2 className="inline h-3 w-3 mr-1" />}{traumaOption(opt)}
                                  </button>
                                );
                              })}
                            </div>
                            <Input placeholder={tt("otherApproachOptional")} value={tp.acessoOutro} onChange={(e) => set({ acessoOutro: e.target.value })} />
                          </div>

                          {/* 4. Cirurgia */}
                          <div className="space-y-2">
                            <p className="text-sm font-medium">{tt("surgeryMultiple")}</p>
                            <div className="flex flex-wrap gap-2">
                              {TIBIAL_PLATEAU_CIRURGIA.map((opt) => {
                                const sel = tp.cirurgia.includes(opt);
                                return (
                                  <button key={opt} type="button" onClick={() => toggleArr("cirurgia", opt)}
                                    className={cn("text-sm px-3 py-1.5 rounded-lg border-2 transition-all",
                                      sel ? "border-primary bg-primary/10 font-medium text-primary" : "border-border hover:border-primary/40")}>
                                    {sel && <CheckCircle2 className="inline h-3 w-3 mr-1" />}{traumaOption(opt)}
                                  </button>
                                );
                              })}
                            </div>
                            <Input placeholder={tt("otherMaterialOptional")} value={tp.cirurgiaOutro} onChange={(e) => set({ cirurgiaOutro: e.target.value })} />
                            <label className="flex items-center gap-2 text-sm pt-1">
                              <Checkbox checked={tp.enxertoOsseo} onCheckedChange={(c) => set({ enxertoOsseo: !!c })} />
                              {tt("boneGraftUsed")}
                            </label>
                          </div>

                          {/* 5. Lesões associadas */}
                          <div className="space-y-2">
                            <p className="text-sm font-medium">{tt("associatedLesions")}</p>
                            <div className="flex flex-wrap gap-2">
                              {TIBIAL_PLATEAU_LESOES_ASSOCIADAS.map((opt) => {
                                const sel = tp.lesoesAssociadas.includes(opt);
                                return (
                                  <button key={opt} type="button" onClick={() => toggleArr("lesoesAssociadas", opt)}
                                    className={cn("text-sm px-3 py-1.5 rounded-lg border-2 transition-all",
                                      sel ? "border-primary bg-primary/10 font-medium text-primary" : "border-border hover:border-primary/40")}>
                                    {sel && <CheckCircle2 className="inline h-3 w-3 mr-1" />}{traumaOption(opt)}
                                  </button>
                                );
                              })}
                            </div>
                            <Input placeholder={tt("otherAssociatedLesion")} value={tp.lesoesAssociadasOutro} onChange={(e) => set({ lesoesAssociadasOutro: e.target.value })} />
                          </div>

                          {/* Observações */}
                          <div className="space-y-1 pt-3 border-t border-border/40">
                            <Label className="text-xs">{tt("observations")}</Label>
                            <Textarea value={tp.observacoes} onChange={(e) => set({ observacoes: e.target.value })} rows={3} />
                          </div>
                        </div>
                      );
                    })()}

                    {/* ── Fratura de Patela (detalhamento) ── */}
                    {fraturas.includes("Fratura de Patela") && (() => {
                      const pt = patella;
                      const set = (patch: Partial<typeof patella>) => setPatella((prev) => ({ ...prev, ...patch }));
                      const toggleArr = (field: "acesso" | "cirurgia" | "lesoesAssociadas", val: string) => {
                        const cur = pt[field] as string[];
                        set({ [field]: cur.includes(val) ? cur.filter((x) => x !== val) : [...cur, val] } as any);
                      };

                      return (
                        <div className="border-2 border-primary/30 rounded-xl p-4 bg-primary/5 space-y-6">
                          <p className="font-semibold text-primary text-sm">{tt("patellaDetails")}</p>

                          {/* 1. Classificação */}
                          <div className="space-y-3">
                            <p className="text-sm font-medium">{tt("ao34Classification")}</p>
                            <div className="grid sm:grid-cols-2 gap-3">
                              <div className="space-y-1">
                                <Label className="text-xs">{tt("type")}</Label>
                                <Select value={pt.classificacaoAoOta || ""} onValueChange={(v) => set({ classificacaoAoOta: v })}>
                                  <SelectTrigger><SelectValue placeholder={tt("select")} /></SelectTrigger>
                                  <SelectContent>
                                    {PATELLA_AO_OTA.map(({ value, label }) => (
                                      <SelectItem key={value} value={value}>{value} — {traumaOption(label.split(" — ")[1] ?? label)}</SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </div>
                              <div className="space-y-1">
                                <Label className="text-xs">{tt("subtype")}</Label>
                                <Select value={pt.classificacaoSubtipo || ""} onValueChange={(v) => set({ classificacaoSubtipo: v })}>
                                  <SelectTrigger><SelectValue placeholder={tt("select")} /></SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="1">1 — {traumaOption("Simples (2 fragmentos)")}</SelectItem>
                                    <SelectItem value="2">2 — {traumaOption("Cunha / bifocal")}</SelectItem>
                                    <SelectItem value="3">3 — {traumaOption("Cominutivo (multifragmentário)")}</SelectItem>
                                  </SelectContent>
                                </Select>
                              </div>
                            </div>
                          </div>

                          {/* 2. Datas */}
                          <div className="space-y-3">
                            <p className="text-sm font-medium">{tt("dates")}</p>
                            <div className="grid sm:grid-cols-2 gap-3">
                              <div className="space-y-1">
                                <Label className="text-xs">{tt("injuryDate")}</Label>
                                <Input type="date" value={pt.dataLesao} onChange={(e) => set({ dataLesao: e.target.value })} />
                              </div>
                              <div className="space-y-1">
                                <Label className="text-xs">{tt("definitiveSurgeryDate")}</Label>
                                <Input type="date" value={pt.dataCirurgiaDefinitiva} onChange={(e) => set({ dataCirurgiaDefinitiva: e.target.value })} />
                              </div>
                            </div>
                          </div>

                          {/* 3. Acesso cirúrgico */}
                          <div className="space-y-2">
                            <p className="text-sm font-medium">{tt("surgicalApproach")}</p>
                            <div className="flex flex-wrap gap-2">
                              {PATELLA_ACESSO.map((opt) => {
                                const sel = pt.acesso.includes(opt);
                                return (
                                  <button key={opt} type="button" onClick={() => toggleArr("acesso", opt)}
                                    className={cn("text-sm px-3 py-1.5 rounded-lg border-2 transition-all",
                                      sel ? "border-primary bg-primary/10 font-medium text-primary" : "border-border hover:border-primary/40")}>
                                    {sel && <CheckCircle2 className="inline h-3 w-3 mr-1" />}{traumaOption(opt)}
                                  </button>
                                );
                              })}
                            </div>
                            <Input placeholder={tt("otherApproachOptional")} value={pt.acessoOutro} onChange={(e) => set({ acessoOutro: e.target.value })} />
                          </div>

                          {/* 4. Cirurgia / Materiais */}
                          <div className="space-y-2">
                            <p className="text-sm font-medium">{tt("surgeryMaterialsMultiple")}</p>
                            <div className="flex flex-wrap gap-2">
                              {PATELLA_CIRURGIA.map((opt) => {
                                const sel = pt.cirurgia.includes(opt);
                                return (
                                  <button key={opt} type="button" onClick={() => toggleArr("cirurgia", opt)}
                                    className={cn("text-sm px-3 py-1.5 rounded-lg border-2 transition-all",
                                      sel ? "border-primary bg-primary/10 font-medium text-primary" : "border-border hover:border-primary/40")}>
                                    {sel && <CheckCircle2 className="inline h-3 w-3 mr-1" />}{traumaOption(opt)}
                                  </button>
                                );
                              })}
                            </div>
                            <Input placeholder={tt("otherMaterialOptional")} value={pt.cirurgiaOutro} onChange={(e) => set({ cirurgiaOutro: e.target.value })} />
                          </div>

                          {/* 5. Lesões associadas */}
                          <div className="space-y-2">
                            <p className="text-sm font-medium">{tt("associatedLesions")}</p>
                            <div className="flex flex-wrap gap-2">
                              {PATELLA_LESOES_ASSOCIADAS.map((opt) => {
                                const sel = pt.lesoesAssociadas.includes(opt);
                                return (
                                  <button key={opt} type="button" onClick={() => toggleArr("lesoesAssociadas", opt)}
                                    className={cn("text-sm px-3 py-1.5 rounded-lg border-2 transition-all",
                                      sel ? "border-primary bg-primary/10 font-medium text-primary" : "border-border hover:border-primary/40")}>
                                    {sel && <CheckCircle2 className="inline h-3 w-3 mr-1" />}{traumaOption(opt)}
                                  </button>
                                );
                              })}
                            </div>
                            <Input placeholder={tt("otherAssociatedLesion")} value={pt.lesoesAssociadasOutro} onChange={(e) => set({ lesoesAssociadasOutro: e.target.value })} />
                          </div>

                          {/* Observações */}
                          <div className="space-y-1 pt-3 border-t border-border/40">
                            <Label className="text-xs">{tt("observations")}</Label>
                            <Textarea value={pt.observacoes} onChange={(e) => set({ observacoes: e.target.value })} rows={3} />
                          </div>
                        </div>
                      );
                    })()}

                    {/* ── Fratura de Eminência Tibial / Espinha Tibial (detalhamento) ── */}
                    {fraturas.includes("Fratura de Eminência Tibial (Avulsão do LCA)") && (() => {
                      const ts = tibialSpine;
                      const set = (patch: Partial<typeof tibialSpine>) => setTibialSpine((prev) => ({ ...prev, ...patch }));
                      const toggleArr = (field: "lesoesAssociadas", val: string) => {
                        const cur = ts[field] as string[];
                        set({ [field]: cur.includes(val) ? cur.filter((x) => x !== val) : [...cur, val] } as any);
                      };
                      const addOpme = () => set({ opme: [...ts.opme, { item: "", quantidade: "" }] });
                      const updOpme = (i: number, field: "item" | "quantidade", value: string) => {
                        const arr = [...ts.opme];
                        arr[i] = { ...arr[i], [field]: value };
                        set({ opme: arr });
                      };
                      const rmOpme = (i: number) => set({ opme: ts.opme.filter((_, idx) => idx !== i) });
                      const hasLcaLesao = ts.lesoesAssociadas.includes("LCA");

                      return (
                        <div className="border-2 border-primary/30 rounded-xl p-4 bg-primary/5 space-y-6">
                          <p className="font-semibold text-primary text-sm">{tt("tibialSpineDetails")}</p>

                          {/* 1. Classificação */}
                          <div className="space-y-1">
                            <p className="text-sm font-medium">{tt("meyersClassification")}</p>
                            <Select value={ts.classificacaoMeyers || ""} onValueChange={(v) => set({ classificacaoMeyers: v })}>
                              <SelectTrigger className="sm:w-64"><SelectValue placeholder={tt("select")} /></SelectTrigger>
                              <SelectContent>
                                {TIBIAL_SPINE_MEYERS.map(({ value, label }) => (
                                  <SelectItem key={value} value={value}>{value} — {traumaOption(label.split(" — ")[1] ?? label)}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>

                          {/* 2. Datas */}
                          <div className="space-y-3">
                            <p className="text-sm font-medium">{tt("dates")}</p>
                            <div className="grid sm:grid-cols-2 gap-3">
                              <div className="space-y-1">
                                <Label className="text-xs">{tt("injuryDate")}</Label>
                                <Input type="date" value={ts.dataLesao} onChange={(e) => set({ dataLesao: e.target.value })} />
                              </div>
                              <div className="space-y-1">
                                <Label className="text-xs">{tt("definitiveSurgeryDate")}</Label>
                                <Input type="date" value={ts.dataCirurgiaDefinitiva} onChange={(e) => set({ dataCirurgiaDefinitiva: e.target.value })} />
                              </div>
                            </div>
                          </div>

                          {/* 3. Técnica */}
                          <div className="space-y-2">
                            <p className="text-sm font-medium">{tt("openOrVideo")}</p>
                            <div className="flex flex-wrap gap-2">
                              {TIBIAL_SPINE_TECNICA.map((opt) => {
                                const sel = ts.tecnica === opt;
                                return (
                                  <button key={opt} type="button" onClick={() => set({ tecnica: sel ? "" : opt })}
                                    className={cn("text-sm px-3 py-1.5 rounded-lg border-2 transition-all",
                                      sel ? "border-primary bg-primary/10 font-medium text-primary" : "border-border hover:border-primary/40")}>
                                    {sel && <CheckCircle2 className="inline h-3 w-3 mr-1" />}{traumaOption(opt)}
                                  </button>
                                );
                              })}
                            </div>
                          </div>

                          {/* 4. OPME */}
                          <div className="space-y-2">
                            <div className="flex items-center justify-between">
                              <p className="text-sm font-medium">{tt("opmeUsed")}</p>
                              <Button type="button" variant="outline" size="sm" onClick={addOpme}>{tt("add")}</Button>
                            </div>
                            <p className="text-xs text-muted-foreground">{tt("opmeHelp")}</p>
                            {ts.opme.map((o, i) => (
                              <div key={i} className="flex gap-2">
                                <Input placeholder={tt("opmeItem")} value={o.item} onChange={(e) => updOpme(i, "item", e.target.value)} className="flex-1" />
                                <Input placeholder={tt("quantity")} value={o.quantidade} onChange={(e) => updOpme(i, "quantidade", e.target.value)} className="w-24" />
                                <Button type="button" size="sm" variant="ghost" className="text-destructive" onClick={() => rmOpme(i)}>{tt("remove")}</Button>
                              </div>
                            ))}
                            <div className="space-y-1 pt-1 sm:w-64">
                              <Label className="text-xs">{tt("sutureMaterial")}</Label>
                              <Select value={ts.materialSutura || "__none__"} onValueChange={(v) => set({ materialSutura: v === "__none__" ? "" : v })}>
                                <SelectTrigger><SelectValue placeholder={tt("selectOptional")} /></SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="__none__">—</SelectItem>
                                  {TIBIAL_SPINE_MATERIAL_SUTURA.map((v) => <SelectItem key={v} value={v}>{v}</SelectItem>)}
                                </SelectContent>
                              </Select>
                            </div>
                          </div>

                          {/* 5. Lesões associadas */}
                          <div className="space-y-2">
                            <p className="text-sm font-medium">{tt("associatedLesions")}</p>
                            <div className="flex flex-wrap gap-2">
                              {TIBIAL_SPINE_LESOES_ASSOCIADAS.map((opt) => {
                                const sel = ts.lesoesAssociadas.includes(opt);
                                return (
                                  <button key={opt} type="button" onClick={() => toggleArr("lesoesAssociadas", opt)}
                                    className={cn("text-sm px-3 py-1.5 rounded-lg border-2 transition-all",
                                      sel ? "border-primary bg-primary/10 font-medium text-primary" : "border-border hover:border-primary/40")}>
                                    {sel && <CheckCircle2 className="inline h-3 w-3 mr-1" />}{traumaOption(opt)}
                                  </button>
                                );
                              })}
                            </div>
                            {hasLcaLesao && (
                              <div className="space-y-1 sm:w-72 pt-1">
                                <Label className="text-xs">{tt("aclInjurySubtype")}</Label>
                                <Select value={ts.lcaSubtipo || "__none__"} onValueChange={(v) => set({ lcaSubtipo: v === "__none__" ? "" : v })}>
                                  <SelectTrigger><SelectValue placeholder={tt("select")} /></SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="__none__">—</SelectItem>
                                    {TIBIAL_SPINE_LCA_SUBTIPO.map((v) => <SelectItem key={v} value={v}>{traumaOption(v)}</SelectItem>)}
                                  </SelectContent>
                                </Select>
                              </div>
                            )}
                            <Input placeholder={tt("otherAssociatedLesion")} value={ts.lesoesAssociadasOutro} onChange={(e) => set({ lesoesAssociadasOutro: e.target.value })} />
                          </div>

                          {/* Observações */}
                          <div className="space-y-1 pt-3 border-t border-border/40">
                            <Label className="text-xs">{tt("observations")}</Label>
                            <Textarea value={ts.observacoes} onChange={(e) => set({ observacoes: e.target.value })} rows={3} />
                          </div>
                          <p className="text-xs text-muted-foreground">{tt("followupAutomatic")}</p>
                        </div>
                      );
                    })()}
                  </div>
                </div>
                )}


                {!isArtroplastia && isLigamentar && hasLca && (
                  <div className="border-2 border-primary/30 rounded-xl p-4 bg-primary/5">
                    <p className="font-semibold text-primary text-sm mb-4">{tt("aclTitle")}</p>

                    {/* Toggle Reconstrução vs Reparo */}
                    <div className="space-y-2 mb-5">
                      <Label className="font-semibold">{tt("surgeryType")}</Label>
                      <div className="flex flex-wrap gap-2">
                        {["Reconstrução", "Reparo"].map((opt) => {
                          const selected = (formData.tipoLca || "Reconstrução") === opt;
                          return (
                            <button
                              key={opt}
                              type="button"
                               onClick={() => {
                                 updateData("tipoLca", opt);
                                 if (opt === "Reparo") updateData("flipCutter", "");
                               }}
                              className={`px-5 py-2 rounded-xl border-2 text-sm font-semibold transition-all ${
                                selected
                                  ? "border-primary bg-primary/10 text-primary"
                                  : "border-border bg-background text-muted-foreground hover:border-primary/50"
                              }`}
                            >
                              {selected && <CheckCircle2 className="inline h-3.5 w-3.5 mr-1.5" />}
                              {opt === "Reconstrução" ? tt("aclReconstruction") : tt("aclRepair")}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                  {(formData.tipoLca || "Reconstrução") === "Reconstrução" ? (
                  <div className="grid sm:grid-cols-2 gap-6">
                    <div className="space-y-2">
                      <Label>{tt("graft")}</Label>
                      <Select value={formData.enxerto || ""} onValueChange={(v) => updateData("enxerto", v)}>
                        <SelectTrigger><SelectValue placeholder={tt("selectGraft")} /></SelectTrigger>
                        <SelectContent>
                          {ENXERTOS_LIGAMENTAR.map((e) => (
                            <SelectItem key={e} value={e}>{traumaOption(e)}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label>{tt("graftDiameter")}</Label>
                      <Select value={formData.diametroEnxerto || ""} onValueChange={(v) => updateData("diametroEnxerto", v)}>
                        <SelectTrigger><SelectValue placeholder={tt("selectDiameter")} /></SelectTrigger>
                        <SelectContent>
                          {["7mm", "7,5mm", "8mm", "8,5mm", "9mm", "9,5mm", "10mm", "10,5mm", "11mm", "Outro"].map((d) => (
                            <SelectItem key={d} value={d}>{traumaOption(d)}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                     <div className="space-y-2">
                       <Label>{t("flipCutter")}</Label>
                       <div className="flex gap-2">
                         {["Sim", "Não"].map((opt) => {
                           const selected = formData.flipCutter === opt;
                           return (
                             <button
                               key={opt}
                               type="button"
                               onClick={() => updateData("flipCutter", selected ? "" : opt)}
                               className={`px-5 py-2 rounded-xl border-2 text-sm font-semibold transition-all ${
                                 selected
                                   ? "border-primary bg-primary/10 text-primary"
                                   : "border-border bg-background text-muted-foreground hover:border-primary/50"
                               }`}
                             >
                               {selected && <CheckCircle2 className="inline h-3.5 w-3.5 mr-1.5" />}
                               {traumaOption(opt)}
                             </button>
                           );
                         })}
                       </div>
                     </div>

                    {/* Técnica do Túnel Femoral — apenas para LCA */}
                    {hasLca && (
                      <div className="space-y-2 sm:col-span-2">
                        <Label className="font-semibold">{tt("femoralTunnelTechnique")}</Label>
                        <div className="flex flex-wrap gap-2">
                          {["Outside-In", "Portal Anteromedial", "Trans-Tibial"].map((opt) => {
                            const selected = formData.tunelFemoral === opt;
                            return (
                              <button
                                key={opt}
                                type="button"
                                onClick={() => updateData("tunelFemoral", selected ? "" : opt)}
                                className={`px-4 py-2 rounded-xl border-2 text-sm font-semibold transition-all ${
                                  selected
                                    ? "border-primary bg-primary/10 text-primary"
                                    : "border-border bg-background text-muted-foreground hover:border-primary/50"
                                }`}
                              >
                                {opt}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Túneis Pediátricos — Esqueleto Imaturo (aparece quando paciente ≤ 15 anos com LCA) */}
                    {isJovem && hasLca && (
                      <div className="sm:col-span-2 rounded-xl border-2 border-orange-400 bg-orange-50 px-4 py-3 space-y-3">
                        <p className="text-xs font-bold text-orange-900 uppercase tracking-wide flex items-center gap-1.5">
                          {tt("immatureSkeletonTunnel")}
                        </p>

                        {/* Túnel Femoral */}
                        <div className="space-y-1.5">
                          <Label className="text-xs font-semibold text-orange-800">{tt("femoralTunnel")}</Label>
                          <div className="flex flex-wrap gap-2">
                            {["Extra-fisário", "Epifisário", "Trans-fisário"].map((opt) => {
                              const sel = (formData as any).tunelFemoralPediatrico === opt;
                              return (
                                <button key={opt} type="button"
                                  onClick={() => updateData("tunelFemoralPediatrico" as any, sel ? "" : opt)}
                                  className={cn("px-4 py-2 rounded-xl border-2 text-sm font-semibold transition-all",
                                    sel ? "border-orange-500 bg-orange-100 text-orange-900" : "border-orange-200 bg-white text-slate-700 hover:border-orange-400")}>
                                  {sel && <CheckCircle2 className="inline h-3.5 w-3.5 mr-1.5 text-orange-600" />}{traumaOption(opt)}
                                </button>
                              );
                            })}
                          </div>
                        </div>

                        {/* Túnel Tibial */}
                        <div className="space-y-1.5">
                          <Label className="text-xs font-semibold text-orange-800">{tt("tibialTunnel")}</Label>
                          <div className="flex flex-wrap gap-2">
                            {["Extra-fisário", "Epifisário", "Trans-fisário"].map((opt) => {
                              const sel = (formData as any).tunelTibialPediatrico === opt;
                              return (
                                <button key={opt} type="button"
                                  onClick={() => updateData("tunelTibialPediatrico" as any, sel ? "" : opt)}
                                  className={cn("px-4 py-2 rounded-xl border-2 text-sm font-semibold transition-all",
                                    sel ? "border-orange-500 bg-orange-100 text-orange-900" : "border-orange-200 bg-white text-slate-700 hover:border-orange-400")}>
                                  {sel && <CheckCircle2 className="inline h-3.5 w-3.5 mr-1.5 text-orange-600" />}{traumaOption(opt)}
                                </button>
                              );
                            })}
                          </div>
                        </div>

                        {((formData as any).tunelFemoralPediatrico || (formData as any).tunelTibialPediatrico) && (
                          <p className="text-xs text-orange-700 font-medium">
                            {(formData as any).tunelFemoralPediatrico === "Trans-fisário" || (formData as any).tunelTibialPediatrico === "Trans-fisário"
                              ? tt("transphysealWarning")
                              : tt("pediatricRecorded")}
                          </p>
                        )}
                      </div>
                    )}

                    <div className="space-y-2">
                      <Label>{tt("femoralFixation")}</Label>
                      <Select value={formData.fixacaoFemoral || ""} onValueChange={(v) => updateData("fixacaoFemoral", v)}>
                        <SelectTrigger><SelectValue placeholder={tt("selectFixation")} /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Endobutton">Endobutton</SelectItem>
                          <SelectItem value="Parafuso bioabsorvível">{traumaOption("Parafuso bioabsorvível")}</SelectItem>
                          <SelectItem value="Parafuso metálico">{traumaOption("Parafuso metálico")}</SelectItem>
                          <SelectItem value="Âncora de sutura">{traumaOption("Âncora de sutura")}</SelectItem>
                          <SelectItem value="Endoboton Ajustável">{traumaOption("Endoboton Ajustável")}</SelectItem>
                          <SelectItem value="Poste">{traumaOption("Poste")}</SelectItem>
                          <SelectItem value="Outro">{traumaOption("Outro")}</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label>{tt("tibialFixation")}</Label>
                      <Select value={formData.fixacaoTibial || ""} onValueChange={(v) => updateData("fixacaoTibial", v)}>
                        <SelectTrigger><SelectValue placeholder={tt("selectFixation")} /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Parafuso bioabsorvível">{traumaOption("Parafuso bioabsorvível")}</SelectItem>
                          <SelectItem value="Parafuso metálico">{traumaOption("Parafuso metálico")}</SelectItem>
                          <SelectItem value="Poste">{traumaOption("Poste")}</SelectItem>
                          <SelectItem value="Cortical fixation">{traumaOption("Cortical fixation")}</SelectItem>
                          <SelectItem value="Endoboton Ajustável">{traumaOption("Endoboton Ajustável")}</SelectItem>
                          <SelectItem value="Âncora de sutura">{traumaOption("Âncora de sutura")}</SelectItem>
                          <SelectItem value="Outro">{traumaOption("Outro")}</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label>{tt("internalBrace")}</Label>
                      <div className="flex gap-2">
                        {["Sim", "Não"].map(opt => {
                          const selected = formData.internalBrace === opt;
                          return (
                            <button
                              key={opt}
                              type="button"
                              onClick={() => updateData("internalBrace", selected ? "" : opt)}
                              className={`px-5 py-2 rounded-xl border-2 text-sm font-semibold transition-all ${
                                selected
                                  ? "border-primary bg-primary/10 text-primary"
                                  : "border-border bg-background text-muted-foreground hover:border-primary/50"
                              }`}
                            >
                              {traumaOption(opt)}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label className="font-semibold">{tt("remnantPreservation")}</Label>
                      <div className="flex gap-2">
                        {["Sim", "Não"].map(opt => {
                          const selected = formData.preservacaoRemanescente === opt;
                          return (
                            <button
                              key={opt}
                              type="button"
                              onClick={() => updateData("preservacaoRemanescente", selected ? "" : opt)}
                              className={`px-5 py-2 rounded-xl border-2 text-sm font-semibold transition-all ${
                                selected
                                  ? "border-primary bg-primary/10 text-primary"
                                  : "border-border bg-background text-muted-foreground hover:border-primary/50"
                              }`}
                            >
                              {selected && <CheckCircle2 className="inline h-3.5 w-3.5 mr-1.5" />}
                              {traumaOption(opt)}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                  ) : (
                  <div className="grid sm:grid-cols-2 gap-6">
                    <div className="space-y-2">
                      <Label className="font-semibold">{tt("injuryLocation")}</Label>
                      <div className="flex gap-2">
                        {["Femoral", "Tibial"].map(opt => {
                          const selected = formData.localizacaoLesaoLca === opt;
                          return (
                            <button
                              key={opt}
                              type="button"
                              onClick={() => updateData("localizacaoLesaoLca", selected ? "" : opt)}
                              className={`px-5 py-2 rounded-xl border-2 text-sm font-semibold transition-all ${
                                selected
                                  ? "border-primary bg-primary/10 text-primary"
                                  : "border-border bg-background text-muted-foreground hover:border-primary/50"
                              }`}
                            >
                              {selected && <CheckCircle2 className="inline h-3.5 w-3.5 mr-1.5" />}
                              {traumaOption(opt)}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label className="font-semibold">{tt("fixation")}</Label>
                      <div className="flex gap-2">
                        {["Âncora", "Túnel Ósseo"].map(opt => {
                          const selected = formData.fixacaoReparoLca === opt;
                          return (
                            <button
                              key={opt}
                              type="button"
                              onClick={() => updateData("fixacaoReparoLca", selected ? "" : opt)}
                              className={`px-5 py-2 rounded-xl border-2 text-sm font-semibold transition-all ${
                                selected
                                  ? "border-primary bg-primary/10 text-primary"
                                  : "border-border bg-background text-muted-foreground hover:border-primary/50"
                              }`}
                            >
                              {selected && <CheckCircle2 className="inline h-3.5 w-3.5 mr-1.5" />}
                              {traumaOption(opt)}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label>{tt("internalBrace")}</Label>
                      <div className="flex gap-2">
                        {["Sim", "Não"].map(opt => {
                          const selected = formData.internalBrace === opt;
                          return (
                            <button
                              key={opt}
                              type="button"
                              onClick={() => updateData("internalBrace", selected ? "" : opt)}
                              className={`px-5 py-2 rounded-xl border-2 text-sm font-semibold transition-all ${
                                selected
                                  ? "border-primary bg-primary/10 text-primary"
                                  : "border-border bg-background text-muted-foreground hover:border-primary/50"
                              }`}
                            >
                              {traumaOption(opt)}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                  )}

                  <div className="mt-4">
                    {/* ── LEAP — Procedimento Extra-Articular Periférico Associado ── */}
                    <div className="sm:col-span-2 mt-2 pt-4 border-t border-primary/20 space-y-4">
                      <div>
                        <p className="text-sm font-bold text-primary">{tt("leapTitle")}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {tt("leapHelp")}
                        </p>
                      </div>

                      {/* Seleção multi — cada procedimento é independente */}
                      <div className="flex flex-wrap gap-2">
                        {([
                          { key: "lal" as const, label: tt("lalReconstruction"), selCls: "border-primary bg-primary/10 text-primary", hovCls: "hover:border-primary/50" },
                          { key: "let" as const, label: tt("letOption"),  selCls: "border-cyan-600 bg-cyan-50 text-cyan-800", hovCls: "hover:border-cyan-400" },
                          { key: "loa" as const, label: tt("loaOption"), selCls: "border-amber-500 bg-amber-50 text-amber-800", hovCls: "hover:border-amber-400" },
                        ]).map(({ key, label, selCls, hovCls }) => {
                          const sel = extraArticular[key];
                          return (
                            <button key={key} type="button"
                              onClick={() => setExtraArticular(prev => ({ ...prev, [key]: !prev[key] }))}
                              className={cn("px-4 py-2.5 rounded-xl border-2 text-sm font-semibold transition-all",
                                sel ? selCls : `border-border bg-background text-muted-foreground ${hovCls}`)}>
                              {sel && <CheckCircle2 className="inline h-3.5 w-3.5 mr-1.5" />}{label}
                            </button>
                          );
                        })}
                      </div>

                      {/* LAL details */}
                      {extraArticular.lal && (
                        <div className="ml-1 border-l-4 border-primary pl-4 space-y-3">
                          <p className="text-xs font-bold text-primary uppercase tracking-wide">{tt("lalTitle")}</p>
                          <div className="grid sm:grid-cols-2 gap-3">
                            <div className="space-y-2">
                              <Label className="text-xs text-muted-foreground">{tt("configuration")}</Label>
                              <div className="flex gap-2">
                                {["Dupla Banda", "Banda Única"].map(b => (
                                  <button key={b} type="button"
                                    onClick={() => setExtraArticular(prev => ({ ...prev, lalBanda: prev.lalBanda === b ? "" : b }))}
                                    className={cn("px-3 py-1.5 rounded-lg border-2 text-xs font-semibold transition-all",
                                      extraArticular.lalBanda === b ? "border-primary bg-primary/10 text-primary" : "border-border hover:border-primary/40")}>
                                    {extraArticular.lalBanda === b && <CheckCircle2 className="inline h-3 w-3 mr-1" />}{traumaOption(b)}
                                  </button>
                                ))}
                              </div>
                            </div>
                            <div className="space-y-2">
                              <Label className="text-xs text-muted-foreground">{tt("lalGraft")}</Label>
                              <Select value={extraArticular.lalEnxerto} onValueChange={(v) => setExtraArticular(prev => ({ ...prev, lalEnxerto: v }))}>
                                <SelectTrigger className="text-xs"><SelectValue placeholder={tt("select")} /></SelectTrigger>
                                <SelectContent>
                                  {["Trato Iliotibial (banda IT)", ...ENXERTOS_LIGAMENTAR].map(e => (
                                    <SelectItem key={e} value={e}>{traumaOption(e)}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                          </div>

                          {extraArticular.lalBanda === "Banda Única" && (
                            <div className="space-y-2">
                              <Label className="text-xs text-muted-foreground">{tt("fixationMethod")}</Label>
                              <div className="flex flex-wrap gap-2">
                                {["Parafuso de Interferência Bioabsorvível", "Parafuso de Interferência Metálico", "Âncora de Sutura"].map(f => (
                                  <button key={f} type="button"
                                    onClick={() => setExtraArticular(prev => ({ ...prev, lalFixacao: prev.lalFixacao === f ? "" : f }))}
                                    className={cn("px-3 py-1.5 rounded-lg border-2 text-xs font-semibold transition-all",
                                      extraArticular.lalFixacao === f ? "border-primary bg-primary/10 text-primary" : "border-border hover:border-primary/40")}>
                                    {extraArticular.lalFixacao === f && <CheckCircle2 className="inline h-3 w-3 mr-1" />}{traumaOption(f)}
                                  </button>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      )}

                      {/* LET details */}
                      {extraArticular.let && (
                        <div className="ml-1 border-l-4 border-cyan-500 pl-4 space-y-3">
                          <p className="text-xs font-bold text-cyan-700 uppercase tracking-wide">{tt("letTitle")}</p>
                          <div className="grid sm:grid-cols-2 gap-3">
                            <div className="space-y-2">
                              <Label className="text-xs text-muted-foreground">{tt("technique")}</Label>
                              <div className="flex flex-wrap gap-2">
                                {["MacIntosh (modificada)", "Lemaire", "Ellison", "Outro"].map(t => (
                                  <button key={t} type="button"
                                    onClick={() => setExtraArticular(prev => ({ ...prev, letTecnica: prev.letTecnica === t ? "" : t }))}
                                    className={cn("px-3 py-1.5 rounded-lg border-2 text-xs font-semibold transition-all",
                                      extraArticular.letTecnica === t ? "border-cyan-600 bg-cyan-50 text-cyan-800" : "border-border hover:border-cyan-300")}>
                                    {extraArticular.letTecnica === t && <CheckCircle2 className="inline h-3 w-3 mr-1" />}{traumaOption(t)}
                                  </button>
                                ))}
                              </div>
                            </div>
                            <div className="space-y-2">
                              <Label className="text-xs text-muted-foreground">{tt("graftMaterial")}</Label>
                              <Select value={extraArticular.letEnxerto} onValueChange={(v) => setExtraArticular(prev => ({ ...prev, letEnxerto: v }))}>
                                <SelectTrigger className="text-xs"><SelectValue placeholder={tt("select")} /></SelectTrigger>
                                <SelectContent>
                                  {["Trato Iliotibial (in situ)", "Semitendíneo", "Grácil", "Aloenxerto", "Sintético (LARS)", "Outro"].map(e => (
                                    <SelectItem key={e} value={e}>{traumaOption(e)}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                            {/* Método de Fixação do LET */}
                            <div className="sm:col-span-2 space-y-2">
                              <Label className="text-xs text-muted-foreground">{tt("fixationMethod")}</Label>
                              <div className="flex flex-wrap gap-2">
                                {["Mesmo túnel do LCA", "Parafuso de interferência", "Tenodese no enxerto", "Âncora"].map(f => (
                                  <button key={f} type="button"
                                    onClick={() => setExtraArticular(prev => ({ ...prev, letFixacao: prev.letFixacao === f ? "" : f }))}
                                    className={cn("px-3 py-1.5 rounded-lg border-2 text-xs font-semibold transition-all",
                                      extraArticular.letFixacao === f ? "border-cyan-600 bg-cyan-50 text-cyan-800" : "border-border hover:border-cyan-300")}>
                                    {extraArticular.letFixacao === f && <CheckCircle2 className="inline h-3 w-3 mr-1" />}{traumaOption(f)}
                                  </button>
                                ))}
                              </div>
                            </div>
                            {extraArticular.letTecnica === "MacIntosh (modificada)" && (
                              <div className="sm:col-span-2 px-3 py-2 rounded-lg bg-cyan-50 border border-cyan-200">
                                <p className="text-xs text-cyan-700">{tt("macintoshHelp")}</p>
                              </div>
                            )}
                            {extraArticular.letTecnica === "Lemaire" && (
                              <div className="sm:col-span-2 px-3 py-2 rounded-lg bg-cyan-50 border border-cyan-200">
                                <p className="text-xs text-cyan-700">{tt("lemaireHelp")}</p>
                              </div>
                            )}
                          </div>
                        </div>
                      )}

                      {/* LOA details */}
                      {extraArticular.loa && (
                        <div className="ml-1 border-l-4 border-amber-500 pl-4 space-y-3">
                          <p className="text-xs font-bold text-amber-700 uppercase tracking-wide">{tt("loaTitle")}</p>
                          <div className="grid sm:grid-cols-2 gap-3">
                            <div className="space-y-2">
                              <Label className="text-xs text-muted-foreground">{tt("loaGraft")}</Label>
                              <Select value={extraArticular.loaEnxerto} onValueChange={(v) => setExtraArticular(prev => ({ ...prev, loaEnxerto: v }))}>
                                <SelectTrigger className="text-xs"><SelectValue placeholder={tt("selectGraft")} /></SelectTrigger>
                                <SelectContent>
                                  {ENXERTOS_LIGAMENTAR.map(e => (
                                    <SelectItem key={e} value={e}>{traumaOption(e)}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                            <div className="sm:col-span-2 space-y-2">
                              <Label className="text-xs text-muted-foreground">{tt("femoralFixationMethod")}</Label>
                              <div className="flex flex-wrap gap-2">
                                {["Parafuso de interferência", "Mesmo túnel do LCM", "Âncora de Sutura"].map(f => (
                                  <button key={f} type="button"
                                    onClick={() => setExtraArticular(prev => ({ ...prev, loaFixacao: prev.loaFixacao === f ? "" : f }))}
                                    className={cn("px-3 py-1.5 rounded-lg border-2 text-xs font-semibold transition-all",
                                      extraArticular.loaFixacao === f ? "border-amber-500 bg-amber-50 text-amber-800" : "border-border hover:border-amber-400")}>
                                    {extraArticular.loaFixacao === f && <CheckCircle2 className="inline h-3 w-3 mr-1" />}{traumaOption(f)}
                                  </button>
                                ))}
                              </div>
                            </div>
                          </div>
                        </div>
                      )}

                      {!extraArticular.lal && !extraArticular.let && !extraArticular.loa && (
                        <p className="text-xs text-muted-foreground italic">{tt("noLeap")}</p>
                      )}
                    </div>

                  </div>
                  </div>
                )}

                {isPatelar && (
                  <div className="space-y-5">
                    <div className="flex items-center gap-2">
                      <div className="h-5 w-1.5 rounded-full bg-pink-500" />
                      <p className="font-bold text-sm text-pink-800">{ta("patellarTechnique")}</p>
                    </div>

                    {/* Técnicas realizadas (multiple) */}
                    <div className="space-y-2">
                      <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{ta("proceduresPerformed")}</Label>
                      <div className="grid sm:grid-cols-2 gap-2">
                        {[
                          "Reconstrução MPFL",
                          "Tibialização (TT-TG) — Medialização (Elmslie-Trillat)",
                          "Tibialização (TT-TG) — AMZ / Fulkerson",
                          "Trocleoplastia",
                          "Liberação / Alongamento Retináculo Lateral",
                          "Realinhamento Distal Isolado",
                        ].map((tecn) => {
                          const sel = patelarTecnica.tecnicas.includes(tecn);
                          return (
                            <button key={tecn} type="button"
                              onClick={() => setPatelarTecnica(prev => ({
                                ...prev,
                                tecnicas: sel ? prev.tecnicas.filter(t => t !== tecn) : [...prev.tecnicas, tecn],
                              }))}
                              className={cn("text-sm text-left px-3 py-2 rounded-lg border-2 transition-all",
                                sel ? "border-pink-500 bg-pink-50 font-medium text-pink-800" : "border-border hover:border-pink-300")}>
                              {sel && <CheckCircle2 className="inline h-3 w-3 mr-1" />}{displayArthroplastyOption(tecn)}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* MPFL Details */}
                    {patelarTecnica.tecnicas.includes("Reconstrução MPFL") && (
                      <div className="border-2 border-pink-200 rounded-xl p-4 space-y-4 bg-pink-50/30">
                        <p className="text-xs font-bold uppercase tracking-widest text-pink-700">{ta("mpflDetails")}</p>
                        <div className="grid sm:grid-cols-2 gap-4">
                          <div className="space-y-2">
                            <Label className="text-sm">{ta("graft")}</Label>
                            <Select value={patelarTecnica.mpflEnxerto} onValueChange={(v) => setPatelarTecnica(p => ({ ...p, mpflEnxerto: v }))}>
                              <SelectTrigger><SelectValue placeholder={ta("select")} /></SelectTrigger>
                              <SelectContent>
                                {ENXERTOS_LIGAMENTAR.map((e) => (
                                  <SelectItem key={e} value={e}>{displayArthroplastyOption(e)}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="space-y-2">
                            <Label className="text-sm">{ta("patellarFixation")}</Label>
                            <Select value={patelarTecnica.mpflFixacaoPatelar} onValueChange={(v) => setPatelarTecnica(p => ({ ...p, mpflFixacaoPatelar: v }))}>
                              <SelectTrigger><SelectValue placeholder={ta("select")} /></SelectTrigger>
                              <SelectContent>
                                {["Túneis ósseos transversais", "Âncora de sutura", "Parafuso bioabsorvível", "Enxerto inserido na patela (inserção anatômica)"].map(value => <SelectItem key={value} value={value}>{displayArthroplastyOption(value)}</SelectItem>)}
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="space-y-2">
                            <Label className="text-sm">{ta("femoralFixation")} <span className="text-xs font-normal text-muted-foreground">{ta("schottlePoint")}</span></Label>
                            <Select value={patelarTecnica.mpflFixacaoFemoral} onValueChange={(v) => setPatelarTecnica(p => ({ ...p, mpflFixacaoFemoral: v }))}>
                              <SelectTrigger><SelectValue placeholder={ta("select")} /></SelectTrigger>
                              <SelectContent>
                                {["Parafuso de interferência bioabsorvível", "Parafuso de interferência metálico", "Endoboton Ajustável", "Âncora de sutura"].map(value => <SelectItem key={value} value={value}>{displayArthroplastyOption(value)}</SelectItem>)}
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="space-y-2">
                            <Label className="text-sm">{ta("graftTensioning")}</Label>
                            <Select value={patelarTecnica.mpflTensao} onValueChange={(v) => setPatelarTecnica(p => ({ ...p, mpflTensao: v }))}>
                              <SelectTrigger><SelectValue placeholder={ta("tensionAngle")} /></SelectTrigger>
                              <SelectContent>
                                {["30° de flexão", "60° de flexão", "0° (extensão)"].map(value => <SelectItem key={value} value={value}>{displayArthroplastyOption(value)}</SelectItem>)}
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* TTO Details */}
                    {(patelarTecnica.tecnicas.includes("Tibialização (TT-TG) — Medialização (Elmslie-Trillat)") ||
                      patelarTecnica.tecnicas.includes("Tibialização (TT-TG) — AMZ / Fulkerson")) && (
                      <div className="border-2 border-amber-200 rounded-xl p-4 space-y-4 bg-amber-50/30">
                        <p className="text-xs font-bold uppercase tracking-widest text-amber-700">{ta("ttoDetails")}</p>
                        <div className="grid sm:grid-cols-2 gap-4">
                          <div className="space-y-2">
                            <Label className="text-sm">{ta("displacementType")}</Label>
                            <Select value={patelarTecnica.ttoTipo} onValueChange={(v) => setPatelarTecnica(p => ({ ...p, ttoTipo: v }))}>
                              <SelectTrigger><SelectValue placeholder={ta("select")} /></SelectTrigger>
                              <SelectContent>
                                {["Medialização (Elmslie-Trillat)", "Anteriorização + Medialização (AMZ)", "Anteriorização pura", "Distalizacão"].map(value => <SelectItem key={value} value={value}>{displayArthroplastyOption(value)}</SelectItem>)}
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="space-y-2">
                            <Label className="text-sm">{ta("osteotomyFixation")}</Label>
                            <Select value={patelarTecnica.ttoFixacao} onValueChange={(v) => setPatelarTecnica(p => ({ ...p, ttoFixacao: v }))}>
                              <SelectTrigger><SelectValue placeholder={ta("select")} /></SelectTrigger>
                              <SelectContent>
                                {["2 parafusos corticais", "2 parafusos de dupla compressão", "Placa e parafusos"].map(value => <SelectItem key={value} value={value}>{displayArthroplastyOption(value)}</SelectItem>)}
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Trochleoplasty */}
                    {patelarTecnica.tecnicas.includes("Trocleoplastia") && (
                      <div className="border-2 border-indigo-200 rounded-xl p-4 space-y-3 bg-indigo-50/30">
                        <p className="text-xs font-bold uppercase tracking-widest text-indigo-700">{ta("trochleoplastyDetails")}</p>
                        <div className="grid sm:grid-cols-2 gap-4">
                          <div className="space-y-2">
                            <Label className="text-sm">{ta("technique")}</Label>
                            <Select value={patelarTecnica.trocleoplastiaTipo} onValueChange={(v) => setPatelarTecnica(p => ({ ...p, trocleoplastiaTipo: v }))}>
                              <SelectTrigger><SelectValue placeholder={ta("select")} /></SelectTrigger>
                              <SelectContent>
                                {["Sulcus deepening (Dejour)", "Bereiter (cunha em cunha)", "Trocleoplastia por elevação"].map(value => <SelectItem key={value} value={value}>{displayArthroplastyOption(value)}</SelectItem>)}
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="space-y-2">
                            <Label className="text-sm">{ta("trochleoplastyFixation")}</Label>
                            <Select value={patelarTecnica.trocleoplastiaFixacao} onValueChange={(v) => setPatelarTecnica(p => ({ ...p, trocleoplastiaFixacao: v }))}>
                              <SelectTrigger><SelectValue placeholder={ta("select")} /></SelectTrigger>
                              <SelectContent>
                                {["2 parafusos de dupla compressão", "4 âncoras Silverlock"].map(value => <SelectItem key={value} value={value}>{displayArthroplastyOption(value)}</SelectItem>)}
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Retináculo Lateral */}
                    {patelarTecnica.tecnicas.includes("Liberação / Alongamento Retináculo Lateral") && (
                      <div className="border rounded-xl p-3 space-y-2 bg-muted/20">
                        <Label className="text-sm font-semibold">{ta("lateralRetinaculumProcedure")}</Label>
                        <Select value={patelarTecnica.retinaculoLateral} onValueChange={(v) => setPatelarTecnica(p => ({ ...p, retinaculoLateral: v }))}>
                          <SelectTrigger><SelectValue placeholder={ta("select")} /></SelectTrigger>
                          <SelectContent>
                            {["Liberação artroscópica", "Alongamento em Z", "Liberação + sutura"].map(value => <SelectItem key={value} value={value}>{displayArthroplastyOption(value)}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                    )}

                    {/* Observações */}
                    <div className="space-y-2">
                      <Label className="text-sm">{ta("patellarNotes")}</Label>
                      <input type="text" className="w-full border rounded-lg px-3 py-2 text-sm"
                        placeholder={ta("additionalTechniqueDetails")}
                        value={patelarTecnica.observacoes}
                        onChange={(e) => setPatelarTecnica(p => ({ ...p, observacoes: e.target.value }))} />
                    </div>
                  </div>
                )}

                {/* ── LESÕES OSTEOCONDRAIS — Técnica Cirúrgica ── */}
                {isOsteocondral && (
                  <div className="space-y-4">
                    <div className="flex items-center gap-2">
                      <div className="h-6 w-1.5 rounded-full bg-teal-500" />
                      <h3 className="font-bold text-base">{ta("osteochondralTechnique")}</h3>
                    </div>

                    {/* Detalhes conforme procedimento selecionado */}
                    {osteocondralTecnica.procedimentos.includes("Nanofraturas") && (
                      <div className="border-2 border-teal-100 rounded-xl p-4 space-y-3 bg-white/60 dark:bg-slate-800/40">
                        <p className="text-xs font-bold uppercase tracking-widest text-teal-600">{ta("marrowStimulationDetails")}</p>
                        <div className="grid sm:grid-cols-2 gap-4">
                          <div className="space-y-2">
                            <Label className="text-sm">{ta("nanofractureTechnique")}</Label>
                            <Select value={osteocondralTecnica.nanofraturasTecnica} onValueChange={(v) => setOsteocondralTecnica(p => ({ ...p, nanofraturasTecnica: v }))}>
                              <SelectTrigger><SelectValue placeholder={ta("select")} /></SelectTrigger>
                              <SelectContent>
                                {["Subchondroplasty", "NanoFx padrão", "NanoFx com membrana"].map(value => <SelectItem key={value} value={value}>{displayArthroplastyOption(value)}</SelectItem>)}
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                      </div>
                    )}

                    {osteocondralTecnica.procedimentos.includes("OATS") && (
                      <div className="border-2 border-emerald-100 rounded-xl p-4 space-y-3 bg-white/60 dark:bg-slate-800/40">
                        <p className="text-xs font-bold uppercase tracking-widest text-emerald-700">{ta("oatsDetails")}</p>
                        <div className="grid sm:grid-cols-2 gap-4">
                          <div className="space-y-2">
                            <Label className="text-sm">{ta("plugDiameter")}</Label>
                            <Select value={osteocondralTecnica.oatsDiametroMm} onValueChange={(v) => setOsteocondralTecnica(p => ({ ...p, oatsDiametroMm: v }))}>
                              <SelectTrigger><SelectValue placeholder={ta("select")} /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="6mm">6 mm</SelectItem>
                                <SelectItem value="8mm">8 mm</SelectItem>
                                <SelectItem value="10mm">10 mm</SelectItem>
                                <SelectItem value="misto">{displayArthroplastyOption("misto")}</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="space-y-2">
                            <Label className="text-sm">{ta("plugCount")}</Label>
                            <Input type="number" placeholder={ta("exampleThree")} value={osteocondralTecnica.oatsNumPlugs} onChange={(e) => setOsteocondralTecnica(p => ({ ...p, oatsNumPlugs: e.target.value }))} />
                          </div>
                        </div>
                      </div>
                    )}

                    {osteocondralTecnica.procedimentos.includes("Fixação OCD") && (
                      <div className="border-2 border-indigo-100 dark:border-indigo-800/40 rounded-xl p-4 space-y-3 bg-white/60 dark:bg-slate-800/40">
                        <p className="text-xs font-bold uppercase tracking-widest text-indigo-700">{ta("ocdFixationDetails")}</p>
                        <div className="space-y-2">
                          <Label className="text-sm">{ta("fixationType")}</Label>
                          <Select value={osteocondralTecnica.fixacaoOcdTipo} onValueChange={(v) => setOsteocondralTecnica(p => ({ ...p, fixacaoOcdTipo: v }))}>
                            <SelectTrigger><SelectValue placeholder={ta("select")} /></SelectTrigger>
                            <SelectContent>
                              {["Parafusos bioabsorvíveis", "Parafusos metálicos reabsorvíveis", "Pinos de fibrina", "Parafusos Herbert"].map(value => <SelectItem key={value} value={value}>{displayArthroplastyOption(value)}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    )}

                    {/* Adjuvantes Biológicos */}
                    <div className="border rounded-xl p-4 space-y-3 bg-muted/20">
                      <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">{ta("biologicalAdjuncts")}</p>
                      <div className="grid sm:grid-cols-2 gap-3">
                        {([
                          ["PRP", "PRP — Plasma Rico em Plaquetas"],
                          ["BMA", "BMA — Aspirado de Medula Óssea"],
                          ["Ácido hialurônico intra-articular", "Ácido hialurônico intra-articular"],
                        ] as [string, string][]).map(([val, label]) => {
                          const sel = osteocondralTecnica.adjuvantes.includes(val);
                          return (
                            <div key={val} className="flex items-center space-x-3">
                              <Switch checked={sel} onCheckedChange={(c) => setOsteocondralTecnica(p => ({
                                ...p,
                                adjuvantes: c ? [...p.adjuvantes, val] : p.adjuvantes.filter(x => x !== val),
                              }))} />
                              <Label className="text-sm">{displayArthroplastyOption(label)}</Label>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label className="text-sm font-semibold">{ta("osteochondralNotes")}</Label>
                      <Textarea placeholder={ta("additionalIntraoperativeDetails")} rows={3} value={osteocondralTecnica.observacoes} onChange={(e) => setOsteocondralTecnica(p => ({ ...p, observacoes: e.target.value }))} />
                    </div>
                  </div>
                )}

                {/* ── ARTROPLASTIAS — Técnica Cirúrgica ── */}
                {isArtroplastia && (
                  <div className="space-y-5">
                    <div className="flex items-center gap-2">
                      <div className="h-6 w-1.5 rounded-full bg-indigo-500" />
                      <h3 className="font-bold text-base text-indigo-800">{ta("arthroplastyTechnique")}</h3>
                    </div>

                    {/* Avaliação Clínica Pré-operatória */}
                    <div className="border-2 border-indigo-200 rounded-xl p-4 space-y-4 bg-indigo-50/20">
                      <p className="text-xs font-bold uppercase tracking-widest text-indigo-700">{ta("preoperativeAssessment")}</p>

                      {/* Alinhamento + Gonartrose */}
                      <div className="grid sm:grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label className="text-sm">{ta("limbAlignment")}</Label>
                          <div className="flex flex-wrap gap-2">
                            {["Neutro", "Varo", "Valgo", "Recurvato", "Flexo", "Rígido"].map(opt => {
                              const sel = artroplastiaTecnica.alinhamentoMembro.includes(opt);
                              return (
                                <button key={opt} type="button"
                                  onClick={() => setArtroplastiaTecnica(p => ({
                                    ...p,
                                    alinhamentoMembro: p.alinhamentoMembro.includes(opt)
                                      ? p.alinhamentoMembro.filter(x => x !== opt)
                                      : [...p.alinhamentoMembro, opt],
                                  }))}
                                  className={`text-xs px-3 py-1.5 rounded-lg border-2 transition-all ${sel ? "border-indigo-500 bg-indigo-100 dark:bg-indigo-900/40 text-indigo-800 dark:text-indigo-300 font-semibold" : "border-muted hover:border-indigo-300 text-muted-foreground"}`}>
                                  {displayArthroplastyOption(opt)}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                        <div className="space-y-2">
                          <Label className="text-sm">{ta("instability")}</Label>
                          <div className="flex gap-2">
                            {["Ausente", "Presente"].map(opt => {
                              const sel = artroplastiaTecnica.instabilidade === opt;
                              return (
                                <button key={opt} type="button"
                                  onClick={() => setArtroplastiaTecnica(p => ({ ...p, instabilidade: opt, instabilidadeGrau: opt === "Ausente" ? "" : p.instabilidadeGrau }))}
                                  className={`text-xs px-3 py-1.5 rounded-lg border-2 transition-all ${sel ? "border-indigo-500 bg-indigo-100 dark:bg-indigo-900/40 text-indigo-800 dark:text-indigo-300 font-semibold" : "border-muted hover:border-indigo-300 text-muted-foreground"}`}>
                                  {displayArthroplastyOption(opt)}
                                </button>
                              );
                            })}
                          </div>
                          {artroplastiaTecnica.instabilidade === "Presente" && (
                            <Input placeholder={ta("gradeDescription")} value={artroplastiaTecnica.instabilidadeGrau}
                              onChange={(e) => setArtroplastiaTecnica(p => ({ ...p, instabilidadeGrau: e.target.value }))} />
                          )}
                          <div className="space-y-1">
                            <p className="text-xs text-muted-foreground">{ta("ahlbackClassification")}</p>
                            <div className="flex flex-wrap gap-2">
                              {["I", "II", "III", "IV", "V"].map(g => (
                                <button key={g} type="button"
                                  onClick={() => setArtroplastiaTecnica(p => ({ ...p, instabilidadeAhlback: p.instabilidadeAhlback === g ? "" : g }))}
                                  className={`text-xs px-3 py-1.5 rounded-lg border-2 transition-all ${artroplastiaTecnica.instabilidadeAhlback === g ? "border-indigo-500 bg-indigo-100 dark:bg-indigo-900/40 text-indigo-800 dark:text-indigo-300 font-semibold" : "border-muted hover:border-indigo-300 text-muted-foreground"}`}>
                                  Ahlbäck {g}
                                </button>
                              ))}
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Gonartrose */}
                      <div className="grid sm:grid-cols-3 gap-4">
                        <div className="space-y-2">
                          <Label className="text-sm">{ta("medialGonarthrosis")}</Label>
                          <Select value={artroplastiaTecnica.gonartroseMedial} onValueChange={(v) => setArtroplastiaTecnica(p => ({ ...p, gonartroseMedial: v }))}>
                            <SelectTrigger><SelectValue placeholder={ta("select")} /></SelectTrigger>
                            <SelectContent>
                              {["Ausente", "Leve", "Moderada", "Grave"].map(value => <SelectItem key={value} value={value}>{displayArthroplastyOption(value)}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2">
                          <Label className="text-sm">{ta("lateralGonarthrosis")}</Label>
                          <Select value={artroplastiaTecnica.gonartroseLateral} onValueChange={(v) => setArtroplastiaTecnica(p => ({ ...p, gonartroseLateral: v }))}>
                            <SelectTrigger><SelectValue placeholder={ta("select")} /></SelectTrigger>
                            <SelectContent>
                              {["Ausente", "Leve", "Moderada", "Grave"].map(value => <SelectItem key={value} value={value}>{displayArthroplastyOption(value)}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2">
                          <Label className="text-sm">{ta("patellofemoral")}</Label>
                          <Select value={artroplastiaTecnica.femoropatelar} onValueChange={(v) => setArtroplastiaTecnica(p => ({ ...p, femoropatelar: v }))}>
                            <SelectTrigger><SelectValue placeholder={ta("select")} /></SelectTrigger>
                            <SelectContent>
                              {["Ausente", "Leve", "Moderada", "Grave"].map(value => <SelectItem key={value} value={value}>{displayArthroplastyOption(value)}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>

                      {/* Amplitude de Movimento */}
                      <div className="space-y-2">
                        <Label className="text-sm font-medium">{ta("rangeOfMotion")}</Label>
                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                          <div className="space-y-1">
                            <Label className="text-xs text-muted-foreground">{ta("flexionDegrees")}</Label>
                            <Input type="number" placeholder={ta("flexionExample")} value={artroplastiaTecnica.flexaoGraus}
                              onChange={(e) => setArtroplastiaTecnica(p => ({ ...p, flexaoGraus: e.target.value }))} />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs text-muted-foreground">{ta("extensionDegrees")}</Label>
                            <Input type="number" placeholder={ta("extensionExample")} value={artroplastiaTecnica.extensaoGraus}
                              onChange={(e) => setArtroplastiaTecnica(p => ({ ...p, extensaoGraus: e.target.value }))} />
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Infecção */}
                    <div className="border-2 border-rose-100 dark:border-rose-800/40 rounded-xl p-4 space-y-3 bg-rose-50/40 dark:bg-rose-900/20">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-xs font-bold uppercase tracking-widest text-rose-600">{ta("pji")}</p>
                          <p className="text-xs text-muted-foreground mt-0.5">{ta("pjiQuestion")}</p>
                        </div>
                        <div className="flex gap-1.5">
                          {["Não", "Sim"].map(opt => (
                            <button key={opt} type="button"
                              onClick={() => setArtroplastiaTecnica(p => ({
                                ...p,
                                infeccao: opt === "Sim",
                                infeccaoTempo: opt === "Não" ? "" : p.infeccaoTempo,
                                infeccaoEtapa: opt === "Não" ? "" : p.infeccaoEtapa,
                                infeccaoOutrasOpcao: opt === "Não" ? "" : p.infeccaoOutrasOpcao,
                                infeccaoArtrodese: opt === "Não" ? "" : p.infeccaoArtrodese,
                                tipo: opt === "Não" ? p.tipo : "",
                              }))}
                              className={`text-xs px-3 py-1.5 rounded-md border-2 transition-all ${(artroplastiaTecnica.infeccao ? "Sim" : "Não") === opt ? (opt === "Sim" ? "border-rose-500 bg-rose-100 dark:bg-rose-900/40 text-rose-800 dark:text-rose-300 font-semibold" : "border-indigo-500 bg-indigo-100 dark:bg-indigo-900/40 text-indigo-800 dark:text-indigo-300 font-semibold") : "border-muted hover:border-rose-300 text-muted-foreground"}`}>
                              {displayArthroplastyOption(opt)}
                            </button>
                          ))}
                        </div>
                      </div>

                      {artroplastiaTecnica.infeccao && (
                        <div className="space-y-3 pt-1">
                          <div>
                            <Label className="text-sm font-medium mb-2 block">{ta("surgicalStage")}</Label>
                            <div className="flex flex-wrap gap-2">
                              {(["1 Tempo", "2 Tempos"] as const).map(t => {
                                const sel = artroplastiaTecnica.infeccaoTempo === t;
                                return (
                                  <button key={t} type="button"
                                    onClick={() => setArtroplastiaTecnica(p => ({
                                      ...p,
                                      infeccaoTempo: sel ? "" : t,
                                      infeccaoEtapa: "",
                                      infeccaoOutrasOpcao: "",
                                      infeccaoArtrodese: "",
                                      tipo: "",
                                    }))}
                                    className={`flex-1 text-sm py-2 rounded-lg border-2 transition-all font-medium ${sel ? "border-rose-500 bg-rose-100 text-rose-800" : "border-muted hover:border-rose-300 text-muted-foreground"}`}>
                                    {sel ? "✓ " : ""}{displayArthroplastyOption(t)}
                                  </button>
                                );
                              })}
                              {/* Outras Opções */}
                              <button type="button"
                                onClick={() => setArtroplastiaTecnica(p => ({
                                  ...p,
                                  infeccaoTempo: p.infeccaoTempo === "Outras Opções" ? "" : "Outras Opções",
                                  infeccaoEtapa: "",
                                  infeccaoOutrasOpcao: "",
                                  infeccaoArtrodese: "",
                                  tipo: "",
                                }))}
                                className={`text-sm px-3 py-2 rounded-lg border-2 transition-all font-medium ${artroplastiaTecnica.infeccaoTempo === "Outras Opções" ? "border-rose-500 bg-rose-100 text-rose-800" : "border-muted hover:border-rose-300 text-muted-foreground"}`}>
                                {artroplastiaTecnica.infeccaoTempo === "Outras Opções" ? "✓ " : ""}{ta("otherOptions")}
                              </button>
                            </div>

                            {/* Sub-opções de Outras Opções */}
                            {artroplastiaTecnica.infeccaoTempo === "Outras Opções" && (
                              <div className="mt-3 space-y-3">
                                <div className="flex gap-2">
                                  {(["Artrodese", "Amputação"] as const).map(op => {
                                    const sel = artroplastiaTecnica.infeccaoOutrasOpcao === op;
                                    return (
                                      <button key={op} type="button"
                                        onClick={() => setArtroplastiaTecnica(p => ({
                                          ...p,
                                          infeccaoOutrasOpcao: sel ? "" : op,
                                          infeccaoArtrodese: "",
                                        }))}
                                        className={`flex-1 text-sm py-2 rounded-lg border-2 transition-all font-medium ${sel ? "border-rose-500 bg-rose-100 dark:bg-rose-900/40 text-rose-800 dark:text-rose-300" : "border-muted hover:border-rose-300 text-muted-foreground"}`}>
                                        {sel ? "✓ " : ""}{displayArthroplastyOption(op)}
                                      </button>
                                    );
                                  })}
                                </div>

                                {artroplastiaTecnica.infeccaoOutrasOpcao === "Artrodese" && (
                                  <div className="space-y-1.5">
                                    <Label className="text-xs text-muted-foreground font-medium">{ta("arthrodesisFixation")}</Label>
                                    <div className="flex flex-col gap-1.5">
                                      {(["Fixador externo circular", "Fixador externo linear", "Placa e parafusos", "Parafusos canulados", "Haste intramedular"] as const).map(op => {
                                        const sel = artroplastiaTecnica.infeccaoArtrodese === op;
                                        return (
                                          <button key={op} type="button"
                                            onClick={() => setArtroplastiaTecnica(p => ({ ...p, infeccaoArtrodese: sel ? "" : op }))}
                                            className={`text-sm px-3 py-2 rounded-lg border-2 transition-all text-left ${sel ? "border-rose-500 bg-rose-100 dark:bg-rose-900/40 text-rose-800 dark:text-rose-300 font-semibold" : "border-muted hover:border-rose-300 text-muted-foreground"}`}>
                                            {sel ? "✓ " : ""}{displayArthroplastyOption(op)}
                                          </button>
                                        );
                                      })}
                                    </div>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>

                          {artroplastiaTecnica.infeccaoTempo === "2 Tempos" && (
                            <div>
                              <Label className="text-sm font-medium mb-2 block">{ta("currentStage")}</Label>
                              <div className="flex flex-col gap-1.5">
                                {([
                                  "Retirada de Prótese e Colocação de Espaçador",
                                  "Troca de Espaçador",
                                  "Retirada de Espaçador e Colocação de Prótese",
                                ] as const).map(etapa => {
                                  const sel = artroplastiaTecnica.infeccaoEtapa === etapa;
                                  return (
                                    <button key={etapa} type="button"
                                      onClick={() => setArtroplastiaTecnica(p => ({
                                        ...p,
                                        infeccaoEtapa: sel ? "" : etapa,
                                        tipo: "",
                                      }))}
                                      className={`text-sm px-3 py-2 rounded-lg border-2 transition-all text-left ${sel ? "border-rose-500 bg-rose-100 dark:bg-rose-900/40 text-rose-800 dark:text-rose-300 font-semibold" : "border-muted hover:border-rose-300 text-muted-foreground"}`}>
                                      {sel ? "✓ " : ""}{displayArthroplastyOption(etapa)}
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Tipo de Acesso — oculto na Amputação */}
                    {artroplastiaTecnica.infeccaoOutrasOpcao !== "Amputação" && <div className="border-2 border-indigo-100 dark:border-indigo-800/40 rounded-xl p-4 space-y-3 bg-white/60 dark:bg-slate-800/40">
                      <p className="text-xs font-bold uppercase tracking-widest text-indigo-600">{ta("approachType")}</p>
                      <div className="flex flex-wrap gap-2">
                        {["Parapatelar Lateral", "Parapatelar Medial", "Subvasto", "Midvasto", "Snip", "Osteotomia da TAT"].map(opt => {
                          const sel = artroplastiaTecnica.tipoAcesso === opt;
                          return (
                            <button key={opt} type="button"
                              onClick={() => setArtroplastiaTecnica(p => ({ ...p, tipoAcesso: sel ? "" : opt }))}
                              className={`text-xs px-3 py-1.5 rounded-lg border-2 transition-all ${sel ? "border-indigo-500 bg-indigo-100 dark:bg-indigo-900/40 text-indigo-800 dark:text-indigo-300 font-semibold" : "border-muted hover:border-indigo-300 text-muted-foreground"}`}>
                              {sel ? "✓ " : ""}{displayArthroplastyOption(opt)}
                            </button>
                          );
                        })}
                      </div>
                    </div>}

                    {/* Tipo de Prótese */}
                    {/* Visível quando: sem infecção, ou infecção 1-tempo, ou infecção 2-tempos + etapa "Retirada de Espaçador e Colocação de Prótese" */}
                    {(!artroplastiaTecnica.infeccao ||
                      artroplastiaTecnica.infeccaoTempo === "1 Tempo" ||
                      artroplastiaTecnica.infeccaoEtapa === "Retirada de Espaçador e Colocação de Prótese") && (
                    <div className="border-2 border-indigo-200 rounded-xl p-4 space-y-4 bg-indigo-50/30">
                      <p className="text-xs font-bold uppercase tracking-widest text-indigo-700">{ta("prosthesisType")}</p>
                      <div className="space-y-2">
                        <Label className="text-sm">{ta("type")}</Label>
                        <Select value={artroplastiaTecnica.tipo} onValueChange={(v) => setArtroplastiaTecnica(p => ({ ...p, tipo: v }))}>
                          <SelectTrigger><SelectValue placeholder={ta("select")} /></SelectTrigger>
                          <SelectContent>
                            {!artroplastiaTecnica.infeccao && (
                              <>
                                {["UKA", "TKA"].map(value => <SelectItem key={value} value={value}>{displayArthroplastyOption(value)}</SelectItem>)}
                              </>
                            )}
                            {["Revisão", "Hinge"].map(value => <SelectItem key={value} value={value}>{displayArthroplastyOption(value)}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>

                      {artroplastiaTecnica.tipo === "TKA" && (
                        <div className="space-y-2">
                          <Label className="text-sm">{ta("technologyUsed")}</Label>
                          <div className="grid sm:grid-cols-3 gap-2">
                            {["Convencional", "Navegada", "Robótica"].map(tech => {
                              const sel = artroplastiaTecnica.tecnologia === tech;
                              return (
                                <button key={tech} type="button"
                                  onClick={() => setArtroplastiaTecnica(p => ({ ...p, tecnologia: tech }))}
                                  className={`text-sm px-3 py-2 rounded-lg border-2 transition-all ${sel ? "border-indigo-500 bg-indigo-100 dark:bg-indigo-900/40 text-indigo-800 dark:text-indigo-300 font-semibold" : "border-muted hover:border-indigo-300 text-muted-foreground"}`}>
                                  {sel ? "✓ " : ""}{displayArthroplastyOption(tech)}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {artroplastiaTecnica.tipo === "Revisão" && (
                        <div className="space-y-2">
                          <Label className="text-sm">{ta("revisedComponents")}</Label>
                          <Select value={artroplastiaTecnica.revisaoComponentes} onValueChange={(v) => setArtroplastiaTecnica(p => ({ ...p, revisaoComponentes: v }))}>
                            <SelectTrigger><SelectValue placeholder={ta("select")} /></SelectTrigger>
                            <SelectContent>
                              {["Tibial + Femoral", "Tibial isolada", "Femoral isolada", "Patelar isolada"].map(value => <SelectItem key={value} value={value}>{displayArthroplastyOption(value)}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </div>
                      )}

                      {/* Defeito Ósseo — AORI (Revisão e Hinge) */}
                      {(artroplastiaTecnica.tipo === "Revisão" || artroplastiaTecnica.tipo === "Hinge") && (
                        <div className="space-y-3 border-t border-indigo-100 pt-3">
                          <div className="flex items-center justify-between">
                            <div>
                              <p className="text-sm font-semibold">{ta("boneDefect")}</p>
                              <p className="text-xs text-muted-foreground">{ta("aoriClassification")}</p>
                            </div>
                            <div className="flex gap-1.5">
                              {["Não", "Sim"].map(opt => (
                                <button key={opt} type="button"
                                  onClick={() => setArtroplastiaTecnica(p => ({
                                    ...p,
                                    defeitoOsseo: opt === "Sim",
                                    aoriGrauFemoral: opt === "Não" ? "" : p.aoriGrauFemoral,
                                    aoriGrauTibial: opt === "Não" ? "" : p.aoriGrauTibial,
                                  }))}
                                  className={`text-xs px-3 py-1.5 rounded-md border-2 transition-all ${(artroplastiaTecnica.defeitoOsseo ? "Sim" : "Não") === opt ? "border-indigo-500 bg-indigo-100 dark:bg-indigo-900/40 text-indigo-800 dark:text-indigo-300 font-semibold" : "border-muted hover:border-indigo-300 text-muted-foreground"}`}>
                                  {displayArthroplastyOption(opt)}
                                </button>
                              ))}
                            </div>
                          </div>
                          {artroplastiaTecnica.defeitoOsseo && (
                            <div className="grid sm:grid-cols-2 gap-4">
                              {([
                                ["Fêmur", "aoriGrauFemoral"],
                                ["Tíbia", "aoriGrauTibial"],
                              ] as [string, "aoriGrauFemoral" | "aoriGrauTibial"][]).map(([label, field]) => (
                                <div key={field} className="space-y-2 rounded-lg border border-indigo-100 dark:border-indigo-800/40 bg-white/50 dark:bg-slate-800/30 p-3">
                                  <p className="text-xs font-bold text-indigo-700 uppercase tracking-wide">{displayArthroplastyOption(label)}</p>
                                  <div className="space-y-1.5">
                                    {([
                                      ["1", "Pequena perda óssea"],
                                      ["2A", "Perda metafisária em um lado"],
                                      ["2B", "Perda metafisária bilateral"],
                                      ["3", "Perda metafisária maciça"],
                                    ] as [string, string][]).map(([grade, desc]) => {
                                      const sel = artroplastiaTecnica[field] === grade;
                                      return (
                                        <button key={grade} type="button"
                                          onClick={() => setArtroplastiaTecnica(p => ({ ...p, [field]: sel ? "" : grade }))}
                                          className={`w-full text-left px-3 py-2 rounded-lg border-2 transition-all ${sel ? "border-indigo-500 bg-indigo-100 text-indigo-800" : "border-muted hover:border-indigo-300 text-muted-foreground"}`}>
                                          <span className="text-xs font-bold">{sel ? "✓ " : ""}{ta("aoriType", { grade })}</span>
                                          <span className="text-xs ml-1 opacity-75">— {displayArthroplastyOption(desc)}</span>
                                        </button>
                                      );
                                    })}
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}

                      {/* Tipo de Implante */}
                      <div className="space-y-2">
                        <Label className="text-sm">{ta("polyethyleneImplantType")}</Label>
                        <div className="flex flex-wrap gap-2">
                          {["PS (Posterior Stabilized)", "CR (Cruciate Retaining)", "Ultracongruente", "Medial Pivot", "Medial Congruente"].map(opt => {
                            const sel = artroplastiaTecnica.tipoImplante === opt;
                            return (
                              <button key={opt} type="button"
                                onClick={() => setArtroplastiaTecnica(p => ({ ...p, tipoImplante: sel ? "" : opt }))}
                                className={`text-xs px-3 py-1.5 rounded-lg border-2 transition-all ${sel ? "border-indigo-500 bg-indigo-100 dark:bg-indigo-900/40 text-indigo-800 dark:text-indigo-300 font-semibold" : "border-muted hover:border-indigo-300 text-muted-foreground"}`}>
                                {sel ? "✓ " : ""}{displayArthroplastyOption(opt)}
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      {/* Marca da Prótese */}
                      <div className="space-y-2">
                        <Label className="text-sm">{ta("prosthesisBrand")}</Label>
                        <Select value={artroplastiaTecnica.marca} onValueChange={(v) => setArtroplastiaTecnica(p => ({ ...p, marca: v }))}>
                          <SelectTrigger><SelectValue placeholder={ta("selectBrand")} /></SelectTrigger>
                          <SelectContent className="max-h-56 overflow-y-auto w-[--radix-select-trigger-width]">
                            {[
                              "Zimmer Biomet",
                              "Stryker",
                              "DePuy Synthes (J&J)",
                              "Smith & Nephew",
                              "MicroPort Orthopedics",
                              "Mathys",
                              "Amplitude",
                              "Corentec",
                              "Aesculap (B. Braun)",
                              "Corin",
                              "Baumer",
                              "Collibrí",
                              "MDT",
                              "IMPOL",
                              "Exactech",
                              "Lima Corporate",
                              "Wright Medical",
                              "Sartori",
                              "Medacta",
                            ].map(b => <SelectItem key={b} value={b}>{b}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>

                      {/* Tamanhos de componentes */}
                      {artroplastiaTecnica.tipo !== "" && (
                        <div className="space-y-3 pt-1 border-t border-indigo-100">
                          <p className="text-xs font-semibold text-indigo-600 uppercase tracking-wider">{ta("componentSizes")}</p>
                          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                            <div className="space-y-1">
                              <Label className="text-xs text-muted-foreground">{ta("femoralComponent")}</Label>
                              <Input
                                placeholder={ta("componentExample")}
                                value={artroplastiaTecnica.componenteFemoral}
                                onChange={e => setArtroplastiaTecnica(p => ({ ...p, componenteFemoral: e.target.value }))}
                                className="text-sm h-9"
                              />
                            </div>
                            <div className="space-y-1">
                              <Label className="text-xs text-muted-foreground">{ta("tibialComponent")}</Label>
                              <Input
                                placeholder={ta("componentExample")}
                                value={artroplastiaTecnica.componenteTibial}
                                onChange={e => setArtroplastiaTecnica(p => ({ ...p, componenteTibial: e.target.value }))}
                                className="text-sm h-9"
                              />
                            </div>
                            <div className="space-y-1 col-span-3 sm:col-span-1">
                              <Label className="text-xs text-muted-foreground">{ta("polyethyleneMm")}</Label>
                              <div className="flex flex-wrap gap-1.5">
                                {[8, 10, 12, 14, 16, 20].map(n => (
                                  <button key={n} type="button"
                                    onClick={() => setArtroplastiaTecnica(p => ({ ...p, polietileno: p.polietileno === String(n) ? "" : String(n) }))}
                                    className={`text-xs px-2.5 py-1 rounded-md border-2 transition-all ${artroplastiaTecnica.polietileno === String(n) ? "border-indigo-500 bg-indigo-100 dark:bg-indigo-900/40 text-indigo-800 dark:text-indigo-300 font-semibold" : "border-muted hover:border-indigo-300 text-muted-foreground"}`}>
                                    {n}
                                  </button>
                                ))}
                                <Input
                                  placeholder={ta("other")}
                                  value={[8,10,12,14,16,20].includes(Number(artroplastiaTecnica.polietileno)) ? "" : artroplastiaTecnica.polietileno}
                                  onChange={e => setArtroplastiaTecnica(p => ({ ...p, polietileno: e.target.value }))}
                                  className="text-xs h-7 w-16 px-2"
                                />
                              </div>
                            </div>
                          </div>

                          {/* Prótese de Pátela */}
                          <div className="space-y-2 pt-1 border-t border-indigo-100">
                            <Label className="text-xs font-semibold text-indigo-600 uppercase tracking-wider">{ta("patellarProsthesis")}</Label>
                            <div className="flex flex-wrap gap-2">
                              {["Não realizada", "Realizada"].map(opt => {
                                const sel = artroplastiaTecnica.protesePatelar === opt;
                                return (
                                  <button key={opt} type="button"
                                    onClick={() => setArtroplastiaTecnica(p => ({ ...p, protesePatelar: sel ? "" : opt }))}
                                    className={`text-xs px-3 py-1.5 rounded-lg border-2 transition-all ${sel ? "border-indigo-500 bg-indigo-100 dark:bg-indigo-900/40 text-indigo-800 dark:text-indigo-300 font-semibold" : "border-muted hover:border-indigo-300 text-muted-foreground"}`}>
                                    {sel ? "✓ " : ""}{displayArthroplastyOption(opt)}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Hastes — disponíveis para próteses definitivas, inclusive ATJ.
                          Não esconder por falta de tipo restaurado no rascunho:
                          a escolha é opcional e deve poder ser registrada antes
                          da seleção final do modelo da prótese. */}
                      {(!artroplastiaTecnica.infeccao ||
                        artroplastiaTecnica.infeccaoEtapa === "Retirada de Espaçador e Colocação de Prótese" ||
                        artroplastiaTecnica.infeccaoTempo === "1 Tempo") && (
                        <div className="space-y-3 pt-1 border-t border-indigo-100">
                          <div>
                            <p className="text-xs font-semibold text-indigo-600 uppercase tracking-wider">{ta("stems")}</p>
                            <p className="mt-0.5 text-xs text-muted-foreground">{ta("stemsHelp")}</p>
                          </div>
                          <div className="grid sm:grid-cols-2 gap-4">

                            {/* Haste Femoral */}
                            <div className="space-y-2 rounded-lg border border-indigo-100 dark:border-indigo-800/40 bg-white/50 dark:bg-slate-800/30 p-3">
                              <div className="flex items-center justify-between">
                                <Label className="text-sm font-medium">{ta("femoralStem")}</Label>
                                <div className="flex gap-1.5">
                                  {["Não", "Sim"].map(opt => (
                                    <button key={opt} type="button"
                                      onClick={() => setArtroplastiaTecnica(p => ({ ...p, hasteFemoral: opt, hasteFemoralTamanho: opt === "Não" ? "" : p.hasteFemoralTamanho, hasteFemoralEspessura: opt === "Não" ? "" : p.hasteFemoralEspessura }))}
                                      className={`text-xs px-2.5 py-1 rounded-md border transition-all ${artroplastiaTecnica.hasteFemoral === opt ? "border-indigo-500 bg-indigo-100 dark:bg-indigo-900/40 text-indigo-800 dark:text-indigo-300 font-semibold" : "border-muted text-muted-foreground hover:border-indigo-300"}`}>
                                      {displayArthroplastyOption(opt)}
                                    </button>
                                  ))}
                                </div>
                              </div>
                              {artroplastiaTecnica.hasteFemoral === "Sim" && (
                                <div className="grid grid-cols-1 gap-2 pt-1 sm:grid-cols-2">
                                  <div className="space-y-1">
                                    <Label className="text-xs text-muted-foreground">{ta("size")}</Label>
                                    <Input placeholder={ta("stemSizeExample")} value={artroplastiaTecnica.hasteFemoralTamanho}
                                      onChange={e => setArtroplastiaTecnica(p => ({ ...p, hasteFemoralTamanho: e.target.value }))}
                                      className="text-sm h-8" />
                                  </div>
                                  <div className="space-y-1">
                                    <Label className="text-xs text-muted-foreground">{ta("thickness")}</Label>
                                    <Input placeholder={ta("stemThicknessExample")} value={artroplastiaTecnica.hasteFemoralEspessura}
                                      onChange={e => setArtroplastiaTecnica(p => ({ ...p, hasteFemoralEspessura: e.target.value }))}
                                      className="text-sm h-8" />
                                  </div>
                                </div>
                              )}
                            </div>

                            {/* Haste Tibial */}
                            <div className="space-y-2 rounded-lg border border-indigo-100 dark:border-indigo-800/40 bg-white/50 dark:bg-slate-800/30 p-3">
                              <div className="flex items-center justify-between">
                                <Label className="text-sm font-medium">{ta("tibialStem")}</Label>
                                <div className="flex gap-1.5">
                                  {["Não", "Sim"].map(opt => (
                                    <button key={opt} type="button"
                                      onClick={() => setArtroplastiaTecnica(p => ({ ...p, hasteTibial: opt, hasteTibialTamanho: opt === "Não" ? "" : p.hasteTibialTamanho, hasteTibialEspessura: opt === "Não" ? "" : p.hasteTibialEspessura }))}
                                      className={`text-xs px-2.5 py-1 rounded-md border transition-all ${artroplastiaTecnica.hasteTibial === opt ? "border-indigo-500 bg-indigo-100 dark:bg-indigo-900/40 text-indigo-800 dark:text-indigo-300 font-semibold" : "border-muted text-muted-foreground hover:border-indigo-300"}`}>
                                      {displayArthroplastyOption(opt)}
                                    </button>
                                  ))}
                                </div>
                              </div>
                              {artroplastiaTecnica.hasteTibial === "Sim" && (
                                <div className="grid grid-cols-1 gap-2 pt-1 sm:grid-cols-2">
                                  <div className="space-y-1">
                                    <Label className="text-xs text-muted-foreground">{ta("size")}</Label>
                                    <Input placeholder={ta("stemSizeExample")} value={artroplastiaTecnica.hasteTibialTamanho}
                                      onChange={e => setArtroplastiaTecnica(p => ({ ...p, hasteTibialTamanho: e.target.value }))}
                                      className="text-sm h-8" />
                                  </div>
                                  <div className="space-y-1">
                                    <Label className="text-xs text-muted-foreground">{ta("thickness")}</Label>
                                    <Input placeholder={ta("stemThicknessExample")} value={artroplastiaTecnica.hasteTibialEspessura}
                                      onChange={e => setArtroplastiaTecnica(p => ({ ...p, hasteTibialEspessura: e.target.value }))}
                                      className="text-sm h-8" />
                                  </div>
                                </div>
                              )}
                            </div>

                          </div>
                        </div>
                      )}
                    </div>
                    )} {/* fim condicional Tipo de Prótese */}

                    {/* Fixação — oculto em etapas de espaçador (sem prótese) */}
                    {(!artroplastiaTecnica.infeccao ||
                      artroplastiaTecnica.infeccaoEtapa === "Retirada de Espaçador e Colocação de Prótese" ||
                      artroplastiaTecnica.infeccaoTempo === "1 Tempo") && (
                    <div className="border-2 border-indigo-100 dark:border-indigo-800/40 rounded-xl p-4 space-y-3 bg-white/60 dark:bg-slate-800/40">
                      <p className="text-xs font-bold uppercase tracking-widest text-indigo-600">{ta("fixationTypeHeading")}</p>
                      <div className="grid sm:grid-cols-3 gap-2">
                        {["Cimentada", "Não Cimentada", "Híbrida"].map(val => {
                          const sel = artroplastiaTecnica.fixacao === val;
                          return (
                            <button key={val} type="button"
                              onClick={() => setArtroplastiaTecnica(p => ({ ...p, fixacao: val }))}
                              className={`text-sm px-3 py-2.5 rounded-lg border-2 text-left transition-all ${sel ? "border-indigo-500 bg-indigo-100 dark:bg-indigo-900/40 text-indigo-800 dark:text-indigo-300 font-semibold" : "border-muted hover:border-indigo-300"}`}>
                              <span className="font-medium block">{sel ? "✓ " : ""}{displayArthroplastyOption(val)}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    )}

                    {/* Garrote + TXA — oculto na Amputação */}
                    {artroplastiaTecnica.infeccaoOutrasOpcao !== "Amputação" && <div className="border-2 border-indigo-100 dark:border-indigo-800/40 rounded-xl p-4 space-y-4 bg-white/60 dark:bg-slate-800/40">
                      <p className="text-xs font-bold uppercase tracking-widest text-indigo-600">{ta("bleedingControl")}</p>
                      <div className="grid sm:grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label className="text-sm">{ta("tourniquet")}</Label>
                          <Select value={artroplastiaTecnica.garrote} onValueChange={(v) => setArtroplastiaTecnica(p => ({ ...p, garrote: v }))}>
                            <SelectTrigger><SelectValue placeholder={ta("select")} /></SelectTrigger>
                            <SelectContent>
                              {["Durante toda a cirurgia", "Somente na cimentação", "Sem garrote"].map(value => <SelectItem key={value} value={value}>{displayArthroplastyOption(value)}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2">
                          <Label className="text-sm">{ta("txa")}</Label>
                          <Select value={artroplastiaTecnica.txa} onValueChange={(v) => setArtroplastiaTecnica(p => ({ ...p, txa: v }))}>
                            <SelectTrigger><SelectValue placeholder={ta("select")} /></SelectTrigger>
                            <SelectContent>
                              {["Local", "Venosa", "Ambas", "Não utilizado"].map(value => <SelectItem key={value} value={value}>{displayArthroplastyOption(value)}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    </div>}

                    {/* Calços — oculto em etapas de espaçador (sem prótese) */}
                    {(!artroplastiaTecnica.infeccao ||
                      artroplastiaTecnica.infeccaoEtapa === "Retirada de Espaçador e Colocação de Prótese" ||
                      artroplastiaTecnica.infeccaoTempo === "1 Tempo") && (
                    <div className="border-2 border-indigo-100 dark:border-indigo-800/40 rounded-xl p-4 space-y-4 bg-white/60 dark:bg-slate-800/40">
                      <p className="text-xs font-bold uppercase tracking-widest text-indigo-600">{ta("augments")}</p>
                      <div className="grid sm:grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label className="text-sm font-medium">{ta("femoral")}</Label>
                          {["Distal Medial", "Distal Lateral", "Posterior Lateral", "Posterior Medial", "Anterior"].map(opt => {
                            const sel = artroplastiaTecnica.calcosFemoral.includes(opt);
                            return (
                              <button key={opt} type="button"
                                onClick={() => setArtroplastiaTecnica(p => ({ ...p, calcosFemoral: sel ? p.calcosFemoral.filter(x => x !== opt) : [...p.calcosFemoral, opt] }))}
                                className={`w-full text-sm text-left px-3 py-1.5 rounded-lg border transition-all ${sel ? "border-indigo-400 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-800 dark:text-indigo-300" : "border-muted hover:border-indigo-200 text-muted-foreground"}`}>
                                {sel ? "✓ " : ""}{displayArthroplastyOption(opt)}
                              </button>
                            );
                          })}
                        </div>
                        <div className="space-y-2">
                          <Label className="text-sm font-medium">{ta("tibial")}</Label>
                          {["Medial", "Lateral"].map(opt => {
                            const sel = artroplastiaTecnica.calcosTibial.includes(opt);
                            return (
                              <button key={opt} type="button"
                                onClick={() => setArtroplastiaTecnica(p => ({ ...p, calcosTibial: sel ? p.calcosTibial.filter(x => x !== opt) : [...p.calcosTibial, opt] }))}
                                className={`w-full text-sm text-left px-3 py-1.5 rounded-lg border transition-all ${sel ? "border-indigo-400 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-800 dark:text-indigo-300" : "border-muted hover:border-indigo-200 text-muted-foreground"}`}>
                                {sel ? "✓ " : ""}{displayArthroplastyOption(opt)}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                    )} {/* fim condicional Calços */}

                    {/* Cone Metafisário — oculto em etapas de espaçador */}
                    {(!artroplastiaTecnica.infeccao ||
                      artroplastiaTecnica.infeccaoEtapa === "Retirada de Espaçador e Colocação de Prótese" ||
                      artroplastiaTecnica.infeccaoTempo === "1 Tempo") && (
                    <div className="border-2 border-indigo-100 dark:border-indigo-800/40 rounded-xl p-4 space-y-3 bg-white/60 dark:bg-slate-800/40">
                      <p className="text-xs font-bold uppercase tracking-widest text-indigo-600">{ta("metaphysealCone")}</p>
                      <div className="flex flex-wrap gap-2">
                        {["Não", "Sim"].map(opt => {
                          const sel = artroplastiaTecnica.coneMetafisario === opt;
                          return (
                            <button key={opt} type="button"
                              onClick={() => setArtroplastiaTecnica(p => ({
                                ...p,
                                coneMetafisario: opt,
                                coneMetafisarioLocal: opt === "Não" ? "" : p.coneMetafisarioLocal,
                              }))}
                              className={`text-xs px-3 py-1.5 rounded-lg border-2 transition-all ${sel ? "border-indigo-500 bg-indigo-100 dark:bg-indigo-900/40 text-indigo-800 dark:text-indigo-300 font-semibold" : "border-muted hover:border-indigo-300 text-muted-foreground"}`}>
                              {displayArthroplastyOption(opt)}
                            </button>
                          );
                        })}
                      </div>
                      {artroplastiaTecnica.coneMetafisario === "Sim" && (
                        <div className="space-y-1.5">
                          <Label className="text-xs text-muted-foreground">{ta("location")}</Label>
                          <div className="flex flex-wrap gap-2">
                            {["Fêmur", "Tíbia", "Ambos"].map(opt => {
                              const sel = artroplastiaTecnica.coneMetafisarioLocal === opt;
                              return (
                                <button key={opt} type="button"
                                  onClick={() => setArtroplastiaTecnica(p => ({ ...p, coneMetafisarioLocal: opt }))}
                                  className={`text-xs px-3 py-1.5 rounded-lg border-2 transition-all ${sel ? "border-indigo-500 bg-indigo-100 dark:bg-indigo-900/40 text-indigo-800 dark:text-indigo-300 font-semibold" : "border-muted hover:border-indigo-300 text-muted-foreground"}`}>
                                  {displayArthroplastyOption(opt)}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                    )} {/* fim condicional Cone Metafisário */}

                    <div className="space-y-2">
                      <Label className="text-sm font-semibold">{ta("techniqueNotes")}</Label>
                      <Textarea placeholder={ta("additionalIntraoperativeDetails")} rows={3}
                        value={artroplastiaTecnica.observacoes}
                        onChange={(e) => setArtroplastiaTecnica(p => ({ ...p, observacoes: e.target.value }))} />
                    </div>
                  </div>
                )}

                {!isLigamentar && !isMeniscal && !isPatelar && !isOrtobiologico && !isOsteocondral && !isArtroplastia && !isOsteotomia && (
                  <p className="text-sm text-muted-foreground">{ta("genericProcedureHelp")}</p>
                )}

              </div>
            )}

            {/* Observações */}
            {step === observationsStep && (
              <div className="space-y-6">
                 <h2 className="text-xl font-semibold">{tn("observationsAndFinish")}</h2>
                <div className="space-y-2">
                   <Label>{tn("clinicalObservations")}</Label>
                  <Textarea
                     placeholder={tn("clinicalObservationsPlaceholder")}
                    rows={6}
                    value={formData.observacoes}
                    onChange={(e) => updateData("observacoes", e.target.value)}
                  />
                </div>

                {/* Registro Intraoperatório — fotos e vídeos */}
                <div className="space-y-3">
                  <div>
                     <h3 className="font-semibold text-sm">{tn("intraoperativeRecord")}</h3>
                     <p className="text-xs text-muted-foreground">{tn("intraoperativeMediaHelp")}</p>
                  </div>
                  <SurgeryMedia surgeryId={draftId} ensureSurgeryId={ensureDraftForMedia} />
                </div>

                <div className="border rounded-xl p-4 bg-muted/30 space-y-2">
                   <h3 className="font-semibold text-sm">{tn("recordSummary")}</h3>
                  <div className="grid sm:grid-cols-2 gap-2 text-sm">
                     <div><span className="text-muted-foreground">{t("patientPrefix")}</span> {selectedPatient?.nome || "—"}</div>
                     <div><span className="text-muted-foreground">{t("date")}:</span> {formData.dataCirurgia || "—"}</div>
                     <div><span className="text-muted-foreground">{t("typePrefix")}</span> {tiposSelected.map(displayOption).join(" + ") || "—"}</div>
                     <div><span className="text-muted-foreground">{t("side")}:</span> {displayOption(clinicalData.lado) || "—"}</div>
                    {isLigamentar && (
                      <div className="sm:col-span-2">
                         <span className="text-muted-foreground">{tn("ligaments")}</span> {formData.ligamentosAcometidos?.join(", ") || "—"}
                      </div>
                    )}
                    {hasLca && (formData.tipoLca || "Reconstrução") === "Reparo" ? (
                      <>
                         <div><span className="text-muted-foreground">{tn("acl")}</span> {tn("repair")}</div>
                        {formData.localizacaoLesaoLca && (
                           <div><span className="text-muted-foreground">{t("lesionLocation")}:</span> {displayOption(formData.localizacaoLesaoLca)}</div>
                        )}
                        {formData.fixacaoReparoLca && (
                           <div><span className="text-muted-foreground">{t("fixation")}:</span> {displayOption(formData.fixacaoReparoLca)}</div>
                        )}
                        {formData.internalBrace && (
                          <div><span className="text-muted-foreground">Internal Brace:</span> {formData.internalBrace}</div>
                        )}
                        {formData.preservacaoRemanescente && (
                           <div><span className="text-muted-foreground">{t("preservation")}:</span> {displayOption(formData.preservacaoRemanescente)}</div>
                        )}
                      </>
                    ) : (
                      <>
                        {formData.enxerto && (
                           <div><span className="text-muted-foreground">{t("graft")}:</span> {displayOption(formData.enxerto)}</div>
                        )}
                        {formData.diametroEnxerto && (
                           <div><span className="text-muted-foreground">{tn("diameter")}</span> {formData.diametroEnxerto}</div>
                        )}
                        {formData.flipCutter && (
                           <div><span className="text-muted-foreground">{t("flipCutter")}:</span> {formData.flipCutter}</div>
                        )}
                        {formData.fixacaoFemoral && (
                           <div><span className="text-muted-foreground">{tn("femoralFixationShort")}</span> {displayOption(formData.fixacaoFemoral)}</div>
                        )}
                        {formData.fixacaoTibial && (
                           <div><span className="text-muted-foreground">{tn("tibialFixationShort")}</span> {displayOption(formData.fixacaoTibial)}</div>
                        )}
                        {formData.internalBrace && (
                          <div><span className="text-muted-foreground">Internal Brace:</span> {formData.internalBrace}</div>
                        )}
                        {formData.preservacaoRemanescente && (
                           <div><span className="text-muted-foreground">{t("preservation")}:</span> {displayOption(formData.preservacaoRemanescente)}</div>
                        )}
                      </>
                    )}
                    {formData.reforco && (
                       <div><span className="text-muted-foreground">{tn("reinforcement")}</span> {formData.reforco}</div>
                    )}
                    {formData.lcaAlgorithm?.tecnicaRecomendada && (
                      <div className="sm:col-span-2">
                        <span className="text-muted-foreground">KRIRS:</span>{" "}
                        {getKrirsRiskLabel(getKrirsRiskLevel(
                          formData.lcaAlgorithm.krirsScore,
                          formData.lcaAlgorithm.flagAltoRisco,
                          formData.lcaAlgorithm.krirsInterpretacao,
                        ), locale)} — {formData.lcaAlgorithm.tecnicaRecomendada}
                      </div>
                    )}
                  </div>
                </div>

              </div>
            )}
          </form>
        </CardContent>
      </Card>

      {/* Navigation */}
      <div className="flex flex-col gap-2 pb-[env(safe-area-inset-bottom)] sm:flex-row sm:items-center sm:justify-between sm:gap-3">
        <Button variant="outline" onClick={handleBack} disabled={step === 1} className="w-full gap-2 sm:w-auto">
           <ArrowLeft className="h-4 w-4" /> {t("previous")}
        </Button>

        <div className="flex w-full min-w-0 flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
          {/* Save Draft — available on any step as long as patient is selected */}
          <Button
            type="button"
            variant="outline"
            onClick={saveDraft}
            disabled={isDraftSaving || !formData.patientId}
            className="w-full gap-2 border-amber-300 text-amber-700 hover:bg-amber-50 sm:w-auto"
          >
            {isDraftSaving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <BookmarkCheck className="h-4 w-4" />
            )}
             {isDraftSaving ? t("saving") : draftId ? tn("updateDraft") : t("saveDraft")}
          </Button>

          {step < observationsStep ? (
            <Button onClick={handleNext} className="w-full gap-2 sm:w-auto">
               {t("next")} <ArrowRight className="h-4 w-4" />
            </Button>
          ) : (
            <Button
              onClick={handleSubmit}
              className="w-full gap-2 sm:w-auto"
              disabled={createSurgeryMutation.isPending}
            >
              <Save className="h-4 w-4" />
               {createSurgeryMutation.isPending ? t("saving") : tn("finishRecord")}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
