import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Clock, Mail, LogOut } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useScopedTranslations, type ScopedMessages } from "@/lib/i18n";

export const pendingApprovalMessages = {
  "pt-BR": {
    title: "Cadastro em análise",
    greeting: "Olá,",
    doctorFallback: "Doutor(a)",
    received: "Seu cadastro foi recebido com sucesso e está aguardando a aprovação da administração da plataforma.",
    nextSteps: "O que acontece agora?",
    verifyCrm: "A administração irá verificar seus dados de CRM",
    accessNotification: "Você receberá uma notificação quando seu acesso for liberado",
    reviewTime: "O processo normalmente leva até 24 horas úteis",
    crmContact: "Em caso de dúvidas, entre em contato com a administração informando seu CRM.",
    logout: "Sair",
  },
  es: {
    title: "Registro en revisión",
    greeting: "Hola,",
    doctorFallback: "Doctor(a)",
    received: "Su registro se recibió correctamente y está pendiente de aprobación por parte de la administración de la plataforma.",
    nextSteps: "¿Qué sucede ahora?",
    verifyCrm: "La administración verificará los datos de su CRM",
    accessNotification: "Recibirá una notificación cuando se habilite su acceso",
    reviewTime: "El proceso suele tardar hasta 24 horas hábiles",
    crmContact: "Si tiene alguna duda, contacte a la administración e indique su CRM.",
    logout: "Salir",
  },
} as const satisfies ScopedMessages<Record<string, string>>;

export default function PendingApproval() {
  const { user, logout } = useAuth();
  const t = useScopedTranslations(pendingApprovalMessages);

  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ background: "#f0f4f8" }}>
      <Card className="w-full max-w-md shadow-lg border-border/60 bg-white text-center">
        <CardHeader className="pb-2">
          <div className="flex justify-center mb-4">
            <img
              src={`${import.meta.env.BASE_URL}logo-docregen.png`}
              alt="DocRegen"
              className="h-12 w-auto object-contain"
            />
          </div>
          <div className="flex justify-center mb-3">
            <div className="h-16 w-16 rounded-full bg-amber-100 flex items-center justify-center">
              <Clock className="h-8 w-8 text-amber-600" />
            </div>
          </div>
          <h1 className="text-xl font-bold" style={{ color: "#0B1F4B" }} data-testid="status-pending-approval">
            {t("title")}
          </h1>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-muted-foreground text-sm leading-relaxed" data-testid="text-approval-summary">
            {t("greeting")} <strong data-testid="text-doctor-name">{user?.nome ?? t("doctorFallback")}</strong>!<br />
            {t("received")}
          </p>

          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-left">
            <p className="text-xs text-amber-800 font-medium mb-1">{t("nextSteps")}</p>
            <ul className="text-xs text-amber-700 space-y-1 list-disc list-inside">
              <li>{t("verifyCrm")}</li>
              <li>{t("accessNotification")}</li>
              <li>{t("reviewTime")}</li>
            </ul>
          </div>

          <div className="flex items-center gap-2 rounded-lg border border-border/60 bg-muted/30 p-3 text-left">
            <Mail className="h-4 w-4 text-muted-foreground flex-shrink-0" />
            <p className="text-xs text-muted-foreground">
              {t("crmContact")}
            </p>
          </div>

          <Button
            variant="outline"
            className="w-full mt-2"
            onClick={() => logout()}
            data-testid="button-logout"
          >
            <LogOut className="h-4 w-4 mr-2" />
            {t("logout")}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
