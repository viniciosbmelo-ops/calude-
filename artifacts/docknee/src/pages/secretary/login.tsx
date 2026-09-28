import { useState } from "react";
import { useLocation } from "wouter";
import { useSecretaryAuth } from "@/lib/secretary-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useTheme } from "@/lib/theme";
import { Eye, EyeOff } from "lucide-react";
import { useEffect } from "react";
import { useLanguage, useScopedTranslations } from "@/lib/i18n";
import { consoleMessages } from "@/locales/console";

export default function SecretaryLogin() {
  const [, navigate] = useLocation();
  const { login } = useSecretaryAuth();
  const { theme } = useTheme();
  const { setLanguage } = useLanguage();
  const t = useScopedTranslations(consoleMessages);
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [passwordWarning, setPasswordWarning] = useState(false);

  useEffect(() => { void setLanguage("pt-BR"); }, [setLanguage]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (senha.length > 0 && senha.length < 6) {
      setPasswordWarning(true);
      return;
    }
    setPasswordWarning(false);
    setLoading(true);
    try {
      const res = await fetch("/api/secretary-auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, senha }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(t("invalidCredentials"));
        return;
      }
      login(data.secretary);
      await setLanguage(data.secretary?.idioma === "es" ? "es" : "pt-BR");
      navigate("/secretary/dashboard");
    } catch {
      setError(t("connectionError"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center gap-3">
          <img
            src={`${import.meta.env.BASE_URL}${theme === "dark" ? "logo-docknee-white-transparent.png" : "logo-docknee-final.png"}`}
            alt="DocKnee"
            className="h-10 w-auto object-contain"
          />
          <div className="text-center">
            <h1 className="text-xl font-bold text-foreground">{t("secretaryAccess")}</h1>
            <p className="text-sm text-muted-foreground mt-1">{t("secretaryIntro")}</p>
          </div>
        </div>

        <Card className="shadow-md">
          <CardContent className="pt-6">
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="email">{t("email")}</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="secretaria@clinica.com.br"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="senha">{t("password")}</Label>
                <div className="relative">
                  <Input
                    id="senha"
                    type={showPassword ? "text" : "password"}
                    placeholder="••••••••"
                    value={senha}
                    onChange={e => {
                      const value = e.target.value;
                      setSenha(value);
                      setPasswordWarning(value.length > 0 && value.length < 6);
                    }}
                    required
                    aria-describedby="secretary-password-hint"
                    className="pr-10"
                  />
                  <button
                    type="button"
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                    onClick={() => setShowPassword(v => !v)}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                <p id="secretary-password-hint" className={`text-xs ${passwordWarning ? "text-amber-600" : "text-muted-foreground"}`}>
                  {t("passwordTooShort")}
                </p>
              </div>

              {error && (
                <p className="text-sm text-destructive font-medium">{error}</p>
              )}

              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? t("signingIn") : t("signIn")}
              </Button>
            </form>
          </CardContent>
        </Card>

        <p className="text-center text-xs text-muted-foreground">
          {t("doctorQuestion")}{" "}
          <a href="/login" className="underline text-primary font-medium">{t("doctorLogin")}</a>
        </p>
      </div>
    </div>
  );
}
