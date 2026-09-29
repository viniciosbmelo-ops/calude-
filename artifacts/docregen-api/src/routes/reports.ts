import { Router, type IRouter } from "express";
import { pool } from "@workspace/docregen-db";
import { requireAuth } from "../middlewares/requireAuth";

const router: IRouter = Router();

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
