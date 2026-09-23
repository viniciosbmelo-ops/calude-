/**
 * Relógio glenoidal. Valores SEMPRE armazenados na convenção do ombro DIREITO;
 * exibidos espelhados quando o lado é esquerdo (h → 12 − h), igual ao relatório.
 */
const HOURS = Array.from({ length: 24 }, (_, i) => (i + 1) / 2); // 0,5 … 12

export const toDisplay = (h: number, side: string) => (side === 'L' ? (12 - h) % 12 || 12 : h % 12 || 12);
export const toStored = (d: number, side: string) => (side === 'L' ? (12 - d) % 12 || 12 : d % 12 || 12);
const fmt = (h: number) => `${String(h).replace('.', ',')}h`;

function pos(h: number, r: number) {
  const a = (h / 12) * 2 * Math.PI - Math.PI / 2;
  return { x: 110 + r * Math.cos(a), y: 110 + r * Math.sin(a) };
}

function arcPath(from: number, to: number): string {
  const span = ((to - from + 12) % 12) || 12;
  const a = pos(from, 70);
  const b = pos(to, 70);
  return `M ${a.x} ${a.y} A 70 70 0 ${span > 6 ? 1 : 0} 1 ${b.x} ${b.y}`;
}

interface RangeProps { mode: 'range'; side: string; value?: { from_h?: number; to_h?: number }; onChange(v: { from_h: number; to_h?: number } | undefined): void }
interface MultiProps { mode: 'multi'; side: string; value?: number[]; onChange(v: number[] | undefined): void }

export function ClockFace(p: RangeProps | MultiProps) {
  const side = p.side;
  const shown = (h: number) => toDisplay(h, side);
  let fromD: number | undefined, toD: number | undefined, selected = new Set<number>();
  if (p.mode === 'range') {
    fromD = p.value?.from_h !== undefined ? shown(p.value.from_h) : undefined;
    toD = p.value?.to_h !== undefined ? shown(p.value.to_h) : undefined;
  } else selected = new Set((p.value ?? []).map(shown));

  function click(d: number) {
    const stored = toStored(d, side);
    if (p.mode === 'multi') {
      const cur = new Set(p.value ?? []);
      cur.has(stored) ? cur.delete(stored) : cur.add(stored);
      const arr = [...cur].sort((a, b) => toDisplay(a, side) - toDisplay(b, side));
      p.onChange(arr.length ? arr : undefined);
    } else {
      const v = p.value ?? {};
      if (v.from_h === undefined || v.to_h !== undefined) p.onChange({ from_h: stored });
      else p.onChange({ from_h: v.from_h, to_h: stored });
    }
  }

  const summary = p.mode === 'range'
    ? fromD === undefined ? 'Toque na posição inicial.' : toD === undefined ? `De ${fmt(fromD)} — toque na posição final.` : `De ${fmt(fromD)} a ${fmt(toD)}`
    : selected.size ? [...selected].sort((a, b) => a - b).map(fmt).join(', ') : 'Toque nas posições.';

  return (
    <div className="row" style={{ alignItems: 'flex-start' }}>
      <svg className="clock" viewBox="0 0 220 220" role="group" aria-label="Relógio glenoidal">
        <circle className="face" cx="110" cy="110" r="100" />
        {fromD !== undefined && toD !== undefined && <path className="arc" d={arcPath(fromD, toD)} />}
        <text x="110" y="114" textAnchor="middle" fontSize="11" fill="currentColor" opacity=".6">{side === 'L' ? 'esquerdo' : 'direito'}</text>
        {HOURS.map((h) => {
          const whole = Number.isInteger(h);
          const { x, y } = pos(h, 88);
          const cls = ['tick', selected.has(h) ? 'on' : '', fromD === h ? 'from' : '', toD === h ? 'to' : ''].join(' ');
          return (
            <g key={h} className={cls} onClick={() => click(h)} role="button" aria-label={fmt(h)} aria-pressed={selected.has(h) || fromD === h || toD === h}>
              <circle cx={x} cy={y} r={whole ? 11 : 6} />
              {whole && <text x={x} y={y + 3} textAnchor="middle">{h}</text>}
            </g>
          );
        })}
      </svg>
      <div className="small" style={{ minWidth: 140 }}>
        <div>{summary}</div>
        <div className="muted" style={{ marginTop: 6 }}>Passo de 0,5 h. Exibido como lado {side === 'L' ? 'esquerdo (espelhado)' : 'direito'}.</div>
        {(p.mode === 'range' ? p.value : p.value?.length) ? <button type="button" className="small ghost" onClick={() => p.onChange(undefined)}>Limpar</button> : null}
      </div>
    </div>
  );
}
