import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { usePhysioAuth, physioFetch } from "@/lib/physio-auth";
import FisioShell from "./shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Users, CalendarDays, ClipboardList, Activity, AlertTriangle, Plus } from "lucide-react";
import { useLanguage, useScopedTranslations } from "@/lib/i18n";
import { physioMessages } from "@/locales/physio";

interface DashFollowup {
  id: number;
  physioPatientId: number;
  title: string;
  dueDate: string;
  phase: number | null;
  source: string;
  patientName: string;
}

interface DashboardData {
  followups: { overdue: DashFollowup[]; next7days: DashFollowup[]; upcomingCount: number };
  todayAgenda: { id: number; startsAt: string; endsAt: string; appointmentType: string; patientName: string | null }[];
  activePatients: number;
}

function fmtDate(d: string) {
  const [y, m, day] = d.split("-");
  return `${day}/${m}/${y}`;
}

export default function FisioDashboard() {
  const [, navigate] = useLocation();
  const { physio } = usePhysioAuth();
  const { locale } = useLanguage();
  const t = useScopedTranslations(physioMessages);

  const { data, isLoading } = useQuery<DashboardData>({
    queryKey: ["physio-dashboard"],
    queryFn: async () => {
      const res = await physioFetch("/api/physio/dashboard");
      if (!res.ok) throw new Error("Falha ao carregar dashboard");
      return res.json();
    },
  });

  const firstName = physio?.nome.split(" ")[0] ?? "";

  return (
    <FisioShell>
      <div className="space-y-6">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-foreground">{t("greeting", { name: firstName })}</h1>
            <p className="text-sm text-muted-foreground mt-1">{t("rehabilitationDashboard")}</p>
          </div>
          <Button onClick={() => navigate("/fisio/pacientes/novo")} className="gap-1.5" data-testid="button-novo-paciente">
            <Plus className="h-4 w-4" /> {t("newPatient")}
          </Button>
        </div>

        {physio && physio.subscriptionStatus !== "active" && physio.subscriptionStatus !== "trialing" && (
          <div className="rounded-xl px-4 py-3 flex items-center gap-2.5" style={{ background: "rgba(31,182,225,0.07)", border: "1px solid rgba(31,182,225,0.2)" }}>
            <Activity className="h-4 w-4 shrink-0" style={{ color: "#1FB6E1" }} />
            <p className="text-sm text-foreground">
              {t("freePlan", { available: Math.max(0, 2 - physio.patientsCreatedTotal) })}
            </p>
          </div>
        )}

        {/* Contadores */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { Icon: Users, label: t("activePatients"), value: data?.activePatients ?? "—", testid: "stat-pacientes" },
            { Icon: AlertTriangle, label: t("overdueFollowups"), value: data?.followups.overdue.length ?? "—", danger: true, testid: "stat-atrasados" },
            { Icon: ClipboardList, label: t("nextSevenDays"), value: data?.followups.next7days.length ?? "—", testid: "stat-proximos" },
            { Icon: CalendarDays, label: t("futureFollowups"), value: data?.followups.upcomingCount ?? "—", testid: "stat-futuros" },
          ].map(({ Icon, label, value, danger, testid }) => (
            <Card key={label}>
              <CardContent className="pt-5 pb-4">
                <Icon className="h-5 w-5 mb-2" style={{ color: danger && Number(value) > 0 ? "#dc2626" : "#1FB6E1" }} />
                <p className="text-2xl font-bold text-foreground" data-testid={testid}>{value}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Atrasados */}
        {data && data.followups.overdue.length > 0 && (
          <Card className="border-red-300 dark:border-red-900">
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2 text-red-600">
                <AlertTriangle className="h-4 w-4" /> {t("overdueFollowups")}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {data.followups.overdue.map((f) => (
                <button
                  key={f.id}
                  onClick={() => navigate(`/fisio/pacientes/${f.physioPatientId}`)}
                  className="w-full text-left flex items-center justify-between gap-3 rounded-lg border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/30 px-3 py-2 hover:bg-red-100 dark:hover:bg-red-950/50 transition-colors"
                  data-testid={`overdue-${f.id}`}
                >
                  <div>
                    <p className="text-sm font-medium text-foreground">{f.title}</p>
                    <p className="text-xs text-muted-foreground">{f.patientName}</p>
                  </div>
                  <Badge variant="destructive">{fmtDate(f.dueDate)}</Badge>
                </button>
              ))}
            </CardContent>
          </Card>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Próximos 7 dias */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <ClipboardList className="h-4 w-4" style={{ color: "#1FB6E1" }} /> {t("nextSevenDays")}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
               {isLoading && <p className="text-sm text-muted-foreground">{t("loading")}</p>}
              {data && data.followups.next7days.length === 0 && (
                 <p className="text-sm text-muted-foreground">{t("noFollowups")}</p>
              )}
              {data?.followups.next7days.map((f) => (
                <button
                  key={f.id}
                  onClick={() => navigate(`/fisio/pacientes/${f.physioPatientId}`)}
                  className="w-full text-left flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2 hover:bg-muted transition-colors"
                  data-testid={`next7-${f.id}`}
                >
                  <div>
                    <p className="text-sm font-medium text-foreground">{f.title}</p>
                    <p className="text-xs text-muted-foreground">{f.patientName}</p>
                  </div>
                  <Badge variant="secondary">{fmtDate(f.dueDate)}</Badge>
                </button>
              ))}
            </CardContent>
          </Card>

          {/* Agenda de hoje */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <CalendarDays className="h-4 w-4" style={{ color: "#1FB6E1" }} /> {t("todaySchedule")}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {data && data.todayAgenda.length === 0 && (
                 <p className="text-sm text-muted-foreground">{t("noAppointmentsToday")}</p>
              )}
              {data?.todayAgenda.map((a) => (
                <div key={a.id} className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2">
                  <div>
                     <p className="text-sm font-medium text-foreground">{a.patientName ?? t("block")}</p>
                    <p className="text-xs text-muted-foreground capitalize">{a.appointmentType}</p>
                  </div>
                  <Badge variant="outline">
                     {new Date(a.startsAt).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })}
                  </Badge>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </FisioShell>
  );
}
