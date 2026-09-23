import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, errorText } from '../lib/api';
import { REGION_PT, SIDE_PT, STATUS_PT, TIMEPOINT_PT, useReference } from '../lib/ref';
import { CLINICIAN_FORMS, Item } from '../lib/instruments';
import { ErrorBox, Loading, Modal, fmtDate, toast, useLoad } from '../components/ui';
import { PathologyMulti } from '../components/PathologyPicker';
import { SchemaForm, validateWith } from '../components/SchemaForm';
import { LineChart } from '../components/LineChart';
import type { Episode } from './Patient';

export function EpisodePage() {
  const { id } = useParams();
  const { byCode } = useReference();
  const ep = useLoad(() => api.get<Episode>(`/api/episodes/${id}`), [id]);
  const [tab, setTab] = useState<'surg' | 'dx' | 'proms'>('surg');
  const dxSchemas = useMemo(() => {
    if (!ep.data) return [];
    return [ep.data.primary_pathology, ...ep.data.secondary_pathologies]
      .map((c) => byCode.get(c)).filter((p) => p?.diagnosis_schema_id) as { code: string; name_pt: string; diagnosis_schema_id: string }[];
  }, [ep.data, byCode]);

  if (ep.error) return <div className="page"><ErrorBox error={ep.error} /></div>;
  if (!ep.data) return <Loading />;
  const e = ep.data;
  return (
    <div className="page">
      <div className="crumbs"><Link to="/pacientes">Pacientes</Link> › <Link to={`/pacientes/${e.patient_id}`}>Paciente</Link></div>
      <div className="page-head">
        <div>
          <h1>{byCode.get(e.primary_pathology)?.name_pt}</h1>
          <div className="muted small">{REGION_PT[e.region]} {SIDE_PT[e.side].toLowerCase()} · {e.affected_is_dominant ? 'lado dominante' : 'lado não dominante'}{e.onset_date ? ` · início ${fmtDate(e.onset_date)}` : ''}</div>
        </div>
        <label className="row small">Situação
          <select value={e.status} style={{ width: 'auto' }} onChange={async (x) => {
            try { const u = await api.patch<Episode>(`/api/episodes/${id}`, { status: x.target.value }); ep.setData({ ...e, ...u }); toast('Situação atualizada'); } catch (er) { toast(errorText(er)); }
          }}>
            {['open', 'surgical', 'conservative', 'closed'].map((s) => <option key={s} value={s}>{STATUS_PT[s]}</option>)}
          </select>
        </label>
      </div>
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="field-label">Patologias associadas</div>
        <PathologyMulti region={e.region} value={e.secondary_pathologies} exclude={[e.primary_pathology]} onChange={async (v) => {
          try { const u = await api.patch<Episode>(`/api/episodes/${id}`, { secondary_pathologies: v }); ep.setData({ ...e, ...u }); } catch (er) { toast(errorText(er)); }
        }} />
      </div>
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'surg'} onClick={() => setTab('surg')}>Cirurgias</button>
        {dxSchemas.length > 0 && <button role="tab" aria-selected={tab === 'dx'} onClick={() => setTab('dx')}>Diagnóstico</button>}
        <button role="tab" aria-selected={tab === 'proms'} onClick={() => setTab('proms')}>Escores e seguimento</button>
      </div>
      {tab === 'surg' && <Surgeries episode={e} />}
      {tab === 'dx' && <Diagnosis episode={e} schemas={dxSchemas} />}
      {tab === 'proms' && <Proms episode={e} />}
    </div>
  );
}

function Surgeries({ episode }: { episode: Episode }) {
  const nav = useNavigate();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>();
  async function create() {
    setBusy(true);
    try {
      const defaults = await api.get('/api/surgeries/defaults');
      const today = new Date();
      const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
      const s = await api.post<{ id: string }>(`/api/episodes/${episode.id}/surgeries`, {
        core: { ...defaults, surgery_date: iso, side: episode.side, preop_dx: [episode.primary_pathology, ...episode.secondary_pathologies] }
      });
      nav(`/cirurgias/${s.id}`);
    } catch (x) { setErr(x); setBusy(false); }
  }
  return (
    <div className="card">
      <div className="card-head"><h2 style={{ margin: 0 }}>Cirurgias</h2><button className="primary" onClick={create} disabled={busy}>+ Nova cirurgia</button></div>
      <p className="muted small" style={{ marginTop: 0 }}>A nova cirurgia já vem com anestesia, posicionamento, antibiótico e portais da sua última cirurgia — confira.</p>
      <ErrorBox error={err} />
      {!episode.surgeries?.length ? <div className="empty">Nenhuma cirurgia registrada.</div> : (
        <ul className="list">
          {episode.surgeries.map((s) => (
            <li key={s.id}><Link className="list-link" to={`/cirurgias/${s.id}`}><div style={{ flex: 1 }}>{fmtDate(s.surgery_date)}</div><span className={`badge ${s.status === 'signed' || s.status === 'amended' ? 'ok' : ''}`}>{STATUS_PT[s.status]}</span></Link></li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------- diagnóstico + painel de instabilidade ----------------
function Diagnosis({ episode, schemas }: { episode: Episode; schemas: { code: string; name_pt: string; diagnosis_schema_id: string }[] }) {
  const { schema: loadSchema } = useReference();
  const [code, setCode] = useState(schemas[0].code);
  const cur = schemas.find((s) => s.code === code)!;
  const [schema, setSchema] = useState<any>();
  const [data, setData] = useState<Record<string, any>>({});
  const [err, setErr] = useState<unknown>();
  const [busy, setBusy] = useState(false);
  const list = useLoad(() => api.get<any[]>(`/api/episodes/${episode.id}/assessments`), [episode.id]);
  useEffect(() => { void loadSchema(cur.diagnosis_schema_id).then(setSchema); }, [cur.diagnosis_schema_id, loadSchema]);
  const mine = (list.data ?? []).filter((a) => a.kind === 'diagnosis' && a.schema_id === cur.diagnosis_schema_id);
  useEffect(() => { if (mine[0]) setData(mine[0].data); }, [list.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const valid = schema ? validateWith(schema, data).length === 0 : false;

  async function save() {
    setBusy(true); setErr(undefined);
    try { await api.post(`/api/episodes/${episode.id}/assessments`, { kind: 'diagnosis', schema_id: cur.diagnosis_schema_id, pathology_code: cur.code, data }); await list.reload(); toast('Avaliação salva'); } catch (x) { setErr(x); } finally { setBusy(false); }
  }

  return (
    <div className="stack">
      {cur.code === 'SH_INST_ANT' && mine[0] && <InstabilityPanel data={mine[0].data} />}
      <div className="card">
        {schemas.length > 1 && <div className="segmented" style={{ marginBottom: 12 }}>{schemas.map((s) => <button key={s.code} aria-pressed={s.code === code} onClick={() => { setCode(s.code); setData({}); }}>{s.name_pt}</button>)}</div>}
        <div className="card-head"><h2 style={{ margin: 0 }}>{cur.name_pt} — avaliação</h2>{mine[0] && <span className="muted small">Última: {fmtDate(mine[0].performed_at)}</span>}</div>
        {!schema ? <Loading /> : <SchemaForm schema={schema} value={data} onChange={setData} side={episode.side} region={episode.region} />}
        <ErrorBox error={err} />
        <div className="row" style={{ marginTop: 12 }}><button className="primary" onClick={save} disabled={!valid || busy}>Salvar avaliação</button>{!valid && <span className="muted small">Complete os campos destacados.</span>}</div>
      </div>
    </div>
  );
}

function InstabilityPanel({ data }: { data: Record<string, any> }) {
  const [age, setAge] = useState('');
  const [result, setResult] = useState<any>();
  const [err, setErr] = useState<any>();
  useEffect(() => {
    const bone = data.ct_available ? { D_mm: data.D_mm, d_mm: data.d_mm, hsi_mm: data.hsi_mm } : {};
    const isis = {
      age_at_surgery: age === '' ? undefined : Number(age),
      sport_competitive: data.sport_competitive, sport_contact_or_forced_overhead: data.sport_contact_or_forced_overhead,
      hyperlaxity: data.hyperlaxity, hs_visible_ap_er: data.hs_visible_ap_er, glenoid_contour_loss_ap: data.glenoid_contour_loss_ap
    };
    api.post('/api/instability/metrics', { bone, isis }).then((r) => { setResult(r); setErr(undefined); }).catch((e) => { setErr(e); setResult(undefined); });
  }, [data, age]);
  const refs = useLoad(() => api.get<Record<string, string>>('/api/references'), []);
  const Ref = ({ ids }: { ids: number[] }) => <span className="ref" tabIndex={0} title={ids.map((i) => `[${i}] ${refs.data?.[i] ?? ''}`).join('\n\n')}>[{ids.join(', ')}]</span>;
  const n = (v: number | null, u = '') => (v === null ? '—' : `${String(v).replace('.', ',')}${u}`);
  const MISSING_PT: Record<string, string> = { D_mm: 'Diâmetro glenoidal (TC)', d_mm: 'Defeito glenoidal (TC)', hsi_mm: 'HSI (TC)', 'isis.age_at_surgery': 'Idade na cirurgia', 'isis.sport_competitive': 'Esporte competitivo', 'isis.sport_contact_or_forced_overhead': 'Esporte de contato/arremesso', 'isis.hyperlaxity': 'Hiperfrouxidão', 'isis.hs_visible_ap_er': 'Hill-Sachs no AP em RE', 'isis.glenoid_contour_loss_ap': 'Perda do contorno glenoidal no AP' };
  return (
    <div className="card">
      <h2>Fatores documentados</h2>
      <p className="muted small" style={{ marginTop: 0 }}>Cálculos a partir dos dados registrados. Não constituem indicação de conduta.</p>
      <label className="field" style={{ maxWidth: 220, marginBottom: 12 }}><div className="field-label">Idade na cirurgia (para ISIS)</div><input type="number" min={10} max={100} value={age} onChange={(e) => setAge(e.target.value)} /></label>
      {err && <div className="alert error">{err.message}{err.details?.field ? ` (campo ${err.details.field})` : ''}</div>}
      {result && (
        <div className="grid grid-3">
          <div>
            <h3>Métricas ósseas</h3>
            {!data.ct_available ? <div className="alert warn small">Perda óssea não quantificada por TC.</div> : (
              <>
                <div className="metric"><span>Perda glenoidal <Ref ids={result.refs.gbl_pct} /></span><strong>{n(result.gbl_pct, '%')}</strong></div>
                <div className="metric"><span>Glenoid track <Ref ids={result.refs.gt_mm} /></span><strong>{n(result.gt_mm, ' mm')}</strong></div>
                <div className="metric"><span>HSI</span><strong>{n(result.hsi_mm, ' mm')}</strong></div>
                <div className="metric"><span>Situação <Ref ids={result.refs.track} /></span><strong>{result.track ? (result.track === 'on_track' ? 'On-track' : 'Off-track') : '—'}</strong></div>
                {result.margin_mm !== null && <div className="metric"><span>Margem (GT − HSI)</span><strong>{n(result.margin_mm, ' mm')}</strong></div>}
              </>
            )}
            {result.flags.map((f: any) => <div key={f.id} className="alert info small" style={{ marginTop: 8 }}>{f.text_pt} <Ref ids={f.refs} /></div>)}
          </div>
          <div>
            <h3>Fatores do paciente</h3>
            <div className="metric"><span>ISIS <Ref ids={result.refs.isis} /></span><strong>{result.isis === null ? '—' : `${result.isis}/10`}</strong></div>
            {result.isis_components && Object.entries(result.isis_components).map(([k, v]) => <div className="metric small" key={k}><span>{({ age_le_20: 'Idade ≤ 20', sport_competitive: 'Esporte competitivo', sport_contact_or_forced_overhead: 'Contato/arremesso', hyperlaxity: 'Hiperfrouxidão', hs_visible_ap_er: 'Hill-Sachs no AP', glenoid_contour_loss_ap: 'Perda do contorno glenoidal' } as any)[k]}</span><span>{String(v)}</span></div>)}
          </div>
          <div>
            <h3>Dados faltantes</h3>
            {result.missing.filter((m: string) => data.ct_available || !['D_mm', 'd_mm', 'hsi_mm'].includes(m)).length === 0 ? <div className="muted small">Nenhum.</div> : (
              <ul className="small" style={{ paddingLeft: 18, margin: 0 }}>{result.missing.filter((m: string) => data.ct_available || !['D_mm', 'd_mm', 'hsi_mm'].includes(m)).map((m: string) => <li key={m}>{MISSING_PT[m] ?? m}</li>)}</ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------- escores ----------------
interface PromList { responses: any[]; series: { instrument: string; version: string; max: number; points: any[] }[] }

function Proms({ episode }: { episode: Episode }) {
  const proms = useLoad(() => api.get<PromList>(`/api/episodes/${episode.id}/proms`), [episode.id]);
  const invites = useLoad(() => api.get<any[]>(`/api/episodes/${episode.id}/prom-invites`), [episode.id]);
  const instruments = useLoad(() => api.get<any[]>('/api/instruments'), []);
  const [form, setForm] = useState<string | null>(null);
  const [invite, setInvite] = useState(false);
  const available = (instruments.data ?? []).filter((i) => i.region.includes(episode.region) && ['CONSTANT', 'ROWE', 'SANE', 'MEPS', 'ASES'].includes(i.code));
  return (
    <div className="stack">
      <div className="card">
        <div className="card-head"><h2 style={{ margin: 0 }}>Registrar escore</h2></div>
        <div className="row">
          {available.map((i) => i.license_status === 'free'
            ? <button key={i.code} onClick={() => setForm(i.code)}>{i.name_pt}</button>
            : <button key={i.code} disabled title="Bloqueado até confirmação da licença">{i.name_pt} · licença pendente</button>)}
          <span className="spacer" />
          <button className="primary" onClick={() => setInvite(true)}>Enviar SANE ao paciente</button>
        </div>
      </div>
      <div className="card">
        <h2>Evolução</h2>
        <ErrorBox error={proms.error} />
        {!proms.data ? <Loading /> : proms.data.series.length === 0 ? <div className="empty">Nenhum escore registrado.</div> : (
          <div className="grid grid-2">{proms.data.series.map((s) => <LineChart key={`${s.instrument}${s.version}${s.max}`} title={`${s.instrument}${s.max === 75 && s.instrument === 'CONSTANT' ? ' sem força' : ''}`} max={s.max} points={s.points} />)}</div>
        )}
        {proms.data && proms.data.responses.length > 0 && (
          <div className="table-wrap" style={{ marginTop: 12 }}>
            <table className="table"><thead><tr><th>Data</th><th>Instrumento</th><th>Momento</th><th>Escore</th><th>Respondente</th></tr></thead>
              <tbody>{[...proms.data.responses].reverse().map((r) => (
                <tr key={r.id}><td>{fmtDate(r.completed_at)}</td><td>{r.instrument}</td><td>{TIMEPOINT_PT[r.timepoint]}</td><td>{String(r.score).replace('.', ',')}/{r.score_max}{r.flags?.includes('constant_no_strength') && <span className="badge warn" style={{ marginLeft: 6 }}>sem força</span>}</td><td>{r.respondent === 'patient' ? 'Paciente' : 'Médico'}</td></tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </div>
      <div className="card">
        <h2>Links enviados</h2>
        {!invites.data ? <Loading /> : invites.data.length === 0 ? <div className="empty">Nenhum link enviado.</div> : (
          <ul className="list">{invites.data.map((i) => (
            <li key={i.id} className="row" style={{ padding: '8px 0' }}>
              <span>{i.instrument} · {TIMEPOINT_PT[i.timepoint]}</span><span className="muted small">criado {fmtDate(i.created_at)} · expira {fmtDate(i.expires_at)}</span><span className="spacer" />
              <span className={`badge ${i.status === 'used' ? 'ok' : i.status === 'expired' ? 'danger' : 'primary'}`}>{i.status === 'used' ? 'respondido' : i.status === 'expired' ? 'expirado' : 'aguardando'}</span>
              {i.status === 'open' && <button className="small ghost" onClick={async () => { await api.del(`/api/prom-invites/${i.id}`); await invites.reload(); }}>Revogar</button>}
            </li>
          ))}</ul>
        )}
      </div>
      {form && <ClinicianForm code={form} episodeId={episode.id} onClose={() => setForm(null)} onSaved={() => { setForm(null); void proms.reload(); }} />}
      {invite && <InviteModal episodeId={episode.id} onClose={() => { setInvite(false); void invites.reload(); }} />}
    </div>
  );
}

function ClinicianForm({ code, episodeId, onClose, onSaved }: { code: string; episodeId: string; onClose(): void; onSaved(): void }) {
  const items: Item[] = CLINICIAN_FORMS[code] ?? [];
  const [a, setA] = useState<Record<string, any>>(code === 'CONSTANT' ? { er_achieved: [] } : {});
  const [tp, setTp] = useState('preop');
  const [err, setErr] = useState<unknown>();
  const [busy, setBusy] = useState(false);
  const complete = items.every((i) => i.optional || (i.kind === 'multi' ? Array.isArray(a[i.key]) : a[i.key] !== undefined && a[i.key] !== ''));
  async function save() {
    setBusy(true); setErr(undefined);
    try { await api.post(`/api/episodes/${episodeId}/proms`, { instrument: code, timepoint: tp, answers: a }); toast('Escore registrado'); onSaved(); } catch (x) { setErr(x); setBusy(false); }
  }
  return (
    <Modal title={`Registrar ${code}`} onClose={onClose} footer={<><button onClick={onClose}>Cancelar</button><button className="primary" disabled={!complete || busy} onClick={save}>Salvar</button></>}>
      <div className="stack">
        <label className="field"><div className="field-label">Momento</div>
          <select value={tp} onChange={(e) => setTp(e.target.value)}>{Object.entries(TIMEPOINT_PT).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        </label>
        {items.map((i) => (
          <div className="field" key={i.key}>
            <div className="field-label">{i.label}{!i.optional && <span className="req">*</span>}</div>
            {i.kind === 'enum' && <div className="chips">{i.options!.map(([k, l]) => <button type="button" key={k} className="chip" aria-pressed={a[i.key] === k} onClick={() => setA({ ...a, [i.key]: k })}>{l}</button>)}</div>}
            {i.kind === 'multi' && <div className="chips">{i.options!.map(([k, l]) => { const cur: string[] = a[i.key] ?? []; return <button type="button" key={k} className="chip" aria-pressed={cur.includes(k)} onClick={() => setA({ ...a, [i.key]: cur.includes(k) ? cur.filter((x) => x !== k) : [...cur, k] })}>{l}</button>; })}</div>}
            {(i.kind === 'int' || i.kind === 'num') && (
              <div className="input-unit" style={{ maxWidth: 200 }}>
                <input type="number" min={i.min} max={i.max} step={i.kind === 'int' ? 1 : 'any'} value={a[i.key] ?? ''} onChange={(e) => { const v = e.target.value; const n = { ...a }; if (v === '') delete n[i.key]; else n[i.key] = Number(v); setA(n); }} />
                {i.unit && <span>{i.unit}</span>}
              </div>
            )}
            {i.note && <div className="field-note">{i.note}</div>}
          </div>
        ))}
        <ErrorBox error={err} />
      </div>
    </Modal>
  );
}

function InviteModal({ episodeId, onClose }: { episodeId: string; onClose(): void }) {
  const [tp, setTp] = useState('preop');
  const [days, setDays] = useState(14);
  const [url, setUrl] = useState<string>();
  const [err, setErr] = useState<unknown>();
  async function create() {
    try { setUrl((await api.post(`/api/episodes/${episodeId}/prom-invites`, { instrument: 'SANE', timepoint: tp, expires_in_days: days })).url); } catch (x) { setErr(x); }
  }
  return (
    <Modal title="Enviar SANE ao paciente" onClose={onClose}>
      {!url ? (
        <div className="stack">
          <p className="muted small" style={{ margin: 0 }}>Gera um link de uso único. O paciente responde sem login e não vê dados clínicos.</p>
          <div className="form-grid">
            <label className="field"><div className="field-label">Momento</div><select value={tp} onChange={(e) => setTp(e.target.value)}>{Object.entries(TIMEPOINT_PT).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
            <label className="field"><div className="field-label">Validade (dias)</div><input type="number" min={1} max={60} value={days} onChange={(e) => setDays(Number(e.target.value))} /></label>
          </div>
          <ErrorBox error={err} />
          <div className="row" style={{ justifyContent: 'flex-end' }}><button onClick={onClose}>Cancelar</button><button className="primary" onClick={create}>Gerar link</button></div>
        </div>
      ) : (
        <div className="stack">
          <div className="alert ok">Link gerado. Ele só aparece agora — copie e envie ao paciente.</div>
          <input readOnly value={url} onFocus={(e) => e.target.select()} aria-label="Link" />
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <a className="btn" href={`https://wa.me/?text=${encodeURIComponent('Por favor, responda este questionário rápido sobre sua articulação: ' + url)}`} target="_blank" rel="noreferrer">WhatsApp</a>
            <button onClick={() => { void navigator.clipboard?.writeText(url).then(() => toast('Link copiado')); }}>Copiar</button>
            <button className="primary" onClick={onClose}>Concluir</button>
          </div>
        </div>
      )}
    </Modal>
  );
}

