/**
 * Verificação estrutural de uma definição de algoritmo.
 * Roda nos testes sobre todo algoritmo registrado; não depende de conteúdo clínico.
 */
import { camposDe } from './conditions';
import { algorithmKey, hashDefinition } from './hash';
import type { AlgorithmDef, CitRef, Cond, EntradaDef } from './types';

const PMID_RE = /^[1-9][0-9]{0,8}$/;
const DOI_RE = /^10\.\d{4,9}\/\S+$/;
const NIVEIS = ['I', 'II', 'III', 'IV', 'V'];
const TIPOS = ['ECR', 'metanalise', 'revisao_sistematica', 'coorte', 'caso_controle', 'serie_casos', 'biomecanico', 'diretriz', 'consenso', 'opiniao'];

function folhas(c: Cond, out: Extract<Cond, { campo: string }>[] = []): Extract<Cond, { campo: string }>[] {
  if ('all' in c) c.all.forEach((x) => folhas(x, out));
  else if ('any' in c) c.any.forEach((x) => folhas(x, out));
  else if ('not' in c) folhas(c.not, out);
  else out.push(c);
  return out;
}

function duplicados(xs: string[]): string[] {
  return [...new Set(xs.filter((x, i) => xs.indexOf(x) !== i))];
}

function checarCond(c: Cond, onde: string, entradas: Map<string, EntradaDef>, issues: string[], params: Set<string>): void {
  for (const f of folhas(c)) {
    const e = entradas.get(f.campo);
    if (!e) {
      issues.push(`${onde}: entrada "${f.campo}" não declarada`);
      continue;
    }
    if ('param' in f) {
      if (!params.has(f.param)) issues.push(`${onde}: parâmetro "${f.param}" não declarado`);
      if (e.def.tipo !== 'numero') issues.push(`${onde}: comparação com parâmetro sobre "${f.campo}" (${e.def.tipo})`);
      continue;
    }
    const t = e.def.tipo;
    const numerica = f.op === '<' || f.op === '<=' || f.op === '>' || f.op === '>=' || f.op === 'entre';
    if (numerica && t !== 'numero') issues.push(`${onde}: comparação numérica sobre "${f.campo}" (${t})`);
    if (f.op === 'contem' && t !== 'lista') issues.push(`${onde}: "contem" sobre "${f.campo}", que não é lista`);
    if (numerica && f.op !== 'entre' && typeof f.valor !== 'number') issues.push(`${onde}: limiar não numérico para "${f.campo}"`);
    if (e.def.tipo === 'enum' || e.def.tipo === 'lista') {
      const permitidos = e.def.valores;
      const comparados = f.op === 'in' ? f.valores : f.op === '==' || f.op === '!=' || f.op === 'contem' ? [f.valor] : [];
      for (const v of comparados) {
        if (!permitidos.includes(v as string)) issues.push(`${onde}: valor "${String(v)}" fora do enum de "${f.campo}"`);
      }
    }
    if (e.def.tipo === 'booleano' && (f.op === '==' || f.op === '!=') && typeof f.valor !== 'boolean') {
      issues.push(`${onde}: "${f.campo}" é booleano, comparado com ${JSON.stringify(f.valor)}`);
    }
  }
}

/** Lista de problemas estruturais (vazia = definição íntegra). `lock` = mapa 'ID@versão' → hash. */
export function validateDefinition(def: AlgorithmDef, lock?: Readonly<Record<string, string>>): string[] {
  const issues: string[] = [];
  const entradas = new Map(def.entradas.map((e) => [e.id, e]));
  const opcoes = new Set(def.opcoes.map((o) => o.id));
  const refs = new Map(def.referencias.map((r) => [r.id, r]));
  const params = new Set((def.parametros ?? []).map((p) => p.id));

  if (!/^\d+\.\d+\.\d+$/.test(def.versao)) issues.push(`versão "${def.versao}" não é semver`);
  for (const [nome, ids] of [
    ['entrada', def.entradas.map((e) => e.id)],
    ['opção', def.opcoes.map((o) => o.id)],
    ['regra', def.regras.map((r) => r.id)],
    ['referência', def.referencias.map((r) => r.id)],
    ['escopo', def.foraDeEscopo.map((f) => f.id)],
    ['parâmetro', (def.parametros ?? []).map((p) => p.id)],
  ] as const) {
    for (const d of duplicados([...ids])) issues.push(`${nome} "${d}" duplicada`);
  }

  // Referências: PMID ou DOI válidos, nível e tipo
  for (const r of def.referencias) {
    if (!r.pmid && !r.doi) issues.push(`referência ${r.id}: sem PMID nem DOI`);
    if (r.pmid !== undefined && !PMID_RE.test(r.pmid)) issues.push(`referência ${r.id}: PMID inválido "${r.pmid}"`);
    if (r.doi !== undefined && !DOI_RE.test(r.doi)) issues.push(`referência ${r.id}: DOI inválido "${r.doi}"`);
    if (!NIVEIS.includes(r.nivel)) issues.push(`referência ${r.id}: nível de evidência ausente ou inválido`);
    if (!TIPOS.includes(r.tipo)) issues.push(`referência ${r.id}: tipo de estudo ausente ou inválido`);
    if (!r.citacao?.trim()) issues.push(`referência ${r.id}: sem citação`);
  }
  const checarCits = (cits: CitRef[], onde: string) => {
    for (const c of cits) if (!refs.has(c.ref)) issues.push(`${onde}: referência "${c.ref}" não declarada`);
  };
  checarCits(def.referenciasGerais, 'referências gerais');

  // Entradas
  for (const e of def.entradas) {
    if (e.def.tipo === 'numero' && e.def.min !== undefined && e.def.max !== undefined && e.def.min > e.def.max) {
      issues.push(`entrada ${e.id}: min > max`);
    }
    if ((e.def.tipo === 'enum' || e.def.tipo === 'lista') && e.def.valores.length === 0) issues.push(`entrada ${e.id}: enum vazio`);
    if (e.origem.de === 'derivada') {
      for (const d of e.origem.dependeDe) if (!entradas.has(d)) issues.push(`entrada ${e.id}: depende de "${d}" não declarada`);
    }
  }

  // Parâmetros: padrão dentro da faixa, nota e referência
  for (const p of def.parametros ?? []) {
    const onde = `parâmetro ${p.id}`;
    if (!Number.isFinite(p.padrao)) issues.push(`${onde}: padrão não numérico`);
    if (p.inteiro && !Number.isInteger(p.padrao)) issues.push(`${onde}: padrão não inteiro`);
    if (p.min !== undefined && p.padrao < p.min) issues.push(`${onde}: padrão abaixo do mínimo`);
    if (p.max !== undefined && p.padrao > p.max) issues.push(`${onde}: padrão acima do máximo`);
    if (!p.nota.trim()) issues.push(`${onde}: sem nota`);
    if (p.referencias.length === 0) issues.push(`${onde}: sem referência`);
    checarCits(p.referencias, onde);
    if (entradas.has(p.id)) issues.push(`${onde}: mesmo id de uma entrada`);
  }

  for (const f of def.foraDeEscopo) checarCond(f.quando, `escopo ${f.id}`, entradas, issues, params);

  // Regras
  for (const r of def.regras) {
    const onde = `regra ${r.id}`;
    checarCond(r.quando, onde, entradas, issues, params);
    if (r.referencias.length === 0) issues.push(`${onde}: sem referência`);
    checarCits(r.referencias, onde);
    const citadas = r.referencias.map((c) => refs.get(c.ref)).filter((x) => x !== undefined);
    if (r.referencias.length > 0 && !citadas.some((x) => (x.pmid || x.doi) && x.nivel)) {
      issues.push(`${onde}: nenhuma referência com PMID/DOI e nível de evidência`);
    }
    if (r.aviso && r.efeitos.length > 0) issues.push(`${onde}: regra de aviso não deve ter efeitos em opções`);
    if (!r.aviso && r.efeitos.length === 0) issues.push(`${onde}: regra sem efeitos e sem aviso`);
    for (const e of r.efeitos) if (!opcoes.has(e.opcao)) issues.push(`${onde}: opção "${e.opcao}" não declarada`);
    if (r.efeitos.some((e) => e.forca === 'forte')) {
      const sustenta = citadas.some((x) => x.nivel === 'I' || x.nivel === 'II' || x.tipo === 'diretriz' || x.tipo === 'consenso');
      if (!sustenta && !r.justificativaForca?.trim()) {
        issues.push(`${onde}: efeito "forte" sem referência nível I/II, diretriz ou consenso, e sem justificativaForca`);
      }
    }
    if (r.controversia) {
      if (!r.controversia.nota.trim()) issues.push(`${onde}: controvérsia sem nota`);
      if (r.controversia.alternativas.length === 0) issues.push(`${onde}: controvérsia sem alternativas`);
      for (const a of r.controversia.alternativas) {
        if (!opcoes.has(a.opcao)) issues.push(`${onde}: alternativa com opção "${a.opcao}" não declarada`);
        if (a.referencias.length === 0) issues.push(`${onde}: alternativa "${a.opcao}" sem referência`);
        checarCits(a.referencias, `${onde} (alternativa ${a.opcao})`);
      }
    }
    for (const m of r.motivo.matchAll(/\{([A-Za-z0-9_]+)\}/g)) {
      if (!entradas.has(m[1])) issues.push(`${onde}: motivo interpola "${m[1]}", não declarada`);
    }
  }

  if (lock) {
    const key = algorithmKey(def);
    const esperado = lock[key];
    const atual = hashDefinition(def);
    if (!esperado) issues.push(`${key}: ausente do versions.lock.json`);
    else if (esperado !== atual) issues.push(`${key}: conteúdo mudou sem mudar a versão (lock ${esperado.slice(0, 12)}…, atual ${atual.slice(0, 12)}…)`);
  }
  return issues;
}

/** Entradas lidas por regras e critérios de escopo. */
export function entradasUsadas(def: AlgorithmDef): string[] {
  const out: string[] = [];
  for (const f of def.foraDeEscopo) camposDe(f.quando, out);
  for (const r of def.regras) camposDe(r.quando, out);
  return out;
}
