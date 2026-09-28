/**
 * DocSholder Regenerativa — API routes
 * Schema: regen_* tables (PostgreSQL). Table/column DDL lives in the Drizzle
 * schema (lib/db/src/schema/regen.ts); this module only seeds reference data.
 */
import { Router, type IRouter } from "express";
import { pool } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";
import { z } from "zod/v4";
import { randomUUID } from "crypto";
import { ai } from "@workspace/integrations-gemini-ai";
import PDFDocument from "pdfkit";
import { getBaseUrl } from "../lib/base-url";
import { localeDate, localeForDoctorId, resolveDoctorLocale } from "../lib/locale";
import { message } from "../lib/locale-catalog";
import { regenPeriodForLocale, regenScaleForLocale } from "../lib/regen-labels";
import {
  applicationSitesForProductDetails,
  hasValidApplicationSitesExtension,
  synchronizeApplicationSiteLegacyFields,
} from "../lib/regen-application-sites";

export { regenPeriodForLocale, regenScaleForLocale } from "../lib/regen-labels";

// ─── Regen follow-up schedule ─────────────────────────────────────────────────
// Escalas do joelho (WOMAC, IKDC, KOOS-12, Tegner) retiradas; só dor (VAS)
// até as escalas de ombro/cotovelo serem definidas.
const REGEN_FOLLOWUP_SCHEDULE = [
  { periodo: "Pré-op (Baseline)",  days: 0,    scales: ["VAS Dor"] },
  { periodo: "1 mês",              days: 30,   scales: ["VAS Dor"] },
  { periodo: "6 semanas (HA)",     days: 42,   scales: ["VAS Dor"] },
  { periodo: "3 meses",            days: 90,   scales: ["VAS Dor"] },
  { periodo: "6 meses ★",          days: 180,  scales: ["VAS Dor"] },
  { periodo: "12 meses",           days: 365,  scales: ["VAS Dor"] },
  { periodo: "24 meses",           days: 730,  scales: ["VAS Dor"] },
  { periodo: "4 anos",             days: 1460, scales: ["VAS Dor"] },
];

const router: IRouter = Router();

const ProductDetailsSchema = z.record(z.string(), z.string()).refine(
  hasValidApplicationSitesExtension,
  "locaisAplicacao deve ser um array JSON de objetos com localAplicacao e guia",
);

// ─── Data seeding ─────────────────────────────────────────────────────────────
// NOTE: This routine performs ONLY idempotent data operations (seed INSERTs and
// a one-time backfill). All regen_* tables/columns are now modelled in the
// Drizzle schema (lib/db/src/schema/regen.ts) and created via drizzle-kit push
// (development) or the Publish schema diff (production). Startup/route DDL is
// forbidden on managed PostgreSQL, so no CREATE/ALTER is issued here. If a
// regen_* table is absent the queries below fail loudly (caught by the caller),
// signalling the schema was not applied.
export async function initRegenData() {
  const client = await pool.connect();
  try {
    // Seed products
    await client.query(`
      INSERT INTO regen_products (code, name, category, mechanism) VALUES
        ('PRP',     'PRP — Plasma Rico em Plaquetas',        'plasma',    'Concentrado plaquetário com PDGF, TGF-β, VEGF, IGF-1'),
        ('LP_PRP',  'LP-PRP — PRP Pobre em Leucócitos',      'plasma',    'PRP com leucócitos < 1×10⁶/mL; reduz catabolismo articular'),
        ('LR_PRP',  'LR-PRP — PRP Rico em Leucócitos',       'plasma',    'PRP com leucócitos preservados; efeito antimicrobiano aumentado'),
        ('PRF',     'PRF — Fibrina Rica em Plaquetas',        'plasma',    'Fibrina autóloga com liberação lenta de fatores de crescimento'),
        ('AH',      'Ácido Hialurônico',                     'scaffold',  'Lubrificação sinovial e modulação inflamatória mecânica'),
        ('COLAGENO','Colágeno / Scaffold',                    'scaffold',  'Suporte estrutural extracelular para reparo tecidual'),
        ('BMAC',    'BMA — Concentrado de Medula Óssea',     'celular',   'MSCs + fatores hematopoiéticos aspirados de crista ilíaca'),
        ('MFAT',    'MFAT — Gordura Micro-Fragmentada',      'celular',   'Tecido adiposo com SVF e adipócitos intactos preservados'),
        ('NANOFAT', 'Nanofat',                               'celular',   'Gordura emulsificada com SVF concentrado; sem adipócitos intactos'),
        ('SVF',     'SVF — Fração Vascular Estromal',        'celular',   'Isolamento mecânico do SVF adiposo sem colagenase'),
        ('LISADO',  'Lisado Plaquetário',                    'plasma',    'Lisado de plaquetas para uso tópico ou intra-articular')
      ON CONFLICT (code) DO NOTHING;
    `);

    // One-time backfill: reset implicit false→null for contraindication fields.
    // Uses a migrations table so re-runs on every startup are safe — the UPDATE
    // only fires once and any doctor-confirmed "Ausente" (false) values saved
    // after this migration are preserved on subsequent restarts.
    const { rows: migs } = await client.query(
      `SELECT id FROM regen_schema_migrations WHERE id = 'contraindications-nullable-backfill-v1'`
    );
    if (!migs.length) {
      await client.query(`
        UPDATE regen_cases SET active_infection = NULL WHERE active_infection = false;
        UPDATE regen_cases SET malignancy = NULL WHERE malignancy = false;
        INSERT INTO regen_schema_migrations (id) VALUES ('contraindications-nullable-backfill-v1')
          ON CONFLICT DO NOTHING;
      `);
    }

    // Seed conditions
    await client.query(`
      INSERT INTO regen_conditions (code, name) VALUES
        ('OA_QUADRIL',      'Osteoartrite de Quadril'),
        ('OA_OMBRO',        'Osteoartrose de Ombro'),
        ('TENDINOPATIA_OMBRO', 'Tendinopatia do Manguito Rotador'),
        ('BURSITE_OMBRO',   'Bursite de Ombro'),
        ('LESAO_LABRAL_OMBRO', 'Lesão Labral de Ombro'),
        ('OA_COTOVELO',     'Osteoartrose de Cotovelo'),
        ('TENDINOPATIA_COTOVELO', 'Tendinopatia de Cotovelo'),
        ('OA_TORNOZELO',    'Osteoartrite de Tornozelo'),
        ('OA_PUNHO',        'Osteoartrose de Punho'),
        ('TENDINOPATIA_PUNHO', 'Tendinopatia de Punho e Mão'),
        ('SINDROME_TUNEL_CARPO', 'Síndrome do Túnel do Carpo'),
        ('OA_COLUNA_CERVICAL', 'Osteoartrose Cervical'),
        ('HERNIA_DISCAL_CERVICAL', 'Hérnia Discal Cervical'),
        ('OA_COLUNA_TORACICA', 'Osteoartrose Torácica'),
        ('HERNIA_DISCAL_TORACICA', 'Hérnia Discal Torácica'),
        ('OA_COLUNA_LOMBAR', 'Osteoartrose Lombar'),
        ('HERNIA_DISCAL_LOMBAR', 'Hérnia Discal Lombar'),
        ('CONDRAL_FOCAL',   'Lesão Condral Focal'),
        ('OSTEOCONDRAL',    'Lesão Osteocondral'),
        ('TENDINOPATIA',    'Tendinopatia'),
        ('SINOVITE',        'Sinovite / Sinovite Vilonodular'),
        ('BURSITE',         'Bursite'),
        ('FRATURA_FADIGA',  'Fratura por Fadiga / Estresse'),
        ('POS_OPERATORIO',  'Pós-Operatório / Bioestimulação'),
        ('EPICONDILITE',    'Epicondilite Lateral / Medial'),
        ('FASCITE_PLANTAR', 'Fasciíte Plantar'),
        ('CUSTOM',          'Outra Condição (especificar)')
      ON CONFLICT (code) DO NOTHING;
    `);
  } finally {
    client.release();
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const CURRENT_TERMS_VERSION = "terms_regen_v1";
const CURRENT_DPA_VERSION   = "dpa_regen_v1";

async function hasAcceptedTerms(doctorId: number): Promise<boolean> {
  const { rows } = await pool.query(
    `SELECT id FROM regen_terms_acceptance WHERE doctor_id = $1 AND terms_version = $2 AND dpa_version = $3 LIMIT 1`,
    [doctorId, CURRENT_TERMS_VERSION, CURRENT_DPA_VERSION]
  );
  return rows.length > 0;
}

async function requestMessage(req: any, key: Parameters<typeof message>[1]) {
  return message(await localeForDoctorId(req.doctorId), key);
}

function regenNotificationForLocale(row: any, locale: "pt-BR" | "es") {
  return {
    ...row,
    periodo: regenPeriodForLocale(row.periodo, locale),
    scales: Array.isArray(row.scales)
      ? row.scales.map((scale: unknown) => regenScaleForLocale(scale, locale))
      : row.scales,
    responses: Array.isArray(row.responses)
      ? row.responses.map((response: any) => ({
          ...response,
          nome_escala: regenScaleForLocale(response.nome_escala, locale),
        }))
      : row.responses,
  };
}

export function clinicalReportFollowupHeaders(locale: ReturnType<typeof resolveDoctorLocale>) {
  return [
    message(locale, "period"),
    message(locale, "scale"),
    message(locale, "score"),
    message(locale, "completedOn"),
  ];
}

// ─── Terms ───────────────────────────────────────────────────────────────────

router.get("/regen/terms/status", requireAuth, async (req: any, res) => {
  try {
    const accepted = await hasAcceptedTerms(req.doctorId);
    res.json({ accepted, termsVersion: CURRENT_TERMS_VERSION, dpaVersion: CURRENT_DPA_VERSION });
  } catch (e: any) {
    console.error("[regen/terms/status]", e);
    res.status(500).json({ error: await requestMessage(req, "internalError") });
  }
});

router.post("/regen/terms/accept", requireAuth, async (req: any, res) => {
  try {
    await pool.query(
      `INSERT INTO regen_terms_acceptance (doctor_id, terms_version, dpa_version)
       VALUES ($1, $2, $3)
       ON CONFLICT DO NOTHING`,
      [req.doctorId, CURRENT_TERMS_VERSION, CURRENT_DPA_VERSION],
    );
    res.json({ ok: true });
  } catch (e) {
    console.error("[regen/terms/accept]", e);
    res.status(500).json({ error: await requestMessage(req, "internalError") });
  }
});

// ─── Catalog ─────────────────────────────────────────────────────────────────

router.get("/regen/products", requireAuth, async (req: any, res) => {
  try {
    const { rows } = await pool.query(`SELECT * FROM regen_products WHERE active = true ORDER BY category, name`);
    res.json(rows);
  } catch (e) {
    console.error("[regen/products]", e);
    res.status(500).json({ error: await requestMessage(req, "internalError") });
  }
});

router.get("/regen/conditions", requireAuth, async (req: any, res) => {
  try {
    const { rows } = await pool.query(`SELECT * FROM regen_conditions WHERE active = true ORDER BY name`);
    res.json(rows);
  } catch (e) {
    console.error("[regen/conditions]", e);
    res.status(500).json({ error: await requestMessage(req, "internalError") });
  }
});

// ─── Cases ───────────────────────────────────────────────────────────────────

const CaseBody = z.object({
  patientId:        z.number().optional(),
  patientName:      z.string().min(1),
  patientDob:       z.string().optional(),
  patientSex:       z.string().optional(),
  patientPhone:     z.string().optional(),
  weightKg:         z.number().optional(),
  heightCm:         z.number().optional(),
  conditionCode:    z.string().min(1),
  conditionCustom:  z.string().optional(),
  ladoArticulacao:  z.string().optional(),
  hospitalLocal:    z.string().optional(),
  dataCaso:         z.string().optional(),
  dm:               z.boolean().default(false),
  hba1c:            z.number().optional(),
  anticoagulant:    z.boolean().default(false),
  immunosuppressed: z.boolean().default(false),
  activeInfection:  z.boolean().nullable().optional(),
  malignancy:       z.boolean().nullable().optional(),
  goalVev:          z.array(z.string()).default([]),
  goalCustom:       z.string().optional(),
  priorTreatments:  z.array(z.string()).optional(),
  priorTreatDates:  z.record(z.string(), z.string()).optional(),
  status:           z.enum(["draft", "active", "closed"]).default("draft"),
  anamnese_regen:   z.record(z.string(), z.any()).optional(),
  planoOtimizacao:   z.record(z.string(), z.any()).optional(),
  plannedProducts:   z.array(z.string()).optional(),
  productDetails:    ProductDetailsSchema.optional(),
  coMeds:            z.array(z.object({ name: z.string(), dose: z.string() })).optional(),
  assocProcedures:   z.array(z.string()).optional(),
});

// Separate PATCH schema — avoids .partial() interacting with .default() in Zod v4
const CasePatchBody = z.object({
  patientId:         z.number().optional(),
  patientName:       z.string().min(1).optional(),
  patientDob:        z.string().optional(),
  patientSex:        z.string().optional(),
  patientPhone:      z.string().optional(),
  weightKg:          z.number().optional(),
  heightCm:          z.number().optional(),
  conditionCode:     z.string().min(1).optional(),
  conditionCustom:   z.string().optional(),
  ladoArticulacao:   z.string().optional(),
  hospitalLocal:     z.string().optional(),
  dataCaso:          z.string().optional(),
  dm:                z.boolean().optional(),
  hba1c:             z.number().optional(),
  anticoagulant:     z.boolean().optional(),
  immunosuppressed:  z.boolean().optional(),
  activeInfection:   z.boolean().nullable().optional(),
  malignancy:        z.boolean().nullable().optional(),
  goalVev:           z.array(z.string()).optional(),
  goalCustom:        z.string().optional(),
  priorTreatments:   z.array(z.string()).optional(),
  priorTreatDates:   z.record(z.string(), z.string()).optional(),
  status:            z.enum(["draft", "active", "closed"]).optional(),
  anamnese_regen:    z.record(z.string(), z.any()).optional(),
  planoOtimizacao:   z.record(z.string(), z.any()).optional(),
  plannedProducts:   z.array(z.string()).optional(),
  productDetails:    ProductDetailsSchema.optional(),
  coMeds:            z.array(z.object({ name: z.string(), dose: z.string() })).optional(),
  assocProcedures:   z.array(z.string()).optional(),
}).passthrough(); // allow extra fields from future features

router.get("/regen/cases", requireAuth, async (req: any, res) => {
  try {
    const patientId = req.query.patientId ? parseInt(req.query.patientId as string, 10) : null;
    const { rows } = await pool.query(
      `SELECT c.*,
        (SELECT COUNT(*)::int FROM regen_procedures p WHERE p.case_id = c.id) AS procedure_count
       FROM regen_cases c
       WHERE c.doctor_id = $1${patientId ? " AND c.patient_id = $2" : ""}
       ORDER BY c.created_at DESC`,
      patientId ? [req.doctorId, patientId] : [req.doctorId]
    );
    res.json(rows);
  } catch (e) {
    console.error("[regen/cases GET]", e);
    res.status(500).json({ error: await requestMessage(req, "internalError") });
  }
});

router.post("/regen/cases", requireAuth, async (req: any, res) => {
  const locale = await localeForDoctorId(req.doctorId);
  try {
    const body = CaseBody.parse(req.body);

    // Check terms
    if (!(await hasAcceptedTerms(req.doctorId))) {
      return res.status(403).json({ error: message(locale, "termsNotAccepted") });
    }

    const imc = body.weightKg && body.heightCm
      ? +(body.weightKg / ((body.heightCm / 100) ** 2)).toFixed(2)
      : null;
    const productDetails = body.productDetails
      ? synchronizeApplicationSiteLegacyFields(body.productDetails)
      : undefined;

    const id = randomUUID();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      if (body.patientId !== undefined) {
        const patient = await client.query(
          `SELECT 1 FROM patients WHERE id = $1 AND doctor_id = $2 FOR KEY SHARE`,
          [body.patientId, req.doctorId],
        );
        if (!patient.rowCount) {
          await client.query("ROLLBACK");
          return res.status(404).json({ error: message(locale, "patientNotFound") });
        }
      }

      await client.query(
        `INSERT INTO regen_cases
           (id, doctor_id, patient_id, patient_name, patient_dob, patient_sex,
            patient_phone, weight_kg, height_cm, imc, condition_code, condition_custom,
            lado_articulacao, hospital_local, data_caso,
            dm, hba1c, anticoagulant, immunosuppressed, active_infection, malignancy,
            goal_vev, goal_custom, prior_treatments, prior_treat_dates, status, planned_products,
            product_details, co_meds, assoc_procedures, anamnese_regen)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31)`,
        [
          id, req.doctorId, body.patientId ?? null, body.patientName,
          body.patientDob ?? null, body.patientSex ?? null,
          body.patientPhone ?? null,
          body.weightKg ?? null, body.heightCm ?? null, imc,
          body.conditionCode, body.conditionCustom ?? null,
          body.ladoArticulacao ?? null, body.hospitalLocal ?? null, body.dataCaso ?? null,
          body.dm, body.hba1c ?? null, body.anticoagulant,
          body.immunosuppressed, body.activeInfection ?? null, body.malignancy ?? null,
          body.goalVev, body.goalCustom ?? null,
          body.priorTreatments ?? [],
          JSON.stringify(body.priorTreatDates ?? {}),
          body.status,
          body.plannedProducts ?? [],
          JSON.stringify(productDetails ?? {}),
          JSON.stringify(body.coMeds ?? []),
          body.assocProcedures ?? [],
          JSON.stringify(body.anamnese_regen ?? {}),
        ],
      );
      const { rows } = await client.query(`SELECT * FROM regen_cases WHERE id = $1`, [id]);
      await client.query("COMMIT");
      res.status(201).json(rows[0]);
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  } catch (e: any) {
    if (e?.name === "ZodError") return res.status(400).json({ error: message(locale, "invalidData"), issues: e.issues });
    console.error("[regen/cases POST]", e);
    res.status(500).json({ error: message(locale, "internalError") });
  }
});

router.get("/regen/cases/:id", requireAuth, async (req: any, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM regen_cases WHERE id = $1 AND doctor_id = $2`,
      [req.params.id, req.doctorId]
    );
    if (!rows.length) return res.status(404).json({ error: await requestMessage(req, "caseNotFound") });
    res.json(rows[0]);
  } catch (e) {
    console.error("[regen/cases/:id GET]", e);
    res.status(500).json({ error: await requestMessage(req, "internalError") });
  }
});

router.patch("/regen/cases/:id", requireAuth, async (req: any, res) => {
  try {
    const body = CasePatchBody.parse(req.body);
    const { rows: existing } = await pool.query(
      `SELECT id FROM regen_cases WHERE id = $1 AND doctor_id = $2`,
      [req.params.id, req.doctorId]
    );
    if (!existing.length) return res.status(404).json({ error: await requestMessage(req, "caseNotFound") });

    const fields: string[] = [];
    const vals: unknown[] = [];
    let idx = 1;
    const map: Record<string, string> = {
      patientName: "patient_name", patientDob: "patient_dob", patientSex: "patient_sex",
      patientPhone: "patient_phone",
      weightKg: "weight_kg", heightCm: "height_cm", conditionCode: "condition_code",
      conditionCustom: "condition_custom", dm: "dm", hba1c: "hba1c",
      anticoagulant: "anticoagulant", immunosuppressed: "immunosuppressed",
      activeInfection: "active_infection", malignancy: "malignancy",
      goalVev: "goal_vev", goalCustom: "goal_custom", status: "status",
      priorTreatments:  "prior_treatments",
      plannedProducts:  "planned_products",
      ladoArticulacao:  "lado_articulacao",
      hospitalLocal:    "hospital_local",
      dataCaso:         "data_caso",
    };
    for (const [k, col] of Object.entries(map)) {
      if ((body as any)[k] !== undefined) {
        fields.push(`${col} = $${idx++}`);
        vals.push((body as any)[k]);
      }
    }
    // JSONB fields — explicit cast
    if (body.priorTreatDates !== undefined) {
      fields.push(`prior_treat_dates = $${idx++}::jsonb`);
      vals.push(JSON.stringify(body.priorTreatDates));
    }
    if (body.anamnese_regen !== undefined) {
      fields.push(`anamnese_regen = $${idx++}::jsonb`);
      vals.push(JSON.stringify(body.anamnese_regen));
    }
    if (body.planoOtimizacao !== undefined) {
      fields.push(`plano_otimizacao = $${idx++}::jsonb`);
      vals.push(JSON.stringify(body.planoOtimizacao));
    }
    if (body.productDetails !== undefined) {
      fields.push(`product_details = $${idx++}::jsonb`);
      vals.push(JSON.stringify(synchronizeApplicationSiteLegacyFields(body.productDetails)));
    }
    if (body.coMeds !== undefined) {
      fields.push(`co_meds = $${idx++}::jsonb`);
      vals.push(JSON.stringify(body.coMeds));
    }
    if ((body as any).assocProcedures !== undefined) {
      fields.push(`assoc_procedures = $${idx++}`);
      vals.push((body as any).assocProcedures);
    }
    if (!fields.length) return res.json({ ok: true });
    fields.push(`updated_at = now()`);
    vals.push(req.params.id, req.doctorId);
    await pool.query(
      `UPDATE regen_cases SET ${fields.join(", ")} WHERE id = $${idx++} AND doctor_id = $${idx}`,
      vals
    );
    const { rows } = await pool.query(`SELECT * FROM regen_cases WHERE id = $1`, [req.params.id]);
    res.json(rows[0]);
  } catch (e: any) {
    if (e?.name === "ZodError") return res.status(400).json({ error: await requestMessage(req, "invalidData") });
    console.error("[regen/cases/:id PATCH]", e);
    res.status(500).json({ error: await requestMessage(req, "internalError") });
  }
});

router.delete("/regen/cases/:id", requireAuth, async (req: any, res) => {
  try {
    const { rowCount } = await pool.query(
      `DELETE FROM regen_cases WHERE id = $1 AND doctor_id = $2`,
      [req.params.id, req.doctorId]
    );
    if (!rowCount) return res.status(404).json({ error: await requestMessage(req, "caseNotFound") });
    res.json({ ok: true });
  } catch (e) {
    console.error("[regen/cases/:id DELETE]", e);
    res.status(500).json({ error: await requestMessage(req, "internalError") });
  }
});

// ─── Procedures ──────────────────────────────────────────────────────────────

const ProcedureBody = z.object({
  productCode:       z.string().min(1),
  guidanceMode:      z.string().default("ultrassom"),
  accessRoute:       z.string().optional(),
  localAnesthesia:   z.boolean().default(false),
  anesthesiaAgent:   z.string().optional(),
  adverseEvent:      z.boolean().default(false),
  adverseEventDesc:  z.string().optional(),
  notes:             z.string().optional(),
  performedAt:       z.string().optional(),
  complianceResult:  z.record(z.string(), z.unknown()).optional(),
  biologicDetails:   z.record(z.string(), z.unknown()).optional(),
});

router.get("/regen/cases/:caseId/procedures", requireAuth, async (req: any, res) => {
  try {
    const { rows: c } = await pool.query(
      `SELECT id FROM regen_cases WHERE id = $1 AND doctor_id = $2`,
      [req.params.caseId, req.doctorId]
    );
    if (!c.length) return res.status(404).json({ error: await requestMessage(req, "caseNotFound") });
    const { rows } = await pool.query(
      `SELECT * FROM regen_procedures WHERE case_id = $1 ORDER BY performed_at DESC`,
      [req.params.caseId]
    );
    res.json(rows);
  } catch (e) {
    console.error("[regen/procedures GET]", e);
    res.status(500).json({ error: await requestMessage(req, "internalError") });
  }
});

router.post("/regen/cases/:caseId/procedures", requireAuth, async (req: any, res) => {
  try {
    const { rows: c } = await pool.query(
      `SELECT id FROM regen_cases WHERE id = $1 AND doctor_id = $2`,
      [req.params.caseId, req.doctorId]
    );
    if (!c.length) return res.status(404).json({ error: await requestMessage(req, "caseNotFound") });

    const body = ProcedureBody.parse(req.body);
    const id = randomUUID();
    await pool.query(
      `INSERT INTO regen_procedures
         (id, case_id, doctor_id, product_code, guidance_mode,
          access_route, local_anesthesia, anesthesia_agent,
          adverse_event, adverse_event_desc,
          notes, performed_at, compliance_result, biologic_details)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [
        id, req.params.caseId, req.doctorId, body.productCode, body.guidanceMode,
        body.accessRoute ?? null, body.localAnesthesia, body.anesthesiaAgent ?? null,
        body.adverseEvent, body.adverseEventDesc ?? null, body.notes ?? null,
        body.performedAt ? new Date(body.performedAt) : new Date(),
        JSON.stringify(body.complianceResult ?? {}),
        JSON.stringify(body.biologicDetails ?? {}),
      ]
    );
    const { rows } = await pool.query(`SELECT * FROM regen_procedures WHERE id = $1`, [id]);
    res.status(201).json(rows[0]);
  } catch (e: any) {
    if (e?.name === "ZodError") return res.status(400).json({ error: await requestMessage(req, "invalidData"), issues: e.issues });
    console.error("[regen/procedures POST]", e);
    res.status(500).json({ error: await requestMessage(req, "internalError") });
  }
});

// ─── PROMs ───────────────────────────────────────────────────────────────────

router.get("/regen/cases/:caseId/proms", requireAuth, async (req: any, res) => {
  try {
    const { rows: c } = await pool.query(
      `SELECT id FROM regen_cases WHERE id = $1 AND doctor_id = $2`,
      [req.params.caseId, req.doctorId]
    );
    if (!c.length) return res.status(404).json({ error: await requestMessage(req, "caseNotFound") });
    const { rows } = await pool.query(
      `SELECT * FROM regen_prom_responses WHERE case_id = $1 ORDER BY answered_at DESC`,
      [req.params.caseId]
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: await requestMessage(req, "internalError") });
  }
});

router.post("/regen/cases/:caseId/proms", requireAuth, async (req: any, res) => {
  try {
    const { rows: c } = await pool.query(
      `SELECT id FROM regen_cases WHERE id = $1 AND doctor_id = $2`,
      [req.params.caseId, req.doctorId]
    );
    if (!c.length) return res.status(404).json({ error: await requestMessage(req, "caseNotFound") });

    const { instrument, timepoint, answers, score } = req.body;
    if (!instrument || !timepoint || !answers) return res.status(400).json({ error: await requestMessage(req, "requiredFieldsMissing") });

    const { rows } = await pool.query(
      `INSERT INTO regen_prom_responses (case_id, instrument, timepoint, answers, score)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [req.params.caseId, instrument, timepoint, JSON.stringify(answers), score ?? null]
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    console.error("[regen/proms POST]", e);
    res.status(500).json({ error: await requestMessage(req, "internalError") });
  }
});

// ─── Labs ────────────────────────────────────────────────────────────────────

router.get("/regen/cases/:caseId/labs", requireAuth, async (req: any, res) => {
  try {
    const { rows: c } = await pool.query(
      `SELECT id FROM regen_cases WHERE id = $1 AND doctor_id = $2`,
      [req.params.caseId, req.doctorId]
    );
    if (!c.length) return res.status(404).json({ error: await requestMessage(req, "caseNotFound") });
    const { rows } = await pool.query(
      `SELECT * FROM regen_lab_results WHERE case_id = $1 ORDER BY analyte`,
      [req.params.caseId]
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: await requestMessage(req, "internalError") });
  }
});

router.post("/regen/cases/:caseId/labs", requireAuth, async (req: any, res) => {
  try {
    const { rows: c } = await pool.query(
      `SELECT id FROM regen_cases WHERE id = $1 AND doctor_id = $2`,
      [req.params.caseId, req.doctorId]
    );
    if (!c.length) return res.status(404).json({ error: await requestMessage(req, "caseNotFound") });

    const results: any[] = req.body.results ?? [];
    if (!Array.isArray(results) || !results.length) return res.status(400).json({ error: await requestMessage(req, "labResultsRequired") });

    const inserted = [];
    for (const r of results) {
      const { rows } = await pool.query(
        `INSERT INTO regen_lab_results
           (case_id, analyte, value_num, unit, ref_min, ref_max, flag, collected_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [
          req.params.caseId, r.analyte, r.value ?? null, r.unit ?? null,
          r.refMin ?? null, r.refMax ?? null, r.flag ?? null,
          r.collectedAt ? new Date(r.collectedAt) : null,
        ]
      );
      inserted.push(rows[0]);
    }
    res.status(201).json(inserted);
  } catch (e) {
    console.error("[regen/labs POST]", e);
    res.status(500).json({ error: await requestMessage(req, "internalError") });
  }
});

router.delete("/regen/cases/:caseId/labs/:labId", requireAuth, async (req: any, res) => {
  try {
    const { rows: c } = await pool.query(
      `SELECT id FROM regen_cases WHERE id = $1 AND doctor_id = $2`,
      [req.params.caseId, req.doctorId]
    );
    if (!c.length) return res.status(404).json({ error: await requestMessage(req, "caseNotFound") });
    const { rowCount } = await pool.query(
      `DELETE FROM regen_lab_results WHERE id = $1 AND case_id = $2`,
      [req.params.labId, req.params.caseId]
    );
    if (!rowCount) return res.status(404).json({ error: await requestMessage(req, "labNotFound") });
    res.status(204).end();
  } catch (e) {
    res.status(500).json({ error: await requestMessage(req, "internalError") });
  }
});

// ─── Stats (Module 11 — Dashboard) ───────────────────────────────────────────

router.get("/regen/stats", requireAuth, async (req: any, res) => {
  try {
    const did = req.doctorId;
    const [cases, procs, products, complications, promAvg] = await Promise.all([
      pool.query(
        `SELECT
          COUNT(*)::int AS total_cases,
          COUNT(*) FILTER (WHERE status = 'active')::int AS active_cases,
          COUNT(*) FILTER (WHERE status = 'closed')::int AS closed_cases,
          COUNT(*) FILTER (WHERE created_at >= now() - interval '30 days')::int AS cases_last_30d
         FROM regen_cases WHERE doctor_id = $1`, [did]),
      pool.query(
        `SELECT COUNT(*)::int AS procedures_this_month
         FROM regen_procedures p JOIN regen_cases c ON c.id = p.case_id
         WHERE c.doctor_id = $1 AND p.performed_at >= date_trunc('month', now())`, [did]),
      pool.query(
        `SELECT
          COUNT(*) FILTER (WHERE p.product_code = 'PRP')::int  AS prp_count,
          COUNT(*) FILTER (WHERE p.product_code = 'LP_PRP')::int AS lp_prp_count,
          COUNT(*) FILTER (WHERE p.product_code = 'LR_PRP')::int AS lr_prp_count,
          COUNT(*) FILTER (WHERE p.product_code = 'BMAC')::int  AS bmac_count,
          COUNT(*) FILTER (WHERE p.product_code = 'MFAT')::int  AS mfat_count,
          COUNT(*) FILTER (WHERE p.product_code = 'AH' OR p.product_code = 'COLAGENO')::int AS ha_count,
          COUNT(*)::int AS total_procedures
         FROM regen_procedures p JOIN regen_cases c ON c.id = p.case_id
         WHERE c.doctor_id = $1`, [did]),
      pool.query(
        `SELECT COUNT(*)::int AS complications_count
         FROM regen_procedures p JOIN regen_cases c ON c.id = p.case_id
         WHERE c.doctor_id = $1 AND p.adverse_event = true`, [did]),
      pool.query(
        `SELECT
          instrument,
          ROUND(AVG(score)::numeric, 1) AS avg_score
         FROM regen_prom_responses r
         JOIN regen_cases c ON c.id = r.case_id
         WHERE c.doctor_id = $1
         GROUP BY instrument`, [did]),
    ]);

    const promMap: Record<string, number> = {};
    for (const r of promAvg.rows) promMap[r.instrument] = parseFloat(r.avg_score);

    res.json({
      ...cases.rows[0],
      ...procs.rows[0],
      ...products.rows[0],
      ...complications.rows[0],
      avg_vas:  promMap["VAS"]  ?? null,
    });
  } catch (e) {
    console.error("[regen/stats]", e);
    res.status(500).json({ error: await requestMessage(req, "internalError") });
  }
});

// ─── AI Clinical Summary (Module 10) ─────────────────────────────────────────

router.post("/regen/cases/:id/ai-summary", requireAuth, async (req: any, res) => {
  try {
    const { rows: c } = await pool.query(
      `SELECT * FROM regen_cases WHERE id = $1 AND doctor_id = $2`,
      [req.params.id, req.doctorId]
    );
    if (!c.length) return res.status(404).json({ error: await requestMessage(req, "caseNotFound") });
    const caso = c[0];

    const [procRows, promRows, labRows] = await Promise.all([
      pool.query(`SELECT * FROM regen_procedures WHERE case_id = $1 ORDER BY performed_at`, [req.params.id]),
      pool.query(`SELECT * FROM regen_prom_responses WHERE case_id = $1 ORDER BY answered_at`, [req.params.id]),
      pool.query(`SELECT * FROM regen_lab_results WHERE case_id = $1 ORDER BY analyte`, [req.params.id]),
    ]);

    const promsText = promRows.rows.map(p =>
      `${p.instrument} (${p.timepoint}): score ${p.score ?? "não informado"}`
    ).join("\n");
    const procsText = procRows.rows.map(p =>
      `${new Date(p.performed_at).toLocaleDateString("pt-BR")}: ${p.product_code}${p.volume_ml ? ` ${p.volume_ml}mL` : ""}${p.adverse_event ? " [EVENTO ADVERSO: " + p.adverse_event_desc + "]" : ""}`
    ).join("\n");
    const labsText = labRows.rows.slice(0, 20).map(l =>
      `${l.analyte}: ${l.value_num} ${l.unit ?? ""}${l.flag ? " [" + l.flag + "]" : ""}`
    ).join("\n");

    const prompt = `Você é um assistente clínico especializado em medicina regenerativa ortopédica.
Gere um resumo clínico narrativo em português brasileiro (2-4 parágrafos) sobre a evolução do paciente abaixo.
Seja objetivo, clínico, e destaque mudanças relevantes nos PROMs e na evolução clínica.
Finalize com uma conclusão sobre o status atual.

DADOS DO CASO:
- Paciente: ${caso.patient_name} | Sexo: ${caso.patient_sex ?? "NI"} | Nascimento: ${caso.patient_dob ? new Date(caso.patient_dob).toLocaleDateString("pt-BR") : "NI"}
- IMC: ${caso.imc ?? "NI"} | Condição: ${caso.condition_code.replace(/_/g, " ")}${caso.condition_custom ? " — " + caso.condition_custom : ""}
- Diabetes: ${caso.dm ? "Sim" + (caso.hba1c ? " (HbA1c " + caso.hba1c + "%)" : "") : "Não"} | Anticoagulante: ${caso.anticoagulant ? "Sim" : "Não"}
- Objetivos: ${caso.goal_vev?.join(", ") ?? "não definidos"}

PROCEDIMENTOS:
${procsText || "Nenhum registrado"}

PROMS (instrumentos de resultado):
${promsText || "Nenhum registrado"}

EXAMES LABORATORIAIS RELEVANTES:
${labsText || "Nenhum registrado"}

Gere apenas o texto clínico narrativo, sem títulos ou marcadores.`;

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [{ role: "user", parts: [{ text: prompt }] }],
    });
    const summary = response.candidates?.[0]?.content?.parts?.[0]?.text ?? "Não foi possível gerar o resumo.";

    // Save interaction
    await pool.query(
      `INSERT INTO regen_ai_interactions (case_id, doctor_id, model, raw_output, accepted_output)
       VALUES ($1, $2, $3, $4, $4)`,
      [req.params.id, req.doctorId, "gemini-2.5-flash", JSON.stringify({ summary })]
    );

    res.json({ summary });
  } catch (e) {
    console.error("[regen/ai-summary]", e);
    res.status(500).json({ error: await requestMessage(req, "aiSummaryGenerationFailed") });
  }
});

// ─── Research DB — anonymized (Module 12) ────────────────────────────────────

router.get("/regen/research", requireAuth, async (req: any, res) => {
  try {
    const { sex, condition, procedure, format,
            age_min, age_max, imc_min, imc_max } = req.query as Record<string, string>;

    const wheres: string[] = ["c.doctor_id = $1"];
    const params: any[] = [req.doctorId];
    let idx = 2;

    if (sex)       { wheres.push(`c.patient_sex = $${idx++}`);  params.push(sex); }
    if (condition) { wheres.push(`c.condition_code ILIKE $${idx++}`); params.push("%" + condition + "%"); }
    if (imc_min)   { wheres.push(`c.imc >= $${idx++}`);  params.push(parseFloat(imc_min)); }
    if (imc_max)   { wheres.push(`c.imc <= $${idx++}`);  params.push(parseFloat(imc_max)); }
    if (age_min)   { wheres.push(`EXTRACT(YEAR FROM AGE(c.patient_dob)) >= $${idx++}`); params.push(parseInt(age_min)); }
    if (age_max)   { wheres.push(`EXTRACT(YEAR FROM AGE(c.patient_dob)) <= $${idx++}`); params.push(parseInt(age_max)); }

    let procJoin = "";
    if (procedure) {
      procJoin = `JOIN (SELECT DISTINCT case_id FROM regen_procedures WHERE product_code = $${idx++}) proc_filter ON proc_filter.case_id = c.id`;
      params.push(procedure);
    }

    const sql = `
      SELECT
        c.id,
        EXTRACT(YEAR FROM AGE(c.patient_dob))::int AS age,
        c.patient_sex AS sex,
        ROUND(c.imc::numeric, 1) AS imc,
        c.condition_code AS condition,
        c.status,
        (SELECT COUNT(*)::int FROM regen_procedures p WHERE p.case_id = c.id) AS procedure_count,
        (SELECT COUNT(*)::int FROM regen_procedures p WHERE p.case_id = c.id AND p.adverse_event = true) AS adverse_events,
        (SELECT ROUND(AVG(pr.score)::numeric,1) FROM regen_prom_responses pr WHERE pr.case_id = c.id AND pr.instrument = 'VAS') AS avg_vas,
        c.dm, c.imc AS bmi, c.goal_vev,
        c.created_at
      FROM regen_cases c
      ${procJoin}
      WHERE ${wheres.join(" AND ")}
      ORDER BY c.created_at DESC
      LIMIT 500`;

    const { rows } = await pool.query(sql, params);

    if (format === "csv") {
      const cols = ["id","age","sex","imc","condition","status","procedure_count",
                    "adverse_events","avg_vas","dm","created_at"];
      const header = cols.join(",");
      const lines  = rows.map(r => cols.map(c => {
        const v = r[c];
        if (v === null || v === undefined) return "";
        const s = String(v);
        return s.includes(",") ? `"${s}"` : s;
      }).join(","));
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", `attachment; filename="regen-research-${Date.now()}.csv"`);
      return res.send([header, ...lines].join("\r\n"));
    }

    res.json(rows);
  } catch (e) {
    console.error("[regen/research]", e);
    res.status(500).json({ error: await requestMessage(req, "internalError") });
  }
});

// ─── Consent PDF (Consentimento Inteligente) ─────────────────────────────────

const CONSENT_TEXTS: Record<string, { title: string; items: string[] }> = {
  PRP: {
    title: "Plasma Rico em Plaquetas (PRP)",
    items: [
      "Procedimento autólogo que utiliza concentrado plaquetário obtido do próprio sangue do paciente.",
      "Riscos incluem: dor local transitória, hematoma, infecção (raro < 0,1%), reação inflamatória.",
      "Resultados variam individualmente; não há garantia de eficácia em todos os casos.",
      "O paciente deverá evitar AINEs por 7 dias antes e 14 dias após o procedimento.",
    ],
  },
  BMAC: {
    title: "Concentrado de Medula Óssea (BMA)",
    items: [
      "Procedimento autólogo que envolve aspiração de medula óssea, geralmente da crista ilíaca.",
      "Riscos: dor no sítio de aspiração, hematoma, infecção (raro), fratura de stress (muito raro).",
      "A aspiração é realizada sob anestesia local e/ou sedação leve.",
      "Período de restrição de atividade física conforme orientação médica.",
    ],
  },
  MFAT: {
    title: "Gordura Micro-Fragmentada (MFAT)",
    items: [
      "Procedimento autólogo que envolve coleta de gordura subcutânea por mini-lipoaspiração.",
      "Riscos: dor no sítio doador, hematoma, seroma, irregularidade estética local, infecção (raro).",
      "O tecido adiposo é processado mecanicamente e injetado na região alvo.",
      "Evitar atividade de alto impacto por período a ser definido pelo médico.",
    ],
  },
  AH: {
    title: "Ácido Hialurônico (AH)",
    items: [
      "Viscossuplementação com ácido hialurônico de origem não biológica ou biofermentada.",
      "Riscos: dor e edema transitórios, pseudossepse (reação local aguda), infecção (raro < 0,05%).",
      "Pacientes com alergia a proteínas aviárias (para produtos de origem animal) devem informar.",
      "Efeito esperado entre 4 e 12 semanas após aplicação.",
    ],
  },
  RADIOFREQUENCIA: {
    title: "Radiofrequência (Neurotomia/Ablação)",
    items: [
      "Procedimento minimamente invasivo guiado por fluoroscopia ou ultrassom.",
      "Riscos: dor temporária, disestesia local, neurite, infecção (raro), queimadura de pele (raro).",
      "O alívio da dor pode ser temporário; re-inervação pode ocorrer em 6–18 meses.",
      "Procedimento realizado em ambiente cirúrgico com monitorização adequada.",
    ],
  },
  BLOQUEIOS: {
    title: "Bloqueios Anestésicos / Corticoide",
    items: [
      "Injeção de anestésico local com ou sem corticoide no espaço articular ou periarticular.",
      "Riscos: dor local transitória, hiperglicemia (diabéticos), atrofia cutânea, infecção (raro).",
      "Limite recomendado: até 3 infiltrações de corticoide por articulação por ano.",
      "Não suspender anticoagulante sem orientação do médico prescritor.",
    ],
  },
  HIDROGEL: {
    title: "Hidrogel (Scaffold Polimérico)",
    items: [
      "Dispositivo médico sintético ou biossintético com propriedades biomecânicas de suporte.",
      "Riscos: reação ao corpo estranho, inflamação local, infecção (raro).",
      "Uso off-label pode aplicar-se a alguns produtos; informar sobre regulamentação vigente.",
      "Seguir protocolo específico de reabilitação conforme instrução médica.",
    ],
  },
  PRF: {
    title: "Fibrina Rica em Plaquetas (PRF)",
    items: [
      "Procedimento autólogo que utiliza fibrina e plaquetas concentradas obtidas do próprio sangue do paciente, sem adição de anticoagulantes ou trombina exógena.",
      "Riscos incluem: dor e edema local transitórios, hematoma no sítio de coleta, reação inflamatória, infecção (muito raro < 0,05%).",
      "O coágulo/membrana de PRF é obtido por centrifugação imediata e aplicado de forma cirúrgica ou injetável; sem conservantes ou aditivos químicos.",
      "O paciente deverá evitar AINEs por 7 dias antes e 14 dias após o procedimento para não comprometer a ativação plaquetária.",
      "Resultados dependem da qualidade do sangue do paciente e variam individualmente; não há garantia universal de eficácia.",
    ],
  },
  COLAGENO: {
    title: "Colágeno / Scaffold Biológico",
    items: [
      "Produto de origem biológica (colágeno bovino, suíno ou humano) ou biossintética utilizado como arcabouço tridimensional para suporte celular e regeneração tecidual.",
      "Riscos: reação de hipersensibilidade ao colágeno heterólogo (até 3%), inflamação local, reabsorção incompleta, infecção (raro).",
      "Pacientes com alergia a proteínas animais devem informar o médico antes do procedimento; teste cutâneo pode ser indicado.",
      "O scaffold pode ser implantado cirurgicamente ou aplicado de forma minimamente invasiva conforme a formulação utilizada.",
      "Seguir protocolo de reabilitação específico para permitir integração tecidual adequada; período de restrição definido pelo médico.",
    ],
  },
  SVF: {
    title: "Fração Vascular Estromal (SVF)",
    items: [
      "Procedimento autólogo que envolve coleta de tecido adiposo por mini-lipoaspiração, seguida de processamento enzimático ou mecânico para isolamento da fração celular estromal.",
      "Riscos no sítio doador: dor, hematoma, seroma, irregularidade estética, infecção (raro). Riscos no sítio receptor: inflamação, dor pós-procedimento, infecção (raro).",
      "A SVF contém células-tronco mesenquimais, células endoteliais e pericitos com potencial parácrino; não constitui terapia celular aprovada de forma universal — informar regulamentação vigente.",
      "Evitar AINEs e corticoides sistêmicos por pelo menos 7 dias antes do procedimento para preservar viabilidade celular.",
      "Atividade física de alto impacto deve ser restrita por período a ser definido pelo médico após avaliação individual.",
    ],
  },
  LISADO: {
    title: "Lisado Plaquetário",
    items: [
      "Produto biológico obtido por ciclos repetidos de congelamento e descongelamento de concentrado plaquetário, liberando fatores de crescimento em alta concentração.",
      "Pode ser de origem autóloga (mesmo paciente) ou alogênica (pool de doadores testados); o médico informará a origem utilizada.",
      "Riscos: reação inflamatória local, dor transitória no sítio de aplicação, transmissão de agentes infecciosos (muito raro em produtos alogênicos submetidos a rastreio).",
      "Pacientes com coagulopatias ou em uso de anticoagulantes devem informar o médico; ajuste de protocolo pode ser necessário.",
      "Resultados dependem da concentração de fatores de crescimento e da capacidade de resposta individual do tecido-alvo.",
    ],
  },
  NANOFAT: {
    title: "Nanofat (Lipogems / Gordura Nanofragmentada)",
    items: [
      "Procedimento autólogo que utiliza gordura subcutânea processada mecanicamente até fragmentos nanométricos, preservando a matriz extracelular e células estromais viáveis.",
      "Riscos no sítio doador: dor, hematoma, seroma, irregularidade local, infecção (raro). Riscos no sítio receptor: edema, eritema, nodulação transitória, infecção (raro).",
      "O Nanofat é injetável por agulhas finas (22–25G) em tecidos que não aceitam enxertos maiores, como pele, tendões e mucosas.",
      "Evitar atividade física intensa e exposição solar na área tratada por período definido pelo médico.",
      "Resultados estéticos e funcionais variam conforme o sítio tratado e a resposta biológica individual; múltiplas sessões podem ser necessárias.",
    ],
  },
};

type ConsentContent = { title: string; items: string[] };

// These are deliberately keyed by the persisted product code. Only the first
// two declaration products have locale-specific clinical copy at this time.
const LOCALIZED_CONSENT_TEXTS: Partial<Record<string, Record<"pt-BR" | "es", ConsentContent>>> = {
  PRP: {
    "pt-BR": CONSENT_TEXTS.PRP,
    es: {
      title: "Plasma rico en plaquetas (PRP)",
      items: [
        "Procedimiento autólogo que utiliza concentrado plaquetario obtenido de la propia sangre del paciente.",
        "Los riesgos incluyen dolor local transitorio, hematoma, infección (rara < 0,1 %) y reacción inflamatoria.",
        "Los resultados varían individualmente; no hay garantía de eficacia en todos los casos.",
        "El paciente deberá evitar AINEs durante los 7 días previos y los 14 días posteriores al procedimiento.",
      ],
    },
  },
  BMAC: {
    "pt-BR": CONSENT_TEXTS.BMAC,
    es: {
      title: "Concentrado de médula ósea (BMA)",
      items: [
        "Procedimiento autólogo que implica aspiración de médula ósea, generalmente de la cresta ilíaca.",
        "Riesgos: dolor en el sitio de aspiración, hematoma, infección (rara) y fractura por estrés (muy rara).",
        "La aspiración se realiza bajo anestesia local y/o sedación leve.",
        "Período de restricción de actividad física según orientación médica.",
      ],
    },
  },
  MFAT: {
    "pt-BR": CONSENT_TEXTS.MFAT,
    es: {
      title: "Grasa microfragmentada (MFAT)",
      items: [
        "Procedimiento autólogo que implica la obtención de grasa subcutánea mediante mini-lipoaspiración.",
        "Riesgos: dolor en el sitio donante, hematoma, seroma, irregularidad estética local e infección (rara).",
        "El tejido adiposo se procesa mecánicamente y se inyecta en la región objetivo.",
        "Evitar actividades de alto impacto durante el período que determine el médico.",
      ],
    },
  },
  AH: {
    "pt-BR": CONSENT_TEXTS.AH,
    es: {
      title: "Ácido hialurónico (AH)",
      items: [
        "Viscosuplementación con ácido hialurónico de origen no biológico o biofermentado.",
        "Riesgos: dolor y edema transitorios, pseudosepsis (reacción local aguda) e infección (rara < 0,05 %).",
        "Los pacientes con alergia a proteínas aviares (para productos de origen animal) deben informarlo.",
        "Efecto esperado entre 4 y 12 semanas después de la aplicación.",
      ],
    },
  },
  RADIOFREQUENCIA: {
    "pt-BR": CONSENT_TEXTS.RADIOFREQUENCIA,
    es: {
      title: "Radiofrecuencia (neurotomía/ablación)",
      items: [
        "Procedimiento mínimamente invasivo guiado por fluoroscopia o ecografía.",
        "Riesgos: dolor temporal, disestesia local, neuritis, infección (rara) y quemadura de la piel (rara).",
        "El alivio del dolor puede ser temporal; puede producirse reinervación entre 6 y 18 meses.",
        "Procedimiento realizado en ambiente quirúrgico con monitorización adecuada.",
      ],
    },
  },
  BLOQUEIOS: {
    "pt-BR": CONSENT_TEXTS.BLOQUEIOS,
    es: {
      title: "Bloqueos anestésicos / corticoide",
      items: [
        "Inyección de anestésico local con o sin corticoide en el espacio articular o periarticular.",
        "Riesgos: dolor local transitorio, hiperglucemia (diabéticos), atrofia cutánea e infección (rara).",
        "Límite recomendado: hasta 3 infiltraciones de corticoide por articulación al año.",
        "No suspenda el anticoagulante sin orientación del médico prescriptor.",
      ],
    },
  },
  HIDROGEL: {
    "pt-BR": CONSENT_TEXTS.HIDROGEL,
    es: {
      title: "Hidrogel (andamio polimérico)",
      items: [
        "Dispositivo médico sintético o biosintético con propiedades biomecánicas de soporte.",
        "Riesgos: reacción a cuerpo extraño, inflamación local e infección (rara).",
        "El uso fuera de indicación puede aplicarse a algunos productos; informar sobre la normativa vigente.",
        "Seguir el protocolo específico de rehabilitación según indicación médica.",
      ],
    },
  },
  PRF: {
    "pt-BR": CONSENT_TEXTS.PRF,
    es: {
      title: "Fibrina rica en plaquetas (PRF)",
      items: [
        "Procedimiento autólogo que utiliza fibrina y plaquetas concentradas obtenidas de la propia sangre del paciente, sin adición de anticoagulantes ni trombina exógena.",
        "Los riesgos incluyen dolor y edema local transitorios, hematoma en el sitio de obtención, reacción inflamatoria e infección (muy rara < 0,05 %).",
        "El coágulo o membrana de PRF se obtiene mediante centrifugación inmediata y se aplica de forma quirúrgica o inyectable; sin conservantes ni aditivos químicos.",
        "El paciente deberá evitar AINEs durante los 7 días previos y los 14 días posteriores al procedimiento para no comprometer la activación plaquetaria.",
        "Los resultados dependen de la calidad de la sangre del paciente y varían individualmente; no hay garantía universal de eficacia.",
      ],
    },
  },
  COLAGENO: {
    "pt-BR": CONSENT_TEXTS.COLAGENO,
    es: {
      title: "Colágeno / andamio biológico",
      items: [
        "Producto de origen biológico (colágeno bovino, porcino o humano) o biosintético utilizado como matriz tridimensional para soporte celular y regeneración tisular.",
        "Riesgos: reacción de hipersensibilidad al colágeno heterólogo (hasta 3 %), inflamación local, reabsorción incompleta e infección (rara).",
        "Los pacientes con alergia a proteínas animales deben informar al médico antes del procedimiento; puede estar indicada una prueba cutánea.",
        "El andamio puede implantarse quirúrgicamente o aplicarse de forma mínimamente invasiva según la formulación utilizada.",
        "Seguir el protocolo específico de rehabilitación para permitir una adecuada integración tisular; período de restricción definido por el médico.",
      ],
    },
  },
  SVF: {
    "pt-BR": CONSENT_TEXTS.SVF,
    es: {
      title: "Fracción vascular estromal (SVF)",
      items: [
        "Procedimiento autólogo que implica la obtención de tejido adiposo mediante mini-lipoaspiración, seguida de procesamiento enzimático o mecánico para aislar la fracción celular estromal.",
        "Riesgos en el sitio donante: dolor, hematoma, seroma, irregularidad estética e infección (rara). Riesgos en el sitio receptor: inflamación, dolor posterior al procedimiento e infección (rara).",
        "La SVF contiene células madre mesenquimales, células endoteliales y pericitos con potencial paracrino; no constituye una terapia celular aprobada universalmente; informar la normativa vigente.",
        "Evitar AINEs y corticoides sistémicos durante al menos 7 días antes del procedimiento para preservar la viabilidad celular.",
        "La actividad física de alto impacto debe restringirse durante el período que defina el médico tras una evaluación individual.",
      ],
    },
  },
  LISADO: {
    "pt-BR": CONSENT_TEXTS.LISADO,
    es: {
      title: "Lisado plaquetario",
      items: [
        "Producto biológico obtenido mediante ciclos repetidos de congelación y descongelación de concentrado plaquetario, que libera factores de crecimiento en alta concentración.",
        "Puede ser de origen autólogo (del mismo paciente) o alogénico (mezcla de donantes analizados); el médico informará el origen utilizado.",
        "Riesgos: reacción inflamatoria local, dolor transitorio en el sitio de aplicación y transmisión de agentes infecciosos (muy rara en productos alogénicos sometidos a cribado).",
        "Los pacientes con coagulopatías o que utilizan anticoagulantes deben informar al médico; puede ser necesario ajustar el protocolo.",
        "Los resultados dependen de la concentración de factores de crecimiento y de la capacidad de respuesta individual del tejido objetivo.",
      ],
    },
  },
  NANOFAT: {
    "pt-BR": CONSENT_TEXTS.NANOFAT,
    es: {
      title: "Nanofat (Lipogems / grasa nanofragmentada)",
      items: [
        "Procedimiento autólogo que utiliza grasa subcutánea procesada mecánicamente hasta fragmentos nanométricos, preservando la matriz extracelular y células estromales viables.",
        "Riesgos en el sitio donante: dolor, hematoma, seroma, irregularidad local e infección (rara). Riesgos en el sitio receptor: edema, eritema, nodulación transitoria e infección (rara).",
        "El Nanofat se inyecta con agujas finas (22–25G) en tejidos que no aceptan injertos mayores, como piel, tendones y mucosas.",
        "Evitar la actividad física intensa y la exposición solar en la zona tratada durante el período que determine el médico.",
        "Los resultados estéticos y funcionales varían según el sitio tratado y la respuesta biológica individual; pueden ser necesarias varias sesiones.",
      ],
    },
  },
};

export function consentContentForLocale(
  product: string,
  locale: ReturnType<typeof resolveDoctorLocale>,
): ConsentContent | undefined {
  const localized = LOCALIZED_CONSENT_TEXTS[product];
  return localized ? localized[locale] : CONSENT_TEXTS[product];
}

router.get("/regen/consent/:product", requireAuth, async (req: any, res) => {
  try {
    const product = req.params.product.toUpperCase();
    const { rows: doctorLocaleRows } = await pool.query(`SELECT idioma FROM doctors WHERE id = $1`, [req.doctorId]);
    const locale = resolveDoctorLocale(doctorLocaleRows[0]?.idioma);
    const content = consentContentForLocale(product, locale);
    if (!content) return res.status(404).json({ error: message(locale, "productNotFound") });

    let patientName   = "Paciente";
    let patientDob    = "";
    let doctorName    = "";
    let doctorCrm     = "";
    const procedureDate = localeDate(new Date(), locale);

    // Always fetch doctor info
    {
      const { rows } = await pool.query(
        `SELECT nome, crm FROM doctors WHERE id = $1`,
        [req.doctorId],
      );
      if (rows.length) {
        doctorName = rows[0].nome ?? "";
        doctorCrm  = rows[0].crm  ?? "";
      }
    }

    if (req.query.caseId) {
      const { rows } = await pool.query(
        `SELECT patient_name, patient_dob FROM regen_cases WHERE id = $1 AND doctor_id = $2`,
        [req.query.caseId, req.doctorId],
      );
      if (rows.length) {
        patientName = rows[0].patient_name ?? patientName;
        patientDob  = rows[0].patient_dob
          ? new Date(rows[0].patient_dob).toLocaleDateString("pt-BR")
          : "";
      }
    }

    const doc = new PDFDocument({ size: "A4", margin: 50 });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => {
      const pdf = Buffer.concat(chunks);
      const safeName = patientName
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-zA-Z0-9 _-]/g, "")
        .trim()
        .replace(/\s+/g, "_");
      const filename = `DocSholder_Consentimento_${product}_${safeName}.pdf`;
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `inline; filename="${filename}"`);
      res.end(pdf);
    });

    const PAGE_W = 595; // A4 width in pt
    const MARGIN = 50;
    const INNER  = PAGE_W - MARGIN * 2;

    doc.y = MARGIN;

    // ── Title block ──
    doc.fontSize(13).fillColor("#1E3A5F").font("Helvetica-Bold")
       .text(message(locale, "consentTitle"), MARGIN, doc.y, { align: "center", width: INNER });
    doc.moveDown(0.3);
    doc.fontSize(11).fillColor("#2563EB").font("Helvetica-Bold")
       .text(content.title, MARGIN, doc.y, { align: "center", width: INNER });
    doc.moveDown(0.8);
    doc.moveTo(MARGIN, doc.y).lineTo(PAGE_W - MARGIN, doc.y).strokeColor("#DBEAFE").lineWidth(1.5).stroke();
    doc.moveDown(0.8);

    // ── Patient data box ──
    const boxTop = doc.y;
    const boxH   = patientDob ? 72 : 56;
    doc.rect(MARGIN, boxTop, INNER, boxH).fill("#F0F9FF").stroke("#BFDBFE");
    doc.fillColor("#1E3A5F").font("Helvetica-Bold").fontSize(8)
       .text(message(locale, "patientData"), MARGIN + 12, boxTop + 10);

    // Two-column layout inside box
    const col1 = MARGIN + 12;
    const col2 = MARGIN + INNER / 2 + 10;
    const row1Y = boxTop + 24;
    const row2Y = boxTop + 42;

    doc.fontSize(9).fillColor("#374151").font("Helvetica-Bold").text(message(locale, "name"), col1, row1Y);
    doc.font("Helvetica").text(patientName, col1 + 38, row1Y, { width: INNER / 2 - 50 });

    doc.font("Helvetica-Bold").text(message(locale, "generatedOn"), col2, row1Y);
    doc.font("Helvetica").text(procedureDate, col2 + 95, row1Y);

    if (patientDob) {
      doc.font("Helvetica-Bold").text(message(locale, "birth"), col1, row2Y);
      doc.font("Helvetica").text(patientDob, col1 + 70, row2Y);
    }

    if (doctorName) {
      doc.font("Helvetica-Bold").text(message(locale, "doctor"), col2, row2Y);
      doc.font("Helvetica").text(
        `${doctorName}${doctorCrm ? ` · CRM ${doctorCrm}` : ""}`,
        col2 + 46, row2Y, { width: INNER / 2 - 58 },
      );
    }

    doc.y = boxTop + boxH + 16;

    // ── Intro paragraph ──
    doc.fontSize(10).fillColor("#374151").font("Helvetica")
       .text(
          locale === "es"
            ? `Yo, ${patientName}, declaro haber sido informado(a) de manera clara y objetiva sobre el procedimiento de ${content.title}, sus objetivos, riesgos y beneficios esperados, según se detalla a continuación:`
            : `Eu, ${patientName}, declaro ter sido informado(a) de forma clara e objetiva sobre o procedimento de ${content.title}, seus objetivos, riscos e benefícios esperados, conforme detalhado a seguir:`,
         MARGIN, doc.y, { width: INNER },
       );
    doc.moveDown(0.8);

    // ── Information items ──
    doc.fillColor("#1E3A5F").font("Helvetica-Bold").fontSize(9)
        .text(message(locale, "procedureInfo"), MARGIN, doc.y);
    doc.moveDown(0.4);
    for (const item of content.items) {
      doc.font("Helvetica").fillColor("#374151").fontSize(10)
         .text(`•  ${item}`, MARGIN + 8, doc.y, { width: INNER - 8 });
      doc.moveDown(0.35);
    }
    doc.moveDown(0.6);

    // ── Consent declaration box ──
    const declTop = doc.y;
    doc.rect(MARGIN, declTop, INNER, 52).fill("#F8FAFC").stroke("#E2E8F0");
    doc.fillColor("#1E3A5F").font("Helvetica-Bold").fontSize(8)
        .text(message(locale, "declaration"), MARGIN + 12, declTop + 10);
    doc.font("Helvetica").fillColor("#374151").fontSize(9)
       .text(
          locale === "es"
            ? "Declaro que leí y comprendí la información anterior, que tuve la oportunidad de hacer preguntas a mi médico y que fueron respondidas satisfactoriamente. Autorizo la realización del procedimiento descrito, consciente de sus riesgos y beneficios."
            : "Declaro que li e compreendi as informações acima, que tive a oportunidade de fazer perguntas ao meu médico e que estas foram respondidas satisfatoriamente. Autorizo a realização do procedimento descrito, ciente dos riscos e benefícios.",
         MARGIN + 12, declTop + 22, { width: INNER - 24 },
       );

    doc.y = declTop + 64;

    // ── Signature lines ──
    doc.moveDown(1.2);
    const sigY = doc.y;
    const sig1End = MARGIN + (INNER / 2) - 12;
    const sig2Start = MARGIN + (INNER / 2) + 12;
    const sig2End = PAGE_W - MARGIN;

    doc.moveTo(MARGIN, sigY).lineTo(sig1End, sigY).strokeColor("#374151").lineWidth(0.5).stroke();
    doc.moveTo(sig2Start, sigY).lineTo(sig2End, sigY).strokeColor("#374151").lineWidth(0.5).stroke();

    doc.fontSize(8).fillColor("#6B7280");
    doc.text(message(locale, "patientSignature"), MARGIN, sigY + 5, { width: sig1End - MARGIN });
    doc.text(
       doctorName ? `${doctorName}${doctorCrm ? " · CRM " + doctorCrm : ""}` : message(locale, "doctorSignature"),
      sig2Start, sigY + 5, { width: sig2End - sig2Start },
    );
    doc.moveDown(1.6);

    // ── Date field ──
    doc.fontSize(9).fillColor("#6B7280").font("Helvetica")
       .text("Local: _____________________________________________ ,  ______ / ______ / __________", MARGIN, doc.y, { align: "center", width: INNER });
    doc.moveDown(1.2);

    // ── Footer ──
    doc.moveTo(MARGIN, doc.y).lineTo(PAGE_W - MARGIN, doc.y).strokeColor("#E2E8F0").lineWidth(0.8).stroke();
    doc.moveDown(0.4);
    doc.fontSize(7).fillColor("#9CA3AF").font("Helvetica")
       .text(
           message(locale, "confidential", { date: procedureDate }),
         MARGIN, doc.y, { align: "center", width: INNER },
       );

    doc.end();
  } catch (e) {
    console.error("[regen/consent]", e);
    res.status(500).json({ error: message(await localeForDoctorId(req.doctorId), "reportGenerationFailed") });
  }
});

// ─── Biologic field definitions (server-side mirror of frontend BIOLOGIC_FIELDS)
// Used to render human-readable labels and units in the PDF report
const BIOLOGIC_FIELD_DEFS: Record<string, { key: string; label: string; unit?: string }[]> = {
  PRP:    [
    { key: "sistemaUtilizado", label: "Sistema utilizado" },
    { key: "centrifugacao",    label: "Centrifugação" },
    { key: "volumeColetado",   label: "Volume coletado",  unit: "mL" },
    { key: "concentracao",     label: "Concentração" },
    { key: "leucocito",        label: "Leucócito" },
    { key: "volumeFinal",      label: "Volume final",     unit: "mL" },
  ],
  LP_PRP: [],
  LR_PRP: [],
  PRF: [
    { key: "sistemaUtilizado", label: "Sistema utilizado" },
    { key: "volumeColetado",   label: "Volume coletado",  unit: "mL" },
    { key: "centrifugacao",    label: "Protocolo de centrifugação" },
  ],
  BMAC: [
    { key: "localColeta",       label: "Local da coleta" },
    { key: "sistemaUtilizado",  label: "Sistema utilizado" },
    { key: "volumeAspirado",    label: "Volume aspirado",    unit: "mL" },
    { key: "volumeConcentrado", label: "Volume concentrado", unit: "mL" },
  ],
  MFAT: [
    { key: "sistema",       label: "Sistema" },
    { key: "quantidade",    label: "Quantidade", unit: "mL" },
    { key: "processamento", label: "Processamento" },
  ],
  NANOFAT: [
    { key: "sistema",       label: "Sistema" },
    { key: "quantidade",    label: "Quantidade", unit: "mL" },
    { key: "processamento", label: "Processamento" },
  ],
  AH: [
    { key: "marca",          label: "Marca" },
    { key: "pesoMolecular",  label: "Peso molecular" },
    { key: "volumeAplicado", label: "Volume aplicado", unit: "mL" },
  ],
  COLAGENO: [
    { key: "marca",  label: "Marca" },
    { key: "tipo",   label: "Tipo" },
    { key: "volume", label: "Volume", unit: "mL" },
  ],
  SVF: [
    { key: "sistemaUtilizado", label: "Sistema utilizado" },
    { key: "volume",           label: "Volume final",     unit: "mL" },
  ],
  EXOSSOMO: [
    { key: "origem",       label: "Origem / fabricante" },
    { key: "volume",       label: "Volume",              unit: "mL" },
    { key: "concentracao", label: "Concentração" },
  ],
  LISADO: [
    { key: "sistemaUtilizado", label: "Sistema / fabricante" },
    { key: "volume",           label: "Volume",               unit: "mL" },
  ],
  SUBCONDROPLASTIA: [
    { key: "produto", label: "Produto" },
    { key: "volume",  label: "Volume",        unit: "mL" },
    { key: "local",   label: "Local (lesão)" },
  ],
  HIDROGEL: [
    { key: "marca",  label: "Marca" },
    { key: "volume", label: "Volume injetado", unit: "mL" },
  ],
  OUTRO: [
    { key: "descricao", label: "Descrição do produto" },
    { key: "volume",    label: "Volume",               unit: "mL" },
  ],
};
// LP_PRP and LR_PRP share PRP fields
BIOLOGIC_FIELD_DEFS.LP_PRP = BIOLOGIC_FIELD_DEFS.PRP;
BIOLOGIC_FIELD_DEFS.LR_PRP = BIOLOGIC_FIELD_DEFS.PRP;

const PRODUCT_NAMES: Record<string, string> = {
  PRP:             "Plasma Rico em Plaquetas (PRP)",
  LP_PRP:          "LP-PRP — Pobre em Leucócitos",
  LR_PRP:          "LR-PRP — Rico em Leucócitos",
  PRF:             "Fibrina Rica em Plaquetas (PRF)",
  BMAC:            "Concentrado de Medula Óssea (BMA)",
  MFAT:            "Gordura Micro-Fragmentada (MFAT)",
  AH:              "Ácido Hialurônico",
  COLAGENO:        "Colágeno",
  SVF:             "Fração Vascular Estromal (SVF)",
  EXOSSOMO:        "Exossomas / Vesículas Extracelulares",
  LISADO:          "Lisado Plaquetário",
  SUBCONDROPLASTIA:"Subcondroplastia",
  HIDROGEL:        "Hidrogel (Scaffold Polimérico)",
  RADIOFREQUENCIA: "Radiofrequência / Neurotomia",
  BLOQUEIOS:       "Bloqueios Anestésicos / Corticoide",
  NANOFAT:         "Nanofat",
  OUTRO:           "Outro Procedimento",
};

const CONDITION_NAMES: Record<string, string> = {
  hip_oa:     "Osteoartrose de Quadril",
  shoulder_oa:"Osteoartrose de Ombro",
  ankle_oa:   "Osteoartrose de Tornozelo",
  tendinopathy:"Tendinopatia",
  chondral:   "Lesão Condral",
  other:      "Outro",
  OA_QUADRIL: "Osteoartrite de Quadril",
  OA_OMBRO: "Osteoartrose de Ombro",
  TENDINOPATIA_OMBRO: "Tendinopatia do Manguito Rotador",
  BURSITE_OMBRO: "Bursite de Ombro",
  LESAO_LABRAL_OMBRO: "Lesão Labral de Ombro",
  OA_COTOVELO: "Osteoartrose de Cotovelo",
  EPICONDILITE: "Epicondilite Lateral / Medial",
  TENDINOPATIA_COTOVELO: "Tendinopatia de Cotovelo",
  OA_TORNOZELO: "Osteoartrite de Tornozelo",
  OA_PUNHO: "Osteoartrose de Punho",
  TENDINOPATIA_PUNHO: "Tendinopatia de Punho e Mão",
  SINDROME_TUNEL_CARPO: "Síndrome do Túnel do Carpo",
  OA_COLUNA_CERVICAL: "Osteoartrose Cervical",
  HERNIA_DISCAL_CERVICAL: "Hérnia Discal Cervical",
  OA_COLUNA_TORACICA: "Osteoartrose Torácica",
  HERNIA_DISCAL_TORACICA: "Hérnia Discal Torácica",
  OA_COLUNA_LOMBAR: "Osteoartrose Lombar",
  HERNIA_DISCAL_LOMBAR: "Hérnia Discal Lombar",
  CONDRAL_FOCAL: "Lesão Condral Focal",
  OSTEOCONDRAL: "Lesão Osteocondral",
  TENDINOPATIA: "Tendinopatia",
  SINOVITE: "Sinovite / Sinovite Vilonodular",
  BURSITE: "Bursite",
  FRATURA_FADIGA: "Fratura por Fadiga / Estresse",
  POS_OPERATORIO: "Pós-Operatório / Bioestimulação",
  FASCITE_PLANTAR: "Fasciíte Plantar",
  CUSTOM: "Outra Condição (especificar)",
};

const SPANISH_PRODUCT_NAMES: Record<string, string> = {
  PRP: "Plasma rico en plaquetas (PRP)", LP_PRP: "LP-PRP — pobre en leucocitos",
  LR_PRP: "LR-PRP — rico en leucocitos", PRF: "Fibrina rica en plaquetas (PRF)",
  BMAC: "Concentrado de médula ósea (BMA)", MFAT: "Grasa microfragmentada (MFAT)",
  AH: "Ácido hialurónico", COLAGENO: "Colágeno", SVF: "Fracción vascular estromal (SVF)",
  EXOSSOMO: "Exosomas / vesículas extracelulares", LISADO: "Lisado plaquetario",
  SUBCONDROPLASTIA: "Subcondroplastia", HIDROGEL: "Hidrogel (andamio polimérico)",
  RADIOFREQUENCIA: "Radiofrecuencia / neurotomía", BLOQUEIOS: "Bloqueos anestésicos / corticoide",
  NANOFAT: "Nanofat", OUTRO: "Otro procedimiento",
};
const SPANISH_CONDITION_NAMES: Record<string, string> = {
  hip_oa: "Osteoartritis de cadera",
  shoulder_oa: "Osteoartritis de hombro", ankle_oa: "Osteoartritis de tobillo",
  tendinopathy: "Tendinopatía", chondral: "Lesión condral", other: "Otra condición",
  OA_QUADRIL: "Osteoartritis de cadera",
  OA_OMBRO: "Osteoartritis de hombro", TENDINOPATIA_OMBRO: "Tendinopatía del manguito rotador",
  BURSITE_OMBRO: "Bursitis de hombro", LESAO_LABRAL_OMBRO: "Lesión labral de hombro",
  OA_COTOVELO: "Osteoartritis de codo", EPICONDILITE: "Epicondilitis lateral / medial",
  TENDINOPATIA_COTOVELO: "Tendinopatía de codo", OA_TORNOZELO: "Osteoartritis de tobillo",
  OA_PUNHO: "Osteoartritis de muñeca", TENDINOPATIA_PUNHO: "Tendinopatía de muñeca y mano",
  SINDROME_TUNEL_CARPO: "Síndrome del túnel carpiano", OA_COLUNA_CERVICAL: "Osteoartritis cervical",
  HERNIA_DISCAL_CERVICAL: "Hernia discal cervical", OA_COLUNA_TORACICA: "Osteoartritis torácica",
  HERNIA_DISCAL_TORACICA: "Hernia discal torácica", OA_COLUNA_LOMBAR: "Osteoartritis lumbar",
  HERNIA_DISCAL_LOMBAR: "Hernia discal lumbar",
  CONDRAL_FOCAL: "Lesión condral focal", OSTEOCONDRAL: "Lesión osteocondral",
  TENDINOPATIA: "Tendinopatía",
  SINOVITE: "Sinovitis / sinovitis villonodular", BURSITE: "Bursitis",
  FRATURA_FADIGA: "Fractura por fatiga / estrés", POS_OPERATORIO: "Posoperatorio / bioestimulación",
  FASCITE_PLANTAR: "Fascitis plantar", CUSTOM: "Otra condición (especificar)",
};
const SPANISH_SEX_NAMES: Record<string, string> = {
  masculino: "Masculino", male: "Masculino", m: "Masculino",
  feminino: "Femenino", female: "Femenino", f: "Femenino",
  outro: "Otro", other: "Otro", "não informado": "No informado",
};
const SPANISH_SIDE_NAMES: Record<string, string> = {
  direito: "Derecho", direita: "Derecha", right: "Derecho",
  esquerdo: "Izquierdo", esquerda: "Izquierda", left: "Izquierdo",
  bilateral: "Bilateral",
};
const SPANISH_GUIDANCE_NAMES: Record<string, string> = {
  ultrassom: "Ecografía", ultrasound: "Ecografía",
  fluoroscopia: "Fluoroscopia", fluoroscopy: "Fluoroscopia",
  artroscopia: "Artroscopia", arthroscopy: "Artroscopia",
  "referência anatômica (às cegas)": "Referencia anatómica (a ciegas)",
  "às cegas": "Palpación sin imagen", "a cegas": "Palpación sin imagen",
  "ás cegas (palpação)": "Palpación sin imagen",
  blind_palpation: "Palpación sin imagen",
  outro: "Otro", other: "Otro",
};
const SPANISH_APPLICATION_LOCATION_NAMES: Record<string, string> = {
  "intra-articular": "Intraarticular",
  subcondroplastia: "Subcondroplastia",
  "tecido periarticular": "Tejido periarticular",
  ligamento: "Ligamento",
  outro: "Otro",
};
const SPANISH_ACCESS_NAMES: Record<string, string> = {
  intra_articular: "Intraarticular", "intra-articular": "Intraarticular", intraarticular: "Intraarticular",
  periarticular: "Periarticular",
  intratendinoso: "Intratendinoso", intratendinous: "Intratendinoso",
  subcutaneo: "Subcutáneo", "subcutâneo": "Subcutáneo", subcutaneous: "Subcutáneo",
  intramuscular: "Intramuscular", intradermico: "Intradérmico", "intradérmico": "Intradérmico",
};
const SPANISH_FIELD_LABELS: Record<string, string> = {
  "Sistema utilizado": "Sistema utilizado", "Centrifugação": "Centrifugación",
  "Volume coletado": "Volumen obtenido", "Concentração": "Concentración", "Leucócito": "Leucocito",
  "Volume final": "Volumen final", "Protocolo de centrifugação": "Protocolo de centrifugación",
  "Local da coleta": "Sitio de obtención", "Volume aspirado": "Volumen aspirado",
  "Volume concentrado": "Volumen concentrado", "Quantidade": "Cantidad", "Processamento": "Procesamiento",
  "Peso molecular": "Peso molecular", "Volume aplicado": "Volumen aplicado",
  "Sistema / fabricante": "Sistema / fabricante", "Volume injetado": "Volumen inyectado",
  "Local (lesão)": "Sitio (lesión)", "Descrição do produto": "Descripción del producto",
};
function productNameForLocale(code: string, locale: ReturnType<typeof resolveDoctorLocale>): string {
  return locale === "es" ? SPANISH_PRODUCT_NAMES[code] ?? PRODUCT_NAMES[code] ?? code : PRODUCT_NAMES[code] ?? code;
}
export function conditionNameForLocale(code: string, locale: ReturnType<typeof resolveDoctorLocale>): string {
  return locale === "es" ? SPANISH_CONDITION_NAMES[code] ?? CONDITION_NAMES[code] ?? code : CONDITION_NAMES[code] ?? code;
}
function controlledValueForLocale(
  value: unknown,
  locale: ReturnType<typeof resolveDoctorLocale>,
  spanishNames: Record<string, string>,
): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text || locale !== "es") return text;
  return spanishNames[text] ?? spanishNames[text.toLowerCase()] ?? text;
}
export function sexForLocale(value: unknown, locale: ReturnType<typeof resolveDoctorLocale>): string {
  return controlledValueForLocale(value, locale, SPANISH_SEX_NAMES);
}
export function sideForLocale(value: unknown, locale: ReturnType<typeof resolveDoctorLocale>): string {
  return controlledValueForLocale(value, locale, SPANISH_SIDE_NAMES);
}
export function guidanceForLocale(value: unknown, locale: ReturnType<typeof resolveDoctorLocale>): string {
  return controlledValueForLocale(value, locale, SPANISH_GUIDANCE_NAMES);
}
export function applicationLocationForLocale(value: unknown, locale: ReturnType<typeof resolveDoctorLocale>): string {
  return controlledValueForLocale(value, locale, SPANISH_APPLICATION_LOCATION_NAMES);
}
export function accessRouteForLocale(value: unknown, locale: ReturnType<typeof resolveDoctorLocale>): string {
  return controlledValueForLocale(value, locale, SPANISH_ACCESS_NAMES);
}
function fieldLabelForLocale(label: string, locale: ReturnType<typeof resolveDoctorLocale>): string {
  return locale === "es" ? SPANISH_FIELD_LABELS[label] ?? label : label;
}

// ─── Case Technical Report PDF ─────────────────────────────────────────────────

router.get("/regen/cases/:id/report", requireAuth, async (req: any, res) => {
  // Before a case is identified, the authenticated doctor's setting is the only
  // trusted locale source. Once loaded, use the case owner's setting instead.
  let locale = await localeForDoctorId(req.doctorId);
  try {
    // Fetch case data
    const { rows: caseRows } = await pool.query(
       `SELECT c.*, d.nome AS doctor_name, d.crm AS doctor_crm, d.idioma AS doctor_locale
       FROM regen_cases c
       JOIN doctors d ON d.id = c.doctor_id
       WHERE c.id = $1 AND c.doctor_id = $2`,
      [req.params.id, req.doctorId],
    );
    if (!caseRows.length) return res.status(404).json({ error: message(locale, "caseNotFound") });
    const c = caseRows[0];
    locale = resolveDoctorLocale(c.doctor_locale);

    // Fetch procedures
    const { rows: procedures } = await pool.query(
      `SELECT * FROM regen_procedures WHERE case_id = $1 ORDER BY performed_at ASC`,
      [req.params.id],
    );

    const patientName     = c.patient_name ?? "Paciente";
    const patientDob      = c.patient_dob ? localeDate(c.patient_dob, locale) : "";
    const doctorName      = c.doctor_name ?? "";
    const doctorCrm       = c.doctor_crm  ?? "";
    const conditionLabel  = conditionNameForLocale(c.condition_code ?? "", locale);
    const reportDate      = localeDate(new Date(), locale);
    const plannedApplicationSites = applicationSitesForProductDetails(
      c.product_details && typeof c.product_details === "object"
        ? c.product_details as Record<string, string>
        : {},
    );
    const plannedApplicationNotes = c.product_details && typeof c.product_details === "object"
      && typeof (c.product_details as Record<string, unknown>).observacoes === "string"
      ? (c.product_details as Record<string, string>).observacoes
      : "";

    const doc    = new PDFDocument({ size: "A4", margin: 50 });
    const chunks: Buffer[] = [];
    doc.on("data", (ch: Buffer) => chunks.push(ch));
    doc.on("end", () => {
      const pdf = Buffer.concat(chunks);
      const safeName = patientName
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-zA-Z0-9 _-]/g, "").trim().replace(/\s+/g, "_");
      const filename = `DocSholder_FichaTecnica_${safeName}_${Date.now()}.pdf`;
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `inline; filename="${filename}"`);
      res.end(pdf);
    });

    const PAGE_W = 595;
    const MARGIN = 50;
    const INNER  = PAGE_W - MARGIN * 2;

    doc.y = MARGIN;

    // ── Title ──
    doc.fontSize(14).fillColor("#1E3A5F").font("Helvetica-Bold")
       .text(message(locale, "technicalReport"), MARGIN, doc.y, { align: "center", width: INNER });
    doc.moveDown(0.25);
    doc.moveTo(MARGIN, doc.y).lineTo(PAGE_W - MARGIN, doc.y).strokeColor("#DBEAFE").lineWidth(1.5).stroke();
    doc.moveDown(0.7);

    // ── Patient / Doctor data box ──
    const pBoxTop = doc.y;
    const pBoxH   = 88;
    doc.rect(MARGIN, pBoxTop, INNER, pBoxH).fill("#F0F9FF").stroke("#BFDBFE");
    doc.fillColor("#1E3A5F").font("Helvetica-Bold").fontSize(8)
       .text(message(locale, "patientIdentification"), MARGIN + 12, pBoxTop + 8);

    const col1 = MARGIN + 12;
    const col2 = MARGIN + INNER / 2 + 8;
    const r1Y  = pBoxTop + 22;
    const r2Y  = pBoxTop + 40;
    const r3Y  = pBoxTop + 58;

    doc.fontSize(9).fillColor("#374151");
    doc.font("Helvetica-Bold").text(message(locale, "patient"), col1, r1Y);
    doc.font("Helvetica").text(patientName, col1 + 52, r1Y, { width: INNER / 2 - 64 });

    doc.font("Helvetica-Bold").text(message(locale, "generatedOn"), col2, r1Y);
    doc.font("Helvetica").text(reportDate, col2 + 100, r1Y);

    if (patientDob) {
      doc.font("Helvetica-Bold").text(message(locale, "birth"), col1, r2Y);
      doc.font("Helvetica").text(patientDob, col1 + 70, r2Y);
    }

    if (doctorName) {
      doc.font("Helvetica-Bold").text(message(locale, "doctor"), col2, r2Y);
      doc.font("Helvetica").text(
        `${doctorName}${doctorCrm ? ` · CRM ${doctorCrm}` : ""}`,
        col2 + 46, r2Y, { width: INNER / 2 - 58 },
      );
    }

    if (conditionLabel) {
      doc.font("Helvetica-Bold").text(message(locale, "condition"), col1, r3Y);
      doc.font("Helvetica").text(conditionLabel, col1 + 56, r3Y, { width: INNER / 2 - 68 });
    }

    const procCount = procedures.length;
    doc.font("Helvetica-Bold").fillColor("#374151").fontSize(9)
       .text(message(locale, "procedures"), col2, r3Y);
    doc.font("Helvetica").text(String(procCount), col2 + 86, r3Y);

    doc.y = pBoxTop + pBoxH + 14;

    // ── Planned application sites ──
    if (plannedApplicationSites.length > 0 || plannedApplicationNotes) {
      if (doc.y > 700) { doc.addPage(); doc.y = 50; }
      doc.rect(MARGIN, doc.y, INNER, 20).fill("#1E3A5F");
      doc.fontSize(9).fillColor("#FFFFFF").font("Helvetica-Bold")
         .text(message(locale, "plannedApplicationSites"), MARGIN + 10, doc.y + 5, { width: INNER - 20 });
      doc.y += 26;

      for (let i = 0; i < plannedApplicationSites.length; i++) {
        const site = plannedApplicationSites[i];
        if (doc.y > 740) { doc.addPage(); doc.y = 50; }
        const rowBg = i % 2 === 0 ? "#FFFFFF" : "#F8FAFC";
        doc.rect(MARGIN, doc.y, INNER, 18).fill(rowBg).stroke("#E2E8F0");
        doc.fontSize(8).fillColor("#374151").font("Helvetica-Bold")
           .text(message(locale, "applicationSite", { count: i + 1 }), MARGIN + 6, doc.y + 4, { width: 125 });
        const location = applicationLocationForLocale(site.localAplicacao, locale) || "—";
        const guide = guidanceForLocale(site.guia, locale) || "—";
        doc.font("Helvetica").text(
          `${message(locale, "anatomicalLocation")} ${location} · ${message(locale, "applicationGuide")} ${guide}`,
          MARGIN + 132, doc.y + 4, { width: INNER - 138, lineBreak: false },
        );
        doc.y += 18;
      }
      if (plannedApplicationNotes) {
        if (doc.y > 720) { doc.addPage(); doc.y = 50; }
        doc.fontSize(8).fillColor("#6B7280").font("Helvetica-Bold")
           .text(`${message(locale, "notes")} `, MARGIN + 6, doc.y + 5, { continued: true });
        doc.font("Helvetica").fillColor("#374151")
           .text(plannedApplicationNotes, { width: INNER - 12 });
        doc.moveDown(0.4);
      }
      doc.moveDown(0.4);
    }

    // ── Procedures ──
    if (procedures.length === 0) {
      doc.fontSize(10).fillColor("#6B7280").font("Helvetica")
         .text(message(locale, "noProcedures"), MARGIN, doc.y, { width: INNER });
    }

    for (let i = 0; i < procedures.length; i++) {
      const p = procedures[i];
      const productLabel = productNameForLocale(p.product_code, locale);
      const dateStr      = p.performed_at
        ? localeDate(p.performed_at, locale) : "—";

      // Check if we need a page break (rough estimate: 120pt per procedure)
      if (doc.y > 680) { doc.addPage(); doc.y = 50; }

      // Procedure section header
      const hdrTop = doc.y;
      doc.rect(MARGIN, hdrTop, INNER, 26).fill("#1E3A5F");
      doc.fontSize(9).fillColor("#FFFFFF").font("Helvetica-Bold")
         .text(`${i + 1}. ${productLabel}`, MARGIN + 10, hdrTop + 8, { width: INNER - 80 });
      doc.fontSize(8).fillColor("#93C5FD").font("Helvetica")
         .text(dateStr, MARGIN + INNER - 65, hdrTop + 9, { width: 55, align: "right" });

      doc.y = hdrTop + 26 + 8;

      // Basic procedure info — two columns
      const col1P = MARGIN + 10;
      const col2P = MARGIN + INNER / 2 + 6;
      const rowH  = 14;

      doc.fontSize(8.5).fillColor("#374151");
       doc.font("Helvetica-Bold").text(message(locale, "imageGuidanceLabel"), col1P, doc.y);
       doc.font("Helvetica").text(guidanceForLocale(p.guidance_mode, locale) || "—", col1P + 92, doc.y);

      const rowY1 = doc.y;
      if (p.access_route) {
         doc.font("Helvetica-Bold").text(message(locale, "accessRoute"), col2P, rowY1);
        doc.font("Helvetica").text(accessRouteForLocale(p.access_route, locale), col2P + 84, rowY1);
      }

      doc.y = rowY1 + rowH;

      if (p.local_anesthesia) {
         doc.font("Helvetica-Bold").text(message(locale, "localAnesthesia"), col1P, doc.y);
         doc.font("Helvetica").text(p.anesthesia_agent ?? (locale === "es" ? "Sí" : "Sim"), col1P + 92, doc.y);
        doc.y += rowH;
      }

      if (p.adverse_event) {
        doc.fontSize(8.5).fillColor("#DC2626").font("Helvetica-Bold")
            .text(message(locale, "adverseEventLabel"), col1P, doc.y);
         doc.font("Helvetica").text(p.adverse_event_desc ?? message(locale, "registered"), col1P + 100, doc.y);
        doc.fillColor("#374151");
        doc.y += rowH;
      }

      // ── Biologic details table ──
      const details  = (p.biologic_details ?? {}) as Record<string, unknown>;
      const fieldDefs = BIOLOGIC_FIELD_DEFS[p.product_code] ?? [];
      const entries   = fieldDefs
        .filter(f => details[f.key] != null && details[f.key] !== "")
         .map(f => ({ label: fieldLabelForLocale(f.label, locale), value: String(details[f.key]), unit: f.unit }));

      if (entries.length > 0) {
        doc.moveDown(0.35);

        // Section title
        doc.fontSize(7.5).fillColor("#2563EB").font("Helvetica-Bold")
           .text(message(locale, "productTechnicalSheet"), col1P, doc.y);
        doc.y += 12;

        // Table header
        const tblTop  = doc.y;
        const colLblW = 145;
        const colValX = MARGIN + 10 + colLblW + 6;
        const colValW = INNER - 20 - colLblW - 6;

        doc.rect(MARGIN + 6, tblTop, colLblW, 14).fill("#EFF6FF");
        doc.rect(colValX, tblTop, colValW, 14).fill("#EFF6FF");
        doc.fontSize(7.5).fillColor("#1E40AF").font("Helvetica-Bold")
            .text(message(locale, "parameter"), MARGIN + 10, tblTop + 3, { width: colLblW - 8 });
         doc.text(message(locale, "value"), colValX + 4, tblTop + 3, { width: colValW - 8 });

        doc.y = tblTop + 14;

        for (let j = 0; j < entries.length; j++) {
          const e     = entries[j];
          const rowBg = j % 2 === 0 ? "#FFFFFF" : "#F8FAFC";
          const rowTop = doc.y;
          doc.rect(MARGIN + 6, rowTop, colLblW, 14).fill(rowBg).stroke("#E2E8F0");
          doc.rect(colValX, rowTop, colValW, 14).fill(rowBg).stroke("#E2E8F0");
          doc.fontSize(8).fillColor("#374151").font("Helvetica-Bold")
             .text(e.label, MARGIN + 10, rowTop + 3, { width: colLblW - 8 });
          doc.font("Helvetica").text(
            e.unit ? `${e.value} ${e.unit}` : e.value,
            colValX + 4, rowTop + 3, { width: colValW - 8 },
          );
          doc.y = rowTop + 14;
        }
      }

      // Notes
      if (p.notes) {
        doc.moveDown(0.3);
        doc.fontSize(8).fillColor("#6B7280").font("Helvetica-Bold")
            .text(`${message(locale, "notes")} `, MARGIN + 10, doc.y, { continued: true });
        doc.font("Helvetica").fillColor("#374151").text(p.notes, { width: INNER - 20 });
      }

      doc.moveDown(0.8);
    }

    // ── Footer ──
    const footerY = Math.max(doc.y + 16, 750);
    if (footerY < 800) {
      doc.moveTo(MARGIN, footerY).lineTo(PAGE_W - MARGIN, footerY).strokeColor("#E2E8F0").lineWidth(0.8).stroke();
      doc.fontSize(7).fillColor("#9CA3AF").font("Helvetica")
         .text(
             message(locale, "confidential", { date: reportDate }),
           MARGIN, footerY + 5, { align: "center", width: INNER },
         );
    }

    doc.end();
  } catch (e) {
    console.error("[regen/cases/report]", e);
    res.status(500).json({ error: message(locale, "technicalReportGenerationFailed") });
  }
});

// ─── Case Clinical Report PDF ─────────────────────────────────────────────────
// Inline BioReady Score computation (mirrors artifacts/docknee/src/lib/regen-bioready.ts)
// Pure functions — no external dependencies beyond case/lab/prom data already fetched.

type FactorStatus = "green" | "yellow" | "red" | "na";
interface BRFactor { id: string; label: string; category: string; score: number; maxScore: 10; status: FactorStatus; detail: string; recommendation?: string; modifiable: boolean; }

function brFac(id: string, label: string, category: string, score: number, status: FactorStatus, detail: string, modifiable: boolean, recommendation?: string): BRFactor {
  return { id, label, category, score, maxScore: 10, status, detail, recommendation, modifiable };
}

function brPickBool(raw: Record<string, any>, ...keys: string[]): boolean | undefined {
  for (const k of keys) { if (Object.prototype.hasOwnProperty.call(raw, k) && raw[k] !== undefined) return !!raw[k]; }
  return undefined;
}
function brPickNum(raw: Record<string, any>, ...keys: string[]): number | undefined {
  for (const k of keys) { const v = raw[k]; if (v !== undefined && v !== null && v !== "") { const n = Number(v); if (!isNaN(n)) return n; } }
  return undefined;
}
function brPickStr(raw: Record<string, any>, ...keys: string[]): string | undefined {
  for (const k of keys) { const v = raw[k]; if (typeof v === "string" && v !== "") return v; }
  return undefined;
}

interface BRAnam {
  tabagismo?: string; alcool?: string; obesity?: boolean; obesityBmi?: number;
  sleepHours?: number; sleepQuality?: string; sleepApnea?: boolean;
  sedentary?: boolean; regularExercise?: boolean; protein?: string; ultraprocessed?: string;
  insulinResistance?: boolean; autoimmune?: boolean; autoimuneQual?: string; recentInfection?: boolean;
  corticosteroids?: boolean; nsaids?: boolean; immunosuppressants?: boolean; anticoagulants?: boolean;
  glp1Agonists?: boolean; priorPrpHa?: boolean; priorResponse?: string;
  priorInfiltrations?: boolean; priorInfiltrationsType?: string; priorInfiltrationsCount?: number;
  hba1c?: number; diabetesType?: string;
}

function brNormalizeAnam(raw: Record<string, any> | undefined): BRAnam {
  if (!raw) return {};
  const a: BRAnam = {};
  a.tabagismo = brPickStr(raw, "tabagismo");
  if (a.tabagismo === "sim" || a.tabagismo === "true" || raw.tabagismo === true) a.tabagismo = "sim";
  else if (a.tabagismo === "false" || raw.tabagismo === false) a.tabagismo = "não";
  a.alcool = brPickStr(raw, "alcool");
  if (raw.alcool === true) a.alcool = "frequente"; else if (raw.alcool === false) a.alcool = "não";
  const rawImc = brPickNum(raw, "obesidade_imc", "obesidadeImc", "imc");
  if (rawImc != null) { a.obesityBmi = rawImc; a.obesity = rawImc >= 30; }
  a.sleepHours = brPickNum(raw, "sono_horas", "horasSono");
  a.sleepQuality = brPickStr(raw, "sono_qualidade", "qualidadeSono");
  a.sleepApnea = brPickBool(raw, "apneia");
  a.sedentary = brPickBool(raw, "sedentarismo", "sedentario");
  a.regularExercise = brPickBool(raw, "exercicio_regular", "exercRegular");
  a.protein = brPickStr(raw, "proteina");
  a.ultraprocessed = brPickStr(raw, "ultraprocessados", "ultraproc");
  if (a.ultraprocessed === "true" || raw.ultraproc === true) a.ultraprocessed = "frequente";
  a.insulinResistance = brPickBool(raw, "resistencia_insulina", "resistIns");
  a.autoimmune = brPickBool(raw, "autoimune");
  a.autoimuneQual = brPickStr(raw, "autoimune_qual", "autoimuneQual");
  a.recentInfection = brPickBool(raw, "infeccao_recente", "infeccaoRecente");
  a.corticosteroids = brPickBool(raw, "corticoides", "medicCorticoide");
  a.nsaids = brPickBool(raw, "aines", "medicAINE", "medicAines");
  a.immunosuppressants = brPickBool(raw, "imunossupressores", "medicImunosupr");
  a.anticoagulants = brPickBool(raw, "anticoagulantes", "medicAnticoag");
  a.glp1Agonists = brPickBool(raw, "glp1_agonistas", "glp1Agonistas");
  a.priorPrpHa = brPickBool(raw, "prp_ha_previo", "prpPrev");
  a.priorResponse = brPickStr(raw, "prp_ha_resposta", "prpResposta");
  a.priorInfiltrations = brPickBool(raw, "infiltracoes_anteriores", "infiltPrev");
  a.priorInfiltrationsType = brPickStr(raw, "infiltracoes_tipo", "infiltQual");
  a.priorInfiltrationsCount = brPickNum(raw, "infiltracoes_numero");
  a.hba1c = brPickNum(raw, "diabetes_hba1c", "diabetesHba1c");
  a.diabetesType = brPickStr(raw, "diabetes", "diabetesTipo");
  if (raw.diabetes === true) a.diabetesType = "DM2"; else if (raw.diabetes === false) a.diabetesType = "não";
  return a;
}

interface BRClinicalAnamnesisRow {
  label: string;
  value: string;
}

function brFormatBoolean(value: boolean | undefined): string {
  return value === undefined ? "Não informado" : value ? "Sim" : "Não";
}

const SPANISH_ANAMNESIS_LABELS: Record<string, string> = {
  "Tabagismo": "Tabaquismo",
  "Consumo de álcool": "Consumo de alcohol",
  "IMC / composição corporal": "IMC / composición corporal",
  "Diabetes / controle glicêmico": "Diabetes / control glucémico",
  "Resistência à insulina": "Resistencia a la insulina",
  "Doença autoimune": "Enfermedad autoinmune",
  "Infecção recente": "Infección reciente",
  "Qualidade do sono": "Calidad del sueño",
  "Horas de sono": "Horas de sueño",
  "Apneia do sono": "Apnea del sueño",
  "Uso de CPAP": "Uso de CPAP",
  "Atividade física": "Actividad física",
  "Perfil alimentar — proteína": "Perfil alimentario — proteína",
  "Perfil alimentar — ultraprocessados": "Perfil alimentario — ultraprocesados",
  "Perfil alimentar — frutas e vegetais": "Perfil alimentario — frutas y verduras",
  "Perda de peso recente": "Pérdida de peso reciente",
  "Suplementos alimentares": "Suplementos alimentarios",
  "Medicações interferentes": "Medicamentos relevantes",
  "Cirurgia prévia": "Cirugía previa",
  "Histórico de infiltrações / PRP": "Antecedentes de infiltraciones / PRP",
};
const SPANISH_ANAMNESIS_PARTS: Record<string, string> = {
  "Não informado": "No informado", "Sim": "Sí", "Não": "No",
  "Fumante ativo": "Fumador activo", "Ex-fumante": "Exfumador", "Não fuma": "No fuma",
  "Não consome": "No consume", "Consumo social": "Consumo social", "Consumo frequente": "Consumo frecuente",
  "Obesidade declarada": "Obesidad declarada", "Pré-diabetes": "Prediabetes",
  "Boa": "Buena", "Regular": "Regular", "Ruim": "Mala",
  "Sedentarismo": "Sedentarismo", "Não sedentário": "No sedentario",
  "Exercício regular": "Ejercicio regular", "Sem exercício regular": "Sin ejercicio regular",
  "Sobrecarga ocupacional": "Sobrecarga laboral",
  "Adequada": "Adecuada", "Insuficiente": "Insuficiente", "Excessiva": "Excesiva",
  "Raramente": "Raramente", "Às vezes": "A veces", "Frequente": "Frecuente", "Adequado": "Adecuado",
  "Nenhuma declarada": "Ninguna declarada", "Imunossupressores": "Inmunosupresores",
  "Corticoides": "Corticoides", "AINEs": "AINEs",
  "Anticoagulantes": "Anticoagulantes", "Estatinas": "Estatinas",
  "Agonistas de GLP-1": "Agonistas de GLP-1", "Outras": "Otros",
  "Ácido hialurônico": "Ácido hialurónico", "Misto": "Mixto",
  "Sem resposta": "Sin respuesta", "Parcial": "Parcial", "Não sabe": "No sabe",
  "LP-PRP (pobre em leucócitos)": "LP-PRP (pobre en leucocitos)",
  "LR-PRP (rico em leucócitos)": "LR-PRP (rico en leucocitos)",
  "HA reticulado": "HA reticulado", "HA linear": "HA lineal",
  "Há menos de 1 mês": "Hace menos de 1 mes", "Há 1–3 meses": "Hace 1–3 meses",
  "Há 3–6 meses": "Hace 3–6 meses", "Há mais de 6 meses": "Hace más de 6 meses",
};
const SPANISH_ANAMNESIS_PREFIXES: Array<[string, string]> = [
  ["Circunferência abdominal ", "Circunferencia abdominal "],
  ["Atividade: ", "Actividad: "], ["Frequência: ", "Frecuencia: "],
  ["Outras: ", "Otros: "], ["Implantes: ", "Implantes: "],
  ["Infiltrações anteriores: ", "Infiltraciones anteriores: "],
  ["PRP/HA prévio: ", "PRP/HA previo: "], ["Resposta ", "Respuesta "],
  ["Duração do efeito: ", "Duración del efecto: "],
];
const ANAMNESIS_FREE_TEXT_KEYS = [
  "autoimune_qual", "autoimuneQual",
  "infeccaoQual", "infeccao_qual",
  "exercQual", "exercicio_qual", "exercFreq", "exercicio_freq",
  "suplementosDetalhe", "suplementos_detalhe",
  "corticoides_detalhe", "corticoidesDetalhe",
  "aines_detalhe", "ainesDetalhe",
  "imunossupressores_detalhe", "imunossupressoresDetalhe",
  "anticoagulantes_detalhe", "anticoagulantesDetalhe",
  "glp1_dose", "glp1Dose",
  "estatinas_detalhe", "estatinasDetalhe",
  "medicOutras", "outras_medicacoes", "medicacoes_outras",
  "ciruQual", "cirurgia_qual", "cirurgias_quais", "priorSurgeryDetail",
  "cirurgias_implantes", "cirurgiasImplantes",
  "infiltData", "infiltracoes_data", "infiltracoes_quando",
  "prpData", "prp_ha_data", "prpDuracao", "prp_ha_duracao",
] as const;
const SPANISH_INFILTRATION_TYPES: Record<string, string> = {
  Corticoide: "Corticoide",
  "Ácido Hialurônico": "Ácido hialurónico",
  "Ácido hialurônico": "Ácido hialurónico",
  Misto: "Mixto",
};
function spanishAnamnesisValue(value: string): string {
  return value.split(/( · | — )/).map(part => {
    if (part === " · " || part === " — ") return part;
    const exact = SPANISH_ANAMNESIS_PARTS[part];
    if (exact) return exact;
    const prefix = SPANISH_ANAMNESIS_PREFIXES.find(([source]) => part.startsWith(source));
    if (prefix) return `${prefix[1]}${spanishAnamnesisValue(part.slice(prefix[0].length))}`;
    return part
      .replace(/^(\d+(?:[.,]\d+)?) cigarros\/dia$/, "$1 cigarrillos/día")
      .replace(/^(\d+(?:[.,]\d+)?) maços-ano$/, "$1 paquetes-año")
      .replace(/^(\d+(?:[.,]\d+)?) hora\(s\) por noite$/, "$1 hora(s) por noche")
      .replace(/^(\d+) registrada\(s\)$/, "$1 registrada(s)")
      .replace(/^(\d+) sessão\(ões\)$/, "$1 sesión(es)");
  }).join("");
}

export function brFormatAnamnesisRows(
  raw: Record<string, any>,
  locale: ReturnType<typeof resolveDoctorLocale> = "pt-BR",
): BRClinicalAnamnesisRow[] {
  raw = { ...raw };
  const protectedFreeText = new Map<string, string>();
  for (const key of ANAMNESIS_FREE_TEXT_KEYS) {
    if (typeof raw[key] !== "string" || raw[key] === "") continue;
    const token = `\uE000FREE_TEXT_${protectedFreeText.size}\uE001`;
    protectedFreeText.set(token, raw[key]);
    raw[key] = token;
  }
  const restoreFreeText = (value: string): string => {
    let restored = value;
    for (const [token, original] of protectedFreeText) restored = restored.split(token).join(original);
    return restored;
  };

  const normalized = brNormalizeAnam(raw);
  // Some existing cases persist this already-normalized shape. Keep the score
  // normalizer unchanged here, but render these aliases in the PDF so recorded
  // clinical data is never omitted from the report.
  const a: BRAnam = {
    ...normalized,
    obesity: normalized.obesity ?? brPickBool(raw, "obesidade"),
    obesityBmi: normalized.obesityBmi ?? brPickNum(raw, "obesityBmi"),
    sleepHours: normalized.sleepHours ?? brPickNum(raw, "sleepHours"),
    sleepQuality: normalized.sleepQuality ?? brPickStr(raw, "sleepQuality"),
    sleepApnea: normalized.sleepApnea ?? brPickBool(raw, "sleepApnea"),
    sedentary: normalized.sedentary ?? brPickBool(raw, "sedentary"),
    regularExercise: normalized.regularExercise ?? brPickBool(raw, "regularExercise"),
    protein: normalized.protein ?? brPickStr(raw, "protein"),
    ultraprocessed: normalized.ultraprocessed ?? brPickStr(raw, "ultraprocessed"),
    insulinResistance: normalized.insulinResistance ?? brPickBool(raw, "insulinResistance"),
    autoimmune: normalized.autoimmune ?? brPickBool(raw, "autoimmune"),
    corticosteroids: normalized.corticosteroids ?? brPickBool(raw, "corticosteroids"),
    nsaids: normalized.nsaids ?? brPickBool(raw, "nsaids"),
    immunosuppressants: normalized.immunosuppressants ?? brPickBool(raw, "immunosuppressants"),
    anticoagulants: normalized.anticoagulants ?? brPickBool(raw, "anticoagulants"),
    glp1Agonists: normalized.glp1Agonists ?? brPickBool(raw, "glp1Agonists"),
    priorPrpHa: normalized.priorPrpHa ?? brPickBool(raw, "priorPrpHa"),
    priorResponse: normalized.priorResponse ?? brPickStr(raw, "priorResponse"),
    priorInfiltrations: normalized.priorInfiltrations ?? brPickBool(raw, "priorInfiltrations"),
    priorInfiltrationsType: normalized.priorInfiltrationsType ?? brPickStr(raw, "priorInfiltrationsType"),
    priorInfiltrationsCount: normalized.priorInfiltrationsCount ?? brPickNum(raw, "priorInfiltrationsCount"),
  };
  const sleepQualityLabels: Record<string, string> = {
    boa: "Boa",
    regular: "Regular",
    ruim: "Ruim",
  };
  const proteinLabels: Record<string, string> = {
    adequada: "Adequada",
    insuficiente: "Insuficiente",
    excessiva: "Excessiva",
  };
  const processedLabels: Record<string, string> = {
    raramente: "Raramente",
    "às vezes": "Às vezes",
    frequente: "Frequente",
  };
  const alcoholLabels: Record<string, string> = {
    não: "Não consome",
    social: "Consumo social",
    frequente: "Consumo frequente",
  };
  const smokingLabels: Record<string, string> = {
    não: "Não fuma",
    sim: "Fumante ativo",
    "ex-fumante": "Ex-fumante",
  };

  const medicationLabels: Array<[keyof BRAnam, string]> = [
    ["corticosteroids", "Corticoides"],
    ["nsaids", "AINEs"],
    ["immunosuppressants", "Imunossupressores"],
    ["anticoagulants", "Anticoagulantes"],
    ["glp1Agonists", "Agonistas de GLP-1"],
  ];
  const glp1Type = brPickStr(raw, "glp1_qual", "glp1Qual");
  const glp1Dose = brPickStr(raw, "glp1_dose", "glp1Dose");
  const glp1TypeLabels: Record<string, string> = {
    semaglutida: "Semaglutida",
    tirzepatida: "Tirzepatida",
    liraglutida: "Liraglutida",
    outro: "Outro",
  };
  const medicationDetails: Record<string, string | undefined> = {
    corticosteroids: brPickStr(raw, "corticoides_detalhe", "corticoidesDetalhe"),
    nsaids: brPickStr(raw, "aines_detalhe", "ainesDetalhe"),
    immunosuppressants: brPickStr(raw, "imunossupressores_detalhe", "imunossupressoresDetalhe"),
    anticoagulants: [
      brPickStr(raw, "anticoagulantes_detalhe", "anticoagulantesDetalhe"),
      brPickNum(raw, "anticoagulantes_inr", "anticoagulantesInr") != null
        ? `INR ${brPickNum(raw, "anticoagulantes_inr", "anticoagulantesInr")}`
        : undefined,
    ].filter(Boolean).join(" · ") || undefined,
    glp1Agonists: [
      glp1Type ? glp1TypeLabels[glp1Type] ?? glp1Type : undefined,
      glp1Dose,
    ].filter(Boolean).join(" · ") || undefined,
  };
  const medications = medicationLabels
    .filter(([key]) => a[key] === true)
    .map(([key, label]) => medicationDetails[key] ? `${label} — ${medicationDetails[key]}` : label);
  const statins = brPickBool(raw, "medicEstatinas", "estatinas");
  const statinDetail = brPickStr(raw, "estatinas_detalhe", "estatinasDetalhe");
  const otherMedications = brPickStr(raw, "medicOutras", "outras_medicacoes", "medicacoes_outras");
  if (statins) medications.push(statinDetail ? `Estatinas — ${statinDetail}` : "Estatinas");
  if (otherMedications) medications.push(`Outras: ${otherMedications}`);
  const hasMedicationAnswer = medicationLabels.some(([key]) => a[key] !== undefined)
    || statins !== undefined || !!otherMedications;

  const cigarettesPerDay = brPickNum(raw, "cigsDay", "tabagismo_qtd", "tabagismoCigarrosDia");
  const packYears = brPickNum(raw, "tabagismo_pack_years", "tabagismoPackYears");
  const waistCircumference = brPickNum(raw, "circAbdominal", "circ_abdominal", "obesidade_ca");
  const diabetesType = brPickStr(raw, "diabetesTipo", "diabetes_tipo") ?? a.diabetesType;
  const diabetesHba1c = a.hba1c ?? brPickNum(raw, "hba1c");
  const diabetesIsNegative = ["não", "nao", "false"].includes(diabetesType?.toLowerCase() ?? "");
  const hasDiabetes = typeof raw.diabetes === "boolean" ? raw.diabetes : diabetesType !== undefined && !diabetesIsNegative;
  const diabetesTypeLabels: Record<string, string> = {
    DM1: "DM1",
    DM2: "DM2",
    "Pre-DM": "Pré-diabetes",
    "pré-diabetes": "Pré-diabetes",
    não: "Não",
  };
  const diabetesDetails = [
    diabetesType ? diabetesTypeLabels[diabetesType] ?? diabetesType : undefined,
    diabetesHba1c != null ? `HbA1c ${diabetesHba1c}%` : undefined,
  ].filter(Boolean);
  const diabetesValue = !hasDiabetes && diabetesDetails.length === 0
    ? (typeof raw.diabetes === "boolean" ? "Não" : "Não informado")
    : `Sim${diabetesDetails.length ? ` — ${diabetesDetails.join(" · ")}` : ""}`;

  const homaIr = brPickNum(raw, "homaIr", "homa_ir");
  const recentInfection = a.recentInfection ?? brPickBool(raw, "recentInfection");
  const infectionDetail = brPickStr(raw, "infeccaoQual", "infeccao_qual");
  const usesCpap = brPickBool(raw, "cpap");
  const fruitVegetables = brPickStr(raw, "frutas_vegetais");
  const lowFruitVegetables = brPickBool(raw, "baixasFrutas");
  const fruitVegetableLabels: Record<string, string> = {
    adequado: "Adequado",
    insuficiente: "Insuficiente",
  };
  const weightLossKg = brPickNum(raw, "perdaPeso", "perda_peso_kg");
  const recentWeightLoss = brPickBool(raw, "perda_peso_recente");
  const usesSupplements = brPickBool(raw, "suplementos");
  const supplementDetails = brPickStr(raw, "suplementosDetalhe", "suplementos_detalhe");
  const occupationalOverload = brPickBool(raw, "sobreCarga", "sobrecarga_ocupacional");
  const exerciseKind = brPickStr(raw, "exercQual", "exercicio_qual");
  const exerciseFrequency = brPickStr(raw, "exercFreq", "exercicio_freq");
  const priorSurgery = brPickBool(raw, "ciruPrev", "cirurgia_previa", "cirurgias_previas", "priorSurgery");
  const priorSurgeryDetail = brPickStr(raw, "ciruQual", "cirurgia_qual", "cirurgias_quais", "priorSurgeryDetail");
  const priorSurgeryImplants = brPickStr(raw, "cirurgias_implantes", "cirurgiasImplantes");
  const infiltrationTypes = ["infiltTipos", "infiltracoes_tipos"]
    .flatMap(key => Array.isArray(raw[key]) ? raw[key] : [])
    .filter((item): item is string => typeof item === "string" && item.trim() !== "");
  const infiltrationDate = brPickStr(raw, "infiltData", "infiltracoes_data", "infiltracoes_quando");
  const prpType = brPickStr(raw, "prpTipo", "prp_ha_tipo");
  const prpSessions = brPickNum(raw, "prpSessoes", "prp_ha_sessoes");
  const prpDate = brPickStr(raw, "prpData", "prp_ha_data");
  const prpDuration = brPickStr(raw, "prpDuracao", "prp_ha_duracao");

  const infiltrationDetails: string[] = [];
  if (a.priorInfiltrations !== undefined) {
    if (a.priorInfiltrations) {
      const details = [
        infiltrationTypes.length
          ? infiltrationTypes.map(item => locale === "es" ? SPANISH_INFILTRATION_TYPES[item] ?? item : item).join(", ")
          : ({
          corticoide: "Corticoide",
          HA: "Ácido hialurônico",
          misto: "Misto",
        }[a.priorInfiltrationsType ?? ""] ?? a.priorInfiltrationsType),
        a.priorInfiltrationsCount != null ? `${a.priorInfiltrationsCount} registrada(s)` : undefined,
        infiltrationDate,
      ].filter(Boolean);
      infiltrationDetails.push(`Infiltrações anteriores: Sim${details.length ? ` — ${details.join(" · ")}` : ""}`);
    } else {
      infiltrationDetails.push("Infiltrações anteriores: Não");
    }
  }
  if (a.priorPrpHa !== undefined || a.priorResponse !== undefined) {
    const responseLabels: Record<string, string> = {
      boa: "Boa",
      parcial: "Parcial",
      sem: "Sem resposta",
      "sem resposta": "Sem resposta",
    };
    const prpTypeLabels: Record<string, string> = {
      "LP-PRP": "LP-PRP (pobre em leucócitos)",
      "LR-PRP": "LR-PRP (rico em leucócitos)",
      PRF: "PRF",
      "HA-reticulado": "HA reticulado",
      "HA-linear": "HA linear",
      desconhecido: "Não sabe",
    };
    const details = [
      prpType ? prpTypeLabels[prpType] ?? prpType : undefined,
      prpSessions != null ? `${prpSessions} sessão(ões)` : undefined,
      prpDate,
      a.priorResponse ? `Resposta ${responseLabels[a.priorResponse] ?? a.priorResponse}` : undefined,
      prpDuration ? `Duração do efeito: ${prpDuration}` : undefined,
    ].filter(Boolean);
    infiltrationDetails.push(`PRP/HA prévio: ${a.priorPrpHa === undefined ? "Não informado" : a.priorPrpHa ? `Sim${details.length ? ` — ${details.join(" · ")}` : ""}` : "Não"}`);
  }

  const rows = [
    {
      label: "Tabagismo",
      value: a.tabagismo
        ? `${smokingLabels[a.tabagismo] ?? a.tabagismo}${[
          cigarettesPerDay != null ? `${cigarettesPerDay} cigarros/dia` : undefined,
          packYears != null ? `${packYears} maços-ano` : undefined,
        ].filter(Boolean).length ? ` — ${[
          cigarettesPerDay != null ? `${cigarettesPerDay} cigarros/dia` : undefined,
          packYears != null ? `${packYears} maços-ano` : undefined,
        ].filter(Boolean).join(" · ")}` : ""}`
        : "Não informado",
    },
    { label: "Consumo de álcool", value: a.alcool ? (alcoholLabels[a.alcool] ?? a.alcool) : "Não informado" },
    {
      label: "IMC / composição corporal",
      value: [
        a.obesityBmi != null ? `IMC ${a.obesityBmi.toFixed(1)} kg/m²` : a.obesity === true ? "Obesidade declarada" : undefined,
        waistCircumference != null ? `Circunferência abdominal ${waistCircumference} cm` : undefined,
      ].filter(Boolean).join(" · ") || "Não informado",
    },
    { label: "Diabetes / controle glicêmico", value: diabetesValue },
    {
      label: "Resistência à insulina",
      value: `${brFormatBoolean(a.insulinResistance)}${homaIr != null ? ` — HOMA-IR ${homaIr}` : ""}`,
    },
    {
      label: "Doença autoimune",
      value: a.autoimmune === true
        ? `Sim${a.autoimuneQual ? ` — ${a.autoimuneQual}` : ""}`
        : a.autoimmune === false ? "Não" : "Não informado",
    },
    {
      label: "Infecção recente",
      value: recentInfection === true
        ? `Sim${infectionDetail ? ` — ${infectionDetail}` : ""}`
        : recentInfection === false ? "Não" : "Não informado",
    },
    { label: "Qualidade do sono", value: a.sleepQuality ? (sleepQualityLabels[a.sleepQuality] ?? a.sleepQuality) : "Não informado" },
    { label: "Horas de sono", value: a.sleepHours != null ? `${a.sleepHours} hora(s) por noite` : "Não informado" },
    { label: "Apneia do sono", value: brFormatBoolean(a.sleepApnea) },
    { label: "Uso de CPAP", value: brFormatBoolean(usesCpap) },
    {
      label: "Atividade física",
      value: [
        a.sedentary === true ? "Sedentarismo" : a.sedentary === false ? "Não sedentário" : undefined,
        a.regularExercise === true ? "Exercício regular" : a.regularExercise === false ? "Sem exercício regular" : undefined,
        exerciseKind ? `Atividade: ${exerciseKind}` : undefined,
        exerciseFrequency ? `Frequência: ${exerciseFrequency}` : undefined,
        occupationalOverload === true ? "Sobrecarga ocupacional" : undefined,
      ].filter(Boolean).join(" · ") || "Não informado",
    },
    { label: "Perfil alimentar — proteína", value: a.protein ? (proteinLabels[a.protein] ?? a.protein) : "Não informado" },
    { label: "Perfil alimentar — ultraprocessados", value: a.ultraprocessed ? (processedLabels[a.ultraprocessed] ?? a.ultraprocessed) : "Não informado" },
    {
      label: "Perfil alimentar — frutas e vegetais",
      value: lowFruitVegetables === true ? "Insuficiente" : fruitVegetables ? (fruitVegetableLabels[fruitVegetables] ?? fruitVegetables) : "Não informado",
    },
    {
      label: "Perda de peso recente",
      value: weightLossKg != null ? `${weightLossKg} kg` : recentWeightLoss === true ? "Sim" : recentWeightLoss === false ? "Não" : "Não informado",
    },
    {
      label: "Suplementos alimentares",
      value: usesSupplements === true
        ? `Sim${supplementDetails ? ` — ${supplementDetails}` : ""}`
        : usesSupplements === false ? "Não" : "Não informado",
    },
    { label: "Medicações interferentes", value: medications.length ? medications.join(" · ") : hasMedicationAnswer ? "Nenhuma declarada" : "Não informado" },
    {
      label: "Cirurgia prévia",
      value: priorSurgery === true
        ? `Sim${[priorSurgeryDetail, priorSurgeryImplants ? `Implantes: ${priorSurgeryImplants}` : undefined].filter(Boolean).length ? ` — ${[priorSurgeryDetail, priorSurgeryImplants ? `Implantes: ${priorSurgeryImplants}` : undefined].filter(Boolean).join(" · ")}` : ""}`
        : priorSurgery === false ? "Não" : "Não informado",
    },
    { label: "Histórico de infiltrações / PRP", value: infiltrationDetails.length ? infiltrationDetails.join(" · ") : "Não informado" },
  ];
  if (locale !== "es") return rows.map(row => ({ ...row, value: restoreFreeText(row.value) }));
  return rows.map(row => ({
    label: SPANISH_ANAMNESIS_LABELS[row.label] ?? row.label,
    value: restoreFreeText(spanishAnamnesisValue(row.value)),
  }));
}

export function brHasAnamnesisData(raw: unknown): raw is Record<string, any> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
  return Object.values(raw).some(value =>
    value !== null
    && value !== undefined
    && value !== ""
    && !(Array.isArray(value) && value.length === 0),
  );
}

interface BRInput {
  activeInfection?: boolean; malignancy?: boolean; dm?: boolean; hba1c?: number | null;
  imc?: number | null; anticoagulant?: boolean; immunosuppressed?: boolean;
  anamnese?: Record<string, any>; labFlagCount?: number; plateletCount?: number | null;
  latestVas?: number | null; hasAdverseEvent?: boolean;
  priorTreatments?: string[];
}

function brComputeScore(inp: BRInput): { score: number; gradeLabel: string; gradeColor: string; factors: BRFactor[]; isIncomplete: boolean; topRecommendations: string[] } {
  const a = brNormalizeAnam(inp.anamnese);

  // Factor: contraindications
  let fContra: BRFactor;
  if (inp.activeInfection === true) fContra = brFac("contraindications", "Contraindicações absolutas", "Clínico", 0, "red", "Infecção ativa presente", false, "Tratar e resolver a infecção antes de considerar o procedimento.");
  else if (inp.malignancy === true) fContra = brFac("contraindications", "Contraindicações absolutas", "Clínico", 0, "red", "Neoplasia ativa presente", false, "Neoplasia ativa contraindica uso de ortobiológicos com potencial proliferativo.");
  else if (inp.activeInfection === false && inp.malignancy === false) fContra = brFac("contraindications", "Contraindicações absolutas", "Clínico", 10, "green", "Ausência de contraindicações absolutas confirmada", false);
  else fContra = brFac("contraindications", "Contraindicações absolutas", "Clínico", 7, "na", "Não confirmado — verificar ausência de infecção ativa e neoplasia", false, "Confirmar ausência de contraindicações absolutas antes de prosseguir.");

  // Factor: smoking
  let fSmoke: BRFactor;
  const tabag = a.tabagismo;
  if (tabag === "sim") fSmoke = brFac("smoking", "Tabagismo", "Estilo de vida", 0, "red", "Fumante ativo", true, "Abstinência ao tabaco mínima de 4–6 semanas antes do procedimento.");
  else if (tabag === "ex-fumante") fSmoke = brFac("smoking", "Tabagismo", "Estilo de vida", 5, "yellow", "Ex-fumante", true, "Manter abstinência contínua.");
  else if (tabag === "não") fSmoke = brFac("smoking", "Tabagismo", "Estilo de vida", 10, "green", "Não fuma", true);
  else fSmoke = brFac("smoking", "Tabagismo", "Estilo de vida", 7, "na", "Não informado", true, "Confirmar status tabágico.");

  // Factor: glycemic
  const hba1c = inp.hba1c != null ? inp.hba1c : (a.hba1c ?? null);
  const hasDm = inp.dm || a.diabetesType === "DM1" || a.diabetesType === "DM2";
  const isPreDiab = a.diabetesType === "pré-diabetes";
  let fGlyc: BRFactor;
  if (!hasDm && !isPreDiab && a.diabetesType == null && !inp.dm) fGlyc = brFac("glycemic", "Controle Glicêmico", "Metabólico", 8, "na", "Não informado", true, "Confirmar presença de diabetes e solicitar HbA1c.");
  else if (a.diabetesType === "não" && !inp.dm) fGlyc = brFac("glycemic", "Controle Glicêmico", "Metabólico", 10, "green", "Sem diabetes", true);
  else if (isPreDiab) fGlyc = brFac("glycemic", "Controle Glicêmico", "Metabólico", 7, "yellow", "Pré-diabetes", true, "Controle glicêmico e dieta.");
  else if (hasDm && hba1c != null) {
    if (hba1c <= 7.0) fGlyc = brFac("glycemic", "Controle Glicêmico", "Metabólico", 8, "green", `DM · HbA1c ${hba1c}% (controlado)`, true);
    else if (hba1c <= 7.5) fGlyc = brFac("glycemic", "Controle Glicêmico", "Metabólico", 5, "yellow", `DM · HbA1c ${hba1c}%`, true, "HbA1c entre 7–7,5% — otimize o controle glicêmico.");
    else if (hba1c <= 8.0) fGlyc = brFac("glycemic", "Controle Glicêmico", "Metabólico", 2, "red", `DM · HbA1c ${hba1c}% (subótimo)`, true, "HbA1c > 7,5% — controle inadequado.");
    else fGlyc = brFac("glycemic", "Controle Glicêmico", "Metabólico", 0, "red", `DM · HbA1c ${hba1c}% (inadequado)`, true, "HbA1c > 8% — contraindicação relativa.");
  } else if (hasDm) fGlyc = brFac("glycemic", "Controle Glicêmico", "Metabólico", 4, "yellow", "DM sem HbA1c registrado", true, "Registre a HbA1c atual.");
  else fGlyc = brFac("glycemic", "Controle Glicêmico", "Metabólico", 8, "na", "Não informado", true, "Confirmar presença de diabetes.");

  // Factor: BMI
  const imc = inp.imc != null ? inp.imc : (a.obesityBmi ?? null);
  let fBmi: BRFactor;
  if (imc == null) fBmi = brFac("bmi", "IMC / Composição corporal", "Metabólico", 7, "na", "IMC não calculado", true, "Registre peso e altura.");
  else {
    const L = `IMC ${imc.toFixed(1)} kg/m²`;
    if (imc < 25) fBmi = brFac("bmi", "IMC / Composição corporal", "Metabólico", 10, "green", L, true);
    else if (imc < 30) fBmi = brFac("bmi", "IMC / Composição corporal", "Metabólico", 8, "green", `${L} (sobrepeso leve)`, true, "Redução modesta de peso melhora a resposta.");
    else if (imc < 35) fBmi = brFac("bmi", "IMC / Composição corporal", "Metabólico", 5, "yellow", `${L} (obesidade grau I)`, true, "Alvo: IMC < 30 antes do procedimento.");
    else if (imc < 40) fBmi = brFac("bmi", "IMC / Composição corporal", "Metabólico", 2, "red", `${L} (obesidade grau II)`, true, "Programa de emagrecimento multidisciplinar.");
    else fBmi = brFac("bmi", "IMC / Composição corporal", "Metabólico", 0, "red", `${L} (obesidade grau III)`, true, "Adiar e tratar obesidade.");
  }

  // Factor: activity
  let fActivity: BRFactor;
  if (a.sedentary === undefined && a.regularExercise === undefined) fActivity = brFac("activity", "Atividade Física", "Estilo de vida", 6, "na", "Não informado", true, "Avaliar nível de atividade física.");
  else if (a.sedentary === true) fActivity = brFac("activity", "Atividade Física", "Estilo de vida", 2, "red", "Sedentarismo", true, "Iniciar programa de atividade física aeróbica.");
  else if (a.regularExercise === true) fActivity = brFac("activity", "Atividade Física", "Estilo de vida", 10, "green", "Exercício regular", true);
  else fActivity = brFac("activity", "Atividade Física", "Estilo de vida", 6, "yellow", "Atividade física moderada / irregular", true, "Regularizar exercício aeróbico.");

  // Factor: sleep
  let fSleep: BRFactor;
  if (a.sleepHours == null && a.sleepQuality == null && a.sleepApnea == null) {
    fSleep = brFac("sleep", "Qualidade do Sono", "Estilo de vida", 7, "na", "Não informado", true, "Avaliar sono — privação crônica eleva cortisol.");
  } else {
    let slScore = 10; const slDets: string[] = [];
    if (a.sleepHours != null) { slDets.push(`${a.sleepHours}h/noite`); if (a.sleepHours < 6) slScore -= 5; else if (a.sleepHours < 7) slScore -= 2; }
    if (a.sleepQuality === "ruim") { slScore -= 3; slDets.push("qualidade ruim"); } else if (a.sleepQuality === "regular") { slScore -= 1; slDets.push("qualidade regular"); }
    if (a.sleepApnea) { slScore -= 2; slDets.push("apneia do sono"); }
    slScore = Math.max(0, slScore);
    const slSt: FactorStatus = slScore >= 8 ? "green" : slScore >= 5 ? "yellow" : "red";
    fSleep = brFac("sleep", "Qualidade do Sono", "Estilo de vida", slScore, slSt, slDets.join(" · ") || "Registrado", true, slSt !== "green" ? "Higiene do sono, avaliação de apneia." : undefined);
  }

  // Factor: inflammatory profile
  let fInflam: BRFactor;
  if (a.alcool == null && a.protein == null && a.ultraprocessed == null && a.insulinResistance == null && a.autoimmune == null) {
    fInflam = brFac("inflammatory", "Perfil Inflamatório Sistêmico", "Metabólico", 7, "na", "Não informado", true, "Avaliar hábitos alimentares e marcadores metabólicos.");
  } else {
    let infDeducao = 0; const infFats: string[] = [];
    if (a.alcool === "frequente") { infDeducao += 4; infFats.push("álcool frequente"); } else if (a.alcool === "social") { infDeducao += 1; infFats.push("álcool social"); }
    if (a.ultraprocessed === "frequente") { infDeducao += 2; infFats.push("dieta inflamatória"); }
    if (a.protein === "insuficiente") { infDeducao += 2; infFats.push("proteína insuficiente"); }
    if (a.insulinResistance) { infDeducao += 3; infFats.push("resistência à insulina"); }
    if (a.autoimmune) { const q = a.autoimuneQual ? ` (${a.autoimuneQual})` : ""; infDeducao += 3; infFats.push(`doença autoimune${q}`); }
    const infScore = Math.max(0, 10 - infDeducao);
    const infSt: FactorStatus = infScore >= 8 ? "green" : infScore >= 5 ? "yellow" : "red";
    fInflam = brFac("inflammatory", "Perfil Inflamatório Sistêmico", "Metabólico", infScore, infSt, infFats.join(" · ") || "Perfil adequado", true, infSt !== "green" ? "Dieta anti-inflamatória, redução de álcool, controle metabólico." : undefined);
  }

  // Factor: medications
  const anyMedData = a.corticosteroids != null || a.nsaids != null || a.immunosuppressants != null || a.anticoagulants != null || a.glp1Agonists != null;
  const hasCaseMeds = inp.anticoagulant || inp.immunosuppressed;
  let fMeds: BRFactor;
  if (!anyMedData && !hasCaseMeds) {
    fMeds = brFac("medications", "Medicações Interferentes", "Clínico", 8, "na", "Não informado", false, "Verificar uso de corticoides, AINEs, anticoagulantes e imunossupressores.");
  } else {
    const imunoSup = inp.immunosuppressed || a.immunosuppressants === true;
    const cort = a.corticosteroids === true; const aines = a.nsaids === true;
    const anticoag = inp.anticoagulant || a.anticoagulants === true; const glp1 = a.glp1Agonists === true;
    const medList: string[] = []; let medScore = 10;
    if (imunoSup) { medScore -= 5; medList.push("imunossupressor"); }
    if (cort) { medScore -= 3; medList.push("corticoide"); }
    if (anticoag) { medScore -= 2; medList.push("anticoagulante"); }
    if (aines) { medScore -= 2; medList.push("AINE"); }
    if (glp1) { medScore = Math.min(10, medScore + 1); medList.push("GLP-1 agonista ✓"); }
    medScore = Math.max(0, medScore);
    const medSt: FactorStatus = medScore >= 8 ? "green" : medScore >= 5 ? "yellow" : "red";
    const medRec = (imunoSup || cort) ? "Avaliar ajuste com equipe assistente." : anticoag ? "Planejar washout do anticoagulante." : undefined;
    fMeds = brFac("medications", "Medicações Interferentes", "Clínico", medScore, medSt, medList.join(" · ") || "Sem medicações interferentes", false, medRec);
  }

  // Factor: prior response
  let fPrior: BRFactor;
  if (a.priorPrpHa == null && a.priorInfiltrations == null) {
    fPrior = brFac("priorResponse", "Histórico de Tratamento", "Clínico", 8, "na", "Sem histórico de tratamentos regenerativos prévios", false);
  } else {
    let prScore = 10; const prDets: string[] = [];
    if (a.priorResponse === "boa") prDets.push("boa resposta a PRP/HA prévia");
    else if (a.priorResponse === "parcial") { prScore -= 3; prDets.push("resposta parcial a PRP/HA"); }
    else if (a.priorResponse === "sem resposta") { prScore -= 7; prDets.push("sem resposta a PRP/HA prévia"); }
    if (a.priorInfiltrations === true && a.priorInfiltrationsType === "corticoide" && (a.priorInfiltrationsCount ?? 0) >= 3) { prScore -= 5; prDets.push("≥3 infiltrações de corticoide"); }
    prScore = Math.max(0, prScore);
    const prSt: FactorStatus = prScore >= 8 ? "green" : prScore >= 5 ? "yellow" : "red";
    fPrior = brFac("priorResponse", "Histórico de Tratamento", "Clínico", prScore, prSt, prDets.join(" · ") || "Histórico registrado", false, prScore < 8 ? "Investigar técnica de preparo e fatores sistêmicos antes de novo ciclo." : undefined);
  }

  // Factor: labs
  const platelets = inp.plateletCount;
  let fLabs: BRFactor;
  if (inp.labFlagCount === undefined && platelets == null) {
    fLabs = brFac("labs", "Exames Laboratoriais", "Laboratorial", 6, "na", "Sem exames registrados", true, "Solicitar hemograma, glicemia, função renal e hepática.");
  } else {
    const flagCnt = inp.labFlagCount ?? 0; let labScore = 10; const labDets: string[] = [];
    if (flagCnt >= 5) { labScore -= 8; labDets.push(`${flagCnt} analitos alterados`); }
    else if (flagCnt >= 3) { labScore -= 5; labDets.push(`${flagCnt} analitos alterados`); }
    else if (flagCnt >= 1) { labScore -= 2; labDets.push(`${flagCnt} analito(s) alterado(s)`); }
    else labDets.push("exames dentro da normalidade");
    if (platelets != null && platelets < 100) { labScore -= 4; labDets.push(`plaquetas ${platelets} × 10³/µL (muito baixas)`); }
    else if (platelets != null && platelets < 150) { labScore -= 2; labDets.push(`plaquetas ${platelets} × 10³/µL (baixas)`); }
    labScore = Math.max(0, labScore);
    const labSt: FactorStatus = labScore >= 8 ? "green" : labScore >= 5 ? "yellow" : "red";
    fLabs = brFac("labs", "Exames Laboratoriais", "Laboratorial", labScore, labSt, labDets.join(" · "), true, labSt !== "green" ? "Normalizar analitos alterados antes do procedimento." : undefined);
  }

  const factors = [fContra, fSmoke, fGlyc, fBmi, fActivity, fSleep, fInflam, fMeds, fPrior, fLabs];
  const scored = factors.filter(f => f.status !== "na");
  const totalPossible = scored.length * 10;
  const score = totalPossible === 0 ? 0 : Math.round(scored.reduce((s, f) => s + f.score, 0) / totalPossible * 100);
  const isIncomplete = scored.length < 4;

  let gradeLabel: string; let gradeColor: string;
  if (score >= 90) { gradeLabel = "Excelente candidato"; gradeColor = "#059669"; }
  else if (score >= 70) { gradeLabel = "Bom candidato"; gradeColor = "#0284C7"; }
  else if (score >= 50) { gradeLabel = "Otimizar antes do procedimento"; gradeColor = "#D97706"; }
  else { gradeLabel = "Adiar — corrigir fatores"; gradeColor = "#DC2626"; }

  const topRecommendations = factors
    .filter(f => (f.status === "red" || f.status === "yellow") && f.recommendation && f.modifiable)
    .sort((a, b) => (b.maxScore - b.score) - (a.maxScore - a.score))
    .slice(0, 3)
    .map(f => f.recommendation!);

  return { score, gradeLabel, gradeColor, factors, isIncomplete, topRecommendations };
}

function localizeBioReady(result: ReturnType<typeof brComputeScore>, locale: ReturnType<typeof resolveDoctorLocale>) {
  if (locale !== "es") return result;
  const text: Record<string, string> = {
    "Contraindicações absolutas": "Contraindicaciones absolutas", "Tabagismo": "Tabaquismo",
    "Controle Glicêmico": "Control glucémico", "IMC / Composição corporal": "IMC / composición corporal",
    "Atividade Física": "Actividad física", "Qualidade do Sono": "Calidad del sueño",
    "Perfil Inflamatório Sistêmico": "Perfil inflamatorio sistémico",
    "Medicações Interferentes": "Medicamentos que interfieren", "Histórico de Tratamento": "Antecedentes de tratamiento",
    "Exames Laboratoriais": "Análisis de laboratorio", "Clínico": "Clínico", "Metabólico": "Metabólico", "Laboratorial": "Laboratorio",
    "Não informado": "No informado", "Infecção ativa presente": "Infección activa presente",
    "Neoplasia ativa presente": "Neoplasia activa presente", "Ausência de contraindicações absolutas confirmada": "Ausencia de contraindicaciones absolutas confirmada",
    "Fumante ativo": "Fumador activo", "Ex-fumante": "Exfumador", "Não fuma": "No fuma",
    "Sem diabetes": "Sin diabetes", "Pré-diabetes": "Prediabetes", "DM sem HbA1c registrado": "DM sin HbA1c registrada",
    "IMC não calculado": "IMC no calculado", "Sedentarismo": "Sedentarismo", "Exercício regular": "Ejercicio regular",
    "Atividade física moderada / irregular": "Actividad física moderada / irregular", "Perfil adequado": "Perfil adecuado",
    "Sem medicações interferentes": "Sin medicamentos que interfieren", "Histórico registrado": "Antecedentes registrados",
    "Sem exames registrados": "Sin análisis registrados", "exames dentro da normalidade": "análisis dentro de la normalidad",
    "Excelente candidato": "Candidato excelente", "Bom candidato": "Buen candidato",
    "Otimizar antes do procedimento": "Optimizar antes del procedimiento", "Adiar — corrigir fatores": "Posponer — corregir factores",
    "Tratar e resolver a infecção antes de considerar o procedimento.": "Tratar y resolver la infección antes de considerar el procedimiento.",
    "Neoplasia ativa contraindica uso de ortobiológicos com potencial proliferativo.": "La neoplasia activa contraindica el uso de ortobiológicos con potencial proliferativo.",
    "Confirmar ausência de contraindicações absolutas antes de prosseguir.": "Confirmar la ausencia de contraindicaciones absolutas antes de continuar.",
    "Abstinência ao tabaco mínima de 4–6 semanas antes do procedimento.": "Abstinencia de tabaco durante al menos 4–6 semanas antes del procedimiento.",
    "Manter abstinência contínua.": "Mantener la abstinencia continua.", "Confirmar status tabágico.": "Confirmar el estado de tabaquismo.",
    "Controle glicêmico e dieta.": "Control glucémico y dieta.", "Registre a HbA1c atual.": "Registre la HbA1c actual.",
    "Confirmar presença de diabetes e solicitar HbA1c.": "Confirmar la presencia de diabetes y solicitar HbA1c.",
    "Registre peso e altura.": "Registre peso y altura.", "Avaliar nível de atividade física.": "Evaluar el nivel de actividad física.",
    "Iniciar programa de atividade física aeróbica.": "Iniciar un programa de actividad física aeróbica.",
    "Regularizar exercício aeróbico.": "Regularizar el ejercicio aeróbico.", "Higiene do sono, avaliação de apneia.": "Higiene del sueño, evaluación de apnea.",
    "Avaliar sono — privação crônica eleva cortisol.": "Evaluar el sueño — la privación crónica eleva el cortisol.",
    "Redução modesta de peso melhora a resposta.": "Una reducción moderada de peso mejora la respuesta.",
    "Alvo: IMC < 30 antes do procedimento.": "Objetivo: IMC < 30 antes del procedimiento.",
    "Avaliar hábitos alimentares e marcadores metabólicos.": "Evaluar hábitos alimentarios y marcadores metabólicos.",
    "Dieta anti-inflamatória, redução de álcool, controle metabólico.": "Dieta antiinflamatoria, reducción de alcohol y control metabólico.",
    "Verificar uso de corticoides, AINEs, anticoagulantes e imunossupressores.": "Verificar el uso de corticoides, AINE, anticoagulantes e inmunosupresores.",
    "Avaliar ajuste com equipe assistente.": "Evaluar el ajuste con el equipo asistencial.", "Planejar washout do anticoagulante.": "Planificar la suspensión temporal del anticoagulante.",
    "Investigar técnica de preparo e fatores sistêmicos antes de novo ciclo.": "Investigar la técnica de preparación y factores sistémicos antes de un nuevo ciclo.",
    "Solicitar hemograma, glicemia, função renal e hepática.": "Solicitar hemograma, glucemia y función renal y hepática.",
    "Normalizar analitos alterados antes do procedimento.": "Normalizar los analitos alterados antes del procedimiento.",
  };
  const translate = (value: string) => text[value] ?? value
    .replace("Não confirmado — verificar ausência de infecção ativa e neoplasia", "No confirmado — verificar ausencia de infección activa y neoplasia")
    .replace("Confirmar presença de diabetes", "Confirmar la presencia de diabetes")
    .replace("HbA1c entre", "HbA1c entre").replace("otimize o controle glicêmico", "optimice el control glucémico")
    .replace("controle inadequado", "control inadecuado").replace("contraindicação relativa", "contraindicación relativa")
    .replace("sobrepeso leve", "sobrepeso leve").replace("obesidade grau", "obesidad grado")
    .replace("Programa de emagrecimento multidisciplinar.", "Programa multidisciplinario de pérdida de peso.")
    .replace("Adiar e tratar obesidade.", "Posponer y tratar la obesidad.")
    .replace("qualidade ruim", "calidad deficiente").replace("qualidade regular", "calidad regular")
    .replace("apneia do sono", "apnea del sueño").replace("álcool frequente", "alcohol frecuente")
    .replace("álcool social", "alcohol social").replace("dieta inflamatória", "dieta inflamatoria")
    .replace("proteína insuficiente", "proteína insuficiente").replace("resistência à insulina", "resistencia a la insulina")
    .replace("doença autoimune", "enfermedad autoinmune").replace("imunossupressor", "inmunosupresor")
    .replace("corticoide", "corticoide").replace("anticoagulante", "anticoagulante")
    .replace("boa resposta a PRP/HA prévia", "buena respuesta previa a PRP/HA")
    .replace("resposta parcial a PRP/HA", "respuesta parcial a PRP/HA")
    .replace("sem resposta a PRP/HA prévia", "sin respuesta previa a PRP/HA")
    .replace("infiltrações de corticoide", "infiltraciones de corticoide")
    .replace("analitos alterados", "analitos alterados").replace("plaquetas", "plaquetas")
    .replace("muito baixas", "muy bajas").replace("baixas", "bajas");
  return {
    ...result,
    gradeLabel: translate(result.gradeLabel),
    factors: result.factors.map(f => ({ ...f, label: translate(f.label), category: translate(f.category), detail: translate(f.detail), recommendation: f.recommendation ? translate(f.recommendation) : undefined })),
    topRecommendations: result.topRecommendations.map(translate),
  };
}

router.get("/regen/cases/:id/clinical-report", requireAuth, async (req: any, res) => {
  // A missing case has no owner from which to derive a locale.
  let locale = await localeForDoctorId(req.doctorId);
  try {
    // Fetch case + doctor
    const { rows: caseRows } = await pool.query(
      `SELECT c.*, d.nome AS doctor_name, d.crm AS doctor_crm, d.especialidade AS doctor_esp, d.idioma AS doctor_locale
       FROM regen_cases c
       JOIN doctors d ON d.id = c.doctor_id
       WHERE c.id = $1 AND c.doctor_id = $2`,
      [req.params.id, req.doctorId],
    );
    if (!caseRows.length) return res.status(404).json({ error: message(locale, "caseNotFound") });
    const c = caseRows[0];
    locale = resolveDoctorLocale(c.doctor_locale);

    // Fetch procedures
    const { rows: procedures } = await pool.query(
      `SELECT * FROM regen_procedures WHERE case_id = $1 ORDER BY performed_at ASC`,
      [req.params.id],
    );

    // Fetch lab results
    const { rows: labs } = await pool.query(
      `SELECT * FROM regen_lab_results WHERE case_id = $1 ORDER BY collected_at ASC`,
      [req.params.id],
    );

    // Fetch PROMs
    const { rows: proms } = await pool.query(
      `SELECT * FROM regen_prom_responses WHERE case_id = $1 ORDER BY answered_at ASC`,
      [req.params.id],
    );

    // Fetch follow-up scale responses with period info
    const { rows: followups } = await pool.query(
      `SELECT n.periodo, n.scheduled_date, n.days_after_procedure,
              r.nome_escala, r.score, r.completado_em
       FROM regen_followup_notifications n
       JOIN regen_scale_responses r ON r.notification_id = n.id
       WHERE n.case_id = $1
       ORDER BY n.days_after_procedure, r.completado_em`,
      [req.params.id],
    ).catch(() => ({ rows: [] as any[] }));

    const rawAnamnese = brHasAnamnesisData(c.anamnese_regen) ? c.anamnese_regen : undefined;

    // Compute BioReady Score server-side
    const sortedProms = [...proms].sort((a: any, b: any) => new Date(b.answered_at).getTime() - new Date(a.answered_at).getTime());
    const latestVas  = sortedProms.find((p: any) => p.instrument === "VAS")?.score ?? null;
    const plateletLab = labs.find((l: any) => /plaquet/i.test(l.analyte));
    const labFlagCount = labs.length === 0 ? undefined : labs.filter((l: any) => l.flag === "H" || l.flag === "L").length;

    const bioReady = localizeBioReady(brComputeScore({
      activeInfection: c.active_infection !== null ? c.active_infection : undefined,
      malignancy:      c.malignancy !== null ? c.malignancy : undefined,
      dm:              c.dm,
      hba1c:           c.hba1c ?? null,
      imc:             c.imc ? parseFloat(String(c.imc)) : null,
      anticoagulant:   c.anticoagulant,
      immunosuppressed: c.immunosuppressed,
      anamnese:        rawAnamnese ?? {},
      labFlagCount,
      plateletCount:   plateletLab ? parseFloat(String((plateletLab as any).value_num)) : null,
      latestVas,
      hasAdverseEvent: procedures.some((p: any) => p.adverse_event),
      priorTreatments: c.prior_treatments ?? [],
    }), locale);

    // Build PDF
    const patientName    = c.patient_name ?? message(locale, "unnamedPatient");
    const patientDob     = c.patient_dob ? localeDate(c.patient_dob, locale) : "";
    const patientSex     = sexForLocale(c.patient_sex, locale);
    const doctorName     = c.doctor_name ?? "";
    const doctorCrm      = c.doctor_crm  ?? "";
    const doctorEsp      = c.doctor_esp  ?? "";
    const conditionLabel = conditionNameForLocale(c.condition_code ?? "", locale);
    const conditionFull  = c.condition_custom ? `${conditionLabel} — ${c.condition_custom}` : conditionLabel;
    const reportDate     = localeDate(new Date(), locale);
    const dataCaso       = c.data_caso ? localeDate(c.data_caso, locale) : "";
    const ladoArticulacao = sideForLocale(c.lado_articulacao, locale);
    const hospitalLocal  = c.hospital_local   ?? "";
    const anamneseRows   = rawAnamnese ? brFormatAnamnesisRows(rawAnamnese, locale) : [];
    const plannedApplicationSites = applicationSitesForProductDetails(
      c.product_details && typeof c.product_details === "object"
        ? c.product_details as Record<string, string>
        : {},
    );
    const plannedApplicationNotes = c.product_details && typeof c.product_details === "object"
      && typeof (c.product_details as Record<string, unknown>).observacoes === "string"
      ? (c.product_details as Record<string, string>).observacoes
      : "";

    const doc    = new PDFDocument({ size: "A4", margin: 50 });
    const chunks: Buffer[] = [];
    doc.on("data", (ch: Buffer) => chunks.push(ch));
    doc.on("end", () => {
      const pdf = Buffer.concat(chunks);
      const safeName = patientName
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-zA-Z0-9 _-]/g, "").trim().replace(/\s+/g, "_");
      const filename = `DocSholder_LaudoClinico_${safeName}_${Date.now()}.pdf`;
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `inline; filename="${filename}"`);
      res.end(pdf);
    });

    const PAGE_W = 595;
    const MARGIN = 50;
    const INNER  = PAGE_W - MARGIN * 2;

    // Helper: check/add page break
    const checkPageBreak = (needed = 80) => {
      if (doc.y + needed > 770) { doc.addPage(); doc.y = MARGIN; }
    };

    // Helper: section heading
    const sectionHeading = (title: string) => {
      checkPageBreak(30);
      doc.moveDown(0.5);
      doc.rect(MARGIN, doc.y, INNER, 20).fill("#1E3A5F");
      doc.fontSize(9).fillColor("#FFFFFF").font("Helvetica-Bold")
         .text(title, MARGIN + 10, doc.y + 5, { width: INNER - 20 });
      doc.y += 20 + 6;
    };

    doc.y = MARGIN;

    // ── Title ──
    doc.fontSize(14).fillColor("#1E3A5F").font("Helvetica-Bold")
       .text(message(locale, "clinicalReport"), MARGIN, doc.y, { align: "center", width: INNER });
    doc.moveDown(0.2);
    doc.moveTo(MARGIN, doc.y).lineTo(PAGE_W - MARGIN, doc.y).strokeColor("#DBEAFE").lineWidth(1.5).stroke();
    doc.moveDown(0.6);

    // ── Patient / Doctor identification box ──
    const pBoxTop = doc.y;
    const pBoxH   = 110;
    doc.rect(MARGIN, pBoxTop, INNER, pBoxH).fill("#F0F9FF").stroke("#BFDBFE");
    doc.fillColor("#1E3A5F").font("Helvetica-Bold").fontSize(8)
        .text(message(locale, "identification"), MARGIN + 12, pBoxTop + 8);

    const col1 = MARGIN + 12;
    const col2 = MARGIN + INNER / 2 + 8;
    const rH   = 16;

    const fieldRow = (labelText: string, valueText: string, x: number, y: number, labelW = 80) => {
      doc.fontSize(8.5).fillColor("#374151");
      doc.font("Helvetica-Bold").text(labelText, x, y, { width: labelW, lineBreak: false });
      doc.font("Helvetica").text(valueText || "—", x + labelW, y, { width: INNER / 2 - labelW - 8, lineBreak: false });
    };

    fieldRow(message(locale, "patient"), patientName, col1, pBoxTop + 22);
    fieldRow(message(locale, "generation"), reportDate, col2, pBoxTop + 22, 56);
    fieldRow(message(locale, "birth"), patientDob, col1, pBoxTop + 22 + rH, 70);
    fieldRow(message(locale, "sex"), patientSex, col2, pBoxTop + 22 + rH, 32);
    fieldRow(message(locale, "condition"), conditionFull, col1, pBoxTop + 22 + rH * 2, 60);
    fieldRow(message(locale, "location"), [ladoArticulacao, hospitalLocal].filter(Boolean).join(" · "), col2, pBoxTop + 22 + rH * 2, 36);
    fieldRow(message(locale, "caseDate"), dataCaso, col1, pBoxTop + 22 + rH * 3, 64);
    if (doctorName) {
      const drLine = `${doctorName}${doctorCrm ? ` · CRM ${doctorCrm}` : ""}${doctorEsp ? ` · ${doctorEsp}` : ""}`;
      fieldRow(message(locale, "doctor"), drLine, col2, pBoxTop + 22 + rH * 3, 44);
    }

    doc.y = pBoxTop + pBoxH + 14;

    // ── BioReady Score ──
    sectionHeading(message(locale, "bioReadyTitle"));

    // Score badge + grade
    const badgeSize = 64;
    const badgeX    = MARGIN;
    const badgeY    = doc.y;
    const scoreColor = bioReady.score >= 70 ? "#059669" : bioReady.score >= 50 ? "#D97706" : "#DC2626";

    doc.rect(badgeX, badgeY, badgeSize, badgeSize).fill(scoreColor);
    doc.fontSize(22).fillColor("#FFFFFF").font("Helvetica-Bold")
       .text(String(bioReady.score), badgeX, badgeY + 12, { width: badgeSize, align: "center" });
    doc.fontSize(7.5).fillColor("#FFFFFF").font("Helvetica")
       .text("/100", badgeX, badgeY + 38, { width: badgeSize, align: "center" });

    const gradeX = badgeX + badgeSize + 14;
    doc.fontSize(13).fillColor(bioReady.gradeColor).font("Helvetica-Bold")
       .text(bioReady.gradeLabel, gradeX, badgeY + 10, { width: INNER - badgeSize - 14 });
    if (bioReady.isIncomplete) {
      doc.fontSize(7.5).fillColor("#6B7280").font("Helvetica")
          .text(message(locale, "partialScoreWarning"), gradeX, badgeY + 28, { width: INNER - badgeSize - 14 });
    }
    const dataCompPct = Math.round((bioReady.factors.filter(f => f.status !== "na").length / bioReady.factors.length) * 100);
    doc.fontSize(7.5).fillColor("#6B7280").font("Helvetica")
       .text(message(locale, "dataCompleteness", { percent: dataCompPct, completed: bioReady.factors.filter(f => f.status !== "na").length, total: bioReady.factors.length }), gradeX, badgeY + 42, { width: INNER - badgeSize - 14 });

    doc.y = badgeY + badgeSize + 10;

    // Factor checklist table
    const tblColLblW = 170;
    const tblColDetX = MARGIN + tblColLblW + 80;
    const tblColDetW = INNER - tblColLblW - 80;
    const tblColScX  = MARGIN + tblColLblW;
    const tblColScW  = 80;

    // Table header
    doc.rect(MARGIN, doc.y, tblColLblW, 14).fill("#EFF6FF").stroke("#BFDBFE");
    doc.rect(tblColScX, doc.y, tblColScW, 14).fill("#EFF6FF").stroke("#BFDBFE");
    doc.rect(tblColDetX, doc.y, tblColDetW, 14).fill("#EFF6FF").stroke("#BFDBFE");
    doc.fontSize(7.5).fillColor("#1E40AF").font("Helvetica-Bold")
         .text(message(locale, "factor"), MARGIN + 4, doc.y + 3, { width: tblColLblW - 8, lineBreak: false });
     doc.text(message(locale, "score"), tblColScX + 4, doc.y + 3, { width: tblColScW - 8, lineBreak: false });
     doc.text(message(locale, "detail"), tblColDetX + 4, doc.y + 3, { width: tblColDetW - 8, lineBreak: false });
    doc.y += 14;

    for (let i = 0; i < bioReady.factors.length; i++) {
      checkPageBreak(16);
      const f = bioReady.factors[i];
      const rowBg  = i % 2 === 0 ? "#FFFFFF" : "#F8FAFC";
      const stColor = f.status === "green" ? "#059669" : f.status === "red" ? "#DC2626" : f.status === "yellow" ? "#D97706" : "#9CA3AF";
      const stIcon  = f.status === "green" ? "✓" : f.status === "red" ? "✗" : f.status === "yellow" ? "!" : "–";
      const scoreLabel = f.status === "na" ? "N/A" : `${f.score}/10`;

      doc.rect(MARGIN, doc.y, tblColLblW, 14).fill(rowBg).stroke("#E2E8F0");
      doc.rect(tblColScX, doc.y, tblColScW, 14).fill(rowBg).stroke("#E2E8F0");
      doc.rect(tblColDetX, doc.y, tblColDetW, 14).fill(rowBg).stroke("#E2E8F0");

      doc.fontSize(7.5).fillColor(stColor).font("Helvetica-Bold")
         .text(`${stIcon} `, MARGIN + 4, doc.y + 3, { continued: true, width: 12 });
      doc.fillColor("#374151").font("Helvetica-Bold")
         .text(f.label, { lineBreak: false, width: tblColLblW - 20 });

      doc.fontSize(7.5).fillColor(stColor).font("Helvetica-Bold")
         .text(scoreLabel, tblColScX + 4, doc.y + 3, { width: tblColScW - 8, lineBreak: false, align: "center" });
      doc.fontSize(7).fillColor("#374151").font("Helvetica")
         .text(f.detail, tblColDetX + 4, doc.y + 3, { width: tblColDetW - 8, lineBreak: false });
      doc.y += 14;
    }

    // Top recommendations
    if (bioReady.topRecommendations.length > 0) {
      doc.moveDown(0.4);
      checkPageBreak(30);
      doc.fontSize(7.5).fillColor("#1E40AF").font("Helvetica-Bold")
         .text(message(locale, "topRecommendedActions"), MARGIN, doc.y);
      doc.y += 10;
      for (const rec of bioReady.topRecommendations) {
        checkPageBreak(12);
        doc.fontSize(7.5).fillColor("#374151").font("Helvetica")
           .text(`• ${rec}`, MARGIN + 6, doc.y, { width: INNER - 6 });
        doc.y += 10;
      }
    }

    // ── Regenerative history ──
    if (anamneseRows.length > 0) {
       sectionHeading(message(locale, "regenerativeAnamnesis"));

      const anamLabelW = 190;
      const anamValueX = MARGIN + anamLabelW;
      const anamValueW = INNER - anamLabelW;

      checkPageBreak(22);
      doc.rect(MARGIN, doc.y, anamLabelW, 14).fill("#EFF6FF").stroke("#BFDBFE");
      doc.rect(anamValueX, doc.y, anamValueW, 14).fill("#EFF6FF").stroke("#BFDBFE");
      doc.fontSize(7.5).fillColor("#1E40AF").font("Helvetica-Bold")
        .text(message(locale, "field"), MARGIN + 4, doc.y + 3, { width: anamLabelW - 8, lineBreak: false })
        .text(message(locale, "information"), anamValueX + 4, doc.y + 3, { width: anamValueW - 8, lineBreak: false });
      doc.y += 14;

      for (let i = 0; i < anamneseRows.length; i++) {
        const row = anamneseRows[i];
        doc.fontSize(8).font("Helvetica");
        const valueHeight = doc.heightOfString(row.value, { width: anamValueW - 12 });
        const rowHeight = Math.max(18, valueHeight + 8);
        checkPageBreak(rowHeight);
        const rowTop = doc.y;
        const rowBg = i % 2 === 0 ? "#FFFFFF" : "#F8FAFC";

        doc.rect(MARGIN, rowTop, anamLabelW, rowHeight).fill(rowBg).stroke("#E2E8F0");
        doc.rect(anamValueX, rowTop, anamValueW, rowHeight).fill(rowBg).stroke("#E2E8F0");
        doc.fontSize(8).fillColor("#374151").font("Helvetica-Bold")
          .text(row.label, MARGIN + 6, rowTop + 5, { width: anamLabelW - 12 });
        doc.font("Helvetica")
          .text(row.value, anamValueX + 6, rowTop + 5, { width: anamValueW - 12 });
        doc.y = rowTop + rowHeight;
      }
      doc.moveDown(0.4);
    }

    // ── Planned application sites ──
    if (plannedApplicationSites.length > 0 || plannedApplicationNotes) {
      sectionHeading(message(locale, "plannedApplicationSites"));
      for (let i = 0; i < plannedApplicationSites.length; i++) {
        const site = plannedApplicationSites[i];
        const location = applicationLocationForLocale(site.localAplicacao, locale) || "—";
        const guide = guidanceForLocale(site.guia, locale) || "—";
        const siteValue = `${message(locale, "anatomicalLocation")}: ${location} · ${message(locale, "applicationGuide")}: ${guide}`;
        checkPageBreak(18);
        const rowTop = doc.y;
        const rowBg = i % 2 === 0 ? "#FFFFFF" : "#F8FAFC";
        doc.rect(MARGIN, rowTop, INNER, 18).fill(rowBg).stroke("#E2E8F0");
        doc.fontSize(8).fillColor("#374151").font("Helvetica-Bold")
          .text(message(locale, "applicationSite", { count: i + 1 }), MARGIN + 6, rowTop + 4, { width: 125 });
        doc.font("Helvetica").text(siteValue, MARGIN + 132, rowTop + 4, { width: INNER - 138, lineBreak: false });
        doc.y = rowTop + 18;
      }
      if (plannedApplicationNotes) {
        checkPageBreak(24);
        doc.fontSize(8).fillColor("#6B7280").font("Helvetica-Bold")
          .text(`${message(locale, "notes")} `, MARGIN + 6, doc.y + 5, { continued: true });
        doc.font("Helvetica").fillColor("#374151")
          .text(plannedApplicationNotes, { width: INNER - 12 });
        doc.moveDown(0.4);
      }
    }

    // ── Procedures ──
    sectionHeading(message(locale, "performedProcedures", { count: procedures.length }));

    if (procedures.length === 0) {
      doc.fontSize(9).fillColor("#6B7280").font("Helvetica")
         .text(message(locale, "noRegisteredProcedure"), MARGIN, doc.y, { width: INNER });
      doc.moveDown(0.5);
    } else {
      // Compact table: product | date | access route | guidance | adverse event
      const pColW = [220, 70, 90, 80, INNER - 220 - 70 - 90 - 80];
      const pCols = [MARGIN, MARGIN + pColW[0], MARGIN + pColW[0] + pColW[1], MARGIN + pColW[0] + pColW[1] + pColW[2], MARGIN + pColW[0] + pColW[1] + pColW[2] + pColW[3]];
      const pHeaders = [message(locale, "product"), message(locale, "date"), message(locale, "accessRoute"), message(locale, "imageGuidance"), message(locale, "adverseEvent")];

      // Table header
      let hX = MARGIN;
      for (let h = 0; h < pHeaders.length; h++) {
        doc.rect(hX, doc.y, pColW[h], 14).fill("#EFF6FF").stroke("#BFDBFE");
        doc.fontSize(7.5).fillColor("#1E40AF").font("Helvetica-Bold")
           .text(pHeaders[h], hX + 4, doc.y + 3, { width: pColW[h] - 8, lineBreak: false });
        hX += pColW[h];
      }
      doc.y += 14;

      for (let i = 0; i < procedures.length; i++) {
        checkPageBreak(16);
        const p = procedures[i] as any;
        const rowBg = i % 2 === 0 ? "#FFFFFF" : "#F8FAFC";
        const productLabel = productNameForLocale(p.product_code, locale);
        const dateStr = p.performed_at ? localeDate(p.performed_at, locale) : "—";
        const adverseText = p.adverse_event
          ? (p.adverse_event_desc ? `${message(locale, "yes")}: ${p.adverse_event_desc}` : message(locale, "yes"))
          : message(locale, "no");
        const adverseColor = p.adverse_event ? "#DC2626" : "#374151";

        const cells = [
          productLabel,
          dateStr,
          accessRouteForLocale(p.access_route, locale) || "—",
          guidanceForLocale(p.guidance_mode, locale) || "—",
          adverseText,
        ];
        const cellColors = ["#374151","#374151","#374151","#374151", adverseColor];

        let cX = MARGIN;
        for (let ci = 0; ci < cells.length; ci++) {
          doc.rect(cX, doc.y, pColW[ci], 14).fill(rowBg).stroke("#E2E8F0");
          doc.fontSize(7.5).fillColor(cellColors[ci]).font("Helvetica")
             .text(cells[ci], cX + 4, doc.y + 3, { width: pColW[ci] - 8, lineBreak: false });
          cX += pColW[ci];
        }
        doc.y += 14;

        // If notes, show inline
        if (p.notes) {
          checkPageBreak(12);
          doc.fontSize(7).fillColor("#6B7280").font("Helvetica")
             .text(`  ${message(locale, "notes")} ${p.notes}`, MARGIN + 6, doc.y, { width: INNER - 12 });
          doc.y += 10;
        }
      }
      doc.moveDown(0.3);
    }

    // ── PROMs ──
    if (proms.length > 0) {
      sectionHeading(message(locale, "promResults", { count: proms.length }));
      const promColW = [INNER - 100 - 70, 100, 70];
      const promCols = [MARGIN, MARGIN + promColW[0], MARGIN + promColW[0] + promColW[1]];
      const promHeaders = [message(locale, "instrumentTimepoint"), message(locale, "score"), message(locale, "date")];
      let phX = MARGIN;
      for (let h = 0; h < promHeaders.length; h++) {
        doc.rect(phX, doc.y, promColW[h], 14).fill("#EFF6FF").stroke("#BFDBFE");
        doc.fontSize(7.5).fillColor("#1E40AF").font("Helvetica-Bold")
           .text(promHeaders[h], phX + 4, doc.y + 3, { width: promColW[h] - 8, lineBreak: false });
        phX += promColW[h];
      }
      doc.y += 14;

      for (let i = 0; i < proms.length; i++) {
        checkPageBreak(14);
        const p = proms[i] as any;
        const rowBg = i % 2 === 0 ? "#FFFFFF" : "#F8FAFC";
        const label = `${regenScaleForLocale(p.instrument, locale)} — ${regenPeriodForLocale(p.timepoint, locale)}`;
        const scoreStr = p.score != null ? String(p.score) : "—";
        const dateStr  = p.answered_at ? localeDate(p.answered_at, locale) : "—";
        const cells2 = [label, scoreStr, dateStr];
        let cX2 = MARGIN;
        for (let ci = 0; ci < cells2.length; ci++) {
          doc.rect(cX2, doc.y, promColW[ci], 14).fill(rowBg).stroke("#E2E8F0");
          doc.fontSize(7.5).fillColor("#374151").font("Helvetica")
             .text(cells2[ci], cX2 + 4, doc.y + 3, { width: promColW[ci] - 8, lineBreak: false });
          cX2 += promColW[ci];
        }
        doc.y += 14;
      }
      doc.moveDown(0.3);
    }

    // ── Follow-up Scale Responses ──
    if (followups.length > 0) {
      sectionHeading(message(locale, "followupResults", { count: followups.length }));
      const fuColW = [100, INNER - 100 - 70 - 80, 70, 80];
      const fuHeaders = clinicalReportFollowupHeaders(locale);
      let fuHX = MARGIN;
      for (let h = 0; h < fuHeaders.length; h++) {
        doc.rect(fuHX, doc.y, fuColW[h], 14).fill("#EFF6FF").stroke("#BFDBFE");
        doc.fontSize(7.5).fillColor("#1E40AF").font("Helvetica-Bold")
           .text(fuHeaders[h], fuHX + 4, doc.y + 3, { width: fuColW[h] - 8, lineBreak: false });
        fuHX += fuColW[h];
      }
      doc.y += 14;

      for (let i = 0; i < followups.length; i++) {
        checkPageBreak(14);
        const fu = followups[i] as any;
        const rowBg = i % 2 === 0 ? "#FFFFFF" : "#F8FAFC";
        const fuDate = fu.completado_em ? localeDate(fu.completado_em, locale) : "—";
        const fuScore = fu.score != null ? String(fu.score) : "—";
        const fuCells = [
          fu.periodo == null ? "—" : regenPeriodForLocale(fu.periodo, locale),
          fu.nome_escala == null ? "—" : regenScaleForLocale(fu.nome_escala, locale),
          fuScore,
          fuDate,
        ];
        let fuCX = MARGIN;
        for (let ci = 0; ci < fuCells.length; ci++) {
          doc.rect(fuCX, doc.y, fuColW[ci], 14).fill(rowBg).stroke("#E2E8F0");
          doc.fontSize(7.5).fillColor("#374151").font("Helvetica")
             .text(fuCells[ci], fuCX + 4, doc.y + 3, { width: fuColW[ci] - 8, lineBreak: false });
          fuCX += fuColW[ci];
        }
        doc.y += 14;
      }
      doc.moveDown(0.3);
    }

    // ── Signature block ──
    checkPageBreak(90);
    doc.moveDown(0.5);
    const sigY = doc.y + 20;
    const sigLineX = PAGE_W / 2 - 80;
    doc.moveTo(sigLineX, sigY + 40).lineTo(sigLineX + 160, sigY + 40).strokeColor("#374151").lineWidth(0.8).stroke();
    doc.fontSize(8.5).fillColor("#374151").font("Helvetica-Bold")
       .text(doctorName || message(locale, "responsibleDoctor"), sigLineX, sigY + 44, { width: 160, align: "center" });
    if (doctorCrm) {
      doc.fontSize(7.5).fillColor("#6B7280").font("Helvetica")
         .text(`CRM ${doctorCrm}${doctorEsp ? ` · ${doctorEsp}` : ""}`, sigLineX, sigY + 56, { width: 160, align: "center" });
    }
    doc.fontSize(7.5).fillColor("#9CA3AF").font("Helvetica")
       .text(message(locale, "generatedOn") + ` ${reportDate}`, sigLineX, sigY + 68, { width: 160, align: "center" });

    // ── Footer ──
    const footerY = doc.page.height - 28;
    doc.moveTo(MARGIN, footerY).lineTo(PAGE_W - MARGIN, footerY).strokeColor("#E2E8F0").lineWidth(0.8).stroke();
    doc.fontSize(7).fillColor("#9CA3AF").font("Helvetica")
       .text(
          message(locale, "confidential", { date: reportDate }),
         MARGIN, footerY + 5, { align: "center", width: INNER },
       );

    doc.end();
  } catch (e) {
    console.error("[regen/cases/clinical-report]", e);
    res.status(500).json({ error: message(locale, "reportGenerationFailed") });
  }
});

// ─── Follow-up Notifications ─────────────────────────────────────────────────

// GET /regen/cases/:id/notifications — timeline com respostas
router.get("/regen/cases/:id/notifications", requireAuth, async (req: any, res) => {
  try {
    const locale = await localeForDoctorId(req.doctorId);
    const { rows: notifs } = await pool.query(
      `SELECT n.*, 
         (SELECT COUNT(*) FROM regen_scale_responses r WHERE r.notification_id = n.id) AS response_count,
         (SELECT json_agg(json_build_object('nome_escala', r.nome_escala, 'score', r.score, 'completado_em', r.completado_em))
            FROM regen_scale_responses r WHERE r.notification_id = n.id) AS responses
       FROM regen_followup_notifications n
       WHERE n.case_id = $1
         AND EXISTS (SELECT 1 FROM regen_cases c WHERE c.id = $1 AND c.doctor_id = $2)
       ORDER BY n.days_after_procedure`,
      [req.params.id, req.doctorId]
    );
    res.json(notifs.map((notif: any) => regenNotificationForLocale(notif, locale)));
  } catch (e) {
    console.error("[regen/notifications GET]", e);
    res.status(500).json({ error: message(await localeForDoctorId(req.doctorId), "internalError") });
  }
});

// POST /regen/cases/:id/notifications/init — cria/reinicia cronograma baseado em data base
router.post("/regen/cases/:id/notifications/init", requireAuth, async (req: any, res) => {
  const client = await pool.connect();
  let locale = await localeForDoctorId(req.doctorId);
  try {
    const { baseDate } = req.body as { baseDate?: string };

    await client.query("BEGIN");
    await client.query(
      `SELECT pg_advisory_xact_lock(87003, hashtext($1))`,
      [String(req.params.id)],
    );

    const { rows } = await client.query(
      `SELECT * FROM regen_cases WHERE id = $1 AND doctor_id = $2`,
      [req.params.id, req.doctorId]
    );
    if (!rows.length) {
      await client.query("ROLLBACK");
      res.status(404).json({ error: message(locale, "caseNotFound") });
      return;
    }
    locale = await localeForDoctorId(rows[0].doctor_id);

    // Use provided date or today
    const base = baseDate ? new Date(baseDate) : new Date();

    // Check if notifications already exist — only add missing ones
    const { rows: existing } = await client.query(
      `SELECT periodo FROM regen_followup_notifications WHERE case_id = $1`,
      [req.params.id]
    );
    const existingPeriods = new Set(existing.map((r: any) => r.periodo));

    const toInsert = REGEN_FOLLOWUP_SCHEDULE.filter(s => !existingPeriods.has(s.periodo));

    for (const slot of toInsert) {
      const scheduledDate = new Date(base);
      scheduledDate.setDate(scheduledDate.getDate() + slot.days);
      await client.query(
        `INSERT INTO regen_followup_notifications (case_id, periodo, days_after_procedure, scheduled_date, scales)
         VALUES ($1, $2, $3, $4, $5)`,
        [req.params.id, slot.periodo, slot.days, scheduledDate.toISOString().split("T")[0], slot.scales]
      );
    }

    const { rows: notifs } = await client.query(
      `SELECT n.*,
         (SELECT COUNT(*) FROM regen_scale_responses r WHERE r.notification_id = n.id) AS response_count,
         (SELECT json_agg(json_build_object('nome_escala', r.nome_escala, 'score', r.score))
            FROM regen_scale_responses r WHERE r.notification_id = n.id) AS responses
       FROM regen_followup_notifications n
       WHERE n.case_id = $1
       ORDER BY n.days_after_procedure`,
      [req.params.id]
    );
    await client.query("COMMIT");
    res.json(notifs.map((notif: any) => regenNotificationForLocale(notif, locale)));
  } catch (e) {
    await client.query("ROLLBACK").catch(() => undefined);
    console.error("[regen/notifications/init]", e);
    res.status(500).json({ error: message(await localeForDoctorId(req.doctorId), "internalError") });
  } finally {
    client.release();
  }
});

// POST /regen/cases/:id/notifications/:notifId/prepare-whatsapp
// Cria token, gera link e mensagem pronta para WhatsApp
router.post("/regen/cases/:id/notifications/:notifId/prepare-whatsapp", requireAuth, async (req: any, res) => {
  let locale = await localeForDoctorId(req.doctorId);
  try {
    const { rows: notifRows } = await pool.query(
      `SELECT n.*, c.patient_name, c.patient_phone, c.condition_code,
              c.doctor_id AS owner_doctor_id, p.cpf AS patient_cpf
       FROM regen_followup_notifications n
       JOIN regen_cases c ON c.id = n.case_id
       LEFT JOIN patients p
         ON p.id = c.patient_id
        AND p.doctor_id = c.doctor_id
       WHERE n.id = $1 AND n.case_id = $2 AND c.doctor_id = $3`,
      [req.params.notifId, req.params.id, req.doctorId]
    );
    if (!notifRows.length) return res.status(404).json({ error: message(locale, "notificationNotFound") });

    const notif = notifRows[0];
    locale = await localeForDoctorId(notif.owner_doctor_id);
    if (!notif.patient_cpf) {
      return res.status(409).json({ error: message(locale, "identificationNotRegistered") });
    }

    // Ensure token
    const generatedToken = randomUUID();
    const { rows: tokenRows } = await pool.query(
      `UPDATE regen_followup_notifications
       SET token = COALESCE(token, $1)
       WHERE id = $2
       RETURNING token`,
      [generatedToken, notif.id],
    );
    const token = tokenRows[0]?.token as string | undefined;
    if (!token) return res.status(404).json({ error: message(locale, "notificationNotFound") });

    const { rows: doctorRows } = await pool.query(
      `SELECT nome, idioma FROM doctors WHERE id = $1`,
      [notif.owner_doctor_id]
    );
    const doctorNome = doctorRows[0]?.nome ?? "Dr.";
    locale = resolveDoctorLocale(doctorRows[0]?.idioma);

    const link = `${getBaseUrl(req)}/patient/regen/${token}`;
    const scalesText = notif.scales
      .map((scale: unknown) => regenScaleForLocale(scale, locale))
      .join(", ");
    const preparedMessage = message(locale, "regenFollowup", {
      patient: notif.patient_name,
      doctor: doctorNome,
      period: regenPeriodForLocale(notif.periodo, locale),
      scales: scalesText,
      link,
      identity: message(locale, "identityCpf"),
    });

    // Phone number — clean Brazilian format
    const rawPhone = (notif.patient_phone ?? "").replace(/\D/g, "");
    const phone = rawPhone.startsWith("55") ? rawPhone : rawPhone ? `55${rawPhone}` : null;

    res.json({
      token,
      link,
      message: preparedMessage,
      hasTelefone: !!phone,
      phone,
      notifId: notif.id,
    });
  } catch (e) {
    console.error("[regen/notifications/prepare-whatsapp]", e);
    res.status(500).json({ error: message(locale, "internalError") });
  }
});

// GET /regen/followup-overview — dashboard summary: vencidos, agendados, respondidos, aguardando
router.get("/regen/followup-overview", requireAuth, async (req: any, res) => {
  try {
    const did = req.doctorId;
    const locale = await localeForDoctorId(did);
    const today = new Date().toISOString().slice(0, 10);

    const { rows } = await pool.query(
      `SELECT
         n.id          AS notif_id,
         n.case_id,
         n.periodo,
         n.status,
         n.scheduled_date,
         n.sent_at,
         c.patient_name,
         c.patient_phone,
         c.condition_code,
         COALESCE(
           (SELECT COUNT(*) FROM regen_scale_responses r WHERE r.notification_id = n.id),
           0
         )::int AS response_count
       FROM regen_followup_notifications n
       JOIN regen_cases c ON c.id = n.case_id
       WHERE c.doctor_id = $1
       ORDER BY n.scheduled_date ASC NULLS LAST`,
      [did]
    );

    const vencidos:    typeof rows = [];
    const agendados:   typeof rows = [];
    const respondidos: typeof rows = [];
    const aguardando:  typeof rows = [];

    for (const r of rows) {
      if (r.response_count > 0 || r.status === "completed") {
        respondidos.push(r);
      } else if (r.status === "sent") {
        aguardando.push(r);
      } else if (r.scheduled_date && r.scheduled_date <= today) {
        vencidos.push(r);
      } else {
        agendados.push(r);
      }
    }

    res.json({
      vencidos: vencidos.map((row: any) => regenNotificationForLocale(row, locale)),
      agendados: agendados.map((row: any) => regenNotificationForLocale(row, locale)),
      respondidos: respondidos.map((row: any) => regenNotificationForLocale(row, locale)),
      aguardando: aguardando.map((row: any) => regenNotificationForLocale(row, locale)),
      counts: {
        vencidos: vencidos.length,
        agendados: agendados.length,
        respondidos: respondidos.length,
        aguardando: aguardando.length,
      },
    });
  } catch (e) {
    console.error("[regen/followup-overview]", e);
    res.status(500).json({ error: await requestMessage(req, "internalError") });
  }
});

// GET /regen/stats/by-product — contagem de procedimentos por produto para gráfico
router.get("/regen/stats/by-product", requireAuth, async (req: any, res) => {
  try {
    const did = req.doctorId;
    const { rows } = await pool.query(
      `SELECT
         p.product_code AS code,
         COALESCE(pr.name, p.product_code) AS label,
         COUNT(*)::int AS count
       FROM regen_procedures p
       JOIN regen_cases c ON c.id = p.case_id
       LEFT JOIN regen_products pr ON pr.code = p.product_code
       WHERE c.doctor_id = $1
       GROUP BY p.product_code, pr.name
       ORDER BY count DESC`,
      [did]
    );
    res.json(rows);
  } catch (e) {
    console.error("[regen/stats/by-product]", e);
    res.status(500).json({ error: await requestMessage(req, "internalError") });
  }
});

// GET /regen/stats/outcomes — scores médios por escala e período (para gráfico de evolução)
router.get("/regen/stats/outcomes", requireAuth, async (req: any, res) => {
  try {
    const did = req.doctorId;
    const locale = await localeForDoctorId(did);
    const { rows } = await pool.query(
      `SELECT
         sr.nome_escala,
         fn.periodo,
         ROUND(AVG(sr.score)::numeric, 1) AS avg_score,
         COUNT(*)::int AS n
       FROM regen_scale_responses sr
       JOIN regen_followup_notifications fn ON fn.id = sr.notification_id
       JOIN regen_cases c ON c.id = fn.case_id
       WHERE c.doctor_id = $1
         AND sr.score IS NOT NULL
       GROUP BY sr.nome_escala, fn.periodo
       ORDER BY sr.nome_escala,
                CASE fn.periodo
                  WHEN 'preop'  THEN 0
                  WHEN '30d'    THEN 1
                  WHEN '90d'    THEN 2
                  WHEN '180d'   THEN 3
                  WHEN '1y'     THEN 4
                  WHEN '2y'     THEN 5
                  WHEN '5y'     THEN 6
                  ELSE 99
                END`,
      [did]
    );
    res.json(rows.map((row: any) => ({
      ...row,
      nome_escala: regenScaleForLocale(row.nome_escala, locale),
      periodo: regenPeriodForLocale(row.periodo, locale),
    })));
  } catch (e) {
    console.error("[regen/stats/outcomes]", e);
    res.status(500).json({ error: await requestMessage(req, "internalError") });
  }
});

// PATCH /regen/cases/:id/notifications/:notifId — atualiza status
router.patch("/regen/cases/:id/notifications/:notifId", requireAuth, async (req: any, res) => {
  try {
    const { status } = req.body as { status: string };
    await pool.query(
      `UPDATE regen_followup_notifications SET status = $1, sent_at = CASE WHEN $1 = 'sent' THEN now() ELSE sent_at END
       WHERE id = $2 AND case_id = $3
         AND EXISTS (SELECT 1 FROM regen_cases c WHERE c.id = $3 AND c.doctor_id = $4)`,
      [status, req.params.notifId, req.params.id, req.doctorId]
    );
    res.json({ ok: true });
  } catch (e) {
    console.error("[regen/notifications PATCH]", e);
    res.status(500).json({ error: await requestMessage(req, "internalError") });
  }
});

export default router;
