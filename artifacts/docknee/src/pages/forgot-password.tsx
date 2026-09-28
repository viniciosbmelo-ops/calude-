import { useState } from "react";
import { Link } from "wouter";
import { useLanguage } from "@/lib/i18n";
import { publicPageMessages } from "@/locales/public-pages";
import { PublicLanguageSelector } from "@/components/public-language-selector";

type View = "form" | "sent";

export default function ForgotPassword() {
  const { locale } = useLanguage();
  const copy = publicPageMessages[locale];
  const [view, setView] = useState<View>("form");
  const [emailVal, setEmailVal] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    if (!emailVal.trim()) { setErr(copy.enterEmail); return; }
    setLoading(true);
    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: emailVal.trim().toLowerCase(),
          idioma: locale,
        }),
      });
      if (!res.ok) {
        setErr(copy.sendError); return;
      }
      setView("sent");
    } catch {
      setErr(copy.connectionTryAgain);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="grid lg:grid-cols-2 grid-cols-1"
      style={{ minHeight: "100vh", fontFamily: "'DM Sans', sans-serif" }}
    >
      {/* LEFT PANEL */}
      <div
        style={{ background: "#0A1828", padding: "48px 52px", flexDirection: "column", justifyContent: "space-between" }}
        className="hidden lg:flex"
      >
        <div style={{ display: "flex", justifyContent: "center", alignItems: "center" }}>
          <img
            src={`${(import.meta as any).env?.BASE_URL ?? "/"}logo-docknee-new.png`}
            alt="DocKnee"
            style={{ width: "80%", height: "auto", objectFit: "contain" }}
          />
        </div>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", padding: "40px 0" }}>
          <h1 style={{ fontSize: 26, fontWeight: 400, color: "#D0E8F5", lineHeight: 1.3, letterSpacing: "-0.3px", marginBottom: 12 }}>
            {copy.resetHeading}
          </h1>
          <p style={{ fontSize: 14, color: "#5A8AA8", lineHeight: 1.65, maxWidth: 320 }}>
            {copy.resetIntro}
          </p>
        </div>
        <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, color: "#2A5070", letterSpacing: "0.04em" }}>
          DocKnee v2.0
        </div>
      </div>

      {/* RIGHT PANEL */}
      <div
        className="flex items-start lg:items-center justify-center px-5 py-10 lg:px-12 lg:py-12"
        style={{ background: "#FFFFFF", borderLeft: "1px solid #D8E6EE" }}
      >
        <div style={{ width: "100%", maxWidth: 420 }}>
          <div className="flex justify-end mb-4"><PublicLanguageSelector /></div>
          <div style={{ marginBottom: 32 }}>
            <img
              src={`${(import.meta as any).env?.BASE_URL ?? "/"}logo-docknee.jpg`}
              alt="DocKnee"
              style={{ height: 52, width: "auto", objectFit: "contain" }}
            />
          </div>

          {view === "sent" ? (
            /* ── ENVIADO ── */
            <div style={{ textAlign: "center" }}>
              <div style={{ width: 56, height: 56, borderRadius: "50%", background: "#D1FAE5", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 20px" }}>
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#059669" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </div>
              <h2 style={{ fontSize: 22, fontWeight: 500, color: "#0F1F2B", marginBottom: 8, letterSpacing: "-0.3px" }}>
                {copy.emailSent}
              </h2>
              <p style={{ fontSize: 14, color: "#4A6070", marginBottom: 12, lineHeight: 1.6 }}>
                {copy.emailSentDescription.replace("{email}", emailVal)}
              </p>
              <p style={{ fontSize: 13, color: "#8AABB8", marginBottom: 28, lineHeight: 1.6 }}>
                {copy.linkExpires}
              </p>

              {/* Aviso spam */}
              <div style={{ background: "#FFFBEB", border: "1px solid #FDE68A", borderRadius: 6, padding: "12px 16px", marginBottom: 28, textAlign: "left" }}>
                <p style={{ fontSize: 13, color: "#92400E", margin: 0, lineHeight: 1.6 }}>
                  ⚠️ {copy.spamWarning}
                </p>
              </div>

              <Link
                href="/login"
                style={{ display: "block", padding: "11px", background: "#0B2A3E", color: "#D0E8F5", borderRadius: 4, fontSize: 14, fontWeight: 500, textDecoration: "none", textAlign: "center" }}
              >
                {copy.backToLogin}
              </Link>
            </div>
          ) : (
            /* ── FORMULÁRIO ── */
            <>
              <h2 style={{ fontSize: 22, fontWeight: 500, color: "#0F1F2B", marginBottom: 5, letterSpacing: "-0.3px" }}>
                {copy.forgotHeading}
              </h2>
              <p style={{ fontSize: 14, color: "#5A8AA8", marginBottom: 28, lineHeight: 1.5 }}>
                {copy.resetIntro}
              </p>

              {err && (
                <div style={{ marginBottom: 16, padding: "10px 14px", background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: 4, fontSize: 13, color: "#dc2626" }}>
                  {err}
                </div>
              )}

              <form onSubmit={handleSend}>
                <div style={{ marginBottom: 20 }}>
                  <label
                    htmlFor="fp-email"
                    style={{ display: "block", fontSize: 12, fontWeight: 500, color: "#4A6070", marginBottom: 6, letterSpacing: "0.01em" }}
                  >
                    {copy.registeredEmail}
                  </label>
                  <input
                    id="fp-email"
                    type="email"
                    value={emailVal}
                    onChange={(e) => setEmailVal(e.target.value.toLowerCase())}
                    placeholder="seu@email.com"
                    required
                    autoFocus
                    style={{ width: "100%", padding: "10px 13px", fontSize: 14, fontFamily: "inherit", border: "1px solid #D8E6EE", borderRadius: 4, background: "#FFFFFF", color: "#0F1F2B", outline: "none", boxSizing: "border-box" }}
                    onFocus={(e) => { e.target.style.borderColor = "#1872A5"; e.target.style.boxShadow = "0 0 0 3px rgba(24,114,165,0.08)"; }}
                    onBlur={(e) => { e.target.style.borderColor = "#D8E6EE"; e.target.style.boxShadow = "none"; }}
                  />
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  style={{ width: "100%", padding: "11px", background: loading ? "#4A6070" : "#0B2A3E", color: "#D0E8F5", border: "none", borderRadius: 4, fontSize: 14, fontWeight: 500, cursor: loading ? "not-allowed" : "pointer", fontFamily: "inherit", opacity: loading ? 0.75 : 1, marginBottom: 20 }}
                >
                  {loading ? copy.sending : copy.sendResetLink}
                </button>
              </form>

              <div style={{ textAlign: "center" }}>
                <Link href="/login" style={{ fontSize: 13, color: "#1872A5", textDecoration: "none" }}>
                  ← {copy.backToLogin}
                </Link>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
