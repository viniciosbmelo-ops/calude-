import { useState, useEffect } from "react";
import { useAuth } from "@/lib/auth";
import { getAnalyticsSessionHeaders } from "@/lib/analytics";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Save, User, Lock, Stethoscope, MapPin, Sun, Moon, MessageCircle, CheckCircle2, ExternalLink, Zap, Users, Plus, Pencil, Trash2, Eye, EyeOff, ToggleLeft, ToggleRight, CreditCard, AlertCircle, XCircle, RefreshCw, Mail, Globe2 } from "lucide-react";
import { useSubscriptionStatus } from "@/hooks/use-subscription-status";
import { useTheme } from "@/lib/theme";
import { useQueryClient } from "@tanstack/react-query";
import { getGetCurrentDoctorQueryKey } from "@workspace/docregen-api-client-react";
import { useLanguage, useScopedTranslations, type Locale } from "@/lib/i18n";
import { profileMessages } from "@/locales/profile";
import { sortByPtBrName } from "@/lib/utils";

function ContactSupportCard() {
  const { t } = useLanguage();
  const [contactEmail, setContactEmail] = useState<string>("");

  useEffect(() => {
    fetch("/regen-api/auth/config")
      .then(r => r.json())
      .then(d => { if (d.contactEmail) setContactEmail(d.contactEmail); })
      .catch(() => {});
  }, []);

  if (!contactEmail) return null;

  return (
    <Card className="shadow-sm border-border mb-5">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Mail className="h-4 w-4 text-primary" />
          {t("profile.support")}
        </CardTitle>
        <CardDescription className="text-xs">
          {t("profile.supportDescription")}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/30 border border-border">
          <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
            <Mail className="h-4 w-4 text-primary" />
          </div>
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground mb-0.5">{t("profile.supportEmail")}</p>
            <a
              href={`mailto:${contactEmail}`}
              className="text-sm font-medium text-primary hover:underline truncate block"
            >
              {contactEmail}
            </a>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

const UF_LIST: { uf: string; nome: string }[] = [
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
  if (d.length <= 6) return `${d.slice(0,3)}.${d.slice(3)}`;
  if (d.length <= 9) return `${d.slice(0,3)}.${d.slice(3,6)}.${d.slice(6)}`;
  return `${d.slice(0,3)}.${d.slice(3,6)}.${d.slice(6,9)}-${d.slice(9)}`;
}

function formatPhone(v: string) {
  const d = v.replace(/\D/g, "").slice(0, 11);
  if (d.length <= 2) return d;
  if (d.length <= 7) return `(${d.slice(0,2)}) ${d.slice(2)}`;
  if (d.length <= 11) return `(${d.slice(0,2)}) ${d.slice(2,7)}-${d.slice(7)}`;
  return v;
}

function SectionCard({ icon: Icon, title, description, children }: {
  icon: React.ElementType; title: string; description?: string; children: React.ReactNode
}) {
  return (
    <Card className="shadow-sm border-border">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Icon className="h-4 w-4 text-primary" />
          {title}
        </CardTitle>
        {description && <CardDescription className="text-xs">{description}</CardDescription>}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function ChangePasswordCard() {
  const { toast } = useToast();
  const p = useScopedTranslations(profileMessages);
  const [senhaAtual, setSenhaAtual] = useState("");
  const [novaSenha, setNovaSenha] = useState("");
  const [confirmarSenha, setConfirmarSenha] = useState("");
  const [showAtual, setShowAtual] = useState(false);
  const [showNova, setShowNova] = useState(false);
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!senhaAtual || !novaSenha || !confirmarSenha) {
      toast({ title: p("fillAll"), variant: "destructive" });
      return;
    }
    if (novaSenha.length < 8) {
      toast({ title: p("passwordMin8"), variant: "destructive" });
      return;
    }
    if (novaSenha !== confirmarSenha) {
      toast({ title: p("passwordsMismatch"), variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/regen-api/auth/change-password", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", ...getAnalyticsSessionHeaders() },
        body: JSON.stringify({ senhaAtual, novaSenha }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast({ title: p("passwordError"), description: data.error, variant: "destructive" });
        return;
      }
      toast({ title: p("passwordSuccess") });
      setSenhaAtual("");
      setNovaSenha("");
      setConfirmarSenha("");
    } catch {
      toast({ title: p("connectionError"), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <SectionCard icon={Lock} title={p("changePassword")} description={p("changePasswordDescription")}>
      <form onSubmit={handleSubmit} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-1 sm:col-span-2">
          <Label htmlFor="senhaAtual" className="text-sm font-medium">{p("currentPassword")}</Label>
          <div className="relative">
            <Input
              id="senhaAtual"
              type={showAtual ? "text" : "password"}
              value={senhaAtual}
              onChange={(e) => setSenhaAtual(e.target.value)}
              placeholder={p("currentPasswordPlaceholder")}
              className="pr-9"
              autoComplete="current-password"
            />
            <button
              type="button"
              onClick={() => setShowAtual(v => !v)}
              title={showAtual ? p("hidePassword") : p("showPassword")}
              aria-label={showAtual ? p("hidePassword") : p("showPassword")}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              {showAtual ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            </button>
          </div>
        </div>
        <div className="space-y-1">
          <Label htmlFor="novaSenha" className="text-sm font-medium">{p("newPassword")}</Label>
          <div className="relative">
            <Input
              id="novaSenha"
              type={showNova ? "text" : "password"}
              value={novaSenha}
              onChange={(e) => setNovaSenha(e.target.value)}
              placeholder={p("min8")}
              className="pr-9"
              autoComplete="new-password"
            />
            <button
              type="button"
              onClick={() => setShowNova(v => !v)}
              title={showNova ? p("hidePassword") : p("showPassword")}
              aria-label={showNova ? p("hidePassword") : p("showPassword")}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              {showNova ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            </button>
          </div>
        </div>
        <div className="space-y-1">
          <Label htmlFor="confirmarSenha" className="text-sm font-medium">{p("confirmPassword")}</Label>
          <Input
            id="confirmarSenha"
            type={showNova ? "text" : "password"}
            value={confirmarSenha}
            onChange={(e) => setConfirmarSenha(e.target.value)}
            placeholder={p("repeatPassword")}
            autoComplete="new-password"
          />
        </div>
        <div className="sm:col-span-2 flex justify-end">
          <Button type="submit" disabled={saving} className="gap-2">
            {saving ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Lock className="h-3.5 w-3.5" />}
            {saving ? p("changing") : p("changePassword")}
          </Button>
        </div>
      </form>
    </SectionCard>
  );
}

type SecretaryRow = { id: number; nome: string; email: string; ativo: boolean };

function SecretariesSection({ doctorId }: { doctorId: number }) {
  const { toast } = useToast();
  const p = useScopedTranslations(profileMessages);
  const [list, setList] = useState<SecretaryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showDialog, setShowDialog] = useState(false);
  const [editing, setEditing] = useState<SecretaryRow | null>(null);
  const [form, setForm] = useState({ nome: "", email: "", senha: "" });
  const [showPwd, setShowPwd] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    const res = await fetch("/regen-api/secretaries", { credentials: "same-origin" });
    if (res.ok) {
      const rows = await res.json();
      setList(sortByPtBrName(rows, (secretary) => secretary.nome, (secretary) => secretary.id));
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const openNew = () => { setEditing(null); setForm({ nome: "", email: "", senha: "" }); setShowDialog(true); };
  const openEdit = (s: SecretaryRow) => { setEditing(s); setForm({ nome: s.nome, email: s.email, senha: "" }); setShowDialog(true); };

  const save = async () => {
    const nome = form.nome.trim();
    const email = form.email.trim();
    if (!nome || !email || (!editing && !form.senha)) {
      toast({ title: p("secretaryRequired"), variant: "destructive" }); return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      toast({ title: p("secretaryEmailInvalid"), variant: "destructive" }); return;
    }
    if ((!editing && form.senha.length < 6) || (Boolean(editing) && form.senha.length > 0 && form.senha.length < 6)) {
      toast({ title: p("secretaryPasswordMin6"), variant: "destructive" }); return;
    }
    setSaving(true);
    const body: Record<string, string> = { nome, email };
    if (form.senha) body["senha"] = form.senha;

    const res = editing
      ? await fetch(`/regen-api/secretaries/${editing.id}`, { method: "PATCH", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      : await fetch("/regen-api/secretaries", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

    const data = await res.json();
    if (!res.ok) { toast({ title: data.error, variant: "destructive" }); setSaving(false); return; }
    toast({ title: editing ? p("secretaryUpdated") : p("secretaryCreated") });
    setShowDialog(false);
    load();
    setSaving(false);
  };

  const toggleAtivo = async (s: SecretaryRow) => {
    try {
      const res = await fetch(`/regen-api/secretaries/${s.id}`, {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ativo: !s.ativo }),
      });
      const data = await res.json().catch(() => null) as { error?: string } | null;
      if (!res.ok) {
        toast({ title: data?.error ?? p("secretaryActionError"), variant: "destructive" });
        return;
      }
      toast({ title: s.ativo ? p("accessDisabled") : p("accessEnabled") });
      await load();
    } catch {
      toast({ title: p("connectionError"), description: p("tryAgain"), variant: "destructive" });
    }
  };

  const remove = async (s: SecretaryRow) => {
    if (!window.confirm(p("removeSecretary", { name: s.nome }))) return;
    try {
      const res = await fetch(`/regen-api/secretaries/${s.id}`, { method: "DELETE", credentials: "same-origin" });
      const data = await res.json().catch(() => null) as { error?: string } | null;
      if (!res.ok) {
        toast({ title: data?.error ?? p("secretaryActionError"), variant: "destructive" });
        return;
      }
      toast({ title: p("secretaryRemoved") });
      await load();
    } catch {
      toast({ title: p("connectionError"), description: p("tryAgain"), variant: "destructive" });
    }
  };

  return (
    <>
      <Card className="shadow-sm border-border mb-5">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <Users className="h-4 w-4 text-primary" />
                {p("secretaryAccess")}
              </CardTitle>
              <CardDescription className="text-xs mt-0.5">
                {p("secretaryDescription")}{" "}
                <a href={`${import.meta.env.BASE_URL}secretary/login`} target="_blank" rel="noopener noreferrer" className="underline text-primary font-medium">{`${import.meta.env.BASE_URL}secretary/login`}</a>
              </CardDescription>
            </div>
            <Button size="sm" variant="outline" onClick={openNew} className="gap-1.5 shrink-0">
              <Plus className="h-3.5 w-3.5" /> {p("new")}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">{p("loading")}</p>
          ) : list.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border py-8 flex flex-col items-center gap-2 text-muted-foreground">
              <Users className="h-8 w-8 opacity-30" />
              <p className="text-sm">{p("noSecretary")}</p>
              <Button size="sm" variant="outline" onClick={openNew} className="mt-1 gap-1.5">
                <Plus className="h-3.5 w-3.5" /> {p("createAccess")}
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              {list.map(s => (
                <div key={s.id} className="flex items-center justify-between gap-2 p-3 rounded-lg border border-border bg-muted/20">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-foreground truncate">{s.nome}</p>
                    <p className="text-xs text-muted-foreground truncate">{s.email}</p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <Badge variant={s.ativo ? "default" : "secondary"} className="text-xs">
                      {s.ativo ? p("active") : p("inactive")}
                    </Badge>
                    <button onClick={() => toggleAtivo(s)} title={s.ativo ? p("disable") : p("enable")}
                      className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-muted">
                      {s.ativo
                        ? <ToggleRight className="h-4 w-4 text-green-600" />
                        : <ToggleLeft className="h-4 w-4 text-muted-foreground" />}
                    </button>
                    <button onClick={() => openEdit(s)} title={p("editSecretary")} aria-label={p("editSecretary")} className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-muted">
                      <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                    </button>
                    <button onClick={() => remove(s)} title={p("remove")} aria-label={p("remove")} className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-red-50 text-red-400">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Dialog */}
      <div className={`fixed inset-0 z-50 flex items-center justify-center bg-black/50 transition-opacity ${showDialog ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"}`}>
        <div className="bg-background rounded-xl shadow-xl w-full max-w-sm mx-4 p-6 space-y-4">
          <h3 className="font-bold text-lg">{editing ? p("editSecretary") : p("newSecretary")}</h3>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>{p("fullName")}</Label>
              <Input value={form.nome} onChange={e => setForm(f => ({ ...f, nome: e.target.value }))} placeholder={p("secretaryNamePlaceholder")} required />
            </div>
            <div className="space-y-1">
              <Label>{p("emailRequired")}</Label>
              <Input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} placeholder="maria@clinica.com.br" required />
            </div>
            <div className="space-y-1">
              <Label>{editing ? p("newPasswordOptional") : p("password")}</Label>
              <div className="relative">
                <Input type={showPwd ? "text" : "password"} value={form.senha}
                  onChange={e => setForm(f => ({ ...f, senha: e.target.value }))}
                  placeholder={editing ? "••••••" : p("min6")}
                  minLength={editing ? undefined : 6}
                  required={!editing}
                  className="pr-10"
                />
                <button type="button" onClick={() => setShowPwd(v => !v)}
                  title={showPwd ? p("hidePassword") : p("showPassword")}
                  aria-label={showPwd ? p("hidePassword") : p("showPassword")}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                  {showPwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={() => setShowDialog(false)}>{p("cancel")}</Button>
            <Button onClick={save} disabled={saving}>{saving ? p("saving") : p("save")}</Button>
          </div>
        </div>
      </div>
    </>
  );
}

function BillingCard() {
  const { toast } = useToast();
  const p = useScopedTranslations(profileMessages);
  const { locale } = useLanguage();
  const sub = useSubscriptionStatus();
  const [canceling, setCanceling] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [showRenew, setShowRenew] = useState(false);
  const [plans, setPlans] = useState<{ price_id: string; product_name: string; unit_amount: number; recurring: { interval: string } | null }[]>([]);
  const [selectedOption, setSelectedOption] = useState<"card-month" | "card-year" | "pix-year" | null>(null);
  const [subscribing, setSubscribing] = useState(false);

  useEffect(() => {
    const handlePageShow = (e: PageTransitionEvent) => {
      if (e.persisted) setSubscribing(false);
    };
    window.addEventListener("pageshow", handlePageShow);
    return () => window.removeEventListener("pageshow", handlePageShow);
  }, []);

  useEffect(() => {
    if (!showRenew || plans.length > 0) return;
    fetch("/regen-api/stripe/products-with-prices")
      .then(r => r.json())
      .then(d => { setPlans((d.data ?? []) as typeof plans); })
      .catch(() => {});
  }, [showRenew, plans.length]);

  const monthlyPlan = plans.find(p => p.recurring?.interval === "month");
  const annualPlan  = plans.find(p => p.recurring?.interval === "year");
  const formatPlanAmount = (cents: number) =>
    new Intl.NumberFormat(locale, { style: "currency", currency: "BRL" }).format(cents / 100);

  const optionConfig = {
    "card-month": { label: p("monthlyCard"), priceId: monthlyPlan?.price_id, paymentMethods: ["card"], badge: `💳 ${p("automatic")}`, desc: p("monthlyDescription"), amount: monthlyPlan ? `${formatPlanAmount(monthlyPlan.unit_amount)}${p("perMonth")}` : "" },
    "card-year":  { label: p("annualCard"), priceId: annualPlan?.price_id, paymentMethods: ["card"], badge: `💳 ${p("automatic")}`, desc: annualPlan ? p("annualCardDescription", { amount: formatPlanAmount(annualPlan.unit_amount / 12) }) : "", amount: annualPlan ? `${formatPlanAmount(annualPlan.unit_amount)}${p("perYear")}` : "" },
    "pix-year":   { label: p("annualPix"), priceId: annualPlan?.price_id, paymentMethods: ["pix"], badge: "📱 PIX", desc: p("annualPixDescription"), amount: annualPlan ? `${formatPlanAmount(annualPlan.unit_amount)}${p("perYear")}` : "" },
  } as const;

  const handleSubscribe = async () => {
    if (!selectedOption) return;
    const cfg = optionConfig[selectedOption];
    if (!cfg.priceId) return;
    setSubscribing(true);
    try {
      const res = await fetch("/regen-api/stripe/checkout", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", ...getAnalyticsSessionHeaders() },
        body: JSON.stringify({ priceId: cfg.priceId, paymentMethods: cfg.paymentMethods }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? p("paymentSessionError"));
      window.location.href = data.url;
    } catch (err: any) {
      toast({ title: err?.message ?? p("connectionError"), variant: "destructive" });
      setSubscribing(false);
    }
  };

  const fmtDate = (ts: number | null) => {
    if (!ts) return "—";
    return new Date(ts * 1000).toLocaleDateString(locale, { day: "2-digit", month: "long", year: "numeric" });
  };

  const handleCancel = async () => {
    setCanceling(true);
    setShowConfirm(false);
    try {
      const res = await fetch("/regen-api/stripe/cancel-subscription", {
        method: "POST",
        credentials: "same-origin",
      });
      if (res.ok) {
        toast({ title: p("subscriptionCanceled"), description: p("accessUntilExpiry") });
        sub.refetch();
      } else {
        const d = await res.json();
        toast({ title: p("cancelError"), description: d.error, variant: "destructive" });
      }
    } catch {
      toast({ title: p("connectionError"), variant: "destructive" });
    } finally {
      setCanceling(false);
    }
  };

  if (sub.loading) {
    return (
      <Card className="shadow-sm border-border">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <CreditCard className="h-4 w-4 text-primary" /> {p("subscription")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-16 rounded-lg bg-muted/40 animate-pulse" />
        </CardContent>
      </Card>
    );
  }

  const statusConfig: Record<string, { label: string; color: string; bg: string; icon: React.ElementType }> = {
    exempt:   { label: p("freeAccess"), color: "#15803d", bg: "#dcfce7", icon: CheckCircle2 },
    active:   { label: p("active"), color: "#15803d", bg: "#dcfce7", icon: CheckCircle2 },
    trialing: { label: p("trial"), color: "#1d4ed8", bg: "#dbeafe", icon: RefreshCw },
    canceled: { label: p("canceled"), color: "#dc2626", bg: "#fee2e2", icon: XCircle },
    none:     { label: p("noSubscription"), color: "#dc2626", bg: "#fee2e2", icon: AlertCircle },
    unknown:  { label: p("checking"), color: "#64748b", bg: "#f1f5f9", icon: RefreshCw },
  };
  const cfg = statusConfig[sub.status] ?? statusConfig.unknown;
  const StatusIcon = cfg.icon;

  const isCanceling = sub.cancelAtPeriodEnd && (sub.status === "active" || sub.status === "trialing");
  const canCancel = (sub.status === "active" || sub.status === "trialing") && !sub.cancelAtPeriodEnd && !sub.isFree;

  const dateLabel = isCanceling ? p("accessGuaranteedUntil") : sub.status === "trialing" ? p("trialEnds") : p("nextBilling");

  return (
    <Card className="shadow-sm border-border">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <CreditCard className="h-4 w-4 text-primary" /> {p("subscription")}
        </CardTitle>
        <CardDescription className="text-xs">{p("managePlan")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">

        {/* Status row */}
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">{p("status")}</span>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 6, background: cfg.bg, borderRadius: 20, padding: "4px 12px" }}>
            <StatusIcon style={{ width: 13, height: 13, color: cfg.color }} />
            <span style={{ fontSize: 12, fontWeight: 700, color: cfg.color }}>
              {isCanceling ? p("scheduledCancellation") : cfg.label}
            </span>
          </div>
        </div>

        {/* Next billing / period end */}
        {sub.currentPeriodEnd && (
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">{dateLabel}</span>
            <span className="text-sm font-semibold" style={{ color: isCanceling ? "#dc2626" : "#0B1F4B" }}>
              {fmtDate(sub.currentPeriodEnd)}
            </span>
          </div>
        )}

        {/* Canceling warning */}
        {isCanceling && (
          <div style={{ display: "flex", alignItems: "flex-start", gap: 10, background: "#fff7ed", border: "1px solid #fed7aa", borderRadius: 10, padding: "10px 12px" }}>
            <AlertCircle style={{ width: 15, height: 15, color: "#c2410c", flexShrink: 0, marginTop: 1 }} />
            <p style={{ fontSize: 12, color: "#9a3412", margin: 0, lineHeight: 1.5 }}>
              {p("cancelingWarning", { date: fmtDate(sub.currentPeriodEnd) })}
            </p>
          </div>
        )}

        {/* Canceled warning + Renew button */}
        {(sub.status === "canceled" || sub.status === "none") && (
          <>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 10, background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 10, padding: "10px 12px" }}>
              <XCircle style={{ width: 15, height: 15, color: "#dc2626", flexShrink: 0, marginTop: 1 }} />
              <p style={{ fontSize: 12, color: "#991b1b", margin: 0, lineHeight: 1.5 }}>
                {p("endedWarning")}
              </p>
            </div>

            {!showRenew ? (
              <button
                type="button"
                onClick={() => setShowRenew(true)}
                style={{ width: "100%", background: "linear-gradient(135deg,#0B1F4B 0%,#1d4ed8 100%)", color: "#fff", border: "none", borderRadius: 10, padding: "11px 0", fontSize: 13, fontWeight: 700, cursor: "pointer", boxShadow: "0 3px 10px rgba(29,78,216,0.25)" }}
              >
                🔄 {p("renew")}
              </button>
            ) : (
              <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 12, padding: "16px" }}>
                <p style={{ fontSize: 13, fontWeight: 700, color: "#0B1F4B", margin: "0 0 4px" }}>{p("choosePayment")}</p>
                <p style={{ fontSize: 11, color: "#64748b", margin: "0 0 14px" }}>{p("choosePaymentDescription")}</p>

                {plans.length === 0 ? (
                  <p style={{ fontSize: 12, color: "#64748b", textAlign: "center", padding: "16px 0" }}>{p("loadingOptions")}</p>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 14 }}>
                    {(["card-month", "card-year", "pix-year"] as const).map(key => {
                      const opt = optionConfig[key];
                      const selected = selectedOption === key;
                      const disabled = !opt.priceId;
                      return (
                        <div
                          key={key}
                          onClick={() => !disabled && setSelectedOption(key)}
                          style={{
                            display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12,
                            padding: "11px 14px", borderRadius: 10,
                            cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.4 : 1,
                            border: selected ? "2px solid #1d4ed8" : "1.5px solid #e2e8f0",
                            background: selected ? "#eff6ff" : "#fff",
                            transition: "all 0.15s",
                          }}
                        >
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                              <span style={{ fontSize: 13, fontWeight: 700, color: "#0B1F4B" }}>{opt.label}</span>
                              <span style={{ fontSize: 10, fontWeight: 700, background: selected ? "#dbeafe" : "#f1f5f9", color: selected ? "#1d4ed8" : "#475569", borderRadius: 20, padding: "2px 7px" }}>{opt.badge}</span>
                            </div>
                            <p style={{ fontSize: 11, color: "#64748b", margin: "3px 0 0", lineHeight: 1.4 }}>{opt.desc}</p>
                          </div>
                          <div style={{ textAlign: "right", flexShrink: 0 }}>
                            <span style={{ fontSize: 16, fontWeight: 800, color: "#0B1F4B" }}>{opt.amount}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    type="button"
                    onClick={handleSubscribe}
                    disabled={subscribing || !selectedOption || !optionConfig[selectedOption!]?.priceId}
                    style={{ flex: 1, background: "linear-gradient(135deg,#0B1F4B 0%,#1d4ed8 100%)", color: "#fff", border: "none", borderRadius: 8, padding: "10px 0", fontSize: 13, fontWeight: 700, cursor: (subscribing || !selectedOption) ? "default" : "pointer", opacity: (subscribing || !selectedOption) ? 0.6 : 1 }}
                  >
                    {subscribing ? p("redirecting") : p("goPayment")}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setShowRenew(false); setSelectedOption(null); }}
                    style={{ background: "#fff", color: "#64748b", border: "1px solid #e2e8f0", borderRadius: 8, padding: "10px 14px", fontSize: 13, cursor: "pointer" }}
                  >
                    {p("cancel")}
                  </button>
                </div>
              </div>
            )}
          </>
        )}

        {/* Cancel button */}
        {canCancel && !showConfirm && (
          <button
            type="button"
            onClick={() => setShowConfirm(true)}
            style={{ background: "none", border: "1px solid #fca5a5", borderRadius: 8, padding: "8px 16px", fontSize: 12, fontWeight: 600, color: "#dc2626", cursor: "pointer", width: "100%" }}
          >
            {p("cancelSubscription")}
          </button>
        )}

        {/* Confirm cancel dialog */}
        {showConfirm && (
          <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 12, padding: "14px 16px" }}>
            <p style={{ fontSize: 13, fontWeight: 600, color: "#991b1b", margin: "0 0 6px" }}>{p("confirmCancellation")}</p>
            <p style={{ fontSize: 12, color: "#7f1d1d", margin: "0 0 12px", lineHeight: 1.5 }}>
              {p("cancellationDescription")}
            </p>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                type="button"
                onClick={handleCancel}
                disabled={canceling}
                style={{ flex: 1, background: "#dc2626", color: "#fff", border: "none", borderRadius: 8, padding: "9px 0", fontSize: 13, fontWeight: 700, cursor: "pointer", opacity: canceling ? 0.6 : 1 }}
              >
                {canceling ? p("canceling") : p("yesCancel")}
              </button>
              <button
                type="button"
                onClick={() => setShowConfirm(false)}
                style={{ flex: 1, background: "#fff", color: "#374151", border: "1px solid #d1d5db", borderRadius: 8, padding: "9px 0", fontSize: 13, fontWeight: 600, cursor: "pointer" }}
              >
                {p("keepPlan")}
              </button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function Profile() {
  const { user } = useAuth();
  if (!user) return null;
  return <ProfileInner user={user as any} />;
}

function ProfileInner({ user }: { user: any }) {
  const { toast } = useToast();
  const { theme, setTheme } = useTheme();
  const { t, locale, setLanguage } = useLanguage();
  const p = useScopedTranslations(profileMessages);
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [languageSaving, setLanguageSaving] = useState(false);

  const makeForm = (u: any) => ({
    nome: u.nome || "",
    dataNascimento: u.dataNascimento || "",
    telefone: u.telefone || "",
    crm: u.crm || "",
    crmEstado: u.crmEstado || "",
    especialidade: u.especialidade || "",
    endereco: u.endereco || "",
    cidade: u.cidade || "",
    estado: u.estado || "",
    cep: u.cep || "",
    whatsappBusiness: u.whatsappBusiness || "",
  });

  const [form, setForm] = useState(() => makeForm(user));

  useEffect(() => {
    setForm(makeForm(user));
  }, [user]);

  const set = (k: keyof typeof form, v: string) => setForm(f => ({ ...f, [k]: v }));

  const handleLanguageChange = async (next: string) => {
    if (next !== "pt-BR" && next !== "es") return;
    setLanguageSaving(true);
    try {
      await setLanguage(next as Locale);
      toast({ title: t("profile.languageSaved") });
    } catch {
      toast({ title: t("profile.languageSaveError"), variant: "destructive" });
    } finally {
      setLanguageSaving(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch(`/regen-api/doctors/${(user as any).id}`, {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nome: form.nome || undefined,
          dataNascimento: form.dataNascimento || null,
          telefone: form.telefone || undefined,
          crm: form.crm || undefined,
          crmEstado: form.crmEstado || undefined,
          especialidade: form.especialidade || undefined,
          endereco: form.endereco || undefined,
          cidade: form.cidade || undefined,
          estado: form.estado || undefined,
          cep: form.cep || undefined,
          whatsappBusiness: form.whatsappBusiness ? form.whatsappBusiness.replace(/\D/g, "") : null,
        }),
      });
      if (!res.ok) {
        const d = await res.json();
        toast({ title: p("saveError"), description: d.error, variant: "destructive" });
        return;
      }
      const saved = await res.json();
      queryClient.setQueryData(getGetCurrentDoctorQueryKey(), saved);
      toast({ title: p("profileSaved") });
    } catch {
      toast({ title: p("connectionError"), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const initials = form.nome
    ? form.nome.split(" ").slice(0, 2).map((n: string) => n[0]).join("").toUpperCase()
    : "?";

  return (
    <div className="max-w-4xl mx-auto animate-in fade-in">

      {/* ── Mobile navy banner with doctor avatar (hidden md+) ── */}
      <div className="md:hidden" style={{ background: "linear-gradient(135deg, #0B1F4B 0%, #0D2040 100%)" }}>
        <div className="px-4 pt-6 pb-6 flex items-center gap-4">
          <div
            style={{ width: 56, height: 56, borderRadius: "50%", background: "linear-gradient(135deg,#0B1F4B,#0E9AA7)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, fontWeight: 700, flexShrink: 0, boxShadow: "0 2px 8px rgba(0,0,0,0.25)" }}
          >
            {initials}
          </div>
          <div className="min-w-0">
            <h1 style={{ fontSize: 18, fontWeight: 700, color: "#fff", margin: 0 }} className="truncate">
              {form.nome || t("profile.title")}
            </h1>
            <p style={{ fontSize: 12, color: "rgba(255,255,255,0.55)", margin: "3px 0 0" }}>
              {(user as any).isAdmin ? t("nav.adminRole") : t("profile.doctor")}
              {(user as any).estrangeiro && (user as any).paisOrigem
                ? ` · 🌍 ${(user as any).paisOrigem}`
                : form.crm && form.crmEstado ? ` · CRM ${form.crmEstado} ${form.crm}` : ""}
            </p>
          </div>
        </div>
      </div>

      <div className="p-6 md:p-8 space-y-6">

      {/* ── Idioma, sempre visível no topo ─────────────────────────────── */}
      <div className="flex items-center justify-end gap-3">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Globe2 className="h-4 w-4 text-primary" />
          <span>{t("common.language")}</span>
        </div>
        <Select value={locale} onValueChange={handleLanguageChange} disabled={languageSaving}>
          <SelectTrigger aria-label={t("common.language")} className="w-[210px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="pt-BR">{t("common.portuguese")}</SelectItem>
            <SelectItem value="es">{t("common.spanish")}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* ── Desktop header (hidden on mobile) ── */}
      <div className="hidden md:flex flex-row items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">{t("profile.title")}</h1>
          <p className="text-muted-foreground mt-1">{t("profile.subtitle")}</p>
        </div>
        <Badge variant="outline" className="w-fit text-sm px-3 py-1">
          {(user as any).isAdmin ? t("nav.adminRole") : t("profile.doctor")}
        </Badge>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">

        {/* Credenciais (read-only) */}
        <SectionCard icon={Lock} title={t("profile.credentials")} description={t("profile.credentialsDescription")}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">{t("profile.email")}</Label>
              <div className="h-9 px-3 flex items-center rounded-md border bg-muted/30 text-sm text-foreground select-all">
                {(user as any).email}
              </div>
            </div>
            {(user as any).cpf && (
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">{t("profile.cpf")}</Label>
                <div className="h-9 px-3 flex items-center rounded-md border bg-muted/30 text-sm font-mono text-foreground select-all">
                  {formatCpf((user as any).cpf ?? "")}
                </div>
              </div>
            )}
            {(user as any).estrangeiro && (user as any).paisOrigem && (
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">{t("profile.originCountry")}</Label>
                <div className="h-9 px-3 flex items-center rounded-md border bg-blue-50 text-sm font-medium text-blue-800 gap-2">
                  <span>🌍</span>
                  <span>{(user as any).paisOrigem}</span>
                </div>
              </div>
            )}
          </div>
        </SectionCard>

        {/* Dados Pessoais */}
        <SectionCard icon={User} title={t("profile.personalData")}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="nome" className="text-sm font-medium">{p("fullNameLabel")}</Label>
              <Input
                id="nome"
                value={form.nome}
                onChange={e => set("nome", e.target.value)}
                placeholder={p("doctorNamePlaceholder")}
                required
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="dataNascimento" className="text-sm font-medium">{p("birthDate")}</Label>
              <Input
                id="dataNascimento"
                type="date"
                value={form.dataNascimento}
                onChange={e => set("dataNascimento", e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="telefone" className="text-sm font-medium">{p("phone")}</Label>
              <Input
                id="telefone"
                value={form.telefone}
                onChange={e => set("telefone", formatPhone(e.target.value))}
                placeholder="(11) 99999-9999"
              />
            </div>
          </div>
        </SectionCard>

        {/* Dados Profissionais */}
        <SectionCard icon={Stethoscope} title={(user as any).estrangeiro ? t("profile.professionalData") : t("profile.professionalDataCrm")}>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {/* CRM — somente para médicos brasileiros */}
            {!(user as any).estrangeiro && (
              <>
                <div className="space-y-1 sm:col-span-1">
                  <Label htmlFor="crm" className="text-sm font-medium">{p("crmNumber")}</Label>
                  <Input
                    id="crm"
                    value={form.crm}
                    onChange={e => set("crm", e.target.value.replace(/\D/g, ""))}
                    placeholder="123456"
                    maxLength={8}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="crmEstado" className="text-sm font-medium">{p("crmState")}</Label>
                  <Select value={form.crmEstado} onValueChange={v => set("crmEstado", v)}>
                    <SelectTrigger id="crmEstado">
                      <SelectValue placeholder="UF" />
                    </SelectTrigger>
                    <SelectContent>
                      {UF_LIST.map(({ uf, nome }) => (
                        <SelectItem key={uf} value={uf}>
                          <span className="font-mono font-medium">{uf}</span>
                          <span className="ml-2 text-muted-foreground">{nome}</span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </>
            )}
            {/* País de Origem — somente para médicos estrangeiros */}
            {(user as any).estrangeiro && (
              <div className="space-y-1 sm:col-span-2">
                <Label className="text-sm font-medium">{p("countryOfOrigin")}</Label>
                <div className="h-9 px-3 flex items-center rounded-md border bg-blue-50 text-sm font-medium text-blue-800 gap-2">
                  <span>🌍</span>
                  <span>{(user as any).paisOrigem ?? "—"}</span>
                </div>
                <p className="text-xs text-muted-foreground">{p("countryChangeHelp")}</p>
              </div>
            )}
            <div className="space-y-1">
              <Label htmlFor="especialidade" className="text-sm font-medium">{p("specialty")}</Label>
              <Input
                id="especialidade"
                value={form.especialidade}
                onChange={e => set("especialidade", e.target.value)}
                placeholder={p("specialtyPlaceholder")}
              />
            </div>
          </div>
          {!((user as any).estrangeiro) && form.crm && form.crmEstado && (
            <div className="mt-3 flex items-center gap-2">
              <Badge variant="outline" className="text-sm font-mono px-3 py-1 border-primary/30 text-primary bg-primary/5">
                CRM {form.crmEstado} {form.crm}
              </Badge>
              {form.especialidade && (
                <span className="text-xs text-muted-foreground">— {form.especialidade}</span>
              )}
            </div>
          )}
        </SectionCard>

        {/* Endereço */}
        <SectionCard icon={MapPin} title={p("fullAddress")}>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="endereco" className="text-sm font-medium">{p("street")}</Label>
              <Input
                id="endereco"
                value={form.endereco}
                onChange={e => set("endereco", e.target.value)}
                placeholder={p("streetPlaceholder")}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="cep" className="text-sm font-medium">CEP</Label>
              <Input
                id="cep"
                value={form.cep}
                onChange={e => {
                  const d = e.target.value.replace(/\D/g, "").slice(0, 8);
                  set("cep", d.length > 5 ? `${d.slice(0,5)}-${d.slice(5)}` : d);
                }}
                placeholder="00000-000"
                maxLength={9}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="cidade" className="text-sm font-medium">{p("city")}</Label>
              <Input
                id="cidade"
                value={form.cidade}
                onChange={e => set("cidade", e.target.value)}
                placeholder="São Paulo"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="estadoEnd" className="text-sm font-medium">{p("state")}</Label>
              <Select value={form.estado} onValueChange={v => set("estado", v)}>
                <SelectTrigger id="estadoEnd">
                  <SelectValue placeholder="UF" />
                </SelectTrigger>
                <SelectContent>
                  {UF_LIST.map(({ uf, nome }) => (
                    <SelectItem key={uf} value={uf}>
                      <span className="font-mono font-medium">{uf}</span>
                      <span className="ml-2 text-muted-foreground">{nome}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </SectionCard>

        <div className="flex justify-end pb-4">
          <Button type="submit" disabled={saving} size="lg" className="gap-2 px-8">
            <Save className="h-4 w-4" />
            {saving ? t("common.saving") : t("profile.saveProfile")}
          </Button>
        </div>
      </form>

      <ChangePasswordCard />

      {/* ── Secretárias ───────────────────────────────────────────────── */}
      <div className="px-4 md:px-8">
        <SecretariesSection doctorId={(user as any).id} />
      </div>

      {/* ── Assinatura ─────────────────────────────────────────────────── */}
      {!(user as any).isAdmin && (
        <div className="px-4 md:px-8">
          <BillingCard />
        </div>
      )}

      {/* ── Suporte / Contato ──────────────────────────────────────────── */}
      <div className="px-4 md:px-8">
        <ContactSupportCard />
      </div>

      {/* ── Aparência ─────────────────────────────────────────────────── */}
      <div className="px-4 md:px-8 pb-8">
        <Card className="shadow-sm border-border">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              {theme === "dark" ? <Moon className="h-4 w-4 text-primary" /> : <Sun className="h-4 w-4 text-primary" />}
              {t("profile.appearance")}
            </CardTitle>
            <CardDescription className="text-xs">{t("profile.appearanceDescription")}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setTheme("light")}
                className={`flex-1 flex flex-col items-center gap-2 rounded-xl border-2 py-4 transition-all ${theme === "light" ? "border-primary bg-primary/5" : "border-border hover:border-primary/40"}`}
              >
                <Sun className="h-5 w-5" style={{ color: theme === "light" ? "#0E9AA7" : "#94A3B8" }} />
                <span className={`text-sm font-medium ${theme === "light" ? "text-primary" : "text-muted-foreground"}`}>{t("profile.light")}</span>
              </button>
              <button
                type="button"
                onClick={() => setTheme("dark")}
                className={`flex-1 flex flex-col items-center gap-2 rounded-xl border-2 py-4 transition-all ${theme === "dark" ? "border-primary bg-primary/5" : "border-border hover:border-primary/40"}`}
              >
                <Moon className="h-5 w-5" style={{ color: theme === "dark" ? "#0E9AA7" : "#94A3B8" }} />
                <span className={`text-sm font-medium ${theme === "dark" ? "text-primary" : "text-muted-foreground"}`}>{t("profile.dark")}</span>
              </button>
            </div>
          </CardContent>
        </Card>
      </div>
      </div>
    </div>
  );
}
