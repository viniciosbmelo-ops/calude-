import { useEffect, useState } from "react";
import { useSearch } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { physioFetch } from "@/lib/physio-auth";
import FisioShell from "./shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { CheckCircle2, Crown, ExternalLink, Sparkles } from "lucide-react";
import { useLanguage, useScopedTranslations } from "@/lib/i18n";
import { physioMessages } from "@/locales/physio";

interface Plan {
  priceId: string;
  unitAmount: number;
  currency: string;
  interval: string;
}

interface BillingStatus {
  plan: string;
  subscriptionStatus: string;
  patientsCreatedTotal: number;
  freeLimit: number;
  hasActiveSubscription: boolean;
  readOnly: boolean;
  canAddPatients: boolean;
}

export default function FisioPlanos() {
  const search = useSearch();
  const paid = new URLSearchParams(search).get("paid") === "1";
  const queryClient = useQueryClient();
  const [loadingPrice, setLoadingPrice] = useState<string | null>(null);
  const [portalLoading, setPortalLoading] = useState(false);
  const { formatCurrency } = useLanguage();
  const t = useScopedTranslations(physioMessages);
  const formatBRL = (cents: number) => formatCurrency(cents / 100, "BRL");
  const statusLabel: Record<string, string> = {
    none: t("subscription"),
    trialing: t("freeTrial"),
    active: t("active"),
    past_due: t("paymentPending"),
    canceled: t("subscriptionCanceled"),
  };

  const { data: plansData } = useQuery<{ plans: Plan[]; freeLimit: number }>({
    queryKey: ["physio-billing-plans"],
    queryFn: async () => {
      const res = await physioFetch("/api/physio/billing/plans");
      if (!res.ok) throw new Error("Falha ao carregar planos");
      return res.json();
    },
  });

  const { data: status } = useQuery<BillingStatus>({
    queryKey: ["physio-billing-status"],
    refetchInterval: paid ? 3000 : false,
    queryFn: async () => {
      const res = await physioFetch("/api/physio/billing/status");
      if (!res.ok) throw new Error("Falha ao carregar status");
      return res.json();
    },
  });

  async function openCheckout(priceId: string) {
    setLoadingPrice(priceId);
    try {
      const res = await physioFetch("/api/physio/billing/checkout", {
        method: "POST",
        body: JSON.stringify({ priceId }),
      });
      const data = await res.json();
      if (!res.ok || !data.url) {
         toast.error(data.error ?? t("connectionError"));
        return;
      }
      window.location.href = data.url;
    } finally {
      setLoadingPrice(null);
    }
  }

  async function openPortal() {
    setPortalLoading(true);
    try {
      const res = await physioFetch("/api/physio/billing/portal", { method: "POST" });
      const data = await res.json();
      if (!res.ok || !data.url) {
         toast.error(data.error ?? t("connectionError"));
        return;
      }
      window.location.href = data.url;
    } finally {
      setPortalLoading(false);
    }
  }

  const monthly = plansData?.plans.find((p) => p.interval === "month");
  const yearly = plansData?.plans.find((p) => p.interval === "year");
  const isSubscriber = status?.hasActiveSubscription ?? false;

  useEffect(() => {
    if (paid && isSubscriber) {
      queryClient.invalidateQueries({ queryKey: ["physio-billing-status"] });
    }
  }, [paid, isSubscriber, queryClient]);

  return (
    <FisioShell>
      <div className="space-y-6 max-w-3xl mx-auto">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{t("plans")}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {t("firstPatientsFree")}
          </p>
        </div>

        {paid && (
          <Card className="border-green-500/40 bg-green-500/5">
            <CardContent className="py-4 flex items-center gap-3">
              <CheckCircle2 className="h-5 w-5 text-green-600 shrink-0" />
              <p className="text-sm text-foreground">
                {isSubscriber
                  ? t("paymentConfirmed")
                  : t("activatingSubscription")}
              </p>
            </CardContent>
          </Card>
        )}

        {status && (
          <Card>
            <CardContent className="py-4 flex flex-wrap items-center justify-between gap-3">
              <div className="space-y-1">
                <p className="text-sm font-medium text-foreground">
                  {t("subscription")}: <Badge variant={isSubscriber ? "default" : "secondary"}>{statusLabel[status.subscriptionStatus] ?? status.subscriptionStatus}</Badge>
                </p>
                {!isSubscriber && (
                  <p className="text-xs text-muted-foreground">
                    {t("freePatientsUsed", { used: Math.min(status.patientsCreatedTotal, status.freeLimit), limit: status.freeLimit })}
                  </p>
                )}
              </div>
              {(isSubscriber || status.subscriptionStatus === "past_due" || status.subscriptionStatus === "canceled") && (
                <Button variant="outline" size="sm" onClick={openPortal} disabled={portalLoading} data-testid="button-portal" className="gap-1.5">
                  <ExternalLink className="h-4 w-4" />
                  {portalLoading ? t("opening") : t("manageSubscription")}
                </Button>
              )}
            </CardContent>
          </Card>
        )}

        <div className="grid sm:grid-cols-2 gap-4">
          <Card data-testid="card-plano-mensal">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                 <Sparkles className="h-4 w-4 text-[#1FB6E1]" /> {t("monthly")}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-3xl font-bold text-foreground">
                {monthly ? formatBRL(monthly.unitAmount) : formatBRL(4990)}
                <span className="text-sm font-normal text-muted-foreground">{t("perMonth")}</span>
              </p>
              <ul className="text-sm text-muted-foreground space-y-1.5">
                <li>{t("unlimitedPatients")}</li>
                <li>{t("completeRecordPdf")}</li>
                <li>{t("allMonthlyFeatures")}</li>
              </ul>
              <Button
                className="w-full"
                disabled={!monthly || loadingPrice !== null || isSubscriber}
                onClick={() => monthly && openCheckout(monthly.priceId)}
                data-testid="button-assinar-mensal"
              >
                {isSubscriber ? t("planActive") : loadingPrice === monthly?.priceId ? t("opening") : t("subscribeMonthly")}
              </Button>
            </CardContent>
          </Card>

          <Card className="border-[#1FB6E1]/50" data-testid="card-plano-anual">
            <CardHeader>
              <CardTitle className="flex items-center justify-between gap-2 text-base">
                <span className="flex items-center gap-2">
                   <Crown className="h-4 w-4 text-[#1FB6E1]" /> {t("yearly")}
                </span>
                 <Badge className="bg-[#1FB6E1] text-white hover:bg-[#1FB6E1]">{t("monthsFree")}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-3xl font-bold text-foreground">
                {yearly ? formatBRL(yearly.unitAmount) : formatBRL(49900)}
                <span className="text-sm font-normal text-muted-foreground">{t("perYear")}</span>
              </p>
              <ul className="text-sm text-muted-foreground space-y-1.5">
                <li>{t("scheduleAndAssessments")}</li>
                <li>{t("equivalentTenMonths")}</li>
                <li>{t("yearlySavings", { amount: formatBRL(4990 * 12 - 49900) })}</li>
              </ul>
              <Button
                className="w-full bg-[#1FB6E1] hover:bg-[#199ec4] text-white"
                disabled={!yearly || loadingPrice !== null || isSubscriber}
                onClick={() => yearly && openCheckout(yearly.priceId)}
                data-testid="button-assinar-anual"
              >
                {isSubscriber ? t("planActive") : loadingPrice === yearly?.priceId ? t("opening") : t("subscribeYearly")}
              </Button>
            </CardContent>
          </Card>
        </div>

        <p className="text-xs text-muted-foreground text-center">
          {t("cancellationNotice")}
        </p>
      </div>
    </FisioShell>
  );
}
