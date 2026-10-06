/**
 * Proteção só de inserção do apoio à decisão (gatilhos de lib/db/pre-push/0002):
 *   1. Com todos os gatilhos, escrita passa.
 *   2. Faltando algum: erro no log listando o que falta e escrita → 503 (leitura passa).
 *   3. Falha da consulta conta como ausente.
 *   4. Só SELECT em pg_trigger (sem DDL) e nova verificação só depois de RECHECK_MS.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NextFunction, Request, Response } from "express";

const mockPoolQuery = vi.fn();
const mockLogError = vi.fn();

vi.mock("@workspace/db", () => ({
  pool: { query: (...args: unknown[]) => mockPoolQuery(...args) },
}));
vi.mock("./logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: (...a: unknown[]) => mockLogError(...a), debug: vi.fn(), fatal: vi.fn() },
}));

import {
  RECHECK_MS,
  REQUIRED_APOIO_DECISAO_TRIGGERS,
  checkDecisionSupportProtection,
  decisionSupportWriteGuard,
  resetDecisionSupportProtectionState,
} from "./decision-support-protection";

const linhas = (ts: readonly { table: string; trigger: string }[]) => ({
  rows: ts.map((t) => ({ table_name: t.table, trigger_name: t.trigger })),
});

async function chamar(method: string) {
  const res = { statusCode: 200, body: undefined as unknown, status(c: number) { this.statusCode = c; return this; }, json(b: unknown) { this.body = b; return this; } };
  const next = vi.fn() as unknown as NextFunction & ReturnType<typeof vi.fn>;
  await decisionSupportWriteGuard({ method } as Request, res as unknown as Response, next);
  return { res, next };
}

beforeEach(() => {
  mockPoolQuery.mockReset();
  mockLogError.mockReset();
  resetDecisionSupportProtectionState();
});
afterEach(() => vi.useRealTimers());

describe("proteção só de inserção do apoio à decisão", () => {
  it("exige os gatilhos de linha e de TRUNCATE nas três tabelas", () => {
    expect(REQUIRED_APOIO_DECISAO_TRIGGERS).toHaveLength(6);
    for (const t of ["apoio_decisao_execucoes", "apoio_decisao_escolhas", "apoio_decisao_status"]) {
      expect(REQUIRED_APOIO_DECISAO_TRIGGERS).toContainEqual({ table: t, trigger: `${t}_so_insercao` });
      expect(REQUIRED_APOIO_DECISAO_TRIGGERS).toContainEqual({ table: t, trigger: `${t}_sem_truncate` });
    }
  });

  it("com todos os gatilhos: ok, sem erro, escrita passa; consulta só lê pg_trigger", async () => {
    mockPoolQuery.mockResolvedValue(linhas(REQUIRED_APOIO_DECISAO_TRIGGERS));
    await expect(checkDecisionSupportProtection()).resolves.toEqual({ ok: true, faltando: [] });
    expect(mockLogError).not.toHaveBeenCalled();
    const sql = String(mockPoolQuery.mock.calls[0][0]).toUpperCase();
    expect(sql.trim()).toMatch(/^SELECT/);
    expect(sql).toContain("PG_TRIGGER");
    expect(sql).not.toMatch(/CREATE |ALTER |DROP |INSERT |UPDATE |DELETE /);
    const { res, next } = await chamar("POST");
    expect(next).toHaveBeenCalledWith();
    expect(res.statusCode).toBe(200);
  });

  it("faltando um gatilho: erro no log e escrita 503; leitura passa", async () => {
    const semUm = REQUIRED_APOIO_DECISAO_TRIGGERS.filter((t) => t.trigger !== "apoio_decisao_escolhas_so_insercao");
    mockPoolQuery.mockResolvedValue(linhas(semUm));
    const r = await checkDecisionSupportProtection();
    expect(r.ok).toBe(false);
    expect(r.faltando).toEqual([{ table: "apoio_decisao_escolhas", trigger: "apoio_decisao_escolhas_so_insercao" }]);
    expect(mockLogError).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(mockLogError.mock.calls[0])).toMatch(/apoio_decisao_escolhas\.apoio_decisao_escolhas_so_insercao.*0002_apoio_decisao_insert_only/);

    const escrita = await chamar("POST");
    expect(escrita.next).not.toHaveBeenCalled();
    expect(escrita.res.statusCode).toBe(503);
    const leitura = await chamar("GET");
    expect(leitura.next).toHaveBeenCalledWith();
  });

  it("falha na consulta conta como proteção ausente", async () => {
    mockPoolQuery.mockRejectedValue(new Error("boom"));
    const r = await checkDecisionSupportProtection();
    expect(r.ok).toBe(false);
    expect(r.faltando).toHaveLength(6);
    expect((await chamar("POST")).res.statusCode).toBe(503);
  });

  it("verifica na primeira escrita, cacheia o ok e, se ausente, só verifica de novo depois de RECHECK_MS", async () => {
    vi.useFakeTimers();
    mockPoolQuery.mockResolvedValue(linhas([]));
    expect((await chamar("POST")).res.statusCode).toBe(503);
    expect((await chamar("POST")).res.statusCode).toBe(503);
    expect(mockPoolQuery).toHaveBeenCalledTimes(1);

    // Gatilhos aplicados depois: passa a valer sem reiniciar, após o intervalo.
    mockPoolQuery.mockResolvedValue(linhas(REQUIRED_APOIO_DECISAO_TRIGGERS));
    vi.advanceTimersByTime(RECHECK_MS);
    expect((await chamar("POST")).next).toHaveBeenCalledWith();
    expect((await chamar("PATCH")).next).toHaveBeenCalledWith();
    expect(mockPoolQuery).toHaveBeenCalledTimes(2);
  });
});
