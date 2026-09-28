import { useListPatients } from "@workspace/api-client-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { useState, useEffect } from "react";
import { Search, Plus, ChevronRight, Phone, AlertTriangle, ChevronDown, ChevronUp, ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { sortByPtBrName } from "@/lib/utils";
import { useLanguage, useScopedTranslations } from "@/lib/i18n";
import { operationalPatientsListMessages } from "@/locales/operational-patients-list";

const AVATAR_COLORS = [
  "linear-gradient(135deg,#1A365D,#2A4A7F)",
  "linear-gradient(135deg,#1A365D,#2A4A7F)",
  "linear-gradient(135deg,#1A365D,#2A4A7F)",
  "linear-gradient(135deg,#1A365D,#2A4A7F)",
  "linear-gradient(135deg,#1A365D,#2A4A7F)",
];

function toTitleCase(str: string) {
  const skip = new Set(["de", "da", "do", "das", "dos", "e"]);
  return str.toLowerCase().split(" ").map((w, i) => (i === 0 || !skip.has(w) ? w.charAt(0).toUpperCase() + w.slice(1) : w)).join(" ");
}

function getInitials(name: string) {
  return name.split(" ").slice(0, 2).map((n: string) => n?.[0] ?? "").join("").toUpperCase();
}

type OverdueItem = {
  notifId: number;
  periodo: string;
  sentAt: string | null;
  surgeryId: number;
  patientId: number;
  patientName: string;
  patientPhone: string | null;
};

export default function PatientsList() {
  const { data: patients, isLoading } = useListPatients();
  const { formatDate } = useLanguage();
  const t = useScopedTranslations(operationalPatientsListMessages);
  const sideLabel = (side: string) =>
    side === "Direito" ? t("right") : side === "Esquerdo" ? t("left") : side === "Bilateral" ? t("bilateral") : side;
  const [search, setSearch] = useState("");
  const [overdueItems, setOverdueItems] = useState<OverdueItem[]>([]);
  const [overdueOpen, setOverdueOpen] = useState(true);

  useEffect(() => {
    fetch("/api/notifications/overdue-followups", {
      credentials: "same-origin",
    })
      .then(r => r.json())
      .then(data => { if (Array.isArray(data)) setOverdueItems(data); })
      .catch(() => {});
  }, []);

  const filteredPatients = patients
    ?.filter(p =>
      p.nome.toLowerCase().includes(search.toLowerCase()) ||
      (p.telefone && p.telefone.includes(search))
    );
  const sortedPatients = filteredPatients
    ? sortByPtBrName(filteredPatients, (patient) => patient.nome, (patient) => patient.id)
    : undefined;

  return (
    <div className="max-w-6xl mx-auto">

      {/* ── Mobile navy banner (hidden md+) ── */}
      <div className="md:hidden" style={{ background: "linear-gradient(135deg, #0A1628 0%, #0D2040 100%)" }}>
        <div className="px-4 pt-5 pb-5 flex items-center justify-between">
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 700, color: "#fff", margin: 0 }}>{t("patients")}</h1>
            <p style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", margin: "3px 0 0" }}>
              {isLoading ? t("loading") : `${patients?.length ?? 0} ${(patients?.length ?? 0) === 1 ? t("registered") : t("registeredPlural")}`}
            </p>
          </div>
          <Link href="/patients/new">
            <button
              aria-label={t("add")}
              title={t("add")}
              style={{ background: "#1FB6E1", border: "none", borderRadius: 10, width: 38, height: 38, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}
            >
              <Plus className="h-5 w-5" style={{ color: "#fff" }} />
            </button>
          </Link>
        </div>
      </div>

      <div className="p-4 md:p-8 space-y-5">

        {/* ── Desktop header (hidden on mobile) ── */}
        <div className="hidden md:flex items-center justify-between gap-3">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-foreground">{t("patients")}</h1>
            <p className="text-muted-foreground text-sm mt-0.5">{t("subtitle")}</p>
          </div>
          <Link href="/patients/new">
            <Button className="gap-2 shrink-0" size="sm">
              <Plus className="h-4 w-4" />
              {t("add")}
            </Button>
          </Link>
        </div>

        {/* ── Follow-up em atraso alert ── */}
        {overdueItems.length > 0 && (
          <div className="rounded-xl border border-red-300 bg-red-50 overflow-hidden">
            <button
              onClick={() => setOverdueOpen(o => !o)}
              className="w-full flex items-center gap-2 px-4 py-3 text-left hover:bg-red-100/60 transition-colors"
            >
              <AlertTriangle className="h-4 w-4 text-red-600 shrink-0" />
              <span className="font-semibold text-red-700 text-sm flex-1">
                {t("overdue", { count: overdueItems.length })}
              </span>
              {overdueOpen ? <ChevronUp className="h-4 w-4 text-red-500" /> : <ChevronDown className="h-4 w-4 text-red-500" />}
            </button>
            {overdueOpen && (
              <div className="border-t border-red-200 divide-y divide-red-100">
                {overdueItems.map(item => {
                  const sentDate = item.sentAt ? formatDate(item.sentAt) : null;
                  return (
                    <div key={item.notifId} className="flex items-center gap-3 px-4 py-2.5 bg-white/60">
                      <div
                        className="w-7 h-7 rounded-full flex items-center justify-center text-white font-bold text-xs shrink-0"
                        style={{ background: "linear-gradient(135deg,#7f1d1d,#b91c1c)" }}
                      >
                        {getInitials(item.patientName)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-sm text-red-800 truncate">{toTitleCase(item.patientName)}</p>
                        <p className="text-xs text-red-600">
                          {t("sentOn", { period: item.periodo, date: sentDate ?? t("unknownDate") })}
                        </p>
                      </div>
                      <Link href={`/surgeries/${item.surgeryId}`}>
                        <button className="text-xs flex items-center gap-1 text-red-700 hover:text-red-900 font-medium px-2 py-1 rounded border border-red-300 hover:bg-red-100 transition-colors whitespace-nowrap">
                          {t("viewSurgery")}
                          <ExternalLink className="h-3 w-3" />
                        </button>
                      </Link>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder={t("search")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        {/* ── Mobile card list (hidden md+) ── */}
        <div className="md:hidden space-y-2">
          {isLoading ? (
            Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="bg-card border border-border rounded-2xl p-4 space-y-2" style={{ boxShadow: "0 1px 8px rgba(0,0,0,0.06)" }}>
                <Skeleton className="h-5 w-40" />
                <Skeleton className="h-4 w-28" />
              </div>
            ))
          ) : filteredPatients?.length === 0 ? (
            <div className="text-center py-10 text-muted-foreground text-sm">{t("empty")}</div>
          ) : (
            sortedPatients?.map((patient) => {
              const hasOverdue = overdueItems.some(o => o.patientId === patient.id);
              return (
                <Link key={patient.id} href={`/patients/${patient.id}`}>
                  <div
                    className={`bg-card border rounded-2xl p-4 flex items-center gap-3 active:bg-muted/40 transition-colors ${hasOverdue ? "border-red-300 bg-red-50/40" : "border-border"}`}
                    style={{ boxShadow: "0 1px 8px rgba(0,0,0,0.06)" }}
                  >
                    <div
                      className="w-11 h-11 rounded-full flex items-center justify-center text-white font-bold text-sm shrink-0"
                      style={{ background: AVATAR_COLORS[patient.id % AVATAR_COLORS.length] }}
                    >
                      {getInitials(patient.nome)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-semibold text-foreground truncate">{toTitleCase(patient.nome)}</p>
                        {hasOverdue && <AlertTriangle className="h-3.5 w-3.5 text-red-500 shrink-0" />}
                      </div>
                      <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                        {patient.dataNascimento && (
                          <span className="text-xs text-muted-foreground">{patient.dataNascimento}</span>
                        )}
                        <span className="text-xs text-muted-foreground/70">
                          {t("registration")}: {formatDate(patient.createdAt)}
                        </span>
                        {patient.telefone && (
                          <span className="text-xs text-muted-foreground flex items-center gap-1">
                            <Phone className="h-3 w-3" />
                            {patient.telefone}
                          </span>
                        )}
                        {patient.lado && (
                          <Badge variant="outline" className="text-[10px] py-0 px-1.5 font-normal">{sideLabel(patient.lado)}</Badge>
                        )}
                      </div>
                      {(patient.surgeries?.length ?? 0) > 0 && (
                        <p className="text-xs text-muted-foreground mt-1">{patient.surgeries?.length} {(patient.surgeries?.length ?? 0) === 1 ? t("procedure") : t("procedures")}</p>
                      )}
                    </div>
                    <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                  </div>
                </Link>
              );
            })
          )}
        </div>

        {/* ── Desktop table (hidden sm-) ── */}
        <div className="hidden md:block rounded-md border bg-card overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50">
                <TableHead>{t("name")}</TableHead>
                <TableHead>{t("birthDate")}</TableHead>
                <TableHead>{t("registration")}</TableHead>
                <TableHead>{t("phone")}</TableHead>
                <TableHead>{t("side")}</TableHead>
                <TableHead>{t("procedures")}</TableHead>
                <TableHead className="text-right">{t("actions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell><Skeleton className="h-5 w-32" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-20" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-20" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-24" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-16" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-10" /></TableCell>
                    <TableCell><Skeleton className="h-8 w-16 ml-auto" /></TableCell>
                  </TableRow>
                ))
              ) : filteredPatients?.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                    {t("empty")}
                  </TableCell>
                </TableRow>
              ) : (
                sortedPatients?.map((patient) => {
                  const hasOverdue = overdueItems.some(o => o.patientId === patient.id);
                  return (
                    <TableRow key={patient.id} className={hasOverdue ? "bg-red-50/40" : undefined}>
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-2">
                          <div
                            className="w-7 h-7 rounded-full flex items-center justify-center text-white font-bold text-xs shrink-0"
                            style={{ background: AVATAR_COLORS[patient.id % AVATAR_COLORS.length] }}
                          >
                            {getInitials(patient.nome)}
                          </div>
                          {patient.nome}
                          {hasOverdue && (
                            <span title={t("followupOverdue")}>
                              <AlertTriangle className="h-3.5 w-3.5 text-red-500" />
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>{patient.dataNascimento || '-'}</TableCell>
                      <TableCell className="text-muted-foreground text-sm">{formatDate(patient.createdAt)}</TableCell>
                      <TableCell>{patient.telefone || '-'}</TableCell>
                      <TableCell>
                        {patient.lado ? (
                          <Badge variant="outline" className="font-normal bg-muted/20">{sideLabel(patient.lado)}</Badge>
                        ) : '-'}
                      </TableCell>
                      <TableCell>{patient.surgeries?.length || 0}</TableCell>
                      <TableCell className="text-right">
                        <Link href={`/patients/${patient.id}`}>
                          <Button variant="ghost" size="sm">{t("viewRecord")}</Button>
                        </Link>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}
