import { useEffect, useState } from 'react';
import { api, errorText } from '../../lib/api';
import { Pathology, useReference } from '../../lib/ref';
import { ErrorBox, Loading, Modal, SaveIndicator, toast, useAutosave } from '../../components/ui';
import { SchemaForm, validateWith } from '../../components/SchemaForm';
import type { Episode } from '../Patient';
import type { RegisterFlush, SurgeryFull } from '../Surgery';

type Proc = SurgeryFull['procedures'][number];

export function ProceduresStep({ surgery, episode, locked, onNext, registerFlush }: { surgery: SurgeryFull; episode: Episode; locked: boolean; onNext(): void; registerFlush: RegisterFlush }) {
  const { byCode } = useReference();
  const [procs, setProcs] = useState<Proc[]>(surgery.procedures);
  const [adding, setAdding] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [err, setErr] = useState<unknown>();

  // Patologias do episódio (e subtipos) que têm formulário intraoperatório
  const allowed: Pathology[] = (() => {
    const base = [episode.primary_pathology, ...episode.secondary_pathologies];
    const out = new Map<string, Pathology>();
    for (const c of base) {
      const p = byCode.get(c);
      if (!p) continue;
      if (p.intraop_schema_id) out.set(p.code, p);
      for (const ch of p.children ?? []) if (ch.intraop_schema_id) out.set(ch.code, ch);
    }
    return [...out.values()];
  })();

  async function reorder(ids: string[]) {
    const prev = procs;
    setProcs(ids.map((id, i) => ({ ...procs.find((p) => p.id === id)!, sequence: i + 1 })));
    try { await api.put(`/api/surgeries/${surgery.id}/procedures-order`, { ids }); } catch (e) { setProcs(prev); toast(errorText(e)); }
  }
  const move = (id: string, delta: number) => {
    const ids = procs.map((p) => p.id);
    const i = ids.indexOf(id);
    const j = i + delta;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    void reorder(ids);
  };

  async function add(code: string) {
    setErr(undefined);
    try {
      const p = await api.post<Proc>(`/api/surgeries/${surgery.id}/procedures`, { pathology_code: code, data: {} });
      setProcs([...procs, p]);
      setAdding(false);
    } catch (e) { setErr(e); }
  }
  async function remove(id: string) {
    if (!confirm('Remover este procedimento?')) return;
    try {
      await api.del(`/api/surgeries/${surgery.id}/procedures/${id}`);
      setProcs(procs.filter((p) => p.id !== id).map((p, i) => ({ ...p, sequence: i + 1 })));
    } catch (e) { toast(errorText(e)); }
  }

  return (
    <div className="stack">
      <div className="card">
        <div className="card-head">
          <h2 style={{ margin: 0 }}>Procedimentos</h2>
          {!locked && <button className="primary" onClick={() => setAdding(true)} disabled={allowed.length === 0}>+ Procedimento</button>}
        </div>
        {allowed.length === 0 && <div className="alert warn">Nenhuma patologia deste episódio tem formulário intraoperatório nesta versão.</div>}
        {procs.length === 0 ? <div className="empty">Nenhum procedimento. Registre um por patologia tratada — vários na mesma cirurgia.</div> : procs.length > 1 && !locked && <p className="muted small" style={{ margin: 0 }}>Arraste pelo ⠿ (ou use ↑↓) para definir a ordem no relatório.</p>}
        <ErrorBox error={err} />
      </div>
      {procs.map((p, i) => (
        <div key={p.id}
          className={`proc${dragId === p.id ? ' dragging' : ''}${overId === p.id && dragId !== p.id ? ' drop-target' : ''}`}
          onDragOver={(e) => { if (dragId) { e.preventDefault(); setOverId(p.id); } }}
          onDragLeave={() => setOverId(null)}
          onDrop={(e) => {
            e.preventDefault();
            if (!dragId || dragId === p.id) return;
            const ids = procs.map((x) => x.id).filter((x) => x !== dragId);
            ids.splice(ids.indexOf(p.id), 0, dragId);
            setDragId(null); setOverId(null);
            void reorder(ids);
          }}>
          <ProcedureCard proc={p} index={i} total={procs.length} surgery={surgery} locked={locked} registerFlush={registerFlush}
            name={byCode.get(p.pathology_code)?.name_pt ?? p.pathology_code}
            onDragStart={() => setDragId(p.id)} onDragEnd={() => { setDragId(null); setOverId(null); }}
            onMove={(d) => move(p.id, d)} onRemove={() => remove(p.id)} />
        </div>
      ))}
      <div className="row" style={{ justifyContent: 'flex-end' }}><button className="primary" onClick={onNext}>Próximo: implantes →</button></div>
      {adding && (
        <Modal title="Adicionar procedimento" onClose={() => setAdding(false)}>
          <p className="muted small" style={{ marginTop: 0 }}>Patologias do episódio. Para outra patologia, adicione-a antes como associada no episódio.</p>
          <div className="stack">
            {allowed.map((p) => <button key={p.code} style={{ width: '100%', justifyContent: 'flex-start' }} onClick={() => add(p.code)}>{p.parent_code ? '↳ ' : ''}{p.name_pt}</button>)}
          </div>
          <ErrorBox error={err} />
        </Modal>
      )}
    </div>
  );
}

function ProcedureCard({ proc, index, total, name, surgery, locked, registerFlush, onDragStart, onDragEnd, onMove, onRemove }: {
  proc: Proc; index: number; total: number; name: string; surgery: SurgeryFull; locked: boolean; registerFlush: RegisterFlush;
  onDragStart(): void; onDragEnd(): void; onMove(d: number): void; onRemove(): void;
}) {
  const { schema: load } = useReference();
  const [schema, setSchema] = useState<any>();
  const [data, setData] = useState(proc.data);
  const [open, setOpen] = useState(!proc.validation.valid);
  useEffect(() => { void load(proc.schema_id).then(setSchema); }, [load, proc.schema_id]);
  const save = useAutosave(data, async (d) => { await api.put(`/api/surgeries/${surgery.id}/procedures/${proc.id}`, { data: d }); }, !locked);
  useEffect(() => registerFlush(save.flush), [registerFlush, save.flush]);
  const pending = schema ? validateWith(schema, data).length : 0;
  return (
    <>
      <div className="proc-head">
        {!locked && <span className="drag" draggable onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', proc.id); onDragStart(); }} onDragEnd={onDragEnd} title="Arrastar" aria-hidden>⠿</span>}
        <button className="ghost proc-title" onClick={() => setOpen(!open)} aria-expanded={open}>
          {index + 1}. {name}
        </button>
        {pending > 0 ? <span className="badge danger">{pending} pendência(s)</span> : <span className="badge ok">completo</span>}
        <SaveIndicator state={save.state} error={save.error} />
        {!locked && (
          <>
            <button className="small ghost" disabled={index === 0} onClick={() => onMove(-1)} aria-label="Mover para cima">↑</button>
            <button className="small ghost" disabled={index === total - 1} onClick={() => onMove(1)} aria-label="Mover para baixo">↓</button>
            <button className="small ghost" onClick={onRemove} aria-label="Remover">✕</button>
          </>
        )}
      </div>
      {open && <div className="proc-body">{!schema ? <Loading /> : <SchemaForm schema={schema} value={data} onChange={setData} side={surgery.episode_side} region={surgery.region} readOnly={locked} />}</div>}
    </>
  );
}
