import { useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/api';
import { useReference } from '../../lib/ref';
import { SaveIndicator, useAutosave } from '../../components/ui';
import type { RegisterFlush, SurgeryFull } from '../Surgery';

type Entry = { structure_code: string; status: string; finding_text?: string; justification?: string };
const STATUSES: [string, string][] = [['normal', 'Normal'], ['lesion', 'Lesão'], ['treated', 'Tratada'], ['not_evaluated', 'N.A.']];

export function MapStep({ surgery, locked, onNext, registerFlush }: { registerFlush: RegisterFlush; surgery: SurgeryFull; locked: boolean; onNext(): void }) {
  const { structures } = useReference();
  const names = structures[surgery.region];
  const [map, setMap] = useState<Record<string, Entry>>(() =>
    Object.fromEntries(surgery.arthroscopic_map.map((m) => [m.structure_code, { structure_code: m.structure_code, status: m.status, finding_text: m.finding_text ?? undefined, justification: m.justification ?? undefined }]))
  );
  const entries = useMemo(() => Object.values(map), [map]);
  const save = useAutosave(entries, async (e) => { await api.put(`/api/surgeries/${surgery.id}/arthroscopic-map`, { entries: e }); }, !locked);
  useEffect(() => registerFlush(save.flush), [registerFlush, save.flush]);
  const set = (code: string, patch: Partial<Entry> | null) =>
    setMap((m) => {
      const n = { ...m };
      if (patch === null) delete n[code];
      else n[code] = { ...(n[code] ?? { structure_code: code, status: 'normal' }), ...patch };
      return n;
    });
  const pending = Object.keys(names).filter((c) => !map[c]).length;
  return (
    <div className="card">
      <div className="card-head">
        <h2 style={{ margin: 0 }}>Inventário artroscópico</h2>
        <SaveIndicator state={save.state} error={save.error} />
      </div>
      <div className="row small muted" style={{ marginBottom: 8 }}>
        {pending > 0 ? `${pending} estrutura(s) sem registro — não aparecem no relatório.` : 'Todas as estruturas registradas.'}
        <span className="spacer" />
        {!locked && <button className="small" onClick={() => setMap((m) => { const n = { ...m }; for (const c of Object.keys(names)) if (!n[c]) n[c] = { structure_code: c, status: 'normal' }; return n; })}>Marcar restantes como normais</button>}
      </div>
      {Object.entries(names).map(([code, name]) => {
        const e = map[code];
        return (
          <div className="map-row" key={code}>
            <div>{name.charAt(0).toUpperCase() + name.slice(1)}</div>
            <div className="segmented seg-status" role="group" aria-label={name}>
              {STATUSES.map(([v, l]) => (
                <button key={v} data-v={v} aria-pressed={e?.status === v} disabled={locked} onClick={() => set(code, e?.status === v ? null : { status: v })}>{l}</button>
              ))}
            </div>
            {(e?.status === 'lesion' || e?.status === 'treated') && (
              <div className="map-extra">
                <label className="field"><div className="field-label">Achado</div><input maxLength={300} disabled={locked} value={e.finding_text ?? ''} onChange={(x) => set(code, { finding_text: x.target.value || undefined })} placeholder="ex.: rotura parcial de 40%" /></label>
                {e.status === 'lesion' && <label className="field"><div className="field-label">Justificativa se não tratada</div><input maxLength={300} disabled={locked} value={e.justification ?? ''} onChange={(x) => set(code, { justification: x.target.value || undefined })} placeholder="ex.: conduta expectante" /></label>}
              </div>
            )}
          </div>
        );
      })}
      <div className="row" style={{ marginTop: 16, justifyContent: 'flex-end' }}><button className="primary" onClick={onNext}>Próximo: procedimentos →</button></div>
    </div>
  );
}
