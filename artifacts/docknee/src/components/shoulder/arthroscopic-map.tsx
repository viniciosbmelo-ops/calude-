/** Inventário artroscópico: cada estrutura da região como Normal / Lesão / Tratada / N.A. */
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useScopedTranslations } from "@/lib/i18n";
import { surgeryShoulderMessages } from "@/locales/surgery-shoulder";
import { ARTHRO_STRUCTURES, type ClinicalMapEntry, type Region } from "@workspace/clinical/web";

const STATUSES: [ClinicalMapEntry["status"], string, string][] = [
  ["normal", "Normal", "border-primary bg-primary/5 text-primary"],
  ["lesion", "Lesão", "border-destructive bg-destructive/10 text-destructive"],
  ["treated", "Tratada", "border-emerald-600 bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"],
  ["not_evaluated", "N.A.", "border-muted-foreground bg-muted text-muted-foreground"],
];

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function ArthroscopicMap({ region, value, onChange, readOnly }: {
  region: Region;
  value: ClinicalMapEntry[];
  onChange(v: ClinicalMapEntry[]): void;
  readOnly?: boolean;
}) {
  const t = useScopedTranslations(surgeryShoulderMessages);
  const names = ARTHRO_STRUCTURES[region];
  const byCode = new Map(value.map((e) => [e.structure_code, e]));
  // Na leitura, só o que foi registrado; na edição, todas as estruturas da região.
  const order = Object.keys(names).filter((c) => !readOnly || byCode.has(c));
  const set = (code: string, patch: Partial<ClinicalMapEntry> | null) => {
    const next = new Map(byCode);
    if (patch === null) next.delete(code);
    else next.set(code, { ...(next.get(code) ?? { structure_code: code, status: "normal" }), ...patch } as ClinicalMapEntry);
    onChange(order.filter((c) => next.has(c)).map((c) => next.get(c)!));
  };
  const pending = order.filter((c) => !byCode.has(c)).length;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        {!readOnly && <span>{pending > 0 ? t(pending === 1 ? "arthroMapPendingOne" : "arthroMapPending", { count: pending }) : t("arthroMapAllRecorded")}</span>}
        {!readOnly && pending > 0 && (
          <button type="button" className="font-medium text-primary hover:underline"
            onClick={() => onChange(order.map((c) => byCode.get(c) ?? { structure_code: c, status: "normal" }))}>
            {t("arthroMapMarkRemainingNormal")}
          </button>
        )}
      </div>
      <div className="divide-y rounded-xl border">
        {order.map((code) => {
          const e = byCode.get(code);
          const name = cap(names[code]);
          return (
            <div key={code} className="space-y-2 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm">{name}</span>
                <div className="grid grid-cols-4 gap-1" role="group" aria-label={name}>
                  {STATUSES.map(([v, l, on]) => (
                    <button key={v} type="button" disabled={readOnly} aria-pressed={e?.status === v}
                      onClick={() => set(code, e?.status === v ? null : { status: v })}
                      className={cn("rounded-md border-2 px-2 py-1 text-xs font-medium transition-all", e?.status === v ? on : "border-border hover:border-primary/40")}>
                      {l}
                    </button>
                  ))}
                </div>
              </div>
              {(e?.status === "lesion" || e?.status === "treated") && (
                <div className="grid gap-2 sm:grid-cols-2">
                  <Input placeholder="Achado (ex.: rotura parcial de 40%)" maxLength={300} disabled={readOnly} value={e.finding_text ?? ""}
                    onChange={(x) => set(code, { finding_text: x.target.value || undefined })} aria-label={`Achado — ${name}`} />
                  {e.status === "lesion" && (
                    <Input placeholder="Justificativa se não tratada" maxLength={300} disabled={readOnly} value={e.justification ?? ""}
                      onChange={(x) => set(code, { justification: x.target.value || undefined })} aria-label={`Justificativa — ${name}`} />
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
