import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { useScopedTranslations } from "@/lib/i18n";
import { operationalCoreMessages } from "@/locales/operational-core";
import { reportingDashboardMessages } from "@/locales/reporting-dashboard";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { FlaskConical } from "lucide-react";

type RegenFilters = { produto: string; status: string; dataInicio: string; dataFim: string };

const EMPTY_REGEN_FILTERS: RegenFilters = { produto: "", status: "", dataInicio: "", dataFim: "" };

const PROD_LABELS: Record<string, string> = {
  PRP: "PRP", LP_PRP: "LP-PRP", LR_PRP: "LR-PRP", PRF: "PRF",
  AH: "Ác. Hialurônico", COLAGENO: "Colágeno", BMAC: "BMA",
  MFAT: "MFAT", NANOFAT: "Nanofat", SVF: "SVF", LISADO: "Lisado",
  SUBCONDROPLASTIA: "Subcondroplastia", HIDROGEL: "Hidrogel",
};

interface RegenReport {
  total: number;
  byProduct: Record<string, number>;
  byStatus: Record<string, number>;
  byCondition: Record<string, number>;
}

function CountList({ entries, sort = false, truncate = false }: { entries: Record<string, number>; sort?: boolean; truncate?: boolean }) {
  const rows = Object.entries(entries);
  if (rows.length === 0) return <span className="text-xs text-muted-foreground">—</span>;
  if (sort) rows.sort((a, b) => b[1] - a[1]);
  return (
    <>
      {rows.map(([label, n]) => (
        <div key={label} className="flex items-center justify-between gap-2">
          <span className={`text-xs text-foreground${truncate ? " truncate" : ""}`}>{label.replace(/_/g, "-")}</span>
          <span className="text-xs font-bold" style={{ color: "#0E8A96" }}>{n}</span>
        </div>
      ))}
    </>
  );
}

export default function Reports() {
  const t = useScopedTranslations(operationalCoreMessages);
  const tx = useScopedTranslations(reportingDashboardMessages);

  const [regenFilters, setRegenFilters] = useState<RegenFilters>(EMPTY_REGEN_FILTERS);
  const [appliedRegen, setAppliedRegen] = useState<RegenFilters>(EMPTY_REGEN_FILTERS);

  const { data: regenData, isLoading: regenLoading } = useQuery<RegenReport>({
    queryKey: ["reports/regen", appliedRegen],
    queryFn: async () => {
      const p = new URLSearchParams();
      if (appliedRegen.produto)    p.set("produto",    appliedRegen.produto);
      if (appliedRegen.status)     p.set("status",     appliedRegen.status);
      if (appliedRegen.dataInicio) p.set("dataInicio", appliedRegen.dataInicio);
      if (appliedRegen.dataFim)    p.set("dataFim",    appliedRegen.dataFim);
      const res = await fetch(`/api/reports/regen${p.toString() ? "?" + p.toString() : ""}`, {
        credentials: "same-origin",
      });
      if (!res.ok) throw new Error(tx("loadError"));
      return res.json();
    },
  });

  const statusLabel = (status: string) =>
    status === "draft" ? tx("draft") : status === "active" ? tx("activeStatus") : status === "closed" ? tx("closed") : status;

  const appliedSummary = [
    appliedRegen.produto ? PROD_LABELS[appliedRegen.produto] ?? appliedRegen.produto : "",
    appliedRegen.status ? statusLabel(appliedRegen.status) : "",
    appliedRegen.dataInicio ? tx("fromAppliedDate", { date: appliedRegen.dataInicio }) : "",
    appliedRegen.dataFim ? tx("toAppliedDate", { date: appliedRegen.dataFim }) : "",
  ].filter(Boolean).join(" · ");

  return (
    <div className="max-w-full animate-in fade-in">
      {/* ── Mobile navy banner (hidden md+) ── */}
      <div className="md:hidden" style={{ background: "linear-gradient(135deg, #0B1F4B 0%, #12306B 100%)" }}>
        <div className="px-4 pt-5 pb-4">
          <h1 style={{ fontSize: 22, fontWeight: 700, color: "#fff", margin: 0 }}>{t("reports")}</h1>
          <p style={{ fontSize: 12, color: "rgba(255,255,255,0.6)", margin: "4px 0 0" }}>{tx("regenReportsSubtitle")}</p>
        </div>
      </div>

      <div className="p-6 md:p-8 max-w-7xl mx-auto space-y-5">
        {/* ── Desktop header (hidden on mobile) ── */}
        <div className="hidden md:flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-foreground">{t("reports")}</h1>
            <p className="text-muted-foreground mt-1">{tx("regenReportsSubtitle")}</p>
          </div>
          <Link href="/regen/pesquisa">
            <Button variant="outline" className="gap-2">
              <FlaskConical className="h-4 w-4" />
              {tx("researchExport")}
            </Button>
          </Link>
        </div>

        {/* ── Filtros de Ortobiológicos ── */}
        <div className="border rounded-lg overflow-hidden" style={{ borderColor: "rgba(14,154,167,0.35)" }}>
          <div className="flex items-center justify-between px-4 py-2.5 border-b" style={{ background: "rgba(14,154,167,0.10)", borderColor: "rgba(14,154,167,0.35)" }}>
            <span className="text-sm font-medium" style={{ color: "#0B1F4B" }}>{tx("orthobiologics")}</span>
            <div className="flex gap-2">
              <Button size="sm" className="h-7 text-xs" style={{ background: "#0E8A96" }} onClick={() => setAppliedRegen(regenFilters)}>
                {tx("apply")}
              </Button>
              <Button size="sm" variant="outline" className="h-7 text-xs"
                onClick={() => { setRegenFilters(EMPTY_REGEN_FILTERS); setAppliedRegen(EMPTY_REGEN_FILTERS); }}>
                {tx("clear")}
              </Button>
            </div>
          </div>
          <div className="p-4 space-y-3">
            <div>
              <Label className="text-xs text-muted-foreground block mb-1.5">{tx("product")}</Label>
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(PROD_LABELS).map(([code, label]) => {
                  const active = regenFilters.produto === code;
                  return (
                    <button key={code} type="button"
                      onClick={() => setRegenFilters(f => ({ ...f, produto: active ? "" : code }))}
                      className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${active ? "text-white" : "bg-background text-muted-foreground border-border hover:text-foreground"}`}
                      style={active ? { background: "#0E8A96", borderColor: "#0E8A96" } : undefined}>
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">{tx("status")}</Label>
                <Select value={regenFilters.status} onValueChange={v => setRegenFilters(f => ({ ...f, status: v === "_all" ? "" : v }))}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue placeholder={tx("all")} /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="_all">{tx("all")}</SelectItem>
                    <SelectItem value="draft">{tx("draft")}</SelectItem>
                    <SelectItem value="active">{tx("activeStatus")}</SelectItem>
                    <SelectItem value="closed">{tx("closed")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">{tx("fromDate")}</Label>
                <Input type="date" className="h-8 text-xs" value={regenFilters.dataInicio} onChange={e => setRegenFilters(f => ({ ...f, dataInicio: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">{tx("toDate")}</Label>
                <Input type="date" className="h-8 text-xs" value={regenFilters.dataFim} onChange={e => setRegenFilters(f => ({ ...f, dataFim: e.target.value }))} />
              </div>
            </div>
          </div>
        </div>

        {/* ── Métricas de Ortobiológicos ── */}
        {regenLoading ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20 rounded-xl" />)}
          </div>
        ) : regenData ? (
          <Card className="shadow-sm" style={{ borderColor: "rgba(14,154,167,0.35)" }}>
            <CardContent className="pt-4 pb-4">
              <div className="flex items-center gap-2 mb-3">
                <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: "#0E8A96" }}>{tx("orthobiologics")}</span>
                {appliedSummary && <span className="text-xs text-muted-foreground">{appliedSummary}</span>}
              </div>
              <div className="grid gap-3 grid-cols-2 sm:grid-cols-4">
                <div className="bg-card rounded-lg border p-3">
                  <div className="text-xs text-muted-foreground mb-1">{tx("totalCases")}</div>
                  <div className="text-2xl font-bold" style={{ color: "#0B1F4B" }}>{regenData.total}</div>
                  <div className="text-xs text-muted-foreground">{tx("orthobiologicsCount")}</div>
                </div>
                <div className="bg-card rounded-lg border p-3">
                  <div className="text-xs text-muted-foreground mb-1">{tx("byProduct")}</div>
                  <div className="space-y-0.5 max-h-24 overflow-y-auto"><CountList entries={regenData.byProduct} sort /></div>
                </div>
                <div className="bg-card rounded-lg border p-3">
                  <div className="text-xs text-muted-foreground mb-1">{tx("byStatus")}</div>
                  <div className="space-y-0.5">
                    <CountList entries={Object.fromEntries(Object.entries(regenData.byStatus).map(([s, n]) => [statusLabel(s), n]))} />
                  </div>
                </div>
                <div className="bg-card rounded-lg border p-3">
                  <div className="text-xs text-muted-foreground mb-1">{tx("byCondition")}</div>
                  <div className="space-y-0.5 max-h-24 overflow-y-auto"><CountList entries={regenData.byCondition} sort truncate /></div>
                </div>
              </div>
            </CardContent>
          </Card>
        ) : null}

        <div className="md:hidden">
          <Link href="/regen/pesquisa">
            <Button variant="outline" className="w-full gap-2">
              <FlaskConical className="h-4 w-4" />
              {tx("researchExport")}
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
