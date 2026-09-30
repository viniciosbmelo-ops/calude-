/**
 * DocKnee (DocSholder) end-to-end: one surgeon's journey, in order.
 * Fictional data only; runs against the disposable stack from global-setup.ts.
 */
import { test, expect, type Page, type BrowserContext } from "@playwright/test";
import { DB, DOCKNEE_DOCTOR, RUN_ID } from "../support/env";
import {
  FICTIONAL_PNG, answerPreConsult, expectNoInvalidDate, failShot, fakeCpf, fillDate, formatCpf, isoToBr, isoToday,
  pdfText, shot, sql, trackPageErrors,
} from "../support/helpers";

const APP = "docknee";
const seed = Number.parseInt(RUN_ID, 36) % 1_000_000;
const PATIENT = {
  nome: `Paciente Ficticio Ombro ${RUN_ID}`,
  cpf: fakeCpf(seed + 101),
  nascimento: "22/11/1975",
  nascimentoIso: "1975-11-22",
};

test.describe.configure({ mode: "serial" });

let context: BrowserContext;
let page: Page;
let patientId: number;
let preConsultLink: string;

test.beforeAll(async ({ browser, playwright }) => {
  // The doctor account is seeded through the public register API; the
  // approval/subscription gate is bypassed with SQL (fictional data only).
  const origin = new URL(test.info().project.use.baseURL!).origin;
  const api = await playwright.request.newContext({ baseURL: origin, extraHTTPHeaders: { Origin: origin } });
  const reg = await api.post("/api/auth/register", {
    data: {
      nome: DOCKNEE_DOCTOR.nome, email: DOCKNEE_DOCTOR.email, senha: DOCKNEE_DOCTOR.senha,
      crm: String(400000 + (seed % 499999)), crmEstado: "SP", cpf: fakeCpf(seed + 7),
    },
  });
  expect(reg.status(), await reg.text()).toBeLessThan(300);
  await api.dispose();
  sql(DB.docknee, `UPDATE doctors SET is_free = true, aprovado = true WHERE email = '${DOCKNEE_DOCTOR.email}'`);
  context = await browser.newContext();
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  page = await context.newPage();
  trackPageErrors(page);
});

test.afterAll(async () => {
  await context.close();
});

test("login", async () => {
  await page.goto("/login");
  await page.locator("#identificador").fill(DOCKNEE_DOCTOR.email);
  await page.locator("#password").fill(DOCKNEE_DOCTOR.senha);
  await shot(page, APP, "01-login");
  await page.getByRole("button", { name: /^Entrar$/ }).click();
  await page.waitForURL(/\/dashboard/);
  await expectNoInvalidDate(page);
  await shot(page, APP, "02-dashboard");
});

test("create patient with DD/MM/AAAA birth date and send pré-consulta", async () => {
  await page.goto("/patients/new");
  await expect(page.locator("#dataNascimento")).toHaveAttribute("placeholder", "DD/MM/AAAA");
  await page.locator("#nome").fill(PATIENT.nome);
  await page.locator("#cpf").fill(PATIENT.cpf);
  await fillDate(page, "#dataNascimento", PATIENT.nascimento);
  await expect(page.locator("#dataNascimento")).toHaveValue(PATIENT.nascimento);
  await page.locator("#telefone").fill("(11) 90000-0001");
  await shot(page, APP, "03-new-patient");
  const created = page.waitForResponse((r) => r.url().endsWith("/api/patients") && r.request().method() === "POST");
  await page.getByRole("button", { name: "Salvar Paciente" }).click();
  patientId = (await (await created).json() as { id: number }).id;
  expect(sql(DB.docknee, `SELECT data_nascimento FROM patients WHERE id = ${patientId}`)).toBe(PATIENT.nascimentoIso);

  const invite = page.waitForResponse((r) => /\/pre-consult\/invite$/.test(r.url()) && r.request().method() === "POST");
  await page.getByRole("button", { name: "Encaminhar pré-consulta" }).click();
  preConsultLink = (await (await invite).json() as { link: string }).link;
  expect(new URL(preConsultLink).pathname).toMatch(/^\/pre-consulta\//);
  await shot(page, APP, "04-pre-consult-invite");
});

test("patient answers the pré-consulta with an exam upload; doctor sees answers and exam", async ({ browser }) => {
  const patientContext = await browser.newContext();
  const patientPage = await patientContext.newPage();
  try {
    await answerPreConsult(patientPage, preConsultLink, PATIENT.cpf, APP);
  } catch (error) {
    await failShot(patientPage, APP, "patient-pre-consult");
    throw error;
  } finally {
    await patientContext.close();
  }
  await page.goto(`/patients/${patientId}`);
  await page.getByRole("button", { name: /^Pré-consulta$/ }).or(page.getByRole("tab", { name: /^Pré-consulta$/ })).first().click();
  await expect(page.locator("textarea").first()).toHaveValue("Resposta ficticia etapa 1");
  const attachment = page.locator("a", { hasText: "exame-ficticio.png" });
  await expect(attachment).toBeVisible();
  const download = await page.request.get((await attachment.getAttribute("href"))!);
  expect(download.status()).toBe(200);
  expect(Buffer.compare(await download.body(), FICTIONAL_PNG)).toBe(0);
  await shot(page, APP, "08-doctor-pre-consult-tab");
});

let cuffSurgeryId: number;
let instabilitySurgeryId: number;
const SURGERY_ISO = isoToday(-60);

/** Fills every field the clinical validator reports as missing, with its first option / a minimal value. */
async function fillMissingClinicalFields(): Promise<void> {
  const fields = page.locator("[data-field]").filter({ has: page.getByText("Obrigatório com as escolhas atuais.", { exact: true }) });
  for (let guard = 0; guard < 30 && await fields.count() > 0; guard++) {
    const field = fields.first();
    const option = field.locator("button[aria-pressed]").first();
    if (await option.count()) { await option.click(); continue; }
    const input = field.locator("input, textarea").first();
    if (await input.count()) { await input.fill("1"); continue; }
    await field.getByText("+ Adicionar").click();
  }
  const objects = page.locator("details.border-destructive");
  for (let i = 0; i < await objects.count(); i++) {
    const details = objects.nth(i);
    await details.evaluate((el) => { (el as HTMLDetailsElement).open = true; });
    const option = details.locator("button[aria-pressed]").first();
    if (await option.count()) await option.click();
  }
}

async function registerSurgery(diagnosis: string, caseType: RegExp, name: string): Promise<number> {
  await page.goto(`/surgeries/new?patientId=${patientId}`);
  await expect(page.locator("#sx-date")).toHaveAttribute("placeholder", "DD/MM/AAAA");
  await fillDate(page, "#sx-date", isoToBr(SURGERY_ISO));
  if (!(await page.locator("#sx-patient").innerText()).toUpperCase().includes(PATIENT.nome.toUpperCase())) {
    await page.locator("#sx-patient").click();
    await page.getByRole("option", { name: new RegExp(PATIENT.nome, "i") }).click();
  }
  await page.locator("#sx-side").click();
  await page.getByRole("option", { name: "Direito" }).click();
  await page.getByRole("button", { name: /^Ombro$/ }).click();
  await page.getByRole("button", { name: diagnosis, exact: true }).click();
  await shot(page, APP, `09-surgery-${name}-basics`);
  await page.getByRole("button", { name: /^Próximo/ }).click();
  await page.locator("button[aria-pressed]").filter({ hasText: caseType }).first().click();
  await page.getByRole("button", { name: /^Próximo/ }).click();
  for (let attempt = 0; attempt < 6; attempt++) {
    await page.getByRole("button", { name: /^Próximo/ }).click();
    const saved = page.waitForResponse((r) => /\/api\/surgeries(\/\d+)?$/.test(r.url()) && ["POST", "PUT", "PATCH"].includes(r.request().method()));
    await page.getByRole("button", { name: /Finalizar Registro/ }).click();
    const response = await saved;
    if (response.status() < 300) break;
    expect(response.status(), await response.text()).toBe(422);
    await fillMissingClinicalFields();
  }
  await page.waitForURL(/\/surgeries\/\d+$/);
  return Number(page.url().split("/").at(-1));
}

test("register a rotator-cuff surgery (60 days ago) and check the follow-up schedule dates", async () => {
  cuffSurgeryId = await registerSurgery("Rotura completa do manguito rotador", /manguito/i, "cuff");
  expect(sql(DB.docknee, `SELECT data_cirurgia::text FROM surgeries WHERE id = ${cuffSurgeryId}`)).toBe(SURGERY_ISO);
  await expect(page.getByText(isoToBr(SURGERY_ISO)).first()).toBeVisible();
  // Registering the surgery schedules the follow-ups; "Gerar Agendamento" is only a fallback.
  const scheduled = await page.getByText(/Previsto para/).first().waitFor({ timeout: 10_000 }).then(() => true, () => false);
  if (!scheduled) await page.getByRole("button", { name: /Gerar Agendamento/ }).click();
  // Pré-op on the surgery day, then +42 / +90 / +180 / +365 days, as calendar dates.
  for (const days of [0, 42, 90, 180, 365]) {
    const due = new Date(`${SURGERY_ISO}T12:00:00Z`);
    due.setUTCDate(due.getUTCDate() + days);
    const iso = due.toISOString().slice(0, 10);
    expect(sql(DB.docknee, `SELECT count(*) FROM scheduled_notifications WHERE surgery_id = ${cuffSurgeryId} AND scheduled_date::date = '${iso}'`), `+${days}d`).toBe("1");
    await expect(page.getByText(`Previsto para ${isoToBr(iso)}`).first(), `+${days}d`).toBeVisible();
  }
  await expectNoInvalidDate(page);
  await shot(page, APP, "10-surgery-schedule");
});

test("patient follow-up link (6 weeks): VAS + SANE answered by the patient, doctor sees them", async ({ browser }) => {
  await context.route("https://wa.me/**", (route) => route.abort());
  const row = page.locator("div.rounded-lg.border", { hasText: "6 semanas" }).filter({ has: page.getByRole("button", { name: "Abrir no WhatsApp" }) }).first();
  const prepared = page.waitForResponse((r) => /\/schedule\/\d+\/prepare-whatsapp$/.test(r.url()));
  await row.getByRole("button", { name: "Abrir no WhatsApp" }).click();
  const body = await (await prepared).json() as { link?: string; message?: string };
  const link = body.link ?? body.message?.match(/https?:\/\/\S+/)?.[0];
  expect(link).toMatch(/\/patient\//);

  const patientContext = await browser.newContext();
  const patientPage = await patientContext.newPage();
  try {
    await patientPage.goto(new URL(link!).pathname);
    await patientPage.locator("#cpf").fill(formatCpf(PATIENT.cpf));
    await patientPage.getByRole("button", { name: "Acessar questionários" }).click();
    const vas = patientPage.getByRole("slider").first();
    await expect(vas).toBeVisible();
    await vas.focus();
    await vas.press("Home");
    for (let i = 0; i < 4; i++) await vas.press("ArrowRight");
    await shot(patientPage, APP, "11-patient-vas");
    await patientPage.getByRole("button", { name: /^Próximo$/ }).click();
    const sane = patientPage.getByRole("slider").first();
    await expect(patientPage.getByText(/SANE|normal/i).first()).toBeVisible();
    await sane.focus();
    await sane.press("Home");
    for (let i = 0; i < 8; i++) await sane.press("PageUp");
    await shot(patientPage, APP, "12-patient-sane");
    await patientPage.getByRole("button", { name: /Concluir|Finalizar/ }).click();
    await expect(patientPage.getByText(/concluíd|obrigad/i).first()).toBeVisible();
  } catch (error) {
    await failShot(patientPage, APP, "patient-followup");
    throw error;
  } finally {
    await patientContext.close();
  }

  await page.reload();
  await expect(page.getByText("Dor (VAS 0–10): 4").first()).toBeVisible();
  await expect(page.getByText("SANE (paciente): 80%").first()).toBeVisible();
  // The schedule row of the answered follow-up is "Respondido", no longer "Aguardando resposta".
  const answeredRow = page.locator("div.rounded-lg.border", { hasText: "6 semanas" }).first();
  await expect(answeredRow).toContainText("Respondido");
  await expect(answeredRow).not.toContainText("Aguardando resposta");
  await shot(page, APP, "13-surgery-patient-answers");
});

/** Opens "Registrar avaliação", fills the clinician scale with minimal valid values and saves. */
async function registerClinicianEvaluation(scale: "CONSTANT" | "ROWE", periodo: string): Promise<void> {
  await page.getByRole("button", { name: "Registrar avaliação" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.locator("#fu-tempo").fill(periodo);
  await expect(dialog.locator("#fu-data")).toHaveAttribute("placeholder", "DD/MM/AAAA");
  await fillDate(page, dialog.locator("#fu-data"), isoToBr(isoToday()));
  await dialog.locator("#fu-vas").fill("2");
  await dialog.getByText("Escalas do médico").click();
  const fieldset = dialog.locator(`fieldset[data-scale=${scale}]`);
  await expect(fieldset).toBeVisible();
  for (const input of await fieldset.locator("input[inputmode]").all()) {
    const label = await fieldset.locator(`label[for="${await input.getAttribute("id")}"]`).innerText();
    const max = Number(label.match(/[–-]\s*(\d+)/)?.[1] ?? "1");
    await input.fill(String(Math.max(0, Math.floor(max / 2))));
  }
  for (const trigger of await fieldset.locator("button[role=combobox]").all()) {
    await trigger.click();
    await page.getByRole("option").first().click();
  }
  await expect(fieldset).not.toContainText("incompleta");
  await shot(page, APP, `14-clinician-${scale.toLowerCase()}`);
  const saved = page.waitForResponse((r) => /\/followups?$/.test(r.url()) && r.request().method() === "POST");
  await dialog.getByRole("button", { name: /^Salvar$/ }).click();
  expect((await saved).status()).toBeLessThan(300);
}

test("clinician Constant entry on the cuff surgery", async () => {
  await registerClinicianEvaluation("CONSTANT", "3 meses");
  await expect(page.getByText(/Constant-Murley: \d+\/(75|100)/).first()).toBeVisible();
  expect(sql(DB.docknee, `SELECT count(*) FROM scale_responses s JOIN followup f ON f.id = s.followup_id
    WHERE f.surgery_id = ${cuffSurgeryId} AND upper(s.nome_escala) LIKE 'CONSTANT%'`)).toBe("1");
  await shot(page, APP, "15-constant-saved");
});

test("clinician Rowe entry on an instability surgery", async () => {
  instabilitySurgeryId = await registerSurgery("Instabilidade glenoumeral anterior", /instabilidade/i, "instability");
  await registerClinicianEvaluation("ROWE", "6 meses");
  await expect(page.getByText(/Rowe: \d+\/100/).first()).toBeVisible();
  await shot(page, APP, "16-rowe-saved");
});

let regenCaseId: string;

test("regenerative case: terms, creation, procedures and PROMs tabs", async () => {
  await page.goto("/regen");
  const terms = page.getByRole("button", { name: "Li e concordo com os Termos e DPA" });
  if (await terms.waitFor({ timeout: 5_000 }).then(() => true, () => false)) await terms.click();
  await page.goto("/regen/caso/novo");
  await page.getByPlaceholder("Buscar paciente cadastrado...").fill(PATIENT.nome.slice(0, 20));
  await page.getByRole("button", { name: new RegExp(PATIENT.nome, "i") }).first().click();
  await fillDate(page, page.locator("input[placeholder='DD/MM/AAAA']").first(), isoToBr(isoToday(-20)));
  await page.getByRole("button", { name: /^Ombro/ }).click();
  await page.getByRole("button", { name: /Tendinopatia do Manguito Rotador/ }).click();
  for (let step = 0; step < 5; step++) await page.getByRole("button", { name: /^Próximo/ }).click();
  await page.getByRole("button", { name: /Salvar Caso/ }).click();
  await page.waitForURL(/\/regen\/caso\/[0-9a-f-]+$/);
  regenCaseId = page.url().split("/").at(-1)!;
  await shot(page, APP, "17-regen-case");

  await page.getByTestId("case-tab-procedures").click();
  await page.getByRole("button", { name: /Registrar procedimento/ }).click();
  const panel = page.locator("[role=tabpanel][data-state=active]");
  await fillDate(page, panel.locator("input[placeholder='DD/MM/AAAA']").first(), isoToBr(isoToday(-10)));
  await page.getByRole("button", { name: /^PRP — Plasma Rico em Plaquetas/ }).click();
  const proc = page.waitForResponse((r) => /\/procedures$/.test(r.url()) && r.request().method() === "POST");
  await panel.getByRole("button", { name: /^Salvar$/ }).click();
  expect((await proc).status()).toBeLessThan(300);
  await expect(page.getByTestId("case-tab-procedures")).toContainText("(1)");
  await expect(panel).toContainText(isoToBr(isoToday(-10)));
  await shot(page, APP, "18-regen-procedures");

  await page.getByTestId("case-tab-proms").click();
  const proms = page.locator("[role=tabpanel][data-state=active]");
  await proms.getByRole("button", { name: /Registrar PROM/ }).click();
  await proms.getByRole("button", { name: /Basal/ }).first().click();
  await proms.getByPlaceholder("0–10").fill("6");
  const prom = page.waitForResponse((r) => /\/proms$/.test(r.url()) && r.request().method() === "POST");
  await proms.getByRole("button", { name: /^Salvar$/ }).click();
  expect((await prom).status()).toBe(201);
  await expect(proms).toContainText("6");
  await expectNoInvalidDate(page);
  await shot(page, APP, "19-regen-proms");

  // Start the regenerative follow-up schedule (feeds the follow-up central).
  await page.getByTestId("case-tab-overview").click();
  const start = page.getByRole("button", { name: /Iniciar Cronograma/ });
  if (await start.waitFor({ timeout: 5_000 }).then(() => true, () => false)) {
    const init = page.waitForResponse((r) => /\/notifications\/init$/.test(r.url()));
    await start.click();
    expect((await init).status()).toBeLessThan(300);
  }
  await expect(page.getByRole("button", { name: /^Copiar link$/ }).first()).toBeVisible();
});

test("follow-up central: surgical tab shows overdue follow-ups, regenerative tab loads", async () => {
  await page.goto("/followup-central");
  await expect(page.getByText(new RegExp(PATIENT.nome, "i")).first()).toBeVisible();
  await expect(page.getByText("Atrasado").first()).toBeVisible();
  await expectNoInvalidDate(page);
  // Surgery 60 days ago: the pre-op (day 0) of both surgeries is overdue; dates as calendar days.
  await expect(page.getByText(isoToBr(SURGERY_ISO)).first()).toBeVisible();
  await shot(page, APP, "20-followup-central-surgical");
  await page.getByRole("button", { name: "🌿 Regenerativa" }).click();
  await expectNoInvalidDate(page);
  await expect(page.getByText(new RegExp(PATIENT.nome, "i")).first()).toBeVisible();
  await shot(page, APP, "21-followup-central-regen");
});

test("agenda: create and edit an appointment (DD/MM/AAAA + HH:MM)", async () => {
  await page.goto("/agenda");
  await page.getByRole("button", { name: /Novo Agendamento/ }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("combobox").first().click();
  await page.getByRole("option", { name: new RegExp(PATIENT.nome, "i") }).click();
  const date = isoToday(3);
  await fillDate(page, dialog.locator("input[placeholder='DD/MM/AAAA']"), isoToBr(date));
  await fillDate(page, dialog.locator("input[placeholder='HH:MM']"), "08:15");
  const created = page.waitForResponse((r) => /\/appointments$/.test(r.url()) && r.request().method() === "POST");
  await dialog.getByRole("button", { name: /^Salvar$/ }).click();
  expect((await created).status()).toBeLessThan(300);
  await expect(page.getByText("08:15").first()).toBeVisible();
  await page.locator("button:has(svg.lucide-pencil)").first().click();
  await fillDate(page, dialog.locator("input[placeholder='HH:MM']"), "16:40");
  const updated = page.waitForResponse((r) => /\/appointments\/\d+$/.test(r.url()) && r.request().method() !== "GET");
  await dialog.getByRole("button", { name: /^Salvar$/ }).click();
  expect((await updated).status()).toBeLessThan(300);
  expect(sql(DB.docknee, `SELECT data::text || ' ' || hora FROM appointments WHERE patient_id = ${patientId}`)).toBe(`${date} 16:40`);
  await expectNoInvalidDate(page);
  await shot(page, APP, "22-agenda");
});

test("reports page", async () => {
  await page.goto("/reports");
  await expect(page.getByRole("heading", { name: "Relatórios" }).filter({ visible: true })).toBeVisible();
  await expectNoInvalidDate(page);
  await shot(page, APP, "23-reports");
});

test("documents: atestado and receita PDFs carry the São Paulo issue date, even late at night", async ({ browser }) => {
  // 23:30 in São Paulo is already the next day in UTC: the issue date must stay today's local date.
  const today = isoToday();
  const lateNight = new Date(`${today}T23:30:00-03:00`);
  const docContext = await browser.newContext({ storageState: await context.storageState() });
  const docPage = await docContext.newPage();
  await docPage.clock.setFixedTime(lateNight);
  try {
    await docPage.goto(`/patients/${patientId}`);
    for (const [tab, type, content] of [
      ["Atestados", "Atestado", "Atesto, para os devidos fins, que o paciente ficticio esteve em consulta."],
      ["Receitas", "Receita", "Dipirona 500 mg, 1 comprimido a cada 6 horas se dor (prescricao ficticia)."],
    ] as const) {
      await docPage.getByRole("button", { name: new RegExp(`^${tab}`) }).filter({ visible: true }).first().click();
      await docPage.getByRole("button", { name: `Nova ${type}` }).click();
      await docPage.locator("input[type=text]").filter({ visible: true }).last().fill(`${type} ficticio E2E`);
      await docPage.locator("textarea").filter({ visible: true }).last().fill(content);
      await docPage.getByRole("button", { name: /^Salvar$/ }).filter({ visible: true }).last().click();
      await expect(docPage.getByText(`${type} ficticio E2E`).first()).toBeVisible();
      const downloadPromise = docPage.waitForEvent("download");
      await docPage.getByRole("button", { name: /^PDF$/ }).first().click();
      const download = await downloadPromise;
      const [y, m, d] = today.split("-");
      expect(download.suggestedFilename()).toContain(`${d}-${m}-${y}`);
      const pdfBytes = Buffer.concat(await (await download.createReadStream()).toArray());
      expect(pdfBytes.subarray(0, 4).toString()).toBe("%PDF");
      const pdf = pdfText(pdfBytes);
      if (process.env["E2E_DEBUG"]) console.log(pdf.slice(0, 2000));
      const monthNames = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
      expect(pdf.toUpperCase()).toContain(`DATA ${Number(d)} DE ${monthNames[Number(m) - 1]} DE ${y}`.toUpperCase());
      expect(pdf.toUpperCase()).toContain("22 DE NOVEMBRO DE 1975");
      expect(pdf).toContain(content);
      await shot(docPage, APP, `24-document-${type.toLowerCase()}`);
    }
  } catch (error) {
    await failShot(docPage, APP, "documents");
    throw error;
  } finally {
    await docContext.close();
  }
});

test("secretary portal: created by the surgeon, sees agenda/surgeries/patients/follow-ups, not another doctor's data", async ({ browser, playwright }) => {
  const origin = new URL(page.url()).origin;
  const other = await playwright.request.newContext({ baseURL: origin, extraHTTPHeaders: { Origin: origin } });
  const otherEmail = `outro.${RUN_ID}@docknee.e2e.test`;
  const reg = await other.post("/api/auth/register", {
    data: { nome: "Dr. Outro Ombro", email: otherEmail, senha: "SenhaE2E!2026", crm: String(500000 + (seed % 399999)), crmEstado: "RS", cpf: fakeCpf(seed + 55) },
  });
  expect(reg.status(), await reg.text()).toBeLessThan(300);
  sql(DB.docknee, `UPDATE doctors SET is_free = true, aprovado = true WHERE email = '${otherEmail}'`);
  const otherPatient = await other.post("/api/patients", { data: { nome: `Paciente Outro Cirurgiao ${RUN_ID}` } });
  expect(otherPatient.status(), await otherPatient.text()).toBe(201);
  const otherPatientId = (await otherPatient.json() as { id: number }).id;
  await other.dispose();

  const secretary = { nome: "Secretaria Ombro Ficticia", email: `secretaria.${RUN_ID}@docknee.e2e.test`, senha: "SenhaSec!2026" };
  await page.goto("/profile");
  await page.getByRole("button", { name: /^Nova$|Criar acesso/ }).first().click();
  await page.getByPlaceholder("Maria da Silva").fill(secretary.nome);
  await page.getByPlaceholder("maria@clinica.com.br").fill(secretary.email);
  await page.locator("input[type=password]").last().fill(secretary.senha);
  const created = page.waitForResponse((r) => r.url().endsWith("/api/secretaries") && r.request().method() === "POST");
  await page.getByRole("button", { name: /^Salvar$/ }).last().click();
  expect((await created).status()).toBeLessThan(300);

  const secContext = await browser.newContext();
  const sec = await secContext.newPage();
  const secErrors = trackPageErrors(sec);
  try {
    await sec.goto("/secretary/login");
    await sec.locator("#email").fill(secretary.email);
    await sec.locator("#senha").fill(secretary.senha);
    await sec.getByRole("button", { name: /^Entrar$/ }).click();
    await sec.waitForURL(/secretary\/dashboard/);
    await expect(sec.getByText("16:40").first()).toBeVisible();
    await shot(sec, APP, "25-secretary-agenda");
    await sec.getByRole("button", { name: /^Cirurgias/ }).click();
    await expectNoInvalidDate(sec);
    await shot(sec, APP, "26-secretary-surgeries");
    await sec.getByRole("button", { name: /^Pacientes/ }).click();
    await expect(sec.getByText(new RegExp(PATIENT.nome, "i")).first()).toBeVisible();
    await expect(sec.getByText(/Paciente Outro Cirurgiao/i)).toHaveCount(0);
    await sec.getByRole("button", { name: /^Follow-ups/ }).click();
    await expectNoInvalidDate(sec);
    await shot(sec, APP, "27-secretary-followups");
    const probe = await sec.request.get(`/api/patients/${otherPatientId}`);
    expect([401, 403, 404], `${probe.status()}`).toContain(probe.status());
    expect(JSON.stringify(await (await sec.request.get("/api/patients")).json())).not.toContain("Outro Cirurgiao");
    expect(secErrors.filter((e) => e.startsWith("pageerror"))).toEqual([]);
  } catch (error) {
    await failShot(sec, APP, "secretary");
    throw error;
  } finally {
    await secContext.close();
  }
});

test("physiotherapy portal is gone: API routes answer 404 and the UI has no physio pages", async () => {
  const origin = new URL(page.url()).origin;
  const headers = { Origin: origin };
  const probes: Array<[string, string]> = [
    ["POST", "/api/physio-auth/login"],
    ["GET", "/api/physio-auth/me"],
    ["GET", "/api/physio/patients"],
    ["GET", "/api/admin/physiotherapists"],
    ["GET", "/api/care-links"],
    ["POST", `/api/patients/${patientId}/rehab-invite`],
    ["GET", `/api/patients/${patientId}/rehab`],
  ];
  for (const [method, path] of probes) {
    const response = await page.request.fetch(path, { method, headers, data: method === "POST" ? {} : undefined });
    expect(response.status(), `${method} ${path}`).toBe(404);
  }
  for (const path of ["/fisio", "/fisio/login", "/fisio/dashboard"]) {
    await page.goto(path);
    await expect(page.getByText("404 — Página não encontrada")).toBeVisible();
  }
  await shot(page, APP, "28-physio-404");
  await page.goto(`/patients/${patientId}`);
  await expect(page.locator("body")).not.toContainText(/Encaminhar (para )?fisioterap|Painel de fisioterapia|Portal do fisioterapeuta/i);
  await page.goto("/login");
  await expect(page.locator("body")).not.toContainText(/fisioterapeuta/i);
});

test("logout", async () => {
  await page.goto("/dashboard");
  await page.getByRole("button", { name: /^Sair$/ }).filter({ visible: true }).first().click();
  await page.waitForURL(/\/(login)?$/);
  await page.goto("/dashboard");
  await page.waitForURL(/\/login/);
  expect((await page.request.get("/api/patients")).status()).toBe(401);
  await shot(page, APP, "29-logged-out");
});
