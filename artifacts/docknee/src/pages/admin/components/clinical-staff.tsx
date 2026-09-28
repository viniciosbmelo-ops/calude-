import { useState } from "react";
import { CASE_TYPE_BY_KEY } from "@workspace/clinical/web";
import { useLocation } from "wouter";
import { useGetAdminDashboard, type AdminDoctorWithStats } from "@workspace/api-client-react";
import { useDoctorAction, useAllSurgeries } from "../queries";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AdminEditDoctorDialog, AdminRegisterDialog, AdminResetPasswordDialog } from "./shared";
import { 
  UserPlus, ExternalLink, CheckCircle, XCircle,
  Trash2, KeyRound, Search, Gift, Pencil, CalendarClock
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { sortByPtBrName } from "@/lib/utils";
import { useScopedTranslations } from "@/lib/i18n";
import { adminConsoleMessages } from "@/locales/admin-console";

type AdminTranslation = (key: keyof typeof adminConsoleMessages["pt-BR"], params?: Record<string, string | number>) => string;
type AdminTranslationKey = keyof typeof adminConsoleMessages["pt-BR"];

type DoctorOperationalStatus = "exempt" | "temporary" | "active" | "trial" | "payment_blocked" | "inactive";
type DoctorStatusFilter = "all" | DoctorOperationalStatus;

const PAYMENT_BLOCKED_STATUSES = new Set([
  "past_due",
  "unpaid",
  "incomplete",
  "incomplete_expired",
]);

const DOCTOR_STATUS_FILTERS: Array<{
  value: DoctorStatusFilter;
  labelKey: AdminTranslationKey;
  dotClassName: string;
}> = [
  { value: "all", labelKey: "staff.all", dotClassName: "bg-slate-500" },
  { value: "exempt", labelKey: "staff.exempt", dotClassName: "bg-sky-500" },
  { value: "temporary", labelKey: "staff.temporary", dotClassName: "bg-violet-500" },
  { value: "active", labelKey: "staff.active", dotClassName: "bg-emerald-500" },
  { value: "trial", labelKey: "staff.trial", dotClassName: "bg-blue-500" },
  { value: "payment_blocked", labelKey: "staff.paymentBlocked", dotClassName: "bg-red-500" },
  { value: "inactive", labelKey: "staff.inactive", dotClassName: "bg-slate-400" },
];

const DOCTOR_STATUS_META: Record<DoctorOperationalStatus, {
  labelKey: AdminTranslationKey;
  badgeClassName: string;
}> = {
  exempt: {
    labelKey: "staff.exemptStatus",
    badgeClassName: "bg-sky-100 text-sky-800 hover:bg-sky-100 border-none",
  },
  temporary: {
    labelKey: "staff.temporaryStatus",
    badgeClassName: "bg-violet-100 text-violet-800 hover:bg-violet-100 border-none",
  },
  active: {
    labelKey: "staff.activeStatus",
    badgeClassName: "bg-emerald-100 text-emerald-800 hover:bg-emerald-100 border-none",
  },
  trial: {
    labelKey: "staff.trialStatus",
    badgeClassName: "bg-blue-100 text-blue-800 hover:bg-blue-100 border-none",
  },
  payment_blocked: {
    labelKey: "staff.paymentBlockedStatus",
    badgeClassName: "bg-red-100 text-red-800 hover:bg-red-100 border-none",
  },
  inactive: {
    labelKey: "staff.inactiveStatus",
    badgeClassName: "bg-slate-100 text-slate-700 hover:bg-slate-100 border-none",
  },
};

function getDoctorOperationalStatus(doctor: AdminDoctorWithStats): DoctorOperationalStatus {
  if (doctor.isFree) return "exempt";
  if (doctor.temporaryAccessExpiresAt && new Date(doctor.temporaryAccessExpiresAt).getTime() > Date.now()) {
    return "temporary";
  }

  const subscriptionStatus = doctor.subscriptionStatus?.toLowerCase() ?? null;
  if (!doctor.aprovado || (subscriptionStatus && PAYMENT_BLOCKED_STATUSES.has(subscriptionStatus))) {
    return "payment_blocked";
  }
  if (subscriptionStatus === "trialing") return "trial";
  if (subscriptionStatus === "active") return "active";
  return "inactive";
}

function getDoctorStatusDetail(doctor: AdminDoctorWithStats, status: DoctorOperationalStatus, t: AdminTranslation): string {
  if (status === "exempt") return t("staff.exemptDetail");
  if (status === "temporary") {
    return t("staff.temporaryDetail", {
      date: new Intl.DateTimeFormat("pt-BR").format(new Date(doctor.temporaryAccessExpiresAt!)),
    });
  }
  if (status === "active") return t("staff.activeDetail");
  if (status === "trial") return t("staff.trialDetail");
  if (status === "payment_blocked") {
    return doctor.aprovado ? t("staff.paymentPending") : t("staff.accessBlocked");
  }
  return doctor.subscriptionStatus?.toLowerCase() === "canceled"
    ? t("staff.subscriptionCanceled")
    : t("staff.noActiveSubscription");
}

export function ClinicalStaff() {
  const [, setLocation] = useLocation();
  const { data: dashboard, isLoading: dashboardLoading } = useGetAdminDashboard();
  const { data: surgeries, isLoading: surgeriesLoading } = useAllSurgeries();
  const act = useDoctorAction();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const t = useScopedTranslations(adminConsoleMessages);
  const formatBrazilianDate = (value: string | null | undefined) =>
    !value
      ? t("never")
      : new Intl.DateTimeFormat("pt-BR", {
          day: "2-digit",
          month: "2-digit",
          year: "numeric",
        }).format(new Date(value));
  const formatDateTime = (value: string | null | undefined) =>
    !value
      ? t("never")
      : new Intl.DateTimeFormat("pt-BR", {
          day: "2-digit",
          month: "2-digit",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        }).format(new Date(value));
  
  const [showRegister, setShowRegister] = useState(false);
  const [editDoctor, setEditDoctor] = useState<{ id: number; nome: string } | null>(null);
  const [resetDoctor, setResetDoctor] = useState<{ id: number; nome: string } | null>(null);
  const [searchDoc, setSearchDoc] = useState("");
  const [searchSurg, setSearchSurg] = useState("");
  const [doctorStatusFilter, setDoctorStatusFilter] = useState<DoctorStatusFilter>("all");

  const handleAction = async (d: AdminDoctorWithStats, actionType: string, msg: string) => {
    if (!confirm(msg)) return;
    try {
      let path = "";
      let method = "PATCH";
      let body: unknown;
      if (actionType === "approve") path = `/api/admin/doctors/${d.id}/approve`;
      if (actionType === "free") {
        path = `/api/admin/doctors/${d.id}/set-free`;
        body = { isFree: !d.isFree };
      }
      if (actionType === "temporary") {
        path = `/api/admin/doctors/${d.id}/grant-temporary-access`;
      }
      if (actionType === "block") path = `/api/admin/doctors/${d.id}/${d.aprovado ? 'block' : 'unblock'}`;
      if (actionType === "delete") {
        path = `/api/admin/doctors/${d.id}`;
        method = "DELETE";
      }
      await act.mutateAsync({ path, method, body });
      toast({ title: t("staff.operationSuccess") });
    } catch { toast({ title: t("staff.operationError"), variant: "destructive" }); }
  };

  const allDoctors = dashboard?.doctorStats ?? [];
  const statusCounts = allDoctors.reduce<Record<DoctorOperationalStatus, number>>((counts, doctor) => {
    counts[getDoctorOperationalStatus(doctor)] += 1;
    return counts;
  }, { exempt: 0, temporary: 0, active: 0, trial: 0, payment_blocked: 0, inactive: 0 });

  const normalizedDoctorSearch = searchDoc.trim().toLowerCase();
  const filteredDoctors = sortByPtBrName(allDoctors.filter(doctor => {
    const matchesStatus = doctorStatusFilter === "all"
      || getDoctorOperationalStatus(doctor) === doctorStatusFilter;
    const matchesSearch = normalizedDoctorSearch.length === 0
      || doctor.nome.toLowerCase().includes(normalizedDoctorSearch)
      || doctor.email.toLowerCase().includes(normalizedDoctorSearch)
      || doctor.crm?.toLowerCase().includes(normalizedDoctorSearch);
    return matchesStatus && matchesSearch;
  }), (doctor) => doctor.nome, (doctor) => doctor.id);

  const filteredSurgeries = surgeries?.filter(s => 
    (s.doctorNome && s.doctorNome.toLowerCase().includes(searchSurg.toLowerCase())) ||
    (s.patientNome && s.patientNome.toLowerCase().includes(searchSurg.toLowerCase())) ||
    (s.hospital && s.hospital.toLowerCase().includes(searchSurg.toLowerCase()))
  ) || [];

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-foreground">{t("staff.title")}</h2>
          <p className="text-sm text-muted-foreground">{t("staff.subtitle")}</p>
        </div>
        <Button onClick={() => setShowRegister(true)} className="gap-2 shadow-sm">
          <UserPlus className="h-4 w-4" /> {t("staff.register")}
        </Button>
      </div>

      <Tabs defaultValue="doctors" className="w-full">
        <TabsList className="grid w-full grid-cols-2 max-w-sm mb-4">
          <TabsTrigger value="doctors">{t("staff.doctors", { count: allDoctors.length })}</TabsTrigger>
          <TabsTrigger value="surgeries">{t("staff.surgeries", { count: filteredSurgeries.length })}</TabsTrigger>
        </TabsList>
        
        <TabsContent value="doctors" className="space-y-4">
          <div
            className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-7"
            role="group"
            aria-label={t("staff.filterAria")}
          >
            {DOCTOR_STATUS_FILTERS.map(filter => {
              const count = filter.value === "all" ? allDoctors.length : statusCounts[filter.value];
              const selected = doctorStatusFilter === filter.value;
              return (
                <button
                  key={filter.value}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => setDoctorStatusFilter(filter.value)}
                  className={`min-h-16 rounded-xl border px-3 py-2 text-left transition-colors ${
                    selected
                      ? "border-primary bg-primary/5 ring-1 ring-primary/20"
                      : "border-border/60 bg-card hover:border-border hover:bg-muted/30"
                  }`}
                >
                  <span className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                    <span className={`h-2 w-2 shrink-0 rounded-full ${filter.dotClassName}`} aria-hidden="true" />
                     <span className="leading-tight">{t(filter.labelKey)}</span>
                  </span>
                  <span className="mt-1 block text-xl font-bold tabular-nums text-foreground">{count}</span>
                </button>
              );
            })}
          </div>

          <Card className="shadow-sm border-border/50">
            <div className="flex items-center gap-2 border-b border-border/50 p-4">
              <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
              <input
                type="search"
                aria-label={t("staff.searchAria")}
                placeholder={t("staff.searchDoctors")}
                className="min-w-0 flex-1 bg-transparent border-none text-sm outline-none placeholder:text-muted-foreground"
                value={searchDoc}
                onChange={e => setSearchDoc(e.target.value)}
              />
              <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                {filteredDoctors.length} {t("explicit.022")} {allDoctors.length}
              </span>
            </div>
            {dashboardLoading ? (
              <div className="p-6 space-y-3">
                {[1,2,3].map(i => <Skeleton key={i} className="h-12 w-full" />)}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/30">
                      <TableHead>{t("staff.doctor")}</TableHead>
                      <TableHead>{t("staff.statusPlan")}</TableHead>
                      <TableHead className="text-right">{t("staff.activity")}</TableHead>
                      <TableHead className="text-right">{t("actions")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredDoctors.map(doctor => {
                      const operationalStatus = getDoctorOperationalStatus(doctor);
                      const statusMeta = DOCTOR_STATUS_META[operationalStatus];
                      return (
                        <TableRow key={doctor.id} className="hover:bg-muted/20">
                        <TableCell>
                          <div className="font-semibold text-sm flex items-center gap-2">
                            {doctor.nome}
                            {doctor.isAdmin && <Badge variant="secondary" className="text-[10px]">ADMIN</Badge>}
                          </div>
                          <div className="text-xs text-muted-foreground font-mono mt-0.5">{doctor.email}</div>
                          <div className="text-[10px] text-muted-foreground mt-0.5">CRM: {doctor.crmEstado} {doctor.crm}</div>
                        </TableCell>
                        <TableCell>
                          <div className="space-y-1">
                            <Badge className={`${statusMeta.badgeClassName} text-[10px]`}>
                               {t(statusMeta.labelKey)}
                            </Badge>
                            <div className="text-[11px] font-medium text-muted-foreground">
                               {getDoctorStatusDetail(doctor, operationalStatus, t)}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="text-xs font-mono">
                            <span className="font-semibold">{doctor.totalPatients}</span> pct · <span className="font-semibold">{doctor.totalSurgeries}</span> cx
                          </div>
                          <div className="text-[10px] text-muted-foreground mt-1">
                            {t("staff.date")} {formatBrazilianDate(doctor.createdAt)}
                          </div>
                          <div className="text-[10px] text-muted-foreground">
                            {t("staff.lastLogin")} {formatDateTime(doctor.lastLoginAt)}
                          </div>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            <Button variant="ghost" size="icon" className="h-8 w-8 text-indigo-600" onClick={() => setEditDoctor({ id: doctor.id, nome: doctor.nome })} title={t("staff.edit")}>
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-8 w-8 text-blue-600" onClick={() => setLocation(`/admin/doctors/${doctor.id}`)} title={t("staff.viewDetails")}>
                              <ExternalLink className="h-4 w-4" />
                            </Button>
                            {!doctor.aprovado ? (
                              <Button variant="ghost" size="icon" className="h-8 w-8 text-emerald-600" onClick={() => handleAction(doctor, "approve", t("staff.approveConfirm"))} title={t("staff.approve")}>
                                <CheckCircle className="h-4 w-4" />
                              </Button>
                            ) : (
                              <Button variant="ghost" size="icon" className="h-8 w-8 text-amber-600" onClick={() => handleAction(doctor, "block", t("staff.blockConfirm"))} title={t("staff.rejectOrBlock")}>
                                <XCircle className="h-4 w-4" />
                              </Button>
                            )}
                            <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground" onClick={() => setResetDoctor({ id: doctor.id, nome: doctor.nome })} title={t("staff.reset")}>
                              <KeyRound className="h-4 w-4" />
                            </Button>
                            {!doctor.isAdmin && (
                              <>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8 text-violet-600"
                                  onClick={() => handleAction(doctor, "temporary", t("staff.temporaryConfirm"))}
                                  title={doctor.temporaryAccessExpiresAt && new Date(doctor.temporaryAccessExpiresAt).getTime() > Date.now()
                                    ? t("staff.renewTemporary")
                                    : t("staff.grantTemporary")}
                                >
                                  <CalendarClock className="h-4 w-4" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className={`h-8 w-8 ${doctor.isFree ? "text-sky-600" : "text-purple-600"}`}
                                  onClick={() => handleAction(
                                    doctor,
                                    "free",
                                    doctor.isFree
                                       ? t("staff.removeExemptionConfirm")
                                       : t("staff.makeExemptConfirm")
                                  )}
                                  title={doctor.isFree ? t("staff.removeExemption") : t("staff.makeExempt")}
                                >
                                  <Gift className="h-4 w-4" />
                                </Button>
                              </>
                            )}
                            <Button variant="ghost" size="icon" className="h-8 w-8 text-red-600" onClick={() => handleAction(doctor, "delete", t("staff.deleteWarning"))} title={t("staff.deleteCaution")}>
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </TableCell>
                        </TableRow>
                      );
                    })}
                    {filteredDoctors.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={4} className="text-center py-8 text-muted-foreground text-sm">
                          {doctorStatusFilter === "all"
                             ? t("staff.noDoctors")
                            : t("staff.noDoctorsCategory")}
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            )}
          </Card>
        </TabsContent>

        <TabsContent value="surgeries" className="space-y-4">
          <Card className="shadow-sm border-border/50">
            <div className="p-4 border-b border-border/50 flex items-center gap-2">
              <Search className="h-4 w-4 text-muted-foreground" />
              <input 
                type="text" 
                placeholder={t("staff.searchSurgeries")}
                className="flex-1 bg-transparent border-none text-sm outline-none placeholder:text-muted-foreground"
                value={searchSurg}
                onChange={e => setSearchSurg(e.target.value)}
              />
            </div>
            {surgeriesLoading ? (
              <div className="p-6 space-y-3">
                {[1,2,3].map(i => <Skeleton key={i} className="h-12 w-full" />)}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/30">
                       <TableHead>{t("staff.surgeryDate")}</TableHead>
                       <TableHead>{t("staff.doctor")}</TableHead>
                       <TableHead>{t("staff.patient")}</TableHead>
                       <TableHead>{t("staff.procedures")}</TableHead>
                       <TableHead className="text-right">{t("staff.location")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredSurgeries.map(surgery => (
                      <TableRow key={surgery.id} className="hover:bg-muted/20">
                        <TableCell className="font-mono text-xs whitespace-nowrap">
                           {formatBrazilianDate(surgery.dataCirurgia || surgery.createdAt)}
                        </TableCell>
                        <TableCell>
                          <div className="font-medium text-sm">{surgery.doctorNome}</div>
                          <div className="text-[10px] text-muted-foreground">CRM {surgery.doctorCrmEstado} {surgery.doctorCrm}</div>
                        </TableCell>
                        <TableCell>
                          <div className="text-sm">{surgery.patientNome}</div>
                          <div className="text-[10px] text-muted-foreground">{surgery.patientSexo || t("explicit.023")}</div>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1 max-w-[200px]">
                            {surgery.tiposProcedimento?.map((p, i) => {
                              const label = CASE_TYPE_BY_KEY.get(p)?.label ?? p;
                              return <Badge key={i} variant="outline" className="text-[10px] truncate max-w-[120px]" title={label}>{label}</Badge>;
                            })}
                          </div>
                        </TableCell>
                        <TableCell className="text-right text-xs text-muted-foreground">
                          {surgery.hospital || "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                    {filteredSurgeries.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center py-8 text-muted-foreground text-sm">
                          {t("staff.noSurgeries")}
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            )}
          </Card>
        </TabsContent>
      </Tabs>

      {showRegister && <AdminRegisterDialog onClose={() => setShowRegister(false)} onSuccess={() => { setShowRegister(false); queryClient.invalidateQueries({ queryKey: ["/api/reports/admin"] }); }} />}
      {editDoctor && (
        <AdminEditDoctorDialog
          doctorId={editDoctor.id}
          doctorNome={editDoctor.nome}
          onClose={() => setEditDoctor(null)}
          onSuccess={() => queryClient.invalidateQueries({ queryKey: ["/api/reports/admin"] })}
        />
      )}
      {resetDoctor && <AdminResetPasswordDialog doctorId={resetDoctor.id} doctorNome={resetDoctor.nome} onClose={() => setResetDoctor(null)} />}
    </div>
  );
}
