import { useState } from "react";
import { useServices, usePhysios, useMutateService, useMutatePhysio } from "../queries";
import { ServiceInst, AdminPhysio } from "../types";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Building2, Search, Activity, Plus, Edit2, Trash2, KeyRound, Ban, CheckCircle, X } from "lucide-react";
import { AdminRegisterDialog, AdminResetPasswordDialog } from "./shared";
import { useToast } from "@/hooks/use-toast";
import { sortByPtBrName } from "@/lib/utils";
import { useLanguage, useScopedTranslations } from "@/lib/i18n";
import { adminConsoleMessages } from "@/locales/admin-console";

function BaseModal({ title, children, onClose }: { title: string, children: React.ReactNode, onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-card w-full max-w-lg rounded-xl shadow-xl border border-border flex flex-col max-h-[90vh]">
        <div className="p-4 border-b border-border flex justify-between items-center">
          <h3 className="font-bold text-lg">{title}</h3>
          <button onClick={onClose} className="p-1 hover:bg-muted rounded"><X className="h-5 w-5" /></button>
        </div>
        <div className="p-4 overflow-y-auto">
          {children}
        </div>
      </div>
    </div>
  );
}

export function Institutions() {
  const { data: services, isLoading: servicesLoading } = useServices();
  const { data: physios, isLoading: physiosLoading } = usePhysios();
  const mutService = useMutateService();
  const mutPhysio = useMutatePhysio();
  const { toast } = useToast();
  const t = useScopedTranslations(adminConsoleMessages);
  const { formatDate } = useLanguage();
  const formatDateTime = (value: string | null | undefined) => !value ? t("never") : formatDate(value);

  const [searchInst, setSearchInst] = useState("");
  const [searchPhysio, setSearchPhysio] = useState("");
  
  const [showRegService, setShowRegService] = useState(false);
  const [editingService, setEditingService] = useState<ServiceInst | null>(null);
  const [serviceCreateError, setServiceCreateError] = useState<string | null>(null);
  
  const [showRegPhysio, setShowRegPhysio] = useState(false);
  const [resetPassUser, setResetPassUser] = useState<{ id: string | number; role: "doctor" | "physio" | "service" } | null>(null);

  const filteredServices = sortByPtBrName((services?.filter(s =>
    s.nome.toLowerCase().includes(searchInst.toLowerCase()) ||
    s.email.toLowerCase().includes(searchInst.toLowerCase())
  ) || []), (service) => service.nome, (service) => service.id);

  const filteredPhysios = sortByPtBrName((physios?.filter(p =>
    p.nome.toLowerCase().includes(searchPhysio.toLowerCase()) ||
    p.email.toLowerCase().includes(searchPhysio.toLowerCase()) ||
    (p.crefito && p.crefito.includes(searchPhysio))
  ) || []), (physio) => physio.nome, (physio) => physio.id);

  const handlePhysioBlock = async (p: AdminPhysio) => {
    const action = p.ativo ? "block" : "unblock";
    if (p.ativo && !confirm(t("institutions.blockPhysio.confirm", { name: p.nome }))) return;
    try {
      await mutPhysio.mutateAsync({ id: p.id as number, action });
      toast({ title: p.ativo ? t("institutions.blockPhysio.blocked", { name: p.nome }) : t("institutions.blockPhysio.unblocked", { name: p.nome }) });
    } catch { toast({ title: t("institutions.blockPhysio.error"), variant: "destructive" }); }
  };

  const handleDeleteService = async (s: ServiceInst) => {
    if (!confirm(t("institutions.deleteService.confirm", { name: s.nome }))) return;
    try {
      await mutService.delete.mutateAsync(s.id as number);
      toast({ title: t("institutions.deleteService.success") });
    } catch { toast({ title: t("institutions.deleteService.error"), variant: "destructive" }); }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-foreground">{t("institutions.title")}</h2>
          <p className="text-sm text-muted-foreground">{t("institutions.subtitle")}</p>
        </div>
      </div>

      <Tabs defaultValue="services" className="w-full">
        <TabsList className="grid w-full grid-cols-2 max-w-sm mb-4">
          <TabsTrigger value="services">{t("institutions.services", { count: filteredServices.length })}</TabsTrigger>
          <TabsTrigger value="physios">{t("institutions.physios", { count: filteredPhysios.length })}</TabsTrigger>
        </TabsList>
        
        <TabsContent value="services" className="space-y-4">
          <Card className="shadow-sm border-border/50">
            <div className="p-4 border-b border-border/50 flex flex-col sm:flex-row gap-4 items-center justify-between">
              <div className="flex items-center gap-2 w-full max-w-md bg-muted/30 p-2 rounded-lg border border-border/50">
                <Search className="h-4 w-4 text-muted-foreground" />
                <input 
                  type="text" 
                  placeholder={t("institutions.searchServices")}
                  className="flex-1 bg-transparent border-none text-sm outline-none placeholder:text-muted-foreground"
                  value={searchInst}
                  onChange={e => setSearchInst(e.target.value)}
                />
              </div>
              <Button size="sm" className="gap-1.5 whitespace-nowrap" onClick={() => setShowRegService(true)}>
                <Building2 className="h-3.5 w-3.5" /> {t("institutions.newService")}
              </Button>
            </div>
            {servicesLoading ? (
              <div className="p-6 space-y-3" aria-label={t("institutions.loadingServices")} role="status">
                <span className="sr-only">{t("institutions.loadingServices")}</span>
                {[1,2,3].map(i => <Skeleton key={i} className="h-12 w-full" />)}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/30">
                      <TableHead>{t("institutions.tableInstitution")}</TableHead>
                      <TableHead>{t("institutions.tableStatusPlan")}</TableHead>
                      <TableHead>{t("institutions.tableActivity")}</TableHead>
                      <TableHead className="text-right">{t("institutions.tableActions")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredServices.map(service => (
                      <TableRow key={service.id} className="hover:bg-muted/20">
                        <TableCell>
                          <div className="font-semibold text-sm">{service.nome}</div>
                          <div className="text-xs text-muted-foreground font-mono mt-0.5">{service.email}</div>
                        </TableCell>
                        <TableCell>
                          <div className="space-y-1">
                            {service.is_active ? (
                              <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100 border-none text-[10px]">{t("institutions.active")}</Badge>
                            ) : (
                              <Badge className="bg-red-100 text-red-800 hover:bg-red-100 border-none text-[10px]">{t("institutions.blocked")}</Badge>
                            )}
                            <div className="text-[11px] font-medium text-purple-600 uppercase tracking-wider">{service.plan_type || 'standard'}</div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="text-xs text-muted-foreground flex flex-col gap-1">
                            <span className="flex items-center gap-1"><Activity className="h-3 w-3" /> {t("institutions.lastLogin")} {formatDateTime(service.last_login_at)}</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-right whitespace-nowrap">
                          <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => setResetPassUser({ id: service.id as number, role: "service" })}><KeyRound className="h-3.5 w-3.5 mr-1" /> {t("institutions.passwordAction")}</Button>
                          <Button variant="ghost" size="icon" className="h-8 w-8 ml-1 text-slate-600" onClick={() => setEditingService(service)}><Edit2 className="h-4 w-4" /></Button>
                          <Button variant="ghost" size="icon" className="h-8 w-8 ml-1 text-red-600" onClick={() => handleDeleteService(service)} title={t("institutions.deleteService.action")} aria-label={t("institutions.deleteService.action")}><Trash2 className="h-4 w-4" /></Button>
                        </TableCell>
                      </TableRow>
                    ))}
                    {filteredServices.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={4} className="text-center py-8 text-muted-foreground text-sm">
                          {t("institutions.noServices")}
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            )}
          </Card>
        </TabsContent>

        <TabsContent value="physios" className="space-y-4">
          <Card className="shadow-sm border-border/50">
            <div className="p-4 border-b border-border/50 flex flex-col sm:flex-row gap-4 items-center justify-between">
              <div className="flex items-center gap-2 w-full max-w-md bg-muted/30 p-2 rounded-lg border border-border/50">
                <Search className="h-4 w-4 text-muted-foreground" />
                <input 
                  type="text" 
                  placeholder={t("institutions.searchPhysios")}
                  className="flex-1 bg-transparent border-none text-sm outline-none placeholder:text-muted-foreground"
                  value={searchPhysio}
                  onChange={e => setSearchPhysio(e.target.value)}
                />
              </div>
              <Button size="sm" className="gap-1.5 whitespace-nowrap" onClick={() => setShowRegPhysio(true)}>
                <Plus className="h-3.5 w-3.5" /> {t("institutions.newPhysio")}
              </Button>
            </div>
            {physiosLoading ? (
              <div className="p-6 space-y-3" aria-label={t("institutions.loadingPhysios")} role="status">
                <span className="sr-only">{t("institutions.loadingPhysios")}</span>
                {[1,2,3].map(i => <Skeleton key={i} className="h-12 w-full" />)}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/30">
                      <TableHead>{t("institutions.tablePhysio")}</TableHead>
                      <TableHead>{t("institutions.tableWorkLocation")}</TableHead>
                      <TableHead>{t("institutions.tableStatusPlan")}</TableHead>
                      <TableHead className="text-right">{t("institutions.tableActions")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredPhysios.map(physio => (
                      <TableRow key={physio.id} className="hover:bg-muted/20">
                        <TableCell>
                          <div className="font-semibold text-sm">{physio.nome}</div>
                          <div className="text-xs text-muted-foreground font-mono mt-0.5">{physio.email}</div>
                          {physio.crefito && <div className="text-[10px] text-muted-foreground mt-0.5">CREFITO: {physio.crefito}</div>}
                        </TableCell>
                        <TableCell>
                          <div className="text-sm">{physio.clinica || "—"}</div>
                          {physio.cidade && <div className="text-[10px] text-muted-foreground">{physio.cidade}</div>}
                        </TableCell>
                        <TableCell>
                          <div className="space-y-1">
                            {physio.ativo ? (
                              <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100 border-none text-[10px]">{t("institutions.active")}</Badge>
                            ) : (
                              <Badge className="bg-red-100 text-red-800 hover:bg-red-100 border-none text-[10px]">{t("institutions.blocked")}</Badge>
                            )}
                            <div className="text-[11px] font-medium text-purple-600 uppercase tracking-wider">{physio.plan}</div>
                          </div>
                        </TableCell>
                        <TableCell className="text-right whitespace-nowrap">
                          <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => setResetPassUser({ id: physio.id as number, role: "physio" })}><KeyRound className="h-3.5 w-3.5 mr-1" /> {t("institutions.passwordAction")}</Button>
                          <Button variant="ghost" size="icon" className={`h-8 w-8 ml-1 ${physio.ativo ? "text-amber-600" : "text-emerald-600"}`} onClick={() => handlePhysioBlock(physio)} title={physio.ativo ? t("institutions.blockPhysio.blockAction") : t("institutions.blockPhysio.unblockAction")} aria-label={physio.ativo ? t("institutions.blockPhysio.blockAction") : t("institutions.blockPhysio.unblockAction")}>
                            {physio.ativo ? <Ban className="h-4 w-4" /> : <CheckCircle className="h-4 w-4" />}
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                    {filteredPhysios.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={4} className="text-center py-8 text-muted-foreground text-sm">
                          {t("institutions.noPhysios")}
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

      {/* Modals */}
      {showRegService && (
        <BaseModal title={t("institutions.createService.title")} onClose={() => setShowRegService(false)}>
          <form onSubmit={async (e) => {
            e.preventDefault();
            const formData = new FormData(e.currentTarget);
            try {
              setServiceCreateError(null);
              await mutService.create.mutateAsync({
                nome: formData.get("nome") as string,
                cnpj: (formData.get("cnpj") as string) || undefined,
                responsavelNome: formData.get("responsavelNome") as string,
                responsavelCpf: formData.get("responsavelCpf") as string,
                responsavelCrm: formData.get("responsavelCrm") as string,
                email: formData.get("email") as string,
                senha: formData.get("senha") as string,
              });
              toast({ title: t("institutions.createService.success") });
              setShowRegService(false);
            } catch (error) {
              const message = error instanceof Error ? error.message : t("institutions.createService.errorFallback");
              setServiceCreateError(message);
              toast({ title: t("institutions.createService.error"), description: message, variant: "destructive" });
            }
          }} className="space-y-4">
            {serviceCreateError && (
              <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                {serviceCreateError}
              </div>
            )}
            <div>
              <label className="text-xs font-semibold">{t("institutions.createService.institutionName")}</label>
              <input required minLength={2} name="nome" className="w-full border rounded p-2 text-sm mt-1 bg-transparent" />
            </div>
            <div>
              <label className="text-xs font-semibold">{t("institutions.createService.cnpj")}</label>
              <input name="cnpj" placeholder={t("institutions.createService.optional")} className="w-full border rounded p-2 text-sm mt-1 bg-transparent" />
            </div>
            <div>
              <label className="text-xs font-semibold">{t("institutions.createService.responsibleName")}</label>
              <input required minLength={2} name="responsavelNome" className="w-full border rounded p-2 text-sm mt-1 bg-transparent" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-semibold">{t("institutions.createService.responsibleCpf")}</label>
                <input required minLength={11} name="responsavelCpf" placeholder={t("institutions.createService.numbersOnly")} className="w-full border rounded p-2 text-sm mt-1 bg-transparent" />
              </div>
              <div>
                <label className="text-xs font-semibold">{t("institutions.createService.responsibleCrm")}</label>
                <input required minLength={4} name="responsavelCrm" placeholder={t("institutions.createService.crmNumber")} className="w-full border rounded p-2 text-sm mt-1 bg-transparent" />
              </div>
            </div>
            <div>
              <label className="text-xs font-semibold">{t("institutions.createService.accessEmail")}</label>
              <input required type="email" name="email" className="w-full border rounded p-2 text-sm mt-1 bg-transparent" />
            </div>
            <div>
              <label className="text-xs font-semibold">{t("institutions.createService.temporaryPassword")}</label>
              <input required minLength={6} type="password" name="senha" placeholder={t("institutions.createService.passwordMinimum")} className="w-full border rounded p-2 text-sm mt-1 bg-transparent" />
            </div>
            <div className="flex justify-end gap-2 pt-4">
              <Button type="button" variant="outline" onClick={() => setShowRegService(false)}>{t("cancel")}</Button>
              <Button type="submit" disabled={mutService.create.isPending}>
                {mutService.create.isPending ? t("institutions.createService.creating") : t("institutions.createService.submit")}
              </Button>
            </div>
          </form>
        </BaseModal>
      )}

      {editingService && (
        <BaseModal title={t("institutions.editService.title")} onClose={() => setEditingService(null)}>
          <form onSubmit={async (e) => {
            e.preventDefault();
            const formData = new FormData(e.currentTarget);
            try {
              await mutService.update.mutateAsync({
                id: editingService.id as number,
                data: { nome: formData.get("nome") as string, email: formData.get("email") as string }
              });
              toast({ title: t("institutions.editService.success") });
              setEditingService(null);
            } catch { toast({ title: t("institutions.editService.error"), variant: "destructive" }); }
          }} className="space-y-4">
            <div><label className="text-xs font-semibold">{t("institutions.editService.name")}</label><input required name="nome" defaultValue={editingService.nome} className="w-full border rounded p-2 text-sm mt-1 bg-transparent" /></div>
            <div><label className="text-xs font-semibold">{t("institutions.editService.accessEmail")}</label><input type="email" name="email" defaultValue={editingService.email || ""} className="w-full border rounded p-2 text-sm mt-1 bg-transparent" /></div>
            <div className="flex justify-end gap-2 pt-4">
              <Button type="button" variant="outline" onClick={() => setEditingService(null)}>{t("cancel")}</Button>
              <Button type="submit" disabled={mutService.update.isPending}>{mutService.update.isPending ? t("institutions.editService.saving") : t("save")}</Button>
            </div>
          </form>
        </BaseModal>
      )}
      
      {showRegPhysio && <AdminRegisterDialog type="physio" onClose={() => setShowRegPhysio(false)} onSuccess={() => setShowRegPhysio(false)} />}
      {resetPassUser && <AdminResetPasswordDialog userId={resetPassUser.id as string} role={resetPassUser.role} onClose={() => setResetPassUser(null)} />}
    </div>
  );
}