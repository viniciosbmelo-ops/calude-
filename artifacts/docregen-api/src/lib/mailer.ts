import nodemailer from "nodemailer";
import { logger } from "./logger";
import { getBaseUrl } from "./base-url";
import { resolveDoctorLocale, type SupportedLocale } from "./locale";
import { APP_BRAND_NAME, buildAppLink } from "./app-links";
import { escapeHtml, identifierFingerprint } from "./redaction";

function createTransporter() {
  const user = process.env["DOCREGEN_GMAIL_USER"];
  const pass = process.env["DOCREGEN_GMAIL_APP_PASSWORD"];
  if (!user || !pass) {
    throw new Error("DOCREGEN_GMAIL_USER e DOCREGEN_GMAIL_APP_PASSWORD são obrigatórios para envio de e-mail.");
  }
  return nodemailer.createTransport({
    service: "gmail",
    auth: { user, pass },
  });
}

function getAppUrl(): string {
  return getBaseUrl();
}

export async function sendPasswordResetEmail(
  to: string,
  token: string,
  nome: string,
  doctorLocale?: unknown,
): Promise<void> {
  const locale: SupportedLocale = resolveDoctorLocale(doctorLocale);
  const resetUrl = buildAppLink(getAppUrl(), `/redefinir-senha?token=${token}`);
  const brand = APP_BRAND_NAME;
  const contactEmail = process.env["DOCREGEN_CONTACT_EMAIL"] ?? process.env["DOCREGEN_GMAIL_USER"] ?? "";
  const copy = locale === "es"
    ? {
      subtitle: "Medicina Regenerativa y Dolor", greeting: "Hola",
      request: `Recibimos una solicitud para restablecer su contraseña de ${brand}.<br/>Haga clic en el botón para crear una nueva contraseña.`,
      button: "Restablecer mi contraseña",
      expiry: "Este enlace caduca en <strong>1 hora</strong>. Si no solicitó el restablecimiento, ignore este correo; su contraseña no cambiará.",
      copy: "O copie y pegue esta dirección en el navegador:", contact: "¿Preguntas? Contáctenos:",
      subject: `Restablecimiento de contraseña — ${brand}`,
    }
    : {
      subtitle: "Medicina Regenerativa e Dor", greeting: "Olá",
      request: `Recebemos uma solicitação para redefinir a sua senha no ${brand}.<br/>Clique no botão abaixo para criar uma nova senha.`,
      button: "Redefinir minha senha",
      expiry: "Este link expira em <strong>1 hora</strong>. Se você não solicitou a redefinição, ignore este email — sua senha permanece inalterada.",
      copy: "Ou copie e cole este endereço no navegador:", contact: "Dúvidas? Entre em contato:",
      subject: `Redefinição de senha — ${brand}`,
    };

  const html = `
<!DOCTYPE html>
<html>
<body style="margin:0;padding:24px;background:#F0F6FA;font-family:'DM Sans',Arial,sans-serif;">
  <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:8px;overflow:hidden;border:1px solid #D8E6EE;">
    <div style="background:#0A1828;padding:32px 40px;text-align:center;">
      <h1 style="color:#D0E8F5;font-size:22px;font-weight:400;margin:0;letter-spacing:-0.3px;">${brand}</h1>
       <p style="color:#5A8AA8;font-size:12px;margin:6px 0 0;">${copy.subtitle}</p>
    </div>
    <div style="padding:40px;">
       <p style="color:#0F1F2B;font-size:15px;margin:0 0 8px;">${copy.greeting}, <strong>${escapeHtml(nome)}</strong>.</p>
      <p style="color:#4A6070;font-size:14px;line-height:1.65;margin:0 0 28px;">
         ${copy.request}
      </p>
      <div style="text-align:center;margin-bottom:28px;">
        <a href="${resetUrl}"
           style="display:inline-block;padding:13px 32px;background:#0A1828;color:#D0E8F5;text-decoration:none;border-radius:6px;font-size:15px;font-weight:500;">
           ${copy.button}
        </a>
      </div>
      <p style="color:#8AABB8;font-size:12px;line-height:1.6;margin:0 0 8px;">
         ${copy.expiry}
      </p>
      <p style="color:#C0D4DE;font-size:11px;margin:0;word-break:break-all;">
         ${copy.copy}<br/>
        <span style="color:#1872A5;">${resetUrl}</span>
      </p>
    </div>
    <div style="background:#F5F9FC;padding:16px 40px;border-top:1px solid #D8E6EE;text-align:center;">
      <p style="color:#8AABB8;font-size:11px;margin:0;">
         ${copy.contact}
        <a href="mailto:${contactEmail}" style="color:#1872A5;">${contactEmail}</a>
      </p>
    </div>
  </div>
</body>
</html>
  `.trim();

  const transporter = createTransporter();
  await transporter.sendMail({
    from: `"${brand}" <${process.env["DOCREGEN_GMAIL_USER"]}>`,
    to,
     subject: copy.subject,
    html,
  });

  logger.info({ to: identifierFingerprint(to) }, "Password reset email sent via Gmail");
}

/** Address that receives operator notifications (LGPD requests). */
export function operatorContactEmail(): string | null {
  const address = (process.env["DOCREGEN_CONTACT_EMAIL"] ?? "").trim();
  return address || null;
}

/**
 * Notifies the operator (DOCREGEN_CONTACT_EMAIL) that a doctor asked for the
 * deletion of their account (LGPD Art. 18, VI). Handling is manual — see
 * replit.md, "LGPD — solicitações de exclusão".
 */
export async function sendLgpdDeletionRequestEmail(request: {
  requestId: number;
  doctorId: number;
  doctorName: string;
  doctorEmail: string;
  requestedAt: Date;
}): Promise<void> {
  const to = operatorContactEmail();
  if (!to) throw new Error("DOCREGEN_CONTACT_EMAIL não configurado.");
  const brand = APP_BRAND_NAME;
  const html = `
<div style="font-family:Arial,sans-serif;max-width:560px;padding:24px;border:1px solid #D8E6EE;border-radius:8px;">
  <h2 style="margin:0 0 12px;">${escapeHtml(brand)} — solicitação de exclusão (LGPD)</h2>
  <p><strong>Solicitação:</strong> #${request.requestId}</p>
  <p><strong>Médico:</strong> ${escapeHtml(request.doctorName)} (id ${request.doctorId}, ${escapeHtml(request.doctorEmail)})</p>
  <p><strong>Recebida em:</strong> ${request.requestedAt.toISOString()}</p>
  <p>Prazo de resposta: 15 dias (LGPD Art. 19, II). Os prontuários dos pacientes
  devem ser mantidos por 20 anos (Lei 13.787/2018) e não podem ser apagados; a
  exclusão abrange os dados da conta que não estejam sujeitos a guarda legal.
  Procedimento: replit.md → "LGPD — solicitações de exclusão".</p>
</div>`.trim();
  const transporter = createTransporter();
  await transporter.sendMail({
    from: `"${brand}" <${process.env["DOCREGEN_GMAIL_USER"]}>`,
    to,
    subject: `[${brand}] Solicitação de exclusão de conta (LGPD) #${request.requestId}`,
    html,
  });
  logger.info({ requestId: request.requestId, doctorId: request.doctorId }, "LGPD deletion request notified");
}
