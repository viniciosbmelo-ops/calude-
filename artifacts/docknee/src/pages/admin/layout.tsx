import { useState } from "react";
import { useLocation } from "wouter";
import { LayoutDashboard, Users, Building2, Ticket, TrendingUp, Settings, ShieldCheck, FileText, ChevronRight, LogOut, MessageCircle, Scale } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth";
import { useScopedTranslations } from "@/lib/i18n";
import { adminConsoleMessages } from "@/locales/admin-console";

interface AdminLayoutProps {
  children: React.ReactNode;
  activeSection: string;
  onSectionChange: (section: string) => void;
}

const NAV_ITEMS = [
  { id: "overview", label: "nav.overview", icon: LayoutDashboard },
  { id: "clinical-staff", label: "nav.staff", icon: Users },
  { id: "institutions", label: "nav.institutions", icon: Building2 },
  { id: "support", label: "nav.support", icon: Ticket },
  { id: "growth-content", label: "nav.growth", icon: TrendingUp },
  { id: "compliance-security", label: "nav.compliance", icon: ShieldCheck },
  { id: "reports", label: "nav.reports", icon: FileText },
  { id: "whatsapp", label: "nav.whatsapp", icon: MessageCircle },
  { id: "decision-support", label: "nav.decisionSupport", icon: Scale },
] as const;

export function AdminLayout({ children, activeSection, onSectionChange }: AdminLayoutProps) {
  const { logout } = useAuth();
  const [, setLocation] = useLocation();
  const t = useScopedTranslations(adminConsoleMessages);

  const handleLogout = async () => {
    await logout();
    setLocation("/login");
  };

  return (
    <div className="min-h-screen bg-background flex flex-col md:flex-row">
      {/* Sidebar Desktop */}
      <aside className="hidden md:flex flex-col w-64 bg-sidebar border-r border-sidebar-border h-screen sticky top-0">
        <div className="p-6 border-b border-sidebar-border">
          <h1 className="text-lg font-bold text-sidebar-foreground tracking-tight flex items-center gap-2">
            <span className="bg-sidebar-primary text-sidebar-primary-foreground p-1 rounded">DK</span>
            DocSholder Admin
          </h1>
          <p className="text-xs text-sidebar-accent-foreground mt-1 opacity-70">{t("console.operational")}</p>
        </div>
        
        <div className="flex-1 overflow-y-auto py-4 px-3 space-y-1">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.id}
              onClick={() => onSectionChange(item.id)}
              className={cn(
                "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200",
                activeSection === item.id 
                  ? "bg-sidebar-primary/10 text-sidebar-primary shadow-sm"
                  : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              )}
            >
              <item.icon className="h-4 w-4" />
               {t(item.label)}
              {activeSection === item.id && <ChevronRight className="h-4 w-4 ml-auto" />}
            </button>
          ))}
        </div>

        <div className="p-4 border-t border-sidebar-border">
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-sidebar-foreground/70 hover:bg-destructive/10 hover:text-destructive transition-colors"
          >
            <LogOut className="h-4 w-4" />
            {t("admin.logout")}
          </button>
        </div>
      </aside>

      {/* Header Mobile */}
      <header className="md:hidden bg-sidebar p-4 flex items-center justify-between border-b border-sidebar-border sticky top-0 z-40">
        <div className="flex items-center gap-2">
          <span className="bg-sidebar-primary text-sidebar-primary-foreground p-1 rounded font-bold text-xs">DK</span>
          <span className="text-sm font-bold text-sidebar-foreground">{t("admin")}</span>
        </div>
        <select 
          className="bg-sidebar-accent text-sidebar-accent-foreground text-sm rounded border-none p-1.5 focus:ring-1 focus:ring-sidebar-primary outline-none"
          value={activeSection}
          onChange={(e) => onSectionChange(e.target.value)}
        >
          {NAV_ITEMS.map(item => (
            <option key={item.id} value={item.id}>{t(item.label)}</option>
          ))}
        </select>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 overflow-x-hidden relative min-w-0 bg-background">
        <div className="max-w-7xl mx-auto p-4 md:p-8 animate-in fade-in slide-in-from-bottom-2 duration-300">
          {children}
        </div>
      </main>
    </div>
  );
}
