import { useState, useEffect, useCallback } from "react";
import { useRoute, useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  ArrowLeft, Stethoscope, Calendar, Activity, TrendingUp,
  AlertTriangle, FileText, ChevronRight, User, Hospital,
  Microscope, Brain, Dumbbell, RotateCcw, Loader2, KeyRound,
  CalendarClock,
} from "lucide-react";
import { SurgeryFullSummary } from "@/components/surgery-full-summary";
import { useToast } from "@/hooks/use-toast";
import { useLanguage, useScopedTranslations } from "@/lib/i18n";
import { adminConsoleMessages } from "@/locales/admin-console";
import { getKrirsRiskLabel, getKrirsRiskLevel } from "@/lib/krirs-risk";

// ─── Types ────────────────────────────────────────────────────────────────────
type Surgery = {
  id: number;
  dataCirurgia: string | null;
  tipoCaso: string | null;
  tiposProcedimento: string[];
  ligamentosAcometidos: string[];
  alinhamento: string | null;
  hospital: string | null;
  procedimentosDetalhados: string | null;
  patientSexo: string | null;
  patientLado: string | null;
  createdAt: string;
};

type FullSurgery = Surgery & {
  enxerto?: string | null;
  diametroEnxerto?: string | null;
  fixacaoFemoral?: string | null;
  fixacaoTibial?: string | null;
  reforco?: string | null;
  tuneisFemorais?: string | null;
  tuneisTibiais?: string | null;
  grauAlinhamento?: string | null;
  procedimentoRealizado?: string | null;
  patient?: { id: number; sexo?: string | null; lado?: string | null } | null;
  exameLigamentar?: Record<string, any> | null;
  lcaAlgorithm?: Record<string, any> | null;
  lcpReconstruction?: Record<string, any> | null;
  cpmReconstruction?: Record<string, any> | null;
  cplReconstruction?: Record<string, any> | null;
  procedimentoMeniscal?: Record<string, any> | null;
  examePatelar?: Record<string, any> | null;
  picsScore?: Record<string, any> | null;
  followups?: Followup[];
};

type Followup = {
  id: number;
  tempo: string;
  dataAvaliacao: string | null;
  ikdc?: number | null;
  lysholm?: number | null;
  koosDor?: number | null;
  koosQualidade?: number | null;
  tegner?: number | null;
  vasDor?: number | null;
  aclRsi?: number | null;
  kujala?: number | null;
  retornoEsporte?: boolean | null;
  falha?: boolean | null;
  complicacoes?: string[] | null;
  observacoes?: string | null;
};

type DoctorInfo = {
  id: number;
  nome: string;
  email: string;
  crm?: string | null;
  crmEstado?: string | null;
  estrangeiro?: boolean;
  paisOrigem?: string | null;
  isFree?: boolean;
  temporaryAccessExpiresAt?: string | null;
  telefone?: string | null;
  cpf?: string | null;
  dataNascimento?: string | null;
  endereco?: string | null;
  cidade?: string | null;
  estado?: string | null;
  cep?: string | null;
  especialidade?: string | null;
  whatsappBusiness?: string | null;
  aprovado?: boolean;
  isAdmin?: boolean;
  createdAt?: string;
};

// ─── Labels ───────────────────────────────────────────────────────────────────
const TEMPO_LABEL_KEYS: Record<string, keyof typeof adminConsoleMessages["pt-BR"]> = {
  "3m": "clinical.months3", "6m": "clinical.months6", "1a": "clinical.year1", "2a": "clinical.years2", "5a": "clinical.years5",
};

const EXAME_LABEL_KEYS: Record<string, keyof typeof adminConsoleMessages["pt-BR"]> = {
  lachman: "clinical.lachman", gavetaNeutra: "clinical.anteriorDrawer", pivotShift: "clinical.pivotShift",
  aderTest: "clinical.aderTest", gavetaRotInterna: "clinical.internalRotationDrawer",
  estresseValgo0: "clinical.valgusStress0", estresseValgo30: "clinical.valgusStress30",
  estresseVaro0: "clinical.varusStress0", estresseVaro30: "clinical.varusStress30",
  gavetaPosterior: "clinical.posteriorDrawer", sagSign: "clinical.sagSign",
  quadricepsAtivo: "clinical.activeQuadriceps", dialTest: "clinical.dialTest",
  recurvato: "clinical.recurvatum", gavetaRotExterna: "clinical.externalRotationDrawer",
  hiperextensao: "clinical.hyperextension",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmtDate(d: string | null | undefined, locale: string) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString(locale);
}

function parseReforco(raw: string | null | undefined, t: (key: keyof typeof adminConsoleMessages["pt-BR"]) => string): string[] {
  if (!raw) return [];
  try {
    const r = JSON.parse(raw);
    const out: string[] = [];
    if (r.let) out.push(t("clinical.let"));
    if (r.lal) {
      let s = t("clinical.lal");
      if (r.lalBanda) s += ` (${r.lalBanda})`;
      if (r.lalEnxerto) s += ` · ${r.lalEnxerto}`;
      out.push(s);
    }
    if (r.loa) {
      let s = t("clinical.loa");
      if (r.loaEnxerto) s += ` · ${r.loaEnxerto}`;
      if (r.loaFixacao) s += ` · ${t("explicit.172")}: ${r.loaFixacao}`;
      out.push(s);
    }
    return out;
  } catch { return []; }
}

function parseProcedimentos(surgery: Surgery): string[] {
  const items: string[] = [];
  if (surgery.ligamentosAcometidos?.length) items.push(...surgery.ligamentosAcometidos);
  if (surgery.tiposProcedimento?.length) {
    surgery.tiposProcedimento.forEach(t => {
      if (t !== "Lesão Ligamentar" || surgery.ligamentosAcometidos?.length === 0) items.push(t);
    });
  }
  try {
    if (surgery.procedimentosDetalhados) {
      const d = JSON.parse(surgery.procedimentosDetalhados);
      const ost = d.osteotomia;
      if (ost?.dupla) items.push("HTO + DFO");
      else if (ost?.tibial) items.push(`HTO${ost.tibialAngulo ? ` ${ost.tibialAngulo}°` : ""}`);
      else if (ost?.femoral) items.push(`DFO${ost.femoralAngulo ? ` ${ost.femoralAngulo}°` : ""}`);
    }
  } catch { /* ignore */ }
  return [...new Set(items)];
}

// ─── UI sub-components ────────────────────────────────────────────────────────
function Row({ label, value }: { label: string; value?: string | number | null }) {
  if (value == null || value === "") return null;
  return (
    <div className="flex justify-between items-start gap-4 py-1.5 border-b border-border/30 last:border-0">
      <span className="text-xs text-muted-foreground shrink-0">{label}</span>
      <span className="text-xs font-medium text-right">{value}</span>
    </div>
  );
}

function ProfileRow({ label, value }: { label: string; value?: string | number | null }) {
  if (value == null || value === "") return null;
  return (
    <div className="flex justify-between items-start gap-4 py-2 border-b border-border/30 last:border-0">
      <span className="text-xs text-muted-foreground shrink-0">{label}</span>
      <span className="text-xs font-medium text-right break-all">{value}</span>
    </div>
  );
}

function SectionBlock({ title, icon: Icon, children }: { title: string; icon?: any; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 pb-1 border-b-2 border-primary/20">
        {Icon && <Icon className="h-3.5 w-3.5 text-primary" />}
        <h3 className="text-xs font-bold uppercase tracking-wide text-primary">{title}</h3>
      </div>
      <div>{children}</div>
    </div>
  );
}

function ScorePill({ label, value }: { label: string; value: number | null | undefined }) {
  if (value == null) return null;
  return (
    <div className="flex flex-col items-center min-w-[52px] bg-muted/50 rounded px-2 py-1">
      <span className="text-[10px] text-muted-foreground">{label}</span>
      <span className="text-sm font-bold">{value.toFixed(0)}</span>
    </div>
  );
}

// ─── Surgery detail panel ─────────────────────────────────────────────────────
function AdminSurgerySheet({ surgeryId, onClose }: { surgeryId: number | null; onClose: () => void }) {
  const { locale } = useLanguage();
  const t = useScopedTranslations(adminConsoleMessages);
  const [detail, setDetail] = useState<FullSurgery | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!surgeryId) { setDetail(null); return; }
    setLoading(true);
    fetch(`/api/admin/surgeries/${surgeryId}`, { credentials: "same-origin" })
      .then(r => r.json())
      .then(d => { setDetail(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [surgeryId]);

  const open = surgeryId !== null;

  const renderExame = (exame: Record<string, any>) => {
    const skip = ["id", "surgeryId", "createdAt"];
    return Object.entries(exame)
      .filter(([k, v]) => !skip.includes(k) && v != null)
      .map(([k, v]) => {
        const labelKey = EXAME_LABEL_KEYS[k];
        const label = labelKey ? t(labelKey) : k;
        let val: string;
        if (typeof v === "boolean") val = v ? t("clinical.positive") : t("clinical.negative");
        else val = String(v);
        return <Row key={k} label={label} value={val} />;
      });
  };

  const renderProcedimentosDetalhados = (raw: string) => {
    try {
      const d = JSON.parse(raw);
      const sections: React.ReactNode[] = [];

      // ── Osteotomia ──
      const ost = d.osteotomia;
      if (ost) {
        const ostRows: React.ReactNode[] = [];
        if (ost.dupla) {
          const tp = [ost.duplaTibialLado, ost.duplaTibialTipo && `de ${ost.duplaTibialTipo}`, ost.duplaTibialAngulo && `${ost.duplaTibialAngulo}°`].filter(Boolean).join(" ");
          const fp = [ost.duplaFemoralLado, ost.duplaFemoralTipo && `de ${ost.duplaFemoralTipo}`, ost.duplaFemoralAngulo && `${ost.duplaFemoralAngulo}°`].filter(Boolean).join(" ");
          ostRows.push(<Row key="dupla" label={t("explicit.224")} value={[tp && `Tibial: ${tp}`, fp && `Femoral: ${fp}`].filter(Boolean).join(" / ")} />);
        } else {
          if (ost.tibial) {
            ostRows.push(<Row key="htotipo" label={t("explicit.141")} value={[ost.tibialLado, ost.tibialTipo && `de ${ost.tibialTipo}`, ost.tibialAngulo && `${ost.tibialAngulo}°`].filter(Boolean).join(" ")} />);
          }
          if (ost.femoral) {
            ostRows.push(<Row key="dfotipo" label={t("explicit.142")} value={[ost.femoralLado, ost.femoralTipo && `de ${ost.femoralTipo}`, ost.femoralAngulo && `${ost.femoralAngulo}°`].filter(Boolean).join(" ")} />);
          }
        }
        if (ost.slop) ostRows.push(<Row key="slop" label={t("explicit.143")} value={ost.slopGrau ? `${ost.slopGrau}°` : t("explicit.001")} />);
        if (ost.enxertoOsseo) ostRows.push(<Row key="enxosseo" label={t("explicit.144")} value={ost.enxertoOsseoTipo ?? t("explicit.001")} />);
        if (ostRows.length > 0) {
          sections.push(
            <div key="ost" className="space-y-0.5">
              <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground mb-1">{t("explicit.225")}</p>
              {ostRows}
            </div>
          );
        }
      }

      // ── LCM ──
      const lcm = d.lcm as { tecnica?: string; enxerto?: string; fixacaoProximal?: string; fixacaoDistal?: string } | undefined;
      if (lcm && (lcm.tecnica || lcm.enxerto || lcm.fixacaoProximal || lcm.fixacaoDistal)) {
        sections.push(
          <div key="lcm" className="space-y-0.5">
            <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground mb-1">{t("explicit.226")}</p>
            <Row label={t("explicit.145")} value={lcm.tecnica} />
            <Row label={t("explicit.146")} value={lcm.enxerto} />
            <Row label={t("explicit.227")} value={lcm.fixacaoProximal} />
            <Row label={t("explicit.228")} value={lcm.fixacaoDistal} />
          </div>
        );
      }

      // ── Ortobiológicos ──
      const orto = d.ortobiologico as Record<string, any> | undefined;
      if (orto) {
        const ortoMap: Record<string, string> = {
          bma: "BMA", haBma: t("explicit.147"), prp: "PRP", prpAh: "PRP + AH",
          hidrogelBma: "Hidrogel + BMA", hidrogel: "Hidrogel", nanofat: "Nanofat", coaguloFibrina: t("explicit.148"),
        };
        const tipos = Object.entries(ortoMap).filter(([k]) => orto[k]).map(([, label]) => label);
        const diagTipos: string[] = Array.isArray(orto.diagnosticoTipos) ? orto.diagnosticoTipos
          : orto.diagnosticoTipo ? [orto.diagnosticoTipo] : [];
        const diagMap: Record<string, string> = { osteoartrose: "Osteoartrose", condromalacia: "Condromalacia", lesaoMeniscal: t("explicit.149"), lesaoLigamentar: t("explicit.150"), edemaOsseo: t("explicit.151"), lesaoMuscular: t("explicit.152") };
        if (tipos.length > 0 || diagTipos.length > 0) {
          sections.push(
            <div key="orto" className="space-y-0.5">
              <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground mb-1">{t("explicit.002")}</p>
              {tipos.length > 0 && <Row label={t("explicit.229")} value={tipos.join(", ")} />}
              {diagTipos.length > 0 && <Row label={t("explicit.153")} value={diagTipos.map(t => diagMap[t] ?? t).join(", ")} />}
              <Row label={t("explicit.230")} value={orto.diagnosticoAhlback ? `Grau ${orto.diagnosticoAhlback}` : null} />
            </div>
          );
        }
      }

      // ── Artroplastia ──
      const art = d.artroplastia as Record<string, any> | undefined;
      if (art && (art.tipo || art.fixacao || art.tecnologia || art.compartimento)) {
        sections.push(
          <div key="art" className="space-y-0.5">
            <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground mb-1">{t("explicit.003")}</p>
            <Row label={t("explicit.050")} value={art.tipo === "UKA" ? "UKA — Unicompartimental" : art.tipo === "TKA" ? t("explicit.004") : art.tipo} />
            <Row label={t("explicit.231")} value={art.compartimento} />
            <Row label={t("explicit.232")} value={art.tecnologia} />
            <Row label={t("explicit.154")} value={art.fixacao} />
            <Row label={t("explicit.155")} value={art.alinhamentoMembro} />
            <Row label={t("explicit.233")} value={art.instabilidade === "Presente" ? `Presente${art.instabilidadeGrau ? ` — ${art.instabilidadeGrau}` : ""}` : art.instabilidade} />
            <Row label={t("explicit.234")} value={[art.gonartroseMedial, art.gonartroseMedialAhlback && `Ahlbäck ${art.gonartroseMedialAhlback}`].filter(Boolean).join(" — ")} />
            <Row label={t("explicit.235")} value={art.gonartroseLateral} />
            <Row label={t("explicit.236")} value={art.femoropatelar} />
            <Row label={t("explicit.156")} value={art.flexaoGraus ? `${art.flexaoGraus}°` : null} />
            <Row label={t("explicit.157")} value={art.extensaoGraus != null && art.extensaoGraus !== "" ? `${art.extensaoGraus}°` : null} />
            <Row label={t("explicit.237")} value={art.garrote} />
            <Row label={t("explicit.158")} value={art.txa} />
            {art.revisaoComponentes && <Row label={t("explicit.159")} value={art.revisaoComponentes} />}
            {art.calcosFemoral?.length > 0 && <Row label={t("explicit.160")} value={(art.calcosFemoral as string[]).join(", ")} />}
            {art.calcosTibial?.length > 0 && <Row label={t("explicit.161")} value={(art.calcosTibial as string[]).join(", ")} />}
            {art.observacoes && <Row label={t("explicit.162")} value={art.observacoes} />}
          </div>
        );
      }

      return sections.length > 0 ? <div className="space-y-3">{sections}</div> : null;
    } catch { return null; }
  };

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-xl overflow-y-auto p-0">
        <SheetHeader className="px-5 pt-5 pb-3 border-b border-border sticky top-0 bg-background z-10">
          <SheetTitle className="text-base">{t("explicit.005")}</SheetTitle>
          {detail && (
            <p className="text-xs text-muted-foreground">
              {fmtDate(detail.dataCirurgia, locale)} · {detail.hospital || t("explicit.006")} · ID #{detail.id}
            </p>
          )}
        </SheetHeader>

        <div className="px-5 py-4 space-y-5">
          {loading && (
            <div className="space-y-3">
              {[1,2,3].map(i => <Skeleton key={i} className="h-20 w-full rounded-lg" />)}
            </div>
          )}

          {!loading && detail && (() => {
            const exame = detail.exameLigamentar;
            const lca = detail.lcaAlgorithm;
            const lcp = detail.lcpReconstruction;
            const cpm = detail.cpmReconstruction;
            const cpl = detail.cplReconstruction;
            const menisco = detail.procedimentoMeniscal;
            const patelar = detail.examePatelar;
            const pics = detail.picsScore;
            const followups = detail.followups ?? [];
            const reforcos = parseReforco(detail.reforco, t);

            const hasExame = exame && Object.keys(exame).some(k => !["id","surgeryId","createdAt"].includes(k) && exame[k] != null);
            const hasLca = lca && Object.keys(lca).some(k => !["id","surgeryId","createdAt"].includes(k) && lca[k] != null);
            const hasLcp = lcp && Object.keys(lcp).some(k => !["id","surgeryId","createdAt"].includes(k) && lcp[k] != null);
            const hasCpm = cpm && Object.keys(cpm).some(k => !["id","surgeryId","createdAt"].includes(k) && cpm[k] != null);
            const hasCpl = cpl && Object.keys(cpl).some(k => !["id","surgeryId","createdAt"].includes(k) && cpl[k] != null);
            const hasMenisco = menisco && Object.keys(menisco).some(k => !["id","surgeryId"].includes(k) && menisco[k] != null) && !(detail.tiposProcedimento ?? []).includes("Artroplastias");
            const hasPatelar = patelar && Object.keys(patelar).some(k => !["id","surgeryId","createdAt"].includes(k) && patelar[k] != null);
            const hasTecnica = detail.enxerto || detail.diametroEnxerto || detail.fixacaoFemoral || detail.fixacaoTibial || reforcos.length > 0;

            return (
              <>
                {/* 1. Dados Básicos */}
                <SectionBlock title={t("explicit.007")} icon={Calendar}>
                  <Row label={t("explicit.163")} value={fmtDate(detail.dataCirurgia, locale)} />
                  <Row label={t("explicit.164")} value={detail.hospital} />
                  <Row label={t("explicit.165")} value={detail.patient?.sexo ?? detail.patientSexo} />
                  <Row label={t("explicit.166")} value={detail.patient?.lado ?? detail.patientLado} />
                  <Row label={t("doctor.caseType")} value={detail.tipoCaso} />
                  <Row label={t("explicit.167")} value={detail.alinhamento} />
                  <Row label={t("explicit.168")} value={detail.grauAlinhamento} />
                  {(detail.tiposProcedimento ?? []).length > 0 && (
                    <div className="py-1.5">
                      <p className="text-xs text-muted-foreground mb-1">{t("staff.procedures")}</p>
                      <div className="flex flex-wrap gap-1">
                        {detail.tiposProcedimento.map((p: string) => (
                          <Badge key={p} variant="outline" className="text-xs">{p}</Badge>
                        ))}
                      </div>
                    </div>
                  )}
                  {(detail.ligamentosAcometidos ?? []).length > 0 && (
                    <div className="py-1.5 border-t border-border/30">
                      <p className="text-xs text-muted-foreground mb-1">{t("explicit.238")}</p>
                      <div className="flex flex-wrap gap-1">
                        {detail.ligamentosAcometidos.map((l: string) => (
                          <Badge key={l}>{l === "PLC" ? "CPL" : l}</Badge>
                        ))}
                      </div>
                    </div>
                  )}
                </SectionBlock>

                {/* 2. Exame Físico */}
                {hasExame && (
                  <SectionBlock title={t("explicit.008")} icon={Stethoscope}>
                    {renderExame(exame!)}
                  </SectionBlock>
                )}

                {/* 3. Osteotomia / Artroplastia / Ortobiológicos / LCM */}
                {detail.procedimentosDetalhados && (() => {
                  const nodes = renderProcedimentosDetalhados(detail.procedimentosDetalhados!);
                  return nodes ? (
                    <SectionBlock title={t("explicit.009")} icon={Activity}>
                      {nodes}
                    </SectionBlock>
                  ) : null;
                })()}

                {/* 4. Técnica LCA */}
                {hasTecnica && (
                  <SectionBlock title={t("explicit.010")} icon={Microscope}>
                    <Row label={t("explicit.146")} value={detail.enxerto} />
                    <Row label={t("explicit.169")} value={detail.diametroEnxerto} />
                    <Row label={t("explicit.170")} value={detail.tuneisFemorais} />
                    <Row label={t("explicit.171")} value={detail.tuneisTibiais} />
                    <Row label={t("explicit.172")} value={detail.fixacaoFemoral} />
                    <Row label={t("explicit.173")} value={detail.fixacaoTibial} />
                    {reforcos.length > 0 && (
                      <div className="py-1.5 border-t border-border/30">
                        <p className="text-xs text-muted-foreground mb-1">{t("explicit.011")}</p>
                        <ul className="text-xs space-y-0.5">
                          {reforcos.map((r, i) => <li key={i} className="font-medium">· {r}</li>)}
                        </ul>
                      </div>
                    )}
                    <Row label={t("explicit.174")} value={detail.procedimentoRealizado} />
                  </SectionBlock>
                )}

                {/* 5. LCA Algorithm */}
                {hasLca && (
                  <SectionBlock title={t("explicit.239")} icon={Brain}>
                    {(lca!.krirsInterpretacao != null || lca!.krirsScore != null) && (
                      <Row
                        label={t("explicit.240")}
                        value={getKrirsRiskLabel(
                          getKrirsRiskLevel(lca!.krirsScore, lca!.flagAltoRisco, lca!.krirsInterpretacao),
                          locale,
                        )}
                      />
                    )}
                    <Row label={t("explicit.175")} value={lca!.tecnicaRecomendada} />
                    <Row label={t("explicit.176")} value={lca!.nivelAtividade} />
                    <Row label={t("explicit.241")} value={lca!.esportePivot != null ? (lca!.esportePivot ? t("explicit.001") : t("explicit.012")) : null} />
                    <Row label={t("explicit.177")} value={lca!.lesaoOssea != null ? (lca!.lesaoOssea ? t("explicit.001") : t("explicit.012")) : null} />
                    <Row label={t("explicit.178")} value={lca!.lesaoAssociada != null ? (lca!.lesaoAssociada ? t("explicit.001") : t("explicit.012")) : null} />
                    <Row label={t("explicit.179")} value={lca!.frouxidaoContralateral != null ? (lca!.frouxidaoContralateral ? t("explicit.001") : t("explicit.012")) : null} />
                    <Row label={t("explicit.242")} value={lca!.hiperlaxidade != null ? (lca!.hiperlaxidade ? t("explicit.001") : t("explicit.012")) : null} />
                    <Row label={t("explicit.180")} value={lca!.falhaPrev != null ? (lca!.falhaPrev ? t("explicit.001") : t("explicit.012")) : null} />
                  </SectionBlock>
                )}

                {/* 6. LCP */}
                {hasLcp && (
                  <SectionBlock title={t("explicit.013")} icon={RotateCcw}>
                    <Row label={t("explicit.181")} value={lcp!.grauLesao} />
                    <Row label={t("explicit.145")} value={lcp!.tecnica} />
                    <Row label={t("explicit.182")} value={lcp!.enxertoFemoral} />
                    <Row label={t("explicit.183")} value={lcp!.enxertoTibial} />
                    <Row label={t("explicit.184")} value={lcp!.diametroFemoral} />
                    <Row label={t("explicit.185")} value={lcp!.diametroTibial} />
                    <Row label={t("explicit.172")} value={lcp!.fixacaoFemoral} />
                    <Row label={t("explicit.173")} value={lcp!.fixacaoTibial} />
                    <Row label={t("explicit.243")} value={lcp!.fixacaoAnteromedial} />
                    <Row label={t("explicit.244")} value={lcp!.fixacaoPosterolateral} />
                    <Row label={t("explicit.186")} value={lcp!.justificativa} />
                  </SectionBlock>
                )}

                {/* 7. CPM */}
                {hasCpm && (
                  <SectionBlock title={t("explicit.014")} icon={Activity}>
                    <Row label={t("explicit.187")} value={
                      cpm!.abordagem === "lcm_isolado" ? "LCM Isolado"
                      : cpm!.abordagem === "lcm_lop" ? "LCM + LOP"
                      : cpm!.abordagem
                    } />
                    {(cpm!.lcmTecnica || cpm!.lcmEnxerto) && (
                      <div className="pt-1">
                        <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground mb-0.5">LCM</p>
                        <Row label={t("explicit.145")} value={cpm!.lcmTecnica} />
                        <Row label={t("explicit.146")} value={cpm!.lcmEnxerto} />
                        <Row label={t("explicit.227")} value={cpm!.lcmFixacaoProximal} />
                        <Row label={t("explicit.228")} value={cpm!.lcmFixacaoDistal} />
                      </div>
                    )}
                    {(cpm!.lopTecnica || cpm!.lopEnxerto) && (
                      <div className="pt-1">
                        <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground mb-0.5">LOP</p>
                        <Row label={t("explicit.145")} value={cpm!.lopTecnica} />
                        <Row label={t("explicit.146")} value={cpm!.lopEnxerto} />
                        <Row label={t("explicit.154")} value={cpm!.lopFixacao} />
                      </div>
                    )}
                    <Row label={t("explicit.186")} value={cpm!.justificativa} />
                  </SectionBlock>
                )}

                {/* 8. CPL */}
                {hasCpl && (
                  <SectionBlock title={t("explicit.015")} icon={Activity}>
                    <Row label={t("explicit.145")} value={cpl!.tecnica} />
                    {(cpl!.enxertos ?? []).filter((e: any) => e.nome).map((e: any, i: number) => (
                      <Row key={i} label={`Enxerto ${i + 1}`} value={`${e.nome}${e.diametro ? ` — Ø ${e.diametro}` : ""}`} />
                    ))}
                    <Row label={t("explicit.188")} value={cpl!.fixacaoFemoral1} />
                    <Row label={t("explicit.189")} value={cpl!.fixacaoFemoral2} />
                    <Row label={t("explicit.190")} value={cpl!.fixacaoFibular} />
                    <Row label={t("explicit.191")} value={cpl!.fixacaoTibial} />
                    <Row label={t("explicit.192")} value={cpl!.reaArtroscopica != null ? (cpl!.reaArtroscopica ? t("explicit.001") : t("explicit.012")) : null} />
                  </SectionBlock>
                )}

                {/* 9. Menisco */}
                {hasMenisco && (
                  <SectionBlock title={t("explicit.193")} icon={Activity}>
                    {/* Estímulo biológico */}
                    {menisco!.estimuloBiologico && (
                      <div className="flex items-start gap-2 px-3 py-2 rounded-lg border border-green-300 bg-green-50 text-green-800 mb-2 text-xs">
                        <span className="font-bold shrink-0">{t("explicit.245")}</span>
                        <span className="font-medium">
                          {[
                            menisco!.estimuloPerfuracaoIntercondilo && t("explicit.016"),
                            menisco!.estimuloOrtobiologico && (menisco!.estimuloOrtobiologicoTipo
                              ? `Ortobiológico: ${menisco!.estimuloOrtobiologicoTipo}`
                              : t("explicit.017")),
                          ].filter(Boolean).join(" · ") || t("explicit.001")}
                        </span>
                      </div>
                    )}
                    {/* All other menisco fields via labelMap */}
                    {(() => {
                      const SKIP = ["id","surgeryId","createdAt","estimuloBiologico","estimuloPerfuracaoIntercondilo","estimuloOrtobiologico","estimuloOrtobiologicoTipo"];
                      const labelMap: Record<string, string> = {
                        contexto: "Contexto", meniscectomia: "Meniscectomia", sutura: "Sutura",
                        ladoMedial: "Menisco Medial", ladoLateral: "Menisco Lateral",
                        lesaoRampa: t("explicit.194"), lesaoRaiz: "Raiz Posterior",
                        lesaoRaizAnterior: "Raiz Anterior", lesaoCornoAnterior: "Corno Anterior",
                        lesaoCornoPosterior: "Corno Posterior",
                        lesaoAlcaBalde: t("explicit.195"), lesaoRadial: t("explicit.196"),
                        lesaoCorpo: t("explicit.197"), tecnicasSutura: t("explicit.198"),
                        numPontos: t("explicit.199"), tipoFio: t("explicit.200"),
                        fixacaoRaiz: t("explicit.201"),
                        centralizacaoRaiz: t("explicit.202"),
                        centralizacaoMetodo: t("explicit.203"),
                      };
                      return Object.entries(menisco!).flatMap(([k, v]) => {
                        if (SKIP.includes(k) || v == null || v === false || v === "") return [];
                        if (k === "pontosPorTecnica") {
                          try {
                            const parsed: Record<string, number> = typeof v === "string" ? JSON.parse(v as string) : (v as any);
                            return Object.entries(parsed).flatMap(([tec, pts]) => [
                              <Row key={`ppt-${tec}-t`} label={t("explicit.204")} value={tec} />,
                              <Row key={`ppt-${tec}-p`} label={t("explicit.205")} value={String(pts)} />,
                            ]);
                          } catch { return [<Row key={k} label={t("explicit.206")} value={String(v)} />]; }
                        }
                        const label = labelMap[k] ?? k.replace(/([A-Z])/g, " $1").replace(/^./, c => c.toUpperCase()).trim();
                        const display = Array.isArray(v) ? (v as any[]).join(", ")
                          : typeof v === "boolean" ? t("explicit.001")
                          : String(v);
                        return [<Row key={k} label={label} value={display} />];
                      });
                    })()}
                  </SectionBlock>
                )}

                {/* 10. Exame Patelar */}
                {hasPatelar && (
                  <SectionBlock title={t("explicit.246")} icon={Activity}>
                    {(() => {
                      const labelMap: Record<string, string> = {
                        dejourTipo: t("explicit.207"),
                        catonDeschamps: "Caton-Deschamps (CDI)",
                        phiIndex: "Phi Index (Insall-Salvati mod.)",
                        ttTgMm: "TT-TG (mm)",
                        numEpisodios: t("explicit.208"),
                        luxacaoCronica: t("explicit.209"),
                        maltrackingDinamico: "Maltracking Dinâmico",
                        inclinacaoPatelarGraus: t("explicit.210"),
                        lesaoCondral: t("explicit.211"),
                        subluxacaoSemLuxacao: t("explicit.212"),
                        apprehensionTest: "Apprehension Test",
                        jSign: "J-Sign",
                        jSignGrau: t("explicit.266"),
                        retinaculoTenso: t("explicit.213"),
                        clarkSign: t("explicit.214"),
                        tiltPatelar: "Tilt Patelar",
                        glideTest: "Glide Test Patelar",
                      };
                      const SKIP = ["id","surgeryId","createdAt"];
                      return Object.entries(patelar!).flatMap(([k, v]) => {
                        if (SKIP.includes(k) || v == null || v === "" || v === false) return [];
                        const label = labelMap[k] ?? k.replace(/([A-Z])/g, " $1").replace(/^./, c => c.toUpperCase()).trim();
                        const display = typeof v === "boolean" ? t("explicit.001")
                          : typeof v === "number" ? String(v)
                          : String(v);
                        return [<Row key={k} label={label} value={display} />];
                      });
                    })()}
                    {/* Técnica Patelar (from procedimentosDetalhados.patelar) */}
                    {detail.procedimentosDetalhados && (() => {
                      try {
                        const d = JSON.parse(detail.procedimentosDetalhados!);
                        const pat = d.patelar as Record<string, any> | undefined;
                        if (!pat) return null;
                        return (
                          <div className="mt-2 pt-2 border-t border-border/30 space-y-0.5">
                            <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground mb-1">{t("explicit.247")}</p>
                            {pat.tecnicas?.length > 0 && (
                              <div className="py-1">
                                <div className="flex flex-wrap gap-1">
                                  {(pat.tecnicas as string[]).map((t: string) => (
                                    <Badge key={t} variant="outline" className="text-xs">{t}</Badge>
                                  ))}
                                </div>
                              </div>
                            )}
                            <Row label={t("explicit.215")} value={pat.mpflEnxerto} />
                            <Row label={t("explicit.248")} value={pat.mpflFixacaoPatelar} />
                            <Row label={t("explicit.249")} value={pat.mpflFixacaoFemoral} />
                            <Row label={t("explicit.250")} value={pat.mpflTensao} />
                            <Row label={t("explicit.216")} value={pat.ttoTipo} />
                            <Row label={t("explicit.217")} value={pat.ttoFixacao} />
                            <Row label={t("explicit.218")} value={pat.trocleoplastiaTipo} />
                            <Row label={t("explicit.219")} value={pat.trocleoplastiaFixacao} />
                            <Row label={t("explicit.220")} value={pat.retinaculoLateral} />
                            <Row label={t("explicit.162")} value={pat.observacoes} />
                          </div>
                        );
                      } catch { return null; }
                    })()}
                  </SectionBlock>
                )}

                {/* 11. PICS Score */}
                {pics && pics.ptsTotal != null && (
                  <SectionBlock title="PICS Score" icon={Brain}>
                    <Row label={t("clinical.totalPics")} value={pics.ptsTotal} />
                    <Row label={t("explicit.221")} value={pics.risco} />
                  </SectionBlock>
                )}

                {/* 12. Follow-ups */}
                <SectionBlock title={t("explicit.018")} icon={Dumbbell}>
                  {followups.length === 0 ? (
                    <p className="text-xs text-muted-foreground italic py-2">{t("explicit.019")}</p>
                  ) : followups.map((fu) => (
                    <div key={fu.id} className="rounded-lg border border-border/60 bg-muted/20 p-3 mb-2">
                      <div className="flex flex-wrap items-center gap-2 mb-2">
                        <Badge variant="secondary" className="text-xs font-mono">
                          {TEMPO_LABEL_KEYS[fu.tempo] ? t(TEMPO_LABEL_KEYS[fu.tempo]) : fu.tempo}
                        </Badge>
                        {fu.dataAvaliacao && (
                          <span className="text-xs text-muted-foreground">{fmtDate(fu.dataAvaliacao, locale)}</span>
                        )}
                        {fu.retornoEsporte === true && (
                          <Badge variant="outline" className="text-xs text-green-700 border-green-300 bg-green-50">{t("explicit.020")}</Badge>
                        )}
                        {fu.falha === true && (
                          <Badge variant="destructive" className="text-xs">{t("explicit.021")}</Badge>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <ScorePill label="IKDC" value={fu.ikdc} />
                        <ScorePill label="Lysholm" value={fu.lysholm} />
                        <ScorePill label="Tegner" value={fu.tegner} />
                        <ScorePill label="Kujala" value={fu.kujala} />
                        <ScorePill label={t("explicit.251")} value={fu.vasDor} />
                        <ScorePill label="ACL-RSI" value={fu.aclRsi} />
                        <ScorePill label={t("explicit.252")} value={fu.koosDor} />
                        <ScorePill label={t("explicit.253")} value={fu.koosQualidade} />
                      </div>
                      {fu.complicacoes && fu.complicacoes.length > 0 && (
                        <div className="mt-2 flex items-center gap-1 text-xs text-destructive">
                          <AlertTriangle className="h-3 w-3" />
                          {fu.complicacoes.join(", ")}
                        </div>
                      )}
                      {fu.observacoes && (
                        <p className="mt-2 text-xs text-muted-foreground italic">{fu.observacoes}</p>
                      )}
                    </div>
                  ))}
                </SectionBlock>
              </>
            );
          })()}
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ─── Surgery table row ────────────────────────────────────────────────────────
function SurgeryRow({ surgery, onSelect }: { surgery: Surgery; onSelect: (id: number) => void }) {
  const { locale } = useLanguage();
  const procedimentos = parseProcedimentos(surgery);
  return (
    <TableRow
      className="cursor-pointer hover:bg-muted/50 transition-colors"
      onClick={() => onSelect(surgery.id)}
    >
      <TableCell className="font-medium text-sm whitespace-nowrap">
        {surgery.dataCirurgia
          ? new Date(surgery.dataCirurgia).toLocaleDateString(locale)
          : <span className="text-muted-foreground">–</span>}
      </TableCell>
      <TableCell className="text-sm">
        {surgery.tipoCaso
          ? <Badge variant="secondary" className="text-xs font-normal">{surgery.tipoCaso}</Badge>
          : <span className="text-muted-foreground">–</span>}
        {surgery.alinhamento && (
          <span className="ml-1.5 text-xs text-amber-700 font-medium">{surgery.alinhamento}</span>
        )}
      </TableCell>
      <TableCell>
        {procedimentos.length > 0
          ? <div className="flex flex-wrap gap-1">{procedimentos.map(p => <Badge key={p} variant="outline" className="text-xs font-mono">{p}</Badge>)}</div>
          : <span className="text-muted-foreground text-sm">–</span>}
      </TableCell>
      <TableCell className="text-sm text-muted-foreground">{surgery.hospital || <span>–</span>}</TableCell>
      <TableCell className="text-sm">
        {[surgery.patientSexo, surgery.patientLado].filter(Boolean).join(" · ") || <span className="text-muted-foreground">–</span>}
      </TableCell>
      <TableCell className="text-right">
        <ChevronRight className="h-4 w-4 text-muted-foreground ml-auto" />
      </TableCell>
    </TableRow>
  );
}

// ─── Fetch hook ───────────────────────────────────────────────────────────────
function useAdminFetch<T>(url: string) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const load = useCallback(() => {
    fetch(url, { credentials: "same-origin" })
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [url]);
  useEffect(() => { load(); }, [load]);
  return { data, loading };
}

// ─── Main page ────────────────────────────────────────────────────────────────
export default function AdminDoctorView() {
  const [, params] = useRoute("/admin/doctors/:id");
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const t = useScopedTranslations(adminConsoleMessages);
  const { formatDate } = useLanguage();
  const [selectedSurgeryId, setSelectedSurgeryId] = useState<number | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [resetLoading, setResetLoading] = useState(false);

  const doctorId = Number(params?.id);
  const { data: doctor, loading: doctorLoading } = useAdminFetch<DoctorInfo>(`/api/doctors/${doctorId}`);
  const { data: surgeriesRaw, loading: surgeriesLoading } = useAdminFetch<Surgery[]>(`/api/admin/doctors/${doctorId}/surgeries`);
  const surgeries = (surgeriesRaw ?? []).slice().sort((a, b) => {
    const da = a.dataCirurgia ?? a.createdAt;
    const db = b.dataCirurgia ?? b.createdAt;
    return db.localeCompare(da);
  });

  const [isFreeState, setIsFreeState] = useState<boolean | null>(null);
  const [isFreeLoading, setIsFreeLoading] = useState(false);
  const [temporaryAccessExpiresAt, setTemporaryAccessExpiresAt] = useState<string | null>(null);
  const [temporaryAccessLoading, setTemporaryAccessLoading] = useState(false);

  useEffect(() => {
    if (doctor && typeof doctor.isFree === "boolean") {
      setIsFreeState(doctor.isFree);
      setTemporaryAccessExpiresAt(doctor.temporaryAccessExpiresAt ?? null);
    }
  }, [doctor]);

  const handleResetPassword = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!doctor || resetLoading) return;
    setResetLoading(true);
    try {
      const res = await fetch(`/api/admin/doctors/${doctorId}/reset-password`, {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ novaSenha: "123456" }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? t("error"));
      toast({ title: `✅ ${t("doctor.passwordReset", { name: doctor.nome })}`, description: t("doctor.passwordResetDescription") });
    } catch {
      toast({ title: t("doctor.passwordResetError"), variant: "destructive" });
    } finally {
      setResetLoading(false);
    }
  };

  const handleToggleFree = async () => {
    if (isFreeLoading || isFreeState === null) return;
    const next = !isFreeState;
    setIsFreeLoading(true);
    try {
      const resp = await fetch(`/api/admin/doctors/${doctorId}/set-free`, {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isFree: next }),
      });
      if (resp.ok) setIsFreeState(next);
    } finally {
      setIsFreeLoading(false);
    }
  };

  const handleGrantTemporaryAccess = async () => {
    if (temporaryAccessLoading) return;
    if (!window.confirm(t("doctor.temporaryConfirm"))) return;
    setTemporaryAccessLoading(true);
    try {
      const response = await fetch(`/api/admin/doctors/${doctorId}/grant-temporary-access`, {
        method: "PATCH",
        credentials: "same-origin",
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? t("error"));
      setIsFreeState(false);
      setTemporaryAccessExpiresAt(data.temporaryAccessExpiresAt ?? null);
      toast({
        title: t("doctor.temporaryGranted"),
        description: data.temporaryAccessExpiresAt
          ? t("doctor.temporaryUntil", { date: formatDate(data.temporaryAccessExpiresAt) })
          : undefined,
      });
    } catch (error) {
      toast({
        title: error instanceof Error ? error.message : t("staff.operationError"),
        variant: "destructive",
      });
    } finally {
      setTemporaryAccessLoading(false);
    }
  };

  const [selectedSurgeryData, setSelectedSurgeryData] = useState<any>(null);
  const [loadingSurgery, setLoadingSurgery] = useState(false);

  useEffect(() => {
    if (!selectedSurgeryId) { setSelectedSurgeryData(null); return; }
    setLoadingSurgery(true);
    fetch(`/api/admin/surgeries/${selectedSurgeryId}`, { credentials: "same-origin" })
      .then(r => r.json())
      .then(d => { setSelectedSurgeryData(d); setLoadingSurgery(false); })
      .catch(() => setLoadingSurgery(false));
  }, [selectedSurgeryId]);

  if (doctorLoading || surgeriesLoading) {
    return (
      <div className="p-6 md:p-8 max-w-5xl mx-auto space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-32 w-full rounded-xl" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }

  if (!doctor) {
    return (
      <div className="p-8 text-center">
        <p className="text-destructive mb-4">{t("doctor.notFound")}</p>
        <Button variant="outline" onClick={() => setLocation("/admin")}>
          <ArrowLeft className="h-4 w-4 mr-2" /> {t("doctor.back")}
        </Button>
      </div>
    );
  }

  const initials = doctor.nome.split(" ").slice(0, 2).map((n: string) => n[0]).join("").toUpperCase();
  const avatarGradient = "linear-gradient(135deg,#1A365D,#2A4A7F)";

  return (
    <div className="max-w-5xl mx-auto animate-in fade-in">

      {/* ── Mobile navy banner with doctor avatar (hidden md+) ── */}
      <div className="md:hidden" style={{ background: "linear-gradient(135deg, #0A1628 0%, #0D2040 100%)" }}>
        <div className="px-4 pt-5 pb-5">
          <button
            onClick={() => setLocation("/admin")}
            style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, color: "rgba(31,182,225,0.85)", background: "none", border: "none", cursor: "pointer", padding: 0, marginBottom: 12 }}
          >
            <ArrowLeft className="h-3.5 w-3.5" />
             {t("doctor.back")}
          </button>
          <div
            style={{ display: "flex", alignItems: "center", gap: 14, cursor: "pointer" }}
            onClick={() => setProfileOpen(true)}
             title={t("doctor.viewProfile")}
          >
            <div
              style={{ width: 48, height: 48, borderRadius: "50%", background: avatarGradient, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, fontWeight: 700, flexShrink: 0, boxShadow: "0 2px 8px rgba(0,0,0,0.25)" }}
            >
              {initials}
            </div>
            <div className="min-w-0 flex-1">
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <h1 style={{ fontSize: 18, fontWeight: 700, color: "#fff", margin: 0 }} className="truncate">{doctor.nome}</h1>
                <button
                  onClick={handleResetPassword}
                  disabled={resetLoading}
                  title={t("doctor.resetTooltip")}
                  style={{ background: "rgba(255,255,255,0.12)", border: "1px solid rgba(255,255,255,0.25)", borderRadius: 8, padding: "4px 8px", color: "#fff", cursor: "pointer", display: "flex", alignItems: "center", gap: 4, fontSize: 11, fontWeight: 600, flexShrink: 0, opacity: resetLoading ? 0.5 : 1 }}
                >
                  {resetLoading ? <RotateCcw style={{ width: 12, height: 12, animation: "spin 1s linear infinite" }} /> : <KeyRound style={{ width: 12, height: 12 }} />}
                   {t("doctor.resetPassword")}
                </button>
              </div>
              <p style={{ fontSize: 12, color: "rgba(255,255,255,0.55)", margin: "3px 0 0" }}>
                {doctor.estrangeiro && doctor.paisOrigem
                  ? `🌍 ${doctor.paisOrigem}`
                  : `CRM ${doctor.crmEstado ?? ""} ${doctor.crm ?? ""}`}
                {doctor.especialidade ? ` · ${doctor.especialidade}` : ""}
              </p>
            </div>
            <div style={{ textAlign: "center", flexShrink: 0 }}>
              <div style={{ fontSize: 24, fontWeight: 700, color: "#fff" }}>{surgeries.length}</div>
               <div style={{ fontSize: 11, color: "rgba(255,255,255,0.5)" }}>{t("doctor.surgeries")}</div>
            </div>
          </div>
        </div>
      </div>

      <div className="p-6 md:p-8 space-y-6">

      {/* ── Desktop header (hidden on mobile) ── */}
      <div className="hidden md:flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => setLocation("/admin")} className="text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4 mr-1" /> {t("doctor.back")}
        </Button>
      </div>

      {/* Doctor card - desktop only */}
      <Card
        className="hidden md:block border-border shadow-sm cursor-pointer hover:border-primary/40 transition-colors"
        onClick={() => setProfileOpen(true)}
         title={t("doctor.viewProfile")}
      >
        <CardHeader className="pb-3">
          <div className="flex items-start gap-4">
            <div
              className="h-12 w-12 rounded-full flex items-center justify-center flex-shrink-0 text-white font-bold text-lg"
              style={{ background: avatarGradient }}
            >
              {initials}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-3 flex-wrap">
                <CardTitle className="text-xl" style={{ color: "#1A365D" }}>{doctor.nome}</CardTitle>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 gap-1.5 text-xs border-blue-300 text-blue-700 hover:bg-blue-50"
                  disabled={resetLoading}
                  onClick={handleResetPassword}
                  title={t("doctor.resetTooltip")}
                >
                  {resetLoading ? <RotateCcw className="h-3 w-3 animate-spin" /> : <KeyRound className="h-3 w-3" />}
                   {t("doctor.resetPassword")}
                </Button>
              </div>
              <p className="text-sm text-muted-foreground mt-0.5">
                {doctor.estrangeiro && doctor.paisOrigem
                  ? `🌍 ${doctor.paisOrigem}`
                  : `CRM ${doctor.crmEstado ?? ""} ${doctor.crm ?? ""}`}
                {doctor.especialidade && ` · ${doctor.especialidade}`}
              </p>
              {doctor.cidade && doctor.estado && (
                <p className="text-xs text-muted-foreground mt-0.5">{doctor.cidade} – {doctor.estado}</p>
              )}
            </div>
            <div className="flex gap-3 flex-shrink-0">
              <div className="text-center">
                <div className="text-2xl font-bold text-foreground">{surgeries.length}</div>
                 <div className="text-xs text-muted-foreground">{t("doctor.surgeries")}</div>
              </div>
            </div>
          </div>
        </CardHeader>
      </Card>

      {/* ── Isenção de Cobrança ── */}
      {isFreeState !== null && (
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16,
          background: isFreeState ? "linear-gradient(135deg,#f0fdf4,#dcfce7)" : "#fafafa",
          border: `1.5px solid ${isFreeState ? "#86efac" : "#e2e8f0"}`,
          borderRadius: 14, padding: "14px 18px",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{
              width: 36, height: 36, borderRadius: "50%", flexShrink: 0,
              background: isFreeState ? "#16a34a" : "#94a3b8",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <span style={{ fontSize: 16 }}>{isFreeState ? "🎁" : "💳"}</span>
            </div>
            <div>
              <p style={{ fontSize: 13, fontWeight: 700, margin: 0, color: isFreeState ? "#15803d" : "#334155" }}>
                {isFreeState ? t("doctor.exempt") : t("doctor.billingActive")}
              </p>
              <p style={{ fontSize: 11, color: isFreeState ? "#16a34a" : "#94a3b8", margin: "2px 0 0" }}>
                {isFreeState
                  ? t("doctor.exemptDescription")
                  : t("doctor.billingDescription")}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleToggleFree}
            disabled={isFreeLoading}
            style={{
              padding: "7px 16px", borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer",
              background: isFreeState ? "#fee2e2" : "#dbeafe",
              border: `1px solid ${isFreeState ? "#fca5a5" : "#93c5fd"}`,
              color: isFreeState ? "#dc2626" : "#1d4ed8",
              whiteSpace: "nowrap", flexShrink: 0,
              opacity: isFreeLoading ? 0.6 : 1,
            }}
          >
            {isFreeLoading ? t("doctor.saving") : isFreeState ? t("doctor.removeExemption") : t("doctor.makeExempt")}
          </button>
        </div>
      )}

      {/* ── Acesso temporário ── */}
      {isFreeState !== null && (
        <div className="flex flex-col gap-3 rounded-[14px] border border-violet-200 bg-violet-50 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-violet-600 text-white">
              <CalendarClock className="h-4 w-4" />
            </div>
            <div>
              <p className="m-0 text-[13px] font-bold text-violet-900">{t("doctor.temporaryAccess")}</p>
              <p className="mt-0.5 text-[11px] text-violet-700">
                {temporaryAccessExpiresAt && new Date(temporaryAccessExpiresAt).getTime() > Date.now()
                  ? t("doctor.temporaryUntil", { date: formatDate(temporaryAccessExpiresAt) })
                  : t("doctor.temporaryDescription")}
              </p>
            </div>
          </div>
          <Button
            type="button"
            onClick={handleGrantTemporaryAccess}
            disabled={temporaryAccessLoading}
            className="shrink-0 gap-2 bg-violet-600 hover:bg-violet-700"
          >
            {temporaryAccessLoading && <Loader2 className="h-4 w-4 animate-spin" />}
            {temporaryAccessExpiresAt && new Date(temporaryAccessExpiresAt).getTime() > Date.now()
              ? t("doctor.renewTemporary")
              : t("doctor.grantTemporary")}
          </Button>
        </div>
      )}

      {/* Surgeries table */}
      <Card className="border-border shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Calendar className="h-4 w-4 text-primary" />
             {t("doctor.procedures")}
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            {t("doctor.proceduresDescription")}
          </p>
        </CardHeader>
        <CardContent className="p-0">
          {surgeries.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground">
              <Activity className="h-8 w-8 mx-auto mb-2 opacity-40" />
               <p className="text-sm">{t("doctor.noSurgeries")}</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40">
                  <TableHead className="text-xs">{t("doctor.date")}</TableHead>
                  <TableHead className="text-xs">{t("doctor.caseType")}</TableHead>
                  <TableHead className="text-xs">{t("doctor.procedures")}</TableHead>
                  <TableHead className="text-xs">{t("doctor.hospital")}</TableHead>
                  <TableHead className="text-xs">{t("doctor.patient")}</TableHead>
                  <TableHead className="text-right text-xs"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {surgeries.map(s => (
                  <SurgeryRow key={s.id} surgery={s} onSelect={setSelectedSurgeryId} />
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <p className="text-xs text-center text-muted-foreground pb-4">
        <TrendingUp className="h-3 w-3 inline mr-1" />
        {t("doctor.privacy")}
      </p>

      {/* Detail: full procedure summary with patient privacy */}
      {loadingSurgery && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
          <div className="bg-background rounded-xl p-6 shadow-xl flex items-center gap-3">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
             <span className="text-sm font-medium">{t("doctor.loadingSummary")}</span>
          </div>
        </div>
      )}
      <SurgeryFullSummary
        open={selectedSurgeryId !== null && !loadingSurgery && selectedSurgeryData !== null}
        onClose={() => { setSelectedSurgeryId(null); setSelectedSurgeryData(null); }}
        surgery={selectedSurgeryData}
        privacyMode={true}
      />

      {/* ── Doctor full profile sheet ── */}
      <Sheet open={profileOpen} onOpenChange={setProfileOpen}>
        <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto">
          <SheetHeader className="pb-4 border-b border-border">
            <div className="flex items-center gap-3">
              <div
                className="h-14 w-14 rounded-full flex items-center justify-center text-white font-bold text-xl flex-shrink-0"
                style={{ background: avatarGradient }}
              >
                {initials}
              </div>
              <div>
                <SheetTitle className="text-lg leading-tight">{doctor.nome}</SheetTitle>
                <p className="text-sm text-muted-foreground">
                  {doctor.estrangeiro && doctor.paisOrigem
                    ? `🌍 ${doctor.paisOrigem}`
                    : `CRM ${doctor.crmEstado ?? ""} ${doctor.crm ?? ""}`}
                  {doctor.especialidade ? ` · ${doctor.especialidade}` : ""}
                </p>
              </div>
            </div>
          </SheetHeader>

          <div className="py-5 space-y-5">
            {/* Profissional */}
            <div>
              <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground mb-3">{t("doctor.professionalData")}</p>
              <div className="space-y-0.5">
                <ProfileRow label={t("doctor.fullName")} value={doctor.nome} />
                <ProfileRow label={t("option.email")} value={doctor.email} />
                {doctor.estrangeiro
                  ? <ProfileRow label={t("doctor.originCountry")} value={doctor.paisOrigem ?? "—"} />
                  : <ProfileRow label="CRM" value={doctor.crm && doctor.crmEstado ? `${doctor.crm} (${doctor.crmEstado})` : (doctor.crm ?? null)} />
                }
                <ProfileRow label={t("doctor.specialty")} value={doctor.especialidade} />
                <ProfileRow label="WhatsApp Business" value={doctor.whatsappBusiness} />
              </div>
            </div>

            {/* Pessoal */}
            <div>
              <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground mb-3">{t("doctor.personalData")}</p>
              <div className="space-y-0.5">
                <ProfileRow label="CPF" value={doctor.cpf ? doctor.cpf.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4") : null} />
                 <ProfileRow label={t("doctor.birthDate")} value={doctor.dataNascimento ? formatDate(new Date(doctor.dataNascimento + "T12:00:00")) : null} />
                <ProfileRow label={t("doctor.phone")} value={doctor.telefone} />
              </div>
            </div>

            {/* Endereço */}
            {(doctor.endereco || doctor.cidade || doctor.estado || doctor.cep) && (
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground mb-3">{t("doctor.address")}</p>
                <div className="space-y-0.5">
                  <ProfileRow label={t("doctor.street")} value={doctor.endereco} />
                  <ProfileRow label={t("doctor.city")} value={doctor.cidade} />
                  <ProfileRow label={t("doctor.state")} value={doctor.estado} />
                  <ProfileRow label={t("explicit.254")} value={doctor.cep} />
                </div>
              </div>
            )}

            {/* Plataforma */}
            <div>
              <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground mb-3">{t("doctor.platform")}</p>
              <div className="space-y-0.5">
                <ProfileRow label={t("status")} value={doctor.aprovado ? t("staff.approved") : t("doctor.pending")} />
                <ProfileRow label={t("doctor.billing")} value={isFreeState ? t("doctor.freePlan") : t("doctor.stripePlan")} />
                 <ProfileRow label={t("doctor.registeredAt")} value={doctor.createdAt ? formatDate(doctor.createdAt) : null} />
                <ProfileRow label={t("doctor.totalSurgeries")} value={String(surgeries.length)} />
              </div>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      </div>
    </div>
  );
}
