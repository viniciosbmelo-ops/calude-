import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { useReference } from '../../lib/ref';
import { Loading, SaveIndicator, useAutosave } from '../../components/ui';
import { SchemaForm } from '../../components/SchemaForm';
import type { RegisterFlush, SurgeryFull } from '../Surgery';

export function CoreStep({ surgery, locked, onNext, registerFlush }: { registerFlush: RegisterFlush; surgery: SurgeryFull; locked: boolean; onNext(): void }) {
  const { schema: load } = useReference();
  const [schema, setSchema] = useState<any>();
  const [core, setCore] = useState(surgery.core);
  useEffect(() => { void load('CORE_SURGERY.v1').then(setSchema); }, [load]);
  const canSave = !locked && /^\d{4}-\d{2}-\d{2}$/.test(core.surgery_date ?? '') && (core.side === 'R' || core.side === 'L');
  const save = useAutosave(core, async (c) => { await api.patch(`/api/surgeries/${surgery.id}`, { core: c }); }, canSave);
  useEffect(() => registerFlush(save.flush), [registerFlush, save.flush]);
  if (!schema) return <Loading />;
  return (
    <div className="card">
      <div className="card-head">
        <h2 style={{ margin: 0 }}>Dados gerais da cirurgia</h2>
        <SaveIndicator state={!canSave && !locked ? 'error' : save.state} error={!canSave && !locked ? 'data e lado são necessários' : save.error} />
      </div>
      {core.side && core.side !== surgery.episode_side && <div className="alert error" style={{ marginBottom: 12 }}>Lado diferente do episódio — o banco bloqueia esta gravação.</div>}
      <SchemaForm schema={schema} value={core} onChange={setCore} side={core.side ?? surgery.episode_side} region={surgery.region} readOnly={locked} />
      <div className="row" style={{ marginTop: 16, justifyContent: 'flex-end' }}><button className="primary" onClick={onNext}>Próximo: mapa artroscópico →</button></div>
    </div>
  );
}
