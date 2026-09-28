import type { AdminAnalyticsData } from "../types";

type CampaignPerformance = AdminAnalyticsData["campaigns"][number];

export type CampaignMetricKey =
  | "budget"
  | "visits"
  | "registrations"
  | "cac"
  | "revenue"
  | "roi";

export interface CampaignMetricCell {
  key: CampaignMetricKey;
  label: string;
  value: number | null;
  format: "currency" | "number" | "percent";
}

export const CAMPAIGN_PERFORMANCE_COLUMNS: ReadonlyArray<{
  key: CampaignMetricKey;
  label: string;
}> = [
  { key: "budget", label: "Orçamento" },
  { key: "visits", label: "Visitas" },
  { key: "registrations", label: "Cadastros" },
  { key: "cac", label: "CAC" },
  { key: "revenue", label: "Receita" },
  { key: "roi", label: "ROI" },
];

/**
 * Single source of truth for campaign metric column order and values.
 * Keeping headers and cells keyed by the same array prevents financial values
 * from appearing under the wrong labels.
 */
export function getCampaignPerformanceCells(
  campaign: CampaignPerformance,
): CampaignMetricCell[] {
  const values: Record<CampaignMetricKey, Omit<CampaignMetricCell, "key" | "label">> = {
    budget: { value: campaign.budgetCents, format: "currency" },
    visits: { value: campaign.acquisitionVisits, format: "number" },
    registrations: { value: campaign.registrations, format: "number" },
    cac: { value: campaign.cacCents, format: "currency" },
    revenue: { value: campaign.revenueCents, format: "currency" },
    roi: { value: campaign.roiPercent, format: "percent" },
  };

  return CAMPAIGN_PERFORMANCE_COLUMNS.map(({ key, label }) => ({
    key,
    label,
    ...values[key],
  }));
}