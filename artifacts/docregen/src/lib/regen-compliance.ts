/**
 * DocRegen — Motor de Compliance
 * Implementa regras HS01–HS06, LB01–LB02, WN01–WN03 baseadas na especificação v2.0
 *
 * Modo "registro"  → can_save SEMPRE true (registro histórico);
 *                    flags são exibidas como avisos.
 * Modo "planejamento" → blocks impedem can_save = false.
 */

export interface RegenContext {
  activeInfection?: boolean;
  malignancy?: boolean;
  anticoagulant?: boolean;
  immunosuppressed?: boolean;
  dm?: boolean;
  hba1c?: number | null;
  imc?: number | null;
  conditionCode?: string;
  productCode?: string;
  patientAge?: number | null;
  adverseEvent?: boolean;
  labFlagCount?: number;         // número de analitos com flag crítica
  plateletCount?: number | null; // × 10³/µL — relevante para PRP
}

export type ComplianceSeverity = "block" | "warning" | "info";

export interface ComplianceFlag {
  code: string;
  severity: ComplianceSeverity;
  message: string;
}

export interface ComplianceResult {
  can_save: boolean;
  flags: ComplianceFlag[];
}

export function patientAgeFromDob(
  dateOfBirth: string | null | undefined,
  asOf = new Date(),
): number | null {
  const match = dateOfBirth?.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  const birthYear = Number(match[1]);
  const birthMonth = Number(match[2]);
  const birthDay = Number(match[3]);
  if (
    !Number.isInteger(birthYear) ||
    birthMonth < 1 || birthMonth > 12 ||
    birthDay < 1 || birthDay > 31
  ) return null;
  let age = asOf.getFullYear() - birthYear;
  const beforeBirthday =
    asOf.getMonth() + 1 < birthMonth ||
    (asOf.getMonth() + 1 === birthMonth && asOf.getDate() < birthDay);
  if (beforeBirthday) age -= 1;
  return age >= 0 ? age : null;
}

export function prpComplianceProduct(codes: readonly string[]): string | undefined {
  return codes.find((code) =>
    code.startsWith("PRP") || code === "LP_PRP" || code === "LR_PRP" || code === "PRF"
  );
}

// ─── Regras ──────────────────────────────────────────────────────────────────

function evaluate(ctx: RegenContext, mode: "registro" | "planejamento"): ComplianceFlag[] {
  const flags: ComplianceFlag[] = [];

  // HS01 — Infecção ativa (contra-indicação absoluta)
  if (ctx.activeInfection) {
    flags.push({
      code: "HS01",
      severity: "block",
      message: "Infecção ativa — procedimento contraindicado. Trate a infecção antes de prosseguir.",
    });
  }

  // HS02 — Neoplasia ativa (contra-indicação absoluta)
  if (ctx.malignancy) {
    flags.push({
      code: "HS02",
      severity: "block",
      message: "Neoplasia ativa — uso de ortobiológicos com potencial proliferativo é contraindicado.",
    });
  }

  // HS03 — DM com HbA1c > 7,5%
  if (ctx.dm && ctx.hba1c != null && ctx.hba1c > 7.5) {
    flags.push({
      code: "HS03",
      severity: "warning",
      message: `Diabetes com HbA1c ${ctx.hba1c}% > 7,5% — controle glicêmico subótimo reduz eficácia biológica. Otimize antes do procedimento.`,
    });
  }

  // HS04 — Anticoagulação
  if (ctx.anticoagulant) {
    flags.push({
      code: "HS04",
      severity: "warning",
      message: "Paciente em uso de anticoagulante — avalie suspensão criteriosa (washout) prévia ao procedimento. Confirme com equipe assistente.",
    });
  }

  // HS05 — Imunossupressão
  if (ctx.immunosuppressed) {
    flags.push({
      code: "HS05",
      severity: "warning",
      message: "Imunossupressão ativa — resposta biológica possivelmente reduzida; monitorar cicatrização e sinais de infecção.",
    });
  }

  // HS06 — Obesidade grau III (IMC ≥ 40)
  if (ctx.imc != null && ctx.imc >= 40) {
    flags.push({
      code: "HS06",
      severity: "warning",
      message: `IMC ${ctx.imc?.toFixed(1)} kg/m² — obesidade grau III; eficácia reduzida e maior risco de complicações técnicas.`,
    });
  }

  // LB01 — Plaquetas baixas para PRP (< 150 × 10³/µL)
  if (
    ctx.productCode?.startsWith("PRP") ||
    ctx.productCode === "LP_PRP" ||
    ctx.productCode === "LR_PRP" ||
    ctx.productCode === "PRF"
  ) {
    if (ctx.plateletCount != null && ctx.plateletCount < 150) {
      flags.push({
        code: "LB01",
        severity: "warning",
        message: `Contagem plaquetária ${ctx.plateletCount} × 10³/µL < 150 — concentrado plaquetário com menor potência biológica esperada.`,
      });
    }
  }

  // LB02 — Analitos críticos
  if (ctx.labFlagCount && ctx.labFlagCount > 0) {
    flags.push({
      code: "LB02",
      severity: "info",
      message: `${ctx.labFlagCount} ${ctx.labFlagCount === 1 ? "analito laboratorial" : "analitos laboratoriais"} fora de referência — revise antes de prosseguir com o procedimento.`,
    });
  }

  // WN01 — Paciente pediátrico (< 18 anos)
  if (ctx.patientAge != null && ctx.patientAge < 18) {
    flags.push({
      code: "WN01",
      severity: "warning",
      message: "Paciente pediátrico (< 18 anos) — evidência limitada; documentar justificativa clínica e obter consentimento dos responsáveis.",
    });
  }

  // WN02 — Evento adverso reportado
  if (ctx.adverseEvent) {
    flags.push({
      code: "WN02",
      severity: "warning",
      message: "Evento adverso registrado — notifique à vigilância sanitária se aplicável e documente evolução.",
    });
  }

  // WN03 — IMC elevado (30–39,9)
  if (ctx.imc != null && ctx.imc >= 30 && ctx.imc < 40) {
    flags.push({
      code: "WN03",
      severity: "info",
      message: `IMC ${ctx.imc?.toFixed(1)} kg/m² — sobrepeso/obesidade; considere otimização do peso para maximizar resposta terapêutica.`,
    });
  }

  return flags;
}

// ─── API pública ─────────────────────────────────────────────────────────────

export function evaluateCompliance(
  ctx: RegenContext,
  mode: "registro" | "planejamento"
): ComplianceResult {
  const flags = evaluate(ctx, mode);
  const blocks = flags.filter(f => f.severity === "block");
  const can_save = mode === "registro" ? true : blocks.length === 0;
  return { can_save, flags };
}

/** Computa IMC a partir de peso (kg) e altura (cm) */
export function calcImc(weightKg?: number | null, heightCm?: number | null): number | null {
  if (!weightKg || !heightCm || heightCm <= 0) return null;
  return parseFloat((weightKg / ((heightCm / 100) ** 2)).toFixed(2));
}
