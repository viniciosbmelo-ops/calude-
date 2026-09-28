import { getListSurgeriesQueryKey, useDeleteSurgery, useListSurgeries } from "@workspace/api-client-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { useState } from "react";
import { Search, Plus, FileEdit, ChevronRight, Building2, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { useLanguage, useScopedTranslations } from "@/lib/i18n";
import { CASE_TYPE_BY_KEY } from "@workspace/clinical/web";
import { surgeryListMessages } from "@/locales/surgery-routes";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export default function SurgeriesList() {
  const t = useScopedTranslations(surgeryListMessages);
  const { locale, formatDate } = useLanguage();
  const displayLabel = (value: string) => CASE_TYPE_BY_KEY.get(value)?.label ?? value;
  const { data: surgeries, isLoading } = useListSurgeries();
  const deleteMutation = useDeleteSurgery();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [showDraftsOnly, setShowDraftsOnly] = useState(false);
  const [surgeryToDelete, setSurgeryToDelete] = useState<{ id: number; patientNome: string } | null>(null);

  const draftsCount = surgeries?.filter(s => s.status === "rascunho").length ?? 0;

  const filteredSurgeries = surgeries?.filter(s => {
    const matchSearch =
      s.patientNome.toLowerCase().includes(search.toLowerCase()) ||
      (s.hospital && s.hospital.toLowerCase().includes(search.toLowerCase()));
    const matchFilter = showDraftsOnly ? s.status === "rascunho" : true;
    return matchSearch && matchFilter;
  });

  const handleDelete = () => {
    if (!surgeryToDelete || deleteMutation.isPending) return;

    deleteMutation.mutate(
      { id: surgeryToDelete.id },
      {
        onSuccess: async () => {
          await queryClient.invalidateQueries({ queryKey: getListSurgeriesQueryKey() });
          toast({ title: t("deleteSuccess") });
          setSurgeryToDelete(null);
        },
        onError: (error: unknown) => {
          const status = typeof error === "object" && error && "status" in error
            ? (error as { status?: number }).status
            : undefined;
          toast({
            title: status === 404 ? t("notFound") : t("deleteError"),
            variant: "destructive",
          });
        },
      },
    );
  };

  return (
    <div className="max-w-6xl mx-auto">

      {/* ── Mobile navy banner (hidden md+) ── */}
      <div className="md:hidden" style={{ background: "linear-gradient(135deg, #0A1628 0%, #0D2040 100%)" }}>
        <div className="px-4 pt-5 pb-5 flex items-center justify-between">
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 700, color: "#fff", margin: 0 }}>{t("title")}</h1>
            <p style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", margin: "3px 0 0" }}>
              {isLoading ? t("loading") : `${surgeries?.length ?? 0} ${(surgeries?.length ?? 0) === 1 ? t("record") : t("records")}`}
            </p>
          </div>
          <Link href="/surgeries/new">
            <button
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
          <h1 className="text-3xl font-bold tracking-tight text-foreground">{t("title")}</h1>
          <p className="text-muted-foreground text-sm mt-0.5">{t("history")}</p>
        </div>
        <Link href="/surgeries/new">
          <Button className="gap-2 shrink-0" size="sm">
            <Plus className="h-4 w-4" />
            {t("newProcedure")}
          </Button>
        </Link>
      </div>

      {/* Filters */}
      <div className="flex gap-2 items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder={t("searchPlaceholder")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        {draftsCount > 0 && (
          <button
            onClick={() => setShowDraftsOnly(v => !v)}
            className={`flex items-center gap-1.5 text-sm px-3 py-2 rounded-lg border transition-colors shrink-0 ${
              showDraftsOnly
                ? "bg-amber-100 border-amber-300 text-amber-800"
                : "bg-card border-border text-muted-foreground hover:bg-muted"
            }`}
          >
            <FileEdit className="h-4 w-4" />
            <span className="hidden sm:inline">{t("drafts")}</span>
            <span className="font-bold">{draftsCount}</span>
          </button>
        )}
      </div>

      {/* ── Mobile card list (hidden md+) ── */}
      <div className="md:hidden space-y-2">
        {isLoading ? (
          Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="bg-card border border-border rounded-xl p-4 space-y-2">
              <Skeleton className="h-5 w-36" />
              <Skeleton className="h-4 w-24" />
            </div>
          ))
        ) : filteredSurgeries?.length === 0 ? (
          <div className="text-center py-10 text-muted-foreground text-sm">{t("noProcedure")}</div>
        ) : (
          filteredSurgeries?.map((surgery) => {
            const isDraft = surgery.status === "rascunho";
            return (
              <div
                key={surgery.id}
                className={`border rounded-xl p-4 flex items-start gap-3 transition-colors ${isDraft ? "bg-amber-50/60 border-amber-200" : "bg-card border-border"}`}
              >
                <Link
                  href={isDraft ? `/surgeries/new?draft=${surgery.id}` : `/surgeries/${surgery.id}`}
                  className="flex items-start gap-3 flex-1 min-w-0 active:bg-muted/40"
                >
                  {/* Date badge */}
                  <div className="shrink-0 text-center">
                    <div className="text-xs text-muted-foreground font-mono">
                       {surgery.dataCirurgia ? new Intl.DateTimeFormat(locale, { month: "short" }).format(new Date(surgery.dataCirurgia)).toUpperCase().replace(".", "") : '—'}
                    </div>
                    <div className="text-lg font-bold text-foreground leading-none">
                      {surgery.dataCirurgia ? format(new Date(surgery.dataCirurgia), 'dd') : '—'}
                    </div>
                    <div className="text-xs text-muted-foreground font-mono">
                      {surgery.dataCirurgia ? format(new Date(surgery.dataCirurgia), 'yyyy') : ''}
                    </div>
                  </div>
                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                       <p className="font-semibold text-foreground truncate">{surgery.patientNome}</p>
                      {isDraft && (
                        <span className="text-[10px] font-semibold bg-amber-100 text-amber-700 border border-amber-300 px-1.5 py-0.5 rounded-full uppercase tracking-wide">
                           {t("draft")}
                        </span>
                      )}
                    </div>
                    {surgery.hospital && (
                      <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
                        <Building2 className="h-3 w-3 shrink-0" />
                        {surgery.hospital}
                      </p>
                    )}
                    {surgery.tiposProcedimento.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {surgery.tiposProcedimento.slice(0, 2).map(p => (
                           <Badge key={p} variant="outline" className="text-[10px] font-normal py-0 px-1.5">{displayLabel(p)}</Badge>
                        ))}
                        {surgery.tiposProcedimento.length > 2 && (
                          <Badge variant="outline" className="text-[10px] font-normal py-0 px-1.5 bg-muted">+{surgery.tiposProcedimento.length - 2}</Badge>
                        )}
                      </div>
                    )}
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0 mt-1" />
                </Link>
                <button
                  type="button"
                   aria-label={t("deleteForPatient", { patient: surgery.patientNome })}
                   title={t("deleteSurgery")}
                  onClick={() => setSurgeryToDelete({ id: surgery.id, patientNome: surgery.patientNome })}
                  className="shrink-0 mt-1 h-8 w-8 rounded-md flex items-center justify-center text-destructive hover:bg-destructive/10 transition-colors"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            );
          })
        )}
      </div>

      {/* ── Desktop table (hidden sm-) ── */}
      <div className="hidden md:block rounded-md border bg-card overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50">
               <TableHead>{t("date")}</TableHead>
               <TableHead>{t("patient")}</TableHead>
               <TableHead>{t("procedures")}</TableHead>
               <TableHead>{t("type")}</TableHead>
               <TableHead>{t("hospital")}</TableHead>
               <TableHead className="text-right">{t("actions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell><Skeleton className="h-5 w-24" /></TableCell>
                  <TableCell><Skeleton className="h-5 w-32" /></TableCell>
                  <TableCell><Skeleton className="h-5 w-40" /></TableCell>
                  <TableCell><Skeleton className="h-5 w-20" /></TableCell>
                  <TableCell><Skeleton className="h-5 w-24" /></TableCell>
                  <TableCell><Skeleton className="h-8 w-16 ml-auto" /></TableCell>
                </TableRow>
              ))
            ) : filteredSurgeries?.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                   {t("noSurgery")}
                </TableCell>
              </TableRow>
            ) : (
              filteredSurgeries?.map((surgery) => {
                const isDraft = surgery.status === "rascunho";
                return (
                  <TableRow key={surgery.id} className={isDraft ? "bg-amber-50/40" : undefined}>
                    <TableCell className="font-medium">
                       {surgery.dataCirurgia ? formatDate(surgery.dataCirurgia) : '-'}
                    </TableCell>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2">
                        {surgery.patientNome}
                        {isDraft && (
                          <span className="text-[10px] font-semibold bg-amber-100 text-amber-700 border border-amber-300 px-1.5 py-0.5 rounded-full uppercase tracking-wide">
                             {t("draft")}
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1 max-w-[250px]">
                        {surgery.tiposProcedimento.length === 0 ? (
                           <span className="text-muted-foreground text-xs italic">{t("undefined")}</span>
                        ) : (
                          <>
                            {surgery.tiposProcedimento.slice(0, 2).map(p => (
                               <Badge key={p} variant="outline" className="text-xs font-normal whitespace-nowrap">{displayLabel(p)}</Badge>
                            ))}
                            {surgery.tiposProcedimento.length > 2 && (
                              <Badge variant="outline" className="text-xs font-normal bg-muted">+{surgery.tiposProcedimento.length - 2}</Badge>
                            )}
                          </>
                        )}
                      </div>
                    </TableCell>
                     <TableCell>{surgery.tipoCaso ? displayLabel(surgery.tipoCaso) : '-'}</TableCell>
                    <TableCell>{surgery.hospital || '-'}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        {isDraft ? (
                          <Link href={`/surgeries/new?draft=${surgery.id}`}>
                            <Button variant="outline" size="sm" className="gap-1.5 border-amber-300 text-amber-700 hover:bg-amber-50">
                              <FileEdit className="h-3.5 w-3.5" />
                               {t("continue")}
                            </Button>
                          </Link>
                        ) : (
                          <Link href={`/surgeries/${surgery.id}`}>
                             <Button variant="ghost" size="sm">{t("viewRecord")}</Button>
                          </Link>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                           aria-label={t("deleteForPatient", { patient: surgery.patientNome })}
                           title={t("deleteSurgery")}
                          onClick={() => setSurgeryToDelete({ id: surgery.id, patientNome: surgery.patientNome })}
                          className="gap-1.5 text-destructive hover:bg-destructive/10 hover:text-destructive"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                           <span className="hidden lg:inline">{t("delete")}</span>
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>
    </div>
    <AlertDialog
      open={!!surgeryToDelete}
      onOpenChange={(open) => {
        if (!open && !deleteMutation.isPending) setSurgeryToDelete(null);
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
           <AlertDialogTitle>{t("deleteTitle")}</AlertDialogTitle>
          <AlertDialogDescription>
             {t("deleteDescriptionBefore")}{" "}
             <strong>{surgeryToDelete?.patientNome}</strong>? {t("deleteDescriptionAfter")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
           <AlertDialogCancel disabled={deleteMutation.isPending}>{t("cancel")}</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleDelete}
            disabled={deleteMutation.isPending}
            className="bg-destructive text-destructive-foreground"
          >
             {deleteMutation.isPending ? t("deleting") : t("deleteSurgery")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </div>
  );
}
