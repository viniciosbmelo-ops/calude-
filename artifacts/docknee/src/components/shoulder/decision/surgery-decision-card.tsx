/**
 * Cartão somente leitura na tela da cirurgia: execuções do apoio à decisão vinculadas a ela e a
 * última escolha do cirurgião. Não entra no relatório cirúrgico. Some quando não há execuções.
 */
import {
  getListExecucoesApoioDecisaoCirurgiaQueryKey, useListExecucoesApoioDecisaoCirurgia,
  type ApoioDecisaoExecucaoCirurgia,
} from "@workspace/api-client-react";
import type { ResultadoApoio } from "@workspace/clinical/web";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useLanguage } from "@/lib/i18n";
import { DecisionDisclaimer, DecisionResultView, StrengthChip, useDsT } from "./decision-result";
import { choiceLabel, readExecutionMeta } from "./logic";

function ExecucaoItem({ e }: { e: ApoioDecisaoExecucaoCirurgia }) {
  const t = useDsT();
  const { formatDate } = useLanguage();
  const resultado = e.resultado as unknown as ResultadoApoio;
  const top = resultado.opcoes[0];
  return (
    <li className="space-y-2 rounded-lg border p-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="rounded bg-primary px-2 py-0.5 text-xs font-bold uppercase text-primary-foreground">{t("suggestionLabel")}</span>
        <span className="font-medium">{e.algoritmoId}</span>
        <span className="text-xs text-muted-foreground">{t("version", { v: e.versao })} · {t(`modo_${e.modo}`)} · {formatDate(e.createdAt)}</span>
      </div>
      {top && (
        <p className="flex flex-wrap items-center gap-2 text-sm">
          <span>{top.rotulo}</span><StrengthChip forca={top.forca} /><span className="text-xs text-muted-foreground">{t(`sentido_${top.sentido}`)}</span>
        </p>
      )}
      <p className="text-sm">
        {e.escolha
          ? <>{t("choiceRecorded", { c: choiceLabel(e.escolha, resultado) })} · <span className="text-muted-foreground">{t(`concordancia_${e.escolha.concordancia}`)}</span>
            {e.escolha.justificativa && <span className="block text-xs text-muted-foreground">{e.escolha.justificativa}</span>}</>
          : <span className="text-muted-foreground">{t("choiceNone")}</span>}
      </p>
      <details>
        <summary className="cursor-pointer text-xs font-medium text-primary">{t("showDetails")}</summary>
        <div className="mt-3"><DecisionResultView resultado={resultado} execucaoId={e.execucaoId} modo={e.modo} meta={readExecutionMeta(e)} /></div>
      </details>
    </li>
  );
}

export function SurgeryDecisionCard({ surgeryId }: { surgeryId: number }) {
  const t = useDsT();
  const { data } = useListExecucoesApoioDecisaoCirurgia(surgeryId, {
    query: { queryKey: getListExecucoesApoioDecisaoCirurgiaQueryKey(surgeryId), retry: false },
  });
  const execucoes = data?.execucoes ?? [];
  if (execucoes.length === 0) return null;
  return (
    <Card className="min-w-0 shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="text-lg">{t("cardTitle")}</CardTitle>
        <p className="text-sm text-muted-foreground">{t("cardHelp")}</p>
      </CardHeader>
      <CardContent className="space-y-3">
        <DecisionDisclaimer compact />
        <ul className="space-y-3">{execucoes.map((e) => <ExecucaoItem key={e.execucaoId} e={e} />)}</ul>
      </CardContent>
    </Card>
  );
}
