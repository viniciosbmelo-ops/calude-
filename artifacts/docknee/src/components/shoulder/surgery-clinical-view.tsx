/** Leitura do registro de ombro/cotovelo na página da cirurgia: relatório gerado, avaliação pré-operatória, inventário e implantes. */
import { useEffect, useState } from "react";
import { Check, Copy, FileText, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ArthroscopicMap } from "@/components/shoulder/arthroscopic-map";
import { ImplantsEditor } from "@/components/shoulder/implants-editor";
import { PreopAssessmentView } from "@/components/shoulder/preop-assessment-section";
import { isOpenOnly, type ClinicalPayload, type Region } from "@workspace/clinical/web";

export type SurgeryReportState =
  | { status: "loading" }
  | { status: "ready"; texto: string }
  | { status: "empty" }
  | { status: "error"; message: string };

/** Texto do relatório gerado no servidor. `key` muda quando a cirurgia é salva, para recarregar. */
export function useSurgeryReport(surgeryId: number | null, enabled: boolean, key?: unknown): SurgeryReportState {
  const [state, setState] = useState<SurgeryReportState>({ status: "loading" });
  useEffect(() => {
    if (!surgeryId || !enabled) { setState({ status: "empty" }); return; }
    let alive = true;
    setState({ status: "loading" });
    fetch(`/api/surgeries/${surgeryId}/relatorio`, { credentials: "same-origin" })
      .then(async (r) => {
        const body = await r.json().catch(() => ({}));
        if (!alive) return;
        if (r.ok && typeof body.texto === "string") setState({ status: "ready", texto: body.texto });
        else if (r.status === 409) setState({ status: "empty" });
        else setState({ status: "error", message: body.error ?? "Não foi possível gerar o relatório." });
      })
      .catch(() => alive && setState({ status: "error", message: "Não foi possível gerar o relatório." }));
    return () => { alive = false; };
  }, [surgeryId, enabled, key]);
  return state;
}

/** `report` ausente: só inventário e implantes (ex.: visão do administrador, sem acesso ao relatório nominal). */
export function SurgeryClinicalView({ payload, report }: { payload: ClinicalPayload; report?: SurgeryReportState }) {
  const [copied, setCopied] = useState(false);
  const region = payload.regiao as Region;

  async function copy() {
    if (report?.status !== "ready") return;
    await navigator.clipboard.writeText(report.texto);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <>
      {report && <Card className="min-w-0 shadow-sm">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between gap-2">
            <CardTitle className="text-lg flex items-center gap-2"><FileText className="h-4 w-4 text-primary" /> Relatório cirúrgico</CardTitle>
            {report.status === "ready" && (
              <Button variant="outline" size="sm" className="gap-2" onClick={copy}>
                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                {copied ? "Copiado" : "Copiar"}
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {report.status === "loading" && <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Gerando relatório...</p>}
          {report.status === "error" && <p className="text-sm text-destructive">{report.message}</p>}
          {report.status === "empty" && <p className="text-sm text-muted-foreground">Sem dados clínicos estruturados para gerar o relatório.</p>}
          {report.status === "ready" && (
            <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-relaxed bg-muted/30 p-4 rounded-md">{report.texto}</pre>
          )}
        </CardContent>
      </Card>}

      {/* Avaliação pré-operatória (payload v2), somente leitura; fora do relatório */}
      <PreopAssessmentView value={payload.avaliacaoPreop} />

      {/* Cirurgia puramente aberta: nenhuma estrutura foi avaliada por artroscopia */}
      {payload.mapaArtroscopico.length > 0 && !isOpenOnly(payload.geral) && (
        <Card className="min-w-0 shadow-sm">
          <CardHeader className="pb-2"><CardTitle className="text-lg">Inventário artroscópico</CardTitle></CardHeader>
          <CardContent>
            <ArthroscopicMap region={region} value={payload.mapaArtroscopico} onChange={() => {}} readOnly />
          </CardContent>
        </Card>
      )}

      <Card className="min-w-0 shadow-sm">
        <CardHeader className="pb-2"><CardTitle className="text-lg">Implantes</CardTitle></CardHeader>
        <CardContent>
          <ImplantsEditor value={payload.implantes} onChange={() => {}} readOnly />
        </CardContent>
      </Card>
    </>
  );
}
