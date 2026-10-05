/**
 * Anonimização do histórico do apoio à decisão: lista de campos derivada das definições e limpeza de uma execução.
 */
import { describe, expect, test } from 'vitest';
import {
  CAMPOS_PERFIL_PACIENTE, CAMPOS_PERFIL_PACIENTE_POR_ALGORITMO, TEXTO_ANONIMIZADO, anonimizarExecucao, camposPerfilPaciente,
} from '../../src/decision/anonimizacao';
import { decisionRegistry } from '../../src/decision/registry';
import { evaluate } from '../../src/decision/engine';

const DBR = decisionRegistry.list().find((a) => a.def.id === 'EL_DBR_APOIO')!;

describe('campos do perfil do paciente', () => {
  test('derivados das definições (origem paciente ou derivada de paciente.*) + idade', () => {
    expect(CAMPOS_PERFIL_PACIENTE).toEqual(
      ['demanda_funcional', 'diabetes', 'idade', 'membro_dominante', 'nivel_atividade', 'tabagismo'],
    );
    expect(CAMPOS_PERFIL_PACIENTE_POR_ALGORITMO['EL_DBR_APOIO']).toEqual(
      ['demanda_funcional', 'diabetes', 'idade', 'membro_dominante', 'tabagismo'],
    );
    // Na fratura do úmero proximal a demanda funcional é manual: não sai.
    expect(CAMPOS_PERFIL_PACIENTE_POR_ALGORITMO['FX_UMERO_PROXIMAL']).toEqual(['idade']);
    for (const campos of Object.values(CAMPOS_PERFIL_PACIENTE_POR_ALGORITMO)) expect(campos).toContain('idade');
  });

  test('algoritmo desconhecido usa a união; proveniência gravada "paciente" também entra', () => {
    expect(camposPerfilPaciente('ALGORITMO_ANTIGO')).toEqual([...CAMPOS_PERFIL_PACIENTE]);
    expect(camposPerfilPaciente('FX_UMERO_PROXIMAL', { lado_dominante: { de: 'paciente', caminho: 'paciente.ladoDominante' }, x: { de: 'manual' } }))
      .toEqual(['idade', 'lado_dominante']);
  });
});

describe('anonimizarExecucao', () => {
  const entrada = {
    tipo_ruptura: 'completa', dias_desde_lesao: 5, idade: 70, tabagismo: 'atual', diabetes: true,
    membro_dominante: true, demanda_funcional: 'alta', dpoc: true,
  };
  const resultado = evaluate(DBR.def, entrada, { hash: DBR.hash, status: 'ativo' });
  const proveniencia = Object.fromEntries(Object.keys(resultado.entrada).map((k) => [k, { de: k === 'idade' || k === 'tabagismo' || k === 'diabetes' ? 'paciente' : 'manual' }]));
  const conflitos = [
    { entrada: 'tabagismo', usado: 'atual', origemUsada: 'paciente', descartado: 'nunca', origemDescartada: 'manual' },
    { entrada: 'dias_desde_lesao', usado: 5, origemUsada: 'payload', descartado: 9, origemDescartada: 'manual' },
  ];
  const exec = {
    algoritmoId: DBR.def.id, algoritmoVersao: DBR.def.versao, algoritmoHash: DBR.hash,
    entrada: resultado.entrada, proveniencia, conflitos, resultado,
  };
  const em = new Date('2026-10-05T12:00:00Z');
  const r = anonimizarExecucao(exec, em);
  const removidos = ['demanda_funcional', 'diabetes', 'idade', 'membro_dominante', 'tabagismo'];

  test('remove o perfil da entrada, da proveniência, dos conflitos e do snapshot/trace do resultado', () => {
    for (const c of removidos) {
      expect(r.entrada).not.toHaveProperty(c);
      expect(r.proveniencia).not.toHaveProperty(c);
      expect(r.resultado['entrada']).not.toHaveProperty(c);
    }
    expect(r.entrada).toMatchObject({ tipo_ruptura: 'completa', dias_desde_lesao: 5, dpoc: true });
    expect(r.conflitos).toEqual([conflitos[1]]);
    const trace = r.resultado['trace'] as { valores: Record<string, unknown> }[];
    expect(trace.length).toBe(resultado.trace.length);
    for (const t of trace) for (const c of removidos) expect(t.valores).not.toHaveProperty(c);
    expect(JSON.stringify(r)).not.toContain('70 anos');
    expect(r.camposRemovidos).toEqual(removidos);
  });

  test('mantém opções, forças, algoritmo e marca o resultado', () => {
    const op = (x: unknown) => (x as typeof resultado.opcoes).map((o) => ({ opcao: o.opcao, forca: o.forca, sentido: o.sentido }));
    expect(op(r.resultado['opcoes'])).toEqual(op(resultado.opcoes));
    expect(r.resultado['algoritmo']).toEqual(resultado.algoritmo);
    expect(r.resultado['motor']).toBe(resultado.motor);
    expect(r.resultado).toMatchObject({ anonimizado: true, anonimizadoEm: em.toISOString(), camposRemovidos: removidos });
  });

  test('texto interpolado com a idade é reescrito pela definição; os demais ficam iguais', () => {
    const antes = resultado.avisos.find((a) => a.regra === 'DBR.A2.IDADE')!;
    expect(antes.texto).toContain('Idade 70 anos');
    const depois = (r.resultado['avisos'] as typeof resultado.avisos).find((a) => a.regra === 'DBR.A2.IDADE')!;
    expect(depois.texto).toContain(`Idade ${TEXTO_ANONIMIZADO}:`);
    const outro = (r.resultado['avisos'] as typeof resultado.avisos).find((a) => a.regra === 'DBR.A2.DPOC');
    expect(outro?.texto).toBe(resultado.avisos.find((a) => a.regra === 'DBR.A2.DPOC')?.texto);
  });

  test('sem a definição (hash diferente) o texto que usou campo removido é substituído; idempotente', () => {
    const s = anonimizarExecucao({ ...exec, algoritmoHash: 'outro' }, em);
    const aviso = (s.resultado['avisos'] as typeof resultado.avisos).find((a) => a.regra === 'DBR.A2.IDADE')!;
    expect(aviso.texto).toBe(TEXTO_ANONIMIZADO);
    const de2 = anonimizarExecucao({ ...exec, ...r }, new Date('2027-01-01T00:00:00Z'));
    expect(de2.resultado).toEqual(r.resultado);
  });
});
