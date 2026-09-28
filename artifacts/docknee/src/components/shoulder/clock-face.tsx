/**
 * Relógio glenoidal. Valores SEMPRE armazenados na convenção do ombro DIREITO;
 * exibidos espelhados quando o lado é esquerdo (h → 12 − h), igual ao relatório.
 */
import { cn } from "@/lib/utils";

const HOURS = Array.from({ length: 24 }, (_, i) => (i + 1) / 2); // 0,5 … 12

export const toDisplay = (h: number, side: string) => (side === "L" ? (12 - h) % 12 || 12 : h % 12 || 12);
export const toStored = (d: number, side: string) => (side === "L" ? (12 - d) % 12 || 12 : d % 12 || 12);
const fmt = (h: number) => `${String(h).replace(".", ",")}h`;

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

type RangeValue = { from_h?: number; to_h?: number };
interface RangeProps { mode: "range"; side: string; value?: RangeValue; onChange(v: RangeValue | undefined): void; disabled?: boolean }
interface MultiProps { mode: "multi"; side: string; value?: number[]; onChange(v: number[] | undefined): void; disabled?: boolean }

export function ClockFace(p: RangeProps | MultiProps) {
  const side = p.side;
  const shown = (h: number) => toDisplay(h, side);
  let fromD: number | undefined;
  let toD: number | undefined;
  let selected = new Set<number>();
  if (p.mode === "range") {
    fromD = p.value?.from_h !== undefined ? shown(p.value.from_h) : undefined;
    toD = p.value?.to_h !== undefined ? shown(p.value.to_h) : undefined;
  } else {
    selected = new Set((p.value ?? []).map(shown));
  }

  function click(d: number) {
    if (p.disabled) return;
    const stored = toStored(d, side);
    if (p.mode === "multi") {
      const cur = new Set(p.value ?? []);
      if (cur.has(stored)) cur.delete(stored);
      else cur.add(stored);
      const arr = [...cur].sort((a, b) => toDisplay(a, side) - toDisplay(b, side));
      p.onChange(arr.length ? arr : undefined);
    } else {
      const v = p.value ?? {};
      if (v.from_h === undefined || v.to_h !== undefined) p.onChange({ from_h: stored });
      else p.onChange({ from_h: v.from_h, to_h: stored });
    }
  }

  const summary = p.mode === "range"
    ? fromD === undefined ? "Toque na posição inicial." : toD === undefined ? `De ${fmt(fromD)} — toque na posição final.` : `De ${fmt(fromD)} a ${fmt(toD)}`
    : selected.size ? [...selected].sort((a, b) => a - b).map(fmt).join(", ") : "Toque nas posições.";
  const hasValue = p.mode === "range" ? p.value !== undefined : (p.value?.length ?? 0) > 0;

  return (
    <div className="flex flex-wrap items-start gap-4">
      <svg className="w-[220px] max-w-full aspect-square" viewBox="0 0 220 220" role="group" aria-label="Relógio glenoidal">
        <circle cx="110" cy="110" r="100" className="fill-muted/40 stroke-border" />
        {fromD !== undefined && toD !== undefined && (
          <path d={arcPath(fromD, toD)} className="fill-none stroke-primary/40" strokeWidth={10} strokeLinecap="round" />
        )}
        <text x="110" y="114" textAnchor="middle" fontSize="11" className="fill-muted-foreground">{side === "L" ? "esquerdo" : "direito"}</text>
        {HOURS.map((h) => {
          const whole = Number.isInteger(h);
          const { x, y } = pos(h, 88);
          const on = selected.has(h) || fromD === h || toD === h;
          return (
            <g key={h} onClick={() => click(h)} role="button" aria-label={fmt(h)} aria-pressed={on} className={cn(!p.disabled && "cursor-pointer")}>
              <circle cx={x} cy={y} r={whole ? 11 : 6} className={on ? "fill-primary stroke-primary" : "fill-background stroke-border"} />
              {whole && (
                <text x={x} y={y + 3} textAnchor="middle" fontSize="9" className={cn("pointer-events-none", on ? "fill-primary-foreground font-bold" : "fill-foreground")}>{h}</text>
              )}
            </g>
          );
        })}
      </svg>
      <div className="min-w-[140px] text-sm">
        <p>{summary}</p>
        <p className="mt-1.5 text-xs text-muted-foreground">Passo de 0,5 h. Exibido como lado {side === "L" ? "esquerdo (espelhado)" : "direito"}.</p>
        {hasValue && !p.disabled && (
          <button type="button" className="mt-2 text-xs text-primary hover:underline" onClick={() => p.onChange(undefined)}>Limpar</button>
        )}
      </div>
    </div>
  );
}
