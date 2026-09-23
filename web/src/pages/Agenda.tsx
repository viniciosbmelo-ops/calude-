import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { REGION_PT, SIDE_PT, TIMEPOINT_PT, useReference } from '../lib/ref';
import { ErrorBox, Loading, fmtDate, useLoad } from '../components/ui';

const STATUS: Record<string, [string, string]> = { due: ['Na janela', 'primary'], overdue: ['Atrasado', 'danger'], future: ['Futuro', ''], done: ['Respondido', 'ok'] };

export function Agenda() {
  const { byCode } = useReference();
  const a = useLoad(() => api.get<any[]>('/api/proms/agenda'), []);
  const [filter, setFilter] = useState<'open' | 'all'>('open');
  const rows = useMemo(() => (a.data ?? []).filter((r) => filter === 'all' || r.status === 'due' || r.status === 'overdue'), [a.data, filter]);
  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Seguimento</h1><div className="muted small">Escores pós-operatórios agendados na assinatura de cada relatório.</div></div>
        <div className="segmented"><button aria-pressed={filter === 'open'} onClick={() => setFilter('open')}>Pendentes agora</button><button aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>Todos</button></div>
      </div>
      <div className="card">
        <ErrorBox error={a.error} />
        {!a.data ? <Loading /> : rows.length === 0 ? <div className="empty">{filter === 'open' ? 'Nada pendente na janela atual.' : 'Nenhum seguimento agendado ainda.'}</div> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Paciente</th><th>Episódio</th><th>Momento</th><th>Data-alvo</th><th>Janela</th><th>Situação</th></tr></thead>
              <tbody>{rows.map((r) => (
                <tr key={r.id}>
                  <td><Link to={`/pacientes/${r.patient_id}`}>{r.patient_name ?? '—'}</Link></td>
                  <td><Link to={`/episodios/${r.episode_id}`}>{byCode.get(r.primary_pathology)?.name_pt}</Link><div className="muted small">{REGION_PT[r.region as 'shoulder']} {SIDE_PT[r.side as 'R'].toLowerCase()}</div></td>
                  <td>{TIMEPOINT_PT[r.timepoint]}</td>
                  <td className="nowrap">{fmtDate(r.due)}</td>
                  <td className="small nowrap">{fmtDate(r.window_start)} – {fmtDate(r.window_end)}</td>
                  <td><span className={`badge ${STATUS[r.status][1]}`}>{STATUS[r.status][0]}</span></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
