import { useState } from "react";
import { useLocation, useSearch } from "wouter";
import { usePhysioAuth } from "@/lib/physio-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { useTheme } from "@/lib/theme";
import { Eye, EyeOff } from "lucide-react";
import { useScopedTranslations } from "@/lib/i18n";
import { physioMessages } from "@/locales/physio";

export default function FisioLogin() {
  const [, navigate] = useLocation();
  const search = useSearch();
  const { login } = usePhysioAuth();
  const { theme } = useTheme();
  const t = useScopedTranslations(physioMessages);
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/physio-auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, senha }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? t("loginError"));
        return;
      }
      login(data.physio);
      const params = new URLSearchParams(search);
      const inviteToken = params.get("convite");
      navigate(inviteToken ? `/fisio/convite/${inviteToken}` : "/fisio/dashboard");
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
            src={`${import.meta.env.BASE_URL}${theme === "dark" ? "logo-docsholder-white.png" : "logo-docsholder.png"}`}
            alt="DocSholder"
            className="h-10 w-auto object-contain"
          />
          <div className="text-center">
            <h1 className="text-xl font-bold text-foreground">{t("portal")}</h1>
            <p className="text-sm text-muted-foreground mt-1">{t("loginPrompt")}</p>
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
                  placeholder="voce@email.com"
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
                    onChange={e => setSenha(e.target.value)}
                    required
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
              </div>

              {error && <p className="text-sm text-destructive font-medium">{error}</p>}

              <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? t("signingIn") : t("signIn")}
              </Button>
            </form>
          </CardContent>
        </Card>

        <p className="text-center text-xs text-muted-foreground">
          {t("noAccount")}{" "}
          <button onClick={() => navigate(`/fisio${search ? `?${search}` : ""}`)} className="underline text-primary font-medium">{t("createFreeAccount")}</button>
        </p>
      </div>
    </div>
  );
}
