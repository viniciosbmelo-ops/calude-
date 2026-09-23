/**
 * Motor de relatório cirúrgico DETERMINÍSTICO (seção 6 da especificação).
 * Regra: nenhuma chamada a LLM, relógio do sistema ou aleatoriedade neste módulo.
 * Mesmo input → mesma string, byte a byte.
 */
import Handlebars from 'handlebars';
import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import labels from '../labels.pt.json';
import { ARTHRO_STRUCTURES, PATHOLOGY_BY_CODE, Region, pathologyName } from '../catalog/pathologies';
import { round } from '../errors';

type Labels = Record<string, Record<string, string>>;
const L = labels as Labels;

export interface ReportPatient { name: string; record_number?: string }
export interface ReportSurgeon { name: string; crm?: string }
export interface ArthroMapEntry { structure_code: string; status: 'normal' | 'lesion' | 'treated' | 'not_evaluated'; finding_text?: string }
export interface ReportProcedure { pathology_code: string; sequence: number; schema_version: number; data: Record<string, any> }
export interface ReportImplant { manufacturer: string; model: string; size?: string; lot?: string; serial?: string; quantity: number; location?: string }

export interface ReportInput {
  region: Region;
  patient: ReportPatient;
  surgeon: ReportSurgeon;
  core: Record<string, any>;
  arthroscopic_map?: ArthroMapEntry[];
  procedures: ReportProcedure[];
  implants?: ReportImplant[];
  postop_plan?: string;
}

export interface GeneratedReport {
  text: string;
  template_versions: Record<string, number>;
}

// ---------------- helpers ----------------
const fmtNum = (n: unknown): string => {
  if (typeof n !== 'number' || !Number.isFinite(n)) return String(n ?? '');
  const r = round(n, 1);
  return (Number.isInteger(r) ? String(r) : r.toFixed(1)).replace('.', ',');
};

export function enumLabel(field: string, value: unknown): string {
  const v = String(value);
  return L[field]?.[v] ?? L._default?.[v] ?? v;
}

export function listPt(items: string[]): string {
  if (items.length === 0) return '';
  if (items.length === 1) return items[0];
  return `${items.slice(0, -1).join(', ')} e ${items[items.length - 1]}`;
}

function clockLabel(h: number, side: string): string {
  // Armazenado na convenção de ombro DIREITO; espelhado para o esquerdo.
  let v = side === 'L' ? (12 - h) % 12 : h % 12;
  if (v === 0) v = 12;
  return `${fmtNum(v)}h`;
}

function buildHandlebars(): typeof Handlebars {
  const hb = Handlebars.create();
  hb.registerHelper('eq', (a: unknown, b: unknown) => a === b);
  // `#if` do Handlebars trata 0 como falso — medidas/ângulos iguais a 0 são dados válidos.
  hb.registerHelper('has', (v: unknown) => v !== undefined && v !== null && v !== false && v !== '' && !(Array.isArray(v) && v.length === 0));
  hb.registerHelper('enum', (field: string, value: unknown) => enumLabel(field, value));
  hb.registerHelper('list', (field: string, values: unknown[]) => listPt((values ?? []).map((v) => enumLabel(field, v))));
  hb.registerHelper('mm', (v: unknown) => `${fmtNum(v)} mm`);
  hb.registerHelper('num', (v: unknown) => fmtNum(v));
  hb.registerHelper('deg', (v: unknown) => `${fmtNum(v)}°`);
  hb.registerHelper('plural', (n: number, s: string, p: string) => (n === 1 ? s : p));
  hb.registerHelper('capitalize', (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : ''));
  hb.registerHelper('date', (iso: string) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '');
    return m ? `${m[3]}/${m[2]}/${m[1]}` : String(iso ?? '');
  });
  hb.registerHelper('dxlist', (codes: string[]) => listPt((codes ?? []).map(pathologyName)));
  hb.registerHelper('clock', function (this: unknown, from: number, to: number, options: Handlebars.HelperOptions) {
    const side = options.data?.side ?? 'R';
    return `da posição de ${clockLabel(from, side)} à de ${clockLabel(to, side)}`;
  });
  hb.registerHelper('clocklist', function (this: unknown, hs: number[], options: Handlebars.HelperOptions) {
    const side = options.data?.side ?? 'R';
    return listPt((hs ?? []).map((h) => clockLabel(h, side)));
  });
  return hb;
}

const TEMPLATE_DIR = path.join(__dirname, 'templates');

export class ReportEngine {
  private readonly hb = buildHandlebars();
  private readonly cache = new Map<string, HandlebarsTemplateDelegate>();

  private tpl(name: string): HandlebarsTemplateDelegate {
    let t = this.cache.get(name);
    if (!t) {
      const src = fs.readFileSync(path.join(TEMPLATE_DIR, `${name}.hbs`), 'utf8');
      t = this.hb.compile(src, { noEscape: true, strict: false });
      this.cache.set(name, t);
    }
    return t;
  }

  private derived(code: string, data: Record<string, any>): Record<string, any> {
    const out = { ...data };
    if ((code === 'SH_AC_DISL' || code === 'SH_AC_OA') && typeof data.cc_distance_injured_mm === 'number' && typeof data.cc_distance_contralateral_mm === 'number' && data.cc_distance_contralateral_mm > 0) {
      out.ccPct = round(((data.cc_distance_injured_mm - data.cc_distance_contralateral_mm) / data.cc_distance_contralateral_mm) * 100, 0);
    }
    return out;
  }

  private durationMin(core: Record<string, any>): number | undefined {
    if (!core.start_time || !core.end_time) return undefined;
    const d = (Date.parse(core.end_time) - Date.parse(core.start_time)) / 60000;
    return Number.isFinite(d) && d > 0 ? Math.round(d) : undefined;
  }

  private arthroSection(region: Region, map: ArthroMapEntry[]): string {
    if (map.length === 0) return '';
    const names = ARTHRO_STRUCTURES[region];
    const nm = (c: string) => {
      const n = names[c];
      if (!n) throw new Error(`Estrutura artroscópica desconhecida para ${region}: ${c}`);
      return n;
    };
    // Ordem canônica = ordem do catálogo (independe da ordem de entrada)
    const order = Object.keys(names);
    const sorted = [...map].sort((a, b) => order.indexOf(a.structure_code) - order.indexOf(b.structure_code));
    const lines: string[] = ['INVENTÁRIO ARTROSCÓPICO'];
    for (const e of sorted.filter((x) => x.status === 'lesion' || x.status === 'treated')) {
      const tag = e.status === 'treated' ? 'lesão tratada' : 'lesão';
      lines.push(`- ${nm(e.structure_code).charAt(0).toUpperCase() + nm(e.structure_code).slice(1)}: ${tag}${e.finding_text ? ` — ${e.finding_text}` : ''}.`);
    }
    const normal = sorted.filter((x) => x.status === 'normal').map((x) => nm(x.structure_code));
    if (normal.length) lines.push(`Sem alterações: ${listPt(normal)}.`);
    const ne = sorted.filter((x) => x.status === 'not_evaluated').map((x) => nm(x.structure_code));
    if (ne.length) lines.push(`Não avaliados: ${listPt(ne)}.`);
    return lines.join('\n');
  }

  generate(input: ReportInput): GeneratedReport {
    const side = input.core.side;
    const header = this.tpl('CORE_HEADER')({ ...input, duration: this.durationMin(input.core) }, { data: { side } });
    const arthro = this.arthroSection(input.region, input.arthroscopic_map ?? []);

    const procs = [...input.procedures].sort((a, b) => a.sequence - b.sequence);
    const template_versions: Record<string, number> = {};
    const procTexts = procs.map((p, i) => {
      const def = PATHOLOGY_BY_CODE.get(p.pathology_code);
      if (!def?.report_template) throw new Error(`Patologia sem template de relatório: ${p.pathology_code}`);
      const [base] = def.report_template.split('.v');
      const tplName = `${base}.v${p.schema_version}`;
      template_versions[p.pathology_code] = p.schema_version;
      const body = this.tpl(tplName)(this.derived(p.pathology_code, p.data), { data: { side } });
      return `${i + 1}. ${def.name_pt}\n${body}`;
    });

    const footer = this.tpl('CORE_FOOTER')(input, { data: { side } });
    const text = normalize([header, arthro, procTexts.length ? `PROCEDIMENTOS\n${procTexts.join('\n\n')}` : '', footer].filter(Boolean).join('\n\n'));
    return { text, template_versions };
  }
}

/** Normaliza espaços para garantir saída estável e legível. */
export function normalize(s: string): string {
  return s
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((l) => l.replace(/[ \t]+/g, ' ').replace(/ ([.,;])/g, '$1').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim() + '\n';
}

// ---------------- assinatura / hash ----------------
function canonical(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(',')}}`;
}

export interface SignaturePayload {
  surgery_id: string;
  version: number;
  template_versions: Record<string, number>;
  final_text: string;
  signed_by: string;
  signed_at: string; // ISO — fornecido pelo servidor, nunca calculado aqui
}

export function reportHash(p: SignaturePayload): string {
  return createHash('sha256').update(canonical(p), 'utf8').digest('hex');
}
