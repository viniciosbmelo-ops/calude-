/** Campos das escalas do médico (Constant/Rowe) dentro do formulário de retorno. */
import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useScopedTranslations } from "@/lib/i18n";
import { surgeryViewMessages } from "@/locales/surgery-view";
import {
  evaluateDraft,
  hasDirectionHint,
  itemHintKey,
  itemLabelKey,
  optionLabelKey,
  scaleMax,
  scaleNameKey,
  visibleItems,
  type ScaleDraft,
} from "./clinician-scales";

type MessageKey = keyof (typeof surgeryViewMessages)["pt-BR"];

export function ClinicianScalesFields({ scales, drafts, onChange }: {
  scales: readonly string[];
  drafts: Record<string, ScaleDraft>;
  onChange: (code: string, draft: ScaleDraft) => void;
}) {
  const t = useScopedTranslations(surgeryViewMessages);
  const tk = (key: string, params?: Record<string, string | number>) => t(key as MessageKey, params);
  const [open, setOpen] = useState(false);
  if (scales.length === 0) return null;

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="rounded-lg border">
      <CollapsibleTrigger className="flex w-full items-center justify-between p-3 text-sm font-medium">
        <span>{t("cs_sectionTitle")} <span className="text-muted-foreground font-normal">({scales.map((c) => tk(scaleNameKey(c))).join(", ")})</span></span>
        <ChevronDown className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} />
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-4 border-t p-3">
        <p className="text-xs text-muted-foreground">{t("cs_sectionHint")}</p>
        {scales.map((code) => {
          const draft = drafts[code];
          if (!draft) return null;
          const set = (field: string, value: string | string[]) => onChange(code, { ...draft, values: { ...draft.values, [field]: value } });
          const ev = evaluateDraft(code, draft);
          const max = scaleMax(code, draft);
          return (
            <fieldset key={code} className="space-y-3 rounded-md border p-3" data-scale={code}>
              <legend className="px-1 text-sm font-semibold">{tk(scaleNameKey(code))}</legend>
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                {max != null && <span className="text-muted-foreground">{t("cs_maxLabel", { max })}</span>}
                <span className="font-medium">
                  {ev.kind === "ok" ? t("cs_preview", { score: ev.result.score, max: ev.result.max }) : t("cs_incomplete")}
                </span>
              </div>
              {code === "CONSTANT" && (
                <div className="flex items-center justify-between rounded-md border p-2">
                  <Label htmlFor="cs-constant-dyn" className="text-xs">{t("cs_withDynamometer")}</Label>
                  <Switch
                    id="cs-constant-dyn"
                    checked={draft.withDynamometer}
                    onCheckedChange={(v) => onChange(code, { ...draft, withDynamometer: v })}
                  />
                </div>
              )}
              {visibleItems(code, draft).map((item) => {
                const id = `cs-${code}-${item.field}`;
                const label = tk(itemLabelKey(code, item.field));
                const invalid = ev.kind === "invalid" && ev.field === item.field;
                if (item.kind === "multi") {
                  const selected = (draft.values[item.field] as string[] | undefined) ?? [];
                  return (
                    <div key={item.field} className="space-y-1.5">
                      <Label className="text-xs">{label}</Label>
                      {item.options.map((o) => (
                        <label key={o.value} className="flex items-center gap-2 text-xs">
                          <Checkbox
                            checked={selected.includes(o.value)}
                            onCheckedChange={(v) => set(item.field, v === true ? [...selected, o.value] : selected.filter((s) => s !== o.value))}
                          />
                          <span className="flex-1">{tk(optionLabelKey(code, item.field, o.value))}</span>
                          <span className="text-muted-foreground">{t("cs_points", { points: o.points })}</span>
                        </label>
                      ))}
                    </div>
                  );
                }
                if (item.kind === "choice") {
                  return (
                    <div key={item.field} className="space-y-1.5">
                      <Label htmlFor={id} className="text-xs">{label}</Label>
                      <Select value={(draft.values[item.field] as string) || undefined} onValueChange={(v) => set(item.field, v)}>
                        <SelectTrigger id={id} className={invalid ? "border-destructive" : undefined}><SelectValue placeholder={t("cs_select")} /></SelectTrigger>
                        <SelectContent>
                          {item.options.map((o) => (
                            <SelectItem key={o.value} value={o.value}>
                              {tk(optionLabelKey(code, item.field, o.value))} ({t("cs_points", { points: o.points })})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  );
                }
                return (
                  <div key={item.field} className="space-y-1.5">
                    <Label htmlFor={id} className="text-xs">
                      {label}{" "}
                      <span className="text-muted-foreground">
                        ({t("cs_range", { min: item.min, max: item.max })}
                        {hasDirectionHint(code, item.field) ? `, ${tk(itemHintKey(code, item.field))}` : ""})
                      </span>
                    </Label>
                    <Input
                      id={id}
                      inputMode={item.kind === "integer" ? "numeric" : "decimal"}
                      value={(draft.values[item.field] as string) ?? ""}
                      aria-invalid={invalid || undefined}
                      className={invalid ? "border-destructive" : undefined}
                      onChange={(e) => set(item.field, e.target.value)}
                    />
                  </div>
                );
              })}
            </fieldset>
          );
        })}
      </CollapsibleContent>
    </Collapsible>
  );
}
