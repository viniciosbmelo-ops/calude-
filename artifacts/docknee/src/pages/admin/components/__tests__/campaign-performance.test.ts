import { describe, expect, it } from "vitest";
import {
  CAMPAIGN_PERFORMANCE_COLUMNS,
  getCampaignPerformanceCells,
} from "../campaign-performance";
import type { AdminAnalyticsData } from "../../types";

describe("campaign performance table", () => {
  it("keeps each financial and acquisition value under its matching header", () => {
    const campaign = {
      budgetCents: 12_345,
      acquisitionVisits: 60,
      registrations: 3,
      cacCents: 4_115,
      revenueCents: 50_000,
      roiPercent: 305.02,
    } as AdminAnalyticsData["campaigns"][number];

    const cells = getCampaignPerformanceCells(campaign);

    expect(cells.map((cell) => cell.key)).toEqual(
      CAMPAIGN_PERFORMANCE_COLUMNS.map((column) => column.key),
    );
    expect(cells.map((cell) => cell.label)).toEqual([
      "Orçamento",
      "Visitas",
      "Cadastros",
      "CAC",
      "Receita",
      "ROI",
    ]);
    expect(cells.map((cell) => cell.value)).toEqual([
      12_345,
      60,
      3,
      4_115,
      50_000,
      305.02,
    ]);
  });
});