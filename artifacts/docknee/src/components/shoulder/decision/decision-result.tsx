/**
 * Painel de resultado do apoio à decisão: rótulo fixo de sugestão, opções com força e sentido,
 * controvérsias lado a lado, dados que faltam, avisos, trace das regras e referências.
 * Só leitura; reutilizado na página, no painel do registro e no cartão da cirurgia.
 */
import { AlertTriangle, BookOpen, CircleHelp, ExternalLink, Info, Scale, ThumbsUp } from "lucide-react";
import { DECISION_ALGORITHMS, type AlgorithmDef, type Forca, type Referencia, type ResultadoApoio, type SentidoOpcao, type StatusAlgoritmo } from "@workspace/clinical/web";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth";
import { useLanguage, useScopedTranslations } from "@/lib/i18n";
import { decisionSupportMessages } from "@/locales/decision-support";
import {
  alternativeEvidence, collectControversies, conflictLines, criticalMissing, displayDirection, formatTraceValue, groupTrace, motiveTag, orderedMotives,
  parameterLines, referenceHref, referenceIds, referenceMap, ruleTitle, shouldShowRuleCodes, usedInputLines, valueLabelsOf, type ExecutionMeta, type ProvenanceKind,
} from "./logic";

export type DsT = ReturnType<typeof useDsT>;
export function useDsT() {
  return useScopedTranslations(decisionSupportMessages);
}

/** Aviso persistente: sugestão baseada na literatura, não decisão; a evidência tem limites. */
export function DecisionDisclaimer({ compact = false }: { compact?: boolean }) {
  const t = useDsT();
  return (
    <div role="note" className={cn("rounded-lg border border-sky-300/60 bg-sky-50 text-sky-950 dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-100", compact ? "p-3 text-xs" : "p-4 text-sm")}>
      <p className="flex items-center gap-2 font-semibold"><Info className="h-4 w-4 shrink-0" />{t("disclaimerTitle")}</p>
      <p className="mt-1 leading-relaxed">{t("disclaimerBody")}</p>
    </div>
  );
}

const STATUS_CLASS: Record<StatusAlgoritmo, string> = {
  rascunho: "border-amber-400 bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200",
  revisado: "border-sky-400 bg-sky-50 text-sky-900 dark:bg-sky-950/40 dark:text-sky-200",
  ativo: "border-emerald-400 bg-emerald-50 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200",
  aposentado: "border-slate-300 bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
};

export function StatusBadge({ status }: { status: StatusAlgoritmo }) {
  const t = useDsT();
  return <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold", STATUS_CLASS[status])}>{t(`status_${status}`)}</span>;
}

/** Cor neutra por força (sem vermelho: força não é urgência). Controversa em âmbar. */
const FORCA_CLASS: Record<Forca, string> = {
  forte: "bg-slate-800 text-white dark:bg-slate-200 dark:text-slate-900",
  moderada: "bg-slate-500 text-white dark:bg-slate-400 dark:text-slate-900",
  fraca: "bg-slate-200 text-slate-800 dark:bg-slate-700 dark:text-slate-100",
  controversa: "bg-amber-100 text-amber-900 border border-amber-400 dark:bg-amber-950/50 dark:text-amber-200",
};

export function StrengthChip({ forca }: { forca: Forca }) {
  const t = useDsT();
  return <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold", FORCA_CLASS[forca])}>{t("strength", { f: t(`forca_${forca}`) })}</span>;
}

const DIRECTION_CLASS: Record<SentidoOpcao, string> = {
  favorece: "text-emerald-700 dark:text-emerald-300",
  alternativa: "text-sky-800 dark:text-sky-300",
  desfavorece: "text-amber-700 dark:text-amber-300",
};
const DIRECTION_ICON = { favorece: ThumbsUp, alternativa: CircleHelp, desfavorece: AlertTriangle } as const;

export function DirectionTag({ sentido }: { sentido: SentidoOpcao }) {
  const t = useDsT();
  const Icon = DIRECTION_ICON[sentido];
  return (
    <span className={cn("inline-flex items-center gap-1 text-xs font-medium", DIRECTION_CLASS[sentido])}>
      <Icon className="h-3.5 w-3.5" />{t(`sentido_${sentido}`)}
    </span>
  );
}

/** Força + sentido de uma opção. Alternativa de zona cinzenta: só o rótulo de alternativa (sem força nem "favorece"). */
export function OptionDirection({ forca, sentido }: { forca: Forca; sentido: SentidoOpcao }) {
  return (
    <>
      {sentido !== "alternativa" && <StrengthChip forca={forca} />}
      <DirectionTag sentido={sentido} />
    </>
  );
}

function RefLinks({ ids, refs }: { ids: readonly string[]; refs: Map<string, Referencia> }) {
  if (!ids.length) return null;
  return (
    <span className="inline-flex flex-wrap gap-1">
      {ids.map((id) => {
        const r = refs.get(id);
        const href = r ? referenceHref(r) : undefined;
        return href
          ? <a key={id} href={href} target="_blank" rel="noopener noreferrer" className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-primary hover:underline" title={r?.citacao}>{id}</a>
          : <span key={id} className="rounded bg-muted px-1.5 py-0.5 text-[11px]">{id}</span>;
      })}
    </span>
  );
}

const PROV_CLASS: Record<ProvenanceKind, string> = {
  registro: "border-sky-300 bg-sky-50 text-sky-900 dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-200",
  manual: "border-slate-300 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200",
  derivado: "border-violet-300 bg-violet-50 text-violet-900 dark:border-violet-800 dark:bg-violet-950/40 dark:text-violet-200",
};

const SOURCE_KEYS = new Set(["payload", "intraop", "paciente", "derivada", "manual"]);

function ProvenanceTag({ kind, title }: { kind: ProvenanceKind; title?: string }) {
  const t = useDsT();
  return <span title={title} className={cn("inline-flex items-center rounded border px-1.5 py-0 text-[10px] font-medium uppercase tracking-wide", PROV_CLASS[kind])}>{t(`prov_${kind}`)}</span>;
}

export function DecisionResultView({ resultado, def: defProp, execucaoId, modo, meta }: {
  resultado: ResultadoApoio;
  def?: AlgorithmDef;
  execucaoId?: number;
  modo?: string;
  /** Proveniência, conflitos com o registro e parâmetros ignorados (resposta da avaliação ou linha gravada). */
  meta?: ExecutionMeta;
}) {
  const t = useDsT();
  const { locale } = useLanguage();
  const { user } = useAuth();
  // Códigos internos das regras: só para administradores ou execuções de revisão.
  const showCodes = shouldShowRuleCodes({ isAdmin: user?.isAdmin, modo });
  // Resultado gravado sem a definição em mãos (cartão da cirurgia): usa a versão registrada no código, se houver.
  const def = defProp ?? DECISION_ALGORITHMS.find((d) => d.id === resultado.algoritmo.id && d.versao === resultado.algoritmo.versao);
  const labels = { yes: t("yes"), no: t("no"), locale };
  const sourceLabel = (origem: string) => (SOURCE_KEYS.has(origem) ? t(`src_${origem}` as "src_manual") : origem);
  const conflitos = conflictLines(meta?.conflitos, def, labels, meta?.proveniencia);
  const usados = usedInputLines(resultado.entrada ?? {}, def, labels, meta?.proveniencia, meta?.conflitos);
  const parametros = parameterLines(resultado.parametros, locale);
  const refs = referenceMap(resultado);
  const controversias = collectControversies(resultado.opcoes);
  const trace = groupTrace(resultado.trace);
  const entradaRotulo = (id: string) => def?.entradas.find((e) => e.id === id)?.rotulo ?? id;
  const rotulosDe = (id: string) => valueLabelsOf(def?.entradas.find((e) => e.id === id));
  const titulo = def?.titulo ?? resultado.algoritmo.id;
  const criticos = criticalMissing(resultado, def);
  const criticalText = (c: { entrada: string; rotulo: string; regras: number }) => {
    const key = `critical_${c.entrada}`;
    return key in decisionSupportMessages["pt-BR"]
      ? t(key as "critical_reparabilidade_estimada")
      : t("criticalMissingGeneric", { rotulo: c.rotulo, n: c.regras });
  };

  return (
    <section className="space-y-4" aria-label={t("suggestionLabel")}>
      {/* Rótulo fixo */}
      <div className="rounded-xl border-2 border-primary/40 bg-primary/5 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-md bg-primary px-3 py-1 text-base font-bold uppercase tracking-wide text-primary-foreground">{t("suggestionLabel")}</span>
          <StatusBadge status={resultado.algoritmo.status} />
          {modo && <span className="text-xs text-muted-foreground">{t(`modo_${modo}` as "modo_preop")}</span>}
        </div>
        <p className="mt-2 text-sm font-medium">{t("resultFor", { titulo, versao: resultado.algoritmo.versao })}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {t("completeness", { avaliadas: resultado.completude.avaliadas, total: resultado.completude.total, indeterminadas: resultado.completude.indeterminadas })}
          {execucaoId !== undefined && <> · {t("executionId", { id: execucaoId })}</>}
        </p>
      </div>

      {/* Dado crítico ausente: destaque no topo; só sugere informar (o campo não é obrigatório) */}
      {criticos.length > 0 && (
        <div role="note" data-testid="critical-missing" className="rounded-lg border-2 border-amber-500 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-600 dark:bg-amber-950/50 dark:text-amber-100">
          <p className="flex items-center gap-2 font-semibold"><AlertTriangle className="h-4 w-4 shrink-0" />{t("criticalMissingTitle")}</p>
          <ul className="mt-1 space-y-1">
            {criticos.map((c) => <li key={c.entrada}>{criticalText(c)}</li>)}
          </ul>
          <p className="mt-1 text-xs opacity-80">{t("criticalMissingNote")}</p>
        </div>
      )}

      {/* Conflitos com o registro salvo: informativo, o registro prevaleceu */}
      {conflitos.length > 0 && (
        <div role="note" className="rounded-lg border border-sky-300/60 bg-sky-50 p-3 text-sm text-sky-950 dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-100">
          <p className="flex items-center gap-2 font-semibold"><Info className="h-4 w-4 shrink-0" />{t("conflictsTitle")}</p>
          <p className="mt-1 text-xs leading-relaxed">{t("conflictsBody")}</p>
          <ul className="mt-2 space-y-1">
            {conflitos.map((c) => (
              <li key={c.entrada} title={c.caminho}>
                {t("conflictLine", { rotulo: c.rotulo, digitado: c.digitado, usado: c.usado, fonte: sourceLabel(c.origem) })}
              </li>
            ))}
          </ul>
        </div>
      )}

      {meta?.parametrosIgnorados && (
        <div role="note" className="flex items-start gap-2 rounded-lg border border-sky-300/60 bg-sky-50 p-3 text-sm text-sky-950 dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-100">
          <Info className="mt-0.5 h-4 w-4 shrink-0" /><p>{t("paramsIgnored")}</p>
        </div>
      )}

      {(resultado.foraDeEscopo.length > 0 || resultado.escopoIndeterminado.length > 0) && (
        <div className="space-y-2">
          {resultado.foraDeEscopo.length > 0 && (
            <div className="rounded-lg border border-amber-400 bg-amber-50 p-3 text-sm dark:bg-amber-950/40">
              <p className="font-semibold">{t("outOfScope")}</p>
              <ul className="mt-1 list-disc pl-5">{resultado.foraDeEscopo.map((f) => <li key={f.id}>{f.texto}</li>)}</ul>
            </div>
          )}
          {resultado.escopoIndeterminado.length > 0 && (
            <div className="rounded-lg border p-3 text-sm">
              <p className="font-semibold">{t("scopeUndetermined")}</p>
              <ul className="mt-1 list-disc pl-5">
                {resultado.escopoIndeterminado.map((f) => <li key={f.id}>{f.texto} <span className="text-xs text-muted-foreground">({t("traceMissing", { list: f.faltando.map(entradaRotulo).join(", ") })})</span></li>)}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Avisos */}
      {resultado.avisos.length > 0 && (
        <div className="rounded-lg border border-amber-400 bg-amber-50 p-3 text-sm dark:bg-amber-950/40">
          <p className="flex items-center gap-2 font-semibold"><AlertTriangle className="h-4 w-4" />{t("warningsTitle")}</p>
          <ul className="mt-1 space-y-1 pl-1">
            {resultado.avisos.map((a) => <li key={a.regra}>{a.texto} <RefLinks ids={a.referencias} refs={refs} /></li>)}
          </ul>
        </div>
      )}

      {/* Opções */}
      <div className="space-y-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold"><Scale className="h-4 w-4" />{t("optionsTitle")}</h3>
        {resultado.opcoes.length === 0 && <p className="text-sm text-muted-foreground">{t("noOptions")}</p>}
        <ul className="space-y-2">
          {resultado.opcoes.map((o) => {
            const sentido = displayDirection(o);
            const evidencia = sentido === "alternativa" ? alternativeEvidence(o) : [];
            return (
              <li key={o.opcao} className="rounded-lg border p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{o.rotulo}</span>
                  <OptionDirection forca={o.forca} sentido={sentido} />
                </div>
                {evidencia.length > 0 && (
                  <div className="mt-2">
                    <p className="text-xs font-semibold text-muted-foreground">{t("alternativeEvidenceTitle")}</p>
                    <ul className="mt-1 space-y-1 text-sm">
                      {evidencia.map((a, i) => (
                        <li key={`${a.regra}-${i}`} className="flex flex-wrap items-baseline gap-x-2">
                          <span>{a.argumento}</span>
                          <span className="text-[11px] text-muted-foreground">{ruleTitle(def, a.regra)}</span>
                          <RefLinks ids={a.referencias} refs={refs} />
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {o.motivos.length > 0 && (
                  <div className="mt-2">
                    <p className="text-xs font-semibold text-muted-foreground">{t("whyTitle")}</p>
                    <ul className="mt-1 space-y-1 text-sm">
                      {orderedMotives(o.motivos, sentido, o).map((m, i) => {
                        const tag = motiveTag(o, m, sentido);
                        return (
                          <li key={`${m.regra}-${i}`} className="flex flex-wrap items-baseline gap-x-2">
                            <span>{m.texto}</span>
                            <span className="text-[11px] text-muted-foreground">{showCodes && <>{m.regra} · </>}{t(`sentido_${tag.sentido}`)}{tag.forca ? <> · {t(`forca_${tag.forca}`)}</> : null}</span>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}
                {o.referencias.length > 0 && <div className="mt-2"><RefLinks ids={o.referencias} refs={refs} /></div>}
              </li>
            );
          })}
        </ul>
      </div>

      {/* Controvérsias: sempre expandidas, alternativas lado a lado */}
      {controversias.map((c) => (
        <div key={c.regra} className="rounded-lg border border-amber-400 bg-amber-50/60 p-3 dark:bg-amber-950/30">
          <p className="flex items-center gap-2 text-sm font-semibold"><CircleHelp className="h-4 w-4" />{t("controversyTitle")}</p>
          <p className="mt-1 text-sm">{c.nota}{showCodes && <> <span className="text-[11px] text-muted-foreground">({c.regra})</span></>}</p>
          <div className="mt-2 grid gap-2" style={{ gridTemplateColumns: `repeat(auto-fit, minmax(12rem, 1fr))` }}>
            {c.alternativas.map((a) => (
              <div key={a.opcao} className="rounded-md border bg-background p-2 text-sm">
                <p className="font-semibold">{a.rotulo}</p>
                <p className="mt-1">{a.argumento}</p>
                <div className="mt-1"><RefLinks ids={a.referencias} refs={refs} /></div>
              </div>
            ))}
          </div>
        </div>
      ))}

      {/* Dados usados, com a origem de cada valor */}
      {usados.length > 0 && (
        <div className="space-y-1">
          <h3 className="text-sm font-semibold">{t("usedTitle")}</h3>
          <ul className="space-y-1 text-sm">
            {usados.map((u) => (
              <li key={u.id} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <span><span className="font-medium">{u.rotulo}:</span> {u.valor}</span>
                {u.kind && <ProvenanceTag kind={u.kind} title={[u.caminho, u.nota].filter(Boolean).join(" · ") || undefined} />}
                {u.emConflito && <span className="text-[11px] text-sky-800 dark:text-sky-300">{t("conflictTag")}</span>}
              </li>
            ))}
          </ul>
          {usados.some((u) => u.kind) && <p className="text-[11px] text-muted-foreground">{t("usedLegend")}</p>}
        </div>
      )}

      {/* Dados que faltam */}
      <div className="space-y-1">
        <h3 className="text-sm font-semibold">{t("missingTitle")}</h3>
        {resultado.faltantes.length === 0
          ? <p className="text-sm text-muted-foreground">{t("missingNone")}</p>
          : (
            <ul className="space-y-1 text-sm">
              {resultado.faltantes.map((f) => (
                <li key={f.entrada} className="flex flex-wrap items-baseline gap-x-2">
                  <span className="font-medium">{f.rotulo}{f.unidade ? ` (${f.unidade})` : ""}</span>
                  <span className="text-xs text-muted-foreground">
                    {f.desbloqueia.length === 1 ? t("unlocksOne") : t("unlocksMany", { n: f.desbloqueia.length })}: {f.desbloqueia.map((id) => ruleTitle(def, id)).join("; ")}
                  </span>
                </li>
              ))}
            </ul>
          )}
        {resultado.entradasDescartadas.length > 0 && (
          <p className="text-xs text-muted-foreground">{t("discarded", { list: resultado.entradasDescartadas.map(entradaRotulo).join(", ") })}</p>
        )}
      </div>

      {/* Parâmetros (limiares) usados */}
      {parametros.length > 0 && (
        <div className="space-y-1">
          <h3 className="text-sm font-semibold">{t("parametersTitle")}</h3>
          <ul className="space-y-2 text-sm">
            {parametros.map((p) => (
              <li key={p.id}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{p.rotulo}: {p.valor}</span>
                  <span className="text-[11px] text-muted-foreground">{t(`paramOrigin_${p.origem}`)}</span>
                  {p.pendente && (
                    <span className="inline-flex items-center rounded-full border border-amber-400 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">{t("paramPending")}</span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">{p.nota} <RefLinks ids={p.referencias} refs={refs} /></p>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Trace */}
      <details className="rounded-lg border p-3">
        <summary className="cursor-pointer text-sm font-semibold">{t("traceTitle")}</summary>
        <div className="mt-2 space-y-3">
          {trace.map((g) => (
            <div key={g.grupo}>
              <p className="text-xs font-semibold uppercase text-muted-foreground">{t(`trace_${g.grupo}`)}</p>
              <ul className="mt-1 space-y-1 text-sm">
                {g.itens.map((it) => (
                  <li key={it.regra}>
                    <span className="font-medium">{ruleTitle(def, it.regra)}</span>{showCodes && <> <span className="text-[11px] text-muted-foreground">{it.regra}</span></>}
                    {Object.keys(it.valores).length > 0 && (
                      <span className="ml-2 text-xs text-muted-foreground">
                        {Object.entries(it.valores).map(([k, v]) => `${entradaRotulo(k)} = ${formatTraceValue(v, locale, rotulosDe(k))}`).join("; ")}
                      </span>
                    )}
                    {it.faltando.length > 0 && <span className="ml-2 text-xs text-amber-700 dark:text-amber-300">{t("traceMissing", { list: it.faltando.map(entradaRotulo).join(", ") })}</span>}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </details>

      {/* Referências */}
      {resultado.referencias.length > 0 && (
        <div className="space-y-1">
          <h3 className="flex items-center gap-2 text-sm font-semibold"><BookOpen className="h-4 w-4" />{t("referencesTitle")}</h3>
          <ol className="space-y-2 text-sm">
            {resultado.referencias.map((r) => {
              const href = referenceHref(r);
              return (
                <li key={r.id} className="rounded-md border p-2">
                  <p><span className="font-semibold">{r.id}</span> · {t("level", { n: r.nivel })} · {t(`tipo_${r.tipo}`)}</p>
                  <p className="text-xs">{r.citacao}</p>
                  <p className="text-xs">
                    {href
                      ? <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">{referenceIds(r)}<ExternalLink className="h-3 w-3" /></a>
                      : referenceIds(r)}
                  </p>
                  {r.conflitoInteresse && <p className="text-xs text-muted-foreground">{t("conflict", { c: r.conflitoInteresse })}</p>}
                </li>
              );
            })}
          </ol>
        </div>
      )}

      {resultado.avisosGerais.length > 0 && (
        <div className="space-y-1">
          <h3 className="text-sm font-semibold">{t("generalWarnings")}</h3>
          <ul className="list-disc pl-5 text-xs text-muted-foreground">{resultado.avisosGerais.map((a, i) => <li key={i}>{a}</li>)}</ul>
        </div>
      )}
    </section>
  );
}
