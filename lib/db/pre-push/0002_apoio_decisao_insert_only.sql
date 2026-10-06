-- Apoio à decisão: trilha de auditoria SÓ DE INSERÇÃO garantida no banco.
--
-- As tabelas (lib/db/src/schema/decision-support.ts) são só de inserção por contrato; até aqui isso valia
-- apenas no código. Estes gatilhos recusam UPDATE/DELETE diretos, com três exceções que fluxos existentes usam:
--
--   1. Ações referenciais das FKs (pg_trigger_depth() > 1 = a linha está sendo alterada por outro gatilho,
--      que aqui só pode ser o gatilho interno da FK):
--        - execucoes: ON DELETE CASCADE de doctors, patients e surgeries (DELETE /patients/:id, exclusão de
--          cirurgia ou de médico);
--        - escolhas:  ON DELETE CASCADE de execucoes e de doctors;
--        - status:    ON DELETE SET NULL de doctors (só `doctor_id` pode virar nulo).
--   2. Anonimização LGPD (POST /lgpd/anonymize/:patientId):
--        - execucoes: o UPDATE só pode reescrever as colunas jsonb com dados do paciente (entrada,
--          proveniencia, conflitos, resultado), deve deixar o resultado marcado `anonimizado: true` e não pode
--          mexer em nenhuma outra coluna (algoritmo, versão, hash, motor, status no momento, modo, vínculos, data);
--        - escolhas:  só o texto livre sai (justificativa → nulo, outra → '[anonimizado]' se havia texto).
--   3. Manutenção explícita: `SET LOCAL apoio_decisao.manutencao = 'on'` na transação libera tudo
--      (limpeza de testes, correção manual auditada). Nunca é usado pela aplicação.
--
-- Roda ANTES do drizzle-kit push (scripts/post-merge.sh). drizzle-kit não gerencia gatilhos, então não os
-- remove. Idempotente: CREATE OR REPLACE nas funções, DROP TRIGGER IF EXISTS + CREATE nos gatilhos. Num banco
-- novo as tabelas ainda não existem na primeira execução: os gatilhos são criados na execução seguinte do
-- post-merge. Produção não roda este diretório (o schema vem do diff do Publish): aplique este arquivo à mão
-- lá, uma vez, com psql -v ON_ERROR_STOP=1 -f.
BEGIN;
SET LOCAL client_min_messages = warning;

CREATE OR REPLACE FUNCTION apoio_decisao_manutencao() RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT coalesce(current_setting('apoio_decisao.manutencao', true), '') = 'on'
$$;

CREATE OR REPLACE FUNCTION apoio_decisao_execucoes_so_insercao() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF apoio_decisao_manutencao() THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF pg_trigger_depth() > 1 THEN RETURN OLD; END IF; -- cascata de médico/paciente/cirurgia
    RAISE EXCEPTION 'apoio_decisao_execucoes é só de inserção: DELETE recusado (id %)', OLD.id
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  -- UPDATE: só a anonimização LGPD, que reescreve as colunas jsonb e marca o resultado.
  IF (NEW.id, NEW.doctor_id, NEW.patient_id, NEW.surgery_id, NEW.algoritmo_id, NEW.algoritmo_versao,
      NEW.algoritmo_hash, NEW.status_no_momento, NEW.motor_versao, NEW.modo, NEW.params_ignorados, NEW.created_at)
     IS NOT DISTINCT FROM
     (OLD.id, OLD.doctor_id, OLD.patient_id, OLD.surgery_id, OLD.algoritmo_id, OLD.algoritmo_versao,
      OLD.algoritmo_hash, OLD.status_no_momento, OLD.motor_versao, OLD.modo, OLD.params_ignorados, OLD.created_at)
     AND jsonb_typeof(NEW.resultado) = 'object'
     AND NEW.resultado -> 'anonimizado' = 'true'::jsonb
  THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'apoio_decisao_execucoes é só de inserção: UPDATE recusado (id %); só a anonimização LGPD pode reescrever entrada/proveniencia/conflitos/resultado', OLD.id
    USING ERRCODE = 'insufficient_privilege';
END
$$;

CREATE OR REPLACE FUNCTION apoio_decisao_escolhas_so_insercao() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF apoio_decisao_manutencao() THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN
    RETURN OLD; -- cascata da execução ou do médico
  END IF;
  -- Anonimização LGPD: só apaga o texto livre (justificativa → nulo; "outra" → '[anonimizado]' quando havia
  -- texto). Opção, concordância, vínculos e data ficam iguais.
  IF TG_OP = 'UPDATE'
     AND (NEW.id, NEW.execucao_id, NEW.doctor_id, NEW.opcao, NEW.concordancia, NEW.created_at)
         IS NOT DISTINCT FROM
         (OLD.id, OLD.execucao_id, OLD.doctor_id, OLD.opcao, OLD.concordancia, OLD.created_at)
     AND NEW.justificativa IS NULL
     AND ((OLD.outra IS NULL AND NEW.outra IS NULL) OR (OLD.outra IS NOT NULL AND NEW.outra = '[anonimizado]'))
  THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'apoio_decisao_escolhas é só de inserção: % recusado (id %)', TG_OP, OLD.id
    USING ERRCODE = 'insufficient_privilege';
END
$$;

CREATE OR REPLACE FUNCTION apoio_decisao_status_so_insercao() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF apoio_decisao_manutencao() THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  -- ON DELETE SET NULL de doctors: só o autor vira nulo, o resto da linha fica igual.
  IF TG_OP = 'UPDATE' AND pg_trigger_depth() > 1 AND NEW.doctor_id IS NULL
     AND (NEW.id, NEW.algoritmo_id, NEW.algoritmo_versao, NEW.algoritmo_hash, NEW.status, NEW.nota, NEW.created_at)
         IS NOT DISTINCT FROM
         (OLD.id, OLD.algoritmo_id, OLD.algoritmo_versao, OLD.algoritmo_hash, OLD.status, OLD.nota, OLD.created_at)
  THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'apoio_decisao_status é só de inserção: % recusado (id %)', TG_OP, OLD.id
    USING ERRCODE = 'insufficient_privilege';
END
$$;

CREATE OR REPLACE FUNCTION apoio_decisao_sem_truncate() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF apoio_decisao_manutencao() THEN RETURN NULL; END IF;
  RAISE EXCEPTION '% é só de inserção: TRUNCATE recusado', TG_TABLE_NAME
    USING ERRCODE = 'insufficient_privilege';
END
$$;

DO $$
BEGIN
  IF to_regclass('public.apoio_decisao_execucoes') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS apoio_decisao_execucoes_so_insercao ON apoio_decisao_execucoes;
    CREATE TRIGGER apoio_decisao_execucoes_so_insercao
      BEFORE UPDATE OR DELETE ON apoio_decisao_execucoes
      FOR EACH ROW EXECUTE FUNCTION apoio_decisao_execucoes_so_insercao();
    -- TRUNCATE não dispara gatilho de linha.
    DROP TRIGGER IF EXISTS apoio_decisao_execucoes_sem_truncate ON apoio_decisao_execucoes;
    CREATE TRIGGER apoio_decisao_execucoes_sem_truncate
      BEFORE TRUNCATE ON apoio_decisao_execucoes
      FOR EACH STATEMENT EXECUTE FUNCTION apoio_decisao_sem_truncate();
  END IF;
  IF to_regclass('public.apoio_decisao_escolhas') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS apoio_decisao_escolhas_so_insercao ON apoio_decisao_escolhas;
    CREATE TRIGGER apoio_decisao_escolhas_so_insercao
      BEFORE UPDATE OR DELETE ON apoio_decisao_escolhas
      FOR EACH ROW EXECUTE FUNCTION apoio_decisao_escolhas_so_insercao();
    DROP TRIGGER IF EXISTS apoio_decisao_escolhas_sem_truncate ON apoio_decisao_escolhas;
    CREATE TRIGGER apoio_decisao_escolhas_sem_truncate
      BEFORE TRUNCATE ON apoio_decisao_escolhas
      FOR EACH STATEMENT EXECUTE FUNCTION apoio_decisao_sem_truncate();
  END IF;
  IF to_regclass('public.apoio_decisao_status') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS apoio_decisao_status_so_insercao ON apoio_decisao_status;
    CREATE TRIGGER apoio_decisao_status_so_insercao
      BEFORE UPDATE OR DELETE ON apoio_decisao_status
      FOR EACH ROW EXECUTE FUNCTION apoio_decisao_status_so_insercao();
    DROP TRIGGER IF EXISTS apoio_decisao_status_sem_truncate ON apoio_decisao_status;
    CREATE TRIGGER apoio_decisao_status_sem_truncate
      BEFORE TRUNCATE ON apoio_decisao_status
      FOR EACH STATEMENT EXECUTE FUNCTION apoio_decisao_sem_truncate();
  END IF;
END
$$;

COMMIT;
