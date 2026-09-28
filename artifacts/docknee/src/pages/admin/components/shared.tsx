import { useEffect, useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { UserPlus, X, Copy, Check, Eye, EyeOff, CheckCircle, RefreshCw, KeyRound, Pencil } from "lucide-react";
import { useScopedTranslations } from "@/lib/i18n";
import { adminConsoleMessages } from "@/locales/admin-console";

const UF_LIST = [
  "AC","AL","AM","AP","BA","CE","DF","ES","GO",
  "MA","MG","MS","MT","PA","PB","PE","PI","PR",
  "RJ","RN","RO","RR","RS","SC","SE","SP","TO",
];

const EMPTY_FORM = { nome: "", email: "", senha: "", crm: "", crmEstado: "SP", cpf: "", telefone: "", especialidade: "" };
const EDIT_EMPTY_FORM = {
  nome: "", email: "", crm: "", crmEstado: "", cpf: "", telefone: "",
  estrangeiro: false, paisOrigem: "", dataNascimento: "", endereco: "",
  cidade: "", estado: "", cep: "", especialidade: "", idioma: "pt-BR", whatsappBusiness: "",
};

function generateTempPassword(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  return Array.from({ length: 10 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

export function AdminRegisterDialog({ type = "doctor", onClose, onSuccess }: { type?: "doctor" | "physio"; onClose: () => void; onSuccess: () => void }) {
  const t = useScopedTranslations(adminConsoleMessages);
  const isPhysio = type === "physio";
  const [form, setForm] = useState(EMPTY_FORM);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSenha, setShowSenha] = useState(false);
  const [created, setCreated] = useState<{ nome: string; email: string; senha: string; crm: string; crmEstado: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const set = (k: keyof typeof EMPTY_FORM) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!form.nome || !form.email || !form.senha || !form.crm || !form.crmEstado || !form.cpf) {
      setError(isPhysio ? t("institutions.createPhysio.requiredFields") : t("dialog.requiredFields"));
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/admin/doctors/register", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? (isPhysio ? t("institutions.createPhysio.error") : t("dialog.registerError"))); return; }
      setCreated({ nome: form.nome, email: form.email, senha: form.senha, crm: form.crm, crmEstado: form.crmEstado });
      onSuccess();
    } catch {
      setError(isPhysio ? t("institutions.createPhysio.connectionError") : t("dialog.connectionRetry"));
    } finally {
      setLoading(false);
    }
  };

  const copyCredentials = () => {
    if (!created) return;
    const text = isPhysio
      ? t("institutions.createPhysio.clipboard", { name: created.nome, email: created.email, password: created.senha, state: created.crmEstado, crefito: created.crm })
      : `DocKnee — Credenciais de acesso\nNome: ${created.nome}\nEmail: ${created.email}\nSenha: ${created.senha}\nCRM: ${created.crmEstado} ${created.crm}\n\nAcesse: dockneeapp.com`;
    navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); });
  };

  const inputCls = "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50";
  const labelCls = "block text-xs font-semibold text-muted-foreground mb-1";

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full sm:max-w-lg bg-card rounded-t-2xl sm:rounded-2xl shadow-2xl border border-border max-h-[92dvh] overflow-y-auto">
        <div className="sticky top-0 bg-card border-b border-border px-5 py-4 flex items-center justify-between rounded-t-2xl z-10">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-emerald-100 flex items-center justify-center">
              <UserPlus className="h-4 w-4 text-emerald-700" />
            </div>
            <div>
               <p className="text-sm font-bold text-foreground">{isPhysio ? t("institutions.createPhysio.title") : t("dialog.registerDoctor")}</p>
               <p className="text-[11px] text-muted-foreground">{isPhysio ? t("institutions.createPhysio.description") : t("dialog.freeAccount")}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted transition-colors">
            <X className="h-4 w-4 text-muted-foreground" />
          </button>
        </div>

        {created ? (
          <div className="p-5 space-y-4">
            <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-4 space-y-3">
              <div className="flex items-center gap-2">
                <CheckCircle className="h-5 w-5 text-emerald-600 shrink-0" />
                  <p className="text-sm font-bold text-emerald-800">{isPhysio ? t("institutions.createPhysio.success") : t("dialog.registered")}</p>
              </div>
              <div className="space-y-2 text-sm">
                 <div className="flex justify-between"><span className="text-muted-foreground">{t("dialog.name")}</span><span className="font-medium">{created.nome}</span></div>
                 <div className="flex justify-between"><span className="text-muted-foreground">{t("dialog.email")}</span><span className="font-medium font-mono text-xs">{created.email}</span></div>
                 <div className="flex justify-between"><span className="text-muted-foreground">{t("dialog.password")}</span>
                  <span className="font-medium font-mono text-xs flex items-center gap-1">
                    {showSenha ? created.senha : "••••••••"}
                    <button onClick={() => setShowSenha(v => !v)} className="p-0.5 hover:text-foreground">
                      {showSenha ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                    </button>
                  </span>
                </div>
                 <div className="flex justify-between"><span className="text-muted-foreground">{isPhysio ? "CREFITO" : "CRM"}</span><span className="font-medium">{created.crmEstado} {created.crm}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">{t("dialog.accountStatus")}</span><Badge className="bg-emerald-500 text-white text-xs h-5">{t("dialog.exemptApproved")}</Badge></div>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">⚠️ {t("dialog.passwordWarning")}</p>
            <div className="flex gap-2">
              <Button onClick={copyCredentials} variant="outline" className="flex-1 gap-1.5 text-sm">
                {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
                 {copied ? t("dialog.copied") : (isPhysio ? t("institutions.createPhysio.copyCredentials") : t("dialog.copyCredentials"))}
              </Button>
               <Button onClick={onClose} className="flex-1 text-sm">{t("close")}</Button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="p-5 space-y-4">
            {error && (
              <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2.5 text-sm text-red-700">{error}</div>
            )}
            <div className="grid grid-cols-1 gap-3">
              <div>
                 <label className={labelCls}>{isPhysio ? t("institutions.createPhysio.name") : t("dialog.fullName")}</label>
                <input className={inputCls} placeholder={isPhysio ? t("institutions.createPhysio.namePlaceholder") : t("explicit.133")} value={form.nome} onChange={set("nome")} autoFocus />
              </div>
              <div>
                 <label className={labelCls}>{isPhysio ? t("institutions.createPhysio.email") : `${t("dialog.email")} *`}</label>
                <input type="email" className={inputCls} placeholder={isPhysio ? t("institutions.createPhysio.emailPlaceholder") : t("explicit.134")} value={form.email} onChange={set("email")} />
              </div>
              <div>
                 <label className={labelCls}>{isPhysio ? t("institutions.createPhysio.password") : t("dialog.tempPassword")}</label>
                <div className="relative">
                <input type={showSenha ? "text" : "password"} className={inputCls + " pr-9"} placeholder={isPhysio ? t("institutions.createPhysio.passwordPlaceholder") : t("dialog.initialPassword")} value={form.senha} onChange={set("senha")} />
                  <button type="button" onClick={() => setShowSenha(v => !v)} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                    {showSenha ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                   <label className={labelCls}>{isPhysio ? t("institutions.createPhysio.crefito") : t("dialog.crmNumber")}</label>
                  <input className={inputCls} placeholder={isPhysio ? t("institutions.createPhysio.crefitoPlaceholder") : "12345"} value={form.crm} onChange={set("crm")} />
                </div>
                <div>
                   <label className={labelCls}>{isPhysio ? t("institutions.createPhysio.state") : t("dialog.crmState")}</label>
                  <select className={inputCls} value={form.crmEstado} onChange={set("crmEstado")}>
                    {UF_LIST.map(uf => <option key={uf} value={uf}>{uf}</option>)}
                  </select>
                </div>
              </div>
              <div>
                   <label className={labelCls}>{isPhysio ? t("institutions.createPhysio.cpf") : t("dialog.cpf")}</label>
                <input className={inputCls} placeholder="000.000.000-00" value={form.cpf} onChange={set("cpf")} />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                   <label className={labelCls}>{isPhysio ? t("institutions.createPhysio.phone") : t("dialog.phone")}</label>
                  <input className={inputCls} placeholder="(11) 99999-9999" value={form.telefone} onChange={set("telefone")} />
                </div>
                <div>
                   <label className={labelCls}>{isPhysio ? t("institutions.createPhysio.specialty") : t("dialog.specialty")}</label>
                  <input className={inputCls} placeholder={isPhysio ? t("institutions.createPhysio.specialtyPlaceholder") : "Ortopedia"} value={form.especialidade} onChange={set("especialidade")} />
                </div>
              </div>
            </div>
            <div className="rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2 text-xs text-emerald-700">
              ✓ {isPhysio ? t("institutions.createPhysio.accountCreated") : t("dialog.accountCreated")}
            </div>
            <Button type="submit" className="w-full gap-2" disabled={loading}>
              {loading ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <UserPlus className="h-3.5 w-3.5" />}
               {loading ? (isPhysio ? t("institutions.createPhysio.registering") : t("dialog.registering")) : (isPhysio ? t("institutions.createPhysio.title") : t("dialog.registerDoctor"))}
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}

export function AdminResetPasswordDialog({ doctorId, doctorNome, userId, role, onClose }: { doctorId?: number; doctorNome?: string; userId?: string | number; role?: "doctor" | "physio" | "service"; onClose: () => void }) {
  const t = useScopedTranslations(adminConsoleMessages);
  const { toast } = useToast();
  const isService = role === "service";
  const [senha, setSenha] = useState(() => generateTempPassword());
  const [showSenha, setShowSenha] = useState(true);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [copied, setCopied] = useState(false);

  const inputCls = "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50";
  const labelCls = "block text-xs font-semibold text-muted-foreground mb-1";

  const targetId = doctorId || userId;
  
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (senha.length < 6) { toast({ title: isService ? t("institutions.resetService.passwordLength") : t("dialog.passwordLength"), variant: "destructive" }); return; }
    setLoading(true);
    try {
      let url = `/api/admin/doctors/${targetId}/reset-password`;
      if (role === "physio") url = `/api/admin/physiotherapists/${targetId}/reset-password`;
      if (role === "service") url = `/api/admin/services/${targetId}/reset-password`;
      
      const res = await fetch(url, {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ novaSenha: senha }),
      });
      if (!res.ok) { const d = await res.json(); toast({ title: d.error ?? (isService ? t("institutions.resetService.error") : t("dialog.resetError")), variant: "destructive" }); return; }
      setDone(true);
    } catch {
      toast({ title: isService ? t("institutions.resetService.connectionError") : t("dialog.connectionRetry"), variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const copyCredentials = () => {
    navigator.clipboard.writeText(isService ? t("institutions.resetService.clipboard", { password: senha }) : `DocKnee — Acesso\nSenha temporária: ${senha}\n\nAcesse: dockneeapp.com e faça login com seu e-mail.`).then(() => {
      setCopied(true); setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full sm:max-w-md bg-card rounded-t-2xl sm:rounded-2xl shadow-2xl border border-border max-h-[90dvh] overflow-y-auto">
        <div className="sticky top-0 bg-card border-b border-border px-5 py-4 flex items-center justify-between rounded-t-2xl z-10">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-blue-100 flex items-center justify-center">
              <KeyRound className="h-4 w-4 text-blue-700" />
            </div>
            <div>
               <p className="text-sm font-bold text-foreground">{isService ? t("institutions.resetService.title") : t("dialog.resetPassword")}</p>
              <p className="text-xs text-muted-foreground">{doctorNome}</p>
            </div>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 hover:bg-muted transition-colors"><X className="h-4 w-4 text-muted-foreground" /></button>
        </div>

        <div className="px-5 py-5">
          {done ? (
            <div className="space-y-4">
              <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-4 text-center">
                <CheckCircle className="h-8 w-8 text-emerald-600 mx-auto mb-2" />
                 <p className="text-sm font-semibold text-emerald-800">{isService ? t("institutions.resetService.success") : t("dialog.passwordReset")}</p>
                <p className="text-xs text-emerald-700 mt-1">{isService ? t("institutions.resetService.successDescription") : t("dialog.resetSuccessDescription")}</p>
              </div>
              <div className="rounded-lg border border-border bg-muted/50 px-4 py-3 text-center">
                <p className="text-xs text-muted-foreground mb-1">{isService ? t("institutions.resetService.temporaryPassword") : t("dialog.temporaryPassword")}</p>
                <p className="text-xl font-mono font-bold tracking-widest text-foreground">{senha}</p>
              </div>
              <Button className="w-full gap-2" onClick={copyCredentials}>
                 {copied ? <><Check className="h-4 w-4" /> {isService ? t("institutions.resetService.copied") : t("dialog.copied")}</> : <><Copy className="h-4 w-4" /> {isService ? t("institutions.resetService.copyInstructions") : t("dialog.copyInstructions")}</>}
              </Button>
               <Button variant="outline" className="w-full" onClick={onClose}>{isService ? t("institutions.resetService.close") : t("close")}</Button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <p className="text-sm text-muted-foreground">
                {isService ? t("institutions.resetService.description") : t("dialog.resetDescription")}
              </p>
              <div>
                 <label className={labelCls}>{isService ? t("institutions.resetService.newPassword") : t("dialog.newPassword")}</label>
                <div className="relative">
                  <input
                    type={showSenha ? "text" : "password"}
                    className={inputCls + " pr-9"}
                    value={senha}
                    onChange={e => setSenha(e.target.value)}
                    placeholder={isService ? t("institutions.resetService.minimumCharacters") : t("dialog.minimumCharacters")}
                  />
                  <button type="button" className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" onClick={() => setShowSenha(v => !v)}>
                    {showSenha ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
              <Button type="submit" className="w-full gap-2" disabled={loading}>
                {loading ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <KeyRound className="h-3.5 w-3.5" />}
                 {loading ? (isService ? t("institutions.resetService.resetting") : t("dialog.resetting")) : (isService ? t("institutions.resetService.submit") : t("dialog.confirmPassword"))}
              </Button>
               <Button type="button" variant="outline" className="w-full" onClick={onClose}>{isService ? t("institutions.resetService.cancel") : t("cancel")}</Button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

type AdminDoctorEditForm = typeof EDIT_EMPTY_FORM;

export function AdminEditDoctorDialog({
  doctorId,
  doctorNome,
  onClose,
  onSuccess,
}: {
  doctorId: number;
  doctorNome: string;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const t = useScopedTranslations(adminConsoleMessages);
  const { toast } = useToast();
  const [form, setForm] = useState<AdminDoctorEditForm>(EDIT_EMPTY_FORM);
  const [loadingDoctor, setLoadingDoctor] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoadingDoctor(true);
    fetch(`/api/doctors/${doctorId}`, { credentials: "same-origin" })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? t("dialog.loadError"));
        if (!active) return;
        setForm({
          nome: data.nome ?? "",
          email: data.email ?? "",
          crm: data.crm ?? "",
          crmEstado: data.crmEstado ?? "",
          cpf: data.cpf ?? "",
          telefone: data.telefone ?? "",
          estrangeiro: Boolean(data.estrangeiro),
          paisOrigem: data.paisOrigem ?? "",
          dataNascimento: data.dataNascimento ?? "",
          endereco: data.endereco ?? "",
          cidade: data.cidade ?? "",
          estado: data.estado ?? "",
          cep: data.cep ?? "",
          especialidade: data.especialidade ?? "",
          idioma: data.idioma === "es" ? "es" : "pt-BR",
          whatsappBusiness: data.whatsappBusiness ?? "",
        });
      })
      .catch((loadError) => {
        if (active) setError(loadError instanceof Error ? loadError.message : t("dialog.loadError"));
      })
      .finally(() => {
        if (active) setLoadingDoctor(false);
      });
    return () => { active = false; };
  }, [doctorId, t]);

  const set = <K extends keyof AdminDoctorEditForm>(key: K, value: AdminDoctorEditForm[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
  };
  const inputCls = "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50";
  const labelCls = "block text-xs font-semibold text-muted-foreground mb-1";

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const response = await fetch(`/api/admin/doctors/${doctorId}/profile`, {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? t("dialog.saveError"));
      toast({ title: t("dialog.saved") });
      onSuccess();
      onClose();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : t("dialog.saveError"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative max-h-[94dvh] w-full overflow-y-auto rounded-t-2xl border border-border bg-card shadow-2xl sm:max-w-2xl sm:rounded-2xl">
        <div className="sticky top-0 z-10 flex items-center justify-between rounded-t-2xl border-b border-border bg-card px-5 py-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-100">
              <Pencil className="h-4 w-4 text-blue-700" />
            </div>
            <div>
              <p className="text-sm font-bold text-foreground">{t("dialog.editDoctor")}</p>
              <p className="text-xs text-muted-foreground">{doctorNome}</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 hover:bg-muted transition-colors" aria-label={t("close")}>
            <X className="h-4 w-4 text-muted-foreground" />
          </button>
        </div>

        {loadingDoctor ? (
          <div className="px-5 py-10 text-center text-sm text-muted-foreground">{t("dialog.loading")}</div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-5 px-5 py-5">
            {error && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

            <div className="space-y-3">
              <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{t("dialog.professionalData")}</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <label className={labelCls}>{t("dialog.fullName")}</label>
                  <input className={inputCls} required minLength={2} value={form.nome} onChange={(e) => set("nome", e.target.value)} />
                </div>
                <div>
                  <label className={labelCls}>{t("dialog.email")}</label>
                  <input className={inputCls} required type="email" value={form.email} onChange={(e) => set("email", e.target.value)} />
                </div>
                <div>
                  <label className={labelCls}>{t("dialog.specialty")}</label>
                  <input className={inputCls} value={form.especialidade} onChange={(e) => set("especialidade", e.target.value)} />
                </div>
                <div className="sm:col-span-2">
                  <label className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
                    <input type="checkbox" checked={form.estrangeiro} onChange={(e) => set("estrangeiro", e.target.checked)} />
                    {t("dialog.foreignDoctor")}
                  </label>
                </div>
                {form.estrangeiro ? (
                  <div className="sm:col-span-2">
                    <label className={labelCls}>{t("dialog.originCountry")}</label>
                    <input className={inputCls} value={form.paisOrigem} onChange={(e) => set("paisOrigem", e.target.value)} />
                  </div>
                ) : (
                  <>
                    <div>
                      <label className={labelCls}>{t("dialog.crmNumber")}</label>
                      <input className={inputCls} value={form.crm} onChange={(e) => set("crm", e.target.value)} />
                    </div>
                    <div>
                      <label className={labelCls}>{t("dialog.crmState")}</label>
                      <select className={inputCls} value={form.crmEstado} onChange={(e) => set("crmEstado", e.target.value)}>
                        <option value="">—</option>
                        {UF_LIST.map((uf) => <option key={uf} value={uf}>{uf}</option>)}
                      </select>
                    </div>
                  </>
                )}
              </div>
            </div>

            <div className="space-y-3">
              <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{t("dialog.personalData")}</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className={labelCls}>{t("dialog.cpf")}</label>
                  <input className={inputCls} inputMode="numeric" value={form.cpf} onChange={(e) => set("cpf", e.target.value)} />
                </div>
                <div>
                  <label className={labelCls}>{t("dialog.birthDate")}</label>
                  <input className={inputCls} type="date" value={form.dataNascimento} onChange={(e) => set("dataNascimento", e.target.value)} />
                </div>
                <div>
                  <label className={labelCls}>{t("dialog.phone")}</label>
                  <input className={inputCls} value={form.telefone} onChange={(e) => set("telefone", e.target.value)} />
                </div>
                <div>
                  <label className={labelCls}>{t("dialog.whatsappBusiness")}</label>
                  <input className={inputCls} value={form.whatsappBusiness} onChange={(e) => set("whatsappBusiness", e.target.value)} />
                </div>
              </div>
            </div>

            <div className="space-y-3">
              <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{t("dialog.address")}</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <label className={labelCls}>{t("dialog.street")}</label>
                  <input className={inputCls} value={form.endereco} onChange={(e) => set("endereco", e.target.value)} />
                </div>
                <div>
                  <label className={labelCls}>{t("dialog.city")}</label>
                  <input className={inputCls} value={form.cidade} onChange={(e) => set("cidade", e.target.value)} />
                </div>
                <div>
                  <label className={labelCls}>{t("dialog.state")}</label>
                  <select className={inputCls} value={form.estado} onChange={(e) => set("estado", e.target.value)}>
                    <option value="">—</option>
                    {UF_LIST.map((uf) => <option key={uf} value={uf}>{uf}</option>)}
                  </select>
                </div>
                <div>
                  <label className={labelCls}>{t("dialog.zip")}</label>
                  <input className={inputCls} value={form.cep} onChange={(e) => set("cep", e.target.value)} />
                </div>
                <div>
                  <label className={labelCls}>{t("dialog.language")}</label>
                  <select className={inputCls} value={form.idioma} onChange={(e) => set("idioma", e.target.value as AdminDoctorEditForm["idioma"])}>
                    <option value="pt-BR">Português (Brasil)</option>
                    <option value="es">Español</option>
                  </select>
                </div>
              </div>
            </div>

            <div className="flex flex-col-reverse gap-2 border-t border-border pt-4 sm:flex-row sm:justify-end">
              <Button type="button" variant="outline" onClick={onClose}>{t("cancel")}</Button>
              <Button type="submit" disabled={saving} className="gap-2">
                {saving && <RefreshCw className="h-3.5 w-3.5 animate-spin" />}
                {saving ? t("dialog.saving") : t("dialog.saveChanges")}
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}