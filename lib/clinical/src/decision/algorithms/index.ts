/**
 * Algoritmos registrados e seus mapeadores (payload clínico + paciente → entrada do motor).
 *
 * O mapeador é exposto pelo registro ao lado da definição, mas fora do conteúdo com hash.
 * Cada adaptador só normaliza a assinatura do mapeamento do algoritmo para `MapeadorEntrada`.
 */
import type { AlgorithmDef, OrigemEntrada } from '../types';
import { dataReferenciaDe, idadeEmAnos, type MapeadorEntrada, type ProvenienciaEntrada } from '../mapping';
import { INSTABILIDADE_ANTERIOR, entradaInstabilidadeAnterior } from './instabilidade-anterior';
import { MANGUITO_ROTADOR, mapearEntradaManguito } from './manguito-rotador';
import { FX_UMERO_PROXIMAL, mapearEntradaFxUmeroProximal, type RespostasManuaisFxUmeroProximal } from './fratura-umero-proximal';
import { BICEPS_DISTAL, mapearEntradaBicepsDistal } from './biceps-distal';

export interface AlgoritmoComMapeador {
  def: AlgorithmDef;
  mapear?: MapeadorEntrada;
}

const idadeDe = (ctx: Parameters<MapeadorEntrada>[0]) => idadeEmAnos(ctx.dataNascimento, dataReferenciaDe(ctx));

const PACIENTE_IDADE: ProvenienciaEntrada = {
  de: 'paciente', caminho: 'paciente.dataNascimento', nota: 'idade em anos completos na data da cirurgia (ou da avaliação pré-operatória)',
};

function deOrigem(o: OrigemEntrada): ProvenienciaEntrada {
  switch (o.de) {
    case 'payload':
    case 'intraop':
      return { de: o.de, caminho: o.caminho };
    case 'paciente':
      return { de: 'paciente', caminho: o.campo };
    case 'derivada':
      return { de: 'derivada', caminho: o.funcao };
    case 'manual':
      return { de: 'manual' };
  }
}

const mapearInstabilidade: MapeadorEntrada = (ctx) => {
  const dataRef = dataReferenciaDe(ctx);
  const r = entradaInstabilidadeAnterior(ctx.payload, {
    ...(ctx.dataNascimento ? { dataNascimento: ctx.dataNascimento } : {}),
    ...(dataRef ? { dataReferencia: dataRef } : {}),
  });
  const caminhos = new Map(INSTABILIDADE_ANTERIOR.entradas.map((e) => [e.id, deOrigem(e.origem)]));
  const proveniencia: Record<string, ProvenienciaEntrada> = {};
  for (const [id, de] of Object.entries(r.proveniencia)) {
    if (id === 'idade') proveniencia[id] = PACIENTE_IDADE;
    else {
      const declarada = caminhos.get(id);
      proveniencia[id] = declarada && declarada.de === de ? declarada : { de };
      if (id === 'gbl_pct' && de === 'payload') proveniencia[id] = { de, caminho: 'avaliacaoPreop[SH_INST_ANT].gbl_pct_direto' };
    }
  }
  const conflitos = r.conflitos.map((c) => ({ ...c, origemUsada: r.proveniencia[c.entrada] ?? 'derivada' }));
  return { entrada: r.entrada, proveniencia, conflitos };
};

const mapearManguito: MapeadorEntrada = (ctx) => {
  const idade = idadeDe(ctx);
  const r = mapearEntradaManguito(ctx.payload, {
    ...(idade !== undefined ? { paciente: { idade } } : {}),
    ...(ctx.manual ? { manual: ctx.manual } : {}),
  });
  const proveniencia: Record<string, ProvenienciaEntrada> = {};
  for (const [id, p] of Object.entries(r.proveniencia)) {
    proveniencia[id] = id === 'idade' ? PACIENTE_IDADE : { de: p.origem, ...(p.caminho ? { caminho: p.caminho } : {}), ...(p.nota ? { nota: p.nota } : {}) };
  }
  return { entrada: r.entrada, proveniencia };
};

const mapearFxUmero: MapeadorEntrada = (ctx) => {
  const idade = idadeDe(ctx);
  const r = mapearEntradaFxUmeroProximal(ctx.payload, {
    ...(idade !== undefined ? { idade } : {}),
    ...(ctx.manual ? { manual: ctx.manual as RespostasManuaisFxUmeroProximal } : {}),
  });
  const proveniencia: Record<string, ProvenienciaEntrada> = {};
  for (const [id, o] of Object.entries(r.proveniencia)) proveniencia[id] = id === 'idade' ? PACIENTE_IDADE : deOrigem(o);
  return { entrada: r.entrada, proveniencia };
};

const mapearBiceps: MapeadorEntrada = (ctx) => {
  const idade = idadeDe(ctx);
  const r = mapearEntradaBicepsDistal(ctx.payload, {
    ...(idade !== undefined ? { idade } : {}),
    ...(ctx.lado ? { lado: ctx.lado } : {}),
  });
  const proveniencia: Record<string, ProvenienciaEntrada> = {};
  for (const [id, p] of Object.entries(r.proveniencia)) proveniencia[id] = id === 'idade' ? PACIENTE_IDADE : p;
  return { entrada: r.entrada, proveniencia };
};

export const ALGORITMOS_REGISTRADOS: readonly AlgoritmoComMapeador[] = [
  { def: INSTABILIDADE_ANTERIOR, mapear: mapearInstabilidade },
  { def: MANGUITO_ROTADOR, mapear: mapearManguito },
  { def: FX_UMERO_PROXIMAL, mapear: mapearFxUmero },
  { def: BICEPS_DISTAL, mapear: mapearBiceps },
];
