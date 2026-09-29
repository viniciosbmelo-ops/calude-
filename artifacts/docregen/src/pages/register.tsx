import { useState, useEffect } from "react";
import { useLocation, Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Eye, EyeOff, Check, CreditCard, Shield, FileText, Brain, Activity } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { useRegisterDoctor } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { getAnalyticsSessionHeaders } from "@/lib/analytics";
import { useLanguage } from "@/lib/i18n";
import { publicPageMessages } from "@/locales/public-pages";
import { PublicLanguageSelector } from "@/components/public-language-selector";

const ESTADOS_BR: { uf: string; nome: string }[] = [
  { uf: "AC", nome: "Acre" },
  { uf: "AL", nome: "Alagoas" },
  { uf: "AM", nome: "Amazonas" },
  { uf: "AP", nome: "Amapá" },
  { uf: "BA", nome: "Bahia" },
  { uf: "CE", nome: "Ceará" },
  { uf: "DF", nome: "Distrito Federal" },
  { uf: "ES", nome: "Espírito Santo" },
  { uf: "GO", nome: "Goiás" },
  { uf: "MA", nome: "Maranhão" },
  { uf: "MG", nome: "Minas Gerais" },
  { uf: "MS", nome: "Mato Grosso do Sul" },
  { uf: "MT", nome: "Mato Grosso" },
  { uf: "PA", nome: "Pará" },
  { uf: "PB", nome: "Paraíba" },
  { uf: "PE", nome: "Pernambuco" },
  { uf: "PI", nome: "Piauí" },
  { uf: "PR", nome: "Paraná" },
  { uf: "RJ", nome: "Rio de Janeiro" },
  { uf: "RN", nome: "Rio Grande do Norte" },
  { uf: "RO", nome: "Rondônia" },
  { uf: "RR", nome: "Roraima" },
  { uf: "RS", nome: "Rio Grande do Sul" },
  { uf: "SC", nome: "Santa Catarina" },
  { uf: "SE", nome: "Sergipe" },
  { uf: "SP", nome: "São Paulo" },
  { uf: "TO", nome: "Tocantins" },
];

function formatCpf(v: string) {
  const d = v.replace(/\D/g, "").slice(0, 11);
  if (d.length <= 3) return d;
  if (d.length <= 6) return `${d.slice(0, 3)}.${d.slice(3)}`;
  if (d.length <= 9) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`;
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}

function formatPhone(v: string) {
  const d = v.replace(/\D/g, "").slice(0, 11);
  if (d.length <= 2) return d;
  if (d.length <= 7) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

function formatCep(v: string) {
  const d = v.replace(/\D/g, "").slice(0, 8);
  return d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d;
}

type StripePlan = {
  product_id: string;
  product_name: string;
  product_description: string | null;
  product_metadata: Record<string, string> | null;
  price_id: string;
  unit_amount: number | null;
  currency: string;
  recurring: { interval?: string } | null;
  price_metadata: Record<string, string> | null;
};

export default function Register() {
  const { locale, formatNumber } = useLanguage();
  const copy = publicPageMessages[locale];
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { login } = useAuth();
  const registerMutation = useRegisterDoctor({
    request: { headers: getAnalyticsSessionHeaders() },
  });

  const [termsAccepted, setTermsAccepted] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const [plans, setPlans] = useState<StripePlan[]>([]);
  const [plansLoading, setPlansLoading] = useState(true);
  const [selectedPriceId, setSelectedPriceId] = useState<string>("");
  const [redirecting, setRedirecting] = useState(false);

  useEffect(() => {
    fetch("/api/stripe/products-with-prices")
      .then((r) => r.json())
      .then((res: { data?: StripePlan[] }) => {
        const list = Array.isArray(res.data) ? res.data : [];
        // Manter só 1 mensal e 1 anual (o de maior unit_amount de cada intervalo)
        const pick = (interval: string) =>
          list
            .filter((p) => p.recurring?.interval === interval)
            .sort((a, b) => (b.unit_amount ?? 0) - (a.unit_amount ?? 0))[0];
        const deduped = [pick("month"), pick("year")].filter(Boolean) as StripePlan[];
        setPlans(deduped);
        const monthly = deduped.find((p) => p.recurring?.interval === "month");
        setSelectedPriceId((monthly ?? deduped[0])?.price_id ?? "");
      })
      .catch(() => setPlans([]))
      .finally(() => setPlansLoading(false));
  }, []);

  const [estrangeiro, setEstrangeiro] = useState(false);
  const [paisOrigem, setPaisOrigem] = useState("");

  const [formData, setFormData] = useState({
    nome: "",
    email: "",
    senha: "",
    crm: "",
    crmEstado: "",
    cpf: "",
    telefone: "",
    endereco: "",
    cidade: "",
    estado: "",
    cep: "",
    especialidade: ""
  });

  const set = (k: keyof typeof formData, v: string) =>
    setFormData(f => ({ ...f, [k]: v }));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!estrangeiro && !formData.crmEstado) {
      toast({ title: copy.selectCrmState, variant: "destructive" });
      return;
    }
    if (estrangeiro && !paisOrigem.trim()) {
      toast({ title: copy.enterOriginCountry, variant: "destructive" });
      return;
    }
    if (formData.senha.length < 6) {
      toast({ title: copy.passwordMin6Error, variant: "destructive" });
      return;
    }
    if (!termsAccepted) {
      toast({ title: copy.acceptTermsError, variant: "destructive" });
      return;
    }

    registerMutation.mutate(
      {
        data: {
          nome: formData.nome,
          email: formData.email,
          senha: formData.senha,
          estrangeiro,
          paisOrigem: estrangeiro ? paisOrigem.trim() : undefined,
          crm: estrangeiro ? undefined : formData.crm,
          crmEstado: estrangeiro ? undefined : formData.crmEstado,
          cpf: estrangeiro ? undefined : formData.cpf.replace(/\D/g, ""),
          telefone: formData.telefone || undefined,
          endereco: formData.endereco || undefined,
          cidade: formData.cidade || undefined,
          estado: formData.estado || undefined,
          cep: formData.cep || undefined,
          especialidade: formData.especialidade || undefined,
        }
      },
      {
        onSuccess: async (data) => {
          login(data.doctor);
          // Grava o aceite dos termos no banco (prova jurídica LGPD)
          fetch("/api/lgpd/consentimento", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "same-origin",
            body: JSON.stringify({ aceito: true, tipo: "plataforma_docknee" }),
          }).catch(() => {/* falha silenciosa — não bloqueia o cadastro */});

          // Se um plano foi escolhido, leva ao checkout do Stripe
          if (selectedPriceId) {
            setRedirecting(true);
            try {
              const resp = await fetch("/api/stripe/checkout", {
                method: "POST",
                headers: { "Content-Type": "application/json", ...getAnalyticsSessionHeaders() },
                credentials: "same-origin",
                body: JSON.stringify({ priceId: selectedPriceId }),
              });
              const out = (await resp.json()) as { url?: string; error?: string };
              if (resp.ok && out.url) {
                window.location.href = out.url;
                return;
              }
               throw new Error(out.error || copy.paymentStartError);
            } catch {
              setRedirecting(false);
              toast({
                 title: copy.accountPaymentError,
                 description: copy.accountPaymentHelp,
                variant: "destructive",
              });
              setLocation("/dashboard");
            }
            return;
          }

           toast({ title: copy.registrationSuccess });
          setLocation("/dashboard");
        },
         onError: () => {
          toast({
             title: copy.accountCreateError,
             description: copy.checkData,
            variant: "destructive"
          });
        }
      }
    );
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 py-12 relative" style={{ background: "#f0f4f8" }}>
      <div className="absolute right-4 top-4"><PublicLanguageSelector /></div>
      <Card className="w-full max-w-2xl shadow-lg border-border/60 bg-white">
        <CardHeader className="space-y-2 text-center pb-6">
          <div className="flex justify-center mb-4">
            <img
              src={`${import.meta.env.BASE_URL}logo-docregen.png`}
              alt="DocRegen"
              className="h-14 w-auto object-contain"
            />
          </div>
          <CardTitle className="text-2xl font-bold tracking-tight" style={{ color: "#0B1F4B" }}>{copy.registrationTitle}</CardTitle>
          <CardDescription className="text-base">{copy.registrationSubtitle}</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

              {/* Nome */}
              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="nome">{copy.fullName}</Label>
                <Input id="nome" required value={formData.nome}
                  onChange={e => set("nome", e.target.value)}
                  placeholder={locale === "es" ? "Dr. Juan Pérez" : "Dr. João da Silva"} />
              </div>

              {/* Email */}
              <div className="space-y-2">
                <Label htmlFor="email">{copy.email}</Label>
                <Input id="email" type="email" required value={formData.email}
                  onChange={e => set("email", e.target.value.toLowerCase())}
                  placeholder="email@clinica.com.br" />
              </div>

              {/* Senha */}
              <div className="space-y-2">
                <Label htmlFor="senha">{copy.passwordMin6}</Label>
                <div className="relative">
                  <Input id="senha" type={showPassword ? "text" : "password"} required minLength={6} value={formData.senha}
                    onChange={e => set("senha", e.target.value)} className="pr-10" />
                  <button
                    type="button"
                    onClick={() => setShowPassword(v => !v)}
                    tabIndex={-1}
                    aria-label={showPassword ? copy.hidePassword : copy.showPassword}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                    style={{ background: "none", border: "none", cursor: "pointer", padding: 0, display: "flex", alignItems: "center" }}
                  >
                    {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                  </button>
                </div>
              </div>

              {/* Toggle médico estrangeiro */}
              <div className="md:col-span-2">
                <button
                  type="button"
                  onClick={() => { setEstrangeiro(v => !v); }}
                  className={`w-full flex items-center gap-3 rounded-lg border-2 px-4 py-3 text-left transition-colors ${estrangeiro ? "border-blue-400 bg-blue-50" : "border-border bg-muted/20 hover:bg-muted/40"}`}
                >
                  <span className="text-lg shrink-0">{estrangeiro ? "🌍" : "🇧🇷"}</span>
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-semibold ${estrangeiro ? "text-blue-800" : "text-foreground"}`}>
                      {estrangeiro ? copy.foreignDoctor : copy.brazilianDoctor}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {estrangeiro ? copy.foreignHelp : copy.brazilianHelp}
                    </p>
                  </div>
                  <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors ${estrangeiro ? "border-blue-500 bg-blue-500" : "border-muted-foreground"}`}>
                    {estrangeiro && <Check size={11} className="text-white" strokeWidth={3} />}
                  </div>
                </button>
              </div>

              {/* País de origem — somente para estrangeiros */}
              {estrangeiro && (
                <div className="space-y-2 md:col-span-2">
                   <Label htmlFor="paisOrigem">{copy.originCountry}</Label>
                  <Input
                    id="paisOrigem"
                    required={estrangeiro}
                    value={paisOrigem}
                    onChange={e => setPaisOrigem(e.target.value)}
                     placeholder={copy.originCountryPlaceholder}
                  />
                </div>
              )}

              {/* CRM — somente para brasileiros */}
              {!estrangeiro && (
                <div className="space-y-2">
                   <Label htmlFor="crm">{copy.crmNumber}</Label>
                  <Input id="crm" required={!estrangeiro} value={formData.crm}
                    onChange={e => set("crm", e.target.value.replace(/\D/g, ""))}
                    placeholder="123456"
                    maxLength={8}
                    inputMode="numeric" />
                </div>
              )}

              {/* CRM Estado — somente para brasileiros */}
              {!estrangeiro && (
                <div className="space-y-2">
                   <Label htmlFor="crmEstado">{copy.crmState}</Label>
                  <Input
                    id="crmEstado"
                    placeholder="Ex: SP"
                    maxLength={2}
                    value={formData.crmEstado}
                    onChange={e => set("crmEstado", e.target.value.toUpperCase().replace(/[^A-Z]/g, ""))}
                    className="font-mono uppercase w-24"
                  />
                  {formData.crm && formData.crmEstado && (
                    <p className="text-xs text-primary font-mono font-medium">
                      CRM {formData.crmEstado} {formData.crm}
                    </p>
                  )}
                </div>
              )}

              {/* CPF — somente para brasileiros */}
              {!estrangeiro && (
                <div className="space-y-2">
                  <Label htmlFor="cpf">CPF *</Label>
                  <Input id="cpf" required={!estrangeiro} value={formData.cpf}
                    onChange={e => set("cpf", formatCpf(e.target.value))}
                    placeholder="000.000.000-00"
                    maxLength={14}
                    inputMode="numeric" />
                </div>
              )}

              {/* Telefone */}
              <div className="space-y-2">
                 <Label htmlFor="telefone">{copy.phoneLabel}</Label>
                <Input id="telefone" value={formData.telefone}
                  onChange={e => set("telefone", formatPhone(e.target.value))}
                  placeholder="(11) 99999-9999"
                  maxLength={15}
                  inputMode="numeric" />
              </div>

              {/* Especialidade */}
              <div className="space-y-2 md:col-span-2">
                 <Label htmlFor="especialidade">{copy.specialty}</Label>
                <Input id="especialidade" value={formData.especialidade}
                  onChange={e => set("especialidade", e.target.value)}
                   placeholder={copy.specialtyPlaceholder} />
              </div>

              {/* Separador endereço */}
              <div className="md:col-span-2">
                 <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">{copy.optionalAddress}</p>
              </div>

              {/* Endereço */}
              <div className="space-y-2 md:col-span-2">
                 <Label htmlFor="endereco">{copy.street}</Label>
                <Input id="endereco" value={formData.endereco}
                  onChange={e => set("endereco", e.target.value)}
                   placeholder={copy.streetPlaceholder} />
              </div>

              {/* CEP */}
              <div className="space-y-2">
                <Label htmlFor="cep">CEP</Label>
                <Input id="cep" value={formData.cep}
                  onChange={e => set("cep", formatCep(e.target.value))}
                  placeholder="00000-000"
                  maxLength={9}
                  inputMode="numeric" />
              </div>

              {/* Cidade */}
              <div className="space-y-2">
                 <Label htmlFor="cidade">{copy.city}</Label>
                <Input id="cidade" value={formData.cidade}
                  onChange={e => set("cidade", e.target.value)}
                  placeholder="São Paulo" />
              </div>

              {/* Estado endereço */}
              <div className="space-y-2">
                 <Label htmlFor="estado">{copy.state}</Label>
                <Select value={formData.estado} onValueChange={v => set("estado", v)}>
                  <SelectTrigger id="estado">
                     <SelectValue placeholder={copy.select} />
                  </SelectTrigger>
                  <SelectContent>
                    {ESTADOS_BR.map(({ uf, nome }) => (
                      <SelectItem key={uf} value={uf}>
                        <span className="font-mono font-medium">{uf}</span>
                        <span className="ml-2 text-muted-foreground">{nome}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

            </div>

            {/* ── Escolha do Plano ────────────────────────────────────── */}
            {(plansLoading || plans.length > 0) && (
              <div className="space-y-4 rounded-2xl p-5" style={{ background: "linear-gradient(135deg,#f0f7ff 0%,#f8fffe 100%)", border: "1.5px solid #bfdbfe" }}>
                {/* Header */}
                <div className="flex items-center gap-3">
                  <div className="h-9 w-9 rounded-xl flex items-center justify-center shrink-0" style={{ background: "#0B1F4B" }}>
                    <CreditCard className="h-4 w-4 text-white" />
                  </div>
                  <div>
                     <p className="font-bold text-sm" style={{ color: "#0B1F4B" }}>{copy.choosePlan}</p>
                     <p className="text-xs text-muted-foreground">{copy.trialNoCharge}</p>
                  </div>
                </div>

                {plansLoading ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="h-52 rounded-xl bg-white/80 animate-pulse border border-blue-100" />
                    <div className="h-52 rounded-xl bg-white/80 animate-pulse border border-blue-100" />
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {plans.map((plan) => {
                      const selected = selectedPriceId === plan.price_id;
                      const isYear = plan.recurring?.interval === "year";
                       const FEATURES = [
                         { icon: Activity,  label: copy.planFeature1 },
                         { icon: Brain,     label: copy.planFeature2 },
                         { icon: FileText,  label: copy.planFeature3 },
                         { icon: Shield,    label: copy.planFeature4 },
                      ];
                      return (
                        <button
                          type="button"
                          key={plan.price_id}
                          onClick={() => setSelectedPriceId(plan.price_id)}
                          style={{
                            background: selected
                              ? "linear-gradient(145deg,#0B1F4B 0%,#1d4ed8 100%)"
                              : "#ffffff",
                            border: selected ? "2px solid #1d4ed8" : "2px solid #e2e8f0",
                            borderRadius: 16,
                            padding: "20px",
                            textAlign: "left",
                            cursor: "pointer",
                            transition: "all 0.2s ease",
                            boxShadow: selected
                              ? "0 10px 30px rgba(29,78,216,0.30)"
                              : "0 2px 8px rgba(0,0,0,0.05)",
                            transform: selected ? "translateY(-3px)" : "none",
                            position: "relative",
                            overflow: "hidden",
                            width: "100%",
                          }}
                        >
                          {/* Badge */}
                          <div style={{
                            display: "inline-flex", alignItems: "center", gap: 4,
                            background: selected ? "rgba(255,255,255,0.18)" : (isYear ? "#065f46" : "#0B1F4B"),
                            color: "#fff", borderRadius: 20, padding: "3px 10px",
                            fontSize: 11, fontWeight: 700, marginBottom: 14,
                          }}>
                             {isYear ? copy.yearlyBadge : copy.popularBadge}
                          </div>

                          {/* Plan name */}
                          <p style={{ fontSize: 12, fontWeight: 600, margin: "0 0 6px", color: selected ? "rgba(255,255,255,0.75)" : "#64748b" }}>
                            {plan.product_name}
                          </p>

                          {/* Price */}
                          <div style={{ display: "flex", alignItems: "baseline", gap: 3, marginBottom: 18 }}>
                            <span style={{ fontSize: 13, fontWeight: 700, color: selected ? "rgba(255,255,255,0.65)" : "#94a3b8" }}>R$</span>
                            <span style={{ fontSize: 40, fontWeight: 900, lineHeight: 1, color: selected ? "#fff" : "#0B1F4B" }}>
                               {plan.unit_amount != null ? formatNumber(plan.unit_amount / 100, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : ""}
                            </span>
                            <span style={{ fontSize: 13, color: selected ? "rgba(255,255,255,0.55)" : "#94a3b8" }}>
                               /{isYear ? copy.year : copy.month}
                            </span>
                          </div>

                          {/* Feature list */}
                          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                            {FEATURES.map(({ label }) => (
                              <div key={label} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                <div style={{
                                  width: 18, height: 18, borderRadius: "50%", flexShrink: 0,
                                  background: selected ? "rgba(255,255,255,0.22)" : "#dbeafe",
                                  display: "flex", alignItems: "center", justifyContent: "center",
                                }}>
                                  <Check size={10} style={{ color: selected ? "#fff" : "#1d4ed8", strokeWidth: 3 }} />
                                </div>
                                <span style={{ fontSize: 11.5, color: selected ? "rgba(255,255,255,0.85)" : "#475569" }}>{label}</span>
                              </div>
                            ))}
                          </div>

                          {/* Selected checkmark */}
                          {selected && (
                            <div style={{ position: "absolute", top: 14, right: 14, width: 24, height: 24, borderRadius: "50%", background: "rgba(255,255,255,0.25)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                              <Check size={13} style={{ color: "#fff", strokeWidth: 3 }} />
                            </div>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}

                {/* Trial banner */}
                <div style={{ display: "flex", alignItems: "center", gap: 10, background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 10, padding: "10px 14px" }}>
                  <span style={{ fontSize: 18, flexShrink: 0 }}>🎁</span>
                  <p style={{ fontSize: 12, color: "#166534", margin: 0, lineHeight: 1.5 }}>
                     <strong>{copy.trialBannerStrong}</strong> {copy.trialBanner}
                  </p>
                </div>
              </div>
            )}

            {/* ── Termo de Uso ────────────────────────────────────────── */}
            <div className="space-y-3">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                 {copy.termsTitle}
              </p>

              {/* Caixa scrollável com o termo completo */}
              <div
                className="h-56 overflow-y-auto rounded-md border border-border bg-muted/30 px-4 py-3 text-xs text-muted-foreground leading-relaxed space-y-3 select-none"
              >
                 <p className="font-semibold text-foreground text-sm">{copy.termsTitle.toUpperCase()}</p>
                 <p>{copy.termsBody}</p>
              </div>

              {/* Checkbox de aceite */}
              <div
                className={`flex items-start gap-3 rounded-md border p-3 transition-colors ${termsAccepted ? "border-primary bg-primary/5" : "border-border bg-background"}`}
              >
                <Checkbox
                  id="terms"
                  checked={termsAccepted}
                  onCheckedChange={v => setTermsAccepted(Boolean(v))}
                  className="mt-0.5 shrink-0"
                />
                <label htmlFor="terms" className="text-sm leading-snug cursor-pointer select-none">
                   {copy.termsAccept}
                </label>
              </div>
            </div>

            <Button
              type="submit"
              className="w-full"
              size="lg"
              disabled={registerMutation.isPending || redirecting || !termsAccepted}
            >
              {redirecting
                 ? copy.redirectingPayment
                : registerMutation.isPending
                   ? copy.registering
                  : selectedPriceId
                     ? copy.continuePayment
                     : copy.finishRegistration}
            </Button>

            <div className="text-center text-sm">
               {copy.alreadyAccount}{" "}
              <Link href="/" className="text-primary hover:underline font-medium">
                 {copy.doLogin}
              </Link>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
