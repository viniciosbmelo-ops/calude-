/**
 * Página "Apoio à decisão": uso pré-operatório (modo preop).
 * Lista as versões visíveis (médicos: só ativas com o módulo ligado; admin: todas, com status),
 * monta o formulário a partir das entradas declaradas e avalia no servidor.
 */
import { useState } from "react";
import { useListApoioDecisaoAlgoritmos, type ApoioDecisaoAlgoritmo } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { DecisionDisclaimer, StatusBadge, useDsT } from "@/components/shoulder/decision/decision-result";
import { DecisionRunner } from "@/components/shoulder/decision/decision-runner";

const keyOf = (a: Pick<ApoioDecisaoAlgoritmo, "id" | "versao">) => `${a.id}@${a.versao}`;

function initialSelection(): { algoritmo?: string; paciente?: number } {
  if (typeof window === "undefined") return {};
  const sp = new URLSearchParams(window.location.search);
  const p = Number.parseInt(sp.get("paciente") ?? "", 10);
  return { algoritmo: sp.get("algoritmo") ?? undefined, ...(Number.isInteger(p) && p > 0 ? { paciente: p } : {}) };
}

export default function ApoioDecisaoPage() {
  const t = useDsT();
  const { user } = useAuth();
  const isAdmin = Boolean(user?.isAdmin);
  const { data, isLoading, error } = useListApoioDecisaoAlgoritmos();
  const [{ algoritmo: initialAlg, paciente }] = useState(initialSelection);
  const [selected, setSelected] = useState<string | undefined>(initialAlg);

  const algoritmos = data?.algoritmos ?? [];
  const atual = algoritmos.find((a) => keyOf(a) === selected || a.id === selected) ?? (algoritmos.length === 1 ? algoritmos[0] : undefined);

  return (
    <div className="mx-auto w-full max-w-5xl space-y-4 p-4 md:p-6">
      <div>
        <h1 className="text-2xl font-semibold">{t("pageTitle")}</h1>
        <p className="text-sm text-muted-foreground">{t("pageSubtitle")}</p>
      </div>
      <DecisionDisclaimer />

      {isLoading && <p className="text-sm text-muted-foreground">{t("loading")}</p>}
      {error && <p role="alert" className="text-sm text-destructive">{t("loadError")}</p>}
      {!isLoading && !error && algoritmos.length === 0 && <p className="text-sm text-muted-foreground">{t("empty")}</p>}

      {algoritmos.length > 0 && (
        <div className="grid gap-4 md:grid-cols-[16rem_1fr]">
          <nav aria-label={t("algorithms")} className="space-y-2">
            <p className="text-xs font-semibold uppercase text-muted-foreground">{t("algorithms")}</p>
            {algoritmos.map((a) => {
              const on = atual && keyOf(atual) === keyOf(a);
              return (
                <button key={keyOf(a)} type="button" onClick={() => setSelected(keyOf(a))} aria-pressed={on}
                  className={cn("w-full rounded-lg border p-3 text-left transition-colors hover:bg-accent", on && "border-primary bg-primary/5")}>
                  <p className="text-sm font-semibold">{a.titulo}</p>
                  <p className="text-xs text-muted-foreground">{t("version", { v: a.versao })}</p>
                  {isAdmin && <div className="mt-1"><StatusBadge status={a.status} /></div>}
                </button>
              );
            })}
          </nav>

          {atual ? (
            <Card className="min-w-0">
              <CardHeader className="pb-2">
                <CardTitle className="flex flex-wrap items-center gap-2 text-lg">
                  {atual.titulo}
                  <span className="text-sm font-normal text-muted-foreground">{t("version", { v: atual.versao })}</span>
                  {isAdmin && <StatusBadge status={atual.status} />}
                </CardTitle>
                <p className="text-sm text-muted-foreground"><span className="font-medium">{t("scope")}:</span> {atual.escopo}</p>
              </CardHeader>
              <CardContent>
                <DecisionRunner key={keyOf(atual)} algoritmo={atual} modo="preop" patientId={paciente} idPrefix={`ds-${atual.id}`} />
              </CardContent>
            </Card>
          ) : <div />}
        </div>
      )}
    </div>
  );
}
