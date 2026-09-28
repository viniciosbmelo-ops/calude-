import { useState } from "react";
import { useAdminMessages, useUpdateTicket, useReplyMessage, useAdminAlerts, useMarkAlertRead } from "../queries";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MessageSquare, AlertTriangle, CheckCircle, Clock, Search, Send, User } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useLanguage, useScopedTranslations } from "@/lib/i18n";
import { adminConsoleMessages } from "@/locales/admin-console";

export function Support() {
  const { data: messages, isLoading: messagesLoading } = useAdminMessages();
  const { data: alerts, isLoading: alertsLoading } = useAdminAlerts(true);
  const updateTicket = useUpdateTicket();
  const replyMsg = useReplyMessage();
  const markRead = useMarkAlertRead();
  const { toast } = useToast();
  const t = useScopedTranslations(adminConsoleMessages);
  const { formatDate } = useLanguage();
  const formatDateTime = (value: string | null | undefined) => !value ? "—" : formatDate(value, { dateStyle: "short", timeStyle: "short" });

  const [searchMsg, setSearchMsg] = useState("");
  const [replyTexts, setReplyTexts] = useState<Record<number, string>>({});

  const filteredMessages = messages?.filter(m => 
    m.nome?.toLowerCase().includes(searchMsg.toLowerCase()) || 
    m.email?.toLowerCase().includes(searchMsg.toLowerCase()) ||
    m.mensagem.toLowerCase().includes(searchMsg.toLowerCase())
  ) || [];

  const handleUpdateTicket = async (id: number, field: string, value: string | null) => {
    try {
      await updateTicket.mutateAsync({ id, data: { [field]: value } });
      toast({ title: t("support.sent") });
    } catch {
      toast({ title: t("error"), variant: "destructive" });
    }
  };

  const handleReply = async (id: number) => {
    const text = replyTexts[id];
    if (!text) return;
    try {
      await replyMsg.mutateAsync({ id, resposta: text });
      toast({ title: t("support.sent") });
      setReplyTexts(prev => ({ ...prev, [id]: "" }));
    } catch {
      toast({ title: t("error"), variant: "destructive" });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-foreground">{t("support.title")}</h2>
          <p className="text-sm text-muted-foreground">{t("support.subtitle")}</p>
        </div>
      </div>

      <Tabs defaultValue="tickets" className="w-full">
        <TabsList className="grid w-full grid-cols-2 max-w-sm mb-4">
          <TabsTrigger value="tickets">{t("support.tickets")}</TabsTrigger>
          <TabsTrigger value="alerts">{t("support.alerts")}</TabsTrigger>
        </TabsList>
        
        <TabsContent value="tickets" className="space-y-4">
          <Card className="shadow-sm border-border/50">
            <div className="p-4 border-b border-border/50 flex items-center gap-2">
              <Search className="h-4 w-4 text-muted-foreground" />
              <input 
                type="text" 
                placeholder={t("support.search")}
                className="flex-1 bg-transparent border-none text-sm outline-none placeholder:text-muted-foreground"
                value={searchMsg}
                onChange={e => setSearchMsg(e.target.value)}
              />
            </div>
            {messagesLoading ? (
              <div className="p-6 space-y-3">
                {[1,2,3].map(i => <Skeleton key={i} className="h-12 w-full" />)}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/30">
                      <TableHead className="w-[30%]">{t("explicit.135")}</TableHead>
                      <TableHead className="w-[40%]">{t("explicit.136")}</TableHead>
                      <TableHead className="w-[15%]">{t("explicit.137")}</TableHead>
                      <TableHead className="w-[15%] text-right">{t("explicit.138")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredMessages.map(msg => (
                      <TableRow key={msg.id} className="hover:bg-muted/20 items-start">
                        <TableCell className="align-top">
                          <div className="font-semibold text-sm">{msg.nome || t("anonymous")}</div>
                          <div className="text-xs text-muted-foreground font-mono mt-0.5 break-all">{msg.email}</div>
                          {msg.celular && <div className="text-[10px] text-muted-foreground mt-0.5">{msg.celular}</div>}
                          {msg.crm && <div className="text-[10px] text-muted-foreground mt-0.5">CRM: {msg.crm}</div>}
                          <div className="text-[10px] text-muted-foreground mt-2">{t("createdAt")} {formatDateTime(msg.createdAt)}</div>
                        </TableCell>
                        <TableCell className="align-top">
                          <p className="text-sm whitespace-pre-wrap">{msg.mensagem}</p>
                          {msg.resposta && (
                            <div className="mt-3 p-3 bg-muted/50 rounded-md border border-border/50">
                              <p className="text-[10px] font-bold text-muted-foreground mb-1 uppercase tracking-wider">{t("explicit.139")}</p>
                              <p className="text-xs">{msg.resposta}</p>
                              <p className="text-[10px] text-muted-foreground mt-1">{t("sentAt")} {formatDateTime(msg.respondidaEm)}</p>
                            </div>
                          )}
                          {!msg.resposta && msg.ticketStatus !== "closed" && (
                            <div className="mt-3 flex gap-2">
                              <textarea 
                                className="w-full text-xs p-2 rounded-md border border-border/50 bg-background resize-none h-16 focus:outline-none focus:ring-1 focus:ring-primary"
                                placeholder={t("support.reply")}
                                value={replyTexts[msg.id] || ""}
                                onChange={e => setReplyTexts(prev => ({ ...prev, [msg.id]: e.target.value }))}
                              />
                              <Button size="icon" className="h-auto shrink-0" onClick={() => handleReply(msg.id)} disabled={!replyTexts[msg.id]}>
                                <Send className="h-4 w-4" />
                              </Button>
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="align-top space-y-2">
                          <div>
                            <select 
                              className="text-xs bg-background border border-border/50 rounded p-1 w-full"
                              value={msg.ticketStatus || "open"}
                              onChange={e => handleUpdateTicket(msg.id, "ticketStatus", e.target.value)}
                            >
                               <option value="open">{t("ticket.open")}</option>
                               <option value="in_progress">{t("ticket.inProgress")}</option>
                               <option value="resolved">{t("ticket.resolved")}</option>
                               <option value="closed">{t("ticket.closed")}</option>
                            </select>
                          </div>
                          <div>
                            <select 
                              className="text-xs bg-background border border-border/50 rounded p-1 w-full"
                              value={msg.ticketPriority || "medium"}
                              onChange={e => handleUpdateTicket(msg.id, "ticketPriority", e.target.value)}
                            >
                               <option value="low">{t("priority.low")}</option>
                               <option value="medium">{t("priority.medium")}</option>
                               <option value="high">{t("priority.high")}</option>
                               <option value="critical">{t("priority.critical")}</option>
                            </select>
                          </div>
                          <div>
                            <input 
                              type="text"
                              className="text-[10px] bg-background border border-border/50 rounded p-1 w-full placeholder:text-muted-foreground/50"
                               placeholder={t("tags")}
                              defaultValue={msg.ticketTags || ""}
                              onBlur={(e) => {
                                if (e.target.value !== (msg.ticketTags || "")) {
                                  handleUpdateTicket(msg.id, "ticketTags", e.target.value);
                                }
                              }}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.preventDefault();
                                  e.currentTarget.blur();
                                }
                              }}
                            />
                          </div>
                          {msg.slaDueAt && (
                            <div className="text-[10px] mt-1 font-mono flex items-center gap-1 text-muted-foreground">
                               <Clock className="h-3 w-3" /> {t("due")} {formatDate(msg.slaDueAt)}
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="align-top text-right">
                          {/* Actions can be expanded here */}
                          <Badge variant={msg.resposta ? "secondary" : "default"} className="text-[10px]">
                             {msg.resposta ? t("support.answered") : t("support.waiting")}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                    {filteredMessages.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={4} className="text-center py-8 text-muted-foreground text-sm">
                          {t("support.noTickets")}
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            )}
          </Card>
        </TabsContent>

        <TabsContent value="alerts" className="space-y-4">
          <Card className="shadow-sm border-border/50">
            {alertsLoading ? (
              <div className="p-6 space-y-3">
                {[1,2,3].map(i => <Skeleton key={i} className="h-12 w-full" />)}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/30">
                      <TableHead>{t("explicit.265")}</TableHead>
                      <TableHead>{t("explicit.140")}</TableHead>
                      <TableHead>{t("staff.surgeryDate")}</TableHead>
                      <TableHead className="text-right">{t("explicit.138")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {alerts?.map(alert => (
                      <TableRow key={alert.id} className={`hover:bg-muted/20 ${!alert.read ? "bg-red-50/30 dark:bg-red-950/10" : ""}`}>
                        <TableCell>
                          <div className="flex items-start gap-2">
                            {alert.severity === "critical" || alert.severity === "error" ? (
                              <AlertTriangle className="h-4 w-4 text-red-500 mt-0.5 shrink-0" />
                            ) : (
                              <MessageSquare className="h-4 w-4 text-blue-500 mt-0.5 shrink-0" />
                            )}
                            <div>
                              <div className={`font-semibold text-sm ${!alert.read ? "text-foreground" : "text-muted-foreground"}`}>
                                {alert.title}
                              </div>
                              <div className="text-xs text-muted-foreground mt-0.5">{alert.message}</div>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-[10px] font-mono bg-background">{alert.source}</Badge>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground font-mono">
                          {formatDateTime(alert.createdAt)}
                        </TableCell>
                        <TableCell className="text-right">
                          {!alert.read ? (
                            <Button variant="ghost" size="sm" className="h-8 text-xs text-emerald-600 gap-1" onClick={() => markRead.mutate(alert.id)}>
                               <CheckCircle className="h-3.5 w-3.5" /> {t("support.markRead")}
                            </Button>
                          ) : (
                             <span className="text-[10px] text-muted-foreground italic">{t("read")} {alert.readAt ? formatDateTime(alert.readAt) : ""}</span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                    {alerts?.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={4} className="text-center py-8 text-muted-foreground text-sm">
                          {t("support.noAlerts")}
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
    </div>
  );
}
