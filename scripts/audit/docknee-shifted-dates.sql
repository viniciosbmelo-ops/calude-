-- =============================================================================
-- DocKnee — auditoria SOMENTE LEITURA de datas possivelmente gravadas 1 dia à
-- frente (bug do "hoje em UTC").
--
-- Até a correção, vários "hoje" eram calculados em UTC
-- (new Date().toISOString().slice(0, 10)). Entre 21:00 e 23:59 no horário de
-- Brasília o dia UTC já é o seguinte, então um registro criado nesse intervalo
-- com a data padrão "hoje" foi gravado com a data de AMANHÃ.
--
-- Assinatura do bug em cada linha:
--   created_at em America/Sao_Paulo entre 21:00 e 23:59
--   E data gravada = (data de created_at em America/Sao_Paulo) + 1 dia
--
-- Este script NÃO altera nada: roda numa transação READ ONLY e termina em
-- ROLLBACK. Não há UPDATE/DELETE/INSERT aqui. Qualquer correção deve ser
-- manual, revisada caso a caso e feita só depois de backup.
--
-- Uso: psql "$DATABASE_URL" -f scripts/audit/docknee-shifted-dates.sql
-- =============================================================================

BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '120s';
SET LOCAL TIME ZONE 'America/Sao_Paulo';

-- -----------------------------------------------------------------------------
-- 0. RESUMO — por tabela: linhas criadas entre 21:00 e 23:59 (BRT), quantas
--    têm a data igual ao dia BRT (corretas) e quantas têm dia BRT + 1
--    (suspeitas). A proporção ajuda a ver se o padrão "amanhã" é sistemático.
-- -----------------------------------------------------------------------------
WITH
rc AS (
  SELECT (created_at AT TIME ZONE 'America/Sao_Paulo') AS created_brt, data_caso AS stored
  FROM regen_cases
  WHERE created_at IS NOT NULL AND data_caso IS NOT NULL
),
rfn AS (
  -- Data base implícita = scheduled_date − days_after_procedure.
  SELECT (created_at AT TIME ZONE 'America/Sao_Paulo') AS created_brt,
         scheduled_date - days_after_procedure AS stored
  FROM regen_followup_notifications
  WHERE created_at IS NOT NULL AND scheduled_date IS NOT NULL
),
fu AS (
  SELECT (created_at AT TIME ZONE 'America/Sao_Paulo') AS created_brt, data_avaliacao AS stored_text
  FROM followup
  WHERE data_avaliacao ~ '^\d{4}-\d{2}-\d{2}$'
),
ss AS (
  SELECT (created_at AT TIME ZONE 'America/Sao_Paulo') AS created_brt, data AS stored_text
  FROM scheduled_surgeries
  WHERE data ~ '^\d{4}-\d{2}-\d{2}$'
),
pf AS (
  SELECT (created_at AT TIME ZONE 'America/Sao_Paulo') AS created_brt, due_date AS stored, source
  FROM physio_followups
)
SELECT 'regen_cases.data_caso' AS coluna,
       count(*) FILTER (WHERE created_brt::time >= '21:00') AS criadas_21h_24h,
       count(*) FILTER (WHERE created_brt::time >= '21:00' AND stored = created_brt::date) AS iguais_dia_brt,
       count(*) FILTER (WHERE created_brt::time >= '21:00' AND stored = created_brt::date + 1) AS suspeitas_dia_seguinte,
       count(*) FILTER (WHERE created_brt::time <  '21:00' AND stored = created_brt::date + 1) AS controle_antes_21h_dia_seguinte
FROM rc
UNION ALL
SELECT 'regen_followup_notifications.scheduled_date (base = scheduled_date - days_after_procedure)',
       count(*) FILTER (WHERE created_brt::time >= '21:00'),
       count(*) FILTER (WHERE created_brt::time >= '21:00' AND stored = created_brt::date),
       count(*) FILTER (WHERE created_brt::time >= '21:00' AND stored = created_brt::date + 1),
       count(*) FILTER (WHERE created_brt::time <  '21:00' AND stored = created_brt::date + 1)
FROM rfn
UNION ALL
SELECT 'followup.data_avaliacao',
       count(*) FILTER (WHERE created_brt::time >= '21:00'),
       count(*) FILTER (WHERE created_brt::time >= '21:00' AND stored_text = to_char(created_brt::date, 'YYYY-MM-DD')),
       count(*) FILTER (WHERE created_brt::time >= '21:00' AND stored_text = to_char(created_brt::date + 1, 'YYYY-MM-DD')),
       count(*) FILTER (WHERE created_brt::time <  '21:00' AND stored_text = to_char(created_brt::date + 1, 'YYYY-MM-DD'))
FROM fu
UNION ALL
SELECT 'scheduled_surgeries.data',
       count(*) FILTER (WHERE created_brt::time >= '21:00'),
       count(*) FILTER (WHERE created_brt::time >= '21:00' AND stored_text = to_char(created_brt::date, 'YYYY-MM-DD')),
       count(*) FILTER (WHERE created_brt::time >= '21:00' AND stored_text = to_char(created_brt::date + 1, 'YYYY-MM-DD')),
       count(*) FILTER (WHERE created_brt::time <  '21:00' AND stored_text = to_char(created_brt::date + 1, 'YYYY-MM-DD'))
FROM ss
UNION ALL
SELECT 'physio_followups.due_date (source = manual)',
       count(*) FILTER (WHERE source = 'manual' AND created_brt::time >= '21:00'),
       count(*) FILTER (WHERE source = 'manual' AND created_brt::time >= '21:00' AND stored = created_brt::date),
       count(*) FILTER (WHERE source = 'manual' AND created_brt::time >= '21:00' AND stored = created_brt::date + 1),
       count(*) FILTER (WHERE source = 'manual' AND created_brt::time <  '21:00' AND stored = created_brt::date + 1)
FROM pf;

-- -----------------------------------------------------------------------------
-- 1. regen_cases.data_caso — data do caso com padrão "hoje" no formulário
--    (regen/novo). Suspeita: criado 21:00–23:59 BRT e data_caso = dia BRT + 1.
-- -----------------------------------------------------------------------------
SELECT c.id,
       c.doctor_id,
       c.patient_id,
       c.status,
       c.data_caso                                                  AS data_gravada,
       (c.created_at AT TIME ZONE 'America/Sao_Paulo')::date        AS dia_criacao_brt,
       to_char(c.created_at AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD HH24:MI:SS') AS created_at_brt,
       to_char(c.updated_at AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD HH24:MI:SS') AS updated_at_brt
FROM regen_cases c
WHERE c.created_at IS NOT NULL
  AND (c.created_at AT TIME ZONE 'America/Sao_Paulo')::time >= '21:00'
  AND c.data_caso = (c.created_at AT TIME ZONE 'America/Sao_Paulo')::date + 1
ORDER BY c.created_at;

-- -----------------------------------------------------------------------------
-- 2. regen_followup_notifications.scheduled_date — agenda gerada a partir de
--    uma data base. Dois motivos:
--    a) base_implicita (scheduled_date − days_after_procedure) = dia BRT da
--       criação + 1 com criação 21:00–23:59 BRT (base "hoje" em UTC);
--    b) base_implicita = data_caso de um caso que aparece na consulta 1
--       (agenda herdou a data do caso deslocada).
-- -----------------------------------------------------------------------------
WITH suspect_cases AS (
  SELECT id
  FROM regen_cases
  WHERE created_at IS NOT NULL
    AND (created_at AT TIME ZONE 'America/Sao_Paulo')::time >= '21:00'
    AND data_caso = (created_at AT TIME ZONE 'America/Sao_Paulo')::date + 1
)
SELECT n.id,
       n.case_id,
       c.doctor_id,
       c.patient_id,
       n.periodo,
       n.status,
       n.days_after_procedure,
       n.scheduled_date                                             AS data_gravada,
       n.scheduled_date - n.days_after_procedure                   AS base_implicita,
       c.data_caso,
       to_char(n.created_at AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD HH24:MI:SS') AS created_at_brt,
       CASE
         WHEN (n.created_at AT TIME ZONE 'America/Sao_Paulo')::time >= '21:00'
          AND n.scheduled_date - n.days_after_procedure = (n.created_at AT TIME ZONE 'America/Sao_Paulo')::date + 1
           THEN 'a) base = hoje UTC na criação'
         ELSE 'b) herdou data_caso suspeita'
       END                                                          AS motivo
FROM regen_followup_notifications n
JOIN regen_cases c ON c.id = n.case_id
WHERE n.scheduled_date IS NOT NULL
  AND (
    (n.created_at IS NOT NULL
     AND (n.created_at AT TIME ZONE 'America/Sao_Paulo')::time >= '21:00'
     AND n.scheduled_date - n.days_after_procedure = (n.created_at AT TIME ZONE 'America/Sao_Paulo')::date + 1)
    OR
    (n.case_id IN (SELECT id FROM suspect_cases)
     AND n.scheduled_date - n.days_after_procedure = c.data_caso)
  )
ORDER BY c.doctor_id, n.case_id, n.scheduled_date;

-- -----------------------------------------------------------------------------
-- 3. followup.data_avaliacao (texto "YYYY-MM-DD") — preenchida com "hoje" ao
--    criar a avaliação (cron, resposta do paciente, cadastro de cirurgia) ou
--    pelo formulário do médico. Compara com created_at e, como 2º critério,
--    com updated_at (o formulário de edição também sugeria "hoje").
-- -----------------------------------------------------------------------------
SELECT f.id,
       f.surgery_id,
       s.doctor_id,
       s.patient_id,
       f.tempo,
       f.data_avaliacao                                             AS data_gravada,
       to_char(f.created_at AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD HH24:MI:SS') AS created_at_brt,
       to_char(f.updated_at AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD HH24:MI:SS') AS updated_at_brt,
       CASE
         WHEN (f.created_at AT TIME ZONE 'America/Sao_Paulo')::time >= '21:00'
          AND f.data_avaliacao = to_char((f.created_at AT TIME ZONE 'America/Sao_Paulo')::date + 1, 'YYYY-MM-DD')
           THEN 'created_at'
         ELSE 'updated_at'
       END                                                          AS criterio
FROM followup f
JOIN surgeries s ON s.id = f.surgery_id
WHERE f.data_avaliacao ~ '^\d{4}-\d{2}-\d{2}$'
  AND (
    ((f.created_at AT TIME ZONE 'America/Sao_Paulo')::time >= '21:00'
     AND f.data_avaliacao = to_char((f.created_at AT TIME ZONE 'America/Sao_Paulo')::date + 1, 'YYYY-MM-DD'))
    OR
    ((f.updated_at AT TIME ZONE 'America/Sao_Paulo')::time >= '21:00'
     AND f.data_avaliacao = to_char((f.updated_at AT TIME ZONE 'America/Sao_Paulo')::date + 1, 'YYYY-MM-DD'))
  )
ORDER BY s.doctor_id, f.created_at;

-- -----------------------------------------------------------------------------
-- 4. scheduled_surgeries.data (texto "YYYY-MM-DD") — a agenda cirúrgica
--    sugeria "hoje" (UTC) como data. Aqui o falso positivo é mais provável:
--    marcar cirurgia para amanhã é comum.
-- -----------------------------------------------------------------------------
SELECT ss.id,
       ss.doctor_id,
       ss.patient_id,
       ss.status,
       ss.data                                                      AS data_gravada,
       ss.hora,
       to_char(ss.created_at AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD HH24:MI:SS') AS created_at_brt
FROM scheduled_surgeries ss
WHERE ss.data ~ '^\d{4}-\d{2}-\d{2}$'
  AND (ss.created_at AT TIME ZONE 'America/Sao_Paulo')::time >= '21:00'
  AND ss.data = to_char((ss.created_at AT TIME ZONE 'America/Sao_Paulo')::date + 1, 'YYYY-MM-DD')
ORDER BY ss.doctor_id, ss.created_at;

-- -----------------------------------------------------------------------------
-- 5. physio_followups.due_date — o follow-up manual criado junto com o
--    paciente vinha com vencimento "hoje" (UTC). Linhas source = 'protocol'
--    são calculadas da data de início do protocolo e quase certamente são
--    falso positivo; aparecem só para conferência.
-- -----------------------------------------------------------------------------
SELECT pf.id,
       pf.physio_id,
       pf.physio_patient_id,
       pp.patient_id,
       pf.source,
       pf.status,
       pf.title,
       pf.due_date                                                  AS data_gravada,
       to_char(pf.created_at AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD HH24:MI:SS') AS created_at_brt
FROM physio_followups pf
JOIN physio_patients pp ON pp.id = pf.physio_patient_id
WHERE (pf.created_at AT TIME ZONE 'America/Sao_Paulo')::time >= '21:00'
  AND pf.due_date = (pf.created_at AT TIME ZONE 'America/Sao_Paulo')::date + 1
ORDER BY (pf.source = 'manual') DESC, pf.physio_id, pf.created_at;

-- -----------------------------------------------------------------------------
-- 6. regen_lab_results.collected_at — INFORMATIVO. Só é relevante se o
--    servidor da API rodava FORA de UTC (ex.: America/Sao_Paulo): o código
--    antigo convertia "YYYY-MM-DD" em Date (meia-noite UTC) e o driver gravava
--    o dia local, ou seja, 1 dia ANTES — em qualquer horário, não só 21–24h.
--    Não há assinatura segura; a distribuição abaixo (dias entre a criação em
--    BRT e a coleta) mostra se há acúmulo anormal em "1 dia antes".
-- -----------------------------------------------------------------------------
SELECT (l.created_at AT TIME ZONE 'America/Sao_Paulo')::date - l.collected_at AS dias_entre_coleta_e_registro,
       count(*)                                                                AS linhas,
       count(DISTINCT l.case_id)                                               AS casos
FROM regen_lab_results l
WHERE l.collected_at IS NOT NULL AND l.created_at IS NOT NULL
GROUP BY 1
ORDER BY 1
LIMIT 40;

ROLLBACK;
