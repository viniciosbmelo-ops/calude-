/**
 * OrientacoesInline — painel compacto de orientações pré/pós-procedimento
 * Embutido diretamente dentro dos cards de procedimento do caso regenerativo.
 * Inclui botão de envio das orientações por WhatsApp e link público para o paciente.
 *
 * Tabs: Pré | Pós (Pós inclui sinais esperados, analgesia, alertas e reabilitação)
 */
import { useEffect, useState } from "react";
import { ClipboardList, CheckCircle2, ChevronDown, ChevronUp, Send, Link2, Copy, Check } from "lucide-react";
import { getOrientationContent, tagStyle, TL, type Tag, type ProcData, type CheckItem, type SinalAlerta } from "@/pages/regen/orientacoes";
import { useLanguage, useScopedTranslations } from "@/lib/i18n";
import { regenCoreMessages } from "@/locales/regen-core";

// Mapeamento: código do produto → chave do DATA
export const PROC_MAP: Record<string, string> = {
  PRP:              "prp_articular",
  LP_PRP:           "prp_articular",
  LR_PRP:           "prp_articular",
  PRF:              "fatores_crescimento",
  AH:               "prp_articular",
  COLAGENO:         "prp_articular",
  BMAC:             "ctm_osso",
  MFAT:             "ctm_osso",
  NANOFAT:          "ctm_osso",
  SVF:              "ctm_osso",
  LISADO:           "fatores_crescimento",
  EXOSSOMO:         "fatores_crescimento",
  SUBCONDROPLASTIA: "ctm_osso",
  HIDROGEL:         "prp_articular",
  OUTRO:            "prp_articular",
};

type TabId = "pre" | "pos";

type ChecklistKey = "hidrico" | "meds" | "alimentacao" | "logistica" | "docs";
/** Gera o texto das orientações pré-procedimento para WhatsApp (inclui link público) */
export function buildPreText(d: ProcData, patientUrl: string, sections: { key: ChecklistKey; label: string }[], t: (key: keyof typeof regenCoreMessages["pt-BR"]) => string): string {
  const lines: string[] = [
    `📋 *${t("preMessageTitle")}*`,
    `🏥 ${d.nome}`,
    ``,
    `📱 *${t("accessOrientations")}*`,
    patientUrl,
    ``,
  ];
  for (const sec of sections) {
    const items: CheckItem[] = d.checklist[sec.key as ChecklistKey];
    const mandatory = items.filter((i: CheckItem) => i.tag === "obrigatorio");
    if (mandatory.length === 0) continue;
    lines.push(`*${sec.label}*`);
    for (const item of mandatory) {
      lines.push(`• *${item.title}*`);
      lines.push(`  ${item.desc}`);
    }
    lines.push("");
  }
  lines.push(`_DocSholder — ${t("documentationBrand")}_`);
  return lines.join("\n");
}

/** Gera o texto das orientações pós-procedimento para WhatsApp (inclui link público) */
export function buildPosText(d: ProcData, patientUrl: string, t: (key: keyof typeof regenCoreMessages["pt-BR"]) => string): string {
  const lines: string[] = [
    `✅ *${t("postMessageTitle")}*`,
    `🏥 ${d.nome}`,
    ``,
    `📱 *${t("accessOrientations")}*`,
    patientUrl,
    ``,
  ];

  // Sinais esperados (normais)
  lines.push(`*${t("normalFirstDays")}*`);
  for (const s of d.sinaisEsperados.slice(0, 3)) {
    lines.push(`• *${s.title}* — ${s.desc} (${s.periodo})`);
  }
  lines.push("");

  // Analgesia
  lines.push(`*💊 ${t("authorizedAnalgesia")}*`);
  for (const m of d.analgesia.medicamentos) {
    lines.push(`• *${m.nome}* — ${m.dose} · ${m.intervalo}`);
    if (m.nota) lines.push(`  ⚠️ ${m.nota}`);
  }
  lines.push(`🚫 *${t("avoid")}:* ${d.analgesia.proibido}`);
  lines.push(`🧊 ${d.analgesia.gelo}`);
  lines.push("");

  // Sinais de alerta
  lines.push(`*🚨 ${t("seekHelp")}*`);
  for (const s of d.sinaisAlerta.filter((x: SinalAlerta) => x.gravidade === "grave").slice(0, 4)) {
    lines.push(`• ${s.title}: ${s.desc}`);
  }
  lines.push("");
  lines.push(`_DocSholder — ${t("documentationBrand")}_`);
  return lines.join("\n");
}

function openWhatsApp(phone: string, text: string) {
  const cleaned = phone.replace(/\D/g, "");
  const number = cleaned.startsWith("55") ? cleaned : `55${cleaned}`;
  const url = `https://wa.me/${number}?text=${encodeURIComponent(text)}`;
  window.open(url, "_blank");
}

interface Props {
  productCode: string;
  patientPhone?: string;
  defaultTab?: TabId;
  /** Se true, começa expandido */
  defaultOpen?: boolean;
}

export default function OrientacoesInline({ productCode, patientPhone, defaultTab = "pre", defaultOpen = false }: Props) {
  const t = useScopedTranslations(regenCoreMessages);
  const { locale } = useLanguage();
  const [open, setOpen] = useState(defaultOpen);
  const [tab, setTab] = useState<TabId>(defaultTab);
  const [copied, setCopied] = useState(false);
  const [share, setShare] = useState<{ preUrl: string; posUrl: string } | null>(null);
  const [shareState, setShareState] = useState<"idle" | "loading" | "error" | "ready">("idle");

  const procKey = PROC_MAP[productCode] ?? "prp_articular";
  const d = getOrientationContent(locale).data[procKey];
  if (!d) return null;

  useEffect(() => {
    setShare(null);
    setShareState("idle");
  }, [procKey]);

  const patientUrlPre = share?.preUrl;
  const patientUrlPos = share?.posUrl;
  const patientUrl = patientUrlPos;
  const hasPhone = !!patientPhone?.trim();

  useEffect(() => {
    if (!open || shareState === "loading" || share) return;
    let cancelled = false;
    setShareState("loading");
    fetch("/api/patient-orientations/token", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ procKey }),
    }).then(async response => {
      if (!response.ok) throw new Error("patient-orientation-token-failed");
      const value = await response.json() as { preUrl?: unknown; posUrl?: unknown };
      if (typeof value.preUrl !== "string" || typeof value.posUrl !== "string") throw new Error("patient-orientation-token-invalid");
      if (!cancelled) {
        setShare({ preUrl: value.preUrl, posUrl: value.posUrl });
        setShareState("ready");
      }
    }).catch(() => {
      if (!cancelled) setShareState("error");
    });
    return () => { cancelled = true; };
  }, [open, procKey, share, shareState]);

  const sections: { key: ChecklistKey; label: string }[] = [
    { key: "hidrico", label: t("physicalHydration") }, { key: "meds", label: t("medicationsAllergies") },
    { key: "alimentacao", label: t("foodFasting") }, { key: "logistica", label: t("logistics") },
    { key: "docs", label: t("documentsExams") },
  ];
  const TABS: { id: TabId; label: string; icon: React.ReactNode }[] = [
    { id: "pre", label: t("pre"), icon: <ClipboardList className="h-3.5 w-3.5" /> },
    { id: "pos", label: t("post"), icon: <CheckCircle2  className="h-3.5 w-3.5" /> },
  ];

  function copyLink() {
    if (!patientUrl) return;
    navigator.clipboard.writeText(patientUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div className="border-t border-gray-100 mt-3">
      {/* Toggle button */}
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-3 py-2.5 text-xs font-semibold transition-colors hover:bg-teal-50 rounded-b-xl"
        style={{ color: TL }}
      >
        <span className="flex items-center gap-1.5">
          <ClipboardList className="h-3.5 w-3.5" />
           📋 {t("orientations")}
        </span>
        {open ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
      </button>

      {open && (
        <div className="px-3 pb-3 space-y-3">
          {/* Proc label + WhatsApp buttons */}
          <div className="flex items-start justify-between gap-2 flex-wrap">
            <div className="text-[11px] font-medium px-2 py-1 rounded-lg inline-block"
              style={{ background: "#f0fdfa", color: TL }}>
              {d.icon} {d.nome}
            </div>

            {/* WhatsApp share buttons */}
            {hasPhone && (
              <div className="flex gap-1.5 flex-wrap">
                <button
                  type="button"
                   onClick={() => patientUrlPre && openWhatsApp(patientPhone!, buildPreText(d, patientUrlPre, sections, t))}
                   disabled={!patientUrlPre}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-bold text-white transition-opacity hover:opacity-90 active:opacity-75"
                  style={{ background: "#25D366" }}
                   title={t("sendPreTitle")}
                >
                  <Send className="h-3 w-3" />
                   {t("sendPreWhatsapp")}
                </button>
                <button
                  type="button"
                    onClick={() => patientUrlPos && openWhatsApp(patientPhone!, buildPosText(d, patientUrlPos, t))}
                    disabled={!patientUrlPos}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-bold text-white transition-opacity hover:opacity-90 active:opacity-75"
                  style={{ background: "#128C7E" }}
                   title={t("sendPostTitle")}
                >
                  <Send className="h-3 w-3" />
                   {t("sendPostWhatsapp")}
                </button>
              </div>
            )}
            {!hasPhone && (
               <span className="text-[10px] text-gray-400 italic">{t("addPatientWhatsapp")}</span>
            )}
          </div>

          {/* Link público para o paciente */}
          <div className="flex items-center gap-2 rounded-lg border border-teal-100 bg-teal-50/60 px-3 py-2">
            <Link2 className="h-3.5 w-3.5 shrink-0" style={{ color: TL }} />
            {shareState === "error" ? (
              <button type="button" onClick={() => { setShareState("idle"); setShare(null); }} className="flex-1 text-left text-[10px] text-red-700 font-semibold">
                {t("patientLinkError")} — {t("retry")}
              </button>
            ) : (
              <span className="flex-1 text-[10px] text-teal-700 truncate" title={patientUrl}>{patientUrl ?? t("preparingPatientLink")}</span>
            )}
            <button
              type="button"
              onClick={copyLink}
              disabled={!patientUrl}
              className="flex items-center gap-1 shrink-0 px-2 py-1 rounded text-[10px] font-bold transition-colors"
              style={{ color: TL }}
               title={t("copyPatientLink")}
            >
              {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
               {copied ? t("copied") : t("copy")}
            </button>
            <a
              href={patientUrl ?? undefined}
              target="_blank"
              rel="noopener noreferrer"
              aria-disabled={!patientUrl}
              onClick={event => { if (!patientUrl) event.preventDefault(); }}
              className="shrink-0 px-2 py-1 rounded text-[10px] font-bold text-white transition-opacity hover:opacity-90"
              style={{ background: TL }}
            >
               {t("open")}
            </a>
          </div>

          {/* Tab strip — somente Pré e Pós */}
          <div className="flex gap-1 overflow-x-auto pb-0.5">
            {TABS.map(t => (
              <button key={t.id} type="button" onClick={() => setTab(t.id)}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-bold whitespace-nowrap transition-colors shrink-0"
                style={tab === t.id
                  ? { background: TL, color: "#fff" }
                  : { background: "#F3F4F6", color: "#374151" }}>
                {t.icon} {t.label}
              </button>
            ))}
          </div>

          {/* ── PRÉ ── */}
          {tab === "pre" && (
            <div className="space-y-2">
               {sections.map(sec => {
                const items = d.checklist[sec.key as ChecklistKey];
                if (!items.length) return null;
                return (
                  <div key={sec.key}>
                    <p className="text-[10px] font-bold text-gray-400 uppercase mb-1 tracking-wide">{sec.label}</p>
                    <div className="space-y-1">
                      {items.map((item, i) => {
                        const ts = tagStyle[item.tag as Tag];
                        return (
                          <div key={i} className="flex items-start gap-2 p-2 rounded-lg bg-gray-50 border border-gray-100">
                            <div className="flex-1 min-w-0">
                              <div className="text-xs font-semibold text-gray-800 leading-tight">{item.title}</div>
                              <div className="text-[11px] text-gray-500 mt-0.5 leading-relaxed">{item.desc}</div>
                            </div>
                            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full shrink-0 mt-0.5 whitespace-nowrap"
                               style={{ background: ts.bg, color: ts.text }}>
                               {item.tag === "obrigatorio" ? t("mandatory") : item.tag === "recomendado" ? t("recommended") : t("conditional")}
                             </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* ── PÓS (inclui Alertas + Reabilitação) ── */}
          {tab === "pos" && (
            <div className="space-y-4">

              {/* Sinais esperados */}
              <div className="space-y-1.5">
                 <p className="text-[10px] font-bold text-green-700 uppercase tracking-wide">{t("expectedSigns")}</p>
                {d.sinaisEsperados.map((s, i) => (
                  <div key={i} className="p-2 rounded-lg bg-green-50 border border-green-100">
                    <div className="text-xs font-semibold text-green-900">{s.title}</div>
                    <div className="text-[11px] text-green-800 mt-0.5">{s.desc}</div>
                    <div className="text-[10px] text-green-700 mt-0.5 font-semibold">📅 {s.periodo}</div>
                  </div>
                ))}
              </div>

              {/* Analgesia */}
              <div className="space-y-1.5">
                 <p className="text-[10px] font-bold text-indigo-700 uppercase tracking-wide">{t("postAnalgesia")}</p>
                <div className="space-y-1">
                  {d.analgesia.medicamentos.map((m, i) => (
                    <div key={i} className="flex items-start gap-2 p-2 rounded-lg bg-indigo-50 border border-indigo-100">
                      <div>
                        <div className="text-xs font-bold text-indigo-900">{m.nome}</div>
                         <div className="text-[11px] text-indigo-700">{m.dose} · {m.intervalo} · {t("maximum")} {m.max}</div>
                        {m.nota && <div className="text-[11px] text-indigo-600 mt-0.5">{m.nota}</div>}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="p-2 rounded-lg bg-red-50 border border-red-100 text-[11px] text-red-800">
                   <strong>🚫 {t("avoid")}:</strong> {d.analgesia.proibido}
                </div>
                <div className="p-2 rounded-lg bg-sky-50 border border-sky-100 text-[11px] text-sky-800">
                  🧊 {d.analgesia.gelo}
                </div>
              </div>

              {/* Alertas */}
              <div className="space-y-1.5">
                 <p className="text-[10px] font-bold text-red-700 uppercase tracking-wide">{t("alertsHelp")}</p>
                {d.sinaisAlerta.map((s, i) => (
                  <div key={i}
                    className={`p-2 rounded-lg border text-xs ${s.gravidade === "grave"
                      ? "bg-red-50 border-red-200"
                      : "bg-amber-50 border-amber-200"}`}>
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${s.gravidade === "grave"
                        ? "bg-red-600 text-white"
                        : "bg-amber-500 text-white"}`}>
                         {s.gravidade === "grave" ? t("urgent") : t("moderate")}
                      </span>
                      <span className="font-semibold text-gray-800">{s.title}</span>
                    </div>
                    <p className="text-[11px] text-gray-600">{s.desc}</p>
                  </div>
                ))}
              </div>

              {/* Reabilitação */}
              <div className="space-y-1.5">
                 <p className="text-[10px] font-bold text-amber-700 uppercase tracking-wide">{t("rehabilitation")}</p>
                <div className="relative pl-5">
                  <div className="absolute left-1.5 top-2 bottom-2 w-0.5 bg-gray-200 rounded-full" />
                  {d.cronograma.map((c, i) => (
                    <div key={i} className="relative mb-2 last:mb-0">
                      <div className="absolute -left-3 top-2 w-2.5 h-2.5 rounded-full border-2 border-white shadow"
                        style={{ background: TL }} />
                      <div className="bg-gray-50 border border-gray-100 rounded-lg p-2">
                        <div className="text-[10px] font-bold uppercase tracking-wide" style={{ color: TL }}>{c.tempo}</div>
                        <div className="text-xs font-semibold text-gray-800">{c.titulo}</div>
                        <div className="text-[11px] text-gray-600 mt-0.5 leading-relaxed">{c.desc}</div>
                      </div>
                    </div>
                  ))}
                </div>

                 <p className="text-[10px] font-bold text-purple-700 uppercase tracking-wide mt-2">{t("medicalReturns")}</p>
                {d.retornos.map((r, i) => (
                  <div key={i} className="p-2 rounded-lg bg-purple-50 border border-purple-100">
                    <div className="text-[10px] font-bold uppercase tracking-wide" style={{ color: TL }}>{r.tempo}</div>
                    <div className="text-xs font-semibold text-gray-800">{r.tipo}</div>
                    <div className="text-[11px] text-gray-600 mt-0.5">{r.objetivo}</div>
                  </div>
                ))}
              </div>

            </div>
          )}
        </div>
      )}
    </div>
  );
}
