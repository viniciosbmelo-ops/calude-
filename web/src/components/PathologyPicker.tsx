/** Seleção de patologias do catálogo: árvore (principal) e chips (secundárias / diagnósticos). */
import { useState } from 'react';
import { Pathology, useReference } from '../lib/ref';

export function PathologyTree({ region, value, onChange, exclude = [] }: { region: 'shoulder' | 'elbow'; value?: string; onChange(code: string): void; exclude?: string[] }) {
  const { pathologies } = useReference();
  const [q, setQ] = useState('');
  const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const match = (p: Pathology) => !q || norm(p.name_pt).includes(norm(q));
  const roots = pathologies.filter((p) => p.region === region);
  return (
    <div>
      <input type="search" placeholder="Filtrar patologias…" value={q} onChange={(e) => setQ(e.target.value)} style={{ marginBottom: 8 }} aria-label="Filtrar patologias" />
      <div style={{ maxHeight: 320, overflow: 'auto', border: '1px solid var(--border)', borderRadius: 8, padding: 6 }} role="listbox" aria-label="Patologias">
        {roots.filter((r) => match(r) || (r.children ?? []).some(match)).map((r) => (
          <div key={r.code}>
            <PathOption p={r} selected={value === r.code} disabled={exclude.includes(r.code)} onPick={onChange} />
            {(r.children ?? []).filter(match).map((c) => (
              <div key={c.code} style={{ paddingLeft: 20 }}><PathOption p={c} selected={value === c.code} disabled={exclude.includes(c.code)} onPick={onChange} /></div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function PathOption({ p, selected, disabled, onPick }: { p: Pathology; selected: boolean; disabled: boolean; onPick(c: string): void }) {
  return (
    <button type="button" role="option" aria-selected={selected} disabled={disabled} onClick={() => onPick(p.code)}
      style={{ width: '100%', justifyContent: 'space-between', border: 0, background: selected ? 'var(--primary-soft)' : 'transparent', color: selected ? 'var(--primary)' : 'inherit', fontWeight: selected ? 600 : 400 }}>
      <span style={{ textAlign: 'left' }}>{p.name_pt}</span>
      {p.intraop_schema_id && <span className="badge" title="Tem formulário intraoperatório">registro</span>}
    </button>
  );
}

export function PathologyMulti({ region, value, onChange, exclude = [], disabled }: { region: 'shoulder' | 'elbow'; value: string[]; onChange(v: string[]): void; exclude?: string[]; disabled?: boolean }) {
  const { pathologies, byCode } = useReference();
  const [open, setOpen] = useState(false);
  const all = pathologies.filter((p) => p.region === region).flatMap((r) => [r, ...(r.children ?? [])]).filter((p) => !exclude.includes(p.code));
  const toggle = (c: string) => onChange(value.includes(c) ? value.filter((x) => x !== c) : [...value, c]);
  return (
    <div>
      <div className="chips">
        {value.map((c) => (
          <button type="button" key={c} className="chip" aria-pressed disabled={disabled} onClick={() => toggle(c)} title="Remover">{byCode.get(c)?.name_pt ?? c} ✕</button>
        ))}
        {!disabled && <button type="button" className="chip" onClick={() => setOpen(!open)}>{open ? 'Fechar lista' : '+ Adicionar'}</button>}
      </div>
      {open && (
        <div className="chips" style={{ marginTop: 8, maxHeight: 220, overflow: 'auto', padding: 4, border: '1px solid var(--border)', borderRadius: 8 }}>
          {all.map((p) => (
            <button type="button" key={p.code} className="chip" aria-pressed={value.includes(p.code)} onClick={() => toggle(p.code)}>
              {p.parent_code ? '↳ ' : ''}{p.name_pt}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
