/** Evolução de um escore por timepoint. Uma série por (instrumento, versão, máximo) — nunca mistura Constant/75 com /100. */
import { TIMEPOINT_PT } from '../lib/ref';

const ORDER = ['preop', '6w', '3m', '6m', '12m', '24m', 'other'];

export function LineChart({ title, max, points }: { title: string; max: number; points: { timepoint: string; score: number; completed_at: string }[] }) {
  const tps = ORDER.filter((t) => points.some((p) => p.timepoint === t));
  const W = 460, H = 200, L = 36, R = 16, T = 18, B = 30;
  const x = (i: number) => (tps.length <= 1 ? L + (W - L - R) / 2 : L + (i * (W - L - R)) / (tps.length - 1));
  const y = (v: number) => T + (1 - v / max) * (H - T - B);
  // último registro de cada timepoint
  const last = tps.map((t) => points.filter((p) => p.timepoint === t).sort((a, b) => a.completed_at.localeCompare(b.completed_at)).pop()!);
  const path = last.map((p, i) => `${i ? 'L' : 'M'} ${x(i)} ${y(p.score)}`).join(' ');
  const ticks = [0, max / 2, max];
  return (
    <figure style={{ margin: 0 }}>
      <figcaption className="small" style={{ fontWeight: 600, marginBottom: 4 }}>{title} <span className="muted">(0–{max})</span></figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={`${title}: ${last.map((p) => `${TIMEPOINT_PT[p.timepoint]} ${p.score}`).join(', ')}`}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke="var(--border)" />
            <text x={L - 6} y={y(t) + 4} fontSize="11" textAnchor="end" fill="var(--muted)">{t}</text>
          </g>
        ))}
        <path d={path} fill="none" stroke="var(--primary)" strokeWidth="2.5" />
        {last.map((p, i) => (
          <g key={p.timepoint}>
            <circle cx={x(i)} cy={y(p.score)} r="4.5" fill="var(--primary)" />
            <text x={x(i)} y={y(p.score) - 9} fontSize="11" textAnchor="middle" fill="var(--text)">{String(p.score).replace('.', ',')}</text>
            {/* rótulos das pontas ancorados para dentro, para não serem cortados */}
            <text x={x(i)} y={H - 10} fontSize="11" textAnchor={last.length > 1 && i === 0 ? 'start' : last.length > 1 && i === last.length - 1 ? 'end' : 'middle'} fill="var(--muted)">{TIMEPOINT_PT[p.timepoint]}</text>
          </g>
        ))}
      </svg>
    </figure>
  );
}
