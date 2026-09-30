/**
 * Region SANE UI bits for the regenerative case page: recommendation hint for
 * non-knee regions (knee keeps its own hint with the OARSI tests) and the
 * subtle limited-validation note shown for the spine SANE.
 */
import { Info } from "lucide-react";
import { useLanguage, useScopedTranslations } from "@/lib/i18n";
import { regenSaneMessages } from "@/locales/regen-sane";
import { saneLabel, type SaneRegionDef } from "@/lib/regen-sane";

export function SaneValidationNote({ def, className }: { def: SaneRegionDef | null | undefined; className?: string }) {
  const t = useScopedTranslations(regenSaneMessages);
  if (!def?.limitedValidation) return null;
  return (
    <p className={className ?? "text-[11px] text-gray-500"} data-testid="sane-limited-validation">
      {t("spineNote")}
    </p>
  );
}

/** `def`: the case's SANE (`saneForCase`: condition region, else application sites). */
export function SaneRecommendationHint({ def }: { def: SaneRegionDef | null | undefined }) {
  const t = useScopedTranslations(regenSaneMessages);
  const { locale } = useLanguage();
  if (!def) return null;
  const label = saneLabel(def, locale);
  return (
    <div className="rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-xs text-sky-900" data-testid="sane-recommendation">
      <div className="flex items-start gap-2">
        <Info className="h-4 w-4 shrink-0 text-sky-600 mt-0.5" aria-hidden="true" />
        <div className="min-w-0 space-y-1.5">
          <p className="font-semibold">{t("recommendedTitle")}</p>
          <p>
            <span className="font-medium">{t("recommendedProms")}:</span>{" "}
            {t("vas")} · {label}
          </p>
          <p className="text-[11px] text-sky-700">{t("recommendedNote", { label })}</p>
          <SaneValidationNote def={def} className="text-[11px] text-sky-700/80 italic" />
        </div>
      </div>
    </div>
  );
}
