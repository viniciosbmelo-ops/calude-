import { useState, useEffect } from "react";
import { AdminLayout } from "./layout";
import { Overview } from "./components/overview";
import { ClinicalStaff } from "./components/clinical-staff";
import { Institutions } from "./components/institutions";
import { Support } from "./components/support";
import { GrowthContent } from "./components/growth-content";
import { ComplianceSecurity } from "./components/compliance-security";
import { WhatsappCrm } from "./components/whatsapp-crm";
import { DecisionGovernance } from "@/pages/apoio-decisao/governanca";
import Reports from "@/pages/reports";
import { useAuth } from "@/lib/auth";
import { Redirect } from "wouter";
import { useScopedTranslations } from "@/lib/i18n";
import { adminConsoleMessages } from "@/locales/admin-console";

export default function AdminDashboard() {
  const { user, isLoading } = useAuth();
  const t = useScopedTranslations(adminConsoleMessages);
  const [activeSection, setActiveSection] = useState("overview");

  // Reset scroll on section change
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [activeSection]);

  if (isLoading) return <div className="min-h-screen flex items-center justify-center">{t("loading")}</div>;
  if (!user?.isAdmin) return <Redirect to="/" />;

  const renderContent = () => {
    switch (activeSection) {
      case "overview": return <Overview />;
      case "clinical-staff": return <ClinicalStaff />;
      case "institutions": return <Institutions />;
      case "support": return <Support />;
      case "growth-content": return <GrowthContent />;
      case "compliance-security": return <ComplianceSecurity />;
      case "whatsapp": return <WhatsappCrm />;
      case "decision-support": return <DecisionGovernance />;
      case "reports": return <div className="bg-background rounded-xl"><Reports /></div>;
      default: return <Overview />;
    }
  };

  return (
    <AdminLayout activeSection={activeSection} onSectionChange={setActiveSection}>
      {renderContent()}
    </AdminLayout>
  );
}
