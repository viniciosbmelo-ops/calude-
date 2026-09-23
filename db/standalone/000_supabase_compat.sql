-- =====================================================================
-- Compatibilidade Supabase para PostgreSQL PURO (desenvolvimento/standalone).
-- NÃO rodar no Supabase: lá roles, auth.uid() e grants já existem.
-- Deve rodar ANTES de todas as migrações (os DEFAULT PRIVILEGES valem para tabelas criadas depois).
-- =====================================================================
-- Roles são globais ao cluster: criação concorrente (vários bancos migrando ao mesmo tempo)
-- gera unique_violation em vez de duplicate_object — ambos são tratados.
DO $$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object OR unique_violation THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE anon NOLOGIN; EXCEPTION WHEN duplicate_object OR unique_violation THEN NULL; END $$;
DO $$ BEGIN GRANT authenticated, anon TO CURRENT_USER; EXCEPTION WHEN unique_violation THEN NULL; END $$;

CREATE SCHEMA IF NOT EXISTS auth;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT COALESCE(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
  )::uuid
$$;
GRANT USAGE ON SCHEMA auth TO authenticated, anon;

GRANT USAGE ON SCHEMA public TO authenticated, anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
