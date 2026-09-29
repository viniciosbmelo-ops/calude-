import { describe, expect, it } from "vitest";
import {
  GetAdminDashboardResponse,
  ListDoctorsResponse,
} from "@workspace/docregen-api-zod";

const listedDoctor = {
  id: 1,
  nome: "Dra. Lista",
  email: "lista@example.com",
  crm: "12345",
  crmEstado: "SP",
  especialidade: "Ortopedia",
  isAdmin: false,
  totalPatients: 3,
  totalSurgeries: 2,
  createdAt: "2026-08-20T12:00:00.000Z",
};

const adminDoctor = {
  ...listedDoctor,
  aprovado: true,
  isFree: false,
  temporaryAccessExpiresAt: null,
  subscriptionStatus: "active",
  subscriptionPeriodEnd: 1_800_000_000,
  lastLoginAt: "2026-08-20T13:00:00.000Z",
  lastActivityAt: "2026-08-20T12:30:00.000Z",
};

const adminDashboard = {
  totalDoctors: 1,
  totalPatients: 3,
  totalSurgeries: 2,
  surgeriesByType: [],
  surgeriesByLigament: [],
  avgIkdc: null,
  avgLysholm: null,
  returnToSportRate: null,
  doctorStats: [adminDoctor],
  monthlySurgeries: [],
  totalAcessos: 0,
  acessosHoje: 0,
  acessosSemana: 0,
  medicosAtivos30dias: 0,
  visitasHoje: 0,
  visitasMes: 0,
  visitasAno: 0,
  visitasTotal: 0,
  siteHoje: 0,
  siteMes: 0,
  siteAno: 0,
  siteTotal: 0,
  cadastroHoje: 0,
  cadastroOntem: 0,
  cadastroSemana: 0,
  cadastroMes: 0,
  geographicAccesses: {
    periodDays: 30,
    site: [],
    platform: [],
  },
};

describe("doctor response contracts", () => {
  it("keeps the general doctor list independent of billing and activity fields", () => {
    expect(ListDoctorsResponse.safeParse([listedDoctor]).success).toBe(true);
  });

  it("requires billing and activity fields only in the admin dashboard", () => {
    expect(GetAdminDashboardResponse.safeParse(adminDashboard).success).toBe(true);

    const doctorWithoutSubscriptionStatus = { ...adminDoctor };
    delete (doctorWithoutSubscriptionStatus as Partial<typeof adminDoctor>).subscriptionStatus;

    expect(GetAdminDashboardResponse.safeParse({
      ...adminDashboard,
      doctorStats: [doctorWithoutSubscriptionStatus],
    }).success).toBe(false);
  });
});