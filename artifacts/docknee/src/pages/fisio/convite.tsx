import { useEffect, useState } from "react";
import { useLocation, useParams } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { usePhysioAuth, physioFetch } from "@/lib/physio-auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useTheme } from "@/lib/theme";
import { useToast } from "@/hooks/use-toast";
import { CalendarDays, CheckCircle2, Stethoscope, User, XCircle } from "lucide-react";
import { useLanguage, useScopedTranslations } from "@/lib/i18n";
import { physioMessages, usePhysioClinicalLabel } from "@/locales/physio";

interface InviteInfo {
  status: string;
  doctorName: string | null;
  doctorCrm: string | null;
  patientInitials: string | null;
  procedureLabel: string | null;
  protocolCode: string | null;
  surgeryDate: string | null;
  expiresAt: string;
}

interface FollowupPreview {
  phase?: number | null;
  title: string;
  requiredAssessments?: string[];
  dueDate: string;
}

export default function FisioConvite() {
  const params = useParams<{ token: string }>();
  const token = params.token ?? "";
  const [, navigate] = useLocation();
  const { physio, isLoading: authLoading } = usePhysioAuth();
  const { theme } = useTheme();
  const { toast } = useToast();
  const { formatDate } = useLanguage();
  const t = useScopedTranslations(physioMessages);
  const clinicalLabel = usePhysioClinicalLabel();
  const [accepted, setAccepted] = useState<{ patientId: number; preview: FollowupPreview[] | null } | null>(null);
  const [paywall, setPaywall] = useState<{ checkoutUrl: string | null; message: string } | null>(null);

  useEffect(() => {
    if (!authLoading && !physio) {
      navigate(`/fisio/login?convite=${encodeURIComponent(token)}`, { replace: true });
    }
  }, [authLoading, physio, token, navigate]);

  const { data: invite, isLoading, error } = useQuery<InviteInfo>({
    queryKey: ["physio-invite", token],
    enabled: !!physio && !!token,
    retry: false,
    queryFn: async () => {
      const res = await physioFetch(`/api/physio/invites/${encodeURIComponent(token)}`);
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? t("inviteNotFound"));
      return body;
    },
  });

  const accept = useMutation({
    mutationFn: async () => {
      const res = await physioFetch("/api/physio/invites/accept", {
        method: "POST",
        body: JSON.stringify({ token }),
      });
      const body = await res.json();
      if (res.status === 402) {
        // Paywall: o convite NÃO foi consumido — só será aceito após o pagamento.
        setPaywall({
          checkoutUrl: body.checkoutUrl ?? null,
          message: body.message ?? t("subscribeForPatients"),
        });
        return null;
      }
      if (!res.ok) throw new Error(body.error ?? t("acceptInviteError"));
      return body as { careLinkId: number; patient: { id: number }; followupsPreview: FollowupPreview[] | null };
    },
    onSuccess: async (body) => {
      if (!body) return;
      if (body.followupsPreview && body.followupsPreview.length > 0) {
        try {
          await physioFetch(`/api/physio/patients/${body.patient.id}/confirm-protocol`, {
            method: "POST",
            body: JSON.stringify({ followups: body.followupsPreview, customized: false }),
          });
        } catch {
          // cronograma pode ser confirmado depois na tela do paciente
        }
      }
      setAccepted({ patientId: body.patient.id, preview: body.followupsPreview });
    },
    onError: (err: Error) => toast({ title: t("error"), description: err.message, variant: "destructive" }),
  });

  // Aceite automático assim que o convite pendente é carregado (deep link)
  const acceptMutate = accept.mutate;
  const acceptIdle = accept.isIdle;
  useEffect(() => {
    if (invite?.status === "pending" && acceptIdle) {
      acceptMutate();
    }
  }, [invite?.status, acceptIdle, acceptMutate]);

  if (authLoading) {
    return <div className="min-h-screen flex items-center justify-center text-muted-foreground text-sm">{t("loading")}</div>;
  }
  if (!physio) return null;

  const logo = `${import.meta.env.BASE_URL}${theme === "dark" ? "logo-docknee-white-transparent.png" : "logo-docknee-final.png"}`;

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background px-4 py-8">
      <div className="w-full max-w-md space-y-6">
        <div className="flex flex-col items-center gap-3">
          <img src={logo} alt="DocKnee" className="h-10 w-auto object-contain" />
          <h1 className="text-xl font-bold text-foreground text-center">{t("inviteTitle")}</h1>
        </div>

        {paywall ? (
          <Card data-testid="card-paywall">
            <CardContent className="pt-6 space-y-4 text-center">
              <p className="text-base font-semibold text-foreground">{t("freeLimitReached")}</p>
              <p className="text-sm text-muted-foreground">{paywall.message}</p>
              <p className="text-xs text-muted-foreground">
                {t("invitePreserved")}
              </p>
              {paywall.checkoutUrl ? (
                <Button
                  className="w-full bg-[#1FB6E1] hover:bg-[#199ec4] text-white"
                  onClick={() => { window.location.href = paywall.checkoutUrl!; }}
                  data-testid="button-paywall-checkout"
                >
                  {t("subscribeAndAccept")}
                </Button>
              ) : (
                <Button className="w-full" onClick={() => navigate("/fisio/planos")}>{t("viewPlans")}</Button>
              )}
              <Button variant="ghost" className="w-full" onClick={() => navigate("/fisio/dashboard")}>
                {t("later")}
              </Button>
            </CardContent>
          </Card>
        ) : isLoading ? (
          <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">{t("loadingInvite")}</CardContent></Card>
        ) : error ? (
          <Card>
            <CardContent className="py-10 text-center space-y-3">
              <XCircle className="h-10 w-10 text-destructive mx-auto" />
              <p className="text-sm text-foreground font-medium">{(error as Error).message}</p>
              <Button variant="outline" onClick={() => navigate("/fisio/dashboard")}>{t("goDashboard")}</Button>
            </CardContent>
          </Card>
        ) : accepted ? (
          <Card>
            <CardContent className="pt-6 space-y-4">
              <div className="text-center space-y-2">
                <CheckCircle2 className="h-10 w-10 text-green-600 mx-auto" />
                <p className="text-base font-semibold text-foreground">{t("patientLinked")}</p>
                <p className="text-sm text-muted-foreground">
                  {t("protocolCreated")}
                </p>
              </div>
              {invite && (
                <div className="rounded-lg border border-border p-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <Stethoscope className="h-4 w-4 text-muted-foreground shrink-0" />
                    <p className="text-sm text-foreground">Dr(a). {invite.doctorName}{invite.doctorCrm ? ` · CRM ${invite.doctorCrm}` : ""}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <User className="h-4 w-4 text-muted-foreground shrink-0" />
                    <p className="text-sm text-foreground">{t("patientPrefix", { name: invite.patientInitials ?? "" })}</p>
                    {invite.procedureLabel && <Badge variant="secondary" className="text-xs">{clinicalLabel(invite.procedureLabel)}</Badge>}
                  </div>
                  {invite.surgeryDate && (
                    <div className="flex items-center gap-2">
                      <CalendarDays className="h-4 w-4 text-muted-foreground shrink-0" />
                      <p className="text-sm text-foreground">{t("surgeryOn", { date: formatDate(new Date(`${invite.surgeryDate}T12:00:00`)) })}</p>
                    </div>
                  )}
                </div>
              )}
              {accepted.preview && accepted.preview.length > 0 && (
                <div className="rounded-lg border border-border p-3 max-h-48 overflow-y-auto">
                  <p className="text-xs font-semibold text-foreground mb-2">{t("protocolMilestones")}</p>
                  <ul className="space-y-1">
                    {accepted.preview.map((f, i) => (
                      <li key={i} className="text-xs text-muted-foreground flex justify-between gap-2">
                        <span className="truncate">{f.title}</span>
                        <span className="shrink-0">{formatDate(new Date(`${f.dueDate}T12:00:00`))}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <Button className="w-full" onClick={() => navigate(`/fisio/pacientes/${accepted.patientId}`)}>
                {t("viewPatient")}
              </Button>
            </CardContent>
          </Card>
        ) : invite ? (
          <Card>
            <CardContent className="pt-6 space-y-4">
              {invite.status !== "pending" ? (
                <div className="text-center space-y-3 py-4">
                  <XCircle className="h-10 w-10 text-destructive mx-auto" />
                  <p className="text-sm text-foreground font-medium">
                    {invite.status === "expired"
                      ? t("inviteExpired")
                      : t("inviteUsed")}
                  </p>
                  <Button variant="outline" onClick={() => navigate("/fisio/dashboard")}>{t("goDashboard")}</Button>
                </div>
              ) : (
                <>
                  <div className="space-y-3">
                    <div className="flex items-center gap-3">
                      <Stethoscope className="h-5 w-5 text-muted-foreground shrink-0" />
                      <div>
                        <p className="text-sm font-semibold text-foreground">Dr(a). {invite.doctorName}</p>
                        {invite.doctorCrm && <p className="text-xs text-muted-foreground">CRM {invite.doctorCrm}</p>}
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <User className="h-5 w-5 text-muted-foreground shrink-0" />
                      <div>
                         <p className="text-sm font-semibold text-foreground">{t("patientPrefix", { name: invite.patientInitials ?? "" })}</p>
                         {invite.procedureLabel && <Badge variant="secondary" className="text-xs mt-0.5">{clinicalLabel(invite.procedureLabel)}</Badge>}
                      </div>
                    </div>
                    {invite.surgeryDate && (
                      <div className="flex items-center gap-3">
                        <CalendarDays className="h-5 w-5 text-muted-foreground shrink-0" />
                        <p className="text-sm text-foreground">
                           {t("surgeryOn", { date: formatDate(new Date(`${invite.surgeryDate}T12:00:00`)) })}
                        </p>
                      </div>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                     {t("inviteExplanation")}
                  </p>
                  {accept.isError ? (
                    <Button className="w-full" onClick={() => accept.mutate()}>
                       {t("retry")}
                    </Button>
                  ) : (
                     <p className="text-sm text-center text-muted-foreground py-2">{t("acceptingReferral")}</p>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        ) : null}
      </div>
    </div>
  );
}
