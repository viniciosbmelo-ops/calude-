/**
 * Governança do apoio à decisão (seção do painel admin): por versão, status, hash e conferência com o
 * lock, histórico de status e transições (rascunho → revisado → ativo → aposentado; revisado → rascunho).
 * Os erros 409 (hash/lock) e 422 (transição) do servidor aparecem como vieram.
 * Também liga/desliga a feature flag `apoio_decisao`, pelos mesmos endpoints da tela de flags.
 */
import { useState } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  getListApoioDecisaoAlgoritmosQueryKey, getListStatusApoioDecisaoQueryKey, useAlterarStatusApoioDecisao,
  useListApoioDecisaoAlgoritmos, useListStatusApoioDecisao, type ApoioDecisaoAlgoritmo, type ApoioDecisaoStatusRegistro,
} from "@workspace/api-client-react";
import type { StatusAlgoritmo } from "@workspace/clinical/web";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { useLanguage } from "@/lib/i18n";
import { useFeatureFlags, useMutateFeatureFlag } from "@/pages/admin/queries";
import { StatusBadge, useDsT } from "@/components/shoulder/decision/decision-result";
import { algorithmDef } from "@/components/shoulder/decision/decision-runner";
import { describeApiError, transitionsFrom, type ApiErrorView } from "@/components/shoulder/decision/logic";

export const APOIO_DECISAO_FLAG = "apoio_decisao";

function ErrorLine({ error }: { error: ApiErrorView }) {
  const t = useDsT();
  return (
    <div role="alert" className="rounded-md border border-destructive/50 bg-destructive/5 p-2 text-sm text-destructive">
      <p className="font-semibold">{error.status ? t("errorHttp", { status: error.status }) : ""}{error.code ? ` · ${error.code}` : ""}</p>
      <p>{error.message}</p>
    </div>
  );
}

function FlagToggle() {
  const t = useDsT();
  const { data: flags, isLoading } = useFeatureFlags();
  const mut = useMutateFeatureFlag();
  const [error, setError] = useState<ApiErrorView | null>(null);
  const flag = flags?.find((f) => f.key === APOIO_DECISAO_FLAG);
  const qc = useQueryClient();

  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      await qc.invalidateQueries({ queryKey: getListApoioDecisaoAlgoritmosQueryKey() });
    } catch (e) {
      setError(describeApiError(e));
    }
  };

  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-base">{t("flagTitle")}</CardTitle></CardHeader>
      <CardContent className="space-y-2 text-sm">
        <p className="text-muted-foreground">{t("flagHelp")}</p>
        {isLoading ? <p>{t("loading")}</p> : flag ? (
          <label className="flex items-center gap-3">
            <Switch checked={flag.enabled} disabled={mut.update.isPending}
              onCheckedChange={() => run(() => mut.update.mutateAsync({ id: flag.id, data: { enabled: !flag.enabled } }))} />
            <span className="font-medium">{flag.enabled ? t("flagOn") : t("flagOff")}</span>
          </label>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-muted-foreground">{t("flagMissing")}</span>
            <Button size="sm" disabled={mut.create.isPending}
              onClick={() => run(() => mut.create.mutateAsync({ key: APOIO_DECISAO_FLAG, enabled: true, description: t("flagTitle") }))}>
              {t("flagCreate")}
            </Button>
          </div>
        )}
        {error && <ErrorLine error={error} />}
      </CardContent>
    </Card>
  );
}

function VersionCard({ a }: { a: ApoioDecisaoAlgoritmo }) {
  const t = useDsT();
  const { formatDate } = useLanguage();
  const qc = useQueryClient();
  const def = algorithmDef(a);
  const historyKey = getListStatusApoioDecisaoQueryKey(a.id, a.versao);
  const { data: hist } = useListStatusApoioDecisao(a.id, a.versao, { query: { queryKey: historyKey, retry: false } });
  const mut = useAlterarStatusApoioDecisao();
  const [nota, setNota] = useState("");
  const [done, setDone] = useState<ApoioDecisaoStatusRegistro | null>(null);
  const status = a.status as StatusAlgoritmo;

  const transit = (novo: StatusAlgoritmo) => {
    if (novo === "ativo" && !window.confirm(t("confirmActivate"))) return;
    setDone(null);
    mut.mutate(
      { algoritmoId: a.id, versao: a.versao, data: { status: novo, hash: a.hash, ...(nota.trim() ? { nota: nota.trim() } : {}) } },
      {
        onSuccess: async (r) => {
          setDone(r);
          setNota("");
          await Promise.all([
            qc.invalidateQueries({ queryKey: getListApoioDecisaoAlgoritmosQueryKey() }),
            // Ativar aposenta outras versões: recarrega todos os históricos
            qc.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith("/api/apoio-decisao/algoritmos/") }),
          ]);
        },
      },
    );
  };

  return (
    <Card className="min-w-0">
      <CardHeader className="pb-2">
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          {a.titulo}
          <span className="text-sm font-normal text-muted-foreground">{a.id} · {t("version", { v: a.versao })}</span>
          <StatusBadge status={status} />
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          {t("counts", { r: def.regras.length, o: def.opcoes.length, e: def.entradas.length, refs: def.referencias.length })}
        </p>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div>
          <p className="text-xs font-semibold text-muted-foreground">{t("hash")}</p>
          <code className="block break-all text-xs">{a.hash}</code>
          <p className={a.hashConfereLock ? "text-xs text-emerald-700 dark:text-emerald-300" : "text-xs font-semibold text-destructive"}>
            {a.hashConfereLock ? t("hashLockOk") : t("hashLockBad")}
          </p>
        </div>

        <div className="space-y-2">
          {transitionsFrom(status).length === 0
            ? <p className="text-xs text-muted-foreground">{t("noTransitions")}</p>
            : (
              <>
                <input type="text" value={nota} onChange={(e) => setNota(e.target.value)} placeholder={t("notePlaceholder")} maxLength={2000}
                  className="w-full rounded-md border bg-background px-3 py-1.5 text-sm" aria-label={t("notePlaceholder")} />
                <div className="flex flex-wrap gap-2">
                  {transitionsFrom(status).map((s) => (
                    <Button key={s} size="sm" variant={s === "ativo" ? "default" : "outline"} disabled={mut.isPending} onClick={() => transit(s)}>
                      {t("transitionTo", { s: t(`status_${s}`) })}
                    </Button>
                  ))}
                </div>
              </>
            )}
          {mut.error && <ErrorLine error={describeApiError(mut.error)} />}
          {done && (
            <p className="text-xs text-emerald-700 dark:text-emerald-300">
              {t("transitionDone")}: {t(`status_${done.anterior}`)} → {t(`status_${done.status}`)}
              {done.aposentadas.length > 0 && <> · {t("retired", { list: done.aposentadas.join(", ") })}</>}
            </p>
          )}
          <Link href={`/apoio-decisao?algoritmo=${encodeURIComponent(`${a.id}@${a.versao}`)}`} className="inline-block text-xs text-primary hover:underline">{t("openEvaluation")}</Link>
        </div>

        <details>
          <summary className="cursor-pointer text-xs font-semibold">{t("historyTitle")}</summary>
          {hist && hist.historico.length === 0 && <p className="mt-2 text-xs text-muted-foreground">{t("historyEmpty")}</p>}
          <ul className="mt-2 space-y-1">
            {hist?.historico.map((h) => (
              <li key={h.id} className="text-xs">
                <span className="font-medium">{t(`status_${h.status}`)}</span> · {formatDate(h.createdAt, { dateStyle: "short", timeStyle: "short" })}
                {h.doctorId !== null && <> · {t("historyBy", { id: h.doctorId })}</>}
                {!h.hashConfereCodigo && <span className="ml-1 text-amber-700 dark:text-amber-300">({t("historyOtherHash")}: {h.hash.slice(0, 12)}…)</span>}
                {h.nota && <span className="block text-muted-foreground">{h.nota}</span>}
              </li>
            ))}
          </ul>
        </details>
      </CardContent>
    </Card>
  );
}

export function DecisionGovernance() {
  const t = useDsT();
  const { data, isLoading, error } = useListApoioDecisaoAlgoritmos({
    query: { queryKey: getListApoioDecisaoAlgoritmosQueryKey(), retry: false },
  });
  const algoritmos = data?.algoritmos ?? [];
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-semibold">{t("govTitle")}</h2>
        <p className="text-sm text-muted-foreground">{t("govHelp")}</p>
      </div>
      <FlagToggle />
      {isLoading && <p className="text-sm text-muted-foreground">{t("loading")}</p>}
      {error && <p role="alert" className="text-sm text-destructive">{t("loadError")}</p>}
      {!isLoading && !error && algoritmos.length === 0 && <p className="text-sm text-muted-foreground">{t("noAlgorithms")}</p>}
      <div className="grid gap-4 lg:grid-cols-2">
        {algoritmos.map((a) => <VersionCard key={`${a.id}@${a.versao}`} a={a} />)}
      </div>
    </div>
  );
}
