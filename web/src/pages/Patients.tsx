import { FormEvent, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { ErrorBox, Loading, Modal, fmtDate, useLoad } from '../components/ui';

export interface Patient { id: string; name: string | null; record_number: string | null; birth_date: string | null; sex: string | null }

export function Patients() {
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [creating, setCreating] = useState(false);
  useEffect(() => { const t = setTimeout(() => setDebounced(q.trim()), 250); return () => clearTimeout(t); }, [q]);
  const { data, error, loading } = useLoad(() => api.get<Patient[]>(`/api/patients?q=${encodeURIComponent(debounced)}`), [debounced]);

  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Pacientes</h1><div className="muted small">Busque por nome ou número de prontuário.</div></div>
        <button className="primary" onClick={() => setCreating(true)}>+ Novo paciente</button>
      </div>
      <div className="card">
        <input type="search" placeholder="Buscar…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar paciente" style={{ marginBottom: 8 }} />
        <ErrorBox error={error} />
        {loading && !data ? <Loading /> : data && data.length === 0 ? <div className="empty">Nenhum paciente{debounced ? ' encontrado' : ' cadastrado ainda'}.</div> : (
          <ul className="list">
            {data?.map((p) => (
              <li key={p.id}>
                <Link className="list-link" to={`/pacientes/${p.id}`}>
                  <div style={{ flex: 1 }}><div style={{ fontWeight: 600 }}>{p.name ?? '(sem nome)'}</div><div className="muted small">{p.record_number ? `Prontuário ${p.record_number}` : 'Sem prontuário'}{p.birth_date ? ` · nasc. ${fmtDate(p.birth_date)}` : ''}</div></div>
                  <span className="muted">›</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
      {creating && <NewPatient onClose={() => setCreating(false)} />}
    </div>
  );
}

function NewPatient({ onClose }: { onClose(): void }) {
  const nav = useNavigate();
  const [f, setF] = useState({ name: '', record_number: '', birth_date: '', sex: '' });
  const [err, setErr] = useState<unknown>();
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true);
    try {
      const p = await api.post<Patient>('/api/patients', { name: f.name, record_number: f.record_number || null, birth_date: f.birth_date || null, sex: f.sex || null });
      nav(`/pacientes/${p.id}`);
    } catch (x) { setErr(x); setBusy(false); }
  }
  return (
    <Modal title="Novo paciente" onClose={onClose}>
      <form className="stack" onSubmit={submit} id="new-patient">
        <label className="field"><div className="field-label">Nome completo <span className="req">*</span></div><input required minLength={2} maxLength={200} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus /></label>
        <div className="form-grid">
          <label className="field"><div className="field-label">Prontuário</div><input maxLength={40} value={f.record_number} onChange={(e) => setF({ ...f, record_number: e.target.value })} /></label>
          <label className="field"><div className="field-label">Nascimento</div><input type="date" value={f.birth_date} onChange={(e) => setF({ ...f, birth_date: e.target.value })} /></label>
          <label className="field"><div className="field-label">Sexo</div>
            <select value={f.sex} onChange={(e) => setF({ ...f, sex: e.target.value })}><option value="">—</option><option value="F">Feminino</option><option value="M">Masculino</option><option value="O">Outro</option></select>
          </label>
        </div>
        <ErrorBox error={err} />
        <div className="row" style={{ justifyContent: 'flex-end' }}><button type="button" onClick={onClose}>Cancelar</button><button className="primary" disabled={busy}>Cadastrar</button></div>
      </form>
    </Modal>
  );
}
