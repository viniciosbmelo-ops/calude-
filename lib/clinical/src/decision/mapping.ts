/**
 * Montagem da entrada do motor no SERVIDOR a partir do registro cirúrgico.
 *
 * Cada algoritmo registrado pode expor um mapeador (payload clínico + paciente → entrada). O mapeador
 * fica AO LADO da definição no registro, fora do conteúdo com hash: mudar o mapeamento não muda a versão
 * aprovada, e mudar a definição exige nova versão e novo lock.
 *
 * Regra de mescla: o valor do registro (payload, paciente ou derivado dele) prevalece; o valor manual só
 * preenche entradas que o registro não trouxe. Divergência entre manual e registro vira `conflito`.
 */
import type { ClinicalPayload } from '../surgery/payload';
import type { AlgorithmDef, Proveniencia } from './types';

export interface ProvenienciaEntrada {
  de: Proveniencia;
  /** Caminho no payload, campo do paciente ou função derivada. */
  caminho?: string;
  nota?: string;
}

export interface ConflitoMapeamento {
  entrada: string;
  /** Valor usado e de onde veio. */
  usado: unknown;
  origemUsada: Proveniencia;
  /** Valor descartado e de onde vinha. */
  descartado: unknown;
  origemDescartada: Proveniencia;
}

/** Dados do registro disponíveis para o mapeador. */
export interface ContextoMapeamento {
  payload: Pick<ClinicalPayload, 'avaliacaoPreop'> & Partial<Pick<ClinicalPayload, 'geral' | 'procedimentos'>>;
  /** Data de nascimento do paciente (AAAA-MM-DD). */
  dataNascimento?: string | null;
  /** Data de referência para a idade (AAAA-MM-DD). Padrão: avaliacaoPreop.comum.data_avaliacao. */
  dataReferencia?: string | null;
  /** Lado da cirurgia (coluna da cirurgia: 'Direito' | 'Esquerdo'). */
  lado?: string | null;
  /** Valores digitados no painel; o mapeador pode usá-los para derivações, nunca acima do registro. */
  manual?: Record<string, unknown>;
}

export interface ResultadoMapeador {
  entrada: Record<string, unknown>;
  proveniencia: Record<string, ProvenienciaEntrada>;
  conflitos?: ConflitoMapeamento[];
}

export type MapeadorEntrada = (ctx: ContextoMapeamento) => ResultadoMapeador;

export interface EntradaMontada {
  entrada: Record<string, unknown>;
  proveniencia: Record<string, ProvenienciaEntrada>;
  conflitos: ConflitoMapeamento[];
}

const DATA_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Idade em anos completos entre duas datas ISO. Data inválida ou ordem invertida → undefined. */
export function idadeEmAnos(nascimento: string | null | undefined, referencia: string | null | undefined): number | undefined {
  const a = nascimento ? DATA_RE.exec(nascimento) : null;
  const b = referencia ? DATA_RE.exec(referencia) : null;
  if (!a || !b) return undefined;
  const [ya, ma, da] = a.slice(1).map(Number);
  const [yb, mb, db] = b.slice(1).map(Number);
  let idade = yb - ya;
  if (mb < ma || (mb === ma && db < da)) idade--;
  return idade >= 0 ? idade : undefined;
}

/** Data de referência efetiva: a informada ou, na falta, a data da avaliação pré-operatória. */
export function dataReferenciaDe(ctx: Pick<ContextoMapeamento, 'payload' | 'dataReferencia'>): string | undefined {
  const ref = ctx.dataReferencia ?? (ctx.payload.avaliacaoPreop?.comum?.data_avaliacao as string | undefined);
  return typeof ref === 'string' && DATA_RE.test(ref) ? ref : undefined;
}

export function presente(v: unknown): boolean {
  if (v === undefined || v === null) return false;
  if (typeof v === 'string') return v.trim() !== '';
  if (Array.isArray(v)) return v.length > 0;
  return true;
}

function iguais(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Entrada final: registro (via mapeador, quando há contexto) + manual. O manual nunca sobrescreve o
 * registro; cada divergência entra em `conflitos`. Entradas manuais desconhecidas seguem para o motor,
 * que as recusa.
 */
export function montarEntrada(
  def: Pick<AlgorithmDef, 'entradas'>,
  mapear: MapeadorEntrada | undefined,
  ctx: Omit<ContextoMapeamento, 'manual'> | undefined,
  manual: Record<string, unknown> = {},
): EntradaMontada {
  // O mapeador recebe só o manual de entradas não derivadas: o que ele deriva do registro prevalece.
  const naoDerivadas = new Set(def.entradas.filter((e) => e.origem.de !== 'derivada').map((e) => e.id));
  const manualDeclarado = Object.fromEntries(Object.entries(manual).filter(([k, v]) => naoDerivadas.has(k) && presente(v)));
  const base: ResultadoMapeador = ctx && mapear ? mapear({ ...ctx, manual: manualDeclarado }) : { entrada: {}, proveniencia: {} };

  const entrada: Record<string, unknown> = { ...base.entrada };
  const proveniencia: Record<string, ProvenienciaEntrada> = { ...base.proveniencia };
  const conflitos: ConflitoMapeamento[] = [...(base.conflitos ?? [])];
  const jaRegistrado = (id: string, origem: Proveniencia) =>
    conflitos.some((c) => c.entrada === id && c.origemDescartada === origem);

  for (const [k, v] of Object.entries(manual)) {
    if (!presente(v)) continue;
    if (!(k in entrada)) {
      entrada[k] = v;
      proveniencia[k] = { de: 'manual' };
      continue;
    }
    const origemUsada = proveniencia[k]?.de ?? 'manual';
    if (origemUsada !== 'manual' && !iguais(entrada[k], v) && !jaRegistrado(k, 'manual')) {
      conflitos.push({ entrada: k, usado: entrada[k], origemUsada, descartado: v, origemDescartada: 'manual' });
    }
  }
  return { entrada, proveniencia, conflitos };
}
