-- Stub mínimo do ambiente Supabase + tabelas pré-existentes do DocSholder, SÓ PARA TESTE LOCAL.
-- NÃO rodar em produção.
DO $$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
GRANT USAGE ON SCHEMA auth TO authenticated;
CREATE TABLE public.patient (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_id uuid NOT NULL, clinic_id uuid, name text);
ALTER TABLE public.patient ENABLE ROW LEVEL SECURITY;
CREATE POLICY patient_rw ON public.patient FOR ALL TO authenticated USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());
CREATE TABLE public.clinic_member (clinic_id uuid, user_id uuid, role text, active boolean);
