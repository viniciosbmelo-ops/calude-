import { Switch, Route, Router as WouterRouter, Redirect } from "wouter";
import { useEffect, type ComponentType } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as SonnerToaster } from "sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/lib/auth";
import { LanguageProvider } from "@/lib/i18n";
import { ThemeProvider } from "@/lib/theme";
import { SecretaryAuthProvider } from "@/lib/secretary-auth";
import { AppLayout } from "@/components/layout/app-layout";
import NotFound from "@/pages/not-found";
import Login from "@/pages/login";
import Register from "@/pages/register";
import Dashboard from "@/pages/dashboard";
import PatientsList from "@/pages/patients";
import NewPatient from "@/pages/patients/new";
import PatientDetail from "@/pages/patients/[id]";
import PendingApproval from "@/pages/pending-approval";
import Profile from "@/pages/profile";
import RegenPatientPage from "@/pages/patient/regen-token";
import OrientacoesPaciente from "@/pages/patient/orientacoes-paciente";
import PreConsultPatientFlow from "@/pages/pre-consulta/[token]";
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
import Reports from "@/pages/reports";
import AgendaPage from "@/pages/agenda";
import SecretaryLogin from "@/pages/secretary/login";
import SecretaryDashboard from "@/pages/secretary/dashboard";
import PWAInstallPrompt from "@/components/PWAInstallPrompt";
import { ProductAnalytics } from "@/components/ProductAnalytics";
import { PdfViewerOverlay } from "@/components/pdf-viewer-overlay";
import { RouteErrorBoundary } from "@/components/route-error-boundary";

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

function AdminNotice() {
  const { logout } = useAuth();
  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-background">
      <div className="max-w-md text-center space-y-4">
        <img src={`${import.meta.env.BASE_URL}logo-docregen.png`} alt="DocRegen" className="h-12 mx-auto" />
        <p className="text-sm text-muted-foreground">
          O DocRegen é destinado aos médicos. A administração da plataforma continua disponível no console administrativo.
        </p>
        <button type="button" onClick={logout} className="text-sm font-semibold text-primary underline">
          Sair
        </button>
      </div>
    </div>
  );
}

function ProtectedRoute({ component: Component, allowPending = false }: { component: ComponentType, allowPending?: boolean }) {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return <div className="min-h-screen flex items-center justify-center">Carregando...</div>;
  }

  if (!user) {
    return <Redirect to="/login" />;
  }

  // Non-approved doctors can only see pending-approval page
  if (!allowPending && !user.isAdmin && !(user as { aprovado?: boolean }).aprovado) {
    return <Redirect to="/pending-approval" />;
  }

  if (user.isAdmin) {
    return <AdminNotice />;
  }

  return (
    <AppLayout>
      <RouteErrorBoundary>
        <Component />
      </RouteErrorBoundary>
    </AppLayout>
  );
}

function RootRedirect() {
  const { user, isLoading } = useAuth();
  if (isLoading) {
    return <div className="min-h-screen flex items-center justify-center">Carregando...</div>;
  }
  return <Redirect to={user ? "/dashboard" : "/login"} />;
}

function Router() {
  return (
    <Switch>
      <Route path="/" component={RootRedirect} />
      <Route path="/login" component={Login} />
      <Route path="/register" component={Register} />
      <Route path="/dashboard" component={() => <ProtectedRoute component={Dashboard} />} />

      <Route path="/regen" component={() => <ProtectedRoute component={RegenDashboard} />} />
      <Route path="/regen/caso/novo" component={() => <ProtectedRoute component={RegenNovo} />} />
      <Route path="/regen/caso/:id" component={() => <ProtectedRoute component={RegenCaso} />} />
      <Route path="/regen/pesquisa" component={() => <ProtectedRoute component={RegenPesquisa} />} />
      <Route path="/regen/consentimento" component={() => <ProtectedRoute component={RegenConsentimento} />} />
      <Route path="/regen/orientacoes" component={() => <ProtectedRoute component={RegenOrientacoes} />} />

      <Route path="/patients" component={() => <ProtectedRoute component={PatientsList} />} />
      <Route path="/patients/new" component={() => <ProtectedRoute component={NewPatient} />} />
      <Route path="/patients/:id" component={() => <ProtectedRoute component={PatientDetail} />} />

      <Route path="/agenda" component={() => <ProtectedRoute component={AgendaPage} />} />
      <Route path="/followup-central" component={() => <ProtectedRoute component={FollowupCentral} />} />
      <Route path="/followup" component={() => <ProtectedRoute component={FollowupCentral} />} />
      <Route path="/reports" component={() => <ProtectedRoute component={Reports} />} />
      <Route path="/profile" component={() => <ProtectedRoute component={Profile} />} />
      <Route path="/pending-approval" component={() => <ProtectedRoute component={PendingApproval} allowPending />} />

      {/* Public routes — no auth required */}
      <Route path="/forgot-password" component={ForgotPassword} />
      <Route path="/redefinir-senha" component={ResetPasswordToken} />
      <Route path="/sucesso" component={Sucesso} />
      <Route path="/assinatura-cancelada" component={AssinaturaCancelada} />
      <Route path="/patient/regen/:token" component={RegenPatientPage} />
      <Route path="/orientacoes-paciente" component={OrientacoesPaciente} />
      <Route path="/pre-consulta/:token" component={PreConsultPatientFlow} />

      {/* Secretary routes — independent auth */}
      <Route path="/secretary/login" component={SecretaryLogin} />
      <Route path="/secretary/dashboard" component={SecretaryDashboard} />

      <Route component={NotFound} />
    </Switch>
  );
}

function VisitTracker() {
  useEffect(() => {
    const path = window.location.pathname;
    fetch("/regen-api/stats/visit", {
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
                <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
                  <ProductAnalytics />
                  <RouteErrorBoundary>
                    <Router />
                  </RouteErrorBoundary>
                </WouterRouter>
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
