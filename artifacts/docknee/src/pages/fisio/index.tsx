import { useState, useEffect } from "react";
import { useLocation, useSearch } from "wouter";
import { usePhysioAuth } from "@/lib/physio-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { useTheme } from "@/lib/theme";
import { Eye, EyeOff, Activity, Users, CalendarDays, FileText, Crown, Sparkles, ArrowRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useLanguage, useScopedTranslations } from "@/lib/i18n";
import { physioMessages } from "@/locales/physio";

interface FisioPlan {
  productId: string;
  productName: string;
  priceId: string;
  unitAmount: number;
  currency: string;
  interval: string;
  priceMetadata: Record<string, string> | null;
}

export default function FisioLanding() {
  const [, navigate] = useLocation();
  const search = useSearch();
  const { login } = usePhysioAuth();
  const { theme } = useTheme();
  const { formatCurrency } = useLanguage();
  const t = useScopedTranslations(physioMessages);
  const formatBRL = (cents: number) => formatCurrency(cents / 100, "BRL");
  const [step, setStep] = useState<"register" | "plans">("register");
  const [form, setForm] = useState({ nome: "", celular: "", email: "", senha: "", crefito: "", cpf: "", clinica: "", cidade: "" });
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Plan picker state
  const [plans, setPlans] = useState<FisioPlan[]>([]);
  const [plansLoading, setPlansLoading] = useState(false);
  const [selectedPriceId, setSelectedPriceId] = useState("");
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  // physioToken removed — session is managed via HttpOnly cookie

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }));

  // Fetch plans once we reach step 2
  useEffect(() => {
    if (step !== "plans") return;
    setPlansLoading(true);
    fetch("/api/physio/billing/plans", {
      credentials: "same-origin",
    })
      .then(r => r.json())
      .then((res: { plans?: FisioPlan[]; freeLimit?: number }) => {
        const list = Array.isArray(res.plans) ? res.plans : [];
        setPlans(list);
        const monthly = list.find(p => p.interval === "month");
        setSelectedPriceId((monthly ?? list[0])?.priceId ?? "");
      })
      .catch(() => setPlans([]))
      .finally(() => setPlansLoading(false));
  }, [step]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!form.nome || !form.celular || !form.email || !form.senha || !form.crefito || !form.cpf) {
      setError(t("requiredFields"));
      return;
    }
    if (form.senha.length < 6) {
      setError(t("passwordMinimum"));
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/physio-auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? t("accountError"));
        return;
      }
      // Log in and proceed
      login(data.physio);
      // Check for invite token
      const params = new URLSearchParams(search);
      const inviteToken = params.get("convite");
      if (inviteToken) {
        navigate(`/fisio/convite/${inviteToken}`);
        return;
      }
      // Show plan picker
      setStep("plans");
    } catch {
      setError(t("connectionError"));
    } finally {
      setLoading(false);
    }
  };

  const handleCheckout = async () => {
    if (!selectedPriceId) return;
    setCheckoutLoading(true);
    try {
      const res = await fetch("/api/physio/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ priceId: selectedPriceId }),
      });
      const data = await res.json();
      if (!res.ok || !data.url) {
        setError(data.error ?? t("connectionError"));
        setStep("register"); // fallback
        return;
      }
      window.location.href = data.url;
    } catch {
      setError(t("connectionError"));
    } finally {
      setCheckoutLoading(false);
    }
  };

  const handleSkipPlan = () => {
    navigate("/fisio/dashboard");
  };

  const features = [
    { Icon: Users, title: t("completeRecord"), desc: t("recordFeature") },
    { Icon: Activity, title: t("kneeProtocols"), desc: t("protocolFeature") },
    { Icon: CalendarDays, title: t("integratedSchedule"), desc: t("scheduleFeature") },
    { Icon: FileText, title: t("surgeonConnection"), desc: t("surgeonFeature") },
  ];

  const monthly = plans.find(p => p.interval === "month");
  const yearly = plans.find(p => p.interval === "year");

  // ── Step 2: Plan picker ─────────────────────────────────────────────────────
  if (step === "plans") {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center px-4 py-8">
        <div className="w-full max-w-xl space-y-6">
          {/* Header */}
          <div className="flex flex-col items-center gap-3 text-center">
            <img
              src={`${import.meta.env.BASE_URL}${theme === "dark" ? "logo-docsholder-white.png" : "logo-docsholder.png"}`}
              alt="DocSholder"
              className="h-10 w-auto object-contain"
            />
            <div>
              <h1 className="text-xl font-bold text-foreground">{t("choosePlan")}</h1>
              <p className="text-sm text-muted-foreground mt-1">
                {t("firstPatientsFree")}
              </p>
            </div>
          </div>

          {plansLoading ? (
            <div className="grid sm:grid-cols-2 gap-4">
              {[0, 1].map(i => (
                <div key={i} className="rounded-xl border border-border bg-card p-5 animate-pulse h-52" />
              ))}
            </div>
          ) : plans.length === 0 ? (
            <Card>
              <CardContent className="py-6 text-center text-sm text-muted-foreground">
                {t("plansUnavailable")}
              </CardContent>
            </Card>
          ) : (
            <div className="grid sm:grid-cols-2 gap-4">
              {/* Monthly */}
              {monthly && (
                <button
                  type="button"
                  onClick={() => setSelectedPriceId(monthly.priceId)}
                  className={`rounded-xl border-2 p-5 text-left transition-all focus:outline-none ${
                    selectedPriceId === monthly.priceId
                      ? "border-[#1FB6E1] bg-[#1FB6E1]/5"
                      : "border-border bg-card hover:border-[#1FB6E1]/50"
                  }`}
                >
                  <div className="flex items-center gap-2 mb-3">
                    <Sparkles className="h-4 w-4 text-[#1FB6E1]" />
                    <span className="text-sm font-semibold text-foreground">{t("monthly")}</span>
                    <Badge variant="secondary" className="ml-auto text-xs">{t("mostPopular")}</Badge>
                  </div>
                  <p className="text-2xl font-bold text-foreground">
                    {formatBRL(monthly.unitAmount)}
                    <span className="text-sm font-normal text-muted-foreground">{t("perMonth")}</span>
                  </p>
                  <ul className="mt-3 text-xs text-muted-foreground space-y-1.5">
                     <li>✓ {t("unlimitedPatients")}</li>
                     <li>✓ {t("completeRecordPdf")}</li>
                     <li>✓ {t("scheduleAndProtocols")}</li>
                     <li>✓ {t("freeTrial")}</li>
                  </ul>
                </button>
              )}

              {/* Yearly */}
              {yearly && (
                <button
                  type="button"
                  onClick={() => setSelectedPriceId(yearly.priceId)}
                  className={`rounded-xl border-2 p-5 text-left transition-all focus:outline-none ${
                    selectedPriceId === yearly.priceId
                      ? "border-[#1FB6E1] bg-[#1FB6E1]/5"
                      : "border-border bg-card hover:border-[#1FB6E1]/50"
                  }`}
                >
                  <div className="flex items-center gap-2 mb-3">
                    <Crown className="h-4 w-4 text-[#1FB6E1]" />
                    <span className="text-sm font-semibold text-foreground">{t("yearly")}</span>
                    <Badge className="ml-auto text-xs bg-[#1FB6E1] text-white hover:bg-[#1FB6E1]">{t("monthsFree")}</Badge>
                  </div>
                  <p className="text-2xl font-bold text-foreground">
                    {formatBRL(yearly.unitAmount)}
                    <span className="text-sm font-normal text-muted-foreground">{t("perYear")}</span>
                  </p>
                  <ul className="mt-3 text-xs text-muted-foreground space-y-1.5">
                    <li>✓ {t("allMonthlyFeatures")}</li>
                    <li>✓ {t("effectiveMonthly", { amount: formatBRL(yearly.unitAmount / 12) })}</li>
                    <li>✓ {t("yearlySavings", { amount: formatBRL(monthly ? monthly.unitAmount * 12 - yearly.unitAmount : 0) })}</li>
                    <li>✓ {t("freeTrial")}</li>
                  </ul>
                </button>
              )}
            </div>
          )}

          {error && <p className="text-sm text-destructive font-medium text-center">{error}</p>}

          {/* Actions */}
          <div className="space-y-3">
            <Button
              className="w-full gap-2"
              size="lg"
              disabled={!selectedPriceId || checkoutLoading || plansLoading}
              onClick={handleCheckout}
            >
               {checkoutLoading ? t("openPayment") : t("continuePayment")}
              {!checkoutLoading && <ArrowRight className="h-4 w-4" />}
            </Button>
            <Button
              variant="ghost"
              className="w-full text-muted-foreground"
              onClick={handleSkipPlan}
              disabled={checkoutLoading}
            >
               {t("startFree")}
            </Button>
          </div>

          <p className="text-center text-xs text-muted-foreground">
             {t("cancelAnytime")}
          </p>
        </div>
      </div>
    );
  }

  // ── Step 1: Registration form ───────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-5xl mx-auto px-4 py-8 md:py-14">
        <div className="flex flex-col items-center gap-3 mb-8">
          <img
            src={`${import.meta.env.BASE_URL}${theme === "dark" ? "logo-docsholder-white.png" : "logo-docsholder.png"}`}
            alt="DocSholder"
            className="h-10 w-auto object-contain"
          />
          <span className="text-xs font-semibold uppercase tracking-widest" style={{ color: "#1FB6E1" }}>
             {t("portal")}
          </span>
        </div>

        <div className="grid md:grid-cols-2 gap-8 md:gap-12 items-start">
          {/* Pitch */}
          <div className="space-y-6">
            <div>
              <h1 className="text-3xl md:text-4xl font-bold text-foreground leading-tight">
                 {t("kneeRehabilitation")}
              </h1>
              <p className="mt-3 text-muted-foreground">
                 {t("landingDescription")}
              </p>
              <div
                className="mt-4 inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold"
                style={{ background: "rgba(16,185,129,0.1)", color: "#059669", border: "1px solid rgba(16,185,129,0.3)" }}
              >
                 ✓ {t("firstPatientsFree")}
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {features.map(({ Icon, title, desc }) => (
                <div key={title} className="rounded-xl border border-border bg-card p-4">
                  <Icon className="h-5 w-5 mb-2" style={{ color: "#1FB6E1" }} />
                  <p className="text-sm font-semibold text-foreground">{title}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{desc}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Register form */}
          <Card className="shadow-md">
            <CardContent className="pt-6">
               <h2 className="text-lg font-bold text-foreground mb-1">{t("createFreeAccount")}</h2>
               <p className="text-xs text-muted-foreground mb-4">{t("underMinute")}</p>
              <form onSubmit={handleSubmit} className="space-y-3">
                <div className="space-y-1.5">
                   <Label htmlFor="nome">{t("fullName")}</Label>
                   <Input id="nome" placeholder={t("yourName")} value={form.nome} onChange={set("nome")} required />
                </div>
                <div className="space-y-1.5">
                   <Label htmlFor="celular">{t("mobile")}</Label>
                  <Input id="celular" placeholder="(11) 99999-9999" value={form.celular} onChange={set("celular")} required />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="email">E-mail *</Label>
                  <Input id="email" type="email" placeholder="voce@email.com" value={form.email} onChange={set("email")} required autoComplete="email" />
                </div>
                <div className="space-y-1.5">
                   <Label htmlFor="senha">{t("passwordHint")}</Label>
                  <div className="relative">
                    <Input
                      id="senha"
                      type={showPassword ? "text" : "password"}
                      placeholder="••••••••"
                      value={form.senha}
                      onChange={set("senha")}
                      required
                      className="pr-10"
                      autoComplete="new-password"
                    />
                    <button
                      type="button"
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                      onClick={() => setShowPassword(v => !v)}
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="crefito">CREFITO *</Label>
                    <Input id="crefito" placeholder="Ex: 123456-F" value={form.crefito} onChange={set("crefito")} required />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="cpf">CPF *</Label>
                    <Input id="cpf" placeholder="000.000.000-00" value={form.cpf} onChange={set("cpf")} required />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1.5">
                     <Label htmlFor="cidade">{t("city")}</Label>
                     <Input id="cidade" placeholder={t("optional")} value={form.cidade} onChange={set("cidade")} />
                  </div>
                  <div className="space-y-1.5">
                     <Label htmlFor="clinica">{t("clinic")}</Label>
                     <Input id="clinica" placeholder={t("optional")} value={form.clinica} onChange={set("clinica")} />
                  </div>
                </div>

                {error && <p className="text-sm text-destructive font-medium">{error}</p>}

                <Button type="submit" className="w-full" disabled={loading}>
                   {loading ? t("creatingAccount") : t("createFreeAccount")}
                </Button>
              </form>
              <p className="text-center text-xs text-muted-foreground mt-4">
                 {t("alreadyAccount")}{" "}
                 <button onClick={() => navigate(`/fisio/login${search ? `?${search}` : ""}`)} className="underline text-primary font-medium">{t("signIn")}</button>
              </p>
            </CardContent>
          </Card>
        </div>

        <p className="text-center text-xs text-muted-foreground mt-10">
           {t("doctorQuestion")}{" "}
           <button onClick={() => navigate("/login")} className="underline text-primary font-medium">{t("doctorPortal")}</button>
        </p>
      </div>
    </div>
  );
}
