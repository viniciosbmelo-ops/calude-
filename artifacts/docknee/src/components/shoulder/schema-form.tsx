/**
 * Formulário dirigido por JSON Schema (draft 2020-12) do núcleo clínico, no visual do DocSholder.
 * - Rótulos SEMPRE de labels.pt.json (_fields para campos, [campo][valor] para opções).
 * - Validação com os validadores PRÉ-COMPILADOS do núcleo (a CSP de produção proíbe eval).
 * - Campo que passa a ser obrigatório (if/then) é destacado imediatamente.
 */
import { useEffect, useMemo, useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { LABELS, diagnosesFor, toIssues, type Region, type ValidationIssue } from "@workspace/clinical/web";
import { validators } from "@workspace/clinical/validators";
import { ClockFace } from "./clock-face";

type Obj = Record<string, any>;
const L = LABELS as unknown as Record<string, Record<string, string>>;

export function valueLabel(field: string, v: unknown): string {
  const s = String(v);
  return L[field]?.[s] ?? L._default?.[s] ?? s;
}
export function fieldLabel(field: string, schema?: Obj): string {
  return schema?.["x-label"] ?? L._fields?.[field] ?? field;
}

export function validateWith(schemaId: string, data: unknown): ValidationIssue[] {
  const v = validators[schemaId];
  if (!v) return [{ field: "(schema)", keyword: "schema", message_pt: `Validador ausente para ${schemaId}.` }];
  return v(data) ? [] : toIssues(v.errors);
}

const UNITS: [RegExp, string][] = [
  [/_mm$/, "mm"], [/_deg$/, "°"], [/_pct$/, "%"], [/_cm$/, "cm"], [/_kg$/, "kg"],
  [/_mmHg$/, "mmHg"], [/_mg$/, "mg"], [/_min$|^minutes_/, "min"], [/_days$|^days_/, "dias"],
];
const unitOf = (name: string) => UNITS.find(([re]) => re.test(name))?.[1];

function clean(o: Obj): Obj | undefined {
  const out: Obj = {};
  for (const [k, v] of Object.entries(o)) if (v !== undefined) out[k] = v;
  return Object.keys(out).length ? out : undefined;
}

interface Ctx {
  side: string;
  region: Region;
  byPath: Map<string, ValidationIssue[]>;
  readOnly?: boolean;
  hide: Set<string>;
}

export interface SchemaFormProps {
  schema: Obj;
  value: Obj;
  onChange(v: Obj): void;
  /** "R" | "L" — relógio glenoidal espelhado no lado esquerdo */
  side: string;
  region: Region;
  readOnly?: boolean;
  /** Campos do nível raiz que não são exibidos (preenchidos por outra etapa) */
  hide?: string[];
  /** Pendências a mostrar; se omitido, calcula com o validador do schema */
  issues?: ValidationIssue[];
}

export function SchemaForm({ schema, value, onChange, side, region, readOnly, hide = [], issues }: SchemaFormProps) {
  const computed = useMemo(() => issues ?? validateWith(schema.$id, value), [issues, schema.$id, value]);
  const byPath = useMemo(() => {
    const m = new Map<string, ValidationIssue[]>();
    for (const i of computed) m.set(i.field, [...(m.get(i.field) ?? []), i]);
    return m;
  }, [computed]);
  const ctx: Ctx = { side, region, byPath, readOnly, hide: new Set(hide) };
  const extra = computed.filter((i) => i.keyword === "additionalProperties");
  return (
    <div className="space-y-4">
      {extra.length > 0 && (
        <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Campos antigos não previstos neste formulário: {extra.map((e) => e.field).join(", ")}
        </p>
      )}
      <ObjectFields schema={schema} value={value ?? {}} path="" ctx={ctx} onChange={(v) => onChange(v ?? {})} root />
    </div>
  );
}

function isWide(name: string, sub: Obj): boolean {
  return sub.type === "object"
    || (sub.type === "array" && (sub.items?.type === "object" || sub.items?.enum || sub.items?.pattern))
    || /_clock$/.test(name)
    || (sub.type === "string" && (sub.maxLength ?? 0) > 120)
    || (Array.isArray(sub.enum) && sub.enum.length > 4);
}

function ObjectFields({ schema, value, path, ctx, onChange, root }: { schema: Obj; value: Obj; path: string; ctx: Ctx; onChange(v: Obj | undefined): void; root?: boolean }) {
  const props = Object.entries<Obj>(schema.properties ?? {}).filter(([k]) => !(root && ctx.hide.has(k)));
  const staticReq = new Set<string>(schema.required ?? []);
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {props.map(([name, sub]) => {
        const p = path ? `${path}.${name}` : name;
        return (
          <div key={name} className={cn(isWide(name, sub) && "md:col-span-2")}>
            <Field name={name} schema={sub} path={p} value={value[name]} ctx={ctx} required={staticReq.has(name)}
              onChange={(v) => onChange(clean({ ...value, [name]: v }))} />
          </div>
        );
      })}
    </div>
  );
}

function OptionButton({ selected, disabled, onClick, children }: { selected: boolean; disabled?: boolean; onClick(): void; children: React.ReactNode }) {
  return (
    <button type="button" disabled={disabled} onClick={onClick} aria-pressed={selected}
      className={cn("text-sm text-left px-3 py-2 rounded-lg border-2 transition-all disabled:opacity-60",
        selected ? "border-primary bg-primary/5 font-medium text-primary" : "border-border hover:border-primary/40")}>
      {selected && <CheckCircle2 className="inline h-3 w-3 mr-1" />}{children}
    </button>
  );
}

function Field({ name, schema, path, value, ctx, required, onChange }: { name: string; schema: Obj; path: string; value: any; ctx: Ctx; required: boolean; onChange(v: any): void }) {
  const own = ctx.byPath.get(path) ?? [];
  const missing = own.some((i) => i.keyword === "required");
  const errs = own.filter((i) => i.keyword !== "required");
  const label = fieldLabel(name, schema);
  const ro = ctx.readOnly;

  if (schema.type === "object" && schema["x-ui"] !== "clock_face") {
    const nestedIssue = [...ctx.byPath.keys()].some((k) => k.startsWith(path + "."));
    return (
      <details className={cn("rounded-xl border p-4 bg-muted/20", missing && "border-destructive")} open={value !== undefined || missing || nestedIssue}>
        <summary className="cursor-pointer text-sm font-semibold">
          {label}{(required || missing) && <span className="text-destructive"> *</span>}
          {value === undefined && <span className="ml-2 text-xs font-normal text-muted-foreground">(não preenchido)</span>}
        </summary>
        <div className="mt-4">
          <ObjectFields schema={schema} value={value ?? {}} path={path} ctx={ctx} onChange={onChange} />
          {value !== undefined && !ro && (
            <button type="button" className="mt-3 text-xs text-muted-foreground hover:text-foreground" onClick={() => onChange(undefined)}>Limpar seção</button>
          )}
        </div>
      </details>
    );
  }

  let control: React.ReactNode;
  if (schema["x-ui"] === "clock_face") {
    control = <ClockFace mode="range" side={ctx.side} value={value} onChange={onChange} disabled={ro} />;
  } else if (Array.isArray(schema.enum)) {
    control = (
      <div className={cn("grid gap-2", schema.enum.length > 4 ? "sm:grid-cols-2" : "grid-cols-2 sm:grid-cols-4")} role="group" aria-label={label}>
        {schema.enum.map((o: unknown) => (
          <OptionButton key={String(o)} selected={value === o} disabled={ro} onClick={() => onChange(value === o ? undefined : o)}>{valueLabel(name, o)}</OptionButton>
        ))}
      </div>
    );
  } else if (schema.type === "boolean") {
    control = (
      <div className="grid grid-cols-2 gap-2 max-w-xs" role="group" aria-label={label}>
        {[true, false].map((b) => (
          <OptionButton key={String(b)} selected={value === b} disabled={ro} onClick={() => onChange(value === b ? undefined : b)}>{b ? "Sim" : "Não"}</OptionButton>
        ))}
      </div>
    );
  } else if (schema.type === "number" || schema.type === "integer") {
    control = <NumberInput schema={schema} value={value} unit={unitOf(name)} onChange={onChange} disabled={ro} label={label} />;
  } else if (schema.type === "array" && schema.items?.enum) {
    const cur: unknown[] = value ?? [];
    control = (
      <div className="grid gap-2 sm:grid-cols-2" role="group" aria-label={label}>
        {schema.items.enum.map((o: unknown) => (
          <OptionButton key={String(o)} selected={cur.includes(o)} disabled={ro}
            onClick={() => { const n = cur.includes(o) ? cur.filter((x) => x !== o) : [...cur, o]; onChange(n.length ? n : undefined); }}>
            {valueLabel(name, o)}
          </OptionButton>
        ))}
      </div>
    );
  } else if (schema.type === "array" && schema.items?.type === "number" && /_clock$/.test(name)) {
    control = <ClockFace mode="multi" side={ctx.side} value={value} onChange={onChange} disabled={ro} />;
  } else if (schema.type === "array" && String(schema.items?.pattern ?? "").includes("SH|EL")) {
    const cur: string[] = value ?? [];
    control = (
      <div className="grid gap-2 sm:grid-cols-2" role="group" aria-label={label}>
        {diagnosesFor(ctx.region).map((p) => (
          <OptionButton key={p.code} selected={cur.includes(p.code)} disabled={ro}
            onClick={() => { const n = cur.includes(p.code) ? cur.filter((x) => x !== p.code) : [...cur, p.code]; onChange(n.length ? n : undefined); }}>
            {p.parent ? "↳ " : ""}{p.name_pt}
          </OptionButton>
        ))}
      </div>
    );
  } else if (schema.type === "array" && schema.items?.type === "object") {
    const cur: Obj[] = value ?? [];
    control = (
      <div className="space-y-3">
        {cur.map((item, i) => (
          <div key={i} className="rounded-xl border p-4 bg-muted/20">
            <ObjectFields schema={schema.items} value={item} path={`${path}.${i}`} ctx={ctx}
              onChange={(v) => { const n = [...cur]; if (v) n[i] = v; else n.splice(i, 1); onChange(n.length ? n : undefined); }} />
            {!ro && <button type="button" className="mt-3 text-xs text-muted-foreground hover:text-destructive" onClick={() => { const n = cur.filter((_, j) => j !== i); onChange(n.length ? n : undefined); }}>Remover</button>}
          </div>
        ))}
        {!ro && <button type="button" className="text-sm font-medium text-primary hover:underline" onClick={() => onChange([...cur, {}])}>+ Adicionar</button>}
      </div>
    );
  } else if (schema.type === "string" && schema.format === "date") {
    control = <Input type="date" value={value ?? ""} disabled={ro} onChange={(e) => onChange(e.target.value || undefined)} aria-label={label} />;
  } else if (schema.type === "string" && schema.format === "date-time") {
    control = <Input type="datetime-local" value={value ? isoToLocal(value) : ""} disabled={ro} onChange={(e) => onChange(e.target.value ? localToIso(e.target.value) : undefined)} aria-label={label} />;
  } else if (schema.type === "string" && (schema.maxLength ?? 0) > 120) {
    control = <Textarea rows={3} value={value ?? ""} maxLength={schema.maxLength} disabled={ro} onChange={(e) => onChange(e.target.value || undefined)} aria-label={label} />;
  } else {
    control = <Input value={value ?? ""} maxLength={schema.maxLength} disabled={ro} onChange={(e) => onChange(e.target.value || undefined)} aria-label={label} />;
  }

  return (
    <div className="space-y-2" data-field={path}>
      <p className={cn("text-sm font-medium", missing && "text-destructive")}>
        {label}{(required || missing) && <span className="text-destructive"> *</span>}
      </p>
      <div className={cn(missing && "rounded-lg ring-2 ring-destructive/60 ring-offset-2 ring-offset-background")}>{control}</div>
      {schema["x-note"] && <p className="text-xs text-muted-foreground">{schema["x-note"]}</p>}
      {missing && <p className="text-xs text-destructive">Obrigatório com as escolhas atuais.</p>}
      {errs.map((e, i) => <p key={i} className="text-xs text-destructive">{e.message_pt}</p>)}
    </div>
  );
}

function NumberInput({ schema, value, unit, onChange, disabled, label }: { schema: Obj; value: any; unit?: string; onChange(v: any): void; disabled?: boolean; label: string }) {
  // Texto livre com vírgula decimal (pt-BR); só emite número quando o texto é válido
  const fmt = (v: any) => (typeof v === "number" ? String(v).replace(".", ",") : "");
  const [text, setText] = useState(fmt(value));
  useEffect(() => {
    const parsed = Number(text.replace(",", "."));
    if (value !== (text === "" ? undefined : parsed)) setText(fmt(value));
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps
  const bad = text !== "" && !/^-?\d+([.,]\d+)?$/.test(text.trim());
  const intBad = schema.type === "integer" && text !== "" && !bad && !Number.isInteger(Number(text.replace(",", ".")));
  const range = schema.minimum !== undefined || schema.maximum !== undefined ? `${schema.minimum ?? ""}–${schema.maximum ?? ""}${unit ? " " + unit : ""}` : "";
  return (
    <div className="space-y-1">
      <div className="flex items-stretch">
        <Input inputMode={schema.type === "integer" ? "numeric" : "decimal"} value={text} disabled={disabled} aria-label={label} aria-invalid={bad || intBad}
          className={cn(unit && "rounded-r-none")}
          onChange={(e) => {
            const t = e.target.value;
            setText(t);
            const raw = t.trim().replace(",", ".");
            if (raw === "") return onChange(undefined);
            if (/^-?\d+(\.\d+)?$/.test(raw)) onChange(Number(raw));
          }} />
        {unit && <span className="flex items-center rounded-r-md border border-l-0 bg-muted px-3 text-xs text-muted-foreground">{unit}</span>}
      </div>
      {(bad || intBad) && <p className="text-xs text-destructive">{intBad ? "Use número inteiro." : "Número inválido."}</p>}
      {range && <p className="text-xs text-muted-foreground">Faixa aceita: {range}</p>}
    </div>
  );
}

/** ISO com fuso → valor de <input type=datetime-local> no fuso do navegador. */
export function isoToLocal(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
/** Valor local → ISO com o deslocamento do navegador (ex.: 2026-09-23T10:00:00-03:00). */
export function localToIso(local: string): string {
  const d = new Date(local);
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? "+" : "-";
  const p = (n: number) => String(Math.floor(Math.abs(n))).padStart(2, "0");
  return `${local.length === 16 ? local + ":00" : local}${sign}${p(off / 60)}:${p(off % 60)}`;
}
