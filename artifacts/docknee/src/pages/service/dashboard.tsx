import { useState, useEffect, useCallback } from "react";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Users, FileText, Activity, LogOut, Building2, Calendar, HeartPulse, Stethoscope } from "lucide-react";
import { useServiceAuth } from "@/lib/service-auth";
import { sortByPtBrName } from "@/lib/utils";
import { useLanguage, useScopedTranslations } from "@/lib/i18n";
import { consoleMessages } from "@/locales/console";

interface Patient { id: number; nome: string; cpf: string; telefone: string | null; email: string | null }
interface Surgery { id: number; dataCirurgia: string | null; patientNome: string; hospital: string | null; tipoCaso: string | null; status: string | null; doctorId: number }
interface Followup { id: number; patientId: number; patientNome: string; createdAt: string; status: string | null; tipoProtocolo: string | null }
interface Stats { totalMedicos: number; totalPacientes: number; totalCirurgias: number; totalFollowups: number }

const BASE = typeof import.meta !== "undefined" ? (import.meta.env?.BASE_URL?.replace(/\/$/, "") ?? "") : "";

export default function ServiceDashboard() {
  const [, setLocation] = useLocation();
  const { service, isLoading: authLoading, logout } = useServiceAuth();
  const { formatDate, setLanguage } = useLanguage();
  const t = useScopedTranslations(consoleMessages);
  const [stats, setStats] = useState<Stats>({ totalMedicos: 0, totalPacientes: 0, totalCirurgias: 0, totalFollowups: 0 });
  const [patients, setPatients] = useState<Patient[]>([]);
  const [surgeries, setSurgeries] = useState<Surgery[]>([]);
  const [followups, setFollowups] = useState<Followup[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!authLoading && !service) { setLocation("/service/login"); }
  }, [authLoading, service, setLocation]);

  useEffect(() => {
    if (service) void setLanguage(service.idioma === "es" ? "es" : "pt-BR");
  }, [service, setLanguage]);

  const load = useCallback(async () => {
    if (!service) return;
    setLoading(true);
    try {
      const [s, p, sur, f] = await Promise.all([
        fetch(`${BASE}/api/service/stats`, { credentials: "same-origin" }).then(r => r.json()),
        fetch(`${BASE}/api/service/patients`, { credentials: "same-origin" }).then(r => r.json()),
        fetch(`${BASE}/api/service/surgeries`, { credentials: "same-origin" }).then(r => r.json()),
        fetch(`${BASE}/api/service/followups`, { credentials: "same-origin" }).then(r => r.json()),
      ]);
      setStats(s);
      setPatients(Array.isArray(p) ? p : []);
      setSurgeries(Array.isArray(sur) ? sur : []);
      setFollowups(Array.isArray(f) ? f : []);
    } catch { /* ignore */ } finally { setLoading(false); }
  }, [service]);

  useEffect(() => { load(); }, [load]);

  const handleLogout = () => { logout(); setLocation("/service/login"); };

  if (authLoading || !service) return null;

  const statCards = [
    { icon: Stethoscope, label: t("linkedDoctors"), value: stats.totalMedicos, color: "text-blue-600" },
    { icon: Users,       label: t("patients"),       value: stats.totalPacientes, color: "text-emerald-600" },
    { icon: FileText,    label: t("surgeries"),      value: stats.totalCirurgias, color: "text-indigo-600" },
    { icon: HeartPulse,  label: t("followups"),      value: stats.totalFollowups, color: "text-rose-600" },
  ];
  const sortedPatients = sortByPtBrName(patients, (patient) => patient.nome, (patient) => patient.id);

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-30 border-b border-border bg-card/80 backdrop-blur px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center">
            <Building2 className="h-5 w-5 text-primary" />
          </div>
          <div>
            <p className="text-sm font-semibold leading-tight">{service?.nome ?? t("service")}</p>
            <p className="text-[11px] text-muted-foreground leading-tight">{service?.email}</p>
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={handleLogout} className="gap-1.5 text-muted-foreground">
          <LogOut className="h-4 w-4" />
          {t("logout")}
        </Button>
      </header>

      <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">

        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {statCards.map(({ icon: Icon, label, value, color }) => (
            <Card key={label} className="border-border">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-1">
                  <Icon className={`h-4 w-4 ${color}`} />
                  <span className="text-xs text-muted-foreground">{label}</span>
                </div>
                <p className="text-2xl font-bold">{loading ? "—" : value}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Tabs */}
        <Tabs defaultValue="patients">
          <TabsList className="w-full justify-start border-b border-border bg-transparent p-0 h-auto gap-1 rounded-none mb-4">
            {[
              { value: "patients", label: t("patients") },
              { value: "surgeries", label: t("surgeries") },
              { value: "followups", label: t("followups") },
            ].map(t => (
              <TabsTrigger key={t.value} value={t.value}
                className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-4 py-2 text-sm font-medium text-muted-foreground data-[state=active]:text-foreground">
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>

          {/* Pacientes */}
          <TabsContent value="patients">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">{t("patients")} ({patients.length})</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {loading ? (
                  <div className="p-8 text-center text-muted-foreground text-sm">{t("loading")}</div>
                ) : patients.length === 0 ? (
                  <div className="p-8 text-center text-muted-foreground text-sm">{t("noPatients")}.</div>
                ) : (
                  <div className="divide-y divide-border">
                    {sortedPatients.map(p => (
                      <div key={p.id} className="px-4 py-3 flex items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-medium">{p.nome}</p>
                          <p className="text-xs text-muted-foreground">{p.cpf ?? "—"}{p.telefone ? ` · ${p.telefone}` : ""}</p>
                        </div>
                        {p.email && <p className="text-xs text-muted-foreground hidden sm:block truncate max-w-[180px]">{p.email}</p>}
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Cirurgias */}
          <TabsContent value="surgeries">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">{t("surgeries")} ({surgeries.length})</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {loading ? (
                  <div className="p-8 text-center text-muted-foreground text-sm">{t("loading")}</div>
                ) : surgeries.length === 0 ? (
                  <div className="p-8 text-center text-muted-foreground text-sm">{t("noSurgeries")}</div>
                ) : (
                  <div className="divide-y divide-border">
                    {surgeries.map(s => (
                      <div key={s.id} className="px-4 py-3 flex items-start justify-between gap-3">
                        <div className="flex items-start gap-3 min-w-0">
                          <div className="w-8 h-8 rounded-lg bg-indigo-100 dark:bg-indigo-900/30 flex items-center justify-center shrink-0">
                            <Calendar className="h-4 w-4 text-indigo-600 dark:text-indigo-300" />
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-medium truncate">{s.patientNome}</p>
                            <p className="text-xs text-muted-foreground">
                              {s.dataCirurgia ? formatDate(s.dataCirurgia) : "—"}
                              {s.hospital ? ` · ${s.hospital}` : ""}
                            </p>
                          </div>
                        </div>
                        <div className="flex flex-col items-end gap-1 shrink-0">
                          {s.tipoCaso && <Badge variant="outline" className="text-[10px]">{s.tipoCaso}</Badge>}
                          {s.status && (
                            <Badge variant={s.status === "finalizada" ? "default" : "secondary"} className="text-[10px]">
                              {s.status}
                            </Badge>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Follow-ups */}
          <TabsContent value="followups">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">{t("followups")} ({followups.length})</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {loading ? (
                  <div className="p-8 text-center text-muted-foreground text-sm">{t("loading")}</div>
                ) : followups.length === 0 ? (
                  <div className="p-8 text-center text-muted-foreground text-sm">{t("noServiceFollowups")}</div>
                ) : (
                  <div className="divide-y divide-border">
                    {followups.map(f => (
                      <div key={f.id} className="px-4 py-3 flex items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-medium">{f.patientNome}</p>
                          <p className="text-xs text-muted-foreground">
                            {f.tipoProtocolo ?? t("followup")}
                            {f.createdAt ? ` · ${formatDate(f.createdAt)}` : ""}
                          </p>
                        </div>
                        {f.status && (
                          <Badge variant="secondary" className="text-[10px] shrink-0">{f.status}</Badge>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
