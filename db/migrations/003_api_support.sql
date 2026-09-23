-- =====================================================================
-- DocSholder — 003: suporte à API
--   * verify_report_hash(): verificação pública (/verify/:hash) sem expor conteúdo clínico.
-- Requer 001. Idempotente.
-- =====================================================================
BEGIN;

CREATE INDEX IF NOT EXISTS surgical_report_hash_idx ON public.surgical_report(content_hash) WHERE content_hash IS NOT NULL;

-- Retorna só data de assinatura e se foi substituído por versão mais nova. Nada de texto, paciente ou cirurgião.
CREATE OR REPLACE FUNCTION public.verify_report_hash(p_hash text)
RETURNS TABLE (signed_at timestamptz, superseded boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT r.signed_at,
         EXISTS (SELECT 1 FROM public.surgical_report n WHERE n.supersedes = r.id AND n.signed_at IS NOT NULL)
    FROM public.surgical_report r
   WHERE r.content_hash = lower(p_hash) AND r.signed_at IS NOT NULL
   LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.verify_report_hash(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.verify_report_hash(text) TO anon, authenticated;

COMMIT;
