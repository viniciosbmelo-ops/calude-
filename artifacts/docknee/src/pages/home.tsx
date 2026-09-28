import { Link } from "wouter";
import { SUPPORT_WHATSAPP_URL } from "@/lib/support-contact";
import { useAuth } from "@/lib/auth";
import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useLanguage } from "@/lib/i18n";
import { PublicLanguageSelector } from "@/components/public-language-selector";
import { homeSpanish } from "@/locales/home";

export default function Home() {
  const { locale } = useLanguage();
  const h = (text: string) => locale === "es" ? (homeSpanish[text] ?? text) : text;
  const { user, isLoading } = useAuth();
  const [, setLocation] = useLocation();
  const [pricingPeriod, setPricingPeriod] = useState<"mensal" | "anual">("mensal");
  useEffect(() => {
    if (!isLoading && user) setLocation("/dashboard");
  }, [user, isLoading]);

  return (
    <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 14, color: "#0F1F2B", background: "#FFFFFF" }}>

      {/* ── HERO (sem nav separada — logo e botões dentro do hero) ── */}
      <section style={{
        position: "relative",
        background: "#0D1F30",
        overflow: "hidden",
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        padding: "0 20px 100px",
      }}
      className="lg:px-16"
      >
        {/* Barra superior: logo à esquerda + botões à direita */}
        <div style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          paddingTop: "max(20px, env(safe-area-inset-top))",
          paddingBottom: 12,
          position: "relative",
          zIndex: 20,
            flexWrap: "wrap",
            rowGap: 8,
        }}>
          <a href="/" className="min-w-0" style={{ display: "inline-flex", alignItems: "center", textDecoration: "none", flex: "1 1 160px" }}>
            <img
              src={`${import.meta.env.BASE_URL}logo-docsholder-white.png`}
              alt="DocSholder"
              style={{
                height: 72,
                width: "auto",
                maxWidth: "min(340px, 55vw)",
                objectFit: "contain",
              }}
              className="lg:h-[90px]"
            />
          </a>
          <div className="w-full sm:w-auto" style={{ display: "flex", gap: 8, alignItems: "center", justifyContent: "flex-end", flexWrap: "wrap" }}>
            <PublicLanguageSelector dark />
            <Link href="/login">
              <button style={{
                padding: "7px 16px",
                border: "1px solid rgba(255,255,255,0.25)",
                borderRadius: 4,
                background: "transparent",
                color: "rgba(255,255,255,0.85)",
                fontSize: 13,
                fontFamily: "inherit",
                cursor: "pointer",
              }}>
                {h("Entrar")}
              </button>
            </Link>
            <Link href="/register">
              <button style={{
                padding: "7px 16px",
                background: "#1FB6E1",
                border: "1px solid #1FB6E1",
                borderRadius: 4,
                color: "#FFFFFF",
                fontSize: 13,
                fontFamily: "inherit",
                cursor: "pointer",
                fontWeight: 500,
              }}>
                {h("Criar conta")}
              </button>
            </Link>
          </div>
        </div>

        {/* Hero content */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", paddingTop: 20, paddingBottom: 40 }}>
        {/* CSS animations */}
        <style>{`
          @keyframes dk-flowA { from { stroke-dashoffset: 0 } to { stroke-dashoffset: -900 } }
          @keyframes dk-flowB { from { stroke-dashoffset: 0 } to { stroke-dashoffset: -1200 } }
          @keyframes dk-flowC { from { stroke-dashoffset: 0 } to { stroke-dashoffset: -700 } }
          @keyframes dk-pulse { 0%,100% { box-shadow: 0 0 0 0 rgba(31,182,225,0.5) } 50% { box-shadow: 0 0 0 6px rgba(31,182,225,0) } }
          .dk-line { fill: none; stroke-dasharray: 350 250; }
        `}</style>

        {/* Animated background curves */}
        <svg
          aria-hidden="true"
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }}
          viewBox="0 0 1440 800"
          preserveAspectRatio="xMidYMid slice"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path className="dk-line" d="M-200 220 C200 80 500 380 800 200 S1300 60 1640 240" stroke="#1872A5" strokeOpacity="0.35" strokeWidth="1.5"
            style={{ animation: "dk-flowA 10s linear infinite" }} />
          <path className="dk-line" d="M-200 400 C300 240 620 500 940 330 S1350 200 1640 420" stroke="#1FB6E1" strokeOpacity="0.2" strokeWidth="1"
            style={{ animation: "dk-flowB 14s linear infinite" }} />
          <path className="dk-line" d="M-200 580 C120 440 520 640 840 510 S1240 390 1640 580" stroke="#38B88A" strokeOpacity="0.14" strokeWidth="1"
            style={{ animation: "dk-flowC 11s linear infinite reverse" }} />
          <path className="dk-line" d="M-200 90 C440 300 820 40 1140 270 S1420 520 1640 130" stroke="#1872A5" strokeOpacity="0.08" strokeWidth="2"
            style={{ animation: "dk-flowA 18s linear infinite reverse" }} />
        </svg>

        {/* Knee image — direita, difusa */}
        <div
          aria-hidden="true"
          className="hidden lg:block"
          style={{
            position: "absolute",
            right: 0,
            top: 0,
            bottom: 0,
            width: "48%",
            opacity: 0.13,
            pointerEvents: "none",
          }}
        >
          <img
            src="/hero-symbol.png"
            alt=""
            style={{ width: "100%", height: "100%", objectFit: "contain", objectPosition: "center" }}
          />
        </div>

        {/* Status badge */}
        <div style={{ display: "inline-flex", alignItems: "center", gap: 10, marginBottom: 36 }}>
          <span style={{
            width: 8, height: 8, borderRadius: "50%",
            background: "#1FB6E1", display: "block",
            animation: "dk-pulse 2.4s ease-in-out infinite",
          }} />
          <span style={{
            fontSize: 11,
            fontWeight: 500,
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            color: "rgba(255,255,255,0.45)",
          }}>
            {h("Disponível agora — Cirurgia do Joelho · Reabilitação · Ortobiológicos")}
          </span>
        </div>

        {/* Headline em três camadas */}
        <div style={{ position: "relative", zIndex: 2 }}>
          {/* Linha 1: sólida branca */}
          <div
            style={{
              fontWeight: 800,
              letterSpacing: "-3px",
              lineHeight: 0.92,
              textTransform: "uppercase",
              color: "#FFFFFF",
            }}
           className="text-[clamp(40px,10.5vw,56px)] sm:text-[80px] lg:text-[108px]"
          >
            {h("Documentação")}
          </div>

          {/* Linha 2: fantasma (contorno) */}
          <div
            style={{
              fontWeight: 800,
              letterSpacing: "-3px",
              lineHeight: 0.92,
              textTransform: "uppercase",
              WebkitTextStroke: "2px rgba(255,255,255,0.16)",
              color: "transparent",
            }}
             className="text-[clamp(40px,10.5vw,56px)] sm:text-[80px] lg:text-[108px]"
          >
            {h("Cirúrgica")}
          </div>

          {/* Linha 3: acento ciano */}
          <div
            style={{
              fontWeight: 800,
              letterSpacing: "-3px",
              lineHeight: 0.92,
              textTransform: "uppercase",
              color: "#1FB6E1",
            }}
             className="text-[clamp(40px,10.5vw,56px)] sm:text-[80px] lg:text-[108px]"
          >
            {h("Inteligente.")}
          </div>
        </div>

        {/* Subtexto + CTAs */}
        <div style={{ maxWidth: 520, marginTop: 36, position: "relative", zIndex: 2 }}>
          <p style={{
            color: "rgba(255,255,255,0.5)",
            lineHeight: 1.7,
            marginBottom: 30,
          }}
          className="text-[14px] lg:text-[15px]"
          >
            {h("Prontuário eletrônico, análise radiográfica por IA, agendamento e protocolos KRIRS/PICS 2.0 — integrados ao seu fluxo clínico e cirúrgico.")}
          </p>

          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <Link href="/register">
              <button style={{
                padding: "12px 26px",
                background: "#1FB6E1",
                border: "1px solid #1FB6E1",
                borderRadius: 4,
                color: "#FFFFFF",
                fontSize: 14,
                fontFamily: "inherit",
                fontWeight: 600,
                cursor: "pointer",
                letterSpacing: "-0.1px",
              }}>
                {h("Começar gratuitamente →")}
              </button>
            </Link>
            <Link href="/login">
              <button style={{
                padding: "12px 22px",
                border: "1px solid rgba(255,255,255,0.2)",
                borderRadius: 4,
                background: "transparent",
                color: "rgba(255,255,255,0.7)",
                fontSize: 14,
                fontFamily: "inherit",
                cursor: "pointer",
              }}>
                {h("Acessar plataforma")}
              </button>
            </Link>
          </div>
        </div>

        {/* Scroll indicator */}
        <div style={{
          position: "absolute",
          bottom: 28,
          left: "50%",
          transform: "translateX(-50%)",
          display: "flex",
          alignItems: "center",
          gap: 10,
          color: "rgba(255,255,255,0.28)",
          fontSize: 10,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          whiteSpace: "nowrap",
        }}>
          <div style={{ width: 28, height: 1, background: "rgba(255,255,255,0.15)" }} />
          {h("Role para explorar")}
          <div style={{ width: 28, height: 1, background: "rgba(255,255,255,0.15)" }} />
        </div>

        </div>{/* end hero content */}
      </section>

      {/* ── STATS STRIP ── */}
      <div style={{ borderBottom: "1px solid #D8E6EE" }} className="grid grid-cols-2 lg:grid-cols-4">
        {[
          { num: "HKA", sup: "+MAD", desc: h("Cálculo automático por foto panorâmica de MMII") },
          { num: "KRIRS", sup: "+PICS", desc: h("Algoritmos de risco LCA e instabilidade patelar") },
          { num: "PDF", sup: "auto", desc: h("Documentação cirúrgica estruturada em segundos") },
          { num: "LGPD", sup: "✓", desc: h("Conformidade com proteção de dados em saúde") },
        ].map((s, i) => (
          <div key={i} style={{
            padding: "20px 18px",
            borderRight: (i + 1) % 2 !== 0 ? "1px solid #D8E6EE" : "none",
            borderTop: i >= 2 ? "1px solid #D8E6EE" : "none",
          }}
          className="lg:px-9 lg:py-7 lg:[border-right:1px_solid_#D8E6EE] lg:[border-top:none] last:lg:[border-right:none]"
          >
            <div style={{ fontSize: 22, fontWeight: 500, letterSpacing: "-0.4px", color: "#0F1F2B", marginBottom: 4 }}
            className="lg:text-[26px]"
            >
              {s.num}<sup style={{ fontSize: 12, color: "#1872A5", verticalAlign: "super" }}>{s.sup}</sup>
            </div>
            <div style={{ fontSize: 12, color: "#4A6070", lineHeight: 1.45 }}>{s.desc}</div>
          </div>
        ))}
      </div>

      {/* ── PARA O SEU CONSULTÓRIO (split layout, fundo branco) ── */}
      <section style={{ background: "#FFFFFF", borderBottom: "1px solid #E8EFF4" }}>
        <div className="flex flex-col lg:flex-row" style={{ minHeight: 520 }}>

          {/* Coluna visual — esquerda */}
          <div style={{
            background: "#0D1F30",
            position: "relative",
            overflow: "hidden",
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "center",
          }}
          className="w-full lg:w-[45%] min-h-[320px] lg:min-h-0"
          >
            <img
              src="/hero-symbol.png"
              alt=""
              style={{ position: "absolute", inset: "12%", width: "76%", height: "76%", objectFit: "contain", opacity: 0.5 }}
            />

            {/* Floating stat card */}
            <div style={{
              position: "absolute",
              bottom: 24,
              left: 20,
              background: "rgba(6,15,24,0.88)",
              border: "1px solid rgba(31,182,225,0.2)",
              borderRadius: 10,
              padding: "14px 18px",
              backdropFilter: "blur(12px)",
              display: "flex",
              alignItems: "center",
              gap: 12,
            }}>
              <div style={{
                width: 36,
                height: 36,
                borderRadius: "50%",
                background: "rgba(31,182,225,0.15)",
                border: "1px solid rgba(31,182,225,0.3)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}>
                <span style={{ fontSize: 16 }}>⏱</span>
              </div>
              <div>
                <div style={{ fontSize: 18, fontWeight: 700, color: "#1FB6E1", letterSpacing: "-0.5px", lineHeight: 1.2 }}>40 min</div>
                <div style={{ fontSize: 11, color: "rgba(255,255,255,0.55)", lineHeight: 1.4 }}>{h("economizados por procedimento")}</div>
              </div>
            </div>

            {/* Label tag */}
            <div style={{
              position: "absolute",
              top: 20,
              left: 20,
              fontSize: 10,
              fontWeight: 600,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: "rgba(255,255,255,0.45)",
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}>
              <div style={{ width: 14, height: 1, background: "rgba(255,255,255,0.3)" }} />
              {h("Por que DocSholder")}
            </div>
          </div>

          {/* Coluna texto — direita */}
          <div style={{
            flex: 1,
            padding: "48px 32px",
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
          }}
          className="lg:px-14 lg:py-16"
          >
            {/* Label */}
            <div style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              marginBottom: 16,
            }}>
              <div style={{ width: 24, height: 2, background: "#1FB6E1", borderRadius: 2 }} />
              <span style={{
                fontSize: 11,
                fontWeight: 600,
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                color: "#1872A5",
              }}>
                {h("Para o seu consultório")}
              </span>
            </div>

            {/* Headline */}
            <h2 style={{
              fontWeight: 700,
              letterSpacing: "-0.6px",
              color: "#0F1F2B",
              marginBottom: 10,
              lineHeight: 1.15,
            }}
            className="text-[26px] lg:text-[34px]"
            >
              {h("Muito além da")}<br />
              <span style={{ color: "#1872A5" }}>{h("documentação cirúrgica")}</span>
            </h2>

            <p style={{ fontSize: 14, color: "#6B8090", lineHeight: 1.7, marginBottom: 32, maxWidth: 420 }}>
              {h("A maioria das plataformas registra dados. O DocSholder organiza seu consultório inteiro — prontuário, agenda, protocolos e pesquisa — em um fluxo único.")}
            </p>

            {/* Feature rows */}
            <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
              {[
                {
                  icon: "📋",
                  title: h("Prontuário eletrônico completo"),
                  sub: h("Anamnese, exame físico, escalas funcionais e laudos em um único fluxo. Conforme CFM."),
                },
                {
                  icon: "📱",
                  title: h("Lembretes pelo WhatsApp"),
                  sub: h("Confirmações automáticas de consulta e protocolos de follow-up diretamente no celular do paciente."),
                },
                {
                  icon: "🔬",
                  title: h("Protocolos KRIRS e PICS 2.0"),
                  sub: h("Estratificação de risco para LCA e instabilidade patelar baseada em consensos SBQ e ISAKOS."),
                },
                {
                  icon: "📊",
                  title: h("Relatórios para publicação científica"),
                  sub: h("IKDC, Lysholm, Tegner, VAS e KOOS-12 exportados em CSV pronto para análise estatística."),
                },
              ].map((f, i) => (
                <div key={i} style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
                  <div style={{
                    width: 38,
                    height: 38,
                    borderRadius: 8,
                    background: "#F0F7FC",
                    border: "1px solid #D8E6EE",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                    fontSize: 17,
                  }}>
                    {f.icon}
                  </div>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: "#0F1F2B", marginBottom: 3 }}>{f.title}</div>
                    <div style={{ fontSize: 13, color: "#6B8090", lineHeight: 1.55 }}>{f.sub}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── MÓDULOS — numbered steps layout (fundo branco) ── */}
      <section style={{ background: "#FFFFFF", borderBottom: "1px solid #E8EFF4" }}>
        <div className="flex flex-col lg:flex-row" style={{ minHeight: 560 }}>

          {/* Coluna esquerda — steps */}
          <div style={{
            padding: "48px 32px",
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
          }}
          className="w-full lg:w-[48%] lg:px-14 lg:py-16"
          >
            {/* Label */}
            <div style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              marginBottom: 16,
            }}>
              <div style={{ width: 24, height: 2, background: "#1FB6E1", borderRadius: 2 }} />
              <span style={{
                fontSize: 11,
                fontWeight: 600,
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                color: "#1872A5",
              }}>
                {h("Módulos da plataforma")}
              </span>
            </div>

            {/* Headline */}
            <h2 style={{
              fontWeight: 700,
              letterSpacing: "-0.6px",
              color: "#0F1F2B",
              marginBottom: 10,
              lineHeight: 1.15,
            }}
            className="text-[26px] lg:text-[34px]"
            >
              {h("Tudo o que você precisa")}<br />
              <span style={{ color: "#1872A5" }}>{h("em um único lugar")}</span>
            </h2>

            <p style={{ fontSize: 14, color: "#6B8090", lineHeight: 1.7, marginBottom: 36, maxWidth: 400 }}>
              {h("Do diagnóstico ao follow-up, cada etapa da jornada cirúrgica coberta com precisão clínica.")}
            </p>

            {/* Numbered steps */}
            <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
              {[
                 { n: "01", title: h("Análise Radiográfica por IA"), sub: h("HKA, MAD e deformidade varo/valgo por foto panorâmica de MMII") },
                 { n: "02", title: h("Planejamento de Osteotomia"), sub: h("Cunha de correção, simulação do eixo mecânico pós-cirurgia") },
                 { n: "03", title: h("Laudo e Registro Cirúrgico"), sub: h("Documentação SOAP com exportação automática para PDF") },
                 { n: "04", title: h("Algoritmos KRIRS e PICS 2.0"), sub: h("Risco de lesão LCA e instabilidade patelar integrados ao prontuário") },
                 { n: "05", title: h("Follow-up Pós-operatório"), sub: h("Escalas funcionais, retorno ao esporte e histórico evolutivo") },
                 { n: "06", title: h("Dados para Pesquisa Científica"), sub: h("IKDC, Lysholm, Tegner, VAS exportados em CSV para publicação") },
              ].map((s, i, arr) => (
                <div key={i} style={{
                  display: "flex",
                  gap: 16,
                  paddingBottom: i < arr.length - 1 ? 20 : 0,
                  paddingTop: i > 0 ? 20 : 0,
                  borderBottom: i < arr.length - 1 ? "1px solid #EDF2F5" : "none",
                }}>
                  <div style={{
                    fontFamily: "'DM Mono', monospace",
                    fontSize: 13,
                    fontWeight: 700,
                    color: "#1FB6E1",
                    letterSpacing: "-0.3px",
                    lineHeight: 1.6,
                    flexShrink: 0,
                    width: 28,
                  }}>
                    {s.n}
                  </div>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: "#0F1F2B", marginBottom: 2 }}>{s.title}</div>
                    <div style={{ fontSize: 12, color: "#6B8090", lineHeight: 1.55 }}>{s.sub}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Coluna direita — Bento grid 2×3, um card por módulo */}
          <div style={{
            flex: 1,
            background: "#0D1F30",
            padding: "24px 20px",
            display: "flex",
            alignItems: "center",
          }}
          className="lg:px-8 lg:py-10"
          >
            <div style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 10,
              width: "100%",
            }}>

              {/* 01 — Análise Radiográfica (CSS/SVG illustration) */}
              <div style={{ background: "#071628", borderRadius: 12, overflow: "hidden", border: "1px solid rgba(31,182,225,0.2)", position: "relative" }}>
                {/* Anatomical angle illustration */}
                <div style={{ height: 100, background: "#030C18", position: "relative", overflow: "hidden" }}>
                  <svg width="100%" height="100%" viewBox="0 0 200 100" preserveAspectRatio="xMidYMid meet" style={{ position: "absolute", inset: 0 }}>
                    {/* Femur bone shaft (left leg) */}
                    <rect x="72" y="2" width="20" height="92" rx="10" fill="rgba(200,210,220,0.07)" />
                    {/* Tibia continuation */}
                    <rect x="74" y="56" width="16" height="44" rx="8" fill="rgba(200,210,220,0.05)" />
                    {/* Mechanical axis — dashed vertical */}
                    <line x1="82" y1="4" x2="82" y2="96" stroke="#1FB6E1" strokeWidth="1" strokeDasharray="4,3" opacity="0.65" />
                    {/* mLDFA line — angled at distal femur */}
                    <line x1="50" y1="45" x2="125" y2="55" stroke="#60AADD" strokeWidth="1.2" opacity="0.85" />
                    {/* mLDFA arc */}
                    <path d="M 82,50 A 14,14 0 0,1 96,50" fill="none" stroke="#60AADD" strokeWidth="1" opacity="0.7" />
                    {/* aMPTA line — angled at proximal tibia */}
                    <line x1="52" y1="66" x2="120" y2="58" stroke="#38B88A" strokeWidth="1.2" opacity="0.8" />
                    {/* aMPTA arc */}
                    <path d="M 82,62 A 10,10 0 0,0 92,58" fill="none" stroke="#38B88A" strokeWidth="1" opacity="0.7" />
                    {/* HKA varo arc (knee joint) */}
                    <path d="M 74,51 A 8,8 0 0,0 90,51" fill="none" stroke="#E67832" strokeWidth="1.2" opacity="0.9" />
                    {/* Labels */}
                    <text x="130" y="53" fill="#60AADD" fontSize="7.5" fontFamily="monospace" opacity="0.9">mLDFA</text>
                    <text x="125" y="62" fill="#38B88A" fontSize="7.5" fontFamily="monospace" opacity="0.9">aMPTA</text>
                    <text x="37" y="55" fill="#E67832" fontSize="7.5" fontFamily="monospace" opacity="0.9">HKA</text>
                    {/* HKA value */}
                    <text x="90" y="49" fill="#E67832" fontSize="6.5" fontFamily="monospace" fontWeight="bold">8.3°</text>
                  </svg>
                  {/* Step badge */}
                  <div style={{ position: "absolute", top: 6, right: 8, fontSize: 8, color: "#1FB6E1", background: "rgba(31,182,225,0.13)", border: "1px solid rgba(31,182,225,0.35)", borderRadius: 4, padding: "2px 7px", fontFamily: "'DM Mono', monospace", fontWeight: 700 }}>{h("Etapa 9/11")}</div>
                  {/* Angle readout strip */}
                  <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, display: "flex", gap: 6, padding: "4px 8px", background: "rgba(3,12,24,0.75)", backdropFilter: "blur(2px)" }}>
                    {[{ l: "HKA", v: "8.3° var", c: "#E67832" }, { l: "mLDFA", v: "92.7°", c: "#60AADD" }, { l: "aMPTA", v: "87.1°", c: "#38B88A" }].map((m, i) => (
                      <div key={i} style={{ textAlign: "center" }}>
                        <div style={{ fontSize: 7, color: "rgba(255,255,255,0.3)", fontFamily: "'DM Mono', monospace" }}>{m.l}</div>
                        <div style={{ fontSize: 8, fontWeight: 700, color: m.c, fontFamily: "'DM Mono', monospace" }}>{m.v}</div>
                      </div>
                    ))}
                  </div>
                </div>
                <div style={{ padding: "10px 12px 12px" }}>
                  <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 9, color: "#1FB6E1", letterSpacing: "0.08em", marginBottom: 3 }}>01 · ANÁLISE RX</div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "#FFF", lineHeight: 1.3 }}>HKA · mLDFA · aMPTA</div>
                   <div style={{ fontSize: 10, color: "rgba(255,255,255,0.38)", marginTop: 2 }}>{h("Foto panorâmica de MMII")}</div>
                </div>
              </div>

              {/* 02 — Planejamento de Osteotomia (CSS illustration) */}
              <div style={{ background: "#091825", borderRadius: 12, overflow: "hidden", border: "1px solid rgba(96,170,221,0.18)", position: "relative" }}>
                {/* Surgical planning table mock */}
                <div style={{ height: 100, background: "#050E1C", padding: "8px 11px 4px", overflow: "hidden" }}>
                  {/* Header row */}
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                    <div style={{ fontSize: 8, fontWeight: 700, color: "#60AADD", fontFamily: "'DM Mono', monospace" }}>Dupla: DFO + HTO</div>
                     <div style={{ fontSize: 7, color: "#38B88A", background: "rgba(56,184,138,0.13)", border: "1px solid rgba(56,184,138,0.3)", borderRadius: 3, padding: "1px 6px", fontWeight: 700 }}>{h("✓ Selecionado")}</div>
                  </div>
                  {/* Data rows */}
                  {[
                     { label: h("Correção femoral"), val: "10.2° valgo", c: "#60AADD" },
                     { label: h("Correção tibial"),  val: "8.4° varo",  c: "#1FB6E1" },
                     { label: h("Total"),             val: "18.6°",     c: "#FFF", bold: true },
                  ].map((r, i) => (
                    <div key={i} style={{ display: "flex", justifyContent: "space-between", marginBottom: 4, paddingBottom: 4, borderBottom: i < 2 ? "1px solid rgba(255,255,255,0.05)" : "none" }}>
                      <span style={{ fontSize: 8, color: "rgba(255,255,255,0.38)" }}>{r.label}</span>
                      <span style={{ fontSize: 8, fontWeight: r.bold ? 800 : 500, color: r.c, fontFamily: "'DM Mono', monospace" }}>{r.val}</span>
                    </div>
                  ))}
                  {/* Technique tags */}
                  <div style={{ display: "flex", gap: 4, marginTop: 2 }}>
                    {["Fechamento lat.", "HTO var", "DFO valg"].map((t, i) => (
                      <div key={i} style={{ fontSize: 7, color: "#60AADD", background: "rgba(96,170,221,0.09)", border: "1px solid rgba(96,170,221,0.22)", borderRadius: 3, padding: "1px 5px" }}>{t}</div>
                    ))}
                  </div>
                </div>
                <div style={{ padding: "10px 12px 12px" }}>
                  <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 9, color: "#60AADD", letterSpacing: "0.08em", marginBottom: 3 }}>02 · PLANEJAMENTO</div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "#FFF", lineHeight: 1.3 }}>DFO · HTO · Cunha</div>
                   <div style={{ fontSize: 10, color: "rgba(255,255,255,0.38)", marginTop: 2 }}>{h("Simulador de eixo mecânico")}</div>
                </div>
              </div>

              {/* 03 — Laudo e Registro Cirúrgico (CSS illustration) */}
              <div style={{ background: "#100E22", borderRadius: 12, border: "1px solid rgba(160,120,220,0.2)", padding: "14px 14px 14px" }}>
                {/* Mini PDF mock */}
                <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
                   {[h("Anamnese"), "SOAP", "PDF"].map((tag, i) => (
                    <div key={i} style={{
                      fontSize: 8, fontWeight: 600, color: i === 2 ? "#A078DC" : "rgba(255,255,255,0.45)",
                      background: i === 2 ? "rgba(160,120,220,0.15)" : "rgba(255,255,255,0.06)",
                      borderRadius: 4, padding: "3px 7px", border: `1px solid ${i === 2 ? "rgba(160,120,220,0.35)" : "transparent"}`,
                    }}>{tag}</div>
                  ))}
                </div>
                <div style={{ background: "rgba(255,255,255,0.04)", borderRadius: 8, padding: "8px 10px", marginBottom: 10, border: "1px solid rgba(255,255,255,0.07)" }}>
                   <div style={{ fontSize: 8, color: "rgba(255,255,255,0.28)", marginBottom: 4 }}>{h("Exportar laudo")}</div>
                  <div style={{ display: "flex", gap: 4 }}>
                    {["PDF", "SOAP", "CSV"].map((f, i) => (
                      <div key={i} style={{ fontSize: 8, color: "#A078DC", background: "rgba(160,120,220,0.12)", borderRadius: 3, padding: "2px 6px" }}>{f}</div>
                    ))}
                  </div>
                </div>
                <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 9, color: "#A078DC", letterSpacing: "0.08em", marginBottom: 3 }}>03 · LAUDO</div>
                 <div style={{ fontSize: 12, fontWeight: 700, color: "#FFF", lineHeight: 1.3 }}>{h("Registro Cirúrgico")}</div>
                 <div style={{ fontSize: 10, color: "rgba(255,255,255,0.38)", marginTop: 2 }}>{h("Exportação automática PDF")}</div>
              </div>

              {/* 04 — Algoritmos KRIRS e PICS 2.0 (CSS illustration) */}
              <div style={{ background: "#1A0F0A", borderRadius: 12, border: "1px solid rgba(230,120,50,0.2)", padding: "14px 14px 14px" }}>
                {/* Risk score mock */}
                <div style={{ marginBottom: 10 }}>
                   <div style={{ fontSize: 8, color: "rgba(255,255,255,0.28)", marginBottom: 6 }}>{h("Risco estimado LCA")}</div>
                  {[
                     { label: h("Lesão prévia"), val: 85, color: "#E67832" },
                     { label: h("Frouxidão"), val: 62, color: "#E6A832" },
                     { label: h("Instabilidade"), val: 40, color: "#38B88A" },
                  ].map((r, i) => (
                    <div key={i} style={{ marginBottom: 5 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 2 }}>
                        <span style={{ fontSize: 8, color: "rgba(255,255,255,0.45)" }}>{r.label}</span>
                        <span style={{ fontSize: 8, color: r.color, fontWeight: 700 }}>{r.val}%</span>
                      </div>
                      <div style={{ height: 3, background: "rgba(255,255,255,0.06)", borderRadius: 2 }}>
                        <div style={{ height: "100%", width: `${r.val}%`, background: r.color, borderRadius: 2, opacity: 0.8 }} />
                      </div>
                    </div>
                  ))}
                </div>
                <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 9, color: "#E67832", letterSpacing: "0.08em", marginBottom: 3 }}>04 · ALGORITMOS</div>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#FFF", lineHeight: 1.3 }}>KRIRS · PICS 2.0</div>
                 <div style={{ fontSize: 10, color: "rgba(255,255,255,0.38)", marginTop: 2 }}>{h("Risco LCA e instabilidade patelar")}</div>
              </div>

              {/* 05 — Follow-up (CSS/SVG line chart) */}
              <div style={{ background: "#071610", borderRadius: 12, overflow: "hidden", border: "1px solid rgba(56,184,138,0.2)", position: "relative" }}>
                <div style={{ height: 100, background: "#030E09", padding: "7px 10px 4px", overflow: "hidden" }}>
                  {/* Header row */}
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 3 }}>
                    <div style={{ fontSize: 7.5, color: "rgba(255,255,255,0.38)", lineHeight: 1.3 }}>{h("Evolução funcional")}<br /><span style={{ color: "rgba(255,255,255,0.22)" }}>{h("(IKDC médio)")}</span></div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontSize: 18, fontWeight: 800, color: "#38B88A", lineHeight: 1, fontFamily: "'DM Mono', monospace" }}>79</div>
                      <div style={{ fontSize: 7, color: "rgba(56,184,138,0.6)" }}>{h("Score")}</div>
                    </div>
                  </div>
                  {/* Line chart SVG */}
                  <svg width="100%" height="52" viewBox="0 0 160 52" preserveAspectRatio="none">
                    {/* Horizontal grid */}
                    <line x1="0" y1="42" x2="160" y2="42" stroke="rgba(255,255,255,0.06)" strokeWidth="1" />
                    <line x1="0" y1="28" x2="160" y2="28" stroke="rgba(255,255,255,0.06)" strokeWidth="1" />
                    <line x1="0" y1="14" x2="160" y2="14" stroke="rgba(255,255,255,0.06)" strokeWidth="1" />
                    {/* Lysholm (lighter, dashed) */}
                    <polyline points="0,44 32,40 64,33 96,25 128,18 160,13" fill="none" stroke="rgba(56,184,138,0.35)" strokeWidth="1" strokeDasharray="3,2" />
                    {/* IKDC main line */}
                    <polyline points="0,46 32,42 64,35 96,26 128,18 160,10" fill="none" stroke="#38B88A" strokeWidth="1.8" strokeLinejoin="round" />
                    {/* Area fill */}
                    <polygon points="0,46 32,42 64,35 96,26 128,18 160,10 160,52 0,52" fill="rgba(56,184,138,0.07)" />
                    {/* Data point dots */}
                    {[[0,46],[32,42],[64,35],[96,26],[128,18],[160,10]].map(([x,y],i) => (
                      <circle key={i} cx={x} cy={y} r={i === 5 ? 3.5 : 2} fill={i === 5 ? "#38B88A" : "rgba(56,184,138,0.6)"} />
                    ))}
                  </svg>
                  {/* X-axis labels */}
                  <div style={{ display: "flex", justifyContent: "space-between", paddingTop: 2 }}>
                    {["Pré-op", "1m", "3m", "6m", "9m", "1a"].map((t, i) => (
                      <div key={i} style={{ fontSize: 6.5, color: "rgba(255,255,255,0.2)", fontFamily: "'DM Mono', monospace" }}>{t}</div>
                    ))}
                  </div>
                </div>
                <div style={{ padding: "10px 12px 12px" }}>
                  <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 9, color: "#38B88A", letterSpacing: "0.08em", marginBottom: 3 }}>05 · FOLLOW-UP</div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "#FFF", lineHeight: 1.3 }}>IKDC · Lysholm · Tegner</div>
                  <div style={{ fontSize: 10, color: "rgba(255,255,255,0.38)", marginTop: 2 }}>{h("Retorno ao esporte evolutivo")}</div>
                </div>
              </div>

              {/* 06 — Pesquisa Científica (CSS dashboard) */}
              <div style={{ background: "#150E04", borderRadius: 12, overflow: "hidden", border: "1px solid rgba(208,136,24,0.2)", position: "relative" }}>
                <div style={{ height: 100, background: "#0D0802", padding: "8px 10px", overflow: "hidden" }}>
                  {/* Two stat tiles */}
                  <div style={{ display: "flex", gap: 6, height: "100%" }}>
                    {/* Cirurgias */}
                    <div style={{ flex: 1, background: "rgba(255,255,255,0.03)", border: "1px solid rgba(208,136,24,0.18)", borderRadius: 8, padding: "8px 10px", display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
                      <div>
                        <div style={{ fontSize: 26, fontWeight: 900, color: "#FFF", lineHeight: 1, fontFamily: "'DM Mono', monospace" }}>55</div>
                        <div style={{ fontSize: 7.5, color: "rgba(255,255,255,0.4)", marginTop: 3 }}>{h("Cirurgias realizadas")}</div>
                        <div style={{ fontSize: 7, color: "rgba(255,255,255,0.2)", marginTop: 1 }}>{h("7 pacientes")}</div>
                      </div>
                      {/* Sparkbar */}
                      <div style={{ display: "flex", gap: 2, alignItems: "flex-end", height: 14 }}>
                        {[6,9,7,11,14,10,13,15].map((h, i) => (
                          <div key={i} style={{ flex: 1, height: h, background: i === 7 ? "#D08818" : "rgba(208,136,24,0.3)", borderRadius: 1 }} />
                        ))}
                      </div>
                    </div>
                    {/* Follow-up */}
                    <div style={{ flex: 1, background: "rgba(255,255,255,0.03)", border: "1px solid rgba(208,136,24,0.14)", borderRadius: 8, padding: "8px 10px", display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
                      <div>
                        <div style={{ fontSize: 26, fontWeight: 900, color: "#D08818", lineHeight: 1, fontFamily: "'DM Mono', monospace" }}>44%</div>
                        <div style={{ fontSize: 7.5, color: "rgba(255,255,255,0.4)", marginTop: 3 }}>{h("Follow-up concluídos")}</div>
                        <div style={{ fontSize: 7, color: "rgba(255,255,255,0.2)", marginTop: 1 }}>{h("6 respondidos")}</div>
                      </div>
                      {/* Donut-like arc progress */}
                      <svg width="100%" height="14" viewBox="0 0 60 8">
                        <rect x="0" y="3" width="60" height="3" rx="1.5" fill="rgba(255,255,255,0.07)" />
                        <rect x="0" y="3" width="26" height="3" rx="1.5" fill="#D08818" />
                      </svg>
                    </div>
                  </div>
                </div>
                <div style={{ padding: "10px 12px 12px" }}>
                  <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 9, color: "#D08818", letterSpacing: "0.08em", marginBottom: 3 }}>06 · PESQUISA</div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "#FFF", lineHeight: 1.3 }}>{h("Dashboard · CSV · Relatórios")}</div>
                  <div style={{ fontSize: 10, color: "rgba(255,255,255,0.38)", marginTop: 2 }}>{h("IKDC, VAS exportados p/ publicação")}</div>
                </div>
              </div>

            </div>
          </div>
        </div>
      </section>

      {/* ── DOCknee REGENERATIVA ── */}
      <section id="regenerativa" style={{ background: "#F5F9FC", borderTop: "1px solid #E2EEF5", borderBottom: "1px solid #E2EEF5" }}>
        <div className="max-w-6xl mx-auto px-5 py-16 lg:px-10 lg:py-24">
          <div className="grid grid-cols-1 lg:grid-cols-[0.92fr_1.08fr] gap-10 lg:gap-16 items-center">
            <div>
              <div style={{
                display: "inline-flex", alignItems: "center", gap: 7, padding: "6px 10px",
                borderRadius: 99, border: "1px solid #BDE7F5", background: "#EAF8FD",
                color: "#08799C", fontSize: 10, fontWeight: 800, letterSpacing: "0.1em",
              }}>
                <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#1FB6E1", boxShadow: "0 0 0 4px rgba(31,182,225,0.12)" }} />
                DOCknee REGENERATIVA
              </div>
              <h2 style={{ margin: "19px 0 14px", color: "#102A3E", fontSize: "clamp(30px, 4vw, 46px)", fontWeight: 800, letterSpacing: "-1.5px", lineHeight: 1.08 }}>
                {h("Registro clínico estruturado para a prática regenerativa.")}
              </h2>
              <p style={{ margin: 0, maxWidth: 505, color: "#577184", fontSize: 16, lineHeight: 1.7 }}>
                {h("Organize cada caso com documentação técnica, rastreabilidade e acompanhamento — do planejamento ao desfecho registrado.")}
              </p>

              <div style={{
                marginTop: 24, padding: "13px 15px", borderRadius: 10,
                background: "#FFFFFF", border: "1px solid #DCEAF1",
                display: "flex", alignItems: "flex-start", gap: 10,
              }}>
                <div style={{ width: 21, height: 21, borderRadius: "50%", background: "#EAF8FD", color: "#08799C", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 800, flexShrink: 0 }}>i</div>
                <p style={{ margin: 0, color: "#537084", fontSize: 12, lineHeight: 1.55 }}>
                  {h("Ferramenta de registro e apoio à organização clínica. As decisões e a indicação permanecem sob responsabilidade do profissional habilitado.")}
                </p>
              </div>

              <Link href="/register">
                <button style={{
                  marginTop: 26, padding: "13px 19px", borderRadius: 9,
                  background: "#0D698B", border: "1px solid #0D698B", color: "#FFFFFF",
                  fontSize: 14, fontFamily: "inherit", fontWeight: 700, cursor: "pointer",
                }}>
                  {h("Conhecer com 7 dias grátis →")}
                </button>
              </Link>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {[
                {
                  number: "01", title: h("Casos e protocolos"),
                  text: h("Registre procedimentos e produtos como PRP, PRF, ácido hialurônico, BMAC, MFAT e outros."),
                  color: "#1F8FB6", bg: "#EAF8FD",
                },
                {
                  number: "02", title: h("Anamnese e triagem"),
                  text: h("Concentre dados clínicos, exames laboratoriais, fatores de risco e alertas de conformidade."),
                  color: "#C97D10", bg: "#FFF7E7",
                },
                {
                  number: "03", title: h("Desfechos acompanhados"),
                  text: h("Registre PROMs e evolução do caso para uma visão organizada do acompanhamento."),
                  color: "#1B9A6A", bg: "#ECFBF4",
                },
                {
                  number: "04", title: h("Consentimento e orientação"),
                  text: h("Gere documentos por procedimento e mantenha orientações acessíveis ao longo do cuidado."),
                  color: "#7956C8", bg: "#F4F0FF",
                },
                {
                  number: "05", title: h("Pesquisa clínica"),
                  text: h("Consulte dados anonimizados e exporte recortes para análise e pesquisa."),
                  color: "#B85D4C", bg: "#FFF1EF",
                },
                {
                  number: "06", title: h("Rastreabilidade"),
                  text: h("Mantenha o histórico do caso, do planejamento ao registro dos procedimentos."),
                  color: "#2771AE", bg: "#EDF5FF",
                },
              ].map((feature) => (
                <div key={feature.number} style={{
                  minHeight: 164, padding: "19px 18px", background: "#FFFFFF",
                  borderRadius: 14, border: "1px solid #DFEAF0",
                  boxShadow: "0 8px 24px rgba(21, 71, 94, 0.045)",
                }}>
                  <div style={{
                    width: 31, height: 31, borderRadius: 9, display: "flex", alignItems: "center",
                    justifyContent: "center", background: feature.bg, color: feature.color,
                    fontFamily: "'DM Mono', monospace", fontSize: 10, fontWeight: 800, marginBottom: 18,
                  }}>{feature.number}</div>
                  <h3 style={{ margin: "0 0 6px", color: "#163247", fontSize: 14, fontWeight: 750 }}>{feature.title}</h3>
                  <p style={{ margin: 0, color: "#698293", fontSize: 12, lineHeight: 1.55 }}>{feature.text}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── PRICING ── */}
      <section id="planos" style={{ background: "#0D1F30", borderBottom: "1px solid #0D2035" }}>
        <div style={{ padding: "60px 20px 52px" }} className="lg:px-10 lg:py-20">

          {/* ── Header ── */}
          <div style={{ textAlign: "center", marginBottom: 48 }}>

            {/* Label acima do título */}
            <div style={{ marginBottom: 10 }}>
              <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.12em", textTransform: "uppercase", color: "rgba(255,255,255,0.3)" }}>
                {h("Planos e preços")}
              </span>
            </div>

            {/* "7 dias grátis" — menor */}
            <div style={{ position: "relative", display: "inline-block", marginBottom: 12 }}>
              <div style={{
                fontSize: "clamp(36px, 6vw, 54px)",
                fontWeight: 900,
                letterSpacing: "-2px",
                lineHeight: 1,
                background: "linear-gradient(135deg, #FFFFFF 30%, #1FB6E1 80%)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
                backgroundClip: "text",
              }}>
                {h("7 dias grátis")}
              </div>
              <div style={{
                position: "absolute", inset: 0, zIndex: -1,
                background: "radial-gradient(ellipse 60% 50% at 50% 60%, rgba(31,182,225,0.15), transparent)",
                filter: "blur(20px)",
              }} />
            </div>

            <p style={{ fontSize: 14, color: "rgba(255,255,255,0.55)", lineHeight: 1.6, maxWidth: 520, margin: "0 auto" }}>
              {h("Escolha mensal ou anual no cadastro e ative o teste no checkout, sem cobrança imediata. A cobrança do plano selecionado começa após os 7 dias.")}
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-md mx-auto" style={{ marginTop: 22, textAlign: "left" }}>
              <div style={{ padding: "12px 14px", borderRadius: 11, background: "rgba(255,255,255,0.055)", border: "1px solid rgba(255,255,255,0.1)" }}>
                 <div style={{ color: "rgba(255,255,255,0.45)", fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" }}>{h("Mensal")}</div>
                 <div style={{ color: "#FFFFFF", fontSize: 17, fontWeight: 800, marginTop: 3 }}>R$ 129,90 <span style={{ color: "rgba(255,255,255,0.45)", fontSize: 11, fontWeight: 500 }}>/ {h("mês")}</span></div>
              </div>
              <div style={{ padding: "12px 14px", borderRadius: 11, background: "rgba(56,184,138,0.1)", border: "1px solid rgba(56,184,138,0.34)" }}>
                 <div style={{ color: "#72D3AE", fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" }}>{h("Anual · economia de 17%")}</div>
                 <div style={{ color: "#FFFFFF", fontSize: 17, fontWeight: 800, marginTop: 3 }}>R$ 1.299,90 <span style={{ color: "rgba(255,255,255,0.55)", fontSize: 11, fontWeight: 500 }}>/ {h("ano")}</span></div>
                 <div style={{ color: "rgba(255,255,255,0.46)", fontSize: 10, marginTop: 3 }}>{h("Equivale a R$ 108,33 por mês")}</div>
              </div>
            </div>
          </div>

          {/* ── Cards ── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 max-w-4xl mx-auto">

            {/* ── Médico ── (destaque) */}
            <div style={{
              position: "relative",
              background: "linear-gradient(160deg, #0A1E35 0%, #071628 100%)",
              border: "1.5px solid rgba(31,182,225,0.45)",
              borderRadius: 20,
              overflow: "hidden",
              boxShadow: "0 0 40px rgba(31,182,225,0.1), 0 16px 48px rgba(0,0,0,0.4)",
            }}>
              {/* Subtle top glow strip */}
              <div style={{ height: 2, background: "linear-gradient(90deg, transparent, #1FB6E1, transparent)" }} />

              <div style={{ padding: "28px 28px 32px" }}>
                {/* Label */}
                <div style={{ marginBottom: 8 }}>
                   <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", color: "#1FB6E1", marginBottom: 4 }}>{h("Para médicos ortopedistas")}</div>
                  <div style={{ fontSize: 22, fontWeight: 700, color: "#FFFFFF", letterSpacing: "-0.4px" }}>DocSholder Médico</div>
                   <div style={{ fontSize: 12, color: "rgba(255,255,255,0.35)", marginTop: 2 }}>{h("Plataforma cirúrgica completa")}</div>
                </div>

                {/* Mensal / Anual toggle */}
                <div style={{ display: "flex", alignItems: "center", gap: 0, marginTop: 20, marginBottom: 4,
                  background: "rgba(255,255,255,0.06)", borderRadius: 10, padding: 3, width: "fit-content" }}>
                  {(["mensal", "anual"] as const).map(p => (
                    <button
                      type="button"
                      key={p}
                      onClick={() => setPricingPeriod(p)}
                      aria-pressed={pricingPeriod === p}
                       aria-label={locale === "es" ? `Mostrar precio ${p === "mensal" ? "mensual" : "anual"}` : `Exibir preço ${p === "mensal" ? "mensal" : "anual"}`}
                      style={{
                        padding: "6px 16px", borderRadius: 8, border: "none",
                        fontSize: 12, fontWeight: 600, cursor: "pointer",
                        fontFamily: "inherit", letterSpacing: "0.01em",
                        transition: "all 0.18s",
                        background: pricingPeriod === p ? "#1FB6E1" : "transparent",
                        color: pricingPeriod === p ? "#fff" : "rgba(255,255,255,0.45)",
                        position: "relative",
                      }}
                    >
                       {p === "mensal" ? h("Mensal") : h("Anual")}
                      {p === "anual" && (
                        <span style={{
                          position: "absolute", top: -8, right: -4,
                          background: "#38B88A", color: "#fff",
                          fontSize: 8, fontWeight: 800, letterSpacing: "0.04em",
                          padding: "1px 5px", borderRadius: 20,
                          textTransform: "uppercase",
                        }}>-17%</span>
                      )}
                    </button>
                  ))}
                </div>

                {/* Price */}
                {pricingPeriod === "mensal" ? (
                  <>
                    <div style={{ margin: "16px 0 4px", display: "flex", alignItems: "flex-end", gap: 2 }}>
                      <span style={{ fontSize: 13, color: "rgba(255,255,255,0.4)", marginBottom: 10 }}>R$</span>
                      <span style={{ fontSize: 58, fontWeight: 900, color: "#FFFFFF", letterSpacing: "-3px", lineHeight: 1 }}>129</span>
                      <span style={{ fontSize: 26, fontWeight: 700, color: "rgba(255,255,255,0.7)", marginBottom: 6 }}>,90</span>
                       <span style={{ fontSize: 13, color: "rgba(255,255,255,0.35)", marginBottom: 10, marginLeft: 2 }}>{h("/mês")}</span>
                    </div>
                    <div style={{ fontSize: 12, color: "rgba(255,255,255,0.35)", marginBottom: 24 }}>
                       {h("Após os 7 dias grátis · cobrado mensalmente")}
                    </div>
                  </>
                ) : (
                  <>
                    <div style={{ margin: "16px 0 4px", display: "flex", alignItems: "flex-end", gap: 2 }}>
                      <span style={{ fontSize: 13, color: "rgba(255,255,255,0.4)", marginBottom: 10 }}>R$</span>
                      <span style={{ fontSize: 58, fontWeight: 900, color: "#FFFFFF", letterSpacing: "-3px", lineHeight: 1 }}>108</span>
                      <span style={{ fontSize: 26, fontWeight: 700, color: "rgba(255,255,255,0.7)", marginBottom: 6 }}>,33</span>
                       <span style={{ fontSize: 13, color: "rgba(255,255,255,0.35)", marginBottom: 10, marginLeft: 2 }}>{h("/mês")}</span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 24 }}>
                      <div style={{
                        display: "inline-flex", alignItems: "center", gap: 6,
                        background: "rgba(56,184,138,0.13)",
                        border: "1px solid rgba(56,184,138,0.35)",
                        borderRadius: 8, padding: "6px 11px",
                      }}>
                        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                          <circle cx="6" cy="6" r="5.5" fill="rgba(56,184,138,0.25)" />
                          <path d="M3 6l2 2 4-4" stroke="#38B88A" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                         <span style={{ fontSize: 12, color: "#38B88A", fontWeight: 700 }}>{h("Economia de 17%")}</span>
                        <span style={{ fontSize: 12, color: "rgba(255,255,255,0.55)", fontWeight: 400 }}>
                           {h("· Total")} <span style={{ color: "#fff", fontWeight: 700 }}>R$ 1.299,90</span>{h("/ano")}
                        </span>
                      </div>
                    </div>
                  </>
                )}

                {/* Divider */}
                <div style={{ height: 1, background: "rgba(255,255,255,0.07)", marginBottom: 20 }} />

                {/* Features */}
                <div style={{ display: "flex", flexDirection: "column", gap: 11, marginBottom: 28 }}>
                  {[
                    h("Prontuário eletrônico completo"),
                    h("Documentação cirúrgica e laudos em PDF"),
                    h("Análise radiográfica por IA (HKA, MAD, osteotomia)"),
                    h("Algoritmos KRIRS e PICS 2.0"),
                    h("Agendamento online com função secretaria"),
                    h("Lembretes de consulta pelo WhatsApp"),
                    h("Follow-up pós-operatório com escalas"),
                    h("Protocolos baseados nos consensos atuais"),
                    h("Relatórios para publicação científica"),
                    h("Conformidade LGPD"),
                  ].map((f) => (
                    <div key={f} style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                      <svg width="15" height="15" viewBox="0 0 15 15" style={{ flexShrink: 0, marginTop: 1 }}>
                        <circle cx="7.5" cy="7.5" r="7" fill="rgba(31,182,225,0.15)" />
                        <path d="M4.5 7.5l2 2 4-4" stroke="#1FB6E1" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
                      </svg>
                      <span style={{ fontSize: 13, color: "rgba(255,255,255,0.7)", lineHeight: 1.45 }}>{f}</span>
                    </div>
                  ))}
                </div>

                <Link href="/register">
                  <button style={{
                    width: "100%", padding: "14px", borderRadius: 10,
                    background: "#1FB6E1", border: "none",
                    color: "#fff", fontSize: 14, fontFamily: "inherit",
                    fontWeight: 700, cursor: "pointer", letterSpacing: "-0.1px",
                  }}>
                     {h("Criar conta e começar 7 dias grátis →")}
                  </button>
                </Link>
              </div>
            </div>

            {/* ── Fisioterapeuta — oculto temporariamente ── */}
            {false && <div style={{
              background: "linear-gradient(160deg, #071A14 0%, #050F0C 100%)",
              border: "1.5px solid rgba(56,184,138,0.25)",
              borderRadius: 20,
              overflow: "hidden",
              boxShadow: "0 16px 48px rgba(0,0,0,0.35)",
            }}>
              <div style={{ height: 2, background: "linear-gradient(90deg, transparent, rgba(56,184,138,0.6), transparent)" }} />

              <div style={{ padding: "28px 28px 32px" }}>
                {/* Label */}
                <div style={{ marginBottom: 8 }}>
                  <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", color: "#38B88A", marginBottom: 4 }}>Para fisioterapeutas</div>
                  <div style={{ fontSize: 22, fontWeight: 700, color: "#FFFFFF", letterSpacing: "-0.4px" }}>DocSholder Fisio</div>
                  <div style={{ fontSize: 12, color: "rgba(255,255,255,0.35)", marginTop: 2 }}>Reabilitação pós-operatória</div>
                </div>

                {/* Price */}
                <div style={{ margin: "24px 0 8px", display: "flex", alignItems: "flex-end", gap: 2 }}>
                  <span style={{ fontSize: 13, color: "rgba(255,255,255,0.4)", marginBottom: 10 }}>R$</span>
                  <span style={{ fontSize: 58, fontWeight: 900, color: "#FFFFFF", letterSpacing: "-3px", lineHeight: 1 }}>69</span>
                  <span style={{ fontSize: 26, fontWeight: 700, color: "rgba(255,255,255,0.7)", marginBottom: 6 }}>,90</span>
                  <span style={{ fontSize: 13, color: "rgba(255,255,255,0.35)", marginBottom: 10, marginLeft: 2 }}>/mês</span>
                </div>
                <div style={{ fontSize: 12, color: "#38B88A", fontWeight: 500, marginBottom: 24, opacity: 0.85 }}>
                  ou R$ 699,90/ano <span style={{ color: "#38B88A", opacity: 0.7 }}>· 2 meses grátis</span>
                </div>

                {/* Divider */}
                <div style={{ height: 1, background: "rgba(255,255,255,0.07)", marginBottom: 20 }} />

                {/* Features */}
                <div style={{ display: "flex", flexDirection: "column", gap: 11, marginBottom: 28 }}>
                  {[
                    "Prontuário fisioterapêutico completo",
                    "Protocolos de reabilitação pós-operatória",
                    "Agendamento de sessões integrado",
                    "Acompanhamento evolutivo do paciente",
                    "Escalas funcionais (IKDC, Lysholm, VAS)",
                    "Lembretes de sessão pelo WhatsApp",
                    "Relatórios de evolução em PDF",
                    "Conformidade LGPD",
                  ].map((f) => (
                    <div key={f} style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                      <svg width="15" height="15" viewBox="0 0 15 15" style={{ flexShrink: 0, marginTop: 1 }}>
                        <circle cx="7.5" cy="7.5" r="7" fill="rgba(56,184,138,0.12)" />
                        <path d="M4.5 7.5l2 2 4-4" stroke="#38B88A" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
                      </svg>
                      <span style={{ fontSize: 13, color: "rgba(255,255,255,0.7)", lineHeight: 1.45 }}>{f}</span>
                    </div>
                  ))}
                </div>

                <Link href="/fisio">
                  <button style={{
                    width: "100%", padding: "14px", borderRadius: 10,
                    background: "rgba(56,184,138,0.15)",
                    border: "1.5px solid rgba(56,184,138,0.45)",
                    color: "#38B88A", fontSize: 14, fontFamily: "inherit",
                    fontWeight: 700, cursor: "pointer", letterSpacing: "-0.1px",
                  }}>
                    Começar grátis por 7 dias →
                  </button>
                </Link>
              </div>
            </div>}
          </div>

          <p style={{ textAlign: "center", fontSize: 12, color: "rgba(255,255,255,0.2)", marginTop: 28, letterSpacing: "0.02em" }}>
             {h("Cancelamento a qualquer momento · Sem multa · Sem fidelidade")}
          </p>
        </div>
      </section>

      {/* ── FOOTER ── */}
      <footer style={{ padding: "20px", borderTop: "1px solid #D8E6EE" }} className="lg:px-10 lg:flex lg:items-center lg:justify-between">
        <div style={{ display: "block", marginBottom: 12 }} className="lg:mb-0">
          <span style={{ fontSize: 12, color: "#4A6070", display: "block" }}>
             {h("DocSholder — Plataforma de documentação e planejamento cirúrgico do joelho")}
          </span>
          <a
             href={SUPPORT_WHATSAPP_URL}
            target="_blank"
            rel="noopener noreferrer"
            style={{ fontSize: 12, color: "#25D366", textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 5, marginTop: 4 }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="#25D366"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/><path d="M12 0C5.373 0 0 5.373 0 12c0 2.126.553 4.122 1.523 5.855L.057 23.25a.75.75 0 00.917.912l5.49-1.437A11.944 11.944 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 21.75a9.717 9.717 0 01-4.99-1.377l-.358-.214-3.713.972.99-3.614-.234-.372A9.718 9.718 0 012.25 12C2.25 6.615 6.615 2.25 12 2.25S21.75 6.615 21.75 12 17.385 21.75 12 21.75z"/></svg>
            (28) 3199-2105
          </a>
        </div>
        <div style={{ display: "flex", gap: 20 }}>
           {([[h("Entrar"), "/login"], [h("Criar conta"), "/register"]] as [string, string][]).map(([label, href]) => (
            <Link key={href} href={href} style={{ fontSize: 12, color: "#8AABB8", textDecoration: "none" }}>
              {label}
            </Link>
          ))}
        </div>
      </footer>
    </div>
  );
}
