import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Eye, EyeOff, Building2 } from "lucide-react";
import { useServiceAuth } from "@/lib/service-auth";
import { useLanguage, useScopedTranslations } from "@/lib/i18n";
import { consoleMessages } from "@/locales/console";

export default function ServiceLogin() {
  const [, setLocation] = useLocation();
  const { setAuth } = useServiceAuth();
  const { toast } = useToast();
  const { setLanguage } = useLanguage();
  const t = useScopedTranslations(consoleMessages);
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [showSenha, setShowSenha] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { void setLanguage("pt-BR"); }, [setLanguage]);

  const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!email || !senha) { setError(t("completeFields")); return; }
    setLoading(true);
    try {
      const res = await fetch(`${BASE}/api/service-auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, senha }),
      });
      const data = await res.json();
      if (!res.ok) { setError(t("invalidCredentials")); return; }
      setAuth(data.service);
      await setLanguage(data.service?.idioma === "es" ? "es" : "pt-BR");
      toast({ title: t("welcome", { name: data.service.nome }) });
      setLocation("/service/dashboard");
    } catch {
      setError(t("connectionError"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[#0A1628] via-[#112240] to-[#0d2137] px-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          <div className="w-14 h-14 rounded-2xl bg-primary/20 flex items-center justify-center mb-4 border border-primary/30">
            <Building2 className="h-7 w-7 text-primary" />
          </div>
          <h1 className="text-2xl font-bold text-white">DocKnee</h1>
          <p className="text-sm text-slate-400 mt-1">{t("serviceAccess")}</p>
        </div>

        {/* Card */}
        <div className="bg-slate-800/60 backdrop-blur border border-slate-700/50 rounded-2xl p-6 shadow-2xl">
          <h2 className="text-lg font-semibold text-white mb-1">{t("serviceSignIn")}</h2>
          <p className="text-xs text-slate-400 mb-5">{t("serviceIntro")}</p>

          {error && (
            <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-sm text-red-400">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-sm text-slate-300">{t("serviceEmail")}</Label>
              <Input
                type="email"
                placeholder="servico@dockneeapp.com"
                value={email}
                onChange={e => setEmail(e.target.value)}
                className="bg-slate-900/60 border-slate-600 text-white placeholder:text-slate-500 focus:border-primary"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm text-slate-300">{t("password")}</Label>
              <div className="relative">
                <Input
                  type={showSenha ? "text" : "password"}
                  placeholder="••••••••"
                  value={senha}
                  onChange={e => setSenha(e.target.value)}
                  className="bg-slate-900/60 border-slate-600 text-white placeholder:text-slate-500 focus:border-primary pr-10"
                />
                <button type="button" onClick={() => setShowSenha(p => !p)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200">
                  {showSenha ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <Button type="submit" disabled={loading} className="w-full h-11 font-semibold">
              {loading ? t("signingIn") : t("signIn")}
            </Button>
          </form>
        </div>

        <div className="text-center mt-6">
          <a href="/login" className="text-xs text-slate-500 hover:text-slate-300 transition-colors">
            {t("doctorLoginBack")}
          </a>
        </div>
      </div>
    </div>
  );
}
