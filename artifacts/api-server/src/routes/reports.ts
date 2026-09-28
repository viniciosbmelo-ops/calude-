import { Router, type IRouter } from "express";
import { db, surgeriesTable, patientsTable, doctorsTable, followupTable, auditLogsTable, pageVisitsTable, appointmentsTable } from "@workspace/db";
import { eq, count, avg, sql, and, ilike, gte, isNotNull, lte } from "drizzle-orm";
import { requireAuth, requireAdmin } from "../middlewares/requireAuth";
import { toInitials } from "../lib/anonymize";
import { describeAccessGeography, type AccessType } from "../lib/accessGeography";
import { serializeDoctor } from "../lib/doctorSerializer";
import { isHiddenFracturePreoperative } from "../lib/followup-schedule";

const router: IRouter = Router();

interface GeographyAggregateRow {
  access_type: AccessType;
  country_code: string | null;
  region_code: string | null;
  visit_count: number | string;
}

function buildGeographyRanking(rows: GeographyAggregateRow[], accessType: AccessType) {
  return rows
    .filter((row) => row.access_type === accessType)
    .map((row) => ({
      ...describeAccessGeography(row.country_code, row.region_code),
      count: Number(row.visit_count),
    }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "pt-BR"));
}

router.get("/reports/dashboard", requireAuth, async (req, res): Promise<void> => {
  const doctorId = req.doctorId!;

  const [{ totalPatients }] = await db
    .select({ totalPatients: count() })
    .from(patientsTable)
    .where(eq(patientsTable.doctorId, doctorId));

  const [{ totalSurgeries }] = await db
    .select({ totalSurgeries: count() })
    .from(surgeriesTable)
    .where(eq(surgeriesTable.doctorId, doctorId));

  const surgeries = await db
    .select()
    .from(surgeriesTable)
    .where(eq(surgeriesTable.doctorId, doctorId));

  // Count by procedure type
  const typeCount: Record<string, number> = {};
  for (const s of surgeries) {
    for (const t of s.tiposProcedimento) {
      typeCount[t] = (typeCount[t] ?? 0) + 1;
    }
  }

  // Count by ligament
  const ligCount: Record<string, number> = {};
  for (const s of surgeries) {
    for (const l of s.ligamentosAcometidos) {
      ligCount[l] = (ligCount[l] ?? 0) + 1;
    }
  }

  // Recent surgeries
  const recentSurgeriesRaw = await db
    .select({
      surgery: surgeriesTable,
      patientNome: patientsTable.nome,
      patientSexo: patientsTable.sexo,
      patientLado: patientsTable.lado,
    })
    .from(surgeriesTable)
    .leftJoin(patientsTable, eq(surgeriesTable.patientId, patientsTable.id))
    .where(eq(surgeriesTable.doctorId, doctorId))
    .orderBy(sql`${surgeriesTable.createdAt} DESC`)
    .limit(5);

  const recentSurgeries = recentSurgeriesRaw.map(({ surgery, patientNome, patientSexo, patientLado }) => ({
    ...surgery,
    createdAt: surgery.createdAt.toISOString(),
    patientNome: patientNome ?? "",
    patientSexo,
    patientLado,
  }));

  // Follow-up stats
  const allFollowups = (await db
    .select({
      ikdc: followupTable.ikdc,
      retornoEsporte: followupTable.retornoEsporte,
      tempo: followupTable.tempo,
      tiposProcedimento: surgeriesTable.tiposProcedimento,
    })
    .from(followupTable)
    .innerJoin(surgeriesTable, eq(followupTable.surgeryId, surgeriesTable.id))
    .where(eq(surgeriesTable.doctorId, doctorId)))
    .filter((followup) => !isHiddenFracturePreoperative(
      followup.tiposProcedimento as string[] | null,
      followup.tempo,
    ));

  const followupsWithIkdc = allFollowups.filter(f => f.ikdc != null);
  const avgIkdc = followupsWithIkdc.length > 0
    ? followupsWithIkdc.reduce((sum, f) => sum + (f.ikdc ?? 0), 0) / followupsWithIkdc.length
    : null;

  const withRetornoData = allFollowups.filter(f => f.retornoEsporte != null);
  const returnToSportRate = withRetornoData.length > 0
    ? withRetornoData.filter(f => f.retornoEsporte === true).length / withRetornoData.length * 100
    : null;

  const followupCompliance = totalSurgeries > 0
    ? (allFollowups.length / (totalSurgeries * 1)) * 100
    : 0;

  res.json({
    totalPatients: Number(totalPatients),
    totalSurgeries: Number(totalSurgeries),
    surgeriesByType: Object.entries(typeCount).map(([tipo, count]) => ({ tipo, count })),
    surgeriesByLigament: Object.entries(ligCount).map(([ligamento, count]) => ({ ligamento, count })),
    recentSurgeries,
    followupCompliance: Math.min(followupCompliance, 100),
    avgIkdc,
    returnToSportRate,
  });
});

router.get("/reports/admin", requireAdmin, async (req, res): Promise<void> => {
  const [{ totalDoctors }] = await db.select({ totalDoctors: count() }).from(doctorsTable);
  const [{ totalPatients }] = await db.select({ totalPatients: count() }).from(patientsTable);
  const [{ totalSurgeries }] = await db.select({ totalSurgeries: count() }).from(surgeriesTable);

  const allSurgeries = await db.select().from(surgeriesTable);

  const typeCount: Record<string, number> = {};
  for (const s of allSurgeries) {
    for (const t of s.tiposProcedimento) {
      typeCount[t] = (typeCount[t] ?? 0) + 1;
    }
  }

  const ligCount: Record<string, number> = {};
  for (const s of allSurgeries) {
    for (const l of s.ligamentosAcometidos) {
      ligCount[l] = (ligCount[l] ?? 0) + 1;
    }
  }

  const allFollowups = (await db
    .select({
      ikdc: followupTable.ikdc,
      lysholm: followupTable.lysholm,
      retornoEsporte: followupTable.retornoEsporte,
      tempo: followupTable.tempo,
      tiposProcedimento: surgeriesTable.tiposProcedimento,
    })
    .from(followupTable)
    .innerJoin(surgeriesTable, eq(followupTable.surgeryId, surgeriesTable.id)))
    .filter((followup) => !isHiddenFracturePreoperative(
      followup.tiposProcedimento as string[] | null,
      followup.tempo,
    ));

  const withIkdc = allFollowups.filter(f => f.ikdc != null);
  const avgIkdc = withIkdc.length > 0
    ? withIkdc.reduce((s, f) => s + (f.ikdc ?? 0), 0) / withIkdc.length
    : null;

  const withLysholm = allFollowups.filter(f => f.lysholm != null);
  const avgLysholm = withLysholm.length > 0
    ? withLysholm.reduce((s, f) => s + (f.lysholm ?? 0), 0) / withLysholm.length
    : null;

  const withRetorno = allFollowups.filter(f => f.retornoEsporte != null);
  const returnToSportRate = withRetorno.length > 0
    ? withRetorno.filter(f => f.retornoEsporte === true).length / withRetorno.length * 100
    : null;

  // Monthly surgeries (last 12 months)
  const monthlyRaw = await db
    .select({
      month: sql<string>`to_char(${surgeriesTable.createdAt}, 'YYYY-MM')`,
      count: count(),
    })
    .from(surgeriesTable)
    .groupBy(sql`to_char(${surgeriesTable.createdAt}, 'YYYY-MM')`)
    .orderBy(sql`to_char(${surgeriesTable.createdAt}, 'YYYY-MM')`);

  const monthlySurgeries = monthlyRaw.map(r => ({ month: r.month, count: Number(r.count) }));

  // Doctor stats
  const doctors = await db.select().from(doctorsTable).orderBy(sql`lower(${doctorsTable.nome}) COLLATE "pt-BR-x-icu"`, doctorsTable.id);

  // Fetch latest subscription status + period end per stripe customer in a single query
  let subByCustomer = new Map<string, { status: string; currentPeriodEnd: number | null }>();
  try {
    const subRows = await db.execute(sql`
      SELECT DISTINCT ON (customer) customer, status, current_period_end
      FROM stripe.subscriptions
      ORDER BY customer, created DESC
    `);
    for (const row of subRows.rows as { customer: string; status: string; current_period_end: number | null }[]) {
      if (row.customer) subByCustomer.set(row.customer, { status: row.status, currentPeriodEnd: row.current_period_end ?? null });
    }
  } catch { /* Stripe not ready */ }

  const doctorStats = await Promise.all(doctors.map(async (doctor) => {
    const [{ pCount }] = await db.select({ pCount: count() }).from(patientsTable).where(eq(patientsTable.doctorId, doctor.id));
    const [{ sCount }] = await db.select({ sCount: count() }).from(surgeriesTable).where(eq(surgeriesTable.doctorId, doctor.id));
    // Last platform activity = newest surgery or patient creation
    const [{ lastSurg }] = await db.select({ lastSurg: sql<string | null>`MAX(${surgeriesTable.createdAt})` }).from(surgeriesTable).where(eq(surgeriesTable.doctorId, doctor.id));
    const [{ lastPat  }] = await db.select({ lastPat:  sql<string | null>`MAX(${patientsTable.createdAt})` }).from(patientsTable).where(eq(patientsTable.doctorId, doctor.id));
    const candidates = [lastSurg, lastPat].filter(Boolean) as string[];
    const lastActivityAt = candidates.length > 0 ? candidates.sort().pop()! : null;

    const doctorData = serializeDoctor(doctor);
    const subInfo = doctorData.stripeCustomerId ? (subByCustomer.get(doctorData.stripeCustomerId) ?? null) : null;
    const subscriptionStatus = subInfo?.status ?? null;
    const subscriptionPeriodEnd = subInfo?.currentPeriodEnd ?? null;
    return {
      ...doctorData,
      createdAt: doctorData.createdAt.toISOString(),
      lastLoginAt: doctorData.lastLoginAt?.toISOString() ?? null,
      totalPatients: Number(pCount),
      totalSurgeries: Number(sCount),
      subscriptionStatus,
      subscriptionPeriodEnd,
      lastActivityAt,
    };
  }));

  // Public pages = home, login, register, forgot-password
  const publicPaths = ["'/'", "'/login'", "'/register'", "'/forgot-password'"];
  const publicPathFilter = sql.raw(`path IN (${publicPaths.join(",")})`);
  const registerFilter   = sql.raw(`path = '/register'`);

  // Page visit stats (all visits)
  const tzToday    = sql`(${pageVisitsTable.createdAt} AT TIME ZONE 'America/Sao_Paulo')::date = (now() AT TIME ZONE 'America/Sao_Paulo')::date`;
  const tzOntem    = sql`(${pageVisitsTable.createdAt} AT TIME ZONE 'America/Sao_Paulo')::date = (now() AT TIME ZONE 'America/Sao_Paulo')::date - interval '1 day'`;
  const tzSemana   = sql`(${pageVisitsTable.createdAt} AT TIME ZONE 'America/Sao_Paulo') >= (now() AT TIME ZONE 'America/Sao_Paulo') - interval '7 days'`;
  const tzMes      = sql`date_trunc('month', ${pageVisitsTable.createdAt} AT TIME ZONE 'America/Sao_Paulo') = date_trunc('month', now() AT TIME ZONE 'America/Sao_Paulo')`;
  const tzAno      = sql`date_trunc('year',  ${pageVisitsTable.createdAt} AT TIME ZONE 'America/Sao_Paulo') = date_trunc('year',  now() AT TIME ZONE 'America/Sao_Paulo')`;

  const [
    [{ visitasHoje }],
    [{ visitasMes }],
    [{ visitasAno }],
    [{ visitasTotal }],
    [{ siteHoje }],
    [{ siteMes }],
    [{ siteAno }],
    [{ siteTotal }],
    [{ cadastroHoje }],
    [{ cadastroOntem }],
    [{ cadastroSemana }],
    [{ cadastroMes }],
    geographyResult,
  ] = await Promise.all([
    db.select({ visitasHoje:  sql<number>`count(*)::int` }).from(pageVisitsTable).where(tzToday),
    db.select({ visitasMes:   sql<number>`count(*)::int` }).from(pageVisitsTable).where(tzMes),
    db.select({ visitasAno:   sql<number>`count(*)::int` }).from(pageVisitsTable).where(tzAno),
    db.select({ visitasTotal: sql<number>`count(*)::int` }).from(pageVisitsTable),
    db.select({ siteHoje:  sql<number>`count(*)::int` }).from(pageVisitsTable).where(and(tzToday, publicPathFilter)),
    db.select({ siteMes:   sql<number>`count(*)::int` }).from(pageVisitsTable).where(and(tzMes,   publicPathFilter)),
    db.select({ siteAno:   sql<number>`count(*)::int` }).from(pageVisitsTable).where(and(tzAno,   publicPathFilter)),
    db.select({ siteTotal: sql<number>`count(*)::int` }).from(pageVisitsTable).where(publicPathFilter),
    // /register page visits
    db.select({ cadastroHoje:   sql<number>`count(*)::int` }).from(pageVisitsTable).where(and(tzToday,  registerFilter)),
    db.select({ cadastroOntem:  sql<number>`count(*)::int` }).from(pageVisitsTable).where(and(tzOntem,  registerFilter)),
    db.select({ cadastroSemana: sql<number>`count(*)::int` }).from(pageVisitsTable).where(and(tzSemana, registerFilter)),
    db.select({ cadastroMes:    sql<number>`count(*)::int` }).from(pageVisitsTable).where(and(tzMes,    registerFilter)),
    db.execute(sql`
      SELECT
        COALESCE(
          ${pageVisitsTable.accessType},
          CASE
            WHEN ${pageVisitsTable.path} IN ('/', '/login', '/register', '/forgot-password') THEN 'site'
            ELSE 'platform'
          END
        ) AS access_type,
        ${pageVisitsTable.countryCode} AS country_code,
        ${pageVisitsTable.regionCode} AS region_code,
        count(*)::int AS visit_count
      FROM ${pageVisitsTable}
      WHERE ${pageVisitsTable.createdAt} >= now() - interval '30 days'
      GROUP BY 1, 2, 3
      ORDER BY visit_count DESC
    `),
  ]);

  const geographyRows = geographyResult.rows as unknown as GeographyAggregateRow[];
  const geographicAccesses = {
    periodDays: 30,
    site: buildGeographyRanking(geographyRows, "site"),
    platform: buildGeographyRanking(geographyRows, "platform"),
  };

  // Access stats from audit logs
  const agora = new Date();
  const inicioDia  = new Date(agora); inicioDia.setHours(0, 0, 0, 0);
  const inicioSemana = new Date(agora); inicioSemana.setDate(agora.getDate() - 7);
  const inicio30dias = new Date(agora); inicio30dias.setDate(agora.getDate() - 30);

  const [
    [{ totalAcessos }],
    [{ acessosHoje }],
    [{ acessosSemana }],
    medicosAtivosRows,
  ] = await Promise.all([
    db.select({ totalAcessos: sql<number>`count(*)::int` }).from(auditLogsTable),
    db.select({ acessosHoje: sql<number>`count(*)::int` }).from(auditLogsTable)
      .where(gte(auditLogsTable.createdAt, inicioDia)),
    db.select({ acessosSemana: sql<number>`count(*)::int` }).from(auditLogsTable)
      .where(gte(auditLogsTable.createdAt, inicioSemana)),
    db.selectDistinct({ doctorId: auditLogsTable.doctorId }).from(auditLogsTable)
      .where(and(gte(auditLogsTable.createdAt, inicio30dias), isNotNull(auditLogsTable.doctorId))),
  ]);

  res.json({
    totalDoctors: Number(totalDoctors),
    totalPatients: Number(totalPatients),
    totalSurgeries: Number(totalSurgeries),
    surgeriesByType: Object.entries(typeCount).map(([tipo, count]) => ({ tipo, count })),
    surgeriesByLigament: Object.entries(ligCount).map(([ligamento, count]) => ({ ligamento, count })),
    avgIkdc,
    avgLysholm,
    returnToSportRate,
    doctorStats,
    monthlySurgeries,
    totalAcessos: Number(totalAcessos),
    acessosHoje: Number(acessosHoje),
    acessosSemana: Number(acessosSemana),
    medicosAtivos30dias: medicosAtivosRows.length,
    visitasHoje: Number(visitasHoje),
    visitasMes: Number(visitasMes),
    visitasAno: Number(visitasAno),
    visitasTotal: Number(visitasTotal),
    siteHoje: Number(siteHoje),
    siteMes: Number(siteMes),
    siteAno: Number(siteAno),
    siteTotal: Number(siteTotal),
    cadastroHoje:   Number(cadastroHoje),
    cadastroOntem:  Number(cadastroOntem),
    cadastroSemana: Number(cadastroSemana),
    cadastroMes:    Number(cadastroMes),
    geographicAccesses,
  });
});

router.get("/reports/followups", requireAuth, async (req, res): Promise<void> => {
  const doctorId = req.doctorId!;
  const isAdmin = req.isAdmin ?? false;

  const q = req.query as Record<string, string | undefined>;
  const {
    ligamentos, tipoCaso, dataInicio, dataFim, medicoId, tempo,
    enxerto, diametroEnxerto, fixacaoFemoral, fixacaoTibial,
    alinhamento, hospital, reforco, procedimento,
    sexo, nivelAtividade, esportePivot, lado,
    beightonMin, beightonMax, idadeMin, idadeMax,
    retornoEsporte, falha,
  } = q;

  const conditions: ReturnType<typeof eq>[] = [];

  if (!isAdmin) {
    conditions.push(eq(surgeriesTable.doctorId, doctorId));
  } else if (medicoId) {
    conditions.push(eq(surgeriesTable.doctorId, parseInt(medicoId)));
  }

  // Surgery filters — multi-ligament OR condition
  if (ligamentos) {
    const ligList = ligamentos.split(",").map(l => l.trim()).filter(Boolean);
    if (ligList.length === 1) {
      conditions.push(sql`${ligList[0]} = ANY(${surgeriesTable.ligamentosAcometidos})` as any);
    } else if (ligList.length > 1) {
      const orParts = ligList.map(l => sql`${l} = ANY(${surgeriesTable.ligamentosAcometidos})`);
      conditions.push(sql`(${sql.join(orParts, sql` OR `)})` as any);
    }
  }
  if (tipoCaso) conditions.push(sql`${tipoCaso} = ANY(${surgeriesTable.tiposProcedimento})` as any);
  if (dataInicio) conditions.push(sql`${surgeriesTable.dataCirurgia} >= ${dataInicio}` as any);
  if (dataFim) conditions.push(sql`${surgeriesTable.dataCirurgia} <= ${dataFim}` as any);
  if (enxerto) conditions.push(ilike(surgeriesTable.enxerto, enxerto));
  if (diametroEnxerto) conditions.push(eq(surgeriesTable.diametroEnxerto, diametroEnxerto));
  if (fixacaoFemoral) conditions.push(eq(surgeriesTable.fixacaoFemoral, fixacaoFemoral));
  if (fixacaoTibial) conditions.push(eq(surgeriesTable.fixacaoTibial, fixacaoTibial));
  if (alinhamento) conditions.push(eq(surgeriesTable.alinhamento, alinhamento));
  if (hospital) conditions.push(sql`LOWER(${surgeriesTable.hospital}) LIKE ${'%' + hospital.toLowerCase() + '%'}` as any);
  if (reforco) {
    // reforco may be stored as JSON {"lal":true,"let":false,"loa":false} (new surgeries)
    // or as free-text (legacy). Map known labels to their JSON key for JSON-stored rows.
    const REFORCO_KEY_MAP: Record<string, string> = {
      'all (ligamento anterolateral)': 'lal',
      'let (ligamento extra-articular tecidual)': 'let',
      'ligamento oblíquo anterior (loa)': 'loa',
    };
    const jsonKey = REFORCO_KEY_MAP[reforco.toLowerCase()];
    if (jsonKey) {
      // Match JSON-stored: {"lal":true} — JSON.stringify never inserts spaces
      // Also fall back to plain-text LIKE for legacy rows
      conditions.push(sql`(${surgeriesTable.reforco}::text LIKE ${'%"' + jsonKey + '":true%'} OR LOWER(${surgeriesTable.reforco}::text) LIKE ${'%' + jsonKey + '%'})` as any);
    } else {
      conditions.push(sql`LOWER(${surgeriesTable.reforco}) LIKE ${'%' + reforco.toLowerCase() + '%'}` as any);
    }
  }
  if (procedimento) conditions.push(sql`LOWER(${surgeriesTable.procedimentoRealizado}) LIKE ${'%' + procedimento.toLowerCase() + '%'}` as any);

  // Patient filters
  if (sexo) conditions.push(eq(patientsTable.sexo, sexo));
  if (nivelAtividade) conditions.push(eq(patientsTable.nivelAtividade, nivelAtividade));
  if (esportePivot !== undefined && esportePivot !== "") {
    conditions.push(eq(patientsTable.esportePivot, esportePivot === "true"));
  }
  if (lado) conditions.push(eq(patientsTable.lado, lado));
  if (beightonMin) conditions.push(sql`${patientsTable.beightonScore} >= ${parseInt(beightonMin)}` as any);
  if (beightonMax) conditions.push(sql`${patientsTable.beightonScore} <= ${parseInt(beightonMax)}` as any);

  // Age filter (dataNascimento stored as text YYYY-MM-DD)
  if (idadeMin) {
    const idadeMinInt = parseInt(idadeMin, 10);
    if (!isNaN(idadeMinInt) && idadeMinInt >= 0 && idadeMinInt <= 120) {
      conditions.push(sql`${patientsTable.dataNascimento} IS NOT NULL AND TO_DATE(${patientsTable.dataNascimento}, 'YYYY-MM-DD') <= (CURRENT_DATE - INTERVAL '${sql.raw(String(idadeMinInt))} years')` as any);
    }
  }
  if (idadeMax) {
    const idadeMaxInt = parseInt(idadeMax, 10);
    if (!isNaN(idadeMaxInt) && idadeMaxInt >= 0 && idadeMaxInt <= 120) {
      conditions.push(sql`${patientsTable.dataNascimento} IS NOT NULL AND TO_DATE(${patientsTable.dataNascimento}, 'YYYY-MM-DD') >= (CURRENT_DATE - INTERVAL '${sql.raw(String(idadeMaxInt))} years')` as any);
    }
  }

  // Follow-up outcome filters
  if (tempo) conditions.push(eq(followupTable.tempo, tempo));
  if (retornoEsporte !== undefined && retornoEsporte !== "") {
    conditions.push(eq(followupTable.retornoEsporte, retornoEsporte === "true"));
  }
  if (falha !== undefined && falha !== "") {
    conditions.push(eq(followupTable.falha, falha === "true"));
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const rows = await db
    .select({
      followupId: followupTable.id,
      followupTempo: followupTable.tempo,
      followupDataAvaliacao: followupTable.dataAvaliacao,
      followupIkdc: followupTable.ikdc,
      followupLysholm: followupTable.lysholm,
      followupTegner: followupTable.tegner,
      followupKujala: followupTable.kujala,
      followupVasDor: followupTable.vasDor,
      followupAclRsi: followupTable.aclRsi,
      followupMarx: followupTable.marx,
      followupKoos12: followupTable.koos12,
      followupRetornoEsporte: followupTable.retornoEsporte,
      followupNivelRetorno: followupTable.nivelRetorno,
      followupFalha: followupTable.falha,
      followupFalhaType: followupTable.falhaType,
      followupObservacoes: followupTable.observacoes,
      followupCreatedAt: followupTable.createdAt,
      surgeryId: surgeriesTable.id,
      dataCirurgia: surgeriesTable.dataCirurgia,
      hospital: surgeriesTable.hospital,
      tiposProcedimento: surgeriesTable.tiposProcedimento,
      ligamentosAcometidos: surgeriesTable.ligamentosAcometidos,
      enxerto: surgeriesTable.enxerto,
      diametroEnxerto: surgeriesTable.diametroEnxerto,
      fixacaoFemoral: surgeriesTable.fixacaoFemoral,
      fixacaoTibial: surgeriesTable.fixacaoTibial,
      alinhamento: surgeriesTable.alinhamento,
      reforco: surgeriesTable.reforco,
      procedimentoRealizado: surgeriesTable.procedimentoRealizado,
      surgeryDoctorId: surgeriesTable.doctorId,
      surgeryCreatedAt: surgeriesTable.createdAt,
      patientNome: patientsTable.nome,
      patientSexo: patientsTable.sexo,
      patientLado: patientsTable.lado,
      patientNivelAtividade: patientsTable.nivelAtividade,
      patientEsportePivot: patientsTable.esportePivot,
      patientBeighton: patientsTable.beightonScore,
      patientDatNasc: patientsTable.dataNascimento,
      doctorNome: doctorsTable.nome,
    })
    .from(surgeriesTable)
    .leftJoin(followupTable, eq(followupTable.surgeryId, surgeriesTable.id))
    .leftJoin(patientsTable, eq(surgeriesTable.patientId, patientsTable.id))
    .leftJoin(doctorsTable, eq(surgeriesTable.doctorId, doctorsTable.id))
    .where(whereClause)
    .orderBy(sql`${surgeriesTable.createdAt} DESC`, sql`${followupTable.createdAt} ASC`);

  const now = new Date();
  const data = rows
    .filter((row) => !isHiddenFracturePreoperative(
      row.tiposProcedimento as string[] | null,
      row.followupTempo,
    ))
    .map(({ patientDatNasc, followupId, followupTempo, followupDataAvaliacao,
    followupIkdc, followupLysholm, followupTegner, followupKujala, followupVasDor,
    followupAclRsi, followupMarx, followupKoos12, followupRetornoEsporte, followupNivelRetorno,
    followupFalha, followupFalhaType, followupObservacoes, followupCreatedAt, surgeryCreatedAt,
    ...rest }) => {
    let idade: number | null = null;
    if (patientDatNasc) {
      const dob = new Date(patientDatNasc);
      if (!isNaN(dob.getTime())) {
        idade = now.getFullYear() - dob.getFullYear();
        const m = now.getMonth() - dob.getMonth();
        if (m < 0 || (m === 0 && now.getDate() < dob.getDate())) idade--;
      }
    }
    return {
      id: followupId ?? null,
      tempo: followupTempo ?? null,
      dataAvaliacao: followupDataAvaliacao ?? null,
      ikdc: followupIkdc ?? null,
      lysholm: followupLysholm ?? null,
      tegner: followupTegner ?? null,
      kujala: followupKujala ?? null,
      vasDor: followupVasDor ?? null,
      aclRsi: followupAclRsi ?? null,
      marx: followupMarx ?? null,
      koos12: followupKoos12 ?? null,
      retornoEsporte: followupRetornoEsporte ?? null,
      nivelRetorno: followupNivelRetorno ?? null,
      falha: followupFalha ?? null,
      falhaType: followupFalhaType ?? null,
      observacoes: followupObservacoes ?? null,
      createdAt: followupCreatedAt?.toISOString() ?? surgeryCreatedAt.toISOString(),
      ...rest,
      idade,
      patientNome: isAdmin ? toInitials(rest.patientNome) : rest.patientNome,
    };
  });

  res.json(data);
});

router.get("/reports/doctors", requireAdmin, async (req, res): Promise<void> => {
  const doctors = await db.select({ id: doctorsTable.id, nome: doctorsTable.nome }).from(doctorsTable).orderBy(sql`lower(${doctorsTable.nome}) COLLATE "pt-BR-x-icu"`, doctorsTable.id);
  res.json(doctors);
});

// ─── Relatório de Consultas ───────────────────────────────────────────────────
router.get("/reports/consultas", requireAuth, async (req, res): Promise<void> => {
  const doctorId = req.doctorId!;
  const { tipo, plano, periodo } = req.query as Record<string, string>;

  // Calcular intervalo de datas pelo período
  const now = new Date();
  let dateFrom: string | null = null;
  let dateTo: string | null = null;

  if (periodo === "dia") {
    dateFrom = now.toISOString().slice(0, 10);
    dateTo = dateFrom;
  } else if (periodo === "semana") {
    const day = now.getDay(); // 0=Dom
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - day);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 6);
    dateFrom = weekStart.toISOString().slice(0, 10);
    dateTo = weekEnd.toISOString().slice(0, 10);
  } else if (periodo === "mes") {
    const y = now.getFullYear();
    const m = now.getMonth() + 1;
    dateFrom = `${y}-${String(m).padStart(2, "0")}-01`;
    const lastDay = new Date(y, m, 0).getDate();
    dateTo = `${y}-${String(m).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  }

  // Buscar agendamentos com plano do paciente
  const conditions = [eq(appointmentsTable.doctorId, doctorId)];
  if (tipo) conditions.push(eq(appointmentsTable.tipo, tipo));
  if (dateFrom) conditions.push(gte(appointmentsTable.data, dateFrom));
  if (dateTo) conditions.push(lte(appointmentsTable.data, dateTo));

  const rows = await db
    .select({
      tipo: appointmentsTable.tipo,
      status: appointmentsTable.status,
      data: appointmentsTable.data,
      planoSaude: patientsTable.planoSaude,
    })
    .from(appointmentsTable)
    .leftJoin(patientsTable, eq(appointmentsTable.patientId, patientsTable.id))
    .where(and(...conditions));

  // Filtrar por plano/particular
  const filteredRows = plano
    ? rows.filter(r =>
        plano === "Particular"
          ? !r.planoSaude || r.planoSaude.trim() === ""
          : r.planoSaude === plano
      )
    : rows;

  // Contagens
  const byTipo: Record<string, number> = {};
  const byPlano: Record<string, number> = {};
  const byStatus: Record<string, number> = {};

  for (const r of filteredRows) {
    byTipo[r.tipo] = (byTipo[r.tipo] ?? 0) + 1;
    const pl = (r.planoSaude && r.planoSaude.trim()) ? r.planoSaude.trim() : "Particular";
    byPlano[pl] = (byPlano[pl] ?? 0) + 1;
    byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
  }

  // Lista de planos disponíveis para o filtro
  const allPlanos = await db
    .select({ plano: patientsTable.planoSaude })
    .from(patientsTable)
    .where(eq(patientsTable.doctorId, doctorId));
  const uniquePlanos = [...new Set(
    allPlanos.map(r => r.plano?.trim()).filter((p): p is string => !!p)
  )].sort();

  res.json({ total: filteredRows.length, byTipo, byPlano, byStatus, planos: uniquePlanos });
});

// ── Ortobiológicos (regen_cases) stats ────────────────────────────────────────
router.get("/reports/regen", requireAuth, async (req, res): Promise<void> => {
  const doctorId = req.doctorId!;
  const { produto, status, dataInicio, dataFim } = req.query as Record<string, string>;

  const params: (string | number)[] = [doctorId];
  let idx = 2;
  const conds: string[] = [`doctor_id = $1`];

  if (status)     { conds.push(`status = $${idx++}`);         params.push(status); }
  if (dataInicio) { conds.push(`data_caso >= $${idx++}`);     params.push(dataInicio); }
  if (dataFim)    { conds.push(`data_caso <= $${idx++}`);     params.push(dataFim); }
  if (produto)    { conds.push(`$${idx++} = ANY(planned_products)`); params.push(produto); }

  const { pool } = await import("@workspace/db");
  const { rows } = await pool.query(
    `SELECT condition_code, condition_custom, status, planned_products
     FROM regen_cases
     WHERE ${conds.join(" AND ")}`,
    params
  );

  const byProduct:   Record<string, number> = {};
  const byStatus:    Record<string, number> = {};
  const byCondition: Record<string, number> = {};

  const STATUS_LABEL: Record<string, string> = { draft: "Rascunho", active: "Ativo", closed: "Fechado" };

  for (const r of rows) {
    const st = STATUS_LABEL[r.status as string] ?? r.status;
    byStatus[st] = (byStatus[st] ?? 0) + 1;
    const cond = (r.condition_custom as string | null)?.trim() || (r.condition_code as string).replace(/_/g, " ");
    byCondition[cond] = (byCondition[cond] ?? 0) + 1;
    for (const prod of (r.planned_products as string[] ?? [])) {
      byProduct[prod] = (byProduct[prod] ?? 0) + 1;
    }
  }

  res.json({ total: rows.length, byProduct, byStatus, byCondition });
});

export default router;
