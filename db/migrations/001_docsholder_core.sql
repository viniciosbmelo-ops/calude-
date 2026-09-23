-- =====================================================================
-- DocSholder — 001: núcleo de episódio, cirurgia, implantes, relatório
-- Especificação v1, seção 2.2. PostgreSQL 15+ / Supabase.
--
-- PRÉ-REQUISITOS (já existentes no seu projeto):
--   * tabela public.patient(id uuid PK, owner_id uuid, clinic_id uuid NULL, ...)
--   * auth.uid() (Supabase)
-- ADAPTAR: a função public.can_access_owner() abaixo reproduz a regra
--   "dono OU membro autorizado da clínica". Se o DocKnee já tem helper
--   equivalente (ex.: is_clinic_member), troque o corpo por ele.
-- =====================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------
-- Helper de acesso (AJUSTAR à tabela de membros de clínica do DocKnee)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.can_access_owner(p_owner uuid, p_clinic uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p_owner = auth.uid()
     OR (p_clinic IS NOT NULL AND EXISTS (
          SELECT 1 FROM public.clinic_member cm
           WHERE cm.clinic_id = p_clinic
             AND cm.user_id = auth.uid()
             AND cm.role IN ('surgeon','admin')
             AND cm.active
        ));
$$;

-- ---------------------------------------------------------------------
-- Catálogo de patologias (dados versionados; seed em 002)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.pathology_catalog (
  code                  TEXT PRIMARY KEY CHECK (code ~ '^(SH|EL|KN|HP|FT|HD)_[A-Z0-9_]+$'),
  region                TEXT NOT NULL CHECK (region IN ('shoulder','elbow','knee','hip','foot','hand')),
  name_pt               TEXT NOT NULL,
  parent_code           TEXT REFERENCES public.pathology_catalog(code),
  icd10_hint            TEXT[] DEFAULT '{}',
  schema_version        INT NOT NULL DEFAULT 1,
  diagnosis_schema_id   TEXT,
  intraop_schema_id     TEXT,
  report_template       TEXT,
  default_protocol_code TEXT,
  proms_default         TEXT[] DEFAULT '{}',
  active                BOOLEAN NOT NULL DEFAULT true,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.pathology_catalog ENABLE ROW LEVEL SECURITY;
CREATE POLICY pathology_catalog_read ON public.pathology_catalog FOR SELECT TO authenticated USING (true);
-- escrita somente via service_role (sem policy de INSERT/UPDATE para authenticated)

-- ---------------------------------------------------------------------
-- Episódio de cuidado
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.care_episode (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id             UUID NOT NULL REFERENCES public.patient(id) ON DELETE RESTRICT,
  owner_id               UUID NOT NULL,
  clinic_id              UUID,
  region                 TEXT NOT NULL CHECK (region IN ('shoulder','elbow')),
  side                   TEXT NOT NULL CHECK (side IN ('R','L')),
  affected_is_dominant   BOOLEAN NOT NULL,
  primary_pathology      TEXT NOT NULL REFERENCES public.pathology_catalog(code),
  secondary_pathologies  TEXT[] NOT NULL DEFAULT '{}',
  mechanism              TEXT CHECK (mechanism IN ('traumatic','degenerative','acute_on_chronic','overuse','unknown')),
  onset_date             DATE,
  status                 TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','surgical','conservative','closed')),
  opened_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS care_episode_patient_idx ON public.care_episode(patient_id);
CREATE INDEX IF NOT EXISTS care_episode_owner_idx ON public.care_episode(owner_id);
ALTER TABLE public.care_episode ENABLE ROW LEVEL SECURITY;
CREATE POLICY care_episode_rw ON public.care_episode FOR ALL TO authenticated
  USING (public.can_access_owner(owner_id, clinic_id))
  WITH CHECK (public.can_access_owner(owner_id, clinic_id));

-- Garante que o episódio pertence ao mesmo dono do paciente
CREATE OR REPLACE FUNCTION public.care_episode_patient_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.patient p WHERE p.id = NEW.patient_id
                 AND public.can_access_owner(p.owner_id, p.clinic_id)) THEN
    RAISE EXCEPTION 'Paciente inacessível para este usuário' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER care_episode_patient_guard_trg BEFORE INSERT OR UPDATE OF patient_id
  ON public.care_episode FOR EACH ROW EXECUTE FUNCTION public.care_episode_patient_guard();

-- Helper: acesso via episódio
CREATE OR REPLACE FUNCTION public.can_access_episode(p_episode uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.care_episode e
                  WHERE e.id = p_episode AND public.can_access_owner(e.owner_id, e.clinic_id));
$$;

-- ---------------------------------------------------------------------
-- Avaliações (história, exame, imagem, diagnóstico, planejamento, escore clínico)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.episode_assessment (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  episode_id      UUID NOT NULL REFERENCES public.care_episode(id) ON DELETE CASCADE,
  kind            TEXT NOT NULL CHECK (kind IN ('history','physical_exam','imaging','diagnosis','planning','clinical_score')),
  pathology_code  TEXT REFERENCES public.pathology_catalog(code),
  schema_id       TEXT NOT NULL,
  data            JSONB NOT NULL,
  performed_at    TIMESTAMPTZ NOT NULL,
  author_id       UUID NOT NULL DEFAULT auth.uid(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS episode_assessment_ep_idx ON public.episode_assessment(episode_id, kind);
ALTER TABLE public.episode_assessment ENABLE ROW LEVEL SECURITY;
CREATE POLICY episode_assessment_rw ON public.episode_assessment FOR ALL TO authenticated
  USING (public.can_access_episode(episode_id)) WITH CHECK (public.can_access_episode(episode_id));

-- ---------------------------------------------------------------------
-- Cirurgia
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.surgery (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  episode_id      UUID NOT NULL REFERENCES public.care_episode(id) ON DELETE RESTRICT,
  surgeon_id      UUID NOT NULL DEFAULT auth.uid(),
  core_schema_id  TEXT NOT NULL DEFAULT 'CORE_SURGERY.v1',
  core            JSONB NOT NULL,              -- validado por CORE_SURGERY.v1
  surgery_date    DATE NOT NULL,             -- preenchido por trigger a partir de core
  side            TEXT NOT NULL CHECK (side IN ('R','L')),  -- idem
  status          TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','completed','signed','amended')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS surgery_episode_idx ON public.surgery(episode_id);
CREATE INDEX IF NOT EXISTS surgery_date_idx ON public.surgery(surgeon_id, surgery_date);
ALTER TABLE public.surgery ENABLE ROW LEVEL SECURITY;
CREATE POLICY surgery_select ON public.surgery FOR SELECT TO authenticated USING (public.can_access_episode(episode_id));
CREATE POLICY surgery_insert ON public.surgery FOR INSERT TO authenticated WITH CHECK (public.can_access_episode(episode_id));
CREATE POLICY surgery_update ON public.surgery FOR UPDATE TO authenticated
  USING (public.can_access_episode(episode_id) AND status IN ('draft','completed'))
  WITH CHECK (public.can_access_episode(episode_id));
-- sem DELETE para authenticated

-- Deriva colunas de core e garante lado da cirurgia = lado do episódio (bloqueante também no banco)
CREATE OR REPLACE FUNCTION public.surgery_side_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.surgery_date := (NEW.core->>'surgery_date')::date;
  NEW.side := NEW.core->>'side';
  IF (NEW.core->>'side') IS DISTINCT FROM (SELECT side FROM public.care_episode WHERE id = NEW.episode_id) THEN
    RAISE EXCEPTION 'Lado da cirurgia difere do lado do episódio' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER surgery_side_guard_trg BEFORE INSERT OR UPDATE OF core, episode_id
  ON public.surgery FOR EACH ROW EXECUTE FUNCTION public.surgery_side_guard();

CREATE OR REPLACE FUNCTION public.can_edit_surgery(p_surgery uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.surgery s
                  WHERE s.id = p_surgery AND s.status IN ('draft','completed')
                    AND public.can_access_episode(s.episode_id));
$$;
CREATE OR REPLACE FUNCTION public.can_read_surgery(p_surgery uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.surgery s
                  WHERE s.id = p_surgery AND public.can_access_episode(s.episode_id));
$$;

-- ---------------------------------------------------------------------
-- Procedimentos (1 cirurgia : N procedimentos, cada um → patologia)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.surgery_procedure (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  surgery_id      UUID NOT NULL REFERENCES public.surgery(id) ON DELETE CASCADE,
  pathology_code  TEXT NOT NULL REFERENCES public.pathology_catalog(code),
  sequence        INT  NOT NULL CHECK (sequence > 0),
  schema_id       TEXT NOT NULL,
  schema_version  INT  NOT NULL,
  data            JSONB NOT NULL,
  UNIQUE (surgery_id, sequence) DEFERRABLE INITIALLY DEFERRED
);
ALTER TABLE public.surgery_procedure ENABLE ROW LEVEL SECURITY;
CREATE POLICY surgery_procedure_select ON public.surgery_procedure FOR SELECT TO authenticated USING (public.can_read_surgery(surgery_id));
CREATE POLICY surgery_procedure_write ON public.surgery_procedure FOR ALL TO authenticated
  USING (public.can_edit_surgery(surgery_id)) WITH CHECK (public.can_edit_surgery(surgery_id));

-- Procedimento só pode referenciar patologia principal/secundária do episódio (ou filha delas)
CREATE OR REPLACE FUNCTION public.surgery_procedure_pathology_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE ep public.care_episode; parent TEXT;
BEGIN
  SELECT e.* INTO ep FROM public.care_episode e JOIN public.surgery s ON s.episode_id = e.id WHERE s.id = NEW.surgery_id;
  SELECT parent_code INTO parent FROM public.pathology_catalog WHERE code = NEW.pathology_code;
  -- COALESCE: parent_code NULL não pode transformar a condição em NULL (que o IF trataria como falso)
  IF NOT COALESCE(
       NEW.pathology_code = ep.primary_pathology
    OR NEW.pathology_code = ANY(ep.secondary_pathologies)
    OR (parent IS NOT NULL AND (parent = ep.primary_pathology OR parent = ANY(ep.secondary_pathologies))),
    false
  ) THEN
    RAISE EXCEPTION 'Patologia % não pertence ao episódio — adicione-a como secundária primeiro', NEW.pathology_code
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER surgery_procedure_pathology_guard_trg BEFORE INSERT OR UPDATE OF pathology_code
  ON public.surgery_procedure FOR EACH ROW EXECUTE FUNCTION public.surgery_procedure_pathology_guard();

-- ---------------------------------------------------------------------
-- Mapa artroscópico
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.arthroscopic_map (
  surgery_id      UUID NOT NULL REFERENCES public.surgery(id) ON DELETE CASCADE,
  structure_code  TEXT NOT NULL CHECK (structure_code ~ '^(GH|SA|EL)_[A-Z_]+$'),
  status          TEXT NOT NULL CHECK (status IN ('normal','lesion','treated','not_evaluated')),
  finding_text    TEXT CHECK (char_length(finding_text) <= 300),
  finding         JSONB,
  justification   TEXT CHECK (char_length(justification) <= 300),
  PRIMARY KEY (surgery_id, structure_code)
);
ALTER TABLE public.arthroscopic_map ENABLE ROW LEVEL SECURITY;
CREATE POLICY arthroscopic_map_select ON public.arthroscopic_map FOR SELECT TO authenticated USING (public.can_read_surgery(surgery_id));
CREATE POLICY arthroscopic_map_write ON public.arthroscopic_map FOR ALL TO authenticated
  USING (public.can_edit_surgery(surgery_id)) WITH CHECK (public.can_edit_surgery(surgery_id));

-- ---------------------------------------------------------------------
-- Implantes
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.implant_catalog (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category        TEXT NOT NULL CHECK (category IN ('anchor','screw','plate','button','prosthesis_component','graft','suture_tape','other')),
  manufacturer    TEXT NOT NULL,
  model           TEXT NOT NULL,
  ref_code        TEXT,
  gtin            TEXT CHECK (gtin ~ '^\d{14}$'),
  anvisa_reg      TEXT,
  material        TEXT,
  size_spec       JSONB,
  owner_id        UUID,                      -- NULL = catálogo global curado
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS implant_catalog_gtin_owner_uq ON public.implant_catalog(gtin, COALESCE(owner_id, '00000000-0000-0000-0000-000000000000'::uuid)) WHERE gtin IS NOT NULL;
ALTER TABLE public.implant_catalog ENABLE ROW LEVEL SECURITY;
CREATE POLICY implant_catalog_read ON public.implant_catalog FOR SELECT TO authenticated USING (owner_id IS NULL OR owner_id = auth.uid());
CREATE POLICY implant_catalog_write_own ON public.implant_catalog FOR ALL TO authenticated
  USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());

CREATE TABLE IF NOT EXISTS public.surgery_implant (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  surgery_id      UUID NOT NULL REFERENCES public.surgery(id) ON DELETE CASCADE,
  procedure_id    UUID REFERENCES public.surgery_procedure(id) ON DELETE SET NULL,
  implant_id      UUID REFERENCES public.implant_catalog(id),
  lot             TEXT,
  serial          TEXT,
  expiry          DATE,
  quantity        INT NOT NULL DEFAULT 1 CHECK (quantity BETWEEN 1 AND 50),
  location        TEXT CHECK (char_length(location) <= 120),
  raw_barcode     TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.surgery_implant ENABLE ROW LEVEL SECURITY;
CREATE POLICY surgery_implant_select ON public.surgery_implant FOR SELECT TO authenticated USING (public.can_read_surgery(surgery_id));
CREATE POLICY surgery_implant_write ON public.surgery_implant FOR ALL TO authenticated
  USING (public.can_edit_surgery(surgery_id)) WITH CHECK (public.can_edit_surgery(surgery_id));

-- ---------------------------------------------------------------------
-- Relatório cirúrgico (imutável após assinatura)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.surgical_report (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  surgery_id          UUID NOT NULL REFERENCES public.surgery(id) ON DELETE RESTRICT,
  version             INT NOT NULL CHECK (version > 0),
  template_versions   JSONB NOT NULL,
  generated_text      TEXT NOT NULL,
  final_text          TEXT NOT NULL,
  diff_from_generated JSONB,
  signed_by           UUID,
  signed_at           TIMESTAMPTZ,
  content_hash        TEXT CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  supersedes          UUID REFERENCES public.surgical_report(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (surgery_id, version),
  CHECK ((signed_at IS NULL) = (content_hash IS NULL) AND (signed_at IS NULL) = (signed_by IS NULL))
);
ALTER TABLE public.surgical_report ENABLE ROW LEVEL SECURITY;
CREATE POLICY surgical_report_select ON public.surgical_report FOR SELECT TO authenticated USING (public.can_read_surgery(surgery_id));
CREATE POLICY surgical_report_insert ON public.surgical_report FOR INSERT TO authenticated WITH CHECK (public.can_read_surgery(surgery_id));
CREATE POLICY surgical_report_update_unsigned ON public.surgical_report FOR UPDATE TO authenticated
  USING (public.can_read_surgery(surgery_id) AND signed_at IS NULL)
  WITH CHECK (public.can_read_surgery(surgery_id));
-- sem DELETE

-- Defesa em profundidade: trigger bloqueia qualquer alteração em relatório assinado,
-- inclusive via service_role.
CREATE OR REPLACE FUNCTION public.surgical_report_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Relatórios cirúrgicos não podem ser excluídos' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.signed_by IS NOT NULL AND NEW.signed_by IS DISTINCT FROM auth.uid() THEN
      RAISE EXCEPTION 'Assinatura deve ser do usuário autenticado' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.signed_at IS NOT NULL THEN
    RAISE EXCEPTION 'Relatório assinado é imutável — crie nova versão com supersedes' USING ERRCODE = '42501';
  END IF;
  IF NEW.signed_by IS NOT NULL AND NEW.signed_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Assinatura deve ser do usuário autenticado' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER surgical_report_immutable_trg BEFORE INSERT OR UPDATE OR DELETE
  ON public.surgical_report FOR EACH ROW EXECUTE FUNCTION public.surgical_report_immutable();

-- Ao assinar, a cirurgia passa a 'signed'
CREATE OR REPLACE FUNCTION public.surgical_report_after_sign() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.signed_at IS NOT NULL AND (TG_OP = 'INSERT' OR OLD.signed_at IS NULL) THEN
    UPDATE public.surgery SET status = CASE WHEN NEW.supersedes IS NULL THEN 'signed' ELSE 'amended' END,
                              updated_at = now()
     WHERE id = NEW.surgery_id;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER surgical_report_after_sign_trg AFTER INSERT OR UPDATE OF signed_at
  ON public.surgical_report FOR EACH ROW EXECUTE FUNCTION public.surgical_report_after_sign();

-- ---------------------------------------------------------------------
-- Eventos clínicos e PROMs
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.clinical_event (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  episode_id           UUID NOT NULL REFERENCES public.care_episode(id) ON DELETE CASCADE,
  surgery_id           UUID REFERENCES public.surgery(id),
  event_type           TEXT NOT NULL,
  severity             TEXT CHECK (severity IN ('I','II','IIIa','IIIb','IVa','IVb','V')),
  event_date           DATE NOT NULL,
  requires_reoperation BOOLEAN NOT NULL DEFAULT false,
  data                 JSONB,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.clinical_event ENABLE ROW LEVEL SECURITY;
CREATE POLICY clinical_event_rw ON public.clinical_event FOR ALL TO authenticated
  USING (public.can_access_episode(episode_id)) WITH CHECK (public.can_access_episode(episode_id));

CREATE TABLE IF NOT EXISTS public.prom_response (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  episode_id         UUID NOT NULL REFERENCES public.care_episode(id) ON DELETE CASCADE,
  instrument         TEXT NOT NULL,
  instrument_version TEXT NOT NULL,
  timepoint          TEXT NOT NULL CHECK (timepoint IN ('preop','6w','3m','6m','12m','24m','other')),
  answers            JSONB NOT NULL,
  score              NUMERIC(6,1),
  score_max          NUMERIC(6,1),
  subscores          JSONB,
  flags              TEXT[] DEFAULT '{}',
  respondent         TEXT NOT NULL CHECK (respondent IN ('patient','clinician','mixed')),
  completed_at       TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS prom_response_ep_idx ON public.prom_response(episode_id, instrument, timepoint);
ALTER TABLE public.prom_response ENABLE ROW LEVEL SECURITY;
CREATE POLICY prom_response_rw ON public.prom_response FOR ALL TO authenticated
  USING (public.can_access_episode(episode_id)) WITH CHECK (public.can_access_episode(episode_id));
-- Respostas do paciente entram via endpoint com token de link (service_role), nunca por RLS direto.

-- ---------------------------------------------------------------------
-- Consentimento de pesquisa (LGPD) — separado do assistencial
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.research_consent (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id       UUID NOT NULL REFERENCES public.patient(id) ON DELETE CASCADE,
  consent_version  TEXT NOT NULL,
  granted_at       TIMESTAMPTZ NOT NULL,
  revoked_at       TIMESTAMPTZ,
  evidence         JSONB NOT NULL          -- canal, IP/hash de assinatura, texto exibido (hash)
);
ALTER TABLE public.research_consent ENABLE ROW LEVEL SECURITY;
CREATE POLICY research_consent_rw ON public.research_consent FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.patient p WHERE p.id = patient_id AND public.can_access_owner(p.owner_id, p.clinic_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.patient p WHERE p.id = patient_id AND public.can_access_owner(p.owner_id, p.clinic_id)));

COMMIT;
