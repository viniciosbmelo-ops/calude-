import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { physioFetch } from "@/lib/physio-auth";
import FisioShell from "./shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Plus, ChevronRight } from "lucide-react";
import { sortByPtBrName } from "@/lib/utils";
import { useScopedTranslations } from "@/lib/i18n";
import { physioMessages } from "@/locales/physio";

export interface PhysioPatientRow {
  id: number;
  fullName: string;
  diagnosisCode: string;
  diagnosis: string | null;
  protocolName: string | null;
  protocolStartDate: string | null;
  status: string;
  pendingFollowups: number;
  createdAt: string;
}

export default function FisioPacientes() {
  const [, navigate] = useLocation();
  const t = useScopedTranslations(physioMessages);
  const statusLabel: Record<string, string> = { active: t("active"), discharged: t("discharged"), abandoned: t("abandoned") };

  const { data: patients, isLoading } = useQuery<PhysioPatientRow[]>({
    queryKey: ["physio-patients"],
    queryFn: async () => {
      const res = await physioFetch("/api/physio/patients");
      if (!res.ok) throw new Error("Falha ao carregar pacientes");
      return res.json();
    },
  });
  const sortedPatients = sortByPtBrName(patients ?? [], (patient) => patient.fullName, (patient) => patient.id);

  return (
    <FisioShell>
      <div className="space-y-5">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-2xl font-bold text-foreground">{t("patients")}</h1>
          <Button onClick={() => navigate("/fisio/pacientes/novo")} className="gap-1.5" data-testid="button-novo-paciente">
            <Plus className="h-4 w-4" /> {t("newPatient")}
          </Button>
        </div>

        {isLoading && <p className="text-sm text-muted-foreground">{t("loading")}</p>}

        {patients && patients.length === 0 && (
          <Card>
            <CardContent className="py-10 text-center space-y-3">
               <p className="text-sm text-muted-foreground">{t("noPatients")}</p>
              <Button onClick={() => navigate("/fisio/pacientes/novo")} className="gap-1.5">
                 <Plus className="h-4 w-4" /> {t("addFirstPatient")}
              </Button>
            </CardContent>
          </Card>
        )}

        <div className="space-y-2">
          {sortedPatients.map((p) => (
            <button
              key={p.id}
              onClick={() => navigate(`/fisio/pacientes/${p.id}`)}
              className="w-full text-left flex items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3 hover:bg-muted transition-colors"
              data-testid={`patient-${p.id}`}
            >
              <div className="min-w-0">
                <p className="text-sm font-semibold text-foreground truncate">{p.fullName}</p>
                <p className="text-xs text-muted-foreground truncate">
                  {p.diagnosisCode === "outro" ? (p.diagnosis ?? t("other")) : (p.protocolName ?? p.diagnosisCode)}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {p.pendingFollowups > 0 && (
                  <Badge variant="secondary">{p.pendingFollowups} follow-up{p.pendingFollowups > 1 ? "s" : ""}</Badge>
                )}
                <Badge variant={p.status === "active" ? "default" : "outline"}>{statusLabel[p.status] ?? p.status}</Badge>
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              </div>
            </button>
          ))}
        </div>
      </div>
    </FisioShell>
  );
}
