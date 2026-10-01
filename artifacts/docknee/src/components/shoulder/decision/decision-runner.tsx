/**
 * Formulário de entrada, avaliação no servidor e escolha do cirurgião.
 * Usado na página "Apoio à decisão" (modo preop) e no painel do registro cirúrgico (modo registro).
 */
import { useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import {
  useAvaliarApoioDecisao, useRegistrarEscolhaApoioDecisao,
  type ApoioDecisaoAlgoritmo, type ApoioDecisaoEscolha,
} from "@workspace/api-client-react";
import type { AlgorithmDef, EntradaDef, OpcaoDef, ResultadoApoio } from "@workspace/clinical/web";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { DecisionResultView, useDsT, type DsT } from "./decision-result";
import {
  BOOL_NAO, BOOL_SIM, CHOICE_OTHER, MAX_JUSTIFICATIVA, MAX_OUTRA, buildChoicePayload, buildEntrada, describeApiError,
  emptyChoice, visibleInputs, type ApiErrorView, type ChoiceState, type FieldError, type FormValues,
} from "./logic";

export function algorithmDef(a: Pick<ApoioDecisaoAlgoritmo, "definicao">): AlgorithmDef {
  return a.definicao as unknown as AlgorithmDef;
}

function rangeHint(e: EntradaDef, t: DsT): string | null {
  if (e.def.tipo !== "numero") return null;
  const { min, max } = e.def;
  if (min !== undefined && max !== undefined) return t("rangeBoth", { min, max });
  if (min !== undefined) return t("rangeMin", { min });
  if (max !== undefined) return t("rangeMax", { max });
  return null;
}

function errorText(err: FieldError, t: DsT): string {
  return t(`err_${err.code}`, err.limit !== undefined ? { limit: err.limit } : undefined);
}

export function DecisionInputForm({ entradas, values, onChange, errors, idPrefix }: {
  entradas: readonly EntradaDef[];
  values: FormValues;
  onChange(values: FormValues): void;
  errors: Record<string, FieldError>;
  idPrefix: string;
}) {
  const t = useDsT();
  const set = (id: string, v: FormValues[string]) => onChange({ ...values, [id]: v });
  const inputCls = "w-full rounded-md border bg-background px-3 py-2 text-sm";

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {entradas.map((e) => {
        const fid = `${idPrefix}-${e.id}`;
        const err = errors[e.id];
        const raw = values[e.id];
        const d = e.def;
        const hint = [d.tipo === "numero" ? d.unidade : null, rangeHint(e, t)].filter(Boolean).join(" · ");
        return (
          <div key={e.id} className={cn("space-y-1", d.tipo === "lista" && "sm:col-span-2")}>
            <label htmlFor={fid} className="flex flex-wrap items-baseline gap-2 text-sm font-medium">
              {e.rotulo}
              {hint && <span className="text-xs font-normal text-muted-foreground">{hint}</span>}
              {e.momento === "intraop" && <span className="rounded bg-muted px-1.5 text-[10px] uppercase">{t("intraopTag")}</span>}
            </label>
            {d.tipo === "numero" && (
              <input id={fid} inputMode="decimal" type="text" placeholder={t("notInformed")}
                value={typeof raw === "string" ? raw : ""} aria-invalid={Boolean(err)}
                onChange={(ev) => set(e.id, ev.target.value === "" ? undefined : ev.target.value)}
                className={cn(inputCls, err && "border-destructive")} />
            )}
            {d.tipo === "booleano" && (
              <select id={fid} value={typeof raw === "string" ? raw : ""} className={inputCls}
                onChange={(ev) => set(e.id, ev.target.value || undefined)}>
                <option value="">{t("notInformed")}</option>
                <option value={BOOL_SIM}>{t("yes")}</option>
                <option value={BOOL_NAO}>{t("no")}</option>
              </select>
            )}
            {d.tipo === "enum" && (
              <select id={fid} value={typeof raw === "string" ? raw : ""} className={inputCls}
                onChange={(ev) => set(e.id, ev.target.value || undefined)}>
                <option value="">{t("notInformed")}</option>
                {d.valores.map((v) => <option key={v} value={v}>{v}</option>)}
              </select>
            )}
            {d.tipo === "lista" && (
              <div id={fid} role="group" className="flex flex-wrap gap-2">
                {d.valores.map((v) => {
                  const cur = Array.isArray(raw) ? raw : [];
                  const on = cur.includes(v);
                  return (
                    <label key={v} className={cn("flex cursor-pointer items-center gap-1.5 rounded-md border px-2 py-1 text-sm", on && "border-primary bg-primary/5")}>
                      <input type="checkbox" checked={on}
                        onChange={() => {
                          const next = on ? cur.filter((x) => x !== v) : [...cur, v];
                          set(e.id, next.length ? next : undefined);
                        }} />
                      {v}
                    </label>
                  );
                })}
              </div>
            )}
            {err && <p className="text-xs text-destructive">{errorText(err, t)}</p>}
          </div>
        );
      })}
    </div>
  );
}

function ErrorBox({ error, title }: { error: ApiErrorView; title: string }) {
  const t = useDsT();
  return (
    <div role="alert" className="rounded-lg border border-destructive/50 bg-destructive/5 p-3 text-sm text-destructive">
      <p className="font-semibold">{title}{error.status ? ` · ${t("errorHttp", { status: error.status })}` : ""}{error.code ? ` · ${error.code}` : ""}</p>
      <p>{error.message}</p>
    </div>
  );
}

export function SurgeonChoiceForm({ execucaoId, opcoes, onSaved }: {
  execucaoId: number;
  opcoes: readonly Pick<OpcaoDef, "id" | "rotulo">[];
  onSaved?(escolha: ApoioDecisaoEscolha): void;
}) {
  const t = useDsT();
  const [state, setState] = useState<ChoiceState>(emptyChoice);
  const [problem, setProblem] = useState<string | null>(null);
  const [saved, setSaved] = useState<ApoioDecisaoEscolha | null>(null);
  const mut = useRegistrarEscolhaApoioDecisao();
  const name = `ds-choice-${execucaoId}`;

  const submit = () => {
    const r = buildChoicePayload(state, opcoes.map((o) => o.id));
    if (!r.ok) {
      setProblem(t(`choice_${r.problem}`));
      return;
    }
    setProblem(null);
    mut.mutate({ id: execucaoId, data: r.body }, {
      onSuccess: (escolha) => { setSaved(escolha); onSaved?.(escolha); },
    });
  };

  return (
    <fieldset className="space-y-3 rounded-lg border p-3">
      <legend className="px-1 text-sm font-semibold">{t("choiceTitle")}</legend>
      <p className="text-xs text-muted-foreground">{t("choiceHelp")}</p>
      <div className="space-y-1">
        {opcoes.map((o) => (
          <label key={o.id} className="flex cursor-pointer items-center gap-2 text-sm">
            <input type="radio" name={name} value={o.id} checked={state.selecao === o.id}
              onChange={() => setState((s) => ({ ...s, selecao: o.id }))} />
            {o.rotulo}
          </label>
        ))}
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input type="radio" name={name} value={CHOICE_OTHER} checked={state.selecao === CHOICE_OTHER}
            onChange={() => setState((s) => ({ ...s, selecao: CHOICE_OTHER }))} />
          {t("choiceOther")}
        </label>
        {state.selecao === CHOICE_OTHER && (
          <input type="text" maxLength={MAX_OUTRA} value={state.outra} placeholder={t("choiceOtherPlaceholder")}
            onChange={(e) => setState((s) => ({ ...s, outra: e.target.value }))}
            className="ml-6 w-[calc(100%-1.5rem)] rounded-md border bg-background px-3 py-2 text-sm" aria-label={t("choiceOther")} />
        )}
      </div>
      <div className="space-y-1">
        <label htmlFor={`${name}-just`} className="text-sm font-medium">{t("choiceJustification")}</label>
        <Textarea id={`${name}-just`} rows={2} maxLength={MAX_JUSTIFICATIVA} value={state.justificativa}
          onChange={(e) => setState((s) => ({ ...s, justificativa: e.target.value }))} />
      </div>
      {problem && <p className="text-xs text-destructive">{problem}</p>}
      {mut.error && <ErrorBox error={describeApiError(mut.error)} title={t("choiceError")} />}
      {saved && (
        <p className="text-sm text-emerald-700 dark:text-emerald-300">
          {t("choiceSaved")} · {t(`concordancia_${saved.concordancia}`)}
        </p>
      )}
      <Button type="button" size="sm" onClick={submit} disabled={mut.isPending}>
        {mut.isPending ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />{t("choiceSaving")}</> : t("choiceSave")}
      </Button>
    </fieldset>
  );
}

/**
 * Formulário + avaliação + resultado + escolha para uma versão de algoritmo.
 * Os IDs de paciente/cirurgia só são enviados para versões ativas (o servidor recusa vínculo em revisão).
 */
export function DecisionRunner({ algoritmo, modo, initialValues, patientId, surgeryId, idPrefix }: {
  algoritmo: ApoioDecisaoAlgoritmo;
  modo: "preop" | "registro";
  initialValues?: FormValues;
  patientId?: number;
  surgeryId?: number;
  idPrefix: string;
}) {
  const t = useDsT();
  const def = algorithmDef(algoritmo);
  const entradas = useMemo(() => visibleInputs(def, modo), [def, modo]);
  const [values, setValues] = useState<FormValues>(() => ({ ...(initialValues ?? {}) }));
  const [errors, setErrors] = useState<Record<string, FieldError>>({});
  const mut = useAvaliarApoioDecisao();
  const exec = mut.data;
  const resultado = exec?.resultado as unknown as ResultadoApoio | undefined;

  const evaluate = () => {
    const { entrada, errors: errs } = buildEntrada(entradas, values);
    setErrors(errs);
    if (Object.keys(errs).length) return;
    const vinculavel = algoritmo.status === "ativo";
    mut.mutate({
      algoritmoId: algoritmo.id,
      versao: algoritmo.versao,
      data: {
        entrada,
        modo,
        ...(vinculavel && surgeryId ? { surgeryId } : {}),
        ...(vinculavel && patientId && !surgeryId ? { patientId } : {}),
      },
    });
  };

  return (
    <div className="space-y-4">
      {algoritmo.status !== "ativo" && <p className="rounded-md border border-amber-400 bg-amber-50 p-2 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">{t("reviewModeNote")}</p>}
      <div className="space-y-2">
        <h3 className="text-sm font-semibold">{t("inputsTitle")}</h3>
        <p className="text-xs text-muted-foreground">{t("inputsHelp")}</p>
        <DecisionInputForm entradas={entradas} values={values} onChange={setValues} errors={errors} idPrefix={idPrefix} />
      </div>
      {Object.keys(errors).length > 0 && <p className="text-sm text-destructive">{t("fixErrors")}</p>}
      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={evaluate} disabled={mut.isPending}>
          {mut.isPending ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />{t("evaluating")}</> : t("evaluate")}
        </Button>
        <Button type="button" variant="outline" onClick={() => { setValues({}); setErrors({}); mut.reset(); }}>{t("clear")}</Button>
      </div>
      <p className="text-xs text-muted-foreground">{t("auditNote")}</p>
      {mut.error && <ErrorBox error={describeApiError(mut.error)} title={t("evalError")} />}
      {exec && resultado && (
        <div className="space-y-4">
          <DecisionResultView resultado={resultado} def={def} execucaoId={exec.execucaoId} modo={exec.modo} />
          {exec.modo !== "revisao" && <SurgeonChoiceForm key={exec.execucaoId} execucaoId={exec.execucaoId} opcoes={def.opcoes} />}
        </div>
      )}
    </div>
  );
}
