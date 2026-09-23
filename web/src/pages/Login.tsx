import { FormEvent, useState } from 'react';
import { useAuth } from '../lib/auth';
import { ErrorBox } from '../components/ui';

export function Login() {
  const { mode, loginDev, loginSupabase } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [crm, setCrm] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>();

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(undefined);
    try { mode === 'dev' ? await loginDev(email, name, crm) : await loginSupabase(email, password); } catch (x) { setErr(x); } finally { setBusy(false); }
  }

  return (
    <div className="login">
      <form className="card stack" onSubmit={submit}>
        <div className="brand"><span className="brand-mark">DS</span><span>DocSholder</span></div>
        <p className="muted small" style={{ margin: 0 }}>Registro clínico de ombro e cotovelo</p>
        {mode === 'none' && <div className="alert error">Servidor sem método de login configurado.</div>}
        {mode === 'dev' && <div className="alert warn small">Login de desenvolvimento — sem senha. Não use com dados reais.</div>}
        <label className="field"><div className="field-label">E-mail</div><input type="email" required autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
        {mode === 'supabase' && <label className="field"><div className="field-label">Senha</div><input type="password" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>}
        {mode === 'dev' && (
          <>
            <label className="field"><div className="field-label">Nome completo (sai no relatório)</div><input required minLength={3} value={name} onChange={(e) => setName(e.target.value)} /></label>
            <label className="field"><div className="field-label">CRM</div><input value={crm} onChange={(e) => setCrm(e.target.value)} placeholder="00000-UF" /></label>
          </>
        )}
        <ErrorBox error={err} />
        <button className="primary" disabled={busy || mode === 'none'}>{busy ? 'Entrando…' : 'Entrar'}</button>
      </form>
    </div>
  );
}
