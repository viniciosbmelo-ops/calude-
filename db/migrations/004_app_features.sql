-- =====================================================================
-- DocSholder — 004: recursos do app
--   * tamanho do implante (sai no relatório)
--   * agenda de PROMs criada na assinatura do relatório
--   * convites de PROM por link para o paciente (token só em hash)
--   * protocolos pós-operatórios do cirurgião (conteúdo escrito pelo médico)
-- Requer 001–003. Idempotente.
-- =====================================================================
BEGIN;

ALTER TABLE public.surgery_implant ADD COLUMN IF NOT EXISTS size TEXT CHECK (char_length(size) <= 40);

-- ---------------- agenda de PROMs ----------------
CREATE TABLE IF NOT EXISTS public.prom_schedule (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  episode_id    UUID NOT NULL REFERENCES public.care_episode(id) ON DELETE CASCADE,
  surgery_id    UUID NOT NULL REFERENCES public.surgery(id) ON DELETE CASCADE,
  timepoint     TEXT NOT NULL CHECK (timepoint IN ('6w','3m','6m','12m','24m')),
  due           DATE NOT NULL,
  window_start  DATE NOT NULL,
  window_end    DATE NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (surgery_id, timepoint)
);
CREATE INDEX IF NOT EXISTS prom_schedule_due_idx ON public.prom_schedule(due);
ALTER TABLE public.prom_schedule ENABLE ROW LEVEL SECURITY;
CREATE POLICY prom_schedule_rw ON public.prom_schedule FOR ALL TO authenticated
  USING (public.can_access_episode(episode_id)) WITH CHECK (public.can_access_episode(episode_id));

-- ---------------- convites de PROM ----------------
CREATE TABLE IF NOT EXISTS public.prom_invite (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  episode_id   UUID NOT NULL REFERENCES public.care_episode(id) ON DELETE CASCADE,
  instrument   TEXT NOT NULL,
  timepoint    TEXT NOT NULL CHECK (timepoint IN ('preop','6w','3m','6m','12m','24m','other')),
  token_hash   TEXT NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  created_by   UUID NOT NULL DEFAULT auth.uid(),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at   TIMESTAMPTZ NOT NULL,
  used_at      TIMESTAMPTZ,
  response_id  UUID REFERENCES public.prom_response(id),
  CHECK (expires_at > created_at)
);
ALTER TABLE public.prom_invite ENABLE ROW LEVEL SECURITY;
CREATE POLICY prom_invite_select ON public.prom_invite FOR SELECT TO authenticated USING (public.can_access_episode(episode_id));
CREATE POLICY prom_invite_insert ON public.prom_invite FOR INSERT TO authenticated
  WITH CHECK (public.can_access_episode(episode_id) AND created_by = auth.uid() AND used_at IS NULL AND response_id IS NULL);
CREATE POLICY prom_invite_delete ON public.prom_invite FOR DELETE TO authenticated USING (public.can_access_episode(episode_id) AND used_at IS NULL);
-- sem UPDATE para authenticated: uso do convite só pela função abaixo

-- Role exclusiva do servidor para as rotas públicas do paciente.
-- NÃO é concedida a anon/authenticated, então o PostgREST do Supabase não alcança estas funções.
-- Role global ao cluster: criação concorrente gera unique_violation (tratado junto com duplicate_object)
DO $$ BEGIN CREATE ROLE docsholder_public NOLOGIN; EXCEPTION WHEN duplicate_object OR unique_violation THEN NULL; END $$;
DO $$ BEGIN GRANT docsholder_public TO CURRENT_USER; EXCEPTION WHEN unique_violation THEN NULL; END $$;
GRANT USAGE ON SCHEMA public TO docsholder_public;

CREATE OR REPLACE FUNCTION public.prom_invite_info(p_token_hash text)
RETURNS TABLE (instrument text, timepoint text, expires_at timestamptz, status text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT i.instrument, i.timepoint, i.expires_at,
         CASE WHEN i.used_at IS NOT NULL THEN 'used' WHEN i.expires_at <= now() THEN 'expired' ELSE 'open' END
    FROM public.prom_invite i WHERE i.token_hash = p_token_hash;
$$;

CREATE OR REPLACE FUNCTION public.prom_invite_submit(
  p_token_hash text, p_instrument_version text, p_answers jsonb,
  p_score numeric, p_score_max numeric, p_subscores jsonb, p_flags text[])
RETURNS TABLE (status text, response_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE inv public.prom_invite; rid uuid;
BEGIN
  SELECT * INTO inv FROM public.prom_invite WHERE token_hash = p_token_hash FOR UPDATE;
  IF NOT FOUND THEN RETURN QUERY SELECT 'not_found'::text, NULL::uuid; RETURN; END IF;
  IF inv.used_at IS NOT NULL THEN RETURN QUERY SELECT 'used'::text, NULL::uuid; RETURN; END IF;
  IF inv.expires_at <= now() THEN RETURN QUERY SELECT 'expired'::text, NULL::uuid; RETURN; END IF;
  INSERT INTO public.prom_response (episode_id, instrument, instrument_version, timepoint, answers, score, score_max, subscores, flags, respondent, completed_at)
  VALUES (inv.episode_id, inv.instrument, p_instrument_version, inv.timepoint, p_answers, p_score, p_score_max, p_subscores, p_flags, 'patient', now())
  RETURNING id INTO rid;
  UPDATE public.prom_invite SET used_at = now(), response_id = rid WHERE id = inv.id;
  RETURN QUERY SELECT 'ok'::text, rid;
END $$;

REVOKE ALL ON FUNCTION public.prom_invite_info(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.prom_invite_submit(text, text, jsonb, numeric, numeric, jsonb, text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.prom_invite_info(text) TO docsholder_public;
GRANT EXECUTE ON FUNCTION public.prom_invite_submit(text, text, jsonb, numeric, numeric, jsonb, text[]) TO docsholder_public;

-- ---------------- protocolos pós-operatórios ----------------
CREATE TABLE IF NOT EXISTS public.postop_protocol (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id    UUID NOT NULL DEFAULT auth.uid(),
  code        TEXT NOT NULL CHECK (code ~ '^[A-Z0-9_]{2,40}$'),
  title       TEXT NOT NULL CHECK (char_length(btrim(title)) BETWEEN 2 AND 120),
  body        TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 20000),
  active      BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (owner_id, code)
);
ALTER TABLE public.postop_protocol ENABLE ROW LEVEL SECURITY;
CREATE POLICY postop_protocol_own ON public.postop_protocol FOR ALL TO authenticated
  USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());

COMMIT;
