import { useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { Eye, EyeOff } from "lucide-react";
import { useLanguage } from "@/lib/i18n";
import { publicPageMessages } from "@/locales/public-pages";
import { PublicLanguageSelector } from "@/components/public-language-selector";

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "10px 13px",
  fontSize: 14,
  fontFamily: "inherit",
  border: "1px solid #D8E6EE",
  borderRadius: 4,
  background: "#FFFFFF",
  color: "#0F1F2B",
  outline: "none",
  transition: "border-color 0.15s",
  boxSizing: "border-box",
};

function PasswordField({
  label, id, value, onChange, placeholder, showLabel, hideLabel,
}: {
  label: string; id: string; value: string;
  onChange: (v: string) => void; placeholder?: string; showLabel: string; hideLabel: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <div style={{ marginBottom: 16 }}>
      <label htmlFor={id} style={{ display: "block", fontSize: 12, fontWeight: 500, color: "#4A6070", marginBottom: 6, letterSpacing: "0.01em" }}>
        {label}
      </label>
      <div style={{ position: "relative" }}>
        <input
          id={id}
          type={show ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          required
          style={{ ...inputStyle, paddingRight: 40 }}
          onFocus={(e) => { e.target.style.borderColor = "#1872A5"; e.target.style.boxShadow = "0 0 0 3px rgba(24,114,165,0.08)"; }}
          onBlur={(e) => { e.target.style.borderColor = "#D8E6EE"; e.target.style.boxShadow = "none"; }}
        />
        <button
          type="button"
          tabIndex={-1}
          onClick={() => setShow(v => !v)}
          aria-label={show ? hideLabel : showLabel}
          style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", padding: 0, display: "flex", alignItems: "center", color: "#8AABB8" }}
        >
          {show ? <EyeOff size={17} /> : <Eye size={17} />}
        </button>
      </div>
    </div>
  );
}

export default function ResetPasswordToken() {
  const { locale } = useLanguage();
  const copy = publicPageMessages[locale];
  const [, navigate] = useLocation();
  const token = new URLSearchParams(window.location.search).get("token") ?? "";

  const [novaSenha, setNovaSenha] = useState("");
  const [confirmSenha, setConfirmSenha] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!token) navigate("/forgot-password");
  }, [token, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    if (novaSenha !== confirmSenha) { setErr(copy.passwordsMismatch); return; }
    if (novaSenha.length < 8) { setErr(copy.passwordMin8Error); return; }
    setLoading(true);
    try {
      const res = await fetch("/api/auth/reset-password-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, novaSenha }),
      });
      if (!res.ok) { setErr(copy.resetError); return; }
      setDone(true);
    } catch {
      setErr(copy.connectionTryAgain);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="grid lg:grid-cols-2 grid-cols-1" style={{ minHeight: "100vh", fontFamily: "'DM Sans', sans-serif" }}>
      <div style={{ background: "#0B1F4B", padding: "48px 52px", flexDirection: "column", justifyContent: "space-between" }} className="hidden lg:flex">
        <div style={{ display: "flex", justifyContent: "center", alignItems: "center" }}>
          <img src={`${(import.meta as any).env?.BASE_URL ?? "/"}logo-docregen-white.png`} alt="DocRegen" style={{ width: "80%", height: "auto", objectFit: "contain" }} />
        </div>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", padding: "40px 0" }}>
          <h1 style={{ fontSize: 26, fontWeight: 400, color: "#D0E8F5", lineHeight: 1.3, letterSpacing: "-0.3px", marginBottom: 12 }}>{copy.resetHeading}</h1>
          <p style={{ fontSize: 14, color: "#5A8AA8", lineHeight: 1.65, maxWidth: 320 }}>
            {copy.createSecurePassword}
          </p>
        </div>
        <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, color: "#2A5070", letterSpacing: "0.04em" }}>DocRegen v2.0</div>
      </div>

      <div className="flex items-start lg:items-center justify-center px-5 py-10 lg:px-12 lg:py-12" style={{ background: "#FFFFFF", borderLeft: "1px solid #D8E6EE" }}>
        <div style={{ width: "100%", maxWidth: 420 }}>
          <div className="flex justify-end mb-4"><PublicLanguageSelector /></div>
          <div style={{ marginBottom: 32 }}>
            <img src={`${(import.meta as any).env?.BASE_URL ?? "/"}logo-docregen.png`} alt="DocRegen" style={{ height: 52, width: "auto", objectFit: "contain" }} />
          </div>

          {done ? (
            <div style={{ textAlign: "center" }}>
              <div style={{ width: 56, height: 56, borderRadius: "50%", background: "#D1FAE5", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 20px" }}>
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#059669" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
              </div>
              <h2 style={{ fontSize: 22, fontWeight: 500, color: "#0F1F2B", marginBottom: 8, letterSpacing: "-0.3px" }}>{copy.passwordReset}</h2>
              <p style={{ fontSize: 13, color: "#4A6070", marginBottom: 28 }}>{copy.passwordResetDescription}</p>
              <Link href="/login" style={{ display: "block", padding: "11px", background: "#0B2A3E", color: "#D0E8F5", borderRadius: 4, fontSize: 14, fontWeight: 500, textDecoration: "none", textAlign: "center" }}>
                {copy.goToLogin}
              </Link>
            </div>
          ) : (
            <>
              <h2 style={{ fontSize: 22, fontWeight: 500, color: "#0F1F2B", marginBottom: 5, letterSpacing: "-0.3px" }}>{copy.createNewPassword}</h2>
              <p style={{ fontSize: 13, color: "#4A6070", marginBottom: 28 }}>{copy.passwordMin8Help}</p>

              {err && (
                <div style={{ marginBottom: 16, padding: "10px 14px", background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: 4, fontSize: 13, color: "#dc2626" }}>{err}</div>
              )}

              <form onSubmit={handleSubmit}>
                <PasswordField label={copy.newPassword} id="nova" value={novaSenha} onChange={setNovaSenha} placeholder={copy.min8Placeholder} showLabel={copy.showPassword} hideLabel={copy.hidePassword} />
                <PasswordField label={copy.repeatNewPassword} id="confirm" value={confirmSenha} onChange={setConfirmSenha} placeholder={copy.repeatPasswordPlaceholder} showLabel={copy.showPassword} hideLabel={copy.hidePassword} />

                <button
                  type="submit"
                  disabled={loading}
                  style={{ width: "100%", padding: 11, background: loading ? "#4A6070" : "#0B2A3E", color: "#D0E8F5", border: "none", borderRadius: 4, fontSize: 14, fontFamily: "inherit", fontWeight: 500, cursor: loading ? "not-allowed" : "pointer", marginBottom: 20 }}
                >
                  {loading ? copy.saving : copy.saveNewPassword}
                </button>
              </form>

              <div style={{ borderTop: "1px solid #EEF4F8", paddingTop: 20, textAlign: "center" }}>
                <Link href="/login" style={{ fontSize: 13, color: "#4A6070", textDecoration: "none" }}>{copy.rememberedPassword}</Link>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
