import { ReactNode } from "react";
import { useLocation } from "wouter";
import { usePhysioAuth } from "@/lib/physio-auth";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/lib/theme";
import { useQuery } from "@tanstack/react-query";
import { physioFetch } from "@/lib/physio-auth";
import { LogOut, LayoutDashboard, Users, CalendarDays, Crown, AlertTriangle } from "lucide-react";
import { useLanguage, useScopedTranslations } from "@/lib/i18n";
import { physioMessages } from "@/locales/physio";

export default function FisioShell({ children }: { children: ReactNode }) {
  const [location, navigate] = useLocation();
  const { physio, isLoading, logout } = usePhysioAuth();
  const { theme } = useTheme();
  const { locale, setLanguage } = useLanguage();
  const t = useScopedTranslations(physioMessages);

  const { data: billing } = useQuery<{ subscriptionStatus: string; readOnly: boolean }>({
    queryKey: ["physio-billing-status"],
    enabled: !!physio,
    staleTime: 60_000,
    queryFn: async () => {
      const res = await physioFetch("/api/physio/billing/status");
      if (!res.ok) throw new Error("status");
      return res.json();
    },
  });

  if (isLoading) {
    return <div className="min-h-screen flex items-center justify-center text-muted-foreground">{t("loading")}</div>;
  }
  if (!physio) {
    navigate("/fisio/login");
    return null;
  }

  const navItems = [
    { label: t("dashboard"), path: "/fisio/dashboard", Icon: LayoutDashboard },
    { label: t("patients"), path: "/fisio/pacientes", Icon: Users },
    { label: t("agenda"), path: "/fisio/agenda", Icon: CalendarDays },
    { label: t("plans"), path: "/fisio/planos", Icon: Crown },
  ];

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img
              src={`${import.meta.env.BASE_URL}${theme === "dark" ? "logo-docknee-white-transparent.png" : "logo-docknee-final.png"}`}
              alt="DocKnee"
              className="h-7 w-auto object-contain cursor-pointer"
              onClick={() => navigate("/fisio/dashboard")}
            />
            <span className="hidden sm:inline text-xs font-semibold uppercase tracking-wider" style={{ color: "#1FB6E1" }}>
              {t("physiotherapist")}
            </span>
          </div>
          <nav className="flex items-center gap-1">
            <select
              value={locale}
              onChange={(event) => void setLanguage(event.target.value as "pt-BR" | "es")}
              aria-label={t("physiotherapist")}
              className="hidden sm:block h-8 rounded-md border border-border bg-background px-2 text-xs text-foreground"
              data-testid="select-physio-language"
            >
              <option value="pt-BR">Português (Brasil)</option>
              <option value="es">Español</option>
            </select>
            {navItems.map(({ label, path, Icon }) => (
              <Button
                key={path}
                variant={location.startsWith(path) ? "secondary" : "ghost"}
                size="sm"
                onClick={() => navigate(path)}
                className="gap-1.5"
                data-testid={`nav-${label.toLowerCase()}`}
              >
                <Icon className="h-4 w-4" />
                <span className="hidden sm:inline">{label}</span>
              </Button>
            ))}
            <Button variant="ghost" size="sm" onClick={logout} className="gap-1.5 text-muted-foreground" data-testid="button-logout">
              <LogOut className="h-4 w-4" />
            </Button>
          </nav>
        </div>
      </header>
      {billing?.readOnly && (
        <div className="bg-amber-500/10 border-b border-amber-500/30">
          <div className="max-w-5xl mx-auto px-4 py-2 flex items-center gap-2" data-testid="banner-readonly">
            <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
            <p className="text-xs text-foreground">
              {billing.subscriptionStatus === "past_due"
                ? t("paymentPending")
                : t("subscriptionCanceled")}
            </p>
            <Button size="sm" variant="outline" className="ml-auto h-7 text-xs" onClick={() => navigate("/fisio/planos")} data-testid="button-regularizar">
              {t("regularize")}
            </Button>
          </div>
        </div>
      )}
      <main className="max-w-5xl mx-auto px-4 py-6">{children}</main>
    </div>
  );
}
