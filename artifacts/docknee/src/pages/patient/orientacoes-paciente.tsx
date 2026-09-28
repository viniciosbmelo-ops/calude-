/**
 * Página pública para pacientes visualizarem as orientações pré/pós-procedimento.
 * Acesso: /orientacoes-paciente?proc=prp_articular&tab=pre  (ou &tab=pos)
 * Sem autenticação.
 */
import { useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, ClipboardList } from "lucide-react";
import { getOrientationContent } from "@/pages/regen/orientacoes";
import type { CheckItem } from "@/pages/regen/orientacoes";
import { useLanguage, useScopedTranslations } from "@/lib/i18n";
import { resolveOrientationBootstrap, type OrientationBootstrap } from "@/lib/patient-orientation-route";
import { publicPatientFlowMessages } from "@/locales/public-patient-flows";

const PROC_LABELS: Record<string, string> = {
  prp_articular: "PRP Intra-Articular",
  ctm_osso:      "Células-Tronco / BMAC",
  fatores_crescimento: "Fatores de Crescimento",
};

const TL = "#0f766e";

type TabId = "pre" | "pos";

function Section({ title, color = "gray", children }: { title: string; color?: "gray" | "green" | "red" | "amber" | "indigo"; children: React.ReactNode }) {
  const palette: Record<string, { bg: string; text: string; border: string }> = {
    gray:   { bg: "bg-gray-50",   text: "text-gray-700",   border: "border-gray-200" },
    green:  { bg: "bg-green-50",  text: "text-green-800",  border: "border-green-200" },
    red:    { bg: "bg-red-50",    text: "text-red-800",    border: "border-red-200" },
    amber:  { bg: "bg-amber-50",  text: "text-amber-800",  border: "border-amber-200" },
    indigo: { bg: "bg-indigo-50", text: "text-indigo-800", border: "border-indigo-200" },
  };
  const p = palette[color];
  return (
    <section className="space-y-3">
      <h2 className={`text-sm font-bold uppercase tracking-wide ${p.text}`}>{title}</h2>
      {children}
    </section>
  );
}

const TAG_COLOR: Record<string, { bg: string; text: string }> = {
  obrigatorio: { bg: "bg-red-100", text: "text-red-700" },
  recomendado: { bg: "bg-amber-100", text: "text-amber-700" },
  condicional: { bg: "bg-blue-100", text: "text-blue-700" },
};

export default function OrientacoesPaciente() {
  const t = useScopedTranslations(publicPatientFlowMessages);
  const { beginTemporaryDisplayLanguage, locale } = useLanguage();
  const params = new URLSearchParams(window.location.search);
  const token = params.get("token");
  const legacyProcKey = params.get("proc") ?? "prp_articular";
  const legacyTab: TabId = params.get("tab") === "pre" ? "pre" : "pos";
  const [bootstrap, setBootstrap] = useState<OrientationBootstrap | null>(
    resolveOrientationBootstrap(token, legacyProcKey, legacyTab, null),
  );
  const [loading, setLoading] = useState(Boolean(token));
  const [invalid, setInvalid] = useState(false);
  const releaseLocale = useRef<(() => void) | null>(null);
  const [tab, setTab] = useState<TabId>(legacyTab);

  const loadToken = () => {
    if (!token) return;
    setLoading(true);
    setInvalid(false);
    fetch(`/api/patient-orientations/${encodeURIComponent(token)}`, { credentials: "omit" })
      .then(async response => {
        if (!response.ok) throw new Error("invalid-orientation-token");
        const payload = await response.json() as { procKey?: unknown; tab?: unknown; doctorLocale?: unknown };
        if (
          typeof payload.procKey !== "string" ||
          (payload.tab !== "pre" && payload.tab !== "pos") ||
          (payload.doctorLocale !== "pt-BR" && payload.doctorLocale !== "es")
        ) throw new Error("invalid-orientation-bootstrap");
        setBootstrap(resolveOrientationBootstrap(token, legacyProcKey, legacyTab, {
          procKey: payload.procKey, tab: payload.tab, doctorLocale: payload.doctorLocale,
        }));
        setTab(payload.tab);
      })
      .catch(() => { setBootstrap(null); setInvalid(true); })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadToken();
    // The legacy query route remains Portuguese only and never consults storage.
    if (!token) releaseLocale.current = beginTemporaryDisplayLanguage("pt-BR");
    return () => {
      releaseLocale.current?.();
      releaseLocale.current = null;
    };
    // token identifies the immutable signed payload for this mounted public page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, beginTemporaryDisplayLanguage]);

  useEffect(() => {
    if (!token || !bootstrap) return;
    releaseLocale.current?.();
    releaseLocale.current = beginTemporaryDisplayLanguage(bootstrap.doctorLocale);
  }, [beginTemporaryDisplayLanguage, bootstrap, token]);

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center bg-gray-50 text-sm text-gray-600">{t("loadingOrientations")}</div>;
  }
  if (invalid || !bootstrap) {
    const safeFallback = publicPatientFlowMessages["pt-BR"];
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-6">
        <div className="text-center space-y-3">
          <AlertTriangle className="h-7 w-7 mx-auto text-amber-600" />
          <p className="text-lg font-semibold text-gray-700">{safeFallback.invalidLink}</p>
          <p className="text-sm text-gray-500">{safeFallback.checkLink}</p>
          {token && <button type="button" onClick={loadToken} className="text-sm font-bold text-teal-700">{safeFallback.retry}</button>}
        </div>
      </div>
    );
  }
  const procKey = bootstrap.procKey;
  const d = getOrientationContent(locale).data[procKey];

  if (!d) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-6">
        <div className="text-center space-y-2">
          <p className="text-2xl">🔍</p>
          <p className="text-lg font-semibold text-gray-700">{t("procedureNotFound")}</p>
          <p className="text-sm text-gray-500">{t("checkLink")}</p>
        </div>
      </div>
    );
  }

  const label = d.nome || PROC_LABELS[procKey];
  const preSections = [
    { key: "hidrico" as const, label: locale === "es" ? "💧 Preparación física e hidratación" : "💧 Preparo Físico e Hídrico" },
    { key: "meds" as const, label: locale === "es" ? "💊 Medicamentos y alergias" : "💊 Medicações e Alergias" },
    { key: "alimentacao" as const, label: locale === "es" ? "🍽️ Alimentación y ayuno" : "🍽️ Alimentação e Jejum" },
    { key: "logistica" as const, label: "🚗 Logística" },
    { key: "docs" as const, label: locale === "es" ? "📝 Documentación y estudios" : "📝 Documentação e Exames" },
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="sticky top-0 z-10 shadow-sm" style={{ background: TL }}>
        <div className="max-w-lg mx-auto px-4 py-3 flex items-center gap-3">
          <ClipboardList className="h-5 w-5 text-white shrink-0" />
          <div>
            <p className="text-white font-bold text-sm leading-tight">{t("procedureGuidance")}</p>
            <p className="text-teal-200 text-xs">{label}</p>
          </div>
          <span className="ml-auto text-xs text-teal-200 font-medium">DocKnee</span>
        </div>

        {/* Tab bar */}
        <div className="max-w-lg mx-auto px-4 pb-0 flex border-t border-teal-700/40">
          <button
            type="button"
            onClick={() => setTab("pre")}
            className="flex-1 py-2.5 text-sm font-bold flex items-center justify-center gap-1.5 transition-colors"
            style={tab === "pre"
              ? { color: "#fff", borderBottom: "2px solid #fff" }
              : { color: "rgba(255,255,255,0.55)", borderBottom: "2px solid transparent" }}
          >
            <ClipboardList className="h-4 w-4" />
            {t("beforeProcedure")}
          </button>
          <button
            type="button"
            onClick={() => setTab("pos")}
            className="flex-1 py-2.5 text-sm font-bold flex items-center justify-center gap-1.5 transition-colors"
            style={tab === "pos"
              ? { color: "#fff", borderBottom: "2px solid #fff" }
              : { color: "rgba(255,255,255,0.55)", borderBottom: "2px solid transparent" }}
          >
            <CheckCircle2 className="h-4 w-4" />
            {t("afterProcedure")}
          </button>
        </div>
      </div>

      <div className="max-w-lg mx-auto px-4 py-6 space-y-6">

        {/* ══ PRÉ-PROCEDIMENTO ══ */}
        {tab === "pre" && (
          <>
            <div className="p-4 rounded-xl bg-teal-50 border border-teal-200 text-sm text-teal-800">
              <p className="font-bold mb-1">📋 {t("preProcedureChecklist")}</p>
              <p className="text-xs text-teal-700">{t("followInstructions")}</p>
            </div>

            {preSections.map(({ key, label: secLabel }) => {
              const items: CheckItem[] = d.checklist[key];
              if (!items || items.length === 0) return null;
              return (
                <Section key={key} title={secLabel} color="gray">
                  <div className="space-y-2">
                    {items.map((item, i) => {
                      const tc = TAG_COLOR[item.tag] ?? TAG_COLOR.recomendado;
                      return (
                        <div key={i} className="p-3 rounded-xl bg-white border border-gray-100 shadow-sm">
                          <div className="flex items-start justify-between gap-2 mb-1">
                            <p className="text-sm font-semibold text-gray-800">{item.title}</p>
                            <span className={`shrink-0 text-[9px] font-bold px-2 py-0.5 rounded-full ${tc.bg} ${tc.text}`}>
                              {item.tag === "obrigatorio" ? (locale === "es" ? "OBLIGATORIO" : "OBRIGATÓRIO") : item.tag === "recomendado" ? (locale === "es" ? "RECOMENDADO" : "RECOMENDADO") : (locale === "es" ? "CONDICIONAL" : "CONDICIONAL")}
                            </span>
                          </div>
                          <p className="text-xs text-gray-600 leading-relaxed">{item.desc}</p>
                        </div>
                      );
                    })}
                  </div>
                </Section>
              );
            })}
          </>
        )}

        {/* ══ PÓS-PROCEDIMENTO ══ */}
        {tab === "pos" && (
          <>
            {/* Sinais esperados */}
            <Section title={`✅ ${t("expectedFirstDays")}`} color="green">
              {d.sinaisEsperados.map((s, i) => (
                <div key={i} className="p-3 rounded-xl bg-green-50 border border-green-100">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-green-900">{s.title}</p>
                    <span className="text-[10px] bg-green-200 text-green-800 font-bold px-2 py-0.5 rounded-full shrink-0">{s.periodo}</span>
                  </div>
                  <p className="text-xs text-green-800 mt-1 leading-relaxed">{s.desc}</p>
                </div>
              ))}
            </Section>

            {/* Analgesia */}
            <Section title={`💊 ${t("authorizedAnalgesia")}`} color="indigo">
              <div className="space-y-2">
                {d.analgesia.medicamentos.map((m, i) => (
                  <div key={i} className="p-3 rounded-xl bg-indigo-50 border border-indigo-100">
                    <p className="text-sm font-bold text-indigo-900">{m.nome}</p>
                    <p className="text-xs text-indigo-700 mt-0.5">{m.dose} · {m.intervalo} · {locale === "es" ? "máx." : "máx"} {m.max}</p>
                    {m.nota && <p className="text-xs text-indigo-600 mt-0.5 italic">{m.nota}</p>}
                  </div>
                ))}
              </div>
              <div className="p-3 rounded-xl bg-red-50 border border-red-100 text-xs text-red-800 font-medium">
                🚫 <strong>{t("avoid")}</strong> {d.analgesia.proibido}
              </div>
              <div className="p-3 rounded-xl bg-sky-50 border border-sky-100 text-xs text-sky-800">
                🧊 {d.analgesia.gelo}
              </div>
            </Section>

            {/* Sinais de alerta */}
            <Section title={`🚨 ${t("seekMedicalHelp")}`} color="red">
              <div className="space-y-2">
                {d.sinaisAlerta.map((s, i) => (
                  <div key={i}
                    className={`p-3 rounded-xl border ${s.gravidade === "grave"
                      ? "bg-red-50 border-red-200"
                      : "bg-amber-50 border-amber-200"}`}>
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${s.gravidade === "grave"
                        ? "bg-red-600 text-white"
                        : "bg-amber-500 text-white"}`}>
                        {s.gravidade === "grave" ? t("emergency") : t("moderate")}
                      </span>
                      <p className="text-sm font-semibold text-gray-800">{s.title}</p>
                    </div>
                    <p className="text-xs text-gray-600 leading-relaxed">{s.desc}</p>
                  </div>
                ))}
              </div>
            </Section>

            {/* Reabilitação */}
            <Section title={`📅 ${t("rehabilitation")}`} color="amber">
              <div className="relative pl-5">
                <div className="absolute left-1.5 top-2 bottom-2 w-0.5 bg-gray-200 rounded-full" />
                {d.cronograma.map((c, i) => (
                  <div key={i} className="relative mb-3 last:mb-0">
                    <div className="absolute -left-3 top-2 w-2.5 h-2.5 rounded-full border-2 border-white shadow"
                      style={{ background: TL }} />
                    <div className="bg-white border border-gray-100 rounded-xl p-3 shadow-sm">
                      <p className="text-[10px] font-bold uppercase tracking-wide mb-0.5" style={{ color: TL }}>{c.tempo}</p>
                      <p className="text-sm font-semibold text-gray-800">{c.titulo}</p>
                      <p className="text-xs text-gray-600 mt-0.5 leading-relaxed">{c.desc}</p>
                    </div>
                  </div>
                ))}
              </div>

              <h3 className="text-xs font-bold uppercase tracking-wide text-purple-700 mt-2">🗓️ {t("medicalFollowups")}</h3>
              <div className="space-y-2">
                {d.retornos.map((r, i) => (
                  <div key={i} className="p-3 rounded-xl bg-purple-50 border border-purple-100">
                    <p className="text-[10px] font-bold uppercase tracking-wide" style={{ color: TL }}>{r.tempo}</p>
                    <p className="text-sm font-semibold text-gray-800">{r.tipo}</p>
                    <p className="text-xs text-gray-600 mt-0.5">{r.objetivo}</p>
                  </div>
                ))}
              </div>
            </Section>
          </>
        )}

        {/* Footer */}
        <div className="text-center text-[11px] text-gray-400 pb-4">
          <p>DocKnee — {t("documentationBrand")}</p>
          <p className="mt-0.5">{t("questionsContactDoctor")}</p>
        </div>
      </div>
    </div>
  );
}
