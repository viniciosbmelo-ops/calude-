-- Pre-push data fix: avaliação pré-operatória PREOP_COMMON.v1 → v2.
--
-- Até PREOP_COMMON.v1, lado dominante, tabagismo, diabetes e nível de atividade ficavam em
-- surgeries.dados_clinicos -> 'avaliacaoPreop' -> 'comum' de cada cirurgia. A v2 (lib/clinical/src/schemas/
-- PREOP_COMMON.v2.json, additionalProperties: false) guarda só `data_avaliacao`; esses campos passaram para o
-- cadastro do paciente (patients.lado_dom, tabagismo, diabetes, nivel_atividade). O schema do bloco comum não é
-- gravado no JSON (é a constante PREOP_COMMON_SCHEMA): tirar as 4 chaves deixa o bloco em v2.
--
-- (a) Copia para o cadastro SÓ onde a coluna do paciente está NULL, pegando o valor da cirurgia mais recente do
--     mesmo médico que tenha um valor VÁLIDO para aquele campo (enums de lib/clinical/src/patient/profile.ts, que
--     são os mesmos do v1; diabetes só se for booleano JSON). Rascunhos podiam ter qualquer valor: inválidos são
--     ignorados. Mais recente = data_cirurgia (AAAA-MM-DD) mais nova; sem data, created_at e id.
--     Pacientes anonimizados (LGPD, nome 'Paciente Anonimizado #…') NÃO recebem cópia: o perfil foi apagado de
--     propósito e não pode voltar a partir do histórico cirúrgico.
-- (b) Remove as 4 chaves de avaliacaoPreop.comum em TODAS as cirurgias (inclusive de anonimizados). Se o bloco
--     ficar vazio (sem comum e sem patologias), remove avaliacaoPreop, como parseClinicalPayload já faz na leitura.
--
-- Idempotente: depois da primeira execução nenhuma cirurgia tem essas chaves, então (a) e (b) não fazem nada.
-- No-op num banco novo (tabelas ausentes). Roda antes do drizzle-kit push (scripts/post-merge.sh); em produção,
-- aplicar à mão uma vez com psql -v ON_ERROR_STOP=1 -f.
BEGIN;
DO $$
BEGIN
  IF to_regclass('public.surgeries') IS NULL OR to_regclass('public.patients') IS NULL THEN
    RETURN;
  END IF;

  WITH legado AS (
    SELECT s.patient_id,
           s.dados_clinicos -> 'avaliacaoPreop' -> 'comum' AS comum,
           (CASE WHEN s.data_cirurgia ~ '^\d{4}-\d{2}-\d{2}' THEN left(s.data_cirurgia, 10) END) AS data_ord,
           s.created_at, s.id
      FROM surgeries s
      JOIN patients p ON p.id = s.patient_id AND p.doctor_id = s.doctor_id
     WHERE jsonb_typeof(s.dados_clinicos -> 'avaliacaoPreop' -> 'comum') = 'object'
       AND (s.dados_clinicos -> 'avaliacaoPreop' -> 'comum') ?| ARRAY['lado_dominante', 'tabagismo', 'diabetes', 'nivel_atividade']
       AND p.nome NOT LIKE 'Paciente Anonimizado #%'
  ),
  valores AS (
    SELECT l.patient_id,
      (SELECT l2.comum ->> 'lado_dominante' FROM legado l2
        WHERE l2.patient_id = l.patient_id AND l2.comum ->> 'lado_dominante' IN ('R', 'L', 'ambidestro')
        ORDER BY l2.data_ord DESC NULLS LAST, l2.created_at DESC, l2.id DESC LIMIT 1) AS lado_dom,
      (SELECT l2.comum ->> 'tabagismo' FROM legado l2
        WHERE l2.patient_id = l.patient_id AND l2.comum ->> 'tabagismo' IN ('nunca', 'ex_tabagista', 'atual')
        ORDER BY l2.data_ord DESC NULLS LAST, l2.created_at DESC, l2.id DESC LIMIT 1) AS tabagismo,
      (SELECT (l2.comum -> 'diabetes')::text::boolean FROM legado l2
        WHERE l2.patient_id = l.patient_id AND jsonb_typeof(l2.comum -> 'diabetes') = 'boolean'
        ORDER BY l2.data_ord DESC NULLS LAST, l2.created_at DESC, l2.id DESC LIMIT 1) AS diabetes,
      (SELECT l2.comum ->> 'nivel_atividade' FROM legado l2
        WHERE l2.patient_id = l.patient_id
          AND l2.comum ->> 'nivel_atividade' IN ('sedentario', 'recreativo', 'competitivo', 'trabalhador_bracal')
        ORDER BY l2.data_ord DESC NULLS LAST, l2.created_at DESC, l2.id DESC LIMIT 1) AS nivel_atividade
    FROM (SELECT DISTINCT patient_id FROM legado) l
  )
  UPDATE patients p
     SET lado_dom        = coalesce(p.lado_dom, v.lado_dom),
         tabagismo       = coalesce(p.tabagismo, v.tabagismo),
         diabetes        = coalesce(p.diabetes, v.diabetes),
         nivel_atividade = coalesce(p.nivel_atividade, v.nivel_atividade)
    FROM valores v
   WHERE p.id = v.patient_id
     AND ((p.lado_dom IS NULL AND v.lado_dom IS NOT NULL)
       OR (p.tabagismo IS NULL AND v.tabagismo IS NOT NULL)
       OR (p.diabetes IS NULL AND v.diabetes IS NOT NULL)
       OR (p.nivel_atividade IS NULL AND v.nivel_atividade IS NOT NULL));

  -- (b) tira as chaves; bloco vazio some.
  UPDATE surgeries s
     SET dados_clinicos = CASE
           WHEN (s.dados_clinicos -> 'avaliacaoPreop' -> 'comum') - ARRAY['lado_dominante', 'tabagismo', 'diabetes', 'nivel_atividade'] = '{}'::jsonb
            AND coalesce(jsonb_array_length(CASE WHEN jsonb_typeof(s.dados_clinicos -> 'avaliacaoPreop' -> 'patologias') = 'array'
                                                 THEN s.dados_clinicos -> 'avaliacaoPreop' -> 'patologias' END), 0) = 0
           THEN s.dados_clinicos - 'avaliacaoPreop'
           ELSE jsonb_set(s.dados_clinicos, '{avaliacaoPreop,comum}',
                  (s.dados_clinicos -> 'avaliacaoPreop' -> 'comum') - ARRAY['lado_dominante', 'tabagismo', 'diabetes', 'nivel_atividade'])
         END
   WHERE jsonb_typeof(s.dados_clinicos -> 'avaliacaoPreop' -> 'comum') = 'object'
     AND (s.dados_clinicos -> 'avaliacaoPreop' -> 'comum') ?| ARRAY['lado_dominante', 'tabagismo', 'diabetes', 'nivel_atividade'];
END
$$;
COMMIT;
