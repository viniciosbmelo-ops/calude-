-- =============================================================================
-- DocKnee — auditoria SOMENTE LEITURA dos alertas de sinais de alerta
-- ("red flags") da reabilitação que o cirurgião pode NÃO ter recebido.
--
-- Contexto: o portal do fisioterapeuta foi removido. Quando o fisioterapeuta
-- registrava uma avaliação (rehab_assessments) com red flags de um paciente
-- vinculado a um cirurgião (care_links), a API gravava um alerta WhatsApp na
-- fila whatsapp_outbox com event_type = 'rehab_red_flag' (assessment_id =
-- rehab_assessments.id, recipient = telefone do cirurgião). Desde a remoção,
-- o worker da fila NÃO envia mais linhas 'rehab_red_flag': as que estavam
-- 'pending' continuam paradas na tabela e nunca serão enviadas.
--
-- Status possíveis na fila: pending | processing | sent | failed | uncertain.
--   - pending     → nunca enviado (e agora nunca será);
--   - processing  → o worker pegou a linha e não gravou o resultado;
--   - failed      → esgotou tentativas ou cirurgião sem telefone;
--   - uncertain   → o provedor pode ou não ter entregue (confirmar manualmente);
--   - sent        → entrega confirmada (fora da lista, só no resumo).
--
-- Este script NÃO altera nada: roda numa transação READ ONLY e termina em
-- ROLLBACK. Não há UPDATE/DELETE/INSERT aqui.
--
-- Uso: psql "$DATABASE_URL" -f scripts/audit/docknee-pending-rehab-red-flags.sql
-- =============================================================================

BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '120s';

-- -----------------------------------------------------------------------------
-- 1. ALERTAS NÃO ENTREGUES — linhas 'rehab_red_flag' com status diferente de
--    'sent', mais recentes primeiro, com cirurgião, paciente, fisioterapeuta e
--    o texto da mensagem que o cirurgião deveria ter recebido.
-- -----------------------------------------------------------------------------
SELECT
  o.id                                                        AS outbox_id,
  o.status,
  o.attempts,
  o.max_attempts,
  to_char(o.created_at AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD HH24:MI') AS criado_em_brt,
  to_char(o.failed_at  AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD HH24:MI') AS falhou_em_brt,
  o.last_error,
  cl.surgeon_id                                               AS cirurgiao_id,
  d.nome                                                      AS cirurgiao_nome,
  o.recipient                                                 AS telefone_destino,
  COALESCE(cl.patient_id, pp.patient_id)                      AS paciente_id,
  COALESCE(p.nome, pp.full_name)                              AS paciente_nome,
  COALESCE(p.telefone, pp.phone)                              AS paciente_telefone,
  ra.physio_id                                                AS fisio_id,
  ph.nome                                                     AS fisio_nome,
  ph.celular                                                  AS fisio_celular,
  o.assessment_id,
  ra.assessment_type                                          AS tipo_avaliacao,
  array_to_string(ra.red_flags, ', ')                         AS red_flags,
  o.message                                                   AS mensagem
FROM whatsapp_outbox o
LEFT JOIN rehab_assessments ra ON ra.id = o.assessment_id
LEFT JOIN care_links cl        ON cl.id = ra.care_link_id
LEFT JOIN doctors d            ON d.id = cl.surgeon_id
LEFT JOIN physio_patients pp   ON pp.id = ra.physio_patient_id
LEFT JOIN patients p           ON p.id = COALESCE(cl.patient_id, pp.patient_id)
LEFT JOIN physiotherapists ph  ON ph.id = ra.physio_id
WHERE o.event_type = 'rehab_red_flag'
  AND o.status <> 'sent'
ORDER BY o.created_at DESC, o.id DESC;

-- -----------------------------------------------------------------------------
-- 2. RESUMO DA FILA — todas as linhas 'rehab_red_flag' por status (inclui
--    'sent' para comparação), com a mais antiga e a mais recente.
-- -----------------------------------------------------------------------------
SELECT
  o.status,
  count(*)                                                    AS total,
  to_char(min(o.created_at) AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD HH24:MI') AS mais_antigo_brt,
  to_char(max(o.created_at) AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD HH24:MI') AS mais_recente_brt
FROM whatsapp_outbox o
WHERE o.event_type = 'rehab_red_flag'
GROUP BY o.status
ORDER BY total DESC, o.status;

-- -----------------------------------------------------------------------------
-- 3. RED FLAGS SEM ALERTA ENTREGUE — avaliações do fisioterapeuta com red flags
--    (rehab_assessments.red_flags) cujo alerta ao cirurgião não foi confirmado.
--    Motivo:
--      sem_vinculo_cirurgiao → paciente próprio do fisio (sem care_link): nunca
--                              houve alerta ao cirurgião;
--      vinculo_inativo       → care_link revogado/encerrado na hora do registro;
--      sem_alerta_na_fila    → havia vínculo, mas nenhuma linha na fila;
--      alerta_<status>       → linha na fila com status diferente de 'sent'.
--    Com o portal removido, o cirurgião também não vê essas avaliações na tela.
-- -----------------------------------------------------------------------------
SELECT
  ra.id                                                       AS assessment_id,
  to_char(ra.created_at AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD HH24:MI') AS avaliado_em_brt,
  CASE
    WHEN ra.care_link_id IS NULL THEN 'sem_vinculo_cirurgiao'
    WHEN o.id IS NULL AND cl.status <> 'active' THEN 'vinculo_inativo'
    WHEN o.id IS NULL THEN 'sem_alerta_na_fila'
    ELSE 'alerta_' || o.status
  END                                                         AS motivo,
  o.id                                                        AS outbox_id,
  cl.surgeon_id                                               AS cirurgiao_id,
  d.nome                                                      AS cirurgiao_nome,
  d.telefone                                                  AS cirurgiao_telefone,
  COALESCE(cl.patient_id, pp.patient_id)                      AS paciente_id,
  COALESCE(p.nome, pp.full_name)                              AS paciente_nome,
  COALESCE(p.telefone, pp.phone)                              AS paciente_telefone,
  ra.physio_id                                                AS fisio_id,
  ph.nome                                                     AS fisio_nome,
  ph.celular                                                  AS fisio_celular,
  ra.assessment_type                                          AS tipo_avaliacao,
  ra.phase                                                    AS fase,
  array_to_string(ra.red_flags, ', ')                         AS red_flags,
  ra.computed                                                 AS calculado,
  ra.payload                                                  AS dados_digitados
FROM rehab_assessments ra
LEFT JOIN whatsapp_outbox o    ON o.assessment_id = ra.id AND o.event_type = 'rehab_red_flag'
LEFT JOIN care_links cl        ON cl.id = ra.care_link_id
LEFT JOIN doctors d            ON d.id = cl.surgeon_id
LEFT JOIN physio_patients pp   ON pp.id = ra.physio_patient_id
LEFT JOIN patients p           ON p.id = COALESCE(cl.patient_id, pp.patient_id)
LEFT JOIN physiotherapists ph  ON ph.id = ra.physio_id
WHERE cardinality(ra.red_flags) > 0
  AND (o.id IS NULL OR o.status <> 'sent')
ORDER BY ra.created_at DESC, ra.id DESC;

-- -----------------------------------------------------------------------------
-- 4. RESUMO — todas as avaliações com red flags por motivo (inclui
--    'alerta_sent', que ficou fora da consulta 3, para comparação).
-- -----------------------------------------------------------------------------
SELECT
  CASE
    WHEN ra.care_link_id IS NULL THEN 'sem_vinculo_cirurgiao'
    WHEN o.id IS NULL AND cl.status <> 'active' THEN 'vinculo_inativo'
    WHEN o.id IS NULL THEN 'sem_alerta_na_fila'
    ELSE 'alerta_' || o.status
  END                                                         AS motivo,
  count(*)                                                    AS total
FROM rehab_assessments ra
LEFT JOIN whatsapp_outbox o ON o.assessment_id = ra.id AND o.event_type = 'rehab_red_flag'
LEFT JOIN care_links cl     ON cl.id = ra.care_link_id
WHERE cardinality(ra.red_flags) > 0
GROUP BY 1
ORDER BY total DESC, motivo;

ROLLBACK;
