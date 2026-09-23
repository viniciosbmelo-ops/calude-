import { ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, errorText } from '../lib/api';

export function Modal({ title, onClose, children, footer }: { title: string; onClose(): void; children: ReactNode; footer?: ReactNode }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <div className="card-head"><h2 style={{ margin: 0 }}>{title}</h2><button className="ghost small" onClick={onClose} aria-label="Fechar">✕</button></div>
        {children}
        {footer && <div className="row" style={{ justifyContent: 'flex-end', marginTop: 16 }}>{footer}</div>}
      </div>
    </div>
  );
}

let pushToast: (m: string) => void = () => undefined;
export function toast(m: string) { pushToast(m); }
export function ToastHost() {
  const [msg, setMsg] = useState<string | null>(null);
  const t = useRef<number>();
  useEffect(() => {
    pushToast = (m) => { setMsg(m); window.clearTimeout(t.current); t.current = window.setTimeout(() => setMsg(null), 3500); };
  }, []);
  return msg ? <div className="toast" role="status">{msg}</div> : null;
}

/** Mostra erro da API com a lista de pendências (schema / checklist) quando houver. */
export function ErrorBox({ error }: { error: unknown }) {
  if (!error) return null;
  const d = error instanceof ApiError ? error.details : undefined;
  const items: string[] = Array.isArray(d)
    ? d.flatMap((x: any) => (x.issues ? x.issues.map((i: any) => `${x.scope}: ${i.field} — ${i.message_pt}`) : [x.message_pt ? `${x.field ?? x.rule ?? ''} ${x.message_pt}`.trim() : JSON.stringify(x)]))
    : [];
  return (
    <div className="alert error" role="alert">
      {errorText(error)}
      {items.length > 0 && <ul>{items.map((m, i) => <li key={i}>{m}</li>)}</ul>}
    </div>
  );
}

export function Loading() { return <div className="spinner" aria-label="Carregando" />; }

/** Carrega dados com recarga manual. */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[]): { data: T | undefined; error: unknown; loading: boolean; reload(): Promise<void>; setData(d: T): void } {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<unknown>();
  const [loading, setLoading] = useState(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(async () => {
    setLoading(true);
    try { setData(await fn()); setError(undefined); } catch (e) { setError(e); } finally { setLoading(false); }
  }, deps);
  useEffect(() => { void run(); }, [run]);
  return { data, error, loading, reload: run, setData };
}

export type SaveState = 'idle' | 'saving' | 'saved' | 'error';
export function SaveIndicator({ state, error }: { state: SaveState; error?: string }) {
  if (state === 'idle') return null;
  const text = state === 'saving' ? 'Salvando…' : state === 'saved' ? 'Salvo' : `Não salvo${error ? ': ' + error : ''}`;
  return <span className={`saved ${state === 'saving' ? 'saving' : state === 'error' ? 'error' : ''}`} role="status"><span className="dot" />{text}</span>;
}

/**
 * Autosave com debounce: chama `save` 800 ms após a última mudança.
 * Não dispara na carga inicial; salva pendências ao desmontar.
 */
export function useAutosave<T>(value: T, save: (v: T) => Promise<void>, enabled: boolean) {
  const [state, setState] = useState<SaveState>('idle');
  const [err, setErr] = useState<string>();
  const first = useRef(true);
  const timer = useRef<number>();
  const pending = useRef<T | null>(null);
  const saveRef = useRef(save);
  saveRef.current = save;
  const flush = useCallback(async () => {
    const v = pending.current;
    if (v === null) return;
    pending.current = null;
    setState('saving');
    try { await saveRef.current(v); setState('saved'); setErr(undefined); } catch (e) { setState('error'); setErr(errorText(e)); }
  }, []);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    if (!enabled) return;
    pending.current = value;
    setState('saving');
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void flush(), 800);
  }, [value, enabled, flush]);
  useEffect(() => () => { window.clearTimeout(timer.current); void flush(); }, [flush]);
  return { state, error: err, flush };
}

export function fmtDate(iso?: string | null): string {
  if (!iso) return '—';
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(iso));
}
