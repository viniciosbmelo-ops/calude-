import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const sendMail = vi.fn(async () => ({}));

vi.mock("nodemailer", () => ({
  default: { createTransport: vi.fn(() => ({ sendMail })) },
}));

const { sendPasswordResetEmail } = await import("./mailer");

const originalEnv = {
  DOCREGEN_APP_URL: process.env["DOCREGEN_APP_URL"],
  DOCREGEN_GMAIL_USER: process.env["DOCREGEN_GMAIL_USER"],
  DOCREGEN_GMAIL_APP_PASSWORD: process.env["DOCREGEN_GMAIL_APP_PASSWORD"],
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
  process.env["DOCREGEN_APP_URL"] = "https://mail.example";
  process.env["DOCREGEN_GMAIL_USER"] = "sender@example.test";
  process.env["DOCREGEN_GMAIL_APP_PASSWORD"] = "unused";
  sendMail.mockClear();
});

afterAll(() => {
  restore("DOCREGEN_APP_URL");
  restore("DOCREGEN_GMAIL_USER");
  restore("DOCREGEN_GMAIL_APP_PASSWORD");
});

describe("password reset e-mail", () => {
  it("always uses DocRegen branding and the /docregen link (pt-BR)", async () => {
    await sendPasswordResetEmail("doctor@example.test", "tok123", "Dra. Teste", "pt-BR");
    const mail = lastMail();
    expect(mail.from).toBe('"DocRegen" <sender@example.test>');
    expect(mail.subject).toBe("Redefinição de senha — DocRegen");
    expect(mail.html).toContain("https://mail.example/docregen/redefinir-senha?token=tok123");
    expect(mail.html).not.toContain("https://mail.example/redefinir-senha");
    expect(mail.html).not.toContain("DocSholder");
    expect(mail.html).not.toContain("DocKnee");
  });

  it("always uses DocRegen branding and the /docregen link (es)", async () => {
    await sendPasswordResetEmail("doctor@example.test", "tok456", "Dra. Teste", "es");
    const mail = lastMail();
    expect(mail.from).toBe('"DocRegen" <sender@example.test>');
    expect(mail.subject).toBe("Restablecimiento de contraseña — DocRegen");
    expect(mail.html).toContain("https://mail.example/docregen/redefinir-senha?token=tok456");
    expect(mail.html).not.toContain("DocSholder");
  });
});
