import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const sendMail = vi.fn(async () => ({}));

vi.mock("nodemailer", () => ({
  default: { createTransport: vi.fn(() => ({ sendMail })) },
}));

const { sendPasswordResetEmail } = await import("./mailer");

const originalEnv = {
  APP_URL: process.env["APP_URL"],
  GMAIL_USER: process.env["GMAIL_USER"],
  GMAIL_APP_PASSWORD: process.env["GMAIL_APP_PASSWORD"],
};

function restore(key: keyof typeof originalEnv) {
  if (originalEnv[key] === undefined) delete process.env[key];
  else process.env[key] = originalEnv[key];
}

type SentMail = { from: string; subject: string; html: string };

function lastMail(): SentMail {
  const calls = sendMail.mock.calls as unknown as Array<[SentMail]>;
  return calls[calls.length - 1]![0];
}

beforeEach(() => {
  process.env["APP_URL"] = "https://mail.example";
  process.env["GMAIL_USER"] = "sender@example.test";
  process.env["GMAIL_APP_PASSWORD"] = "unused";
  sendMail.mockClear();
});

afterAll(() => {
  restore("APP_URL");
  restore("GMAIL_USER");
  restore("GMAIL_APP_PASSWORD");
});

describe("password reset e-mail", () => {
  it("keeps the DocSholder branding and root link by default", async () => {
    await sendPasswordResetEmail("doctor@example.test", "tok123", "Dra. Teste", "pt-BR");
    const mail = lastMail();
    expect(mail.from).toBe('"DocSholder" <sender@example.test>');
    expect(mail.subject).toBe("Redefinição de senha — DocSholder");
    expect(mail.html).toContain("https://mail.example/redefinir-senha?token=tok123");
    expect(mail.html).not.toContain("/docregen/");
    expect(mail.html).not.toContain("DocRegen");
  });

  it("uses DocRegen branding and the /docregen link for DocRegen requests", async () => {
    await sendPasswordResetEmail("doctor@example.test", "tok456", "Dra. Teste", "es", "docregen");
    const mail = lastMail();
    expect(mail.from).toBe('"DocRegen" <sender@example.test>');
    expect(mail.subject).toBe("Restablecimiento de contraseña — DocRegen");
    expect(mail.html).toContain("https://mail.example/docregen/redefinir-senha?token=tok456");
    expect(mail.html).not.toContain("DocSholder");
  });
});
