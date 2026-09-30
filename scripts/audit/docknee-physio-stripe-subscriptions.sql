-- =============================================================================
-- DocKnee — auditoria SOMENTE LEITURA das assinaturas Stripe de
-- fisioterapeutas.
--
-- Contexto: o portal do fisioterapeuta foi removido, mas contas com plano pago
-- podem continuar sendo cobradas pela Stripe. Esta lista serve para cancelar
-- manualmente essas assinaturas no Stripe Dashboard.
--
-- Colunas disponíveis em physiotherapists: plan (free | pro),
-- subscription_status (none | trialing | active | past_due | canceled) e
-- stripe_customer_id. O ID da assinatura NÃO fica nessa tabela; ele vem da
-- cópia sincronizada da Stripe (schema "stripe", tabela stripe.subscriptions),
-- consultada nos blocos 3 e 4 só se esse schema existir no banco.
--
-- Este script NÃO altera nada: roda numa transação READ ONLY e termina em
-- ROLLBACK. Não há UPDATE/DELETE/INSERT aqui, e ele não chama a API da Stripe.
--
-- Uso (precisa do psql, por causa do \if):
--   psql "$DATABASE_URL" -f scripts/audit/docknee-physio-stripe-subscriptions.sql
-- =============================================================================

BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '120s';

-- -----------------------------------------------------------------------------
-- 1. FISIOTERAPEUTAS COM COBRANÇA (atual ou passada) — quem tem cliente Stripe,
--    status de assinatura diferente de 'none' ou plano diferente de 'free'.
--    precisa_cancelar = status local active | trialing | past_due.
--    cliente_tambem_medico = o mesmo cliente Stripe está num cadastro de
--    médico: NÃO cancele sem conferir, pode ser a assinatura do médico.
-- -----------------------------------------------------------------------------
SELECT
  ph.id                                                       AS fisio_id,
  ph.nome                                                     AS fisio_nome,
  ph.email,
  ph.celular,
  ph.plan                                                     AS plano,
  ph.subscription_status                                      AS status_assinatura,
  ph.subscription_status IN ('active', 'trialing', 'past_due') AS precisa_cancelar,
  ph.stripe_customer_id,
  EXISTS (
    SELECT 1 FROM doctors d WHERE d.stripe_customer_id = ph.stripe_customer_id
  )                                                           AS cliente_tambem_medico,
  ph.ativo,
  to_char(ph.created_at AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD HH24:MI') AS criado_em_brt,
  to_char(ph.updated_at AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD HH24:MI') AS atualizado_em_brt
FROM physiotherapists ph
WHERE ph.stripe_customer_id IS NOT NULL
   OR ph.subscription_status <> 'none'
   OR ph.plan <> 'free'
ORDER BY
  (ph.subscription_status IN ('active', 'trialing', 'past_due')) DESC,
  ph.subscription_status,
  ph.id;

-- -----------------------------------------------------------------------------
-- 2. RESUMO — todos os fisioterapeutas por status local da assinatura e plano.
-- -----------------------------------------------------------------------------
SELECT
  ph.subscription_status                                      AS status_assinatura,
  ph.plan                                                     AS plano,
  count(*)                                                    AS total,
  count(*) FILTER (WHERE ph.stripe_customer_id IS NOT NULL)   AS com_cliente_stripe
FROM physiotherapists ph
GROUP BY ph.subscription_status, ph.plan
ORDER BY total DESC, status_assinatura, plano;

-- -----------------------------------------------------------------------------
-- 3 e 4. ASSINATURAS NA CÓPIA DA STRIPE — só se stripe.subscriptions existir.
--    Liga pelo cliente (customer = stripe_customer_id) ou pelo metadata
--    physio_id que o checkout do fisioterapeuta gravava na assinatura.
--    A cópia pode estar atrasada: confirme sempre no Dashboard antes de agir.
-- -----------------------------------------------------------------------------
SELECT to_regclass('stripe.subscriptions') IS NOT NULL AS has_stripe_sync \gset

\if :has_stripe_sync
SELECT
  ph.id                                                       AS fisio_id,
  ph.nome                                                     AS fisio_nome,
  ph.email,
  ph.subscription_status                                      AS status_local,
  s.customer                                                  AS stripe_customer_id,
  s.id                                                        AS stripe_subscription_id,
  s.status                                                    AS status_stripe,
  s.livemode                                                  AS producao,
  s.cancel_at_period_end                                      AS cancela_no_fim_do_periodo,
  to_char(to_timestamp(COALESCE(s.current_period_end, (s.items -> 'data' -> 0 ->> 'current_period_end')::bigint))
          AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD HH24:MI') AS fim_periodo_atual_brt,
  to_char(to_timestamp(s.created) AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD HH24:MI') AS assinatura_criada_brt,
  EXISTS (
    SELECT 1 FROM doctors d WHERE d.stripe_customer_id = s.customer
  )                                                           AS cliente_tambem_medico
FROM physiotherapists ph
JOIN stripe.subscriptions s
  ON s.customer = ph.stripe_customer_id
  OR s.metadata ->> 'physio_id' = ph.id::text
ORDER BY
  (s.status IN ('active', 'trialing', 'past_due', 'unpaid', 'incomplete', 'paused')) DESC,
  s.status,
  ph.id,
  s.created DESC;

SELECT
  s.status                                                    AS status_stripe,
  count(DISTINCT s.id)                                        AS assinaturas,
  count(DISTINCT ph.id)                                       AS fisioterapeutas
FROM physiotherapists ph
JOIN stripe.subscriptions s
  ON s.customer = ph.stripe_customer_id
  OR s.metadata ->> 'physio_id' = ph.id::text
GROUP BY s.status
ORDER BY assinaturas DESC, status_stripe;
\else
\echo 'Schema stripe (cópia sincronizada) não encontrado: use os stripe_customer_id da consulta 1 no Stripe Dashboard.'
\endif

ROLLBACK;
