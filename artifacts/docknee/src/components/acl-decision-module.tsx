import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useCalculateAclDecision } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { Activity, AlertTriangle, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { useScopedTranslations } from "@/lib/i18n";
import { aclDecisionMessages } from "@/locales/acl-decision-module";

// Permissive aliases: the ACL decision module carries several clinical inputs
// not yet reflected in the strict OpenAPI CreateSurgeryBody typing.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AclDecisionInput = Record<string, any>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AclDecisionResult = Record<string, any>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AclLeapDecisionRecord = Record<string, any>;

function mapEnxertoCategoria(enxerto?: string): "HT" | "QT" | "BTB" | "Aloenxerto" | "Outro" | undefined {
  if (!enxerto) return undefined;
  if (enxerto === "Tendão Patelar (BTB)") return "BTB";
  if (enxerto === "Tendão Quadricipital" || enxerto === "Tendão do Reto Femoral") return "QT";
  if (enxerto === "Isquiotibiais (Grácil + Semitendíneo)" || enxerto === "Grácil" || enxerto === "Semitendíneo") return "HT";
  if (enxerto === "Aloenxerto") return "Aloenxerto";
  return "Outro";
}

// Converte a categoria de hiperextensão do exame físico em graus representativos
// para o motor de decisão: "<5" → 0 (normal), "5-6.5" → 6 (limítrofe), ">6.5" → 6,5 (hiperlaxidade).
function mapHiperextensaoGraus(categoria?: string | null): number | undefined {
  if (!categoria) return undefined;
  if (categoria === "<5") return 0;
  if (categoria === "5-6.5" || categoria === "5-7.5") return 6;
  if (categoria === ">6.5" || categoria === ">7.5") return 6.5;
  return undefined;
}

const FORCA_STYLES: Record<string, string> = {
  "Fortemente recomendado": "bg-red-100 text-red-800 border-red-300",
  "Recomendado": "bg-orange-100 text-orange-800 border-orange-300",
  "Deve ser considerado": "bg-amber-100 text-amber-800 border-amber-300",
  "Pode ser considerado": "bg-blue-100 text-blue-800 border-blue-300",
  "Alerta": "bg-purple-100 text-purple-800 border-purple-300",
};

interface AclDecisionModuleProps {
  idade: number;
  sexo?: string | null;
  enxerto?: string;
  hiperextensao?: string | null;
  slopeTibialPts?: number | null;
  pivotShift?: number;
  lachman?: number;
  revisao: boolean;
  lesaoCronica: boolean;
  esportePivot: boolean;
  meniscalConcomitante: boolean;
  esqueletoImaturo?: boolean;
  contralateralLca?: boolean;
  tabagismo?: boolean;
  earlyRtsPivot?: boolean;
  segondFratura?: boolean;
  notchEstreito?: boolean;
  lesaoAlcImagem?: boolean;
  value: AclLeapDecisionRecord | null | undefined;
  draftLoaded?: boolean;
  onChange: (record: AclLeapDecisionRecord) => void;
}

interface ExtraFields {
  atrasoCirurgicoDias: string;
  tunelComprometido: boolean;
  aloenxertoJovem: boolean;
  allIsoladaConduta: boolean;
}

const DEFAULT_EXTRAS: ExtraFields = {
  atrasoCirurgicoDias: "",
  tunelComprometido: false,
  aloenxertoJovem: false,
  allIsoladaConduta: false,
};

export function AclDecisionModule({
  idade,
  sexo,
  enxerto,
  hiperextensao,
  slopeTibialPts,
  pivotShift,
  lachman,
  revisao,
  lesaoCronica,
  esportePivot,
  meniscalConcomitante,
  esqueletoImaturo = false,
  contralateralLca = false,
  tabagismo = false,
  earlyRtsPivot = false,
  segondFratura = false,
  notchEstreito = false,
  lesaoAlcImagem = false,
  value,
  draftLoaded,
  onChange,
}: AclDecisionModuleProps) {
  const t = useScopedTranslations(aclDecisionMessages);
  const { toast } = useToast();
  const mutation = useCalculateAclDecision();
  const [extras, setExtras] = useState<ExtraFields>(DEFAULT_EXTRAS);
  const [showExtras, setShowExtras] = useState(false);
  const [result, setResult] = useState<AclDecisionResult | null>(value?.resultado ?? null);

  useEffect(() => {
    if (!value) return;
    setExtras({
      atrasoCirurgicoDias: value.atrasoCirurgicoDias != null ? String(value.atrasoCirurgicoDias) : "",
      tunelComprometido: !!value.tunelComprometido,
      aloenxertoJovem: !!value.aloenxertoJovem,
      allIsoladaConduta: !!value.allIsoladaConduta,
    });
    setResult(value.resultado ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftLoaded]);

  const enxertoCategoria = mapEnxertoCategoria(enxerto);

  const handleCalculate = async () => {
    const input: AclDecisionInput = {
      idade,
      sexo,
      enxerto: enxertoCategoria,
      pivotShift: pivotShift ?? 0,
      lachman: lachman ?? 0,
      hiperextensaoGraus: mapHiperextensaoGraus(hiperextensao),
      revisao,
      esqueletoImaturo,
      lesaoCronica,
      esportePivot,
      ptsGraus: slopeTibialPts ?? undefined,
      contralateralLca,
      tabagismo,
      atrasoCirurgicoDias: extras.atrasoCirurgicoDias ? parseFloat(extras.atrasoCirurgicoDias) : undefined,
      earlyRtsPivot,
      tunelComprometido: extras.tunelComprometido,
      aloenxertoJovem: extras.aloenxertoJovem,
      allIsoladaConduta: extras.allIsoladaConduta,
      segondFratura,
      notchEstreito,
      lesaoAlcImagem,
      meniscalConcomitante,
    };
    try {
      const res = await mutation.mutateAsync({ data: input as never });
      setResult(res as AclDecisionResult);
      onChange({
        idade: input.idade,
        sexo: input.sexo,
        enxertoPlanejado: input.enxerto,
        pivotShift: input.pivotShift,
        lachman: input.lachman,
        hiperextensaoGraus: input.hiperextensaoGraus,
        revisao: input.revisao,
        esqueletoImaturo: input.esqueletoImaturo,
        lesaoCronica: input.lesaoCronica,
        esportePivot: input.esportePivot,
        ptsGraus: input.ptsGraus,
        contralateralLca: input.contralateralLca,
        tabagismo: input.tabagismo,
        atrasoCirurgicoDias: input.atrasoCirurgicoDias,
        earlyRtsPivot: input.earlyRtsPivot,
        tunelComprometido: input.tunelComprometido,
        aloenxertoJovem: input.aloenxertoJovem,
        allIsoladaConduta: input.allIsoladaConduta,
        segondFratura: input.segondFratura,
        notchEstreito: input.notchEstreito,
        lesaoAlcImagem: input.lesaoAlcImagem,
        meniscalConcomitante: input.meniscalConcomitante,
        leapIndicado: (res as AclDecisionResult).leapIndicado,
        forcaMaxima: (res as AclDecisionResult).forcaMaxima,
        resultado: res,
      });
    } catch (e) {
      toast({ title: t("error"), variant: "destructive" });
    }
  };

  return (
    <div className="space-y-4 border-2 border-indigo-200 rounded-xl p-4 bg-indigo-50/40">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-indigo-900 text-sm sm:text-base">DocKnee AI Decision ACL</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            {t("description")}
          </p>
          <div className="mt-1.5 space-y-1 border-t border-indigo-100 pt-1.5">
            <p className="text-[10px] text-indigo-400 leading-snug">
              1. Sonnery-Cottet B, et al. <em>Arthroscopy.</em> 2025;41(9):3303-3312.
            </p>
            <p className="text-[10px] text-indigo-400 leading-snug">
              2. Kayaalp ME, et al. <em>J Exp Orthop.</em> 2026;13:e70766.
            </p>
          </div>
        </div>
        <Button type="button" onClick={handleCalculate} variant="secondary" size="sm" disabled={mutation.isPending} className="w-full sm:w-auto shrink-0">
          <Activity className="mr-2 h-4 w-4" />
          {mutation.isPending ? t("calculating") : t("calculate")}
        </Button>
      </div>

      <div>
        <button
          type="button"
          onClick={() => setShowExtras((s) => !s)}
          className="flex items-center gap-1.5 text-xs font-semibold text-indigo-700 hover:text-indigo-900"
        >
          <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", showExtras && "rotate-180")} />
          {t("additionalFactors", { state: showExtras ? t("hide") : t("show") })}
        </button>

        {showExtras && (
          <div className="mt-3 space-y-4 rounded-lg border bg-background p-4">
            <div className="grid sm:grid-cols-3 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs">{t("delay")}</Label>
                <Input
                  type="number"
                  placeholder={t("delayPlaceholder")}
                  value={extras.atrasoCirurgicoDias}
                  onChange={(e) => setExtras((p) => ({ ...p, atrasoCirurgicoDias: e.target.value }))}
                />
              </div>
            </div>

            {revisao && (
                <>
                  <div className="flex items-center space-x-3">
                    <Switch checked={extras.tunelComprometido} onCheckedChange={(c) => setExtras((p) => ({ ...p, tunelComprometido: c }))} />
                    <Label className="text-sm">{t("tunnel")}</Label>
                  </div>
                  <div className="flex items-center space-x-3">
                    <Switch checked={extras.aloenxertoJovem} onCheckedChange={(c) => setExtras((p) => ({ ...p, aloenxertoJovem: c }))} />
                    <Label className="text-sm">{t("allograft")}</Label>
                  </div>
                  <div className="flex items-center space-x-3">
                    <Switch checked={extras.allIsoladaConduta} onCheckedChange={(c) => setExtras((p) => ({ ...p, allIsoladaConduta: c }))} />
                    <Label className="text-sm">{t("isolatedAcl")}</Label>
                  </div>
                </>
              )}
          </div>
        )}
      </div>

      {result && (
        <div className="space-y-3 pt-1">
          <div className="grid sm:grid-cols-2 gap-3">
            <div
              className={cn(
                "rounded-xl p-4 border-2",
                result.leapIndicado ? "border-red-300 bg-red-50" : "border-green-300 bg-green-50"
              )}
            >
              <p className="text-xs font-medium text-muted-foreground">{t("indication")}</p>
              <p className={cn("text-xl font-bold mt-1", result.leapIndicado ? "text-red-700" : "text-green-700")}>
                {result.leapIndicado ? t("indicated") : t("notIndicated")}
              </p>
              {result.forcaMaxima && (
                <span className={cn("inline-block mt-1.5 text-xs px-2.5 py-1 rounded-full font-semibold border", FORCA_STYLES[result.forcaMaxima])}>
                  {result.forcaMaxima}
                </span>
              )}
            </div>
            <div className="rounded-xl p-4 border bg-card">
              <p className="text-xs font-medium text-muted-foreground">{t("accessoryFactors")}</p>
              <p className="text-xl font-bold mt-1">{result.fatoresAcessoriosCount}</p>
              <div className="flex flex-wrap gap-1 mt-1.5">
                {(result.fatoresAcessorios ?? []).filter((f: any) => f.presente).map((f: any) => (
                  <span key={f.id} className="text-xs px-2 py-0.5 rounded-full bg-muted font-medium">{f.label}</span>
                ))}
              </div>
            </div>
          </div>

          {(result.driversNaoModificaveis ?? []).some((d: any) => d.presente) && (
            <div className="flex flex-wrap gap-1.5">
              {(result.driversNaoModificaveis ?? []).filter((d: any) => d.presente).map((d: any) => (
                <span key={d.id} className="text-xs px-2.5 py-1 rounded-full font-semibold border bg-slate-100 text-slate-800 border-slate-300">
                  {d.label}
                </span>
              ))}
            </div>
          )}

          {(result.regras ?? []).length > 0 && (
            <div className="space-y-2">
              {(result.regras ?? []).map((r: any) => (
                <div key={r.id} className="rounded-lg border bg-card p-3 space-y-1.5">
                  <div className="flex items-center justify-between flex-wrap gap-1.5">
                    <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                      {r.modulo === "leap" ? t("leap") : r.modulo === "pts" ? t("pts") : r.modulo === "graft" ? t("graft") : r.modulo === "revision" ? t("revision") : r.modulo === "behavioral" ? t("behavioral") : r.modulo}
                    </span>
                    <span className={cn("text-xs px-2 py-0.5 rounded-full font-semibold border", FORCA_STYLES[r.forca])}>
                      {r.forca}
                    </span>
                  </div>
                  <p className="text-sm font-semibold">{r.titulo}</p>
                  <p className="text-xs text-muted-foreground">{r.justificativa}</p>
                  <p className="text-xs italic text-muted-foreground">{t("lever")} {r.alavanca}</p>
                  {r.contraindicado && (
                    <div className="flex items-start gap-1.5 mt-1 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1">
                      <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                      <span>{t("contraindicated")} {r.contraindicado}</span>
                    </div>
                  )}
                  <div className="flex flex-wrap gap-1">
                    {(r.evidencia ?? []).map((ev: string) => (
                      <span key={ev} className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-mono">{ev}</span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {result.execucaoTecnica && (
            <div className="rounded-lg border bg-muted/30 p-3 space-y-1">
              <p className="text-xs font-semibold">{result.execucaoTecnica.nota}</p>
              {(result.execucaoTecnica.itens ?? []).length > 0 && (
                <ul className="list-disc list-inside text-xs text-muted-foreground">
                  {result.execucaoTecnica.itens.map((t: string, i: number) => <li key={i}>{t}</li>)}
                </ul>
              )}
            </div>
          )}

        </div>
      )}
    </div>
  );
}
