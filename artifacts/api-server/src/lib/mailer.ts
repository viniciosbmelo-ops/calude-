import nodemailer from "nodemailer";
import { logger } from "./logger";
import { getBaseUrl } from "./base-url";
import { resolveDoctorLocale, type SupportedLocale } from "./locale";

function createTransporter() {
  const user = process.env["GMAIL_USER"];
  const pass = process.env["GMAIL_APP_PASSWORD"];
  if (!user || !pass) {
    throw new Error("GMAIL_USER e GMAIL_APP_PASSWORD são obrigatórios para envio de e-mail.");
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
  const resetUrl = `${getAppUrl()}/redefinir-senha?token=${token}`;
  const contactEmail = process.env["CONTACT_EMAIL"] ?? "dockneeapp@gmail.com";
  const copy = locale === "es"
    ? {
      subtitle: "Documentación Quirúrgica Inteligente", greeting: "Hola",
      request: "Recibimos una solicitud para restablecer su contraseña de DocSholder.<br/>Haga clic en el botón para crear una nueva contraseña.",
      button: "Restablecer mi contraseña",
      expiry: "Este enlace caduca en <strong>1 hora</strong>. Si no solicitó el restablecimiento, ignore este correo; su contraseña no cambiará.",
      copy: "O copie y pegue esta dirección en el navegador:", contact: "¿Preguntas? Contáctenos:",
      subject: "Restablecimiento de contraseña — DocSholder",
    }
    : {
      subtitle: "Documentação Cirúrgica Inteligente", greeting: "Olá",
      request: "Recebemos uma solicitação para redefinir a sua senha no DocSholder.<br/>Clique no botão abaixo para criar uma nova senha.",
      button: "Redefinir minha senha",
      expiry: "Este link expira em <strong>1 hora</strong>. Se você não solicitou a redefinição, ignore este email — sua senha permanece inalterada.",
      copy: "Ou copie e cole este endereço no navegador:", contact: "Dúvidas? Entre em contato:",
      subject: "Redefinição de senha — DocSholder",
    };

  const html = `
<!DOCTYPE html>
<html>
<body style="margin:0;padding:24px;background:#F0F6FA;font-family:'DM Sans',Arial,sans-serif;">
  <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:8px;overflow:hidden;border:1px solid #D8E6EE;">
    <div style="background:#0A1828;padding:32px 40px;text-align:center;">
      <h1 style="color:#D0E8F5;font-size:22px;font-weight:400;margin:0;letter-spacing:-0.3px;">DocSholder</h1>
       <p style="color:#5A8AA8;font-size:12px;margin:6px 0 0;">${copy.subtitle}</p>
    </div>
    <div style="padding:40px;">
       <p style="color:#0F1F2B;font-size:15px;margin:0 0 8px;">${copy.greeting}, <strong>${nome}</strong>.</p>
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
    from: `"DocSholder" <${process.env["GMAIL_USER"]}>`,
    to,
     subject: copy.subject,
    html,
  });

  logger.info({ to, nome }, "Password reset email sent via Gmail");
}
