import { FormEvent, useState } from 'react';
import { api } from '../lib/api';
import { ErrorBox, Loading, Modal, toast, useLoad } from '../components/ui';

interface Protocol { id: string; code: string; title: string; body: string; active: boolean }

export function Protocols() {
  const list = useLoad(() => api.get<Protocol[]>('/api/protocols'), []);
  const [edit, setEdit] = useState<Partial<Protocol> | null>(null);
  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Protocolos pós-operatórios</h1><div className="muted small">Seus textos de conduta pós-operatória, inseridos no relatório. O conteúdo é seu: o sistema não fornece protocolo clínico.</div></div>
        <button className="primary" onClick={() => setEdit({ code: '', title: '', body: '', active: true })}>+ Novo protocolo</button>
      </div>
      <div className="card">
        <ErrorBox error={list.error} />
        {!list.data ? <Loading /> : list.data.length === 0 ? (
          <div className="empty">Nenhum protocolo. Use o código padrão da patologia (ex.: PROT_RCR_STANDARD, PROT_BANKART) para que ele venha pré-selecionado no relatório.</div>
        ) : (
          <ul className="list">{list.data.map((p) => (
            <li key={p.id}><button className="ghost list-link" style={{ width: '100%', border: 0 }} onClick={() => setEdit(p)}>
              <div style={{ flex: 1, textAlign: 'left' }}><div style={{ fontWeight: 600 }}>{p.title}</div><div className="muted small mono">{p.code}</div></div>
              {!p.active && <span className="badge">inativo</span>}
            </button></li>
          ))}</ul>
        )}
      </div>
      {edit && <Editor p={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); void list.reload(); }} />}
    </div>
  );
}

const CODES = ['PROT_RCR_STANDARD', 'PROT_RCR_MASSIVE', 'PROT_BANKART', 'PROT_BICEPS_TENODESIS', 'PROT_SLAP_REPAIR', 'PROT_AC_RECON', 'PROT_DCE', 'PROT_RSA', 'PROT_DISTAL_BICEPS'];

function Editor({ p, onClose, onSaved }: { p: Partial<Protocol>; onClose(): void; onSaved(): void }) {
  const [f, setF] = useState({ code: p.code ?? '', title: p.title ?? '', body: p.body ?? '', active: p.active ?? true });
  const [err, setErr] = useState<unknown>();
  async function submit(e: FormEvent) {
    e.preventDefault();
    try { p.id ? await api.patch(`/api/protocols/${p.id}`, f) : await api.post('/api/protocols', f); toast('Protocolo salvo'); onSaved(); } catch (x) { setErr(x); }
  }
  async function remove() {
    if (!p.id || !confirm('Excluir este protocolo? Relatórios já gerados não mudam.')) return;
    try { await api.del(`/api/protocols/${p.id}`); onSaved(); } catch (x) { setErr(x); }
  }
  return (
    <Modal title={p.id ? 'Editar protocolo' : 'Novo protocolo'} onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <label className="field"><div className="field-label">Código <span className="req">*</span></div>
          <input list="prot-codes" required pattern="[A-Z0-9_]{2,40}" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} />
          <datalist id="prot-codes">{CODES.map((c) => <option key={c} value={c} />)}</datalist>
          <div className="field-note">Letras maiúsculas, números e _. Códigos sugeridos são os padrões do catálogo.</div>
        </label>
        <label className="field"><div className="field-label">Título <span className="req">*</span></div><input required minLength={2} maxLength={120} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></label>
        <label className="field"><div className="field-label">Texto <span className="req">*</span></div><textarea required maxLength={20000} rows={10} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} /></label>
        <label className="row"><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> Ativo</label>
        <ErrorBox error={err} />
        <div className="row">{p.id && <button type="button" className="danger" onClick={remove}>Excluir</button>}<span className="spacer" /><button type="button" onClick={onClose}>Cancelar</button><button className="primary">Salvar</button></div>
      </form>
    </Modal>
  );
}
