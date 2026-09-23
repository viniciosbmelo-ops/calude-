import { FormEvent, useState } from 'react';
import { useAuth } from '../lib/auth';
import { ErrorBox, toast } from '../components/ui';

export function Profile() {
  const { me, mode, supabase, refreshMe, logout } = useAuth();
  const [name, setName] = useState(me?.full_name ?? '');
  const [crm, setCrm] = useState(me?.crm ?? '');
  const [err, setErr] = useState<unknown>();
  async function save(e: FormEvent) {
    e.preventDefault();
    try {
      if (!supabase) return;
      const { error } = await supabase.auth.updateUser({ data: { full_name: name.trim(), crm: crm.trim() } });
      if (error) throw new Error(error.message);
      await supabase.auth.refreshSession();
      await refreshMe();
      toast('Perfil atualizado');
    } catch (x) { setErr(x); }
  }
  return (
    <div className="page">
      <h1>Perfil</h1>
      <form className="card stack" style={{ maxWidth: 520 }} onSubmit={save}>
        <div className="muted small">{me?.email}</div>
        <p className="small" style={{ margin: 0 }}>Nome e CRM saem no cabeçalho dos relatórios que você gerar.</p>
        <label className="field"><div className="field-label">Nome completo</div><input value={name} disabled={mode !== 'supabase'} minLength={3} onChange={(e) => setName(e.target.value)} /></label>
        <label className="field"><div className="field-label">CRM</div><input value={crm} disabled={mode !== 'supabase'} onChange={(e) => setCrm(e.target.value)} /></label>
        {mode === 'dev' && <div className="alert warn small">No login de desenvolvimento, nome e CRM vêm da tela de entrada.</div>}
        <ErrorBox error={err} />
        <div className="row">{mode === 'supabase' && <button className="primary">Salvar</button>}<span className="spacer" /><button type="button" onClick={() => void logout()}>Sair</button></div>
      </form>
    </div>
  );
}
