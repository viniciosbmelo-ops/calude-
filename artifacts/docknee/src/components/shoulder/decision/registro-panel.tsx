/**
 * Painel recolhido "Apoio à decisão (sugestão)" no registro cirúrgico (modo registro, retrospectivo).
 * Só aparece quando há algoritmo aplicável às patologias escolhidas. Opcional: não participa do salvamento.
 */
import { useMemo, useState } from "react";
import { getListApoioDecisaoAlgoritmosQueryKey, useListApoioDecisaoAlgoritmos } from "@workspace/api-client-react";
import { cn } from "@/lib/utils";
import { DecisionDisclaimer, StatusBadge, useDsT } from "./decision-result";
import { DecisionRunner, algorithmDef } from "./decision-runner";
import { applicableAlgorithms, prefillFromRegistro, type RegistroContexto } from "./logic";

export function DecisionRegistroPanel({ caseCodes, context, patientId, surgeryId }: {
  /** Patologias do caso (as escolhidas em cada procedimento, ou as do tipo de caso). */
  caseCodes: readonly string[];
  context: RegistroContexto;
  patientId?: number;
  surgeryId?: number;
}) {
  const t = useDsT();
  const { data } = useListApoioDecisaoAlgoritmos({
    query: { queryKey: getListApoioDecisaoAlgoritmosQueryKey(), staleTime: 5 * 60_000, retry: false },
  });
  const aplicaveis = useMemo(() => applicableAlgorithms(data?.algoritmos ?? [], caseCodes), [data, caseCodes]);
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string | undefined>();
  if (aplicaveis.length === 0) return null;

  const atual = aplicaveis.find((a) => `${a.id}@${a.versao}` === selected) ?? aplicaveis[0];
  // Pré-preenchimento calculado ao abrir/escolher; editar depois não sobrescreve o que foi digitado no painel
  const prefill = open ? prefillFromRegistro(algorithmDef(atual), context) : {};

  return (
    <details className="rounded-xl border p-4 bg-muted/10" open={open} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary className="cursor-pointer text-base font-semibold">{t("panelTitle")}</summary>
      {open && (
        <div className="mt-4 space-y-4">
          <p className="text-xs text-muted-foreground">{t("panelHelp")}</p>
          <DecisionDisclaimer compact />
          {aplicaveis.length > 1 && (
            <div className="flex flex-wrap gap-2">
              {aplicaveis.map((a) => {
                const k = `${a.id}@${a.versao}`;
                const on = k === `${atual.id}@${atual.versao}`;
                return (
                  <button key={k} type="button" onClick={() => setSelected(k)} aria-pressed={on}
                    className={cn("rounded-md border px-3 py-1.5 text-sm", on && "border-primary bg-primary/5")}>
                    {a.titulo} <span className="text-xs text-muted-foreground">{t("version", { v: a.versao })}</span>
                  </button>
                );
              })}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-medium">{atual.titulo}</span>
            <span className="text-xs text-muted-foreground">{t("version", { v: atual.versao })}</span>
            {atual.status !== "ativo" && <StatusBadge status={atual.status} />}
          </div>
          {Object.keys(prefill).length > 0 && <p className="text-xs text-muted-foreground">{t("panelPrefilled", { n: Object.keys(prefill).length })}</p>}
          {!surgeryId && <p className="text-xs text-muted-foreground">{t("panelSaveDraftFirst")}</p>}
          <DecisionRunner key={`${atual.id}@${atual.versao}`} algoritmo={atual} modo="registro" initialValues={prefill}
            patientId={patientId} surgeryId={surgeryId} idPrefix={`dsr-${atual.id}`} />
        </div>
      )}
    </details>
  );
}
