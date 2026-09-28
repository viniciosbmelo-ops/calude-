import { useState } from "react";
import { useAuditLogs } from "../queries";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useLanguage, useScopedTranslations } from "@/lib/i18n";
import { adminConsoleMessages } from "@/locales/admin-console";

export function ComplianceSecurity() {
  // Audit Logs State
  const [auditDays, setAuditDays] = useState(7);
  const [auditDoctorId, setAuditDoctorId] = useState("");
  const { data: auditData, isLoading: auditLoading } = useAuditLogs(auditDays, auditDoctorId);
  const t = useScopedTranslations(adminConsoleMessages);
  const { formatDate } = useLanguage();

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-foreground">{t("compliance.title")}</h2>
          <p className="text-sm text-muted-foreground">{t("compliance.subtitle")}</p>
        </div>
      </div>

      <Card className="shadow-sm border-border/50">
            <div className="p-4 border-b border-border/50 flex flex-wrap gap-4 items-center bg-muted/10">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-muted-foreground">{t("compliance.period")}</span>
                <select className="bg-background border border-border/50 rounded p-1.5 text-xs" value={auditDays} onChange={e => setAuditDays(Number(e.target.value))}>
                  <option value={1}>{t("compliance.last24")}</option>
                  <option value={7}>{t("compliance.last7")}</option>
                  <option value={30}>{t("compliance.last30")}</option>
                </select>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-muted-foreground">{t("compliance.doctorId")}</span>
                <input 
                  type="text" 
                  className="bg-background border border-border/50 rounded p-1.5 text-xs w-24 outline-none" 
                  placeholder={t("compliance.optional")}
                  value={auditDoctorId}
                  onChange={e => setAuditDoctorId(e.target.value)}
                />
              </div>
            </div>
            
            {auditLoading ? (
              <div className="p-6"><Skeleton className="h-64 w-full" /></div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/30">
                      <TableHead>{t("explicit.024")}</TableHead>
                      <TableHead>{t("explicit.025")}</TableHead>
                      <TableHead>{t("explicit.026")}</TableHead>
                      <TableHead>{t("explicit.027")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {auditData?.logs?.map((log: any) => (
                      <TableRow key={log.id} className="hover:bg-muted/20">
                        <TableCell className="text-xs font-mono text-muted-foreground whitespace-nowrap">
                          {formatDate(log.createdAt, { dateStyle: "short", timeStyle: "short" })}
                        </TableCell>
                        <TableCell className="text-xs font-mono">
                          ID: {log.doctorId || "Anônimo"}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" className={`text-[10px] font-mono ${log.method === 'DELETE' ? 'text-red-600 border-red-200' : 'text-blue-600 border-blue-200'}`}>
                              {log.method}
                            </Badge>
                            <span className="text-xs truncate max-w-[300px]" title={log.path}>{log.path}</span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="text-[10px] font-mono text-muted-foreground">{log.ipAddress}</div>
                          <div className={`text-[10px] font-bold ${log.responseStatus >= 400 ? 'text-red-600' : 'text-emerald-600'}`}>
                            {t("explicit.028")} {log.responseStatus}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                    {auditData?.logs?.length === 0 && (
                      <TableRow><TableCell colSpan={4} className="text-center py-8 text-muted-foreground text-sm">{t("compliance.noLogs")}</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            )}
          </Card>
    </div>
  );
}
