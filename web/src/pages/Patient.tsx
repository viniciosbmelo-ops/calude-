import { FormEvent, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { MECHANISM_PT, REGION_PT, SIDE_PT, STATUS_PT, useReference } from '../lib/ref';
import { ErrorBox, Loading, Modal, fmtDate, useLoad } from '../components/ui';
import { PathologyMulti, PathologyTree } from '../components/PathologyPicker';
import type { Patient } from './Patients';

export interface Episode {
  id: string; patient_id: string; region: 'shoulder' | 'elbow'; side: 'R' | 'L'; affected_is_dominant: boolean;
  primary_pathology: string; secondary_pathologies: string[]; mechanism: string | null; onset_date: string | null; status: string; opened_at: string;
  surgeries?: { id: string; surgery_date: string; side: string; status: string }[];
}

export function PatientPage() {
  const { id } = useParams();
  const { byCode } = useReference();
  const [creating, setCreating] = useState(false);
  const p = useLoad(() => api.get<Patient>(`/api/patients/${id}`), [id]);
  const eps = useLoad(() => api.get<Episode[]>(`/api/patients/${id}/episodes`), [id]);
  if (p.error) return <div className="page"><ErrorBox error={p.error} /></div>;
  if (!p.data) return <Loading />;
  return (
    <div className="page">
      <div className="crumbs"><Link to="/pacientes">Pacientes</Link></div>
      <div className="page-head">
        <div>
          <h1>{p.data.name}</h1>
          <div className="muted small">{p.data.record_number ? `Prontuário ${p.data.record_number}` : 'Sem prontuário'}{p.data.birth_date ? ` · nasc. ${fmtDate(p.data.birth_date)}` : ''}</div>
        </div>
        <button className="primary" onClick={() => setCreating(true)}>+ Novo episódio</button>
      </div>
      <div className="card">
        <h2>Episódios</h2>
        <ErrorBox error={eps.error} />
        {!eps.data ? <Loading /> : eps.data.length === 0 ? <div className="empty">Nenhum episódio. Um episódio agrupa diagnóstico, cirurgias e seguimento de uma articulação.</div> : (
          <ul className="list">
            {eps.data.map((e) => (
              <li key={e.id}>
                <Link to={`/episodios/${e.id}`} className="list-link">
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600 }}>{byCode.get(e.primary_pathology)?.name_pt ?? e.primary_pathology}</div>
                    <div className="muted small">{REGION_PT[e.region]} {SIDE_PT[e.side].toLowerCase()} · aberto em {fmtDate(e.opened_at)}{e.secondary_pathologies.length ? ` · +${e.secondary_pathologies.length} associada(s)` : ''}</div>
                  </div>
                  <span className="badge">{STATUS_PT[e.status]}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
      {creating && <NewEpisode patientId={id!} onClose={() => setCreating(false)} />}
    </div>
  );
}

function NewEpisode({ patientId, onClose }: { patientId: string; onClose(): void }) {
  const nav = useNavigate();
  const [region, setRegion] = useState<'shoulder' | 'elbow'>('shoulder');
  const [side, setSide] = useState<'R' | 'L' | ''>('');
  const [dominant, setDominant] = useState<boolean | null>(null);
  const [primary, setPrimary] = useState<string>();
  const [secondary, setSecondary] = useState<string[]>([]);
  const [mechanism, setMechanism] = useState('');
  const [onset, setOnset] = useState('');
  const [err, setErr] = useState<unknown>();
  const [busy, setBusy] = useState(false);
  const ready = side && dominant !== null && primary;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!ready) return;
    setBusy(true);
    try {
      const ep = await api.post<Episode>(`/api/patients/${patientId}/episodes`, {
        region, side, affected_is_dominant: dominant, primary_pathology: primary, secondary_pathologies: secondary,
        mechanism: mechanism || undefined, onset_date: onset || undefined
      });
      nav(`/episodios/${ep.id}`);
    } catch (x) { setErr(x); setBusy(false); }
  }

  return (
    <Modal title="Novo episódio" onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <div className="field"><div className="field-label">Região</div>
          <div className="segmented">{(['shoulder', 'elbow'] as const).map((r) => <button type="button" key={r} aria-pressed={region === r} onClick={() => { setRegion(r); setPrimary(undefined); setSecondary([]); }}>{REGION_PT[r]}</button>)}</div>
        </div>
        <div className="form-grid">
          <div className="field"><div className="field-label">Lado <span className="req">*</span></div>
            <div className="segmented">{(['R', 'L'] as const).map((s) => <button type="button" key={s} aria-pressed={side === s} onClick={() => setSide(s)}>{SIDE_PT[s]}</button>)}</div>
          </div>
          <div className="field"><div className="field-label">Lado dominante? <span className="req">*</span></div>
            <div className="segmented">{[true, false].map((b) => <button type="button" key={String(b)} aria-pressed={dominant === b} onClick={() => setDominant(b)}>{b ? 'Sim' : 'Não'}</button>)}</div>
          </div>
        </div>
        <div className="field"><div className="field-label">Patologia principal <span className="req">*</span></div>
          <PathologyTree region={region} value={primary} onChange={(c) => { setPrimary(c); setSecondary(secondary.filter((s) => s !== c)); }} />
        </div>
        <div className="field"><div className="field-label">Patologias associadas</div>
          <PathologyMulti region={region} value={secondary} onChange={setSecondary} exclude={primary ? [primary] : []} />
          <div className="field-note">Procedimentos só podem ser registrados para a principal, as associadas ou subtipos delas.</div>
        </div>
        <div className="form-grid">
          <label className="field"><div className="field-label">Mecanismo</div>
            <select value={mechanism} onChange={(e) => setMechanism(e.target.value)}><option value="">—</option>{Object.entries(MECHANISM_PT).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          </label>
          <label className="field"><div className="field-label">Início dos sintomas</div><input type="date" value={onset} onChange={(e) => setOnset(e.target.value)} /></label>
        </div>
        <ErrorBox error={err} />
        <div className="row" style={{ justifyContent: 'flex-end' }}><button type="button" onClick={onClose}>Cancelar</button><button className="primary" disabled={!ready || busy}>Criar episódio</button></div>
      </form>
    </Modal>
  );
}
