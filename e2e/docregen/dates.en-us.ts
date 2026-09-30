/**
 * Same DD/MM/AAAA date contract with an English (en-US) browser: a native
 * <input type="date"> would switch to mm/dd/yyyy; the app's DateInput must not.
 */
import { test, expect } from "@playwright/test";
import { DB, RUN_ID } from "../support/env";
import { expectNoInvalidDate, fakeCpf, fillDate, isoToBr, isoToday, shot, sql } from "../support/helpers";

test("en-US browser: birth date and agenda date stay DD/MM/AAAA and are stored correctly", async ({ page, playwright }) => {
  expect(await page.evaluate(() => navigator.language)).toBe("en-US");
  const email = `enus.${RUN_ID}@docregen.e2e.test`;
  const senha = "SenhaE2E!2026";
  const origin = new URL(test.info().project.use.baseURL!).origin;
  const api = await playwright.request.newContext({ baseURL: origin, extraHTTPHeaders: { Origin: origin } });
  const reg = await api.post("/regen-api/auth/register", {
    data: { nome: "Dr. En Us Ficticio", email, senha, crm: String(300000 + (Number.parseInt(RUN_ID, 36) % 599999)), crmEstado: "MG", cpf: fakeCpf(Number.parseInt(RUN_ID, 36) % 1_000_000 + 41) },
  });
  expect(reg.status(), await reg.text()).toBeLessThan(300);
  await api.dispose();
  sql(DB.docregen, `UPDATE doctors SET is_free = true, aprovado = true WHERE email = '${email}'`);

  await page.goto("/docregen/login");
  await page.locator("#identificador").fill(email);
  await page.locator("#password").fill(senha);
  await page.getByRole("button", { name: /^Entrar$/ }).click();
  await page.waitForURL(/\/docregen\/(dashboard|regen)/);

  await page.goto("/docregen/patients/new");
  await expect(page.locator("#dataNascimento")).toHaveAttribute("placeholder", "DD/MM/AAAA");
  await page.locator("#nome").fill(`Paciente En Us ${RUN_ID}`);
  // 03/04/1970 is 3 April in pt-BR; an en-US parser would read 4 March.
  await fillDate(page, "#dataNascimento", "03/04/1970");
  await expect(page.locator("#dataNascimento")).toHaveValue("03/04/1970");
  const created = page.waitForResponse((r) => r.url().endsWith("/regen-api/patients") && r.request().method() === "POST");
  await page.getByRole("button", { name: "Salvar Paciente" }).click();
  const { id } = await (await created).json() as { id: number };
  expect(sql(DB.docregen, `SELECT data_nascimento FROM patients WHERE id = ${id}`)).toBe("1970-04-03");
  await page.goto(`/docregen/patients/${id}`);
  await expect(page.getByText("03/04/1970").filter({ visible: true }).first()).toBeVisible();
  await expectNoInvalidDate(page);
  await shot(page, "docregen-en-US", "01-patient-birth-date");

  await page.goto("/docregen/agenda");
  await page.getByRole("button", { name: /Novo Agendamento/ }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("combobox").first().click();
  await page.getByRole("option", { name: /Paciente En Us/i }).click();
  const date = isoToday(2);
  await fillDate(page, dialog.locator("input[placeholder='DD/MM/AAAA']"), isoToBr(date));
  await fillDate(page, dialog.locator("input[placeholder='HH:MM']"), "14:05");
  const saved = page.waitForResponse((r) => /\/appointments$/.test(r.url()) && r.request().method() === "POST");
  await dialog.getByRole("button", { name: /^Salvar$/ }).click();
  expect((await saved).status()).toBeLessThan(300);
  expect(sql(DB.docregen, `SELECT data::text || ' ' || hora FROM appointments WHERE patient_id = ${id}`)).toBe(`${date} 14:05`);
  await expectNoInvalidDate(page);
  await shot(page, "docregen-en-US", "02-agenda");
});
