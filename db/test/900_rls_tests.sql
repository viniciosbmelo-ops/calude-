-- Testes de RLS / integridade. Cada bloco DO lança exceção se a expectativa falhar.
\set ON_ERROR_STOP on
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;

-- usuários
\set A '''aaaaaaaa-0000-0000-0000-000000000001'''
\set B '''bbbbbbbb-0000-0000-0000-000000000002'''
INSERT INTO public.patient(id, owner_id, name) VALUES
 ('11111111-0000-0000-0000-000000000001', :A, 'Paciente A'),
 ('22222222-0000-0000-0000-000000000002', :B, 'Paciente B');

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', false);

INSERT INTO public.care_episode(id, patient_id, owner_id, region, side, affected_is_dominant, primary_pathology, secondary_pathologies)
VALUES ('e0000000-0000-0000-0000-00000000000a', '11111111-0000-0000-0000-000000000001', :A, 'shoulder', 'R', true, 'SH_RCT', ARRAY['SH_BICEPS']);

-- 1) A não consegue criar episódio para paciente de B
DO $$ BEGIN
  BEGIN
    INSERT INTO public.care_episode(patient_id, owner_id, region, side, affected_is_dominant, primary_pathology)
    VALUES ('22222222-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001', 'shoulder', 'R', true, 'SH_RCT');
    RAISE EXCEPTION 'FALHA: episódio criado para paciente alheio';
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'OK 1: paciente alheio bloqueado';
  END;
END $$;

-- 2) Lado divergente bloqueado
DO $$ BEGIN
  BEGIN
    INSERT INTO public.surgery(episode_id, core) VALUES ('e0000000-0000-0000-0000-00000000000a', '{"surgery_date":"2026-09-23","side":"L"}');
    RAISE EXCEPTION 'FALHA: lado divergente aceito';
  EXCEPTION WHEN check_violation THEN RAISE NOTICE 'OK 2: lado divergente bloqueado';
  END;
END $$;

INSERT INTO public.surgery(id, episode_id, core) VALUES ('50000000-0000-0000-0000-00000000000a', 'e0000000-0000-0000-0000-00000000000a', '{"surgery_date":"2026-09-23","side":"R"}');
DO $$ BEGIN
  IF (SELECT surgery_date FROM public.surgery WHERE id = '50000000-0000-0000-0000-00000000000a') <> DATE '2026-09-23' THEN RAISE EXCEPTION 'FALHA: surgery_date não derivado'; END IF;
  RAISE NOTICE 'OK 3: surgery_date/side derivados de core';
END $$;

-- 4) Procedimento de patologia fora do episódio bloqueado; filha e secundária aceitas
INSERT INTO public.surgery_procedure(surgery_id, pathology_code, sequence, schema_id, schema_version, data)
VALUES ('50000000-0000-0000-0000-00000000000a', 'SH_RCT_FULL', 1, 'SH_RCT.intraop.v1', 1, '{}'),
       ('50000000-0000-0000-0000-00000000000a', 'SH_BICEPS', 2, 'SH_BICEPS.intraop.v1', 1, '{}');
DO $$ BEGIN
  BEGIN
    INSERT INTO public.surgery_procedure(surgery_id, pathology_code, sequence, schema_id, schema_version, data)
    VALUES ('50000000-0000-0000-0000-00000000000a', 'SH_INST_ANT', 3, 'SH_INST_ANT.intraop.v1', 1, '{}');
    RAISE EXCEPTION 'FALHA: patologia fora do episódio aceita';
  EXCEPTION WHEN check_violation THEN RAISE NOTICE 'OK 4: patologia fora do episódio bloqueada';
  END;
END $$;

-- 5) Relatório assinado é imutável
INSERT INTO public.surgical_report(id, surgery_id, version, template_versions, generated_text, final_text, signed_by, signed_at, content_hash)
VALUES ('70000000-0000-0000-0000-00000000000a', '50000000-0000-0000-0000-00000000000a', 1, '{}', 'x', 'x', 'aaaaaaaa-0000-0000-0000-000000000001', now(), repeat('a', 64));
DO $$ BEGIN
  IF (SELECT status FROM public.surgery WHERE id = '50000000-0000-0000-0000-00000000000a') <> 'signed' THEN RAISE EXCEPTION 'FALHA: cirurgia não marcada como signed'; END IF;
  RAISE NOTICE 'OK 5a: cirurgia marcada como signed';
END $$;
DO $$ DECLARE n int; BEGIN
  UPDATE public.surgical_report SET final_text = 'adulterado' WHERE id = '70000000-0000-0000-0000-00000000000a';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'FALHA: relatório assinado alterado'; END IF;
  RAISE NOTICE 'OK 5b: UPDATE em relatório assinado não afeta linhas (RLS)';
END $$;
DO $$ BEGIN
  BEGIN
    INSERT INTO public.surgical_report(surgery_id, version, template_versions, generated_text, final_text, signed_by, signed_at, content_hash)
    VALUES ('50000000-0000-0000-0000-00000000000a', 2, '{}', 'x', 'x', 'bbbbbbbb-0000-0000-0000-000000000002', now(), repeat('b', 64));
    RAISE EXCEPTION 'FALHA: assinatura em nome de outro usuário aceita';
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'OK 5c: assinatura em nome de terceiro bloqueada';
  END;
END $$;
-- 6) Após assinatura, procedimentos ficam somente leitura
DO $$ DECLARE n int; BEGIN
  UPDATE public.surgery_procedure SET data = '{"x":1}' WHERE surgery_id = '50000000-0000-0000-0000-00000000000a';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'FALHA: procedimento alterado após assinatura'; END IF;
  RAISE NOTICE 'OK 6: procedimentos bloqueados após assinatura';
END $$;

-- 7) Usuário B não enxerga nada de A (BOLA/IDOR)
SELECT set_config('request.jwt.claim.sub', 'bbbbbbbb-0000-0000-0000-000000000002', false);
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.care_episode) OR EXISTS (SELECT 1 FROM public.surgery)
     OR EXISTS (SELECT 1 FROM public.surgery_procedure) OR EXISTS (SELECT 1 FROM public.surgical_report) THEN
    RAISE EXCEPTION 'FALHA: B enxerga dados de A';
  END IF;
  RAISE NOTICE 'OK 7: B não enxerga episódios/cirurgias/procedimentos/relatórios de A';
END $$;
DO $$ DECLARE n int; BEGIN
  UPDATE public.care_episode SET side = 'L' WHERE id = 'e0000000-0000-0000-0000-00000000000a';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'FALHA: B alterou episódio de A'; END IF;
  RAISE NOTICE 'OK 8: B não altera episódio de A';
END $$;

-- 9) Sem usuário autenticado: nada visível
SELECT set_config('request.jwt.claim.sub', '', false);
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.care_episode) THEN RAISE EXCEPTION 'FALHA: anônimo enxerga episódio'; END IF;
  RAISE NOTICE 'OK 9: sem JWT não enxerga episódios';
END $$;

-- 10) Catálogo legível e não gravável por usuário
SELECT set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', false);
DO $$ BEGIN
  IF (SELECT count(*) FROM public.pathology_catalog) < 40 THEN RAISE EXCEPTION 'FALHA: catálogo incompleto'; END IF;
  BEGIN
    INSERT INTO public.pathology_catalog(code, region, name_pt) VALUES ('SH_FAKE', 'shoulder', 'x');
    RAISE EXCEPTION 'FALHA: usuário gravou no catálogo';
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'OK 10: catálogo somente leitura';
  END;
END $$;
RESET ROLE;
-- 11) Mesmo service_role/superuser não altera relatório assinado (trigger)
DO $$ BEGIN
  BEGIN
    UPDATE public.surgical_report SET final_text = 'adulterado' WHERE id = '70000000-0000-0000-0000-00000000000a';
    RAISE EXCEPTION 'FALHA: superusuário alterou relatório assinado';
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'OK 11: trigger bloqueia alteração até para service_role';
  END;
  BEGIN
    DELETE FROM public.surgical_report WHERE id = '70000000-0000-0000-0000-00000000000a';
    RAISE EXCEPTION 'FALHA: relatório excluído';
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'OK 12: exclusão bloqueada';
  END;
END $$;
