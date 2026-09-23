-- =====================================================================
-- DocSholder — 000: paciente e membros de clínica (MODO STANDALONE).
-- Se o seu projeto (DocKnee) JÁ TEM public.patient e public.clinic_member, NÃO aplique este arquivo:
-- ajuste 001 aos nomes reais, como descrito em REPLIT_INTEGRACAO.md.
-- =====================================================================
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.clinic_member (
  clinic_id  UUID NOT NULL,
  user_id    UUID NOT NULL,
  role       TEXT NOT NULL CHECK (role IN ('surgeon','admin','assistant')),
  active     BOOLEAN NOT NULL DEFAULT true,
  PRIMARY KEY (clinic_id, user_id)
);
ALTER TABLE public.clinic_member ENABLE ROW LEVEL SECURITY;
-- cada usuário vê só as próprias vinculações; gestão de membros é administrativa (service_role)
CREATE POLICY clinic_member_self ON public.clinic_member FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE TABLE IF NOT EXISTS public.patient (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id       UUID NOT NULL DEFAULT auth.uid(),
  clinic_id      UUID,
  name           TEXT NOT NULL CHECK (char_length(btrim(name)) BETWEEN 2 AND 200),
  record_number  TEXT CHECK (char_length(record_number) <= 40),
  birth_date     DATE CHECK (birth_date > DATE '1900-01-01'),
  sex            TEXT CHECK (sex IN ('F','M','O')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS patient_owner_idx ON public.patient(owner_id);
ALTER TABLE public.patient ENABLE ROW LEVEL SECURITY;
-- mesma regra de can_access_owner() (definida em 001, que depende desta tabela)
CREATE POLICY patient_rw ON public.patient FOR ALL TO authenticated
  USING (owner_id = auth.uid() OR (clinic_id IS NOT NULL AND EXISTS (
          SELECT 1 FROM public.clinic_member cm WHERE cm.clinic_id = patient.clinic_id AND cm.user_id = auth.uid()
             AND cm.role IN ('surgeon','admin') AND cm.active)))
  WITH CHECK (owner_id = auth.uid() OR (clinic_id IS NOT NULL AND EXISTS (
          SELECT 1 FROM public.clinic_member cm WHERE cm.clinic_id = patient.clinic_id AND cm.user_id = auth.uid()
             AND cm.role IN ('surgeon','admin') AND cm.active)));
COMMIT;
