/**
 * Formulário dirigido por JSON Schema (draft 2020-12).
 * - Rótulos SEMPRE de labels.pt.json (_fields para campos, [campo][valor] para opções).
 * - Validação no navegador com o MESMO ajv do servidor (@core/ajvShared).
 * - Campo que passa a ser obrigatório (if/then) é destacado imediatamente.
 */
import { useEffect, useMemo, useState } from 'react';
import { toIssues, ValidationIssue } from '@core/ajvMessages';
import { validators } from '../generated/validators';
import { fieldLabel, Labels, useReference, valueLabel } from '../lib/ref';
import { ClockFace } from './ClockFace';
import { PathologyMulti } from './PathologyPicker';

type Obj = Record<string, any>;

/**
 * Valida com o validador PRÉ-COMPILADO do schema (mesma configuração do servidor).
 * Sem compilação em tempo de execução: a CSP do app proíbe eval.
 */
export function validateWith(schema: any, data: unknown): ValidationIssue[] {
  const v = validators[schema.$id as string];
  if (!v) return [{ field: '(schema)', keyword: 'schema', message_pt: `Validador ausente para ${schema.$id} — rode npm run build.` }];
  return v(data) ? [] : toIssues(v.errors);
}

const UNITS: [RegExp, string][] = [[/_mm$/, 'mm'], [/_deg$/, '°'], [/_pct$/, '%'], [/_cm$/, 'cm'], [/_kg$/, 'kg'], [/_mmHg$/, 'mmHg'], [/_mg$/, 'mg'], [/_min$|^minutes_/, 'min'], [/_days$|^days_/, 'dias']];
export const unitOf = (name: string) => UNITS.find(([re]) => re.test(name))?.[1];

function clean(o: Obj): Obj | undefined {
  const out: Obj = {};
  for (const [k, v] of Object.entries(o)) if (v !== undefined) out[k] = v;
  return Object.keys(out).length ? out : undefined;
}

interface Ctx {
  labels: Labels;
  side: string;
  region: 'shoulder' | 'elbow';
  byPath: Map<string, ValidationIssue[]>;
  readOnly?: boolean;
}

export interface SchemaFormProps {
  schema: any;
  value: Obj;
  onChange(v: Obj): void;
  side: string;
  region: 'shoulder' | 'elbow';
  readOnly?: boolean;
  /** limita os campos exibidos (ex.: só uma parte do núcleo) */
  only?: string[];
}

export function SchemaForm({ schema, value, onChange, side, region, readOnly, only }: SchemaFormProps) {
  const { labels } = useReference();
  const issues = useMemo(() => validateWith(schema, value), [schema, value]);
  const byPath = useMemo(() => {
    const m = new Map<string, ValidationIssue[]>();
    for (const i of issues) m.set(i.field, [...(m.get(i.field) ?? []), i]);
    return m;
  }, [issues]);
  const ctx: Ctx = { labels, side, region, byPath, readOnly };
  const extra = issues.filter((i) => i.keyword === 'additionalProperties');
  return (
    <div>
      {extra.length > 0 && <div className="alert warn" style={{ marginBottom: 12 }}>Campos antigos não previstos neste formulário: {extra.map((e) => e.field).join(', ')}</div>}
      <ObjectFields schema={schema} value={value ?? {}} path="" ctx={ctx} onChange={(v) => onChange(v ?? {})} only={only} />
    </div>
  );
}

function ObjectFields({ schema, value, path, ctx, onChange, only }: { schema: any; value: Obj; path: string; ctx: Ctx; onChange(v: Obj | undefined): void; only?: string[] }) {
  const props = Object.entries<any>(schema.properties ?? {}).filter(([k]) => !only || only.includes(k));
  const staticReq = new Set<string>(schema.required ?? []);
  return (
    <div className="form-grid">
      {props.map(([name, sub]) => {
        const p = path ? `${path}.${name}` : name;
        const wide = sub.type === 'object' || (sub.type === 'array' && (sub.items?.type === 'object' || sub.items?.enum || sub.items?.pattern)) || sub['x-ui'] === 'clock_face' || /_clock$/.test(name) || (sub.type === 'string' && (sub.maxLength ?? 0) > 120) || (sub.enum && sub.enum.length > 4);
        return (
          <div key={name} className={wide ? 'wide' : ''}>
            <Field name={name} schema={sub} path={p} value={value[name]} ctx={ctx} required={staticReq.has(name)}
              onChange={(v) => onChange(clean({ ...value, [name]: v }))} />
          </div>
        );
      })}
    </div>
  );
}

function Field({ name, schema, path, value, ctx, required, onChange }: { name: string; schema: any; path: string; value: any; ctx: Ctx; required: boolean; onChange(v: any): void }) {
  const own = ctx.byPath.get(path) ?? [];
  const missing = own.some((i) => i.keyword === 'required');
  const errs = own.filter((i) => i.keyword !== 'required');
  const label = fieldLabel(ctx.labels, name, schema);
  const unit = unitOf(name);

  // objeto: seção recolhível (exceto relógio)
  if (schema.type === 'object' && schema['x-ui'] !== 'clock_face') {
    const nestedMissing = [...ctx.byPath.keys()].some((k) => k.startsWith(path + '.'));
    return (
      <details className={'section field' + (missing ? ' missing' : '')} open={value !== undefined || missing || nestedMissing}>
        <summary>{label}{(required || missing) && <span className="req">*</span>}{value === undefined && <span className="muted small">(não preenchido)</span>}</summary>
        <div className="section-body">
          <ObjectFields schema={schema} value={value ?? {}} path={path} ctx={ctx} onChange={onChange} />
          {value !== undefined && !ctx.readOnly && <button type="button" className="small ghost" style={{ marginTop: 8 }} onClick={() => onChange(undefined)}>Limpar seção</button>}
        </div>
      </details>
    );
  }

  let control: JSX.Element;
  const ro = ctx.readOnly;
  if (schema['x-ui'] === 'clock_face') {
    control = <ClockFace mode="range" side={ctx.side} value={value} onChange={(v) => !ro && onChange(v)} />;
  } else if (schema.enum) {
    control = <EnumPicker field={name} options={schema.enum} value={value} labels={ctx.labels} onChange={onChange} disabled={ro} />;
  } else if (schema.type === 'boolean') {
    control = (
      <div className="segmented" role="group" aria-label={label}>
        {[true, false].map((b) => (
          <button type="button" key={String(b)} aria-pressed={value === b} disabled={ro} onClick={() => onChange(value === b ? undefined : b)}>{b ? 'Sim' : 'Não'}</button>
        ))}
      </div>
    );
  } else if (schema.type === 'number' || schema.type === 'integer') {
    control = <NumberInput schema={schema} value={value} unit={unit} onChange={onChange} disabled={ro} label={label} />;
  } else if (schema.type === 'array' && schema.items?.enum) {
    const cur: any[] = value ?? [];
    control = (
      <div className="chips" role="group" aria-label={label}>
        {schema.items.enum.map((o: any) => (
          <button type="button" key={String(o)} className="chip" aria-pressed={cur.includes(o)} disabled={ro}
            onClick={() => { const n = cur.includes(o) ? cur.filter((x) => x !== o) : [...cur, o]; onChange(n.length ? n : undefined); }}>
            {valueLabel(ctx.labels, name, o)}
          </button>
        ))}
      </div>
    );
  } else if (schema.type === 'array' && schema.items?.type === 'number' && /_clock$/.test(name)) {
    control = <ClockFace mode="multi" side={ctx.side} value={value} onChange={(v) => !ro && onChange(v)} />;
  } else if (schema.type === 'array' && schema.items?.pattern?.includes('SH|EL')) {
    control = <PathologyMulti region={ctx.region} value={value ?? []} onChange={(v) => onChange(v.length ? v : undefined)} disabled={ro} />;
  } else if (schema.type === 'array' && schema.items?.type === 'object') {
    const cur: Obj[] = value ?? [];
    control = (
      <div className="stack">
        {cur.map((item, i) => (
          <div key={i} className="section" style={{ padding: 12 }}>
            <ObjectFields schema={schema.items} value={item} path={`${path}.${i}`} ctx={ctx}
              onChange={(v) => { const n = [...cur]; if (v) n[i] = v; else n.splice(i, 1); onChange(n.length ? n : undefined); }} />
            {!ro && <button type="button" className="small ghost" onClick={() => { const n = cur.filter((_, j) => j !== i); onChange(n.length ? n : undefined); }}>Remover</button>}
          </div>
        ))}
        {!ro && <button type="button" className="small" onClick={() => onChange([...cur, {}])}>+ Adicionar</button>}
      </div>
    );
  } else if (schema.type === 'string' && schema.format === 'date') {
    control = <input type="date" value={value ?? ''} disabled={ro} onChange={(e) => onChange(e.target.value || undefined)} aria-label={label} />;
  } else if (schema.type === 'string' && schema.format === 'date-time') {
    control = <input type="datetime-local" value={value ? isoToLocal(value) : ''} disabled={ro} onChange={(e) => onChange(e.target.value ? localToIso(e.target.value) : undefined)} aria-label={label} />;
  } else if (schema.type === 'string' && (schema.maxLength ?? 0) > 120) {
    control = <textarea value={value ?? ''} maxLength={schema.maxLength} disabled={ro} onChange={(e) => onChange(e.target.value || undefined)} aria-label={label} />;
  } else {
    control = <input type="text" value={value ?? ''} maxLength={schema.maxLength} disabled={ro} onChange={(e) => onChange(e.target.value || undefined)} aria-label={label} />;
  }

  return (
    <div className={'field' + (missing ? ' missing' : '')} data-field={path}>
      <div className="field-label">{label}{(required || missing) && <span className="req" title="obrigatório">*</span>}</div>
      {control}
      {schema['x-note'] && <div className="field-note">{schema['x-note']}</div>}
      {missing && <div className="field-error">Obrigatório com as escolhas atuais.</div>}
      {errs.map((e, i) => <div key={i} className="field-error">{e.message_pt}</div>)}
    </div>
  );
}

function EnumPicker({ field, options, value, labels, onChange, disabled }: { field: string; options: any[]; value: any; labels: Labels; onChange(v: any): void; disabled?: boolean }) {
  const toggle = (o: any) => onChange(value === o ? undefined : o);
  // Segmentado só quando cabe numa linha; senão chips (que quebram bem)
  if (options.length <= 4 && options.reduce((n, o) => n + valueLabel(labels, field, o).length, 0) <= 36) {
    return (
      <div className="segmented" role="group">
        {options.map((o) => <button type="button" key={String(o)} aria-pressed={value === o} disabled={disabled} onClick={() => toggle(o)}>{valueLabel(labels, field, o)}</button>)}
      </div>
    );
  }
  return (
    <div className="chips" role="group">
      {options.map((o) => <button type="button" key={String(o)} className="chip" aria-pressed={value === o} disabled={disabled} onClick={() => toggle(o)}>{valueLabel(labels, field, o)}</button>)}
    </div>
  );
}

function NumberInput({ schema, value, unit, onChange, disabled, label }: { schema: any; value: any; unit?: string; onChange(v: any): void; disabled?: boolean; label: string }) {
  // Texto livre com vírgula decimal (pt-BR); o número só é emitido quando o texto é válido
  const fmt = (v: any) => (typeof v === 'number' ? String(v).replace('.', ',') : '');
  const [text, setText] = useState(fmt(value));
  useEffect(() => {
    const parsed = Number(text.replace(',', '.'));
    if (value !== (text === '' ? undefined : parsed)) setText(fmt(value));
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps
  const bad = text !== '' && !/^-?\d+([.,]\d+)?$/.test(text.trim());
  const intBad = schema.type === 'integer' && text !== '' && !bad && !Number.isInteger(Number(text.replace(',', '.')));
  const input = (
    <input type="text" inputMode={schema.type === 'integer' ? 'numeric' : 'decimal'} disabled={disabled} aria-label={label} aria-invalid={bad || intBad}
      value={text}
      onChange={(e) => {
        const t = e.target.value;
        setText(t);
        const raw = t.trim().replace(',', '.');
        if (raw === '') return onChange(undefined);
        if (/^-?\d+(\.\d+)?$/.test(raw)) onChange(Number(raw));
      }} />
  );
  const range = schema.minimum !== undefined || schema.maximum !== undefined ? `${schema.minimum ?? ''}–${schema.maximum ?? ''}${unit ? ' ' + unit : ''}` : '';
  return (
    <>
      {unit ? <div className="input-unit">{input}<span>{unit}</span></div> : input}
      {(bad || intBad) && <div className="field-error">{intBad ? 'Use número inteiro.' : 'Número inválido.'}</div>}
      {range && <div className="field-note">Faixa aceita: {range}</div>}
    </>
  );
}

/** ISO com fuso → valor de <input type=datetime-local> no fuso do navegador. */
export function isoToLocal(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
/** Valor local → ISO com o deslocamento do navegador (ex.: 2026-09-23T10:00:00-03:00). */
export function localToIso(local: string): string {
  const d = new Date(local);
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  const p = (n: number) => String(Math.floor(Math.abs(n))).padStart(2, '0');
  return `${local.length === 16 ? local + ':00' : local}${sign}${p(off / 60)}:${p(off % 60)}`;
}
