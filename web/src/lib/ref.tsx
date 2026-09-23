/** Dados de referência (rótulos, catálogo, schemas), carregados uma vez por sessão. */
import { createContext, ReactNode, useContext, useEffect, useState } from 'react';
import { api } from './api';

export interface Pathology {
  code: string; region: 'shoulder' | 'elbow'; name_pt: string; parent_code: string | null;
  diagnosis_schema_id: string | null; intraop_schema_id: string | null; proms_default: string[]; default_protocol_code: string | null; children?: Pathology[];
}
export type Labels = Record<string, Record<string, string>>;

interface Ref {
  labels: Labels;
  pathologies: Pathology[]; // raízes com children
  byCode: Map<string, Pathology>;
  structures: Record<'shoulder' | 'elbow', Record<string, string>>;
  schema(id: string): Promise<any>;
}

const Ctx = createContext<Ref | null>(null);
const schemaCache = new Map<string, Promise<any>>();

export function RefProvider({ children }: { children: ReactNode }) {
  const [ref, setRef] = useState<Ref | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    Promise.all([api.get<Labels>('/api/labels'), api.get<Pathology[]>('/api/pathologies'), api.get('/api/arthro-structures/shoulder'), api.get('/api/arthro-structures/elbow')])
      .then(([labels, roots, sh, el]) => {
        const byCode = new Map<string, Pathology>();
        for (const r of roots) { byCode.set(r.code, r); for (const c of r.children ?? []) byCode.set(c.code, c); }
        setRef({
          labels, pathologies: roots, byCode, structures: { shoulder: sh, elbow: el },
          schema(id) {
            if (!schemaCache.has(id)) schemaCache.set(id, api.get(`/api/schemas/${encodeURIComponent(id)}`));
            return schemaCache.get(id)!;
          }
        });
      })
      .catch((e) => setErr(String(e.message ?? e)));
  }, []);
  if (err) return <div className="page"><div className="alert error">Falha ao carregar dados de referência: {err}</div></div>;
  if (!ref) return <div className="page"><div className="spinner" aria-label="Carregando" /></div>;
  return <Ctx.Provider value={ref}>{children}</Ctx.Provider>;
}

export function useReference(): Ref {
  const c = useContext(Ctx);
  if (!c) throw new Error('RefProvider ausente');
  return c;
}

/** Rótulo de valor de enum (mesma regra do motor de relatório). */
export function valueLabel(labels: Labels, field: string, v: unknown): string {
  const s = String(v);
  return labels[field]?.[s] ?? labels._default?.[s] ?? s;
}
export function fieldLabel(labels: Labels, field: string, schema?: any): string {
  return schema?.['x-label'] ?? labels._fields?.[field] ?? field;
}

export const REGION_PT = { shoulder: 'Ombro', elbow: 'Cotovelo' } as const;
export const SIDE_PT = { R: 'Direito', L: 'Esquerdo' } as const;
export const STATUS_PT: Record<string, string> = {
  open: 'Aberto', surgical: 'Cirúrgico', conservative: 'Conservador', closed: 'Encerrado',
  draft: 'Rascunho', completed: 'Concluída', signed: 'Assinada', amended: 'Corrigida'
};
export const MECHANISM_PT: Record<string, string> = {
  traumatic: 'Traumático', degenerative: 'Degenerativo', acute_on_chronic: 'Agudo sobre crônico', overuse: 'Sobrecarga', unknown: 'Desconhecido'
};
export const TIMEPOINT_PT: Record<string, string> = { preop: 'Pré-op', '6w': '6 semanas', '3m': '3 meses', '6m': '6 meses', '12m': '12 meses', '24m': '24 meses', other: 'Outro' };
