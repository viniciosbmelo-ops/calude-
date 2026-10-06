import type { NextFunction, Request, Response } from "express";
import { pool } from "@workspace/db";
import { logger } from "./logger";

// ─────────────────────────────────────────────────────────────────────────────
// Apoio à decisão: proteção só de inserção no banco
//
// As tabelas apoio_decisao_* são trilha de auditoria. Os gatilhos de
// lib/db/pre-push/0002_apoio_decisao_insert_only.sql recusam UPDATE/DELETE/TRUNCATE
// fora dos caminhos legítimos (cascatas de FK e anonimização LGPD). Esse SQL roda
// no post-merge de desenvolvimento, mas NÃO no deploy de produção (lá é aplicado à
// mão). Se faltar, o servidor sobe (o resto do sistema não depende disso), registra
// um erro claro e mantém o apoio à decisão sem gravação: as rotas de escrita
// respondem 503 até que os gatilhos existam. Leitura (GET) segue normal.
//
// Só leitura de pg_trigger: nenhum DDL aqui.
// ─────────────────────────────────────────────────────────────────────────────

export interface RequiredTrigger {
  table: string;
  trigger: string;
}

const TABELAS = ["apoio_decisao_execucoes", "apoio_decisao_escolhas", "apoio_decisao_status"] as const;

/** Gatilhos criados por lib/db/pre-push/0002 (linha + TRUNCATE em cada tabela). */
export const REQUIRED_APOIO_DECISAO_TRIGGERS: readonly RequiredTrigger[] = TABELAS.flatMap((table) => [
  { table, trigger: `${table}_so_insercao` },
  { table, trigger: `${table}_sem_truncate` },
]);

/** Intervalo mínimo entre novas verificações enquanto a proteção está ausente. */
export const RECHECK_MS = 30_000;

type Estado = { ok: boolean; verificadoEm: number; faltando: RequiredTrigger[] } | undefined;
let estado: Estado;

/** Só para testes. */
export function resetDecisionSupportProtectionState(): void {
  estado = undefined;
}

/**
 * Verifica (só leitura) se os gatilhos existem e estão habilitados. Nunca lança: falha de consulta conta
 * como proteção ausente. Registra erro quando falta algo.
 */
export async function checkDecisionSupportProtection(): Promise<{ ok: boolean; faltando: RequiredTrigger[] }> {
  let faltando: RequiredTrigger[];
  try {
    const { rows } = await pool.query<{ table_name: string; trigger_name: string }>(
      `SELECT c.relname AS table_name, t.tgname AS trigger_name
         FROM pg_trigger t
         JOIN pg_class c ON c.oid = t.tgrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND NOT t.tgisinternal AND t.tgenabled <> 'D'
          AND c.relname = ANY($1::text[])`,
      [[...TABELAS]],
    );
    const existentes = new Set(rows.map((r) => `${r.table_name}.${r.trigger_name}`));
    faltando = REQUIRED_APOIO_DECISAO_TRIGGERS.filter((t) => !existentes.has(`${t.table}.${t.trigger}`));
  } catch (err) {
    logger.error({ err }, "Apoio à decisão: não foi possível verificar os gatilhos só de inserção");
    faltando = [...REQUIRED_APOIO_DECISAO_TRIGGERS];
  }
  const ok = faltando.length === 0;
  if (!ok) {
    logger.error(
      { faltando: faltando.map((t) => `${t.table}.${t.trigger}`) },
      "Apoio à decisão DESATIVADO para gravação: faltam os gatilhos só de inserção nas tabelas apoio_decisao_*. " +
        "Aplique lib/db/pre-push/0002_apoio_decisao_insert_only.sql (psql -v ON_ERROR_STOP=1 -f) neste banco; " +
        "as rotas de escrita do apoio à decisão respondem 503 até lá.",
    );
  }
  estado = { ok, verificadoEm: Date.now(), faltando };
  return { ok, faltando };
}

/** Estado atual; verifica na primeira chamada e, enquanto ausente, de novo a cada RECHECK_MS. */
export async function decisionSupportProtected(): Promise<boolean> {
  if (!estado || (!estado.ok && Date.now() - estado.verificadoEm >= RECHECK_MS)) {
    await checkDecisionSupportProtection();
  }
  return estado!.ok;
}

const LEITURA = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Middleware para montar em "/apoio-decisao" antes do roteador: escrita sem a proteção no banco → 503.
 */
export async function decisionSupportWriteGuard(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (LEITURA.has(req.method)) {
    next();
    return;
  }
  try {
    if (await decisionSupportProtected()) {
      next();
      return;
    }
  } catch (err) {
    next(err);
    return;
  }
  res.status(503).json({
    error: "Apoio à decisão indisponível: a proteção da trilha de auditoria não está instalada no banco.",
  });
}
