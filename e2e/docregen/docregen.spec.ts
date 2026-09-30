/**
 * DocRegen end-to-end: one doctor's journey through the app, in order.
 * Fictional data only; runs against the disposable stack from global-setup.ts.
 */
import { test, expect, type Page, type BrowserContext } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { DB, DOCREGEN_DOCTOR, DOCREGEN_OTHER_DOCTOR, RUN_ID, SCREENSHOT_DIR } from "../support/env";
import {
  FICTIONAL_PNG, answerPreConsult, expectNoInvalidDate, fakeCpf, fillDate, failShot, fillVisibleFields, formatCpf, isoToBr, isoToday, shot, sql, trackPageErrors,
} from "../support/helpers";

const APP = "docregen";
const PATIENT = {
  nome: `Paciente Ficticia Regen ${RUN_ID}`,
  cpf: fakeCpf(Number.parseInt(RUN_ID, 36) % 1_000_000 + 11),
  nascimento: "15/03/1968",
  nascimentoIso: "1968-03-15",
};

test.describe.configure({ mode: "serial" });

let context: BrowserContext;
let page: Page;
let pageErrors: string[];
let patientId: number;
let preConsultLink: string;

test.beforeAll(async ({ browser }) => {
  context = await browser.newContext();
  page = await context.newPage();
  pageErrors = trackPageErrors(page);
});

test.afterAll(async () => {
  await context.close();
});

async function login(p: Page, email: string, senha: string) {
  await p.goto("/docregen/login");
  await p.locator("#identificador").fill(email);
  await p.locator("#password").fill(senha);
  await p.getByRole("button", { name: /^Entrar$/ }).click();
  await p.waitForURL(/\/docregen\/(dashboard|regen)/);
}

test("register doctor, approval gate bypassed by seed SQL, login", async () => {
  await page.goto("/docregen/register");
  await page.locator("#nome").fill(DOCREGEN_DOCTOR.nome);
  await page.locator("#email").fill(DOCREGEN_DOCTOR.email);
  await page.locator("#senha").fill(DOCREGEN_DOCTOR.senha);
  await page.locator("#crm").fill(String(100000 + (Number.parseInt(RUN_ID, 36) % 899999)));
  await page.locator("#crmEstado").fill("SP");
  await page.locator("#cpf").fill(formatCpf(fakeCpf(Number.parseInt(RUN_ID, 36) % 1_000_000 + 3)));
  await page.locator("#terms").click();
  await shot(page, APP, "01-register-form");
  await page.getByRole("button", { name: /Finalizar cadastro/ }).click();
  await page.waitForURL(/\/docregen\/(dashboard|pending-approval|regen)/);

  // Subscription/approval gate: the real flow needs Stripe or an admin. Seed it.
  sql(DB.docregen, `UPDATE doctors SET is_free = true, aprovado = true WHERE email = '${DOCREGEN_DOCTOR.email}'`);

  await context.clearCookies();
  await login(page, DOCREGEN_DOCTOR.email, DOCREGEN_DOCTOR.senha);
  await shot(page, APP, "02-after-login");
});

test("create patient with DD/MM/AAAA birth date and send pré-consulta", async () => {
  await page.goto("/docregen/patients/new");
  await page.locator("#nome").fill(PATIENT.nome);
  await page.locator("#cpf").fill(PATIENT.cpf);
  await fillDate(page, "#dataNascimento", PATIENT.nascimento);
  await expect(page.locator("#dataNascimento")).toHaveValue(PATIENT.nascimento);
  await page.locator("#telefone").fill("(11) 90000-0000");
  await shot(page, APP, "03-new-patient");
  const created = page.waitForResponse((r) => r.url().endsWith("/regen-api/patients") && r.request().method() === "POST");
  await page.getByRole("button", { name: "Salvar Paciente" }).click();
  const createdBody = await (await created).json() as { id: number; dataNascimento?: string };
  patientId = createdBody.id;
  expect(sql(DB.docregen, `SELECT data_nascimento FROM patients WHERE id = ${patientId}`)).toBe(PATIENT.nascimentoIso);

  const invite = page.waitForResponse((r) => /\/pre-consult\/invite$/.test(r.url()) && r.request().method() === "POST");
  await page.getByRole("button", { name: "Encaminhar pré-consulta" }).click();
  const inviteBody = await (await invite).json() as { link: string };
  preConsultLink = inviteBody.link;
  expect(preConsultLink).toContain("/docregen/pre-consulta/");
  await expect(page.getByText("Convite pronto para envio")).toBeVisible();
  await shot(page, APP, "04-pre-consult-invite");
});

test("patient opens the public pré-consulta link, validates CPF, fills all steps and uploads an exam", async ({ browser }) => {
  const patientContext = await browser.newContext();
  const patientPage = await patientContext.newPage();
  const errors = trackPageErrors(patientPage);
  try {
    await answerPreConsult(patientPage, preConsultLink, PATIENT.cpf, APP);
    expect(errors.filter((e) => e.startsWith("pageerror"))).toEqual([]);
  } catch (error) {
    await failShot(patientPage, APP, "patient-pre-consult");
    throw error;
  } finally {
    await patientContext.close();
  }
});

test("doctor sees the pré-consulta answers and downloads the exam", async () => {
  await page.goto(`/docregen/patients/${patientId}`);
  await page.getByRole("button", { name: /^Pré-consulta$/ }).or(page.getByRole("tab", { name: /^Pré-consulta$/ })).first().click();
  await expect(page.getByText("15/03/1968").filter({ visible: true }).first()).toBeVisible();
  await expect(page.locator("textarea").first()).toHaveValue("Resposta ficticia etapa 1");
  const attachment = page.locator("a", { hasText: "exame-ficticio.png" });
  await expect(attachment).toBeVisible();
  const href = await attachment.getAttribute("href");
  expect(href).toBeTruthy();
  const download = await page.request.get(href!);
  expect(download.status()).toBe(200);
  expect(download.headers()["content-type"]).toBe("image/png");
  expect(Buffer.compare(await download.body(), FICTIONAL_PNG)).toBe(0);
  await shot(page, APP, "08-doctor-pre-consult-tab");
});

let kneeCaseId: string;
let shoulderCaseId: string;

async function createRegenCase(regionLabel: string, conditionLabel: RegExp, caseDate: string, planning?: () => Promise<void>): Promise<string> {
  await page.goto("/docregen/regen/caso/novo");
  // First visit straight from the sidebar shortcut: the regenerative terms
  // must be offered here (the API refuses cases without them).
  const terms = page.getByRole("button", { name: "Li e concordo com os Termos e DPA" });
  await page.getByPlaceholder("Buscar paciente cadastrado...").waitFor();
  if (await terms.waitFor({ timeout: 3_000 }).then(() => true, () => false)) {
    await shot(page, APP, "09a-regen-terms-on-new-case");
    await terms.click();
    await expect(terms).toBeHidden();
  }
  await page.getByPlaceholder("Buscar paciente cadastrado...").fill(PATIENT.nome.slice(0, 20));
  await page.getByRole("button", { name: new RegExp(PATIENT.nome, "i") }).first().click();
  await fillDate(page, page.locator("input[placeholder='DD/MM/AAAA']").first(), caseDate);
  await page.getByRole("button", { name: new RegExp(`^${regionLabel}`) }).click();
  await page.getByRole("button", { name: conditionLabel }).click();
  await shot(page, APP, `09-new-case-${regionLabel.toLowerCase().replace(/\W+/g, "-")}`);
  for (let step = 0; step < 5; step++) {
    // Step 5 of 6 is the product planning (planned products + application sites).
    if (step === 4 && planning) await planning();
    await page.getByRole("button", { name: /^Próximo/ }).click();
  }
  await page.getByRole("button", { name: /Salvar Caso/ }).click();
  await page.waitForURL(/\/docregen\/regen\/caso\/[0-9a-f-]+$/);
  return page.url().split("/").at(-1)!;
}

test("create regenerative cases: knee OA Kellgren-Lawrence III and shoulder", async () => {
  const caseDate = isoToBr(isoToday(-30));
  kneeCaseId = await createRegenCase("Joelho", /Kellgren-Lawrence III$/, caseDate);
  await expect(page.getByText(/Kellgren-Lawrence III/).filter({ visible: true }).first()).toBeVisible();
  expect(sql(DB.docregen, `SELECT condition_code FROM regen_cases WHERE id = '${kneeCaseId}'`)).toBe("OA_JOELHO_KL3");
  // The case snapshot carries the patient's birth date (age band in research).
  expect(sql(DB.docregen, `SELECT to_char(patient_dob, 'YYYY-MM-DD') FROM regen_cases WHERE id = '${kneeCaseId}'`))
    .toBe(PATIENT.nascimentoIso);
  await expectNoInvalidDate(page);
  await shot(page, APP, "10-knee-case");

  shoulderCaseId = await createRegenCase("Ombro", /Tendinopatia do Manguito Rotador/, caseDate);
  expect(sql(DB.docregen, `SELECT condition_code FROM regen_cases WHERE id = '${shoulderCaseId}'`)).toBe("TENDINOPATIA_OMBRO");
  // The shoulder case schedules the shoulder SANE, never the knee one.
  await expect(page.getByText("SANE Ombro").filter({ visible: true }).first()).toBeVisible();
  await expect(page.getByText("SANE Joelho")).toHaveCount(0);
  await shot(page, APP, "11-shoulder-case");
});

test("navigation names the cases area 'Procedimentos' (routes stay /regen)", async () => {
  await page.goto("/docregen/dashboard");
  const nav = page.getByRole("link", { name: /^Procedimentos$/ }).filter({ visible: true }).first();
  await expect(nav).toBeVisible();
  await expect(page.getByRole("link", { name: /^Regenerativa$/ })).toHaveCount(0);
  await shot(page, APP, "11b-sidebar-procedimentos");
  await nav.click();
  await page.waitForURL(/\/docregen\/regen$/);
  await expect(page.getByRole("heading", { name: "Procedimentos" }).filter({ visible: true })).toBeVisible();

  await page.goto(`/docregen/regen/caso/${kneeCaseId}`);
  await expect(page.getByTestId("case-tab-procedures")).toHaveText(/^Aplicações/);
});

test("register an application on the knee case (tab 'Aplicações')", async () => {
  await page.goto(`/docregen/regen/caso/${kneeCaseId}`);
  await page.getByTestId("case-tab-procedures").click();
  await expect(page.locator("[role=tabpanel][data-state=active]")).toContainText("Nenhuma aplicação registrada neste caso.");
  await page.getByRole("button", { name: /Registrar aplicação/ }).click();
  const procedureDate = isoToBr(isoToday(-7));
  await fillDate(page, page.locator("[role=tabpanel][data-state=active] input[placeholder='DD/MM/AAAA']").first(), procedureDate);
  await page.getByRole("button", { name: /^PRP — Plasma Rico em Plaquetas/ }).click();
  const saved = page.waitForResponse((r) => /\/procedures$/.test(r.url()) && r.request().method() === "POST");
  await page.locator("[role=tabpanel][data-state=active]").getByRole("button", { name: /^Salvar$/ }).click();
  expect((await saved).status()).toBeLessThan(300);
  await expect(page.getByTestId("case-tab-procedures")).toContainText("(1)");
  await expect(page.locator("[role=tabpanel][data-state=active]")).toContainText(procedureDate);
  expect(sql(DB.docregen, `SELECT (performed_at AT TIME ZONE 'America/Sao_Paulo')::date::text FROM regen_procedures WHERE case_id = '${kneeCaseId}'`)).toBe(isoToday(-7));
  await expect(page.getByTestId("case-tab-procedures")).toHaveText("Aplicações (1)");
  await shot(page, APP, "12-procedure");
});

test("patient PROM link: VAS + knee SANE answered by the patient, doctor sees values and chart", async ({ browser }) => {
  await page.goto(`/docregen/regen/caso/${kneeCaseId}`);
  const startSchedule = page.getByRole("button", { name: /Iniciar Cronograma/ });
  if (await startSchedule.waitFor({ timeout: 3_000 }).then(() => true, () => false)) await startSchedule.click();
  const copyLink = page.getByRole("button", { name: /^Copiar link$/ }).first();
  await expect(copyLink).toBeVisible();
  const prepared = page.waitForResponse((r) => /\/prepare-whatsapp$/.test(r.url()));
  await copyLink.click();
  const { link } = await (await prepared).json() as { link: string };
  expect(link).toContain("/docregen/patient/regen/");
  await expectNoInvalidDate(page);
  await shot(page, APP, "13-followup-schedule");

  const patientContext = await browser.newContext();
  const patientPage = await patientContext.newPage();
  try {
    await patientPage.goto(new URL(link).pathname);
    await patientPage.locator("#cpf").fill(formatCpf(PATIENT.cpf));
    await patientPage.getByRole("button", { name: "Acessar questionários" }).click();
    // Scale 1: VAS 0–10 → 3
    const vas = patientPage.getByRole("slider").first();
    await expect(vas).toBeVisible();
    await vas.focus();
    await vas.press("Home");
    for (let i = 0; i < 3; i++) await vas.press("ArrowRight");
    await shot(patientPage, APP, "14-patient-vas");
    await patientPage.getByRole("button", { name: /Próxima escala/ }).click();
    // Scale 2: SANE Joelho 0–100 → 70
    await expect(patientPage.getByText(/SANE|normal/i).first()).toBeVisible();
    const sane = patientPage.getByRole("slider").first();
    await sane.focus();
    await sane.press("Home");
    for (let i = 0; i < 7; i++) await sane.press("PageUp");
    await shot(patientPage, APP, "15-patient-sane");
    await patientPage.getByRole("button", { name: /^Concluir$/ }).click();
    await expect(patientPage.getByText("Tudo concluído!")).toBeVisible();
  } catch (error) {
    await failShot(patientPage, APP, "patient-prom");
    throw error;
  } finally {
    await patientContext.close();
  }

  const stored = sql(DB.docregen, `SELECT r.nome_escala || '=' || r.score::int FROM regen_scale_responses r
    JOIN regen_followup_notifications n ON n.id = r.notification_id WHERE n.case_id = '${kneeCaseId}' ORDER BY r.nome_escala`);
  expect(stored.split("\n")).toEqual(["SANE Joelho=70", "VAS Dor=3"]);

  await page.reload();
  await page.getByTestId("case-tab-proms").click();
  const proms = page.locator("[role=tabpanel][data-state=active]");
  await expect(proms).toContainText("Evolução · SANE-joelho70");
  await expect(proms).toContainText("Evolução · VAS3");
  await expect(proms.getByRole("row", { name: /VAS\s*3\s*Resposta do paciente/ })).toBeVisible();
  await expect(proms.getByRole("row", { name: /SANE-joelho\s*70\s*Resposta do paciente/ })).toBeVisible();
  await shot(page, APP, "16-doctor-proms");

  // A clinician-entered VAS at a second timepoint draws the evolution chart.
  await proms.getByRole("button", { name: /Registrar PROM/ }).click();
  await proms.getByRole("button", { name: /^1 mês$/ }).click();
  await proms.getByPlaceholder("0–10").fill("2");
  const saved = page.waitForResponse((r) => /\/proms$/.test(r.url()) && r.request().method() === "POST");
  await proms.getByRole("button", { name: /^Salvar$/ }).click();
  expect((await saved).status()).toBe(201);
  await expect(proms.locator("svg.recharts-surface").first()).toBeVisible();
  await shot(page, APP, "16b-doctor-proms-chart");
});

test("functional tests entry on the knee case", async () => {
  await page.getByTestId("case-tab-functional").click();
  await page.getByTestId("performance-form-toggle").click();
  const form = page.getByTestId("performance-form");
  await form.getByRole("button", { name: /Sentar e levantar em 30 s/ }).click();
  await form.getByRole("button", { name: /Basal/ }).first().click();
  await page.getByTestId("performance-value").fill("12");
  const saved = page.waitForResponse((r) => /\/performance-tests$/.test(r.url()) && r.request().method() === "POST");
  await form.getByRole("button", { name: /Registrar teste funcional/ }).click();
  expect((await saved).status()).toBe(201);
  await expect(page.locator("[role=tabpanel][data-state=active]")).toContainText("12");
  expect(sql(DB.docregen, `SELECT measure || '=' || value::int FROM regen_performance_tests WHERE case_id = '${kneeCaseId}'`)).toBe("CHAIR_STAND_30S=12");
  await shot(page, APP, "17-functional-tests");
});

let condralCaseId: string;

test("condral focal (no region) applied to the knee: SANE Joelho offered and asked in the patient link", async ({ browser }) => {
  condralCaseId = await createRegenCase("Outras regiões", /Lesão Condral Focal/, isoToBr(isoToday(-10)), async () => {
    await page.getByRole("button", { name: /^PRP/ }).first().click();
    const structure = page.getByTestId("application-structure-0");
    await structure.selectOption({ label: "Intra-articular (tibiofemoral)" });
    await expect(structure).toHaveValue("JOELHO_TIBIOFEMORAL");
    await structure.scrollIntoViewIfNeeded();
    await shot(page, APP, "30-condral-application-site-knee");
  });
  expect(sql(DB.docregen, `SELECT condition_code FROM regen_cases WHERE id = '${condralCaseId}'`)).toBe("CONDRAL_FOCAL");
  expect(sql(DB.docregen, `SELECT product_details->>'locaisAplicacao' FROM regen_cases WHERE id = '${condralCaseId}'`)).toContain('"estruturaAnatomica":"JOELHO_TIBIOFEMORAL"');

  // Clinician side: the schedule lists VAS + SANE Joelho.
  const startSchedule = page.getByRole("button", { name: /Iniciar Cronograma/ });
  if (await startSchedule.waitFor({ timeout: 3_000 }).then(() => true, () => false)) await startSchedule.click();
  await expect(page.getByText("SANE Joelho").filter({ visible: true }).first()).toBeVisible();
  const copyLink = page.getByRole("button", { name: /^Copiar link$/ }).first();
  const prepared = page.waitForResponse((r) => /\/prepare-whatsapp$/.test(r.url()));
  await copyLink.click();
  const { link, message } = await (await prepared).json() as { link: string; message: string };
  expect(message).toContain("SANE Joelho");
  expect(sql(DB.docregen, `SELECT DISTINCT array_to_string(scales, '|') FROM regen_followup_notifications WHERE case_id = '${condralCaseId}'`)).toBe("VAS Dor|SANE Joelho");

  const patientContext = await browser.newContext();
  const patientPage = await patientContext.newPage();
  try {
    await patientPage.goto(new URL(link).pathname);
    await patientPage.locator("#cpf").fill(formatCpf(PATIENT.cpf));
    await patientPage.getByRole("button", { name: "Acessar questionários" }).click();
    const vas = patientPage.getByRole("slider").first();
    await expect(vas).toBeVisible();
    await vas.focus();
    await vas.press("Home");
    for (let i = 0; i < 5; i++) await vas.press("ArrowRight");
    await patientPage.getByRole("button", { name: /Próxima escala/ }).click();
    await expect(patientPage.getByText("Avaliação do joelho (SANE)").first()).toBeVisible();
    await expect(patientPage.getByText(/sendo 100 um joelho completamente normal/).first()).toBeVisible();
    const sane = patientPage.getByRole("slider").first();
    await sane.focus();
    await sane.press("Home");
    for (let i = 0; i < 6; i++) await sane.press("PageUp");
    await shot(patientPage, APP, "31-patient-sane-joelho-condral");
    await patientPage.getByRole("button", { name: /^Concluir$/ }).click();
    await expect(patientPage.getByText("Tudo concluído!")).toBeVisible();
  } catch (error) {
    await failShot(patientPage, APP, "patient-condral");
    throw error;
  } finally {
    await patientContext.close();
  }
  const stored = sql(DB.docregen, `SELECT r.nome_escala || '=' || r.score::int FROM regen_scale_responses r
    JOIN regen_followup_notifications n ON n.id = r.notification_id WHERE n.case_id = '${condralCaseId}' ORDER BY r.nome_escala`);
  expect(stored.split("\n")).toEqual(["SANE Joelho=60", "VAS Dor=5"]);

  // PROMs tab: the SANE Joelho is the one offered for this case.
  await page.reload();
  await page.getByTestId("case-tab-proms").click();
  const proms = page.locator("[role=tabpanel][data-state=active]");
  await expect(proms.getByTestId("sane-recommendation")).toContainText("SANE Joelho");
  await expect(proms).toContainText("Evolução · SANE-joelho60");
  await shot(page, APP, "32-condral-proms-sane-joelho");
});

let pulleyCaseId: string;

test("tendinopathy applied to the A1 pulley: grouped anatomical select, patient link asks SANE Punho e Mão", async ({ browser }) => {
  pulleyCaseId = await createRegenCase("Outras regiões", /^Tendinopatia$/, isoToBr(isoToday(-5)), async () => {
    await page.getByRole("button", { name: /^PRP/ }).first().click();
    const structure = page.getByTestId("application-structure-0");
    // Region headers (optgroups) in display order; legacy codes are not offered.
    expect(await structure.locator("optgroup").evaluateAll((groups) => groups.map((g) => (g as HTMLOptGroupElement).label))).toEqual([
      "Ombro", "Cotovelo", "Punho e Mão", "Quadril", "Joelho", "Tornozelo e Pé", "Coluna", "Pelve", "Outros",
    ]);
    await expect(structure.locator('optgroup[label="Punho e Mão"] option')).toHaveText([
      "Articulação radiocarpal", "1º compartimento extensor (De Quervain)", "Túnel do carpo",
      "Articulação trapeziometacarpiana (rizartrose)", "Polia A1 (dedo em gatilho)", "Articulações interfalângicas/metacarpofalângicas",
    ]);
    await expect(structure.locator('option[value="JOELHO"]')).toHaveCount(0);
    await structure.selectOption({ label: "Polia A1 (dedo em gatilho)" });
    await expect(structure).toHaveValue("MAO_POLIA_A1");
    // Screenshot of the grouped list: render the native select expanded inline.
    await structure.scrollIntoViewIfNeeded();
    await structure.evaluate((el) => { (el as HTMLSelectElement).size = 18; });
    const dir = path.join(SCREENSHOT_DIR, APP);
    fs.mkdirSync(dir, { recursive: true });
    await structure.screenshot({ path: path.join(dir, "33-anatomical-structure-grouped-select.png") });
    await shot(page, APP, "33b-anatomical-structure-grouped-select-page");
    await structure.evaluate((el) => { (el as HTMLSelectElement).size = 0; });
    // "Músculo"/"Outro" ask for free text; other structures do not.
    await expect(page.getByTestId("application-structure-detail-0")).toHaveCount(0);
  });
  expect(sql(DB.docregen, `SELECT condition_code FROM regen_cases WHERE id = '${pulleyCaseId}'`)).toBe("TENDINOPATIA");
  expect(sql(DB.docregen, `SELECT product_details->>'locaisAplicacao' FROM regen_cases WHERE id = '${pulleyCaseId}'`)).toContain('"estruturaAnatomica":"MAO_POLIA_A1"');
  await expect(page.getByText(/Polia A1 \(dedo em gatilho\)/).filter({ visible: true }).first()).toBeVisible();

  const startSchedule = page.getByRole("button", { name: /Iniciar Cronograma/ });
  if (await startSchedule.waitFor({ timeout: 3_000 }).then(() => true, () => false)) await startSchedule.click();
  await expect(page.getByText("SANE Punho e Mão").filter({ visible: true }).first()).toBeVisible();
  await expect(page.getByText("SANE Joelho")).toHaveCount(0);
  const copyLink = page.getByRole("button", { name: /^Copiar link$/ }).first();
  const prepared = page.waitForResponse((r) => /\/prepare-whatsapp$/.test(r.url()));
  await copyLink.click();
  const { link, message } = await (await prepared).json() as { link: string; message: string };
  expect(message).toContain("SANE Punho e Mão");
  expect(sql(DB.docregen, `SELECT DISTINCT array_to_string(scales, '|') FROM regen_followup_notifications WHERE case_id = '${pulleyCaseId}'`)).toBe("VAS Dor|SANE Punho e Mão");

  const patientContext = await browser.newContext();
  const patientPage = await patientContext.newPage();
  try {
    await patientPage.goto(new URL(link).pathname);
    await patientPage.locator("#cpf").fill(formatCpf(PATIENT.cpf));
    await patientPage.getByRole("button", { name: "Acessar questionários" }).click();
    const vas = patientPage.getByRole("slider").first();
    await expect(vas).toBeVisible();
    await vas.focus();
    await vas.press("Home");
    for (let i = 0; i < 4; i++) await vas.press("ArrowRight");
    await patientPage.getByRole("button", { name: /Próxima escala/ }).click();
    await expect(patientPage.getByText("Avaliação do punho e mão (SANE)").first()).toBeVisible();
    await expect(patientPage.getByText(/sendo 100 um punho\/uma mão completamente normal/).first()).toBeVisible();
    const sane = patientPage.getByRole("slider").first();
    await sane.focus();
    await sane.press("Home");
    for (let i = 0; i < 8; i++) await sane.press("PageUp");
    await shot(patientPage, APP, "34-patient-sane-punho-mao-polia-a1");
    await patientPage.getByRole("button", { name: /^Concluir$/ }).click();
    await expect(patientPage.getByText("Tudo concluído!")).toBeVisible();
  } catch (error) {
    await failShot(patientPage, APP, "patient-polia-a1");
    throw error;
  } finally {
    await patientContext.close();
  }
  const stored = sql(DB.docregen, `SELECT r.nome_escala FROM regen_scale_responses r
    JOIN regen_followup_notifications n ON n.id = r.notification_id WHERE n.case_id = '${pulleyCaseId}' ORDER BY r.nome_escala`);
  expect(stored.split("\n")).toEqual(["SANE Punho e Mão", "VAS Dor"]);
});

test("licensed scale names (KOOS) are rejected by the API", async () => {
  for (const instrument of ["KOOS", "WOMAC", "IKDC"]) {
    const response = await page.request.post(`/regen-api/regen/cases/${kneeCaseId}/proms`, {
      data: { instrument, timepoint: "1 mês", score: 50 },
      headers: { Origin: new URL(page.url()).origin },
    });
    expect(response.status(), instrument).toBe(400);
  }
  expect(sql(DB.docregen, `SELECT count(*) FROM regen_prom_responses WHERE instrument IN ('KOOS','WOMAC','IKDC')`)).toBe("0");
});

test("agenda: create and edit an appointment with DD/MM/AAAA date and HH:MM time", async () => {
  await page.goto("/docregen/agenda");
  await page.getByRole("button", { name: /Novo Agendamento/ }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("combobox").first().click();
  await page.getByRole("option", { name: new RegExp(PATIENT.nome, "i") }).click();
  const tomorrow = isoToday(1);
  await fillDate(page, dialog.locator("input[placeholder='DD/MM/AAAA']"), isoToBr(tomorrow));
  await fillDate(page, dialog.locator("input[placeholder='HH:MM']"), "09:30");
  const created = page.waitForResponse((r) => /\/appointments$/.test(r.url()) && r.request().method() === "POST");
  await dialog.getByRole("button", { name: /^Salvar$/ }).click();
  expect((await created).status()).toBeLessThan(300);
  await expect(page.getByText("09:30").first()).toBeVisible();
  await shot(page, APP, "18-agenda-created");

  await page.locator("button:has(svg.lucide-pencil)").first().click();
  await fillDate(page, dialog.locator("input[placeholder='HH:MM']"), "10:45");
  const updated = page.waitForResponse((r) => /\/appointments\/\d+$/.test(r.url()) && r.request().method() !== "GET");
  await dialog.getByRole("button", { name: /^Salvar$/ }).click();
  expect((await updated).status()).toBeLessThan(300);
  await expect(page.getByText("10:45").first()).toBeVisible();
  expect(sql(DB.docregen, `SELECT data::text || ' ' || hora FROM appointments WHERE patient_id = ${patientId}`)).toBe(`${tomorrow} 10:45`);
  await expectNoInvalidDate(page);
  await shot(page, APP, "19-agenda-edited");
});

test("dashboard counts", async () => {
  await page.goto("/docregen/dashboard");
  const kpi = (label: string) => page.locator("div.rounded-2xl", { has: page.getByText(label, { exact: true }) }).first();
  await expect(kpi("Casos regenerativos").locator("p.text-3xl")).toHaveText("4"); // knee, shoulder, condral focal, A1 pulley
  await expect(kpi("Consultas em 7 dias").locator("p.text-3xl")).toHaveText("1");
  await expectNoInvalidDate(page);
  await shot(page, APP, "20-dashboard");
});

test("follow-up central loads with the same calendar dates as the API", async () => {
  const overview = await page.request.get("/regen-api/regen/followup-overview");
  expect(overview.ok()).toBe(true);
  const body = await overview.json() as Record<string, Array<{ scheduled_date: string; patient_name: string }>>;
  const rows = Object.values(body).filter(Array.isArray).flat();
  expect(rows.length).toBeGreaterThan(0);
  await page.goto("/docregen/followup-central");
  await expect(page.getByText(new RegExp(PATIENT.nome, "i")).first()).toBeVisible();
  await expectNoInvalidDate(page);
  const text = await page.locator("body").innerText();
  const shown = rows.filter((r) => text.includes(isoToBr(String(r.scheduled_date).slice(0, 10))));
  expect(shown.length).toBeGreaterThan(0);
  await shot(page, APP, "21-followup-central");
});

test("reports page", async () => {
  await page.goto("/docregen/reports");
  await expect(page.getByRole("heading", { name: "Relatórios" }).filter({ visible: true })).toBeVisible();
  await expectNoInvalidDate(page);
  await shot(page, APP, "22-reports");
});

/** Minimal RFC 4180 parser (quoted cells may hold commas). */
function parseCsv(text: string): string[][] {
  return text.replace(/^\uFEFF/, "").trim().split(/\r?\n/).map((line) => {
    const cells: string[] = [];
    let cell = "";
    let quoted = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]!;
      if (quoted) {
        if (ch === '"' && line[i + 1] === '"') { cell += '"'; i++; }
        else if (ch === '"') quoted = false;
        else cell += ch;
      } else if (ch === '"') quoted = true;
      else if (ch === ",") { cells.push(cell); cell = ""; }
      else cell += ch;
    }
    cells.push(cell);
    return cells;
  });
}

async function downloadResearchCsv(): Promise<string> {
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: /Exportar CSV/ }).click();
  const download = await downloadPromise;
  return (await (await download.createReadStream()).toArray()).map(String).join("");
}

test("research export: pseudonymized CSV (no case UUID, no exact dates), k<5 warning", async () => {
  await page.goto("/docregen/regen/pesquisa");
  await page.getByRole("button", { name: /Buscar/ }).click();
  await expect(page.getByText(/Kellgren-Lawrence III/).filter({ visible: true }).first()).toBeVisible();
  // Four cases: every demographic group is below k=5 → warning banner.
  await expect(page.getByTestId("research-small-group-warning")).toBeVisible();
  await shot(page, APP, "23-research");
  const csv = await downloadResearchCsv();
  const [cols, ...rows] = parseCsv(csv);
  for (const column of ["pseudo_id", "age_band", "sex", "bmi_band", "condition", "anatomical_sites", "status", "procedure_count", "adverse_events", "avg_vas", "case_month"]) {
    expect(cols).toContain(column);
  }
  for (const removed of ["id", "age", "imc", "created_at"]) expect(cols).not.toContain(removed);
  expect(cols.join(",")).toMatch(/_baseline/);
  expect(rows).toHaveLength(4);
  // No case UUID, no exact date, no identity.
  for (const id of [kneeCaseId, condralCaseId, pulleyCaseId]) expect(csv).not.toContain(id);
  expect(csv).not.toMatch(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/);
  expect(csv).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  expect(csv).not.toContain(PATIENT.nome);
  expect(csv).not.toContain(PATIENT.cpf);
  // Every case was created from the registered patient: the age band is never empty.
  const ageBand = (() => {
    const [y, m, d] = PATIENT.nascimentoIso.split("-").map(Number) as [number, number, number];
    const [ty, tm, td] = isoToday(0).split("-").map(Number) as [number, number, number];
    const age = ty - y - (tm < m || (tm === m && td < d) ? 1 : 0);
    const low = Math.floor(age / 5) * 5;
    return `${low}-${low + 4}`;
  })();
  for (const row of rows) {
    expect(row[cols.indexOf("age_band")]).toBe(ageBand);
    expect(row[cols.indexOf("pseudo_id")]).toMatch(/^R-[0-9a-f]{8}$/);
    expect(row[cols.indexOf("case_month")]).toMatch(/^\d{4}-\d{2}$/);
    // k<5: the descriptive column is suppressed.
    expect(row[cols.indexOf("anatomical_sites")]).toBe("");
  }
  // The patient's own VAS (follow-up link) feeds avg_vas; the knee SANE the change columns.
  const knee = rows.find((c) => c[cols.indexOf("condition")] === "OA_JOELHO_KL3")!;
  expect(knee[cols.indexOf("avg_vas")]).toBe("2.5"); // patient 3 (link) + clinician 2
  expect(knee[cols.indexOf("sane_joelho_last")]).toBe("70");
  expect(knee[cols.indexOf("sane_region")]).toBe("sane_joelho");
  const condral = rows.find((c) => c[cols.indexOf("condition")] === "CONDRAL_FOCAL")!;
  expect(condral[cols.indexOf("sane_region")]).toBe("sane_joelho");
  expect(condral[cols.indexOf("sane_joelho_last")]).toBe("60");
  const pulley = rows.find((c) => c[cols.indexOf("condition")] === "TENDINOPATIA")!;
  expect(pulley[cols.indexOf("sane_region")]).toBe("sane_punho_mao");

  // With enough comparable cases (≥5 per group) the anatomical labels are exported.
  const doctorId = sql(DB.docregen, `SELECT id FROM doctors WHERE email = '${DOCREGEN_DOCTOR.email}'`);
  const clone = `INSERT INTO regen_cases (doctor_id, patient_name, patient_dob, patient_sex, weight_kg, height_cm, imc, condition_code, product_details, status, created_at)
    SELECT doctor_id, 'E2E CLONE', patient_dob, patient_sex, weight_kg, height_cm, imc, condition_code, product_details, status, created_at
      FROM regen_cases WHERE doctor_id = ${doctorId} AND patient_name <> 'E2E CLONE'`;
  for (let i = 0; i < 4; i++) sql(DB.docregen, clone);
  try {
    await page.getByRole("button", { name: /Buscar/ }).click();
    await expect(page.getByTestId("research-small-group-warning")).toHaveCount(0);
    const [cols2, ...rows2] = parseCsv(await downloadResearchCsv());
    const sites = rows2.map((row) => row[cols2.indexOf("anatomical_sites")]);
    expect(sites).toContain("Intra-articular (tibiofemoral)");
    expect(sites).toContain("Polia A1 (dedo em gatilho)");
    // Pseudonyms are unique within an export.
    expect(new Set(rows2.map((row) => row[cols2.indexOf("pseudo_id")])).size).toBe(rows2.length);
  } finally {
    sql(DB.docregen, `DELETE FROM regen_cases WHERE doctor_id = ${doctorId} AND patient_name = 'E2E CLONE'`);
  }
});

test("patient with clinical records: delete is refused and the dialog offers anonymization", async () => {
  await page.goto(`/docregen/patients/${patientId}`);
  await page.getByRole("button", { name: "Excluir" }).filter({ visible: true }).first().click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog.getByText(/Só é possível excluir um paciente sem nenhum registro clínico/)).toBeVisible();
  const refused = page.waitForResponse((r) => r.url().endsWith(`/regen-api/patients/${patientId}`) && r.request().method() === "DELETE");
  await dialog.getByRole("button", { name: "Excluir" }).click();
  expect((await refused).status()).toBe(409);
  await expect(dialog.getByText("Este paciente não pode ser excluído")).toBeVisible();
  await expect(dialog.getByText(/20 anos/)).toBeVisible();
  await dialog.getByRole("button", { name: "Anonimizar dados identificáveis" }).click();
  await expect(dialog.getByText("Anonimizar dados identificáveis do paciente?")).toBeVisible();
  await shot(page, APP, "24a-delete-blocked-anonymize");
  // Not confirmed here: the rest of the run still needs the identified patient.
  await dialog.getByRole("button", { name: "Cancelar" }).click();
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  expect(sql(DB.docregen, `SELECT nome FROM patients WHERE id = ${patientId}`)).toBe(PATIENT.nome.toLocaleUpperCase("pt-BR"));
});

test("secretary: created by the doctor, logs in, sees agenda/patients/regen/alerts, never another doctor's data", async ({ browser, playwright }) => {
  // Another doctor (fictional) with their own patient, created via the API.
  const origin = new URL(page.url()).origin;
  const other = await playwright.request.newContext({ baseURL: origin, extraHTTPHeaders: { Origin: origin } });
  const reg = await other.post("/regen-api/auth/register", {
    data: {
      nome: DOCREGEN_OTHER_DOCTOR.nome, email: DOCREGEN_OTHER_DOCTOR.email, senha: DOCREGEN_OTHER_DOCTOR.senha,
      crm: String(200000 + (Number.parseInt(RUN_ID, 36) % 799999)), crmEstado: "RJ",
      cpf: fakeCpf(Number.parseInt(RUN_ID, 36) % 1_000_000 + 29),
    },
  });
  expect(reg.status(), await reg.text()).toBeLessThan(300);
  sql(DB.docregen, `UPDATE doctors SET is_free = true, aprovado = true WHERE email = '${DOCREGEN_OTHER_DOCTOR.email}'`);
  const otherPatient = await other.post("/regen-api/patients", { data: { nome: `Paciente Outro Medico ${RUN_ID}` } });
  expect(otherPatient.status(), await otherPatient.text()).toBe(201);
  const otherPatientId = (await otherPatient.json() as { id: number }).id;
  await other.dispose();

  // Clinical free text on the patient record must never reach the front desk.
  sql(DB.docregen, `UPDATE patients SET anamnese = 'ANAMNESE E2E SIGILOSA', laudos = 'LAUDO E2E SIGILOSO' WHERE id = ${patientId}`);

  // The doctor creates the secretary in the profile page.
  const secretary = { nome: "Secretaria Ficticia", email: `secretaria.${RUN_ID}@docregen.e2e.test`, senha: "SenhaSec!2026" };
  await page.goto("/docregen/profile");
  await page.getByRole("button", { name: /^Nova$|Criar acesso/ }).first().click();
  await page.getByPlaceholder("Maria da Silva").fill(secretary.nome);
  await page.getByPlaceholder("maria@clinica.com.br").fill(secretary.email);
  await page.locator("input[type=password]").last().fill(secretary.senha);
  const created = page.waitForResponse((r) => r.url().endsWith("/regen-api/secretaries") && r.request().method() === "POST");
  await page.getByRole("button", { name: /^Salvar$/ }).last().click();
  expect((await created).status()).toBeLessThan(300);
  await expect(page.getByText(secretary.email).first()).toBeVisible();
  await shot(page, APP, "24-secretary-created");

  const secContext = await browser.newContext();
  const sec = await secContext.newPage();
  const secErrors = trackPageErrors(sec);
  try {
    await sec.goto("/docregen/secretary/login");
    await sec.locator("#email").fill(secretary.email);
    await sec.locator("#senha").fill(secretary.senha);
    await sec.getByRole("button", { name: /^Entrar$/ }).click();
    await sec.waitForURL(/secretary\/dashboard/);
    // Agenda: the doctor's appointment (tomorrow 10:45).
    await expect(sec.getByText("10:45").first()).toBeVisible();
    await shot(sec, APP, "25-secretary-agenda");
    await sec.getByRole("button", { name: /^Pacientes/ }).click();
    await expect(sec.getByText(new RegExp(PATIENT.nome, "i")).first()).toBeVisible();
    await expect(sec.getByText(/Paciente Outro Medico/i)).toHaveCount(0);
    // The front desk never sees the CPF.
    await expect(sec.getByText(formatCpf(PATIENT.cpf))).toHaveCount(0);
    await shot(sec, APP, "26-secretary-patients");
    await sec.getByRole("button", { name: /^Procedimentos/ }).click();
    await expect(sec.getByText(new RegExp(PATIENT.nome, "i")).first()).toBeVisible();
    // …nor the diagnosis of the regenerative cases.
    await expect(sec.getByText(/Kellgren-Lawrence/)).toHaveCount(0);
    await shot(sec, APP, "27-secretary-regen");
    await sec.getByRole("button", { name: /^Alertas/ }).click();
    await expectNoInvalidDate(sec);
    await shot(sec, APP, "28-secretary-alerts");

    // Direct API probes with the secretary session: other doctor's data is invisible.
    const probe = await sec.request.get(`/regen-api/patients/${otherPatientId}`);
    expect([401, 403, 404], `${probe.status()} ${await probe.text()}`).toContain(probe.status());
    const list = await sec.request.get("/regen-api/patients");
    const patients = await list.json() as Array<Record<string, unknown>>;
    const listText = JSON.stringify(patients);
    expect(listText).not.toContain("Outro Medico");
    // Secretary projection: no CPF, anamnesis, reports or health-plan card.
    expect(listText).not.toContain(PATIENT.cpf);
    expect(listText).not.toContain(formatCpf(PATIENT.cpf));
    expect(listText).not.toContain("ANAMNESE E2E SIGILOSA");
    expect(listText).not.toContain("LAUDO E2E SIGILOSO");
    for (const field of ["cpf", "anamnese", "laudos", "numeroCarteirinha", "endereco", "cep"]) {
      expect(patients.every((p) => !(field in p)), field).toBe(true);
    }
    const cases = await sec.request.get("/regen-api/secretary/regen-cases");
    expect(cases.ok()).toBe(true);
    const casesBody = JSON.stringify(await cases.json());
    expect(casesBody).toContain(kneeCaseId);
    expect(casesBody).not.toContain("OA_JOELHO_KL3");
    // Secretary cannot use doctor-only research export.
    const research = await sec.request.get("/regen-api/regen/research");
    expect(research.status()).toBeGreaterThanOrEqual(400);
    expect(secErrors.filter((e) => e.startsWith("pageerror"))).toEqual([]);
  } catch (error) {
    await failShot(sec, APP, "secretary");
    throw error;
  } finally {
    await secContext.close();
  }
});

test("logout", async () => {
  await page.goto("/docregen/dashboard");
  await page.getByRole("button", { name: /^Sair$/ }).filter({ visible: true }).first().click();
  await page.waitForURL(/\/docregen\/(login)?$/);
  await page.goto("/docregen/dashboard");
  await page.waitForURL(/\/docregen\/login/);
  const me = await page.request.get("/regen-api/auth/me");
  expect(me.status()).toBe(204); // session probe: no session
  expect((await page.request.get("/regen-api/patients")).status()).toBe(401);
  await shot(page, APP, "29-logged-out");
});
