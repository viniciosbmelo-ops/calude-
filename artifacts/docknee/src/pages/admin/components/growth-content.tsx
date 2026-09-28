import { useState } from "react";
import { useCampaigns, useMutateCampaign, useFeatureFlags, useMutateFeatureFlag, useAnnouncements, useMutateAnnouncement, useFaqs, useMutateFaq } from "../queries";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Plus, Trash2, Edit2, Zap, Megaphone, HelpCircle, Save, X, RefreshCw } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import type { Announcement, Campaign, Faq, FeatureFlag } from "../types";
import { useLanguage, useScopedTranslations } from "@/lib/i18n";
import { adminConsoleMessages } from "@/locales/admin-console";

function toDateTimeLocal(value: string | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

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

export function GrowthContent() {
  const { data: campaigns, isLoading: campaignsLoading } = useCampaigns();
  const { data: flags, isLoading: flagsLoading } = useFeatureFlags();
  const { data: announcements, isLoading: annLoading } = useAnnouncements();
  const { data: faqs, isLoading: faqsLoading } = useFaqs();

  const mutCampaign = useMutateCampaign();
  const mutFlag = useMutateFeatureFlag();
  const mutAnn = useMutateAnnouncement();
  const mutFaq = useMutateFaq();

  const { toast } = useToast();
  const t = useScopedTranslations(adminConsoleMessages);
  const campaignChannelLabel = (value: string) => ({
    in_app: t("option.inApp"),
    email: t("option.email"),
    social: t("option.social"),
    other: t("option.other"),
  }[value] ?? value);
  const campaignStatusLabel = (value: string) => ({
    draft: t("option.draft"),
    active: t("option.active"),
    paused: t("option.paused"),
    ended: t("option.ended"),
  }[value] ?? value);
  const announcementTypeLabel = (value: string) => ({
    info: t("option.information"),
    success: t("option.success"),
    warning: t("option.warning"),
    error: t("option.error"),
  }[value] ?? value);
  const { formatDate, formatCurrency } = useLanguage();
  const formatDateTime = (value: string | null | undefined) => !value ? "—" : formatDate(value, { dateStyle: "short", timeStyle: "short" });
  const formatCents = (value: number | null | undefined) => value == null ? "—" : formatCurrency(value / 100);

  const [editingCampaign, setEditingCampaign] = useState<Partial<Campaign> | null>(null);
  const [editingFlag, setEditingFlag] = useState<Partial<FeatureFlag> | null>(null);
  const [editingAnn, setEditingAnn] = useState<Partial<Announcement> | null>(null);
  const [editingFaq, setEditingFaq] = useState<Partial<Faq> | null>(null);

  const handleToggleFlag = async (id: number, current: boolean) => {
    try {
      await mutFlag.update.mutateAsync({ id, data: { enabled: !current } });
      toast({ title: t("explicit.255") });
    } catch {
      toast({ title: t("institutions.editService.error"), variant: "destructive" });
    }
  };

  const handleToggleAnn = async (id: number, current: boolean) => {
    try {
      await mutAnn.update.mutateAsync({ id, data: { active: !current } });
      toast({ title: t("explicit.029") });
    } catch {
      toast({ title: t("institutions.editService.error"), variant: "destructive" });
    }
  };

  const handleDeleteCampaign = async (id: number) => {
    if (!confirm(t("explicit.030"))) return;
    try { await mutCampaign.delete.mutateAsync(id); toast({ title: t("explicit.031") }); }
    catch { toast({ title: t("explicit.032"), variant: "destructive" }); }
  };
  const handleDeleteFlag = async (id: number) => {
    if (!confirm(t("explicit.033"))) return;
    try { await mutFlag.delete.mutateAsync(id); toast({ title: t("explicit.034") }); }
    catch { toast({ title: t("explicit.032"), variant: "destructive" }); }
  };
  const handleDeleteAnn = async (id: number) => {
    if (!confirm(t("explicit.035"))) return;
    try { await mutAnn.delete.mutateAsync(id); toast({ title: t("explicit.036") }); }
    catch { toast({ title: t("explicit.032"), variant: "destructive" }); }
  };
  const handleDeleteFaq = async (id: number) => {
    if (!confirm(t("explicit.037"))) return;
    try { await mutFaq.delete.mutateAsync(id); toast({ title: t("explicit.038") }); }
    catch { toast({ title: t("explicit.032"), variant: "destructive" }); }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-foreground">{t("growth.title")}</h2>
          <p className="text-sm text-muted-foreground">{t("growth.subtitle")}</p>
        </div>
      </div>

      <div className="w-full overflow-x-auto pb-2 no-scrollbar">
        <Tabs defaultValue="campaigns" className="w-full min-w-[600px]">
          <TabsList className="grid w-full grid-cols-4 mb-4 bg-muted/50 p-1">
            <TabsTrigger value="campaigns" className="text-xs"><TrendingUpIcon className="h-3.5 w-3.5 mr-2" /> {t("growth.campaigns")}</TabsTrigger>
            <TabsTrigger value="flags" className="text-xs"><Zap className="h-3.5 w-3.5 mr-2" /> {t("growth.flags")}</TabsTrigger>
            <TabsTrigger value="announcements" className="text-xs"><Megaphone className="h-3.5 w-3.5 mr-2" /> {t("growth.announcements")}</TabsTrigger>
            <TabsTrigger value="faqs" className="text-xs"><HelpCircle className="h-3.5 w-3.5 mr-2" /> {t("growth.faq")}</TabsTrigger>
          </TabsList>
        
        <TabsContent value="campaigns" className="space-y-4">
          <Card className="shadow-sm border-border/50">
            <div className="p-4 border-b border-border/50 flex justify-between items-center bg-muted/10">
              <CardTitle className="text-sm font-semibold">{t("explicit.039")}</CardTitle>
              <Button size="sm" className="h-8 text-xs gap-1.5" onClick={() => setEditingCampaign({})}><Plus className="h-3.5 w-3.5" /> {t("growth.newCampaign")}</Button>
            </div>
            {campaignsLoading ? (
              <div className="p-6"><Skeleton className="h-32 w-full" /></div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/30">
                    <TableHead>{t("dialog.name")}</TableHead>
                    <TableHead>{t("explicit.040")}</TableHead>
                    <TableHead>{t("explicit.041")}</TableHead>
                    <TableHead>{t("campaign.budget")}</TableHead>
                    <TableHead>{t("dialog.accountStatus")}</TableHead>
                    <TableHead className="text-right">{t("institutions.tableActions")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {campaigns?.map(c => (
                    <TableRow key={c.id}>
                      <TableCell className="font-semibold text-sm">{c.name}</TableCell>
                      <TableCell><Badge variant="outline" className="text-[10px] uppercase tracking-wider">{campaignChannelLabel(c.channel)}</Badge></TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {formatDateTime(c.startsAt)} <br/> {formatDateTime(c.endsAt)}
                      </TableCell>
                       <TableCell className="text-xs font-mono">{formatCents(c.budgetCents)}</TableCell>
                      <TableCell>
                        <Badge className={`text-[10px] border-none ${
                          c.status === "active" ? "bg-emerald-100 text-emerald-800" :
                          c.status === "draft" ? "bg-slate-100 text-slate-800" :
                          "bg-amber-100 text-amber-800"
                        }`}>
                          {campaignStatusLabel(c.status)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button variant="ghost" size="icon" onClick={() => setEditingCampaign(c)}><Edit2 className="h-4 w-4" /></Button>
                        <Button variant="ghost" size="icon" className="text-red-500" onClick={() => handleDeleteCampaign(c.id)}><Trash2 className="h-4 w-4" /></Button>
                      </TableCell>
                    </TableRow>
                  ))}
                  {campaigns?.length === 0 && (
                    <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground text-sm">{t("growth.noCampaigns")}</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            )}
          </Card>
        </TabsContent>

        <TabsContent value="flags" className="space-y-4">
          <Card className="shadow-sm border-border/50">
            <div className="p-4 border-b border-border/50 flex justify-between items-center bg-muted/10">
              <CardTitle className="text-sm font-semibold">{t("explicit.042")}</CardTitle>
              <Button size="sm" className="h-8 text-xs gap-1.5" onClick={() => setEditingFlag({})}><Plus className="h-3.5 w-3.5" /> {t("explicit.043")}</Button>
            </div>
            {flagsLoading ? (
              <div className="p-6"><Skeleton className="h-32 w-full" /></div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/30">
                    <TableHead>{t("explicit.256")}</TableHead>
                    <TableHead>{t("explicit.044")}</TableHead>
                    <TableHead>{t("explicit.045")}</TableHead>
                    <TableHead className="text-right">{t("explicit.046")}</TableHead>
                    <TableHead className="text-right">{t("institutions.tableActions")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {flags?.map(f => (
                    <TableRow key={f.id}>
                      <TableCell className="font-mono text-xs font-bold">{f.key}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{f.description || "—"}</TableCell>
                      <TableCell className="text-xs font-mono">{f.variant || "—"}</TableCell>
                      <TableCell className="text-right">
                        <Switch checked={f.enabled} onCheckedChange={() => handleToggleFlag(f.id, f.enabled)} />
                      </TableCell>
                      <TableCell className="text-right">
                        <Button variant="ghost" size="icon" onClick={() => setEditingFlag(f)}><Edit2 className="h-4 w-4" /></Button>
                        <Button variant="ghost" size="icon" className="text-red-500" onClick={() => handleDeleteFlag(f.id)}><Trash2 className="h-4 w-4" /></Button>
                      </TableCell>
                    </TableRow>
                  ))}
                  {flags?.length === 0 && (
                    <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground text-sm">{t("growth.noFlags")}</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            )}
          </Card>
        </TabsContent>

        <TabsContent value="announcements" className="space-y-4">
          <Card className="shadow-sm border-border/50">
            <div className="p-4 border-b border-border/50 flex justify-between items-center bg-muted/10">
              <CardTitle className="text-sm font-semibold">{t("explicit.047")}</CardTitle>
              <Button size="sm" className="h-8 text-xs gap-1.5" onClick={() => setEditingAnn({})}><Plus className="h-3.5 w-3.5" /> {t("explicit.048")}</Button>
            </div>
            {annLoading ? (
              <div className="p-6"><Skeleton className="h-32 w-full" /></div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/30">
                    <TableHead>{t("explicit.049")}</TableHead>
                    <TableHead>{t("explicit.050")}</TableHead>
                    <TableHead>{t("explicit.051")}</TableHead>
                    <TableHead className="text-right">{t("staff.activeStatus")}</TableHead>
                    <TableHead className="text-right">{t("institutions.tableActions")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {announcements?.map(a => (
                    <TableRow key={a.id}>
                      <TableCell>
                        <div className="font-semibold text-sm">{a.title}</div>
                        <div className="text-xs text-muted-foreground mt-0.5 truncate max-w-[300px]">{a.body}</div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={`text-[10px] uppercase ${a.type === 'error' ? 'border-red-200 text-red-700 bg-red-50' : 'border-blue-200 text-blue-700 bg-blue-50'}`}>
                          {announcementTypeLabel(a.type)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {a.startsAt ? formatDateTime(a.startsAt) : "Sempre"} → <br/>
                        {a.expiresAt ? formatDateTime(a.expiresAt) : "Sempre"}
                      </TableCell>
                      <TableCell className="text-right">
                        <Switch checked={a.active} onCheckedChange={() => handleToggleAnn(a.id, a.active)} />
                      </TableCell>
                      <TableCell className="text-right">
                        <Button variant="ghost" size="icon" onClick={() => setEditingAnn(a)}><Edit2 className="h-4 w-4" /></Button>
                        <Button variant="ghost" size="icon" className="text-red-500" onClick={() => handleDeleteAnn(a.id)}><Trash2 className="h-4 w-4" /></Button>
                      </TableCell>
                    </TableRow>
                  ))}
                  {announcements?.length === 0 && (
                    <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground text-sm">{t("growth.noAnnouncements")}</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            )}
          </Card>
        </TabsContent>

        <TabsContent value="faqs" className="space-y-4">
          <Card className="shadow-sm border-border/50">
            <div className="p-4 border-b border-border/50 flex justify-between items-center bg-muted/10">
              <CardTitle className="text-sm font-semibold">{t("explicit.257")}</CardTitle>
              <Button size="sm" className="h-8 text-xs gap-1.5" onClick={() => setEditingFaq({})}><Plus className="h-3.5 w-3.5" /> {t("explicit.052")}</Button>
            </div>
            {faqsLoading ? (
              <div className="p-6"><Skeleton className="h-32 w-full" /></div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/30">
                    <TableHead>{t("explicit.053")}</TableHead>
                    <TableHead>{t("explicit.054")}</TableHead>
                    <TableHead>{t("explicit.055")}</TableHead>
                    <TableHead className="text-right">{t("institutions.tableActions")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {faqs?.map(f => (
                    <TableRow key={f.id}>
                      <TableCell className="text-xs font-mono">{f.sortOrder}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{f.category || t("option.general")}</TableCell>
                      <TableCell>
                        <div className="font-semibold text-sm">{f.question}</div>
                        <div className="text-xs text-muted-foreground mt-0.5 line-clamp-2 max-w-[400px]">{f.answer}</div>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button variant="ghost" size="icon" onClick={() => setEditingFaq(f)}><Edit2 className="h-4 w-4" /></Button>
                        <Button variant="ghost" size="icon" className="text-red-500" onClick={() => handleDeleteFaq(f.id)}><Trash2 className="h-4 w-4" /></Button>
                      </TableCell>
                    </TableRow>
                  ))}
                  {faqs?.length === 0 && (
                    <TableRow><TableCell colSpan={4} className="text-center py-8 text-muted-foreground text-sm">{t("explicit.056")}</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            )}
          </Card>
        </TabsContent>
      </Tabs>
      </div>

      {/* Modals */}
      {editingCampaign && (
        <BaseModal title={editingCampaign.id ? t("explicit.057") : t("explicit.058")} onClose={() => setEditingCampaign(null)}>
          <form onSubmit={async (e) => {
            e.preventDefault();
            const formData = new FormData(e.currentTarget);
            const data = {
              name: formData.get("name") as string,
              channel: formData.get("channel") as "email" | "other" | "social" | "in_app" | undefined,
              status: formData.get("status") as "draft" | "active" | "paused" | "ended" | undefined,
              budgetCents: formData.get("budget") ? Math.round(Number(formData.get("budget")) * 100) : null,
              utmCampaign: String(formData.get("utmCampaign") ?? "").trim() || null,
              startsAt: formData.get("startsAt") ? new Date(String(formData.get("startsAt"))).toISOString() : null,
              endsAt: formData.get("endsAt") ? new Date(String(formData.get("endsAt"))).toISOString() : null,
              description: String(formData.get("description") ?? "").trim() || null,
              notes: String(formData.get("notes") ?? "").trim() || null,
            };
            try {
              if (editingCampaign.id) await mutCampaign.update.mutateAsync({ id: editingCampaign.id, data });
              else await mutCampaign.create.mutateAsync(data);
              toast({ title: t("explicit.059") });
              setEditingCampaign(null);
            } catch { toast({ title: t("explicit.060"), variant: "destructive" }); }
          }} className="space-y-4">
            <div><label className="text-xs font-semibold">{t("institutions.editService.name")}</label><input required name="name" defaultValue={editingCampaign.name ?? ""} className="w-full border rounded p-2 text-sm mt-1" /></div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-semibold">{t("explicit.040")}</label>
                <select name="channel" defaultValue={editingCampaign.channel || "in_app"} className="w-full border rounded p-2 text-sm mt-1">
                  <option value="in_app">{t("explicit.258")}</option><option value="email">{t("option.email")}</option><option value="social">{t("explicit.259")}</option><option value="other">{t("option.other")}</option>
                </select>
              </div>
              <div>
                <label className="text-xs font-semibold">{t("dialog.accountStatus")}</label>
                <select name="status" defaultValue={editingCampaign.status || "draft"} className="w-full border rounded p-2 text-sm mt-1">
                  <option value="draft">{t("explicit.061")}</option><option value="active">{t("explicit.046")}</option><option value="paused">{t("explicit.062")}</option><option value="ended">{t("explicit.063")}</option>
                </select>
              </div>
            </div>
            <div><label className="text-xs font-semibold">{t("explicit.064")}</label><input type="number" step="0.01" name="budget" defaultValue={editingCampaign.budgetCents ? editingCampaign.budgetCents / 100 : ""} className="w-full border rounded p-2 text-sm mt-1" /></div>
            <div>
              <label className="text-xs font-semibold">{t("explicit.065")}</label>
              <input name="utmCampaign" defaultValue={editingCampaign.utmCampaign ?? ""} placeholder="ex.: congresso_joelho_2026" className="w-full border rounded p-2 text-sm mt-1" />
              <p className="text-[11px] text-muted-foreground mt-1">{t("explicit.066")}</p>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div><label className="text-xs font-semibold">{t("explicit.067")}</label><input type="datetime-local" name="startsAt" defaultValue={toDateTimeLocal(editingCampaign.startsAt)} className="w-full border rounded p-2 text-sm mt-1" /></div>
              <div><label className="text-xs font-semibold">{t("explicit.068")}</label><input type="datetime-local" name="endsAt" defaultValue={toDateTimeLocal(editingCampaign.endsAt)} className="w-full border rounded p-2 text-sm mt-1" /></div>
            </div>
            <div><label className="text-xs font-semibold">{t("explicit.044")}</label><textarea name="description" defaultValue={editingCampaign.description ?? ""} className="w-full border rounded p-2 text-sm mt-1" rows={2}></textarea></div>
            <div><label className="text-xs font-semibold">{t("explicit.069")}</label><textarea name="notes" defaultValue={editingCampaign.notes ?? ""} className="w-full border rounded p-2 text-sm mt-1" rows={2}></textarea></div>
            <div className="flex justify-end gap-2 pt-4">
              <Button type="button" variant="outline" onClick={() => setEditingCampaign(null)}>{t("institutions.resetService.cancel")}</Button>
              <Button type="submit">{t("save")}</Button>
            </div>
          </form>
        </BaseModal>
      )}

      {editingFlag && (
        <BaseModal title={editingFlag.id ? t("growth.editFlag") : t("explicit.070")} onClose={() => setEditingFlag(null)}>
          <form onSubmit={async (e) => {
            e.preventDefault();
            const formData = new FormData(e.currentTarget);
            const data = {
              key: formData.get("key") as string,
              description: formData.get("description") as string,
              variant: formData.get("variant") as string || undefined,
              enabled: formData.get("enabled") === "true",
            };
            try {
              if (editingFlag.id) await mutFlag.update.mutateAsync({ id: editingFlag.id, data });
              else await mutFlag.create.mutateAsync(data);
              toast({ title: t("explicit.071") });
              setEditingFlag(null);
            } catch { toast({ title: t("explicit.060"), variant: "destructive" }); }
          }} className="space-y-4">
            <div><label className="text-xs font-semibold">{t("explicit.072")}</label><input required name="key" defaultValue={editingFlag.key} disabled={!!editingFlag.id} className="w-full border rounded p-2 text-sm mt-1" /></div>
            <div><label className="text-xs font-semibold">{t("explicit.044")}</label><input name="description" defaultValue={editingFlag.description ?? ""} className="w-full border rounded p-2 text-sm mt-1" /></div>
            <div><label className="text-xs font-semibold">{t("explicit.073")}</label><input name="variant" defaultValue={editingFlag.variant ?? ""} className="w-full border rounded p-2 text-sm mt-1" /></div>
            <div className="flex items-center gap-2 mt-2">
              <input type="checkbox" name="enabled" value="true" defaultChecked={editingFlag.enabled} id="ff-enabled" />
              <label htmlFor="ff-enabled" className="text-sm">{t("explicit.074")}</label>
            </div>
            <div className="flex justify-end gap-2 pt-4">
              <Button type="button" variant="outline" onClick={() => setEditingFlag(null)}>{t("institutions.resetService.cancel")}</Button>
              <Button type="submit">{t("save")}</Button>
            </div>
          </form>
        </BaseModal>
      )}

      {editingAnn && (
        <BaseModal title={editingAnn.id ? t("explicit.075") : t("explicit.076")} onClose={() => setEditingAnn(null)}>
          <form onSubmit={async (e) => {
            e.preventDefault();
            const formData = new FormData(e.currentTarget);
            const data = {
              title: formData.get("title") as string,
              body: formData.get("body") as string,
              type: formData.get("type") as any,
              active: formData.get("active") === "true",
            };
            try {
              if (editingAnn.id) await mutAnn.update.mutateAsync({ id: editingAnn.id, data });
              else await mutAnn.create.mutateAsync(data);
              toast({ title: t("explicit.077") });
              setEditingAnn(null);
            } catch { toast({ title: t("explicit.060"), variant: "destructive" }); }
          }} className="space-y-4">
            <div><label className="text-xs font-semibold">{t("explicit.078")}</label><input required name="title" defaultValue={editingAnn.title} className="w-full border rounded p-2 text-sm mt-1" /></div>
            <div>
              <label className="text-xs font-semibold">{t("explicit.050")}</label>
              <select name="type" defaultValue={editingAnn.type || "info"} className="w-full border rounded p-2 text-sm mt-1">
                <option value="info">{t("explicit.079")}</option><option value="success">{t("explicit.080")}</option><option value="warning">{t("explicit.081")}</option><option value="error">{t("error")}</option>
              </select>
            </div>
            <div><label className="text-xs font-semibold">{t("explicit.082")}</label><textarea required name="body" defaultValue={editingAnn.body} className="w-full border rounded p-2 text-sm mt-1" rows={4}></textarea></div>
            <div className="flex items-center gap-2 mt-2">
              <input type="checkbox" name="active" value="true" defaultChecked={editingAnn.active ?? true} id="ann-active" />
              <label htmlFor="ann-active" className="text-sm">{t("explicit.083")}</label>
            </div>
            <div className="flex justify-end gap-2 pt-4">
              <Button type="button" variant="outline" onClick={() => setEditingAnn(null)}>{t("institutions.resetService.cancel")}</Button>
              <Button type="submit">{t("save")}</Button>
            </div>
          </form>
        </BaseModal>
      )}

      {editingFaq && (
        <BaseModal title={editingFaq.id ? t("explicit.084") : t("explicit.085")} onClose={() => setEditingFaq(null)}>
          <form onSubmit={async (e) => {
            e.preventDefault();
            const formData = new FormData(e.currentTarget);
            const data = {
              question: formData.get("question") as string,
              answer: formData.get("answer") as string,
              category: formData.get("category") as string,
              sortOrder: parseInt(formData.get("sortOrder") as string) || 0,
              active: true, // Always active for now
            };
            try {
              if (editingFaq.id) await mutFaq.update.mutateAsync({ id: editingFaq.id, data });
              else await mutFaq.create.mutateAsync(data);
              toast({ title: t("explicit.086") });
              setEditingFaq(null);
            } catch { toast({ title: t("explicit.060"), variant: "destructive" }); }
          }} className="space-y-4">
            <div><label className="text-xs font-semibold">{t("explicit.087")}</label><input required name="question" defaultValue={editingFaq.question} className="w-full border rounded p-2 text-sm mt-1" /></div>
            <div><label className="text-xs font-semibold">{t("explicit.088")}</label><textarea required name="answer" defaultValue={editingFaq.answer} className="w-full border rounded p-2 text-sm mt-1" rows={4}></textarea></div>
            <div className="grid grid-cols-2 gap-4">
              <div><label className="text-xs font-semibold">{t("explicit.054")}</label><input name="category" defaultValue={editingFaq.category ?? ""} placeholder={t("explicit.260")} className="w-full border rounded p-2 text-sm mt-1" /></div>
              <div><label className="text-xs font-semibold">{t("explicit.089")}</label><input type="number" name="sortOrder" defaultValue={editingFaq.sortOrder || 0} className="w-full border rounded p-2 text-sm mt-1" /></div>
            </div>
            <div className="flex justify-end gap-2 pt-4">
              <Button type="button" variant="outline" onClick={() => setEditingFaq(null)}>{t("institutions.resetService.cancel")}</Button>
              <Button type="submit">{t("save")}</Button>
            </div>
          </form>
        </BaseModal>
      )}
    </div>
  );
}

function TrendingUpIcon(props: any) {
  return <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}><polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/></svg>
}
