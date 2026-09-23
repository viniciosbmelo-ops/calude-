/** Página PÚBLICA do paciente (link de uso único). Não exibe dados clínicos nem o escore. */
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';

interface Info { instrument: string; name_pt: string; timepoint: string; expires_at: string; status: 'open' | 'used' | 'expired' }

export function PatientProm() {
  const { token } = useParams();
  const [info, setInfo] = useState<Info | null>();
  const [value, setValue] = useState<number | null>(null);
  const [state, setState] = useState<'idle' | 'sending' | 'done' | 'error'>('idle');
  const [msg, setMsg] = useState('');
  useEffect(() => {
    fetch(`/api/public/prom/${token}`, { headers: { Accept: 'application/json' } })
      .then(async (r) => (r.ok ? setInfo(await r.json()) : setInfo(null)))
      .catch(() => setInfo(null));
  }, [token]);

  async function send() {
    setState('sending');
    const r = await fetch(`/api/public/prom/${token}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ answers: { value } }) }).catch(() => null);
    if (r?.ok) setState('done');
    else { setState('error'); setMsg(r ? ((await r.json().catch(() => ({}))).message ?? 'Não foi possível enviar.') : 'Sem conexão. Tente de novo.'); }
  }

  return (
    <div className="public">
      <div className="brand" style={{ marginBottom: 16 }}><span className="brand-mark">DS</span><span>DocSholder</span></div>
      <div className="card stack">
        {info === undefined ? <div className="spinner" /> : info === null ? (
          <><h1>Link inválido</h1><p className="muted">Confira o endereço recebido ou peça um novo link à equipe.</p></>
        ) : info.status !== 'open' || state === 'done' ? (
          <><h1>{state === 'done' || info.status === 'used' ? 'Obrigado!' : 'Link expirado'}</h1><p className="muted">{state === 'done' || info.status === 'used' ? 'Sua resposta foi registrada. Pode fechar esta página.' : 'Peça um novo link à equipe.'}</p></>
        ) : info.instrument !== 'SANE' ? (
          <><h1>Questionário indisponível</h1><p className="muted">Este questionário ainda não pode ser respondido por aqui.</p></>
        ) : (
          <>
            <h1>Avaliação da sua articulação</h1>
            <p style={{ margin: 0 }}>Numa escala de <strong>0 a 100</strong>, em que <strong>100 é o normal</strong> para você antes do problema, como você avalia hoje o seu ombro ou cotovelo em tratamento?</p>
            <div className="big-number" aria-live="polite">{value ?? '—'}</div>
            <input type="range" min={0} max={100} step={1} value={value ?? 50} onChange={(e) => setValue(Number(e.target.value))} aria-label="Nota de 0 a 100" />
            <div className="row small muted"><span>0 — pior possível</span><span className="spacer" /><span>100 — normal</span></div>
            <input type="number" min={0} max={100} placeholder="ou digite a nota" value={value ?? ''} onChange={(e) => { const n = e.target.value === '' ? null : Math.max(0, Math.min(100, Math.round(Number(e.target.value)))); setValue(n); }} aria-label="Nota digitada" />
            {state === 'error' && <div className="alert error">{msg}</div>}
            <button className="primary" disabled={value === null || state === 'sending'} onClick={send}>{state === 'sending' ? 'Enviando…' : 'Enviar resposta'}</button>
            <p className="muted small" style={{ margin: 0 }}>Link pessoal e de uso único. Válido até {new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short' }).format(new Date(info.expires_at))}.</p>
          </>
        )}
      </div>
    </div>
  );
}
