import { useCallback, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import { REGION_PT, SIDE_PT, STATUS_PT, useReference } from '../lib/ref';
import { ErrorBox, Loading, fmtDate, useLoad } from '../components/ui';
import type { Episode } from './Patient';
import { CoreStep } from './surgery/CoreStep';
import { MapStep } from './surgery/MapStep';
import { ProceduresStep } from './surgery/ProceduresStep';
import { ImplantsStep } from './surgery/ImplantsStep';
import { ReportStep } from './surgery/ReportStep';

export type RegisterFlush = (f: () => Promise<void>) => () => void;

export interface SurgeryFull {
  id: string; episode_id: string; patient_id: string; surgeon_id: string; region: 'shoulder' | 'elbow'; episode_side: 'R' | 'L';
  core: Record<string, any>; status: string; surgery_date: string; side: string;
  validation: { valid: boolean; issues: any[] };
  procedures: { id: string; pathology_code: string; sequence: number; schema_id: string; data: Record<string, any>; validation: { valid: boolean } }[];
  arthroscopic_map: { structure_code: string; status: string; finding_text: string | null; justification: string | null }[];
  implants: any[];
  reports: { id: string; version: number; signed_at: string | null }[];
}

const STEPS = [['core', 'Núcleo'], ['map', 'Mapa artroscópico'], ['procs', 'Procedimentos'], ['implants', 'Implantes'], ['report', 'Relatório']] as const;
type Step = (typeof STEPS)[number][0];

export function SurgeryPage() {
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const step = (params.get('etapa') as Step) || 'core';
  const { byCode } = useReference();
  const s = useLoad(() => api.get<SurgeryFull>(`/api/surgeries/${id}`), [id]);
  const ep = useLoad(async () => (s.data ? api.get<Episode>(`/api/episodes/${s.data.episode_id}`) : undefined), [s.data?.episode_id]);
  const [dirtyKey, setDirtyKey] = useState(0); // força recarga ao trocar de etapa
  // Cada etapa registra aqui como salvar o que está pendente (autosave com debounce)
  const flushers = useRef(new Set<() => Promise<void>>());
  const registerFlush = useCallback((f: () => Promise<void>) => { flushers.current.add(f); return () => { flushers.current.delete(f); }; }, []);

  if (s.error) return <div className="page"><ErrorBox error={s.error} /></div>;
  if (!s.data || !ep.data) return <Loading />;
  const sg = s.data;
  const locked = sg.status === 'signed' || sg.status === 'amended';
  // Recarrega do servidor ANTES de remontar a etapa, para que ela nasça com os dados salvos
  const go = async (k: Step) => { await Promise.all([...flushers.current].map((f) => f())); await s.reload(); setParams({ etapa: k }, { replace: true }); setDirtyKey((x) => x + 1); };
  const badge = (k: Step) => {
    if (k === 'core') return sg.validation.valid ? '✓' : '!';
    if (k === 'procs') return sg.procedures.length === 0 ? '0' : sg.procedures.every((p) => p.validation.valid) ? '✓' : '!';
    if (k === 'map') return String(sg.arthroscopic_map.length || '');
    if (k === 'implants') return String(sg.implants.length || '');
    return sg.reports.length ? `v${sg.reports[sg.reports.length - 1].version}` : '';
  };
  return (
    <div className="page">
      <div className="crumbs"><Link to={`/pacientes/${sg.patient_id}`}>Paciente</Link> › <Link to={`/episodios/${sg.episode_id}`}>{byCode.get(ep.data.primary_pathology)?.name_pt}</Link></div>
      <div className="page-head">
        <div>
          <h1>Cirurgia de {fmtDate(sg.surgery_date)}</h1>
          <div className="muted small">{REGION_PT[sg.region]} {SIDE_PT[sg.episode_side].toLowerCase()}</div>
        </div>
        <span className={`badge ${locked ? 'ok' : ''}`}>{STATUS_PT[sg.status]}</span>
      </div>
      {locked && step !== 'report' && <div className="alert info" style={{ marginBottom: 12 }}>Relatório assinado: o registro está travado. Correções entram como nova versão do relatório.</div>}
      <nav className="steps" aria-label="Etapas">
        {STEPS.map(([k, label], i) => (
          <button key={k} aria-current={step === k ? 'step' : undefined} onClick={() => void go(k)}>
            <span className="step-num">{i + 1}</span>{label}{badge(k) && <span className="badge" style={{ marginLeft: 4 }}>{badge(k)}</span>}
          </button>
        ))}
      </nav>
      <div key={dirtyKey}>
        {step === 'core' && <CoreStep registerFlush={registerFlush} surgery={sg} locked={locked} onNext={() => void go('map')} />}
        {step === 'map' && <MapStep registerFlush={registerFlush} surgery={sg} locked={locked} onNext={() => void go('procs')} />}
        {step === 'procs' && <ProceduresStep registerFlush={registerFlush} surgery={sg} episode={ep.data} locked={locked} onNext={() => void go('implants')} />}
        {step === 'implants' && <ImplantsStep registerFlush={registerFlush} surgery={sg} locked={locked} onNext={() => void go('report')} />}
        {step === 'report' && <ReportStep surgery={sg} episode={ep.data} onChanged={() => void s.reload()} />}
      </div>
    </div>
  );
}
