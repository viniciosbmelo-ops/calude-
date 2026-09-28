export interface ScheduleEntry {
  periodo: string;
  daysAfterSurgery: number;
  scales: string[];
  notes?: string;
  critical?: boolean;
}

export const PREOPERATIVE_PERIOD = "Pré-operatório";

export function hasFractureProcedure(tiposProcedimento?: readonly string[] | null): boolean {
  return tiposProcedimento?.includes("Fraturas") ?? false;
}

export function isPreoperativePeriod(periodo: string): boolean {
  const normalized = periodo
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
  return /^pre(?:-|\s)?op(?:eratorio)?(?:\b|\s|\()/.test(normalized);
}

export function isHiddenFracturePreoperative(
  tiposProcedimento: readonly string[] | null | undefined,
  periodo: string | null | undefined,
): boolean {
  return hasFractureProcedure(tiposProcedimento)
    && Boolean(periodo)
    && isPreoperativePeriod(periodo!);
}

export const FOLLOWUP_SCHEDULES: Record<string, ScheduleEntry[]> = {
  LCA: [
    { periodo: "Pré-operatório",  daysAfterSurgery: 0,   scales: ["IKDC", "VAS Dor", "Lysholm", "ACL-RSI"], notes: "Baseline pré-cirúrgico obrigatório" },
    { periodo: "30 dias",         daysAfterSurgery: 30,  scales: ["VAS Dor", "Lysholm"], notes: "Clínica: ADM, edema, complicações" },
    { periodo: "90 dias",         daysAfterSurgery: 90,  scales: ["VAS Dor", "Lysholm", "IKDC"], notes: "Avaliação funcional inicial" },
    { periodo: "180 dias",        daysAfterSurgery: 180, scales: ["VAS Dor", "IKDC", "Lysholm", "ACL-RSI", "Marx"], notes: "Decisão de retorno às atividades", critical: true },
    { periodo: "1 ano",           daysAfterSurgery: 365, scales: ["IKDC", "Lysholm", "ACL-RSI", "Tegner", "Marx", "VAS Dor"], notes: "Retorno ao esporte — hop tests, isocinético" },
    { periodo: "2 anos",          daysAfterSurgery: 730, scales: ["IKDC", "Lysholm", "Tegner", "VAS Dor"], notes: "Avaliação definitiva de longo prazo" },
  ],
  LCP: [
    { periodo: "Pré-operatório",  daysAfterSurgery: 0,   scales: ["IKDC", "Lysholm", "Tegner"], notes: "Gaveta posterior + RX stress ajoelhada" },
    { periodo: "30 dias",         daysAfterSurgery: 30,  scales: ["VAS Dor", "Lysholm"], notes: "Clínica: ADM, edema" },
    { periodo: "90 dias",         daysAfterSurgery: 90,  scales: ["VAS Dor", "Lysholm", "IKDC"], notes: "Avaliação funcional inicial" },
    { periodo: "180 dias",        daysAfterSurgery: 180, scales: ["VAS Dor", "Lysholm", "IKDC", "Tegner"], notes: "Gaveta posterior + RX stress — ponto crítico", critical: true },
    { periodo: "1 ano",           daysAfterSurgery: 365, scales: ["Lysholm", "IKDC", "Tegner", "VAS Dor"], notes: "Hop tests + isocinético" },
    { periodo: "2 anos",          daysAfterSurgery: 730, scales: ["Lysholm", "IKDC", "Tegner", "VAS Dor"], notes: "Avaliação definitiva" },
  ],
  LCM: [
    { periodo: "Pré-operatório",  daysAfterSurgery: 0,   scales: ["Lysholm", "IKDC", "Tegner"], notes: "Teste de valgo 0° e 30°, ADM" },
    { periodo: "6 semanas",       daysAfterSurgery: 42,  scales: ["Lysholm", "IKDC"], notes: "Monitorar ganho de força — índice quadríceps ≥80%" },
    { periodo: "90 dias",         daysAfterSurgery: 90,  scales: ["Lysholm", "IKDC", "Tegner"], notes: "Transição para fase avançada" },
    { periodo: "180 dias",        daysAfterSurgery: 180, scales: ["Lysholm", "IKDC", "Tegner"], notes: "Decisão de retorno às atividades — teste de valgo", critical: true },
    { periodo: "1 ano",           daysAfterSurgery: 365, scales: ["Lysholm", "IKDC", "Tegner"], notes: "Avaliação formal de retorno ao esporte" },
    { periodo: "2 anos",          daysAfterSurgery: 730, scales: ["Lysholm", "IKDC", "Tegner"], notes: "Resultado definitivo de longo prazo" },
  ],
  CPM: [
    { periodo: "Pré-operatório",  daysAfterSurgery: 0,   scales: ["Lysholm", "IKDC", "Tegner"], notes: "CPM = LCM + LOP; teste de valgo 0° e 30°, dial test medial, ADM" },
    { periodo: "6 semanas",       daysAfterSurgery: 42,  scales: ["Lysholm", "IKDC"], notes: "Verificar tensão LCM/LOP; índice quadríceps ≥80%" },
    { periodo: "90 dias",         daysAfterSurgery: 90,  scales: ["Lysholm", "IKDC", "Tegner"], notes: "Transição para fase avançada — estabilidade em valgo" },
    { periodo: "180 dias",        daysAfterSurgery: 180, scales: ["Lysholm", "IKDC", "Tegner"], notes: "Decisão de retorno — teste valgo + Quad/Hamstring ≥66%", critical: true },
    { periodo: "1 ano",           daysAfterSurgery: 365, scales: ["Lysholm", "IKDC", "Tegner"], notes: "Hop testing ≥90% LSI; avaliação formal de retorno ao esporte" },
    { periodo: "2 anos",          daysAfterSurgery: 730, scales: ["Lysholm", "IKDC", "Tegner"], notes: "Resultado definitivo de longo prazo" },
  ],
  CPL: [
    { periodo: "Pré-operatório",  daysAfterSurgery: 0,   scales: ["Lysholm", "IKDC", "Tegner", "KOOS-12"], notes: "CPL = LCL + Tend. Poplíteo + LPF; Recurvatum + RE stress; Dial Test 30° e 90°" },
    { periodo: "30 dias",         daysAfterSurgery: 30,  scales: ["VAS Dor", "Lysholm"], notes: "Clínica: ADM, edema; verificar recurvatum; integridade LCL" },
    { periodo: "90 dias",         daysAfterSurgery: 90,  scales: ["VAS Dor", "Lysholm", "IKDC", "KOOS-12"], notes: "Avaliação funcional inicial; Dial Test pós-op; estabilidade varo" },
    { periodo: "180 dias",        daysAfterSurgery: 180, scales: ["IKDC", "Lysholm", "Tegner", "KOOS-12"], notes: "Decisão de retorno; Varo 0° e 30°; RE stress — LCL + LPF íntegros", critical: true },
    { periodo: "1 ano",           daysAfterSurgery: 365, scales: ["IKDC", "Lysholm", "Tegner", "KOOS-12", "VAS Dor"], notes: "Retorno ao esporte; Hop test ≥90% LSI; RX stress varo se indicado" },
    { periodo: "2 anos",          daysAfterSurgery: 730, scales: ["IKDC", "Lysholm", "Tegner", "KOOS-12", "VAS Dor"], notes: "Avaliação definitiva; monitorar instabilidade residual em varo/RE" },
  ],
  PLC: [
    { periodo: "Pré-operatório",  daysAfterSurgery: 0,   scales: ["Lysholm", "IKDC", "Tegner", "KOOS-12"], notes: "CPL = LCL + Tend. Poplíteo + LPF; Recurvatum + RE stress; Dial Test 30° e 90°" },
    { periodo: "30 dias",         daysAfterSurgery: 30,  scales: ["VAS Dor", "Lysholm"], notes: "Clínica: ADM, edema; verificar recurvatum; integridade LCL" },
    { periodo: "90 dias",         daysAfterSurgery: 90,  scales: ["VAS Dor", "Lysholm", "IKDC", "KOOS-12"], notes: "Avaliação funcional inicial; Dial Test pós-op; estabilidade varo" },
    { periodo: "180 dias",        daysAfterSurgery: 180, scales: ["IKDC", "Lysholm", "Tegner", "KOOS-12"], notes: "Decisão de retorno; Varo 0° e 30°; RE stress — LCL + LPF íntegros", critical: true },
    { periodo: "1 ano",           daysAfterSurgery: 365, scales: ["IKDC", "Lysholm", "Tegner", "KOOS-12", "VAS Dor"], notes: "Retorno ao esporte; Hop test ≥90% LSI; RX stress varo se indicado" },
    { periodo: "2 anos",          daysAfterSurgery: 730, scales: ["IKDC", "Lysholm", "Tegner", "KOOS-12", "VAS Dor"], notes: "Avaliação definitiva; monitorar instabilidade residual em varo/RE" },
  ],
  "Lesões Osteocondrais": [
    { periodo: "Pré-operatório",  daysAfterSurgery: 0,   scales: ["IKDC", "KOOS-12", "WOMAC", "VAS Dor", "Tegner"], notes: "ICRS; tamanho; localização; RM pré-op — edema subcondral, estabilidade OCD" },
    { periodo: "6 semanas",       daysAfterSurgery: 42,  scales: ["VAS Dor", "KOOS-12", "WOMAC"], notes: "Carga parcial protegida; edema; ADM; verificar integração inicial" },
    { periodo: "3 meses",         daysAfterSurgery: 90,  scales: ["VAS Dor", "IKDC", "KOOS-12", "WOMAC"], notes: "Progressão de carga; propriocepção; início de corrida leve" },
    { periodo: "6 meses ★",       daysAfterSurgery: 180, scales: ["IKDC", "KOOS-12", "WOMAC", "Tegner", "VAS Dor"], notes: "RM — avaliação MOCART; integração do enxerto; decisão de retorno ao esporte", critical: true },
    { periodo: "1 ano",           daysAfterSurgery: 365, scales: ["IKDC", "KOOS-12", "WOMAC", "Tegner", "VAS Dor"], notes: "Retorno ao esporte completo; RM de controle se indicado" },
    { periodo: "2 anos",          daysAfterSurgery: 730, scales: ["IKDC", "KOOS-12", "WOMAC", "Tegner", "VAS Dor"], notes: "Avaliação definitiva; monitorar progressão de artrose" },
    { periodo: "5 anos",          daysAfterSurgery: 1825, scales: ["IKDC", "KOOS-12", "WOMAC", "Tegner"], notes: "Rastreamento de longo prazo — osteoartrite" },
  ],
  "Artroplastias": [
    { periodo: "Pré-operatório",  daysAfterSurgery: 0,   scales: ["VAS Dor", "WOMAC", "KOOS-12", "Tegner"], notes: "Baseline obrigatório: WOMAC + KOOS + VAS + Tegner. RX AP/Lateral/Axial — Kellgren-Lawrence, alinhamento" },
    { periodo: "7-14 dias",       daysAfterSurgery: 10,  scales: ["VAS Dor"], notes: "Avaliação de cicatriz, drenagem, curativo, anticoagulação" },
    { periodo: "3 semanas",       daysAfterSurgery: 21,  scales: ["VAS Dor"], notes: "ROM precoce, edema, força de quadríceps, marcha com suporte" },
    { periodo: "6 semanas",       daysAfterSurgery: 42,  scales: ["VAS Dor", "WOMAC"], notes: "1ª avaliação formal: RX controle, alinhamento, WOMAC. Início de fortalecimento muscular" },
    { periodo: "3 meses",         daysAfterSurgery: 90,  scales: ["VAS Dor", "WOMAC", "KOOS-12"], notes: "Avaliação funcional: marcha, escadas, ROM. WOMAC + KOOS obrigatórios" },
    { periodo: "6 meses",         daysAfterSurgery: 180, scales: ["VAS Dor", "WOMAC", "KOOS-12", "Tegner"], notes: "RX AP/Lateral/Axial patela. Avaliação intermediária completa" },
    { periodo: "1 ano ★",         daysAfterSurgery: 365, scales: ["VAS Dor", "WOMAC", "KOOS-12", "Tegner"], notes: "Avaliação anual obrigatória: RX série completa. WOMAC + KOOS + KSS + Satisfaction. Registro em banco de dados de implantes", critical: true },
    { periodo: "2 anos",          daysAfterSurgery: 730, scales: ["WOMAC", "KOOS-12"], notes: "Controle de médio prazo: RX bilateral comparativo. Avaliação de sobrevida do implante" },
    { periodo: "Anual (≥3 anos)", daysAfterSurgery: 1095, scales: ["WOMAC", "KOOS-12"], notes: "Seguimento anual de longo prazo. RX a cada 2 anos. Vigilância de soltura asséptica, osteólise" },
  ],
  "Ortobiológicos": [
    { periodo: "Pré-operatório",  daysAfterSurgery: 0,    scales: ["VAS Dor", "WOMAC", "IKDC", "KOOS-12", "Tegner"], notes: "Baseline obrigatório: EVA + WOMAC + IKDC + KOOS + Tegner. RX (AP, Lateral, Axial) — Grau Kellgren-Lawrence" },
    { periodo: "1 mês",           daysAfterSurgery: 30,   scales: ["VAS Dor", "WOMAC"], notes: "Avaliação precoce: resposta analgésica e redução de rigidez" },
    { periodo: "6 semanas",       daysAfterSurgery: 42,   scales: ["VAS Dor", "WOMAC"], notes: "Ponto HA: avaliação de efeito lubrificante (6–12 semanas pico de resposta)" },
    { periodo: "3 meses",         daysAfterSurgery: 90,   scales: ["VAS Dor", "WOMAC", "IKDC"], notes: "Pico de resposta PRP/BMA: avaliar MCID WOMAC ≥12 pontos" },
    { periodo: "6 meses ★",       daysAfterSurgery: 180,  scales: ["VAS Dor", "WOMAC", "IKDC", "KOOS-12", "Tegner"], notes: "Ponto crítico: TODAS as escalas. Critério sucesso: EVA −50% e WOMAC −40% (PRP) | −30% (HA/BMA)", critical: true },
    { periodo: "12 meses",        daysAfterSurgery: 365,  scales: ["VAS Dor", "WOMAC", "IKDC", "KOOS-12", "Tegner"], notes: "TODAS + satisfação. Decisão: reforço, nova injeção ou alternativa cirúrgica" },
    { periodo: "24 meses",        daysAfterSurgery: 730,  scales: ["VAS Dor", "WOMAC", "IKDC", "KOOS-12", "Tegner"], notes: "Avaliação definitiva — durabilidade BMA (resposta 24–48 meses)" },
    { periodo: "4 anos",          daysAfterSurgery: 1460, scales: ["VAS Dor", "WOMAC", "IKDC", "KOOS-12", "Tegner"], notes: "Longo prazo BMA: rastreamento progressão OA + RX comparativo" },
  ],
  "Instabilidade Patelar": [
    { periodo: "Pré-operatório",  daysAfterSurgery: 0,   scales: ["Kujala", "IKDC", "VAS Dor", "Tegner"], notes: "PICS 2.0 pré-op; TT-TG, Dejour, Caton-Deschamps, sinal de apreensão" },
    { periodo: "6 semanas",       daysAfterSurgery: 42,  scales: ["VAS Dor", "Kujala"], notes: "Clínica: ADM, edema, estabilidade patelar; restrição de extensão resistida" },
    { periodo: "90 dias",         daysAfterSurgery: 90,  scales: ["Kujala", "IKDC", "VAS Dor"], notes: "Avaliação funcional; quadríceps ≥60% simetria; propriocepção" },
    { periodo: "180 dias",        daysAfterSurgery: 180, scales: ["Kujala", "IKDC", "Tegner", "VAS Dor"], notes: "Decisão de retorno ao esporte; sinal de apreensão; RX axial patelar", critical: true },
    { periodo: "1 ano",           daysAfterSurgery: 365, scales: ["Kujala", "IKDC", "Tegner", "VAS Dor"], notes: "Retorno completo; avaliação de reluxação; RX axial patelar se indicado" },
    { periodo: "2 anos",          daysAfterSurgery: 730, scales: ["Kujala", "IKDC", "Tegner", "VAS Dor"], notes: "Resultado definitivo; avaliação cartilagem patelofemoral" },
  ],
  "Lesão Meniscal": [
    { periodo: "Pré-operatório",  daysAfterSurgery: 0,   scales: ["Lysholm", "IKDC", "VAS Dor", "Tegner"], notes: "Baseline pré-op: IKDC + Lysholm + EVA. McMurray/Thessaly/Apley. RM — tipo, localização, padrão de lesão" },
    { periodo: "2 semanas",       daysAfterSurgery: 14,  scales: ["VAS Dor"], notes: "Cicatriz, edema, derrame articular, ADM inicial — evitar agachamento profundo" },
    { periodo: "6 semanas",       daysAfterSurgery: 42,  scales: ["VAS Dor", "Lysholm"], notes: "Progressão de carga; quadríceps ≥60% contralateral; clínica meniscal" },
    { periodo: "3 meses ★",       daysAfterSurgery: 90,  scales: ["Lysholm", "IKDC", "VAS Dor", "Tegner"], notes: "Avaliação funcional; retorno a atividades moderadas; teste de agachamento unipodal", critical: true },
    { periodo: "6 meses",         daysAfterSurgery: 180, scales: ["Lysholm", "IKDC", "VAS Dor", "Tegner"], notes: "Decisão de retorno ao esporte; hop test ≥85% LSI; linha articular assintomática" },
    { periodo: "1 ano",           daysAfterSurgery: 365, scales: ["Lysholm", "IKDC", "VAS Dor", "Tegner"], notes: "Resultado final; rastreamento de osteoartrite (especialmente meniscectomia total)" },
    { periodo: "2 anos",          daysAfterSurgery: 730, scales: ["Lysholm", "IKDC", "WOMAC", "VAS Dor"], notes: "Seguimento de longo prazo; vigilância de progressão de artrose" },
  ],
  "_fallback": [
    { periodo: "Pré-operatório",  daysAfterSurgery: 0,   scales: ["VAS Dor", "Lysholm", "IKDC"], notes: "Avaliação baseline pré-operatório" },
    { periodo: "6 semanas",       daysAfterSurgery: 42,  scales: ["VAS Dor", "Lysholm"], notes: "Controle pós-operatório precoce: edema, ADM, cicatriz" },
    { periodo: "3 meses",         daysAfterSurgery: 90,  scales: ["VAS Dor", "Lysholm", "IKDC"], notes: "Avaliação funcional intermediária" },
    { periodo: "6 meses",         daysAfterSurgery: 180, scales: ["VAS Dor", "Lysholm", "IKDC"], notes: "Avaliação de retorno às atividades" },
    { periodo: "1 ano",           daysAfterSurgery: 365, scales: ["Lysholm", "IKDC", "VAS Dor"], notes: "Resultado final de longo prazo" },
  ],
};

export function computeScheduledDate(dataCirurgia: string | null | undefined, daysAfterSurgery: number): string | null {
  if (!dataCirurgia) return null;
  const base = new Date(dataCirurgia);
  if (isNaN(base.getTime())) return null;
  const target = new Date(base);
  target.setDate(target.getDate() + daysAfterSurgery);
  return target.toISOString().slice(0, 10);
}

export function buildNotificationsForSurgery(
  surgeryId: number,
  patientId: number,
  ligamentos: string[],
  dataCirurgia: string | null | undefined,
  tiposProcedimento?: string[]
): { surgeryId: number; patientId: number; periodo: string; daysAfterSurgery: number; scheduledDate: string | null; scales: string[]; notes: string | null; status: string }[] {

  const isFractureSurgery = hasFractureProcedure(tiposProcedimento);
  const seenPeriods = new Set<string>();
  const entries: ReturnType<typeof buildNotificationsForSurgery> = [];

  const TIPO_TO_KEY: Record<string, string> = {
    "Instabilidade Patelar": "Instabilidade Patelar",
    "Lesões Osteocondrais": "Lesões Osteocondrais",
    "Ortobiológicos": "Ortobiológicos",
    "Artroplastias": "Artroplastias",
    "Lesão Meniscal": "Lesão Meniscal",
  };

  const allKeys = [...ligamentos];
  for (const tipo of tiposProcedimento ?? []) {
    const mapped = TIPO_TO_KEY[tipo];
    if (mapped && !allKeys.includes(mapped)) allKeys.push(mapped);
  }

  // If no known key was found, use the generic fallback
  const keysWithSchedule = allKeys.filter(k => FOLLOWUP_SCHEDULES[k]);
  if (keysWithSchedule.length === 0) allKeys.push("_fallback");

  for (const key of allKeys) {
    const schedule = FOLLOWUP_SCHEDULES[key];
    if (!schedule) continue;
    for (const entry of schedule) {
      if (isFractureSurgery && isPreoperativePeriod(entry.periodo)) continue;
      const periodKey = `${entry.periodo}`;
      if (seenPeriods.has(periodKey)) continue;
      seenPeriods.add(periodKey);
      entries.push({
        surgeryId,
        patientId,
        periodo: entry.periodo,
        daysAfterSurgery: entry.daysAfterSurgery,
        scheduledDate: computeScheduledDate(dataCirurgia, entry.daysAfterSurgery),
        scales: entry.scales,
        notes: entry.notes ?? null,
        status: "pending",
      });
    }
  }

  entries.sort((a, b) => a.daysAfterSurgery - b.daysAfterSurgery);
  return entries;
}
