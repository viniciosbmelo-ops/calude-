import { useEffect, useState } from 'react';
import { api, errorText } from '../../lib/api';
import { useReference } from '../../lib/ref';
import { ErrorBox, Modal, fmtDate, toast } from '../../components/ui';
import { Scanner } from '../../components/Scanner';
import type { RegisterFlush, SurgeryFull } from '../Surgery';

const CATEGORIES: [string, string][] = [['anchor', 'Âncora'], ['screw', 'Parafuso'], ['plate', 'Placa'], ['button', 'Botão'], ['prosthesis_component', 'Componente protético'], ['graft', 'Enxerto'], ['suture_tape', 'Fio/fita'], ['other', 'Outro']];
const catPt = Object.fromEntries(CATEGORIES);

export function ImplantsStep({ surgery, locked, onNext, registerFlush }: { surgery: SurgeryFull; locked: boolean; onNext(): void; registerFlush: RegisterFlush }) {
  const [items, setItems] = useState<any[]>(surgery.implants);
  const [adding, setAdding] = useState(false);
  const { byCode } = useReference();
  useEffect(() => registerFlush(async () => undefined), [registerFlush]);
  async function remove(id: string) {
    if (!confirm('Remover este implante?')) return;
    try { await api.del(`/api/surgeries/${surgery.id}/implants/${id}`); setItems(items.filter((i) => i.id !== id)); } catch (e) { toast(errorText(e)); }
  }
  return (
    <div className="card">
      <div className="card-head"><h2 style={{ margin: 0 }}>Implantes</h2>{!locked && <button className="primary" onClick={() => setAdding(true)}>+ Implante</button>}</div>
      {items.length === 0 ? <div className="empty">Nenhum implante registrado.</div> : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Implante</th><th>Qtd</th><th>Lote / série</th><th>Validade</th><th>Local</th><th /></tr></thead>
            <tbody>{items.map((i) => (
              <tr key={i.id}>
                <td><div style={{ fontWeight: 600 }}>{i.manufacturer} {i.model}{i.size ? ` (${i.size})` : ''}</div><div className="muted small">{catPt[i.category] ?? i.category}{i.procedure_id ? ` · ${byCode.get(surgery.procedures.find((p) => p.id === i.procedure_id)?.pathology_code ?? '')?.name_pt ?? ''}` : ''}</div></td>
                <td>{i.quantity}</td>
                <td>{i.lot ?? <span className={`badge ${i.category === 'prosthesis_component' ? 'danger' : 'warn'}`}>sem lote</span>}{i.serial ? <div className="muted small">SN {i.serial}</div> : null}</td>
                <td>{i.expiry ? fmtDate(i.expiry) : '—'}</td>
                <td>{i.location ?? '—'}</td>
                <td>{!locked && <button className="small ghost" onClick={() => remove(i.id)} aria-label="Remover">✕</button>}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      <div className="row" style={{ marginTop: 16, justifyContent: 'flex-end' }}><button className="primary" onClick={onNext}>Próximo: relatório →</button></div>
      {adding && <AddImplant surgery={surgery} onClose={() => setAdding(false)} onAdded={async () => { setAdding(false); setItems((await api.get<SurgeryFull>(`/api/surgeries/${surgery.id}`)).implants); }} />}
    </div>
  );
}

function AddImplant({ surgery, onClose, onAdded }: { surgery: SurgeryFull; onClose(): void; onAdded(): void }) {
  const { byCode } = useReference();
  const [scanning, setScanning] = useState(false);
  const [raw, setRaw] = useState('');
  const [parsed, setParsed] = useState<any>();
  const [catalog, setCatalog] = useState<any[]>([]);
  const [implantId, setImplantId] = useState<string>('');
  const [n, setN] = useState({ category: 'anchor', manufacturer: '', model: '', ref_code: '' });
  const [f, setF] = useState({ lot: '', serial: '', expiry: '', size: '', quantity: 1, location: '', procedure_id: '' });
  const [err, setErr] = useState<unknown>();
  const [busy, setBusy] = useState(false);

  async function read(code: string) {
    setRaw(code); setScanning(false); setErr(undefined);
    try {
      const p = await api.post('/api/gs1/parse', { raw: code });
      setParsed(p);
      setF((x) => ({ ...x, lot: p.lot ?? x.lot, serial: p.serial ?? x.serial, expiry: p.expiry ?? x.expiry }));
      if (p.gtin) {
        const c = await api.get<any[]>(`/api/implant-catalog?gtin=${p.gtin}`);
        setCatalog(c);
        setImplantId(c[0]?.id ?? '');
      }
    } catch (e) { setErr(e); setParsed(undefined); }
  }

  const needNew = !implantId;
  const ok = needNew ? n.manufacturer.trim() && n.model.trim() : true;
  async function submit() {
    setBusy(true); setErr(undefined);
    try {
      await api.post(`/api/surgeries/${surgery.id}/implants`, {
        ...(implantId ? { implant_id: implantId } : { new_catalog_item: { ...n, ref_code: n.ref_code || undefined, gtin: parsed?.gtin } }),
        raw_barcode: raw || undefined,
        lot: f.lot || undefined, serial: f.serial || undefined, expiry: f.expiry || undefined, size: f.size || undefined,
        quantity: f.quantity, location: f.location || undefined, procedure_id: f.procedure_id || undefined
      });
      toast('Implante registrado');
      onAdded();
    } catch (e) { setErr(e); setBusy(false); }
  }

  return (
    <Modal title="Adicionar implante" onClose={onClose} footer={<><button onClick={onClose}>Cancelar</button><button className="primary" disabled={!ok || busy} onClick={submit}>Registrar</button></>}>
      <div className="stack">
        {scanning ? <Scanner onResult={read} onClose={() => setScanning(false)} /> : (
          <div className="row">
            <button onClick={() => setScanning(true)}>📷 Ler código (DataMatrix)</button>
            <span className="muted small">ou digite/cole:</span>
            <input style={{ flex: 1, minWidth: 180 }} placeholder="(01)…(17)…(10)…" value={raw} onChange={(e) => setRaw(e.target.value)} onBlur={() => raw && read(raw)} aria-label="Código GS1" />
          </div>
        )}
        {parsed && <div className="alert ok small">Lido: GTIN {parsed.gtin ?? '—'} · lote {parsed.lot ?? '—'} · validade {parsed.expiry ? fmtDate(parsed.expiry) : '—'}{parsed.serial ? ` · série ${parsed.serial}` : ''}</div>}
        {catalog.length > 0 && (
          <label className="field"><div className="field-label">Item do catálogo</div>
            <select value={implantId} onChange={(e) => setImplantId(e.target.value)}>
              {catalog.map((c) => <option key={c.id} value={c.id}>{c.manufacturer} {c.model}{c.private ? ' (meu catálogo)' : ''}</option>)}
              <option value="">Outro — cadastrar novo</option>
            </select>
          </label>
        )}
        {needNew && (
          <div className="section" style={{ padding: 12 }}>
            <div className="field-label">Novo item no seu catálogo</div>
            <div className="form-grid">
              <label className="field"><div className="field-label">Categoria</div><select value={n.category} onChange={(e) => setN({ ...n, category: e.target.value })}>{CATEGORIES.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
              <label className="field"><div className="field-label">Fabricante <span className="req">*</span></div><input value={n.manufacturer} onChange={(e) => setN({ ...n, manufacturer: e.target.value })} /></label>
              <label className="field"><div className="field-label">Modelo <span className="req">*</span></div><input value={n.model} onChange={(e) => setN({ ...n, model: e.target.value })} /></label>
              <label className="field"><div className="field-label">Referência</div><input value={n.ref_code} onChange={(e) => setN({ ...n, ref_code: e.target.value })} /></label>
            </div>
          </div>
        )}
        <div className="form-grid">
          <label className="field"><div className="field-label">Lote</div><input value={f.lot} onChange={(e) => setF({ ...f, lot: e.target.value })} /></label>
          <label className="field"><div className="field-label">Série</div><input value={f.serial} onChange={(e) => setF({ ...f, serial: e.target.value })} /></label>
          <label className="field"><div className="field-label">Validade</div><input type="date" value={f.expiry} onChange={(e) => setF({ ...f, expiry: e.target.value })} /></label>
          <label className="field"><div className="field-label">Tamanho</div><input maxLength={40} value={f.size} onChange={(e) => setF({ ...f, size: e.target.value })} placeholder="ex.: 4,75 mm" /></label>
          <label className="field"><div className="field-label">Quantidade</div><input type="number" min={1} max={50} value={f.quantity} onChange={(e) => setF({ ...f, quantity: Math.max(1, Number(e.target.value) || 1) })} /></label>
          <label className="field"><div className="field-label">Localização</div><input maxLength={120} value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} placeholder="ex.: fileira medial" /></label>
          <label className="field"><div className="field-label">Procedimento</div>
            <select value={f.procedure_id} onChange={(e) => setF({ ...f, procedure_id: e.target.value })}>
              <option value="">—</option>
              {surgery.procedures.map((p) => <option key={p.id} value={p.id}>{p.sequence}. {byCode.get(p.pathology_code)?.name_pt}</option>)}
            </select>
          </label>
        </div>
        {!f.lot && <div className="alert warn small">Sem lote: {n.category === 'prosthesis_component' && needNew ? 'componente protético sem lote BLOQUEIA a assinatura.' : 'gera aviso na assinatura.'}</div>}
        <ErrorBox error={err} />
      </div>
    </Modal>
  );
}
