import { Router, type IRouter } from "express";
import { db, doctorsTable, adminContactMessages } from "@workspace/docregen-db";
import { eq, and, sql } from "drizzle-orm";
import { hashPassword, comparePassword, signToken, verifyToken } from "../lib/auth";
import { optionalDoctorAuth, requireAuth } from "../middlewares/requireAuth";
import { createResetToken, resetPasswordWithToken } from "../lib/passwordResetStore";
import { sendPasswordResetEmail } from "../lib/mailer";
import { recordSecurityEvent } from "../lib/securityMonitor";
import { clearAllSessionCookies, establishSession, getSessionCookie } from "../lib/session";
import {
  RegisterDoctorBody,
  LoginDoctorBody,
  isValidCpf,
  normalizeCpf,
} from "@workspace/docregen-api-zod";
import {
  accountLockRemainingMs,
  clearAccountFailures,
  lockoutMessage,
  normalizeEmail,
  recordAccountFailure,
} from "../lib/accountLockout";
import { identifierFingerprint } from "../lib/redaction";
import { secretariesTable } from "@workspace/docregen-db";

export const MIN_PASSWORD_LENGTH = 8;
import { serializeDoctor } from "../lib/doctorSerializer";
import {
  attachAnalyticsActor,
  emitAnalyticsEvent,
  resolveAnalyticsSessionId,
} from "../lib/analyticsEmitter";

const VALID_UF = new Set([
  "AC","AL","AM","AP","BA","CE","DF","ES","GO",
  "MA","MG","MS","MT","PA","PB","PE","PI","PR",
  "RJ","RN","RO","RR","RS","SC","SE","SP","TO",
]);

const router: IRouter = Router();

router.post("/auth/register", async (req, res): Promise<void> => {
  const parsed = RegisterDoctorBody.safeParse(
    req.body && typeof req.body === "object" && typeof req.body.email === "string"
      ? { ...req.body, email: req.body.email.trim() }
      : req.body,
  );
  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path[0];
    const error = field === "senha"
      ? `A senha deve ter pelo menos ${MIN_PASSWORD_LENGTH} caracteres.`
      : field === "email"
        ? "Informe um e-mail válido."
        : field === "nome"
          ? "Nome é obrigatório."
          : "Dados de cadastro inválidos.";
    res.status(400).json({ error, field: typeof field === "string" ? field : undefined });
    return;
  }

  const { senha, nome, crm, crmEstado, telefone, dataNascimento, endereco, cidade, estado, cep, especialidade, estrangeiro, paisOrigem, idioma } = parsed.data;
  // E-mails are stored normalized (trimmed, lowercase); see doctors_email_lower_unique.
  const email = normalizeEmail(parsed.data.email);
  const cpf = parsed.data.cpf?.trim() ? normalizeCpf(parsed.data.cpf) : undefined;

  const isForeign = estrangeiro === true;

  if (!nome.trim()) {
    res.status(400).json({ error: "Nome é obrigatório." });
    return;
  }
  if (senha.length < MIN_PASSWORD_LENGTH) {
    res.status(400).json({ error: `A senha deve ter pelo menos ${MIN_PASSWORD_LENGTH} caracteres.` });
    return;
  }
  if (!isForeign && cpf !== undefined && !isValidCpf(cpf)) {
    res.status(400).json({ error: "CPF inválido." });
    return;
  }

  // Validate CRM state (Brazilian doctors only)
  if (!isForeign) {
    if (!crm || !crmEstado) {
      res.status(400).json({ error: "CRM e estado do CRM são obrigatórios para médicos brasileiros." });
      return;
    }
    if (!VALID_UF.has(crmEstado.toUpperCase())) {
      res.status(400).json({ error: `Estado do CRM inválido: "${crmEstado}". Use a sigla oficial (ex: SP, RJ, MG).` });
      return;
    }
    if (!cpf) {
      res.status(400).json({ error: "CPF é obrigatório para médicos brasileiros." });
      return;
    }
  } else {
    if (!paisOrigem?.trim()) {
      res.status(400).json({ error: "País de origem é obrigatório para médicos estrangeiros." });
      return;
    }
  }

  if (estado && !VALID_UF.has(estado.toUpperCase())) {
    res.status(400).json({ error: `Estado de endereço inválido: "${estado}".` });
    return;
  }

  // Check for existing email
  const [byEmail] = await db.select({ id: doctorsTable.id }).from(doctorsTable)
    .where(sql`lower(${doctorsTable.email}) = ${email}`).limit(1);
  if (byEmail) {
    res.status(409).json({ error: "Email já cadastrado" });
    return;
  }

  // Check for duplicate CRM in the same state (Brazilian doctors only)
  if (!isForeign && crm && crmEstado) {
    const [byCrm] = await db.select({ id: doctorsTable.id }).from(doctorsTable)
      .where(and(eq(doctorsTable.crm, crm), eq(doctorsTable.crmEstado, crmEstado.toUpperCase()), eq(doctorsTable.isAdmin, false)))
      .limit(1);
    if (byCrm) {
      res.status(409).json({ error: `CRM ${crmEstado.toUpperCase()} ${crm} já cadastrado na plataforma.` });
      return;
    }
  }

  const senhaHash = await hashPassword(senha);

  const [doctor] = await db.insert(doctorsTable).values({
    nome: nome.trim(),
    email,
    senhaHash,
    crm: isForeign ? null : (crm ?? null),
    crmEstado: isForeign ? null : (crmEstado ? crmEstado.toUpperCase() : null),
    cpf: isForeign ? null : (cpf ?? null),
    estrangeiro: isForeign,
    paisOrigem: isForeign ? (paisOrigem ?? null) : null,
    telefone: telefone ?? null,
    dataNascimento: dataNascimento ?? null,
    endereco: endereco ?? null,
    cidade: cidade ?? null,
    estado: estado ? estado.toUpperCase() : null,
    cep: cep ?? null,
    especialidade: especialidade ?? null,
    idioma: idioma ?? "pt-BR",
    isAdmin: false,
    // Registration issues an authenticated session, so it is the account's first access.
    lastLoginAt: new Date(),
  }).returning();

  const token = signToken({
    doctorId: doctor.id,
    isAdmin: doctor.isAdmin,
    sessionVersion: doctor.sessionVersion,
  });
  establishSession(res, "doctor", token);

  // Attribute the canonical registration to the existing opaque acquisition
  // session when the client supplied a valid session header.
  const analyticsSessionId = await resolveAnalyticsSessionId(req.get("X-Analytics-Session-Id"));
  void attachAnalyticsActor(analyticsSessionId, doctor.id);
  void emitAnalyticsEvent("register", doctor.id, analyticsSessionId);

  const safeDoctor = serializeDoctor(doctor);
  res.status(201).json({
    doctor: {
      ...safeDoctor,
      createdAt: safeDoctor.createdAt.toISOString(),
      lastLoginAt: safeDoctor.lastLoginAt?.toISOString() ?? null,
    },
  });
});

router.post("/auth/login", async (req, res): Promise<void> => {
  const parsed = LoginDoctorBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { email: identificadorRaw, senha } = parsed.data;
  const identificador = normalizeEmail(identificadorRaw);

  // Support login by email OR CPF (CPF: 11 numeric digits optionally formatted)
  const isCpf = /^[\d.\-]+$/.test(identificador) && identificador.replace(/\D/g, "").length === 11;
  const normalizedCpf = identificador.replace(/\D/g, "");
  // Lockout key: the normalized identifier the caller typed (e-mail or CPF digits).
  const lockIdentifier = isCpf ? `cpf:${normalizedCpf}` : identificador;
  const fingerprint = identifierFingerprint(lockIdentifier);

  const lockedMs = await accountLockRemainingMs("doctor", lockIdentifier);
  if (lockedMs > 0) {
    recordSecurityEvent("auth_failure", `login médico bloqueado id=${fingerprint}`);
    res.setHeader("Retry-After", String(Math.ceil(lockedMs / 1000)));
    res.status(429).json({ error: lockoutMessage(lockedMs), code: "ACCOUNT_LOCKED" });
    return;
  }

  let doctor: typeof doctorsTable.$inferSelect | undefined;
  if (isCpf) {
    const [byCpf] = await db.select().from(doctorsTable)
      .where(sql`${doctorsTable.cpf} IN (${identificador}, ${normalizedCpf})`)
      .orderBy(doctorsTable.id)
      .limit(1);
    doctor = byCpf;
  }
  if (!doctor) {
    // Exact match on the normalized e-mail (stored lowercase; unique on lower(email)).
    const [byEmail] = await db.select().from(doctorsTable).where(eq(doctorsTable.email, identificador)).limit(1);
    doctor = byEmail;
  }

  const valid = doctor ? await comparePassword(senha, doctor.senhaHash) : false;
  if (!doctor || !valid || !doctor.aprovado) {
    recordSecurityEvent("auth_failure", `login médico id=${fingerprint}`);
    const nowLockedMs = await recordAccountFailure("doctor", lockIdentifier);
    if (nowLockedMs > 0) {
      res.setHeader("Retry-After", String(Math.ceil(nowLockedMs / 1000)));
      res.status(429).json({ error: lockoutMessage(nowLockedMs), code: "ACCOUNT_LOCKED" });
      return;
    }
    res.status(401).json({ error: "Credenciais inválidas" });
    return;
  }
  await clearAccountFailures("doctor", lockIdentifier);

  // Keep access tracking independent from patients or procedures.
  const [loggedInDoctor] = await db
    .update(doctorsTable)
    .set({ lastLoginAt: new Date() })
    .where(and(eq(doctorsTable.id, doctor.id), eq(doctorsTable.aprovado, true)))
    .returning();

  if (!loggedInDoctor) {
    recordSecurityEvent("auth_failure", `login médico id=${fingerprint}`);
    res.status(401).json({ error: "Credenciais inválidas" });
    return;
  }

  const token = signToken({
    doctorId: loggedInDoctor.id,
    isAdmin: loggedInDoctor.isAdmin,
    sessionVersion: loggedInDoctor.sessionVersion,
  });
  establishSession(res, "doctor", token);

  // Emit canonical server-side login event (fail-open, no PII)
  const analyticsSessionId = await resolveAnalyticsSessionId(req.get("X-Analytics-Session-Id"));
  void attachAnalyticsActor(analyticsSessionId, loggedInDoctor.id);
  void emitAnalyticsEvent("login", loggedInDoctor.id, analyticsSessionId);

  const safeDoctor = serializeDoctor(loggedInDoctor);
  res.json({
    doctor: {
      ...safeDoctor,
      createdAt: safeDoctor.createdAt.toISOString(),
      lastLoginAt: safeDoctor.lastLoginAt?.toISOString() ?? null,
    },
  });
});

/**
 * POST /auth/logout — ends the doctor and/or secretary session: bumps the
 * account's sessionVersion (so a copied token/cookie stops working at once)
 * and clears every session cookie.
 */
router.post("/auth/logout", async (req, res): Promise<void> => {
  const tokens = [
    getSessionCookie(req, "doctor"),
    getSessionCookie(req, "secretary"),
    req.headers.authorization?.startsWith("Bearer ") ? req.headers.authorization.slice(7).trim() : null,
  ].filter((token): token is string => Boolean(token));
  for (const token of tokens) {
    const payload = verifyToken(token);
    if (!payload) continue;
    if (payload.role === "doctor") {
      await db.update(doctorsTable)
        .set({ sessionVersion: sql`${doctorsTable.sessionVersion} + 1` })
        .where(and(eq(doctorsTable.id, payload.doctorId), eq(doctorsTable.sessionVersion, payload.sessionVersion)));
    } else {
      await db.update(secretariesTable)
        .set({ sessionVersion: sql`${secretariesTable.sessionVersion} + 1` })
        .where(and(eq(secretariesTable.id, payload.secretaryId), eq(secretariesTable.sessionVersion, payload.sessionVersion)));
    }
  }
  clearAllSessionCookies(res);
  res.json({ success: true });
});

const legacyPasswordResetRemoved = (_req: unknown, res: {
  status: (code: number) => { json: (body: { error: string }) => void };
}): void => {
  res.status(410).json({
    error: "Este fluxo foi desativado. Solicite um link seguro de recuperação por e-mail.",
  });
};

router.post("/auth/verify-identity", legacyPasswordResetRemoved);
router.post("/auth/reset-password", legacyPasswordResetRemoved);

/**
 * POST /auth/forgot-password
 * Public — receives an email, finds the doctor, generates a reset token, sends email.
 * Always returns 200 to avoid user enumeration.
 */
router.post("/auth/forgot-password", async (req, res): Promise<void> => {
  const { email, idioma } = req.body ?? {};
  if (!email || typeof email !== "string") {
    res.status(400).json({ error: "E-mail obrigatório." });
    return;
  }

  const emailNorm = normalizeEmail(email);
  const requestedLocale = idioma === "es" || idioma === "pt-BR" ? idioma : undefined;
  const [doctor] = await db
    .select()
    .from(doctorsTable)
    .where(eq(doctorsTable.email, emailNorm))
    .limit(1);

  if (doctor?.aprovado) {
    // Respond immediately with the same body for existing/non-existing emails.
    // Token creation and mail delivery continue without exposing account
    // existence through response timing.
    void (async () => {
      try {
        const token = await createResetToken(doctor.id);
        await sendPasswordResetEmail(
          doctor.email,
          token,
          doctor.nome,
          requestedLocale ?? doctor.idioma,
        );
      } catch (err) {
        req.log.error({ err }, "Failed to send password reset email");
      }
    })();
  }

  res.json({
    success: true,
    message: "Se o e-mail estiver cadastrado, enviaremos um link de recuperação.",
  });
});

/**
 * POST /auth/reset-password-token
 * Public — consumes a one-time reset token and sets a new password.
 */
router.post("/auth/reset-password-token", async (req, res): Promise<void> => {
  const { token, novaSenha } = req.body ?? {};
  if (!token || !novaSenha) {
    res.status(400).json({ error: "Token e nova senha são obrigatórios." });
    return;
  }
  if (typeof token !== "string" || !/^[a-f0-9]{64}$/i.test(token)) {
    res.status(400).json({ error: "Link inválido ou expirado. Solicite um novo link." });
    return;
  }
  if (String(novaSenha).length < MIN_PASSWORD_LENGTH) {
    res.status(400).json({ error: `A senha deve ter pelo menos ${MIN_PASSWORD_LENGTH} caracteres.` });
    return;
  }

  const senhaHash = await hashPassword(String(novaSenha));
  const updated = await resetPasswordWithToken(token, senhaHash);
  if (!updated) {
    res.status(400).json({ error: "Link inválido ou expirado. Solicite um novo link." });
    return;
  }

  res.json({ success: true });
});

/**
 * GET /auth/config
 * Public — returns non-sensitive platform configuration for the frontend.
 */
router.get("/auth/config", (_req, res): void => {
  res.json({
    contactEmail: process.env.DOCREGEN_CONTACT_EMAIL ?? "",
  });
});

/**
 * POST /auth/change-password
 * Authenticated — requires current password before setting a new one.
 */
router.post("/auth/change-password", requireAuth, async (req, res): Promise<void> => {
  const { senhaAtual, novaSenha } = req.body ?? {};
  if (!senhaAtual || !novaSenha) {
    res.status(400).json({ error: "Senha atual e nova senha são obrigatórias." });
    return;
  }
  if (String(novaSenha).length < MIN_PASSWORD_LENGTH) {
    res.status(400).json({ error: `A nova senha deve ter pelo menos ${MIN_PASSWORD_LENGTH} caracteres.` });
    return;
  }

  const [doctor] = await db.select().from(doctorsTable).where(eq(doctorsTable.id, req.doctorId!)).limit(1);
  if (!doctor) {
    res.status(401).json({ error: "Não autenticado" });
    return;
  }

  const valid = await comparePassword(String(senhaAtual), doctor.senhaHash);
  if (!valid) {
    res.status(401).json({ error: "Senha atual incorreta." });
    return;
  }

  const senhaHash = await hashPassword(String(novaSenha));
  const [updatedDoctor] = await db
    .update(doctorsTable)
    .set({
      senhaHash,
      sessionVersion: sql`${doctorsTable.sessionVersion} + 1`,
    })
    .where(and(
      eq(doctorsTable.id, doctor.id),
      eq(doctorsTable.aprovado, true),
    ))
    .returning();

  if (!updatedDoctor) {
    res.status(401).json({ error: "Não autenticado" });
    return;
  }

  establishSession(res, "doctor", signToken({
    doctorId: updatedDoctor.id,
    isAdmin: updatedDoctor.isAdmin,
    sessionVersion: updatedDoctor.sessionVersion,
  }));

  res.json({ success: true });
});

router.get("/auth/me", optionalDoctorAuth, async (req, res): Promise<void> => {
  if (!req.doctorId) {
    res.status(204).end();
    return;
  }
  const [doctor] = await db.select().from(doctorsTable).where(eq(doctorsTable.id, req.doctorId!)).limit(1);
  if (!doctor) {
    res.status(401).json({ error: "Não autenticado" });
    return;
  }
  const safeDoctor = serializeDoctor(doctor);
  res.json({ ...safeDoctor, createdAt: safeDoctor.createdAt.toISOString() });
});

/**
 * POST /auth/contact
 * Public — anyone can send a support message (from the login page).
 * Fields: nome, celular, mensagem (all required).
 */
router.post("/auth/contact", async (req, res): Promise<void> => {
  const { nome, celular, mensagem } = req.body ?? {};
  if (!nome || typeof nome !== "string" || nome.trim().length < 2) {
    res.status(400).json({ error: "Nome é obrigatório." });
    return;
  }
  if (!mensagem || typeof mensagem !== "string" || mensagem.trim().length < 5) {
    res.status(400).json({ error: "Mensagem deve ter pelo menos 5 caracteres." });
    return;
  }
  await db.insert(adminContactMessages).values({
    nome: nome.trim(),
    celular: celular ? String(celular).trim() : null,
    mensagem: mensagem.trim(),
  });
  res.json({ success: true });
});

export default router;
