import { useState } from "react";
import { XRayAnalyzer } from "@/components/xray-analyzer";
import { PTSAnalyzer } from "@/components/pts-analyzer";
import { useSubscriptionStatus } from "@/hooks/use-subscription-status";
import { SubscriptionGate } from "@/components/subscription-gate";
import { cn } from "@/lib/utils";
import { useScopedTranslations } from "@/lib/i18n";
import { xrayPlanningMessages } from "@/locales/xray-planning";

type Tab = "panoramic" | "pts";

export default function XRayPlanning() {
  const t = useScopedTranslations(xrayPlanningMessages);
  const { canWrite, loading } = useSubscriptionStatus();
  const [tab, setTab] = useState<Tab>("panoramic");

  if (!loading && !canWrite) {
    return <SubscriptionGate />;
  }

  return (
    <div className="max-w-4xl mx-auto">

      {/* ── Mobile navy banner (hidden md+) ── */}
      <div className="md:hidden" style={{ background: "linear-gradient(135deg, #0A1628 0%, #0D2040 100%)" }}>
        <div className="px-4 pt-5 pb-5">
          <h1 style={{ fontSize: 22, fontWeight: 700, color: "#fff", margin: 0 }}>{t("title")}</h1>
          <p style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", margin: "4px 0 0" }}>{t("mobileDescription")}</p>
        </div>
      </div>

      <div className="py-6 px-4 space-y-5">

        {/* ── Desktop header (hidden on mobile) ── */}
        <div className="hidden md:block">
          <h1 className="text-2xl font-bold tracking-tight" style={{ color: "#0A1828" }}>
            {t("title")}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {t("description")}
          </p>
        </div>

        {/* ── Tab switcher ── */}
        <div className="flex gap-1 p-1 bg-slate-100 rounded-xl w-full sm:w-auto sm:inline-flex">
          <button
            type="button"
            onClick={() => setTab("panoramic")}
            className={cn(
              "flex-1 sm:flex-none text-xs sm:text-sm font-medium px-3 py-2 rounded-lg transition-colors",
              tab === "panoramic"
                ? "bg-white text-primary shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {t("panoramicTab")}
          </button>
          <button
            type="button"
            onClick={() => setTab("pts")}
            className={cn(
              "flex-1 sm:flex-none text-xs sm:text-sm font-medium px-3 py-2 rounded-lg transition-colors",
              tab === "pts"
                ? "bg-white text-teal-700 shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {t("ptsTab")}
          </button>
        </div>

        {/* ── Tab descriptions ── */}
        {tab === "panoramic" && (
          <p className="text-xs text-muted-foreground">
            {t("panoramicDescription")}
          </p>
        )}
        {tab === "pts" && (
          <p className="text-xs text-muted-foreground">
            {t("ptsDescription")}
          </p>
        )}

        {/* ── Content ── */}
        {tab === "panoramic" && <XRayAnalyzer analysisContext="standalone" />}
        {tab === "pts" && <PTSAnalyzer />}

      </div>
    </div>
  );
}
