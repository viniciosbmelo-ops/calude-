import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { expect, type Page } from "@playwright/test";
import { SCREENSHOT_DIR } from "./env";

/** Runs SQL against a disposable E2E database and returns the rows as tab-separated text. */
export function sql(databaseUrl: string, query: string): string {
  return execFileSync("psql", [databaseUrl, "-v", "ON_ERROR_STOP=1", "-qAt", "-F", "\t", "-c", query], {
    encoding: "utf8",
  }).trim();
}

/** Saves a named screenshot of a key step (always, not only on failure). */
export async function shot(page: Page, app: string, name: string): Promise<void> {
  const dir = path.join(SCREENSHOT_DIR, app);
  fs.mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: path.join(dir, `${name}.png`), fullPage: true });
}

/** Screenshot of a secondary page (patient/secretary) when a step fails; Playwright only captures fixture pages. */
export async function failShot(page: Page, app: string, name: string): Promise<void> {
  const dir = path.join(SCREENSHOT_DIR, app, "failures");
  fs.mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: path.join(dir, `${name}.png`), fullPage: true }).catch(() => undefined);
}

/** Collects uncaught page errors and console errors so specs can assert none happened. */
export function trackPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(`console: ${msg.text()}`);
  });
  page.on("response", async (response) => {
    const url = response.url();
    if (response.status() >= 400 && /\/(api|regen-api)\//.test(url)) {
      const body = await response.text().catch(() => "");
      const line = `HTTP ${response.status()} ${response.request().method()} ${url} ${body.slice(0, 300)}`;
      errors.push(line);
      if (process.env["E2E_DEBUG"]) console.log(line);
    }
  });
  return errors;
}

export async function expectNoInvalidDate(page: Page): Promise<void> {
  await expect(page.locator("body")).not.toContainText(/Invalid time value|Invalid Date|NaN\/NaN/);
}

/** Types a date into the app's DD/MM/AAAA DateInput (a text input). */
export async function fillDate(page: Page, selector: string | ReturnType<Page["locator"]>, ddmmyyyy: string): Promise<void> {
  const input = typeof selector === "string" ? page.locator(selector) : selector;
  await input.click();
  await input.fill("");
  await input.pressSequentially(ddmmyyyy.replace(/\D/g, ""));
  await input.blur();
}

/** Formats a Date as DD/MM/AAAA in America/Sao_Paulo. */
export function brDate(date: Date): string {
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric" }).format(date);
}

/** Today's calendar date in America/Sao_Paulo as YYYY-MM-DD. */
export function isoToday(offsetDays = 0): string {
  const d = new Date(Date.now() + offsetDays * 86_400_000);
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  return parts;
}

export function isoToBr(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

/** A minimal valid PNG (fictional "exam" image). */
export const FICTIONAL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

/** Generates a valid (fictional) CPF with correct check digits. */
export function fakeCpf(seed: number): string {
  const base = String(100000000 + ((seed * 7919) % 899999999)).slice(0, 9).split("").map(Number);
  if (new Set(base).size === 1) base[0] = (base[0] + 1) % 10;
  const digit = (nums: number[]) => {
    const sum = nums.reduce((acc, n, i) => acc + n * (nums.length + 1 - i), 0);
    const rest = (sum * 10) % 11;
    return rest === 10 ? 0 : rest;
  };
  const d1 = digit(base);
  const d2 = digit([...base, d1]);
  return [...base, d1, d2].join("");
}

export function formatCpf(cpf: string): string {
  return cpf.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
}

/**
 * Fills every visible, empty field inside `scope` with fictional answers:
 * text inputs/textareas get `text`, native selects their first real option,
 * and the first checkbox of each group is ticked.
 */
export async function fillVisibleFields(page: Page, scopeSelector: string, text: string): Promise<void> {
  const scope = page.locator(scopeSelector);
  for (const field of await scope.locator("textarea:visible, input[type=text]:visible, input:not([type]):visible").all()) {
    if (await field.isEditable() && !(await field.inputValue())) await field.fill(text);
  }
  for (const select of await scope.locator("select:visible").all()) {
    const options = await select.locator("option").evaluateAll((els) =>
      els.map((el) => (el as HTMLOptionElement).value).filter((v) => v && v !== "outro"));
    if (options.length && !(await select.inputValue())) await select.selectOption(options[0]);
  }
  const boxes = await scope.locator("button[role=checkbox]:visible").all();
  const seenGroups = new Set<string>();
  for (const box of boxes) {
    const id = (await box.getAttribute("id")) ?? "";
    const group = id.split("-")[0];
    if (seenGroups.has(group)) continue;
    seenGroups.add(group);
    if ((await box.getAttribute("aria-checked")) !== "true") await box.click();
  }
}

/**
 * Patient side of the pré-consulta link (same UI in both apps): wrong CPF is
 * refused, right CPF opens the 6 steps, every field gets a fictional answer,
 * step 5 uploads a PNG exam through the (fake) object storage, then submits.
 */
export async function answerPreConsult(
  patientPage: Page,
  link: string,
  cpfDigits: string,
  app: string,
): Promise<void> {
  patientPage.on("dialog", (dialog) => void dialog.accept());
  await patientPage.goto(new URL(link).pathname);
  await patientPage.locator("#cpf").fill("111.444.777-35");
  await patientPage.getByRole("button", { name: "Acessar" }).click();
  await expect(patientPage.locator("#cpf")).toBeVisible();
  await patientPage.locator("#cpf").fill(formatCpf(cpfDigits));
  await patientPage.getByRole("button", { name: "Acessar" }).click();
  await expect(patientPage.getByText("Sobre Você", { exact: true }).first()).toBeVisible();
  await shot(patientPage, app, "05-pre-consult-step1");
  for (let step = 1; step <= 6; step++) {
    await fillVisibleFields(patientPage, "main", `Resposta ficticia etapa ${step}`);
    if (step === 2) await patientPage.locator("main button", { hasText: /^7$/ }).first().click();
    if (step === 5) {
      const upload = patientPage.waitForResponse((r) => /\/attachments$/.test(r.url()) && r.request().method() === "POST");
      await patientPage.locator("main input[type=file]").setInputFiles({
        name: "exame-ficticio.png", mimeType: "image/png", buffer: FICTIONAL_PNG,
      });
      expect((await upload).status()).toBe(201);
      await expect(patientPage.locator("p.truncate", { hasText: "exame-ficticio.png" })).toHaveCount(1);
      await shot(patientPage, app, "06-pre-consult-upload");
    }
    if (step < 6) await patientPage.getByRole("button", { name: /Próximo/ }).click();
  }
  const submit = patientPage.waitForResponse((r) => /\/submit$/.test(r.url()) && r.request().method() === "POST");
  await patientPage.getByRole("button", { name: /Finalizar envio/ }).click();
  expect((await submit).status()).toBe(200);
  await shot(patientPage, app, "07-pre-consult-submitted");
}

/**
 * Minimal text extraction for the jsPDF documents: inflates every content
 * stream and returns the literal strings of the text operators, joined by
 * spaces (enough to assert dates and names, not a general PDF parser).
 */
export function pdfText(pdf: Buffer): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const zlib = require("node:zlib") as typeof import("node:zlib");
  const raw = pdf.toString("latin1");
  const chunks: string[] = [];
  const re = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  for (let m = re.exec(raw); m; m = re.exec(raw)) {
    const bytes = Buffer.from(m[1], "latin1");
    try { chunks.push(zlib.inflateSync(bytes).toString("latin1")); } catch { chunks.push(m[1]); }
  }
  const strings: string[] = [];
  for (const content of chunks) {
    for (const s of content.matchAll(/\(((?:\\.|[^\\)])*)\)\s*Tj|\[((?:[^\]])*)\]\s*TJ/g)) {
      const literal = s[1] ?? (s[2] ?? "").match(/\(((?:\\.|[^\\)])*)\)/g)?.map((p) => p.slice(1, -1)).join("") ?? "";
      strings.push(literal.replace(/\\([()\\])/g, "$1").replace(/\\(\d{3})/g, (_, o: string) => String.fromCharCode(parseInt(o, 8))));
    }
  }
  return strings.join(" ");
}
