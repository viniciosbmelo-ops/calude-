/**
 * Registro de procedimento — ombro e cotovelo (DocSholder).
 * Mesmo layout do DocKnee: cabeçalho, barra de progresso, etapas, card, Anterior / Salvar rascunho / Próximo.
 * Formulários clínicos dirigidos pelos schemas do núcleo (@workspace/clinical).
 */
import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { ArrowLeft, ArrowRight, BookmarkCheck, CheckCircle2, Loader2, Save } from "lucide-react";
import { useListPatients } from "@workspace/api-client-react";
import {
  ALL_SCHEMAS, CASE_TYPE_BY_KEY, caseTypesFor, diagnosesFor, diagnosisText, intraopSchemaId, procedureName,
  CLINICAL_PAYLOAD_VERSION, type ClinicalImplant, type ClinicalMapEntry, type IssueGroup, type Region, type ValidationIssue,
} from "@workspace/clinical/web";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useSubscriptionStatus } from "@/hooks/use-subscription-status";
import { SubscriptionGate } from "@/components/subscription-gate";
import { SurgeryMedia } from "@/components/surgery-media";
import { SurgeryPreopFollowupCard } from "@/components/preop-followup-card";
import { HospitalField } from "@/components/hospital-field";
import { SchemaForm, validateWith } from "@/components/shoulder/schema-form";
import { ArthroscopicMap } from "@/components/shoulder/arthroscopic-map";
import { ImplantsEditor } from "@/components/shoulder/implants-editor";
import { cn, sortByPtBrName } from "@/lib/utils";
import { useScopedTranslations } from "@/lib/i18n";
import { surgeryShoulderMessages } from "@/locales/surgery-shoulder";

type Obj = Record<string, any>;
type Side = "Direito" | "Esquerdo" | "";
interface ProcState { codigo: string | null; dados: Obj }

const SCHEMA_BY_ID = new Map(ALL_SCHEMAS.map((s) => [(s as Obj).$id as string, s as Obj]));
const CORE_SCHEMA_ID = "CORE_SURGERY.v1";
/** Campos do núcleo preenchidos por outras etapas (colunas da cirurgia ou diagnóstico) */
const CORE_HIDDEN = ["surgery_date", "side", "hospital", "preop_dx"];
const STEPS = 4;

async function postJson(url: string, body: unknown): Promise<any> {
  const res = await fetch(url, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(json.error ?? `Erro ${res.status}`) as Error & { details?: IssueGroup[] };
    err.details = json.details;
    throw err;
  }
  return json;
}

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function NewShoulderSurgery() {
  const t = useScopedTranslations(surgeryShoulderMessages);
  const { canWrite, loading: subLoading } = useSubscriptionStatus();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { data: patients } = useListPatients();

  const [{ initialPatientId, draftIdParam, initialStep }] = useState(() => {
    const sp = new URLSearchParams(window.location.search);
    const requested = Number(sp.get("step"));
    return {
      initialPatientId: sp.get("patientId") ? Number.parseInt(sp.get("patientId")!, 10) : undefined,
      draftIdParam: sp.get("draft") ? Number.parseInt(sp.get("draft")!, 10) : undefined,
      initialStep: Number.isInteger(requested) && requested >= 1 && requested <= STEPS ? requested : 1,
    };
  });

  const [step, setStep] = useState(initialStep);
  const [draftId, setDraftId] = useState<number | undefined>(draftIdParam);
  const [draftLoaded, setDraftLoaded] = useState(!draftIdParam);
  const [saving, setSaving] = useState(false);
  const [serverIssues, setServerIssues] = useState<IssueGroup[] | null>(null);

  const [patientId, setPatientId] = useState<number | undefined>(initialPatientId);
  const [dataCirurgia, setDataCirurgia] = useState(today());
  const [lado, setLado] = useState<Side>("");
  const [regiao, setRegiao] = useState<Region | "">("");
  const [hospital, setHospital] = useState("");
  const [diagnoses, setDiagnoses] = useState<string[]>([]);
  const [tipos, setTipos] = useState<string[]>([]);
  const [procs, setProcs] = useState<Record<string, ProcState>>({});
  const [geral, setGeral] = useState<Obj>({});
  const [mapa, setMapa] = useState<ClinicalMapEntry[]>([]);
  const [implantes, setImplantes] = useState<ClinicalImplant[]>([]);
  const [observacoes, setObservacoes] = useState("");

  // Mantém ?draft=&step= na URL para retomar o rascunho
  useEffect(() => {
    if (!draftId) return;
    const url = new URL(window.location.href);
    if (url.searchParams.get("draft") === String(draftId) && url.searchParams.get("step") === String(step)) return;
    url.searchParams.set("draft", String(draftId));
    url.searchParams.set("step", String(step));
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  }, [draftId, step]);

  // Carrega rascunho existente
  useEffect(() => {
    if (!draftIdParam) return;
    let alive = true;
    fetch(`/api/surgeries/${draftIdParam}`, { credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : null))
      .then((s) => {
        if (!alive || !s) return;
        setPatientId(s.patientId ?? undefined);
        if (s.dataCirurgia) setDataCirurgia(s.dataCirurgia);
        if (s.lado === "Direito" || s.lado === "Esquerdo") setLado(s.lado);
        setHospital(s.hospital ?? "");
        setObservacoes(s.observacoes ?? "");
        const dc = s.dadosClinicos as Obj | null;
        if (dc) {
          setRegiao(dc.regiao);
          const { preop_dx, ...rest } = dc.geral ?? {};
          setGeral(rest);
          setDiagnoses(Array.isArray(preop_dx) ? preop_dx : []);
          const ps: Record<string, ProcState> = {};
          for (const p of dc.procedimentos ?? []) ps[p.tipoCaso] = { codigo: p.codigo, dados: p.dados ?? {} };
          setProcs(ps);
          setTipos((dc.procedimentos ?? []).map((p: Obj) => p.tipoCaso));
          setMapa(dc.mapaArtroscopico ?? []);
          setImplantes(dc.implantes ?? []);
        } else if (s.regiao) {
          setRegiao(s.regiao);
        }
      })
      .finally(() => alive && setDraftLoaded(true));
    return () => { alive = false; };
  }, [draftIdParam]);

  const region = regiao || undefined;
  const sideCode = lado === "Esquerdo" ? "L" : "R";
  const sortedPatients = useMemo(() => sortByPtBrName(patients ?? [], (p) => p.nome, (p) => p.id), [patients]);
  const selectedPatient = sortedPatients.find((p) => p.id === patientId);

  function toggleTipo(key: string) {
    setTipos((cur) => {
      if (cur.includes(key)) return cur.filter((k) => k !== key);
      const ct = CASE_TYPE_BY_KEY.get(key)!;
      if (!procs[key]) {
        // Patologia padrão: diagnóstico já marcado dentro do tipo, senão a primeira do tipo
        const codigo = ct.freeOnly ? null : ct.codes.find((c) => diagnoses.includes(c)) ?? ct.codes[0];
        setProcs((p) => ({ ...p, [key]: { codigo, dados: {} } }));
      }
      return [...cur, key];
    });
  }

  function changeRegion(r: Region) {
    if (r === regiao) return;
    setRegiao(r);
    // Troca de região invalida o que depende dela
    setDiagnoses([]);
    setTipos([]);
    setProcs({});
    setMapa([]);
  }

  const buildPayload = () => {
    const procedimentos = tipos.map((key) => ({ tipoCaso: key, codigo: procs[key]?.codigo ?? null, dados: procs[key]?.dados ?? {} }));
    const typeLabels = tipos.map((k) => CASE_TYPE_BY_KEY.get(k)?.label ?? k);
    return {
      patientId,
      dataCirurgia,
      lado: lado || undefined,
      hospital,
      regiao: region,
      tipoCaso: typeLabels.join(" + "),
      tiposProcedimento: tipos,
      ligamentosAcometidos: [],
      diagnostico: diagnosisText(diagnoses),
      procedimentoRealizado: procedimentos.map((p) => procedureName(p)).join(", "),
      observacoes,
      dadosClinicos: region
        ? { versao: CLINICAL_PAYLOAD_VERSION, regiao: region, geral: { ...geral, preop_dx: diagnoses }, procedimentos, mapaArtroscopico: mapa, implantes }
        : undefined,
    };
  };

  async function saveDraft(silent = false): Promise<number | undefined> {
    if (!patientId) {
      if (!silent) toast({ title: t("selectPatientBeforeDraft"), variant: "destructive" });
      return undefined;
    }
    setSaving(true);
    try {
      const r = await postJson("/api/surgeries/draft", { ...buildPayload(), id: draftId });
      setDraftId(r.id);
      if (!silent) toast({ title: t("draftSaved"), description: t("draftContinue") });
      return r.id;
    } catch (e) {
      toast({ title: t("draftSaveError"), description: e instanceof Error ? e.message : undefined, variant: "destructive" });
      return undefined;
    } finally {
      setSaving(false);
    }
  }

  async function ensureDraft(): Promise<number> {
    if (draftId) return draftId;
    if (!patientId) throw new Error(t("selectPatientBeforeMedia"));
    if (saving) throw new Error(t("waitDraft"));
    const id = await saveDraft(true);
    if (!id) throw new Error(t("draftSaveError"));
    toast({ title: t("draftCreatedAutomatically"), description: t("uploadsWillContinue") });
    return id;
  }

  async function finish() {
    if (!patientId) {
      toast({ title: t("selectPatient"), variant: "destructive" });
      return;
    }
    setSaving(true);
    setServerIssues(null);
    try {
      const body = buildPayload();
      const r = draftId ? await postJson(`/api/surgeries/${draftId}/finalize`, body) : await postJson("/api/surgeries", body);
      toast({ title: t("registered") });
      setLocation(`/surgeries/${r.id}`);
    } catch (e) {
      const details = (e as { details?: IssueGroup[] }).details;
      if (details?.length) {
        setServerIssues(details);
        setStep(3);
        toast({ title: t("fixPending"), variant: "destructive" });
      } else {
        toast({ title: t("registrationError"), description: e instanceof Error ? e.message : undefined, variant: "destructive" });
      }
    } finally {
      setSaving(false);
    }
  }

  const canLeaveBasics = Boolean(patientId && lado && region);
  const next = () => {
    if (step === 1 && !canLeaveBasics) {
      toast({ title: t("requiredBasics"), variant: "destructive" });
      return;
    }
    setStep((s) => Math.min(s + 1, STEPS));
  };

  // Pendências do núcleo (dados gerais) calculadas no navegador com o mesmo validador do servidor
  const coreValue = useMemo(() => ({ ...geral, preop_dx: diagnoses, surgery_date: dataCirurgia || undefined, ...(lado ? { side: sideCode } : {}), ...(hospital ? { hospital } : {}) }), [geral, diagnoses, dataCirurgia, lado, sideCode, hospital]);
  const coreIssues = useMemo(() => validateWith(CORE_SCHEMA_ID, coreValue), [coreValue]);

  const stepTitles = [t("stepBasic"), t("stepCaseType"), t("stepTechnique"), t("stepObservations")];

  if (!subLoading && !canWrite) return <SubscriptionGate />;
  if (!draftLoaded) {
    return (
      <div className="w-full max-w-4xl mx-auto p-4 sm:p-6 md:p-8">
        <Card><CardContent className="flex items-center justify-center gap-3 py-12 text-sm text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin text-primary" />{t("loadingDraft")}
        </CardContent></Card>
      </div>
    );
  }

  return (
    <div className="w-full min-w-0 max-w-4xl mx-auto space-y-6 p-4 pb-24 sm:p-6 md:p-8 md:pb-8">
      {/* Cabeçalho */}
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3 sm:gap-4">
          <Link href="/surgeries"><Button variant="outline" size="icon" aria-label="Voltar"><ArrowLeft className="h-4 w-4" /></Button></Link>
          <div className="min-w-0">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <h1 className="min-w-0 break-words text-2xl font-bold tracking-tight sm:text-3xl">{t("title")}</h1>
              {draftId && (
                <span className="shrink-0 rounded-full border border-amber-300 bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700">{t("draftNumber", { id: draftId })}</span>
              )}
            </div>
            <p className="text-muted-foreground text-sm">{stepTitles[step - 1]}</p>
          </div>
        </div>
        <span className="shrink-0 rounded-full bg-muted px-2 py-1 text-xs font-medium text-muted-foreground sm:px-3 sm:text-sm">{step} / {STEPS}</span>
      </div>

      {/* Progresso */}
      <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
        <div className="h-full bg-primary transition-all duration-300" style={{ width: `${(step / STEPS) * 100}%` }} />
      </div>

      {/* Etapas */}
      <div className="hidden md:flex gap-1">
        {stepTitles.map((title, i) => (
          <button key={title} type="button" onClick={() => (i === 0 || canLeaveBasics) && setStep(i + 1)}
            className={cn("flex-1 text-center text-xs py-1 rounded font-medium transition-colors",
              i + 1 === step ? "bg-primary text-primary-foreground" : i + 1 < step ? "bg-primary/20 text-primary" : "bg-muted text-muted-foreground")}>
            {title}
          </button>
        ))}
      </div>

      <Card className="w-full min-w-0 border shadow-sm">
        <CardContent className="min-w-0 p-4 sm:p-6">
          {/* ETAPA 1: Dados Básicos */}
          {step === 1 && (
            <div className="space-y-6">
              <h2 className="text-xl font-semibold">{t("stepBasic")}</h2>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2 md:col-span-2">
                  <Label htmlFor="sx-patient">{t("patient")} *</Label>
                  <Select value={patientId?.toString() ?? ""} onValueChange={(v) => setPatientId(Number.parseInt(v, 10))}>
                    <SelectTrigger id="sx-patient"><SelectValue placeholder={t("selectPatient")} /></SelectTrigger>
                    <SelectContent>{sortedPatients.map((p) => <SelectItem key={p.id} value={p.id.toString()}>{p.nome}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="sx-date">{t("procedureDate")}</Label>
                  <Input id="sx-date" type="date" value={dataCirurgia} onChange={(e) => setDataCirurgia(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="sx-side">{t("side")} *</Label>
                  <Select value={lado} onValueChange={(v) => setLado(v as Side)}>
                    <SelectTrigger id="sx-side"><SelectValue placeholder={t("select")} /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Direito">{t("right")}</SelectItem>
                      <SelectItem value="Esquerdo">{t("left")}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label>{t("region")} *</Label>
                  <div className="grid grid-cols-2 gap-2 max-w-sm">
                    {(["shoulder", "elbow"] as const).map((r) => (
                      <button key={r} type="button" onClick={() => changeRegion(r)} aria-pressed={regiao === r}
                        className={cn("text-sm px-3 py-2 rounded-lg border-2 transition-all",
                          regiao === r ? "border-primary bg-primary/5 font-medium text-primary" : "border-border hover:border-primary/40")}>
                        {regiao === r && <CheckCircle2 className="inline h-3 w-3 mr-1" />}{r === "shoulder" ? t("shoulder") : t("elbow")}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label htmlFor="sx-hospital">{t("hospital")}</Label>
                  <HospitalField id="sx-hospital" value={hospital} onChange={setHospital} />
                </div>
              </div>

              {region && (
                <div className="border rounded-xl p-4 bg-muted/20 space-y-3">
                  <div>
                    <p className="text-sm font-semibold">{t("diagnosis")} *</p>
                    <p className="text-xs text-muted-foreground">{t("diagnosisHelp")}</p>
                  </div>
                  <div className="grid sm:grid-cols-2 gap-2">
                    {diagnosesFor(region).map((p) => {
                      const sel = diagnoses.includes(p.code);
                      return (
                        <button key={p.code} type="button" aria-pressed={sel}
                          onClick={() => setDiagnoses((cur) => (sel ? cur.filter((c) => c !== p.code) : [...cur, p.code]))}
                          className={cn("text-sm text-left px-3 py-2 rounded-lg border-2 transition-all",
                            sel ? "border-primary bg-primary/5 font-medium text-primary" : "border-border hover:border-primary/40", p.parent && "sm:ml-4")}>
                          {sel && <CheckCircle2 className="inline h-3 w-3 mr-1" />}{p.name_pt}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ETAPA 2: Tipo do Caso */}
          {step === 2 && (
            <div className="space-y-6">
              <h2 className="text-xl font-semibold">{t("stepCaseType")}</h2>
              <p className="text-sm text-muted-foreground">{region ? t("caseTypeHelp") : t("selectRegionFirst")}</p>
              {tipos.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {tipos.map((k) => (
                    <span key={k} className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-primary/10 text-primary text-xs font-medium border border-primary/20">
                      <CheckCircle2 className="h-3 w-3" /> {CASE_TYPE_BY_KEY.get(k)?.label}
                    </span>
                  ))}
                </div>
              )}
              {region && (
                <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3">
                  {caseTypesFor(region).map((ct) => {
                    const selected = tipos.includes(ct.key);
                    return (
                      <button key={ct.key} type="button" onClick={() => toggleTipo(ct.key)} aria-pressed={selected}
                        className={cn("relative text-left p-4 rounded-xl border-2 transition-all duration-150 hover:border-primary/50",
                          selected ? "border-primary bg-primary/5 shadow-sm" : "border-border bg-card")}>
                        {selected && <CheckCircle2 className="absolute top-2 right-2 h-4 w-4 text-primary" />}
                        <p className="font-semibold text-sm">{ct.label}</p>
                        <p className="text-xs text-muted-foreground mt-1">{ct.desc}</p>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* ETAPA 3: Técnica Cirúrgica */}
          {step === 3 && region && (
            <div className="space-y-6">
              <div>
                <h2 className="text-xl font-semibold">{t("stepTechnique")}</h2>
                <p className="text-sm text-muted-foreground mt-1">{t("techniqueHelp")}</p>
              </div>

              {serverIssues && (
                <div role="alert" className="rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-sm">
                  <p className="font-semibold text-destructive">{t("fixPending")}</p>
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-destructive">
                    {serverIssues.flatMap((g) => g.issues.map((i, n) => <li key={`${g.scope}${n}`}>{g.scope}: {i.message_pt}</li>))}
                  </ul>
                </div>
              )}

              <SurgeryPreopFollowupCard draftId={draftId ?? null} patientPhone={selectedPatient?.telefone ?? undefined} ensureCurrentDraft={ensureDraft} ready={draftLoaded} showFollowup={!tipos.some((k) => k.endsWith("_FRACTURE"))} />

              <Section title={t("generalData")} pending={coreIssues.filter((i) => !CORE_HIDDEN.includes(i.field.split(".")[0])).length} t={t}>
                <SchemaForm schema={SCHEMA_BY_ID.get(CORE_SCHEMA_ID)!} value={geral} issues={coreIssues}
                  onChange={(v) => { const { preop_dx: _p, ...rest } = v; setGeral(rest); }}
                  side={sideCode} region={region} hide={CORE_HIDDEN} />
              </Section>

              <div className="space-y-4">
                <p className="text-base font-semibold">{t("procedures")}</p>
                {tipos.length === 0 && <p className="text-sm text-muted-foreground">{t("selectRegionFirst")}</p>}
                {tipos.map((key, idx) => (
                  <ProcedureBlock key={key} index={idx} caseKey={key} state={procs[key] ?? { codigo: null, dados: {} }}
                    onChange={(s) => setProcs((p) => ({ ...p, [key]: s }))} side={sideCode} region={region} t={t} />
                ))}
              </div>

              <Section title={t("arthroscopicMap")} t={t}>
                <ArthroscopicMap region={region} value={mapa} onChange={setMapa} />
              </Section>

              <Section title={t("implants")} t={t}>
                <ImplantsEditor value={implantes} onChange={setImplantes} />
              </Section>
            </div>
          )}

          {/* ETAPA 4: Observações */}
          {step === 4 && (
            <div className="space-y-6">
              <h2 className="text-xl font-semibold">{t("observationsTitle")}</h2>
              <div className="space-y-2">
                <Label htmlFor="sx-obs">{t("clinicalObservations")}</Label>
                <Textarea id="sx-obs" placeholder={t("clinicalObservationsPlaceholder")} rows={6} value={observacoes} onChange={(e) => setObservacoes(e.target.value)} />
              </div>
              <div className="space-y-3">
                <div>
                  <h3 className="font-semibold text-sm">{t("intraoperativeRecord")}</h3>
                  <p className="text-xs text-muted-foreground">{t("intraoperativeMediaHelp")}</p>
                </div>
                <SurgeryMedia surgeryId={draftId} ensureSurgeryId={ensureDraft} />
              </div>
              <div className="border rounded-xl p-4 bg-muted/30 space-y-2">
                <h3 className="font-semibold text-sm">{t("summary")}</h3>
                <div className="grid sm:grid-cols-2 gap-2 text-sm">
                  <div><span className="text-muted-foreground">{t("summaryPatient")}</span> {selectedPatient?.nome || "—"}</div>
                  <div><span className="text-muted-foreground">{t("summaryDate")}</span> {dataCirurgia || "—"}</div>
                  <div><span className="text-muted-foreground">{t("summaryTypes")}</span> {tipos.map((k) => CASE_TYPE_BY_KEY.get(k)?.label).join(" + ") || "—"}</div>
                  <div><span className="text-muted-foreground">{t("summarySide")}</span> {lado || "—"}{region ? ` · ${region === "shoulder" ? t("shoulder") : t("elbow")}` : ""}</div>
                  <div className="sm:col-span-2"><span className="text-muted-foreground">{t("summaryProcedures")}</span> {tipos.map((k) => procedureName({ tipoCaso: k, codigo: procs[k]?.codigo ?? null })).join(", ") || "—"}</div>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Navegação */}
      <div className="flex flex-col gap-2 pb-[env(safe-area-inset-bottom)] sm:flex-row sm:items-center sm:justify-between sm:gap-3">
        <Button variant="outline" onClick={() => setStep((s) => Math.max(s - 1, 1))} disabled={step === 1} className="w-full gap-2 sm:w-auto">
          <ArrowLeft className="h-4 w-4" /> {t("previous")}
        </Button>
        <div className="flex w-full min-w-0 flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
          <Button type="button" variant="outline" onClick={() => void saveDraft()} disabled={saving || !patientId}
            className="w-full gap-2 border-amber-300 text-amber-700 hover:bg-amber-50 sm:w-auto">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <BookmarkCheck className="h-4 w-4" />}
            {saving ? t("saving") : draftId ? t("updateDraft") : t("saveDraft")}
          </Button>
          {step < STEPS ? (
            <Button onClick={next} className="w-full gap-2 sm:w-auto">{t("next")} <ArrowRight className="h-4 w-4" /></Button>
          ) : (
            <Button onClick={() => void finish()} className="w-full gap-2 sm:w-auto" disabled={saving}>
              <Save className="h-4 w-4" /> {saving ? t("saving") : t("finish")}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

type T = ReturnType<typeof useScopedTranslations<(typeof surgeryShoulderMessages)["pt-BR"]>>;

function Section({ title, pending, children, t }: { title: string; pending?: number; children: React.ReactNode; t: T }) {
  return (
    <details className="rounded-xl border p-4 bg-muted/10" open>
      <summary className="flex cursor-pointer items-center justify-between gap-2 text-base font-semibold">
        <span>{title}</span>
        {pending !== undefined && (
          pending > 0
            ? <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-semibold text-destructive">{t("pending", { n: pending })}</span>
            : <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">{t("complete")}</span>
        )}
      </summary>
      <div className="mt-4">{children}</div>
    </details>
  );
}

function ProcedureBlock({ index, caseKey, state, onChange, side, region, t }: {
  index: number; caseKey: string; state: ProcState; onChange(s: ProcState): void; side: string; region: Region; t: T;
}) {
  const ct = CASE_TYPE_BY_KEY.get(caseKey)!;
  const schemaId = state.codigo ? intraopSchemaId(state.codigo) : null;
  const schema = schemaId ? SCHEMA_BY_ID.get(schemaId) : undefined;
  const issues: ValidationIssue[] = schemaId
    ? validateWith(schemaId, state.dados)
    : (typeof state.dados.descricao === "string" && state.dados.descricao.trim().length >= 3 ? [] : [{ field: "descricao", keyword: "required", message_pt: "" }]);
  const title = `${index + 1}. ${procedureName({ tipoCaso: caseKey, codigo: state.codigo })}`;
  return (
    <Section title={title} pending={issues.length} t={t}>
      <div className="space-y-4">
        {ct.codes.length > 1 && (
          <div className="space-y-2">
            <Label htmlFor={`sx-path-${caseKey}`}>{t("pathology")}</Label>
            <Select value={state.codigo ?? ""} onValueChange={(v) => onChange({ codigo: v, dados: intraopSchemaId(v) === schemaId ? state.dados : {} })}>
              <SelectTrigger id={`sx-path-${caseKey}`}><SelectValue /></SelectTrigger>
              <SelectContent>
                {ct.codes.map((c) => <SelectItem key={c} value={c}>{procedureName({ tipoCaso: caseKey, codigo: c })}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        )}
        {schema ? (
          <SchemaForm schema={schema} value={state.dados} onChange={(d) => onChange({ ...state, dados: d })} side={side} region={region} />
        ) : (
          <div className="space-y-2">
            <Label htmlFor={`sx-free-${caseKey}`}>{t("freeTextLabel")} *</Label>
            <Textarea id={`sx-free-${caseKey}`} rows={5} maxLength={4000} value={state.dados.descricao ?? ""} onChange={(e) => onChange({ ...state, dados: e.target.value ? { descricao: e.target.value } : {} })} />
            <p className="text-xs text-muted-foreground">{t("freeTextHelp")}</p>
          </div>
        )}
      </div>
    </Section>
  );
}
