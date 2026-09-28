import { useAuth } from "@/lib/auth";
import { useState, useEffect, useRef } from "react";
import { Link } from "wouter";
import { SUPPORT_WHATSAPP_URL } from "@/lib/support-contact";
import { useToast } from "@/hooks/use-toast";
import { Eye, EyeOff, X, ArrowLeft } from "lucide-react";
import { getAnalyticsSessionHeaders } from "@/lib/analytics";
import type { Doctor } from "@workspace/api-client-react";
import { useLanguage } from "@/lib/i18n";
import { publicPageMessages } from "@/locales/public-pages";
import { PublicLanguageSelector } from "@/components/public-language-selector";

// ── Shared input style helpers ─────────────────────────────────────────────────

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "12px 13px",
  fontSize: 16,
  fontFamily: "inherit",
  border: "1px solid #D8E6EE",
  borderRadius: 6,
  background: "#FFFFFF",
  color: "#0F1F2B",
  outline: "none",
  transition: "border-color 0.15s",
  boxSizing: "border-box",
  WebkitAppearance: "none",
};

function focusIn(e: React.FocusEvent<HTMLInputElement>) {
  e.target.style.borderColor = "#1872A5";
  e.target.style.boxShadow = "0 0 0 3px rgba(24,114,165,0.08)";
}
function focusOut(e: React.FocusEvent<HTMLInputElement>) {
  e.target.style.borderColor = "#D8E6EE";
  e.target.style.boxShadow = "none";
}

// ── Main login page ────────────────────────────────────────────────────────────

export default function Login() {
  const { locale } = useLanguage();
  const copy = publicPageMessages[locale];
  const [identificador, setIdentificador] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isPending, setIsPending] = useState(false);
  const loginInFlightRef = useRef(false);
  const [contactEmail, setContactEmail] = useState("");
  const { login } = useAuth();
  const { toast } = useToast();

  const [contactOpen, setContactOpen] = useState(false);
  const [contactNome, setContactNome] = useState("");
  const [contactCelular, setContactCelular] = useState("");
  const [contactMensagem, setContactMensagem] = useState("");
  const [contactSending, setContactSending] = useState(false);

  const handleContactSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setContactSending(true);
    try {
      const res = await fetch("/api/auth/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getAnalyticsSessionHeaders() },
        body: JSON.stringify({ nome: contactNome, celular: contactCelular, mensagem: contactMensagem }),
      });
      if (!res.ok) {
        toast({ title: copy.contactSendError, description: copy.tryAgain, variant: "destructive" });
        return;
      }
      toast({ title: copy.contactSent, description: copy.contactSentDescription });
      setContactOpen(false);
      setContactNome("");
      setContactCelular("");
      setContactMensagem("");
    } catch {
      toast({ title: copy.connectionError, variant: "destructive" });
    } finally {
      setContactSending(false);
    }
  };

  useEffect(() => {
    fetch("/api/auth/config")
      .then(r => r.json())
      .then(d => { if (d.contactEmail) setContactEmail(d.contactEmail); })
      .catch(() => {});
  }, []);

  const completeAuthenticatedLogin = async (doctorFromLogin: Doctor) => {
    let confirmedDoctor: Doctor | null = null;

    // Confirm that the cookie issued by /auth/login is already usable before
    // entering a protected route. This avoids a mobile race in which the
    // dashboard briefly opens without a hydrated session and redirects back to
    // a freshly-mounted, empty login form.
    for (let attempt = 0; attempt < 2 && !confirmedDoctor; attempt += 1) {
      if (attempt > 0) {
        await new Promise(resolve => window.setTimeout(resolve, 150));
      }

      const sessionRes = await fetch("/api/auth/me", {
        method: "GET",
        credentials: "same-origin",
        cache: "no-store",
        headers: { Accept: "application/json" },
      });

      if (sessionRes.ok && sessionRes.status !== 204) {
        const sessionDoctor = await sessionRes.json() as Doctor;
        if (sessionDoctor?.id === doctorFromLogin.id) {
          confirmedDoctor = sessionDoctor;
        }
      }
    }

    if (!confirmedDoctor) {
      toast({
        title: copy.sessionNotOpened,
        description: copy.sessionRetry,
        variant: "destructive",
      });
      return;
    }

    login(confirmedDoctor);

    // Reload the protected app from the confirmed cookie instead of depending
    // on the timing of the login page's React state update.
    const basePath = import.meta.env.BASE_URL.endsWith("/")
      ? import.meta.env.BASE_URL
      : `${import.meta.env.BASE_URL}/`;
    const destination = confirmedDoctor.isAdmin ? "admin" : "dashboard";
    window.location.replace(`${basePath}${destination}`);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loginInFlightRef.current) return;

    loginInFlightRef.current = true;
    setIsPending(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: identificador.trim(), senha: password }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast({
          title: copy.loginError,
          description: copy.invalidCredentials,
          variant: "destructive",
        });
        return;
      }

      await completeAuthenticatedLogin(data.doctor);
    } catch {
      toast({ title: copy.connectionError, variant: "destructive" });
    } finally {
      loginInFlightRef.current = false;
      setIsPending(false);
    }
  };

  return (
    <div
      style={{ fontFamily: "'DM Sans', sans-serif", minHeight: "100vh" }}
      className="flex flex-col lg:grid lg:grid-cols-2"
    >
      {/* ── Mobile header (hidden on desktop) ── */}
      <div
        className="lg:hidden flex flex-col items-center justify-center py-10 px-6"
        style={{ background: "#0A1828" }}
      >
        <div className="self-end mb-2"><PublicLanguageSelector dark /></div>
        <img
          src={`${import.meta.env.BASE_URL}logo-docknee-new.png?v=2`}
          alt="DocKnee"
          style={{ width: "55%", maxWidth: 200, height: "auto", objectFit: "contain" }}
        />
        <p style={{ color: "#5A8AA8", fontSize: 13, marginTop: 10, textAlign: "center", lineHeight: 1.5 }}>
          {copy.platformTagline}
        </p>
      </div>

      {/* ── Desktop left panel (hidden on mobile) ── */}
      <div
        style={{
          background: "#0A1828",
          padding: "48px 52px",
          flexDirection: "column",
          justifyContent: "space-between",
        }}
        className="hidden lg:flex"
      >
        <div style={{ display: "flex", justifyContent: "center", alignItems: "center" }}>
          <img
            src={`${import.meta.env.BASE_URL}logo-docknee-new.png?v=2`}
            alt="DocKnee"
            style={{ width: "80%", height: "auto", objectFit: "contain" }}
          />
        </div>

        <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", padding: "40px 0" }}>
          <h1 style={{
            fontSize: 26,
            fontWeight: 400,
            color: "#D0E8F5",
            lineHeight: 1.3,
            letterSpacing: "-0.3px",
            marginBottom: 12,
          }}>
            {copy.platformTagline}
          </h1>
          <p style={{
            fontSize: 14,
            color: "#5A8AA8",
            lineHeight: 1.65,
            marginBottom: 32,
            maxWidth: 320,
          }}>
            {copy.platformDescription}
          </p>

          {/* Bloco Cirurgia */}
          <div style={{ marginBottom: 28 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {[
                copy.surgeryFeature1,
                copy.surgeryFeature2,
                copy.surgeryFeature3,
                copy.surgeryFeature4,
              ].map((feat) => (
                <div key={feat} style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                  <div style={{
                    width: 4, height: 4, borderRadius: "50%",
                    background: "#5AABDC", marginTop: 6, flexShrink: 0,
                  }} />
                  <span style={{ fontSize: 13, color: "#7AB8D4", lineHeight: 1.45 }}>{feat}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Divisor + bloco Regenerativo */}
          <div style={{ borderTop: "1px solid rgba(90,171,220,0.18)", paddingTop: 22 }}>
            <p style={{
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: "#3A8AAC",
              marginBottom: 12,
            }}>
               {copy.regenerativeLabel}
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {[
                 copy.regenerativeFeature1,
                 copy.regenerativeFeature2,
                 copy.regenerativeFeature3,
                 copy.regenerativeFeature4,
              ].map((feat) => (
                <div key={feat} style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                  <div style={{
                    width: 4, height: 4, borderRadius: "50%",
                    background: "#34C08A", marginTop: 6, flexShrink: 0,
                  }} />
                  <span style={{ fontSize: 13, color: "#6DC8A8", lineHeight: 1.45 }}>{feat}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div style={{
          fontFamily: "'DM Mono', monospace",
          fontSize: 10,
          color: "#2A5070",
          letterSpacing: "0.04em",
        }}>
          DocKnee v2.0
        </div>
      </div>

      {/* ── Form panel ── */}
      <div
        style={{ background: "#FFFFFF", borderLeft: "1px solid #D8E6EE" }}
        className="flex-1 flex items-center justify-center px-6 py-10 lg:px-[52px]"
      >
        <div style={{ width: "100%", maxWidth: 360 }}>
            <div className="hidden lg:flex justify-end mb-5"><PublicLanguageSelector /></div>
            <h2 style={{
              fontSize: 22,
              fontWeight: 500,
              color: "#0F1F2B",
              marginBottom: 5,
              letterSpacing: "-0.3px",
            }}>
              {copy.loginTitle}
            </h2>
            <p style={{ fontSize: 13, color: "#4A6070", marginBottom: 32 }}>
              {copy.loginSubtitle}
            </p>

            <form onSubmit={handleSubmit}>
              <div style={{ marginBottom: 16 }}>
                <label
                  htmlFor="identificador"
                  style={{ display: "block", fontSize: 12, fontWeight: 500, color: "#4A6070", marginBottom: 6, letterSpacing: "0.01em" }}
                >
                  {copy.emailOrCpf}
                </label>
                <input
                  id="identificador"
                  type="text"
                  placeholder="seu@email.com"
                  value={identificador}
                  onChange={(e) => setIdentificador(e.target.value)}
                  required
                  autoComplete="username"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  style={inputStyle}
                  onFocus={focusIn}
                  onBlur={focusOut}
                />
              </div>

              <div style={{ marginBottom: 8 }}>
                <label
                  htmlFor="password"
                  style={{ display: "block", fontSize: 12, fontWeight: 500, color: "#4A6070", marginBottom: 6, letterSpacing: "0.01em" }}
                >
                  {copy.password}
                </label>
                <div style={{ position: "relative" }}>
                  <input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    placeholder="••••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    autoComplete="current-password"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    style={{ ...inputStyle, padding: "12px 42px 12px 13px" }}
                    onFocus={focusIn}
                    onBlur={focusOut}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(v => !v)}
                    style={{
                      position: "absolute",
                      right: 12,
                      top: "50%",
                      transform: "translateY(-50%)",
                      background: "none",
                      border: "none",
                      cursor: "pointer",
                      padding: 0,
                      display: "flex",
                      alignItems: "center",
                      color: "#8AABB8",
                    }}
                    tabIndex={-1}
                    aria-label={showPassword ? copy.hidePassword : copy.showPassword}
                  >
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 24 }}>
                <Link href="/forgot-password" style={{ fontSize: 12, color: "#1872A5", textDecoration: "none" }}>
                  {copy.forgotPassword}
                </Link>
              </div>

              <button
                type="submit"
                disabled={isPending}
                style={{
                  width: "100%",
                  padding: "13px",
                  background: isPending ? "#4A6070" : "#0A1828",
                  color: "#D0E8F5",
                  border: "none",
                  borderRadius: 6,
                  fontSize: 15,
                  fontFamily: "inherit",
                  fontWeight: 500,
                  cursor: isPending ? "not-allowed" : "pointer",
                  transition: "background 0.15s",
                  marginBottom: 20,
                  letterSpacing: "-0.1px",
                }}
              >
                {isPending ? copy.signingIn : copy.login}
              </button>
            </form>

            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
              <div style={{ flex: 1, height: 1, background: "#D8E6EE" }} />
              <span style={{ fontSize: 11, color: "#8AABB8" }}>{copy.or}</span>
              <div style={{ flex: 1, height: 1, background: "#D8E6EE" }} />
            </div>

            <p style={{ textAlign: "center", fontSize: 14, color: "#4A6070" }}>
              {copy.noAccount}{" "}
              <Link href="/register" style={{ color: "#1872A5", textDecoration: "none", fontWeight: 500 }}>
                {copy.register}
              </Link>
            </p>

            <p style={{ textAlign: "center", fontSize: 13, color: "#8AABB8" }}>
              {copy.secretaryPrompt}{" "}
              <Link href="/secretary/login" style={{ color: "#1872A5", textDecoration: "none", fontWeight: 600 }}>
                {copy.accessHere}
              </Link>
            </p>

            <p style={{ textAlign: "center", fontSize: 13, color: "#8AABB8" }}>
              {copy.servicePrompt}{" "}
              <Link href="/service/login" style={{ color: "#1872A5", textDecoration: "none", fontWeight: 600 }}>
                {copy.accessHere}
              </Link>
            </p>

            {/* Contact / support */}
            <div style={{ marginTop: 24, borderTop: "1px solid #EEF4F8", paddingTop: 18, textAlign: "center" }}>
              <p style={{ fontSize: 12, color: "#8AABB8", margin: "0 0 6px" }}>
                {copy.supportPrompt}{" "}
                <button
                  type="button"
                  onClick={() => setContactOpen(true)}
                  style={{ color: "#1872A5", background: "none", border: "none", padding: 0, cursor: "pointer", fontSize: 12, fontWeight: 600, textDecoration: "underline" }}
                >
                  {copy.clickHere}
                </button>
              </p>
              <a
                 href={SUPPORT_WHATSAPP_URL}
                target="_blank"
                rel="noopener noreferrer"
                style={{ fontSize: 12, color: "#25D366", textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 5 }}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="#25D366"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/><path d="M12 0C5.373 0 0 5.373 0 12c0 2.126.553 4.122 1.523 5.855L.057 23.25a.75.75 0 00.917.912l5.49-1.437A11.944 11.944 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 21.75a9.717 9.717 0 01-4.99-1.377l-.358-.214-3.713.972.99-3.614-.234-.372A9.718 9.718 0 012.25 12C2.25 6.615 6.615 2.25 12 2.25S21.75 6.615 21.75 12 17.385 21.75 12 21.75z"/></svg>
                WhatsApp: (28) 3199-2105
              </a>
            </div>

            {/* Contact form modal */}
            {contactOpen && (
              <div
                style={{ position: "fixed", inset: 0, zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.45)" }}
                onClick={e => { if (e.target === e.currentTarget) setContactOpen(false); }}
              >
                <div style={{ background: "#fff", borderRadius: 16, padding: "28px 28px 24px", width: "100%", maxWidth: 420, boxShadow: "0 8px 40px rgba(0,0,0,0.18)", position: "relative" }}>
                  <button
                    type="button"
                    onClick={() => setContactOpen(false)}
                    style={{ position: "absolute", top: 14, right: 14, background: "none", border: "none", cursor: "pointer", color: "#8AABB8", padding: 4 }}
                    aria-label={copy.close}
                  >
                    <X size={18} />
                  </button>
                  <h2 style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 17, fontWeight: 700, color: "#0A1828", marginBottom: 4 }}>{copy.contactUs}</h2>
                  <p style={{ fontSize: 13, color: "#8AABB8", marginBottom: 20 }}>{copy.contactDescription}</p>
                  <form onSubmit={handleContactSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                    <div>
                      <label style={{ fontSize: 12, fontWeight: 600, color: "#3A5A70", display: "block", marginBottom: 4 }}>{copy.nameRequired}</label>
                      <input
                        required
                        value={contactNome}
                        onChange={e => setContactNome(e.target.value)}
                        placeholder={copy.fullNamePlaceholder}
                        style={{ width: "100%", border: "1px solid #D1E4EF", borderRadius: 8, padding: "9px 12px", fontSize: 14, outline: "none", boxSizing: "border-box" }}
                      />
                    </div>
                    <div>
                      <label style={{ fontSize: 12, fontWeight: 600, color: "#3A5A70", display: "block", marginBottom: 4 }}>{copy.phone}</label>
                      <input
                        value={contactCelular}
                        onChange={e => setContactCelular(e.target.value)}
                        placeholder="(11) 99999-9999"
                        type="tel"
                        style={{ width: "100%", border: "1px solid #D1E4EF", borderRadius: 8, padding: "9px 12px", fontSize: 14, outline: "none", boxSizing: "border-box" }}
                      />
                    </div>
                    <div>
                      <label style={{ fontSize: 12, fontWeight: 600, color: "#3A5A70", display: "block", marginBottom: 4 }}>{copy.messageRequired}</label>
                      <textarea
                        required
                        value={contactMensagem}
                        onChange={e => setContactMensagem(e.target.value)}
                        placeholder={copy.supportMessagePlaceholder}
                        rows={4}
                        style={{ width: "100%", border: "1px solid #D1E4EF", borderRadius: 8, padding: "9px 12px", fontSize: 14, outline: "none", resize: "vertical", boxSizing: "border-box" }}
                      />
                    </div>
                    <button
                      type="submit"
                      disabled={contactSending}
                      style={{ background: "#1872A5", color: "#fff", border: "none", borderRadius: 10, padding: "11px 0", fontSize: 14, fontWeight: 700, cursor: contactSending ? "not-allowed" : "pointer", opacity: contactSending ? 0.7 : 1, marginTop: 2 }}
                    >
                      {contactSending ? copy.sending : copy.sendMessage}
                    </button>
                  </form>
                </div>
              </div>
            )}

            {/* Mobile version label */}
            <p className="lg:hidden mt-4 text-center" style={{ fontSize: 10, color: "#C0D4DE", fontFamily: "'DM Mono', monospace", letterSpacing: "0.04em" }}>
              DocKnee v2.0
            </p>
        </div>
      </div>
    </div>
  );
}
