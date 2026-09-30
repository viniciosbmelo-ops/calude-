import { Switch, Route, Router as WouterRouter, Redirect } from "wouter";
import { useEffect } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as SonnerToaster } from "sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/lib/auth";
import { LanguageProvider } from "@/lib/i18n";
import { SecretaryAuthProvider } from "@/lib/secretary-auth";
import { ServiceAuthProvider } from "@/lib/service-auth";
import { ThemeProvider } from "@/lib/theme";
import { AppLayout } from "@/components/layout/app-layout";
import NotFound from "@/pages/not-found";
import Home from "@/pages/home";
import Login from "@/pages/login";
import Register from "@/pages/register";
import Dashboard from "@/pages/dashboard";
import PatientsList from "@/pages/patients";
import NewPatient from "@/pages/patients/new";
import PatientDetail from "@/pages/patients/[id]";
import SurgeriesList from "@/pages/surgeries";
import NewSurgeryWizard from "@/pages/surgeries/new";
import SurgeryDetail from "@/pages/surgeries/[id]";
// Replace the old admin import with the new modular one
import AdminDashboard from "@/pages/admin/index";
import AdminDoctorView from "@/pages/admin-doctor";
import PendingApproval from "@/pages/pending-approval";
import Profile from "@/pages/profile";
import Reports from "@/pages/reports";
import PatientScales from "@/pages/patient/[token]";
import PreConsultPatientFlow from "@/pages/pre-consulta/[token]";
import RegenPatientPage from "@/pages/patient/regen-token";
import OrientacoesPaciente from "@/pages/patient/orientacoes-paciente";
import ForgotPassword from "@/pages/forgot-password";
import ResetPasswordToken from "@/pages/reset-password-token";
import Sucesso from "@/pages/sucesso";
import AssinaturaCancelada from "@/pages/assinatura-cancelada";
import RegenDashboard from "@/pages/regen/index";
import RegenNovo from "@/pages/regen/novo";
import RegenCaso from "@/pages/regen/caso";
import RegenPesquisa from "@/pages/regen/pesquisa";
import RegenConsentimento from "@/pages/regen/consentimento";
import RegenOrientacoes from "@/pages/regen/orientacoes";
import FollowupCentral from "@/pages/followup-central";
import WhatsappBroadcast from "@/pages/whatsapp-broadcast";
import SecretaryLogin from "@/pages/secretary/login";
import SecretaryDashboard from "@/pages/secretary/dashboard";
import ServiceLogin from "@/pages/service/login";
import ServiceDashboard from "@/pages/service/dashboard";
import AgendaPage from "@/pages/agenda";
import AgendaCirurgica from "@/pages/agenda-cirurgica";
import { ErrorBoundary } from "@/components/error-boundary";
import { RouteErrorBoundary } from "@/components/route-error-boundary";
import PWAInstallPrompt from "@/components/PWAInstallPrompt";
import { ProductAnalytics } from "@/components/ProductAnalytics";
import { PdfViewerOverlay } from "@/components/pdf-viewer-overlay";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (failureCount, error: unknown) => {
        if (error instanceof Error && "status" in error) {
          const status = (error as { status: number }).status;
          if (status === 401 || status === 403 || status === 404) return false;
        }
        return failureCount < 2;
      },
      staleTime: 30_000,
    },
  },
});

function ProtectedRoute({ component: Component, adminOnly = false, allowPending = false, noLayout = false }: { component: any, adminOnly?: boolean, allowPending?: boolean, noLayout?: boolean }) {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return <div className="min-h-screen flex items-center justify-center">Carregando...</div>;
  }

  if (!user) {
    return <Redirect to={`${import.meta.env.BASE_URL}login`.replace(/\/\//g, "/")} />;
  }

  // Non-approved, non-admin doctors can only see pending-approval page
  if (!allowPending && !user.isAdmin && !(user as any).aprovado) {
    return <Redirect to={`${import.meta.env.BASE_URL}pending-approval`.replace(/\/\//g, "/")} />;
  }

  if (adminOnly && !user.isAdmin) {
    return <NotFound />;
  }

  // Admin must stay in admin section — no access to doctor-only pages
  if (!adminOnly && user.isAdmin) {
    return <Redirect to={`${import.meta.env.BASE_URL}admin`.replace(/\/\//g, "/")} />;
  }

  if (noLayout) {
    return <Component />;
  }

  return (
    <AppLayout>
      <RouteErrorBoundary>
        <Component />
      </RouteErrorBoundary>
    </AppLayout>
  );
}

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/login" component={Login} />
      <Route path="/register" component={Register} />

      <Route path="/dashboard" component={() => <ProtectedRoute component={Dashboard} />} />
      <Route path="/patients" component={() => <ProtectedRoute component={PatientsList} />} />
      <Route path="/patients/new" component={() => <ProtectedRoute component={NewPatient} />} />
      <Route path="/patients/:id" component={() => <ProtectedRoute component={PatientDetail} />} />

      <Route path="/surgeries" component={() => <ProtectedRoute component={SurgeriesList} />} />
      <Route path="/surgeries/new" component={() => <ProtectedRoute component={NewSurgeryWizard} />} />
      <Route path="/surgeries/:id" component={() => <ProtectedRoute component={SurgeryDetail} />} />

      <Route path="/agenda" component={() => <ProtectedRoute component={AgendaPage} />} />
      <Route path="/agenda-cirurgica" component={() => <ErrorBoundary><ProtectedRoute component={AgendaCirurgica} /></ErrorBoundary>} />
      <Route path="/patient/regen/:token" component={RegenPatientPage} />
      <Route path="/orientacoes-paciente" component={OrientacoesPaciente} />
      <Route path="/regen" component={() => <ProtectedRoute component={RegenDashboard} />} />
      <Route path="/regen/caso/novo" component={() => <ProtectedRoute component={RegenNovo} />} />
      <Route path="/regen/caso/:id" component={() => <ProtectedRoute component={RegenCaso} />} />
      <Route path="/regen/pesquisa" component={() => <ProtectedRoute component={RegenPesquisa} />} />
      <Route path="/regen/consentimento" component={() => <ProtectedRoute component={RegenConsentimento} />} />
      <Route path="/regen/orientacoes" component={() => <ProtectedRoute component={RegenOrientacoes} />} />
      <Route path="/followup-central" component={() => <ProtectedRoute component={FollowupCentral} />} />
      <Route path="/followup" component={() => <ProtectedRoute component={FollowupCentral} />} />
      <Route path="/whatsapp-broadcast" component={() => <ProtectedRoute component={WhatsappBroadcast} />} />
      <Route path="/reports" component={() => <ProtectedRoute component={Reports} />} />
      <Route path="/profile" component={() => <ProtectedRoute component={Profile} />} />
      <Route path="/pending-approval" component={() => <ProtectedRoute component={PendingApproval} allowPending />} />
      {/* Admin Route - Custom Layout injected by AdminDashboard */}
      <Route path="/admin" component={() => <ProtectedRoute component={AdminDashboard} adminOnly noLayout />} />
      {/* Admin Doctor View uses the AppLayout still to preserve styling */}
      <Route path="/admin/doctors/:id" component={() => <ProtectedRoute component={AdminDoctorView} adminOnly />} />

      {/* Public routes — no auth required */}
      <Route path="/forgot-password" component={ForgotPassword} />
      <Route path="/redefinir-senha" component={ResetPasswordToken} />
      <Route path="/sucesso" component={Sucesso} />
      <Route path="/assinatura-cancelada" component={AssinaturaCancelada} />
      <Route path="/patient/:token" component={PatientScales} />
      <Route path="/pre-consulta/:token" component={PreConsultPatientFlow} />

      {/* Secretary routes — independent auth */}
      <Route path="/secretary/login" component={SecretaryLogin} />
      <Route path="/secretary/dashboard" component={SecretaryDashboard} />

      {/* Service (institutional) routes — independent auth */}
      <Route path="/service/login" component={ServiceLogin} />
      <Route path="/service/dashboard" component={ServiceDashboard} />

      <Route component={NotFound} />
    </Switch>
  );
}

function VisitTracker() {
  useEffect(() => {
    const path = window.location.pathname;
    fetch("/api/stats/visit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path }),
    }).catch(() => {});
  }, []);
  return null;
}

function App() {
  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <AuthProvider>
            <LanguageProvider>
              <SecretaryAuthProvider>
                <ServiceAuthProvider>
                  <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
                    <ProductAnalytics />
                    <RouteErrorBoundary>
                      <Router />
                    </RouteErrorBoundary>
                  </WouterRouter>
                </ServiceAuthProvider>
              </SecretaryAuthProvider>
            </LanguageProvider>
          </AuthProvider>
          <VisitTracker />
          <Toaster />
          <SonnerToaster position="top-center" richColors />
          <PWAInstallPrompt />
          <PdfViewerOverlay />
        </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}

export default App;
