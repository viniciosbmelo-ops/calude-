/**
 * Regenerative-module terms of use. The API refuses to create regenerative
 * cases until the doctor accepts them, so every entry point into case creation
 * (the /regen dashboard, the sidebar "Novo caso" shortcut, the patient pages)
 * must be able to show this modal.
 */
import * as React from "react";
import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Loader2, Shield } from "lucide-react";
import { useScopedTranslations } from "@/lib/i18n";
import { regenCoreMessages } from "@/locales/regen-core";

// ─── Terms Modal (mantém dark — diálogo sobre overlay) ──────────────────────
export function TermsModal({ onAccept, loading }: { onAccept: () => void; loading: boolean }) {
  const t = useScopedTranslations(regenCoreMessages);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.55)" }}>
      <div className="w-full max-w-lg bg-white rounded-2xl shadow-2xl overflow-hidden border border-gray-200">
        {/* Header */}
        <div className="px-6 pt-6 pb-4 border-b border-gray-100 flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-blue-50 shrink-0">
            <Shield className="h-5 w-5 text-blue-600" />
          </div>
          <div>
            <p className="font-bold text-gray-900 text-base">{t("termsTitle")}</p>
            <p className="text-xs text-gray-500 mt-0.5">{t("termsVersion")}</p>
          </div>
        </div>
        {/* Body */}
        <div className="px-6 py-5 space-y-3 max-h-64 overflow-y-auto text-sm text-gray-700">
          <p>{t("termsIntro")}</p>
          <ul className="list-disc pl-5 space-y-1.5">
            <li>{t("termsBullet1")}</li>
            <li>{t("termsBullet2")}</li>
            <li>{t("termsBullet3")}</li>
            <li>{t("termsBullet4")}</li>
            <li>{t("termsBullet5")}</li>
          </ul>
        </div>
        {/* Footer */}
        <div className="px-6 pb-6 pt-3">
          <button
            onClick={onAccept}
            disabled={loading}
            className="w-full py-3 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white transition-colors disabled:opacity-50"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            {t("termsAccept")}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Loads the terms status; `needsAcceptance` is true only once the API said "not accepted". */
export function useRegenTermsGate() {
  const t = useScopedTranslations(regenCoreMessages);
  const [accepted, setAccepted] = useState<boolean | null>(null);
  const [accepting, setAccepting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/regen-api/regen/terms/status", { credentials: "same-origin" })
      .then((res) => (res.ok ? res.json() : null))
      .then((body: { accepted?: boolean } | null) => {
        if (!cancelled && body && typeof body.accepted === "boolean") setAccepted(body.accepted);
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

  const accept = useCallback(async () => {
    setAccepting(true);
    try {
      const res = await fetch("/regen-api/regen/terms/accept", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        alert(body.error ?? t("termsError"));
        return;
      }
      setAccepted(true);
    } catch {
      alert(t("connectionError"));
    } finally {
      setAccepting(false);
    }
  }, [t]);

  return { needsAcceptance: accepted === false, accept, accepting };
}
