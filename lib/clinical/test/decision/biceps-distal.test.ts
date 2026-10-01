/** Algoritmo de apoio à decisão: ruptura do tendão distal do bíceps (rascunho). */
import { describe, expect, test } from 'vitest';
import { ClinicalGuardError } from '../../src/errors';
import { evaluate } from '../../src/decision/engine';
import { validateDefinition } from '../../src/decision/validate';
import { camposDe } from '../../src/decision/conditions';
import type { AlgorithmDef, ContextoAvaliacao, ResultadoApoio } from '../../src/decision/types';
import {
  BICEPS_DISTAL, LIMIAR_CRONICA_PARAM, mapearEntradaBicepsDistal,
} from '../../src/decision/algorithms/biceps-distal';
import { clone } from './fixtures';

const def = BICEPS_DISTAL;
const run = (e: Record<string, unknown>, ctx: ContextoAvaliacao = {}) => evaluate(def, e, ctx);
const tr = (r: ResultadoApoio, id: string) => r.trace.find((t) => t.regra === id)!.resultado;
const disparou = (r: ResultadoApoio) => r.trace.filter((t) => t.resultado === 'disparou').map((t) => t.regra);
const op = (r: ResultadoApoio, id: string) => r.opcoes.find((o) => o.opcao === id);
const aviso = (r: ResultadoApoio, id: string) => r.avisos.find((a) => a.regra === id);

const agudaAlta = { tipo_ruptura: 'completa', dias_desde_lesao: 10, demanda_funcional: 'alta', prioridade_supinacao: 'alta', hook_test: 'anormal' };

const GRAY_ZONES: { regra: string; entrada: Record<string, unknown>; opcoes: string[] }[] = [
  { regra: 'DBR.A1.ZC_BAIXA_DEMANDA', entrada: { tipo_ruptura: 'completa', dias_desde_lesao: 5, demanda_funcional: 'baixa', prioridade_supinacao: 'baixa' }, opcoes: ['reparo_anatomico', 'nao_operatorio'] },
  { regra: 'DBR.A3.VIA', entrada: { tipo_ruptura: 'completa' }, opcoes: ['incisao_unica', 'incisao_dupla'] },
  { regra: 'DBR.A5.PROFILAXIA_OH', entrada: { via_planejada: 'dupla' }, opcoes: ['profilaxia_oh_aine', 'sem_profilaxia_oh'] },
  { regra: 'DBR.B2.TECNICA', entrada: { tipo_ruptura: 'completa', dias_desde_lesao: 60 }, opcoes: ['reparo_alta_flexao', 'aumento_lacerto', 'aloenxerto', 'autoenxerto'] },
  { regra: 'DBR.C2.TRATAMENTO', entrada: { tipo_ruptura: 'parcial' }, opcoes: ['nao_operatorio_inicial', 'reparo_parcial'] },
  { regra: 'DBR.D1.REABILITACAO', entrada: { tipo_ruptura: 'completa' }, opcoes: ['imobilizacao_inicial', 'mobilizacao_precoce'] },
];

describe('estrutura', () => {
  test('validateDefinition não aponta problemas', () => {
    expect(validateDefinition(def)).toEqual([]);
  });

  test('rascunho: status padrão e nenhum efeito "forte"', () => {
    expect(run({}).algoritmo.status).toBe('rascunho');
    for (const r of def.regras) for (const e of r.efeitos) expect(e.forca, r.id).not.toBe('forte');
  });

  test('toda regra cita referência com PMID/DOI e nível de evidência', () => {
    const refs = new Map(def.referencias.map((r) => [r.id, r]));
    for (const r of def.regras) {
      const citadas = [...r.referencias, ...(r.controversia?.alternativas.flatMap((a) => a.referencias) ?? [])];
      expect(citadas.length, r.id).toBeGreaterThan(0);
      for (const c of citadas) {
        const ref = refs.get(c.ref);
        expect(ref, `${r.id}: ${c.ref}`).toBeDefined();
        expect(Boolean(ref!.pmid || ref!.doi), c.ref).toBe(true);
        expect(ref!.nivel).toMatch(/^(I|II|III|IV|V)$/);
      }
    }
  });

  test('nenhuma dose de medicamento no conteúdo', () => {
    const txt = JSON.stringify(def);
    expect(txt).not.toMatch(/\d+\s*mg\b/i);
    expect(txt).not.toMatch(/mg\/(dia|kg)/i);
  });

  test('toda zona cinzenta é regra com controvérsia e ≥2 alternativas', () => {
    for (const gz of GRAY_ZONES) {
      const r = def.regras.find((x) => x.id === gz.regra)!;
      expect(r.controversia, gz.regra).toBeDefined();
      expect(r.controversia!.alternativas.map((a) => a.opcao).sort()).toEqual([...gz.opcoes].sort());
    }
  });

  test('parâmetro do corte crônico: padrão 21 dias, pendente de decisão do cirurgião', () => {
    const p = def.parametros!.find((x) => x.id === LIMIAR_CRONICA_PARAM)!;
    expect(p.padrao).toBe(21);
    expect(p.status).toBe('pendente_decisao_cirurgiao');
    expect([p.min, p.max]).toEqual([21, 41]);
  });

  test('validateDefinition detecta parâmetro não declarado', () => {
    const d: AlgorithmDef = clone(def);
    d.parametros = [];
    expect(validateDefinition(d).some((i) => i.includes(`parâmetro "${LIMIAR_CRONICA_PARAM}" não declarado`))).toBe(true);
  });
});

describe('ramos (casos de ouro)', () => {
  test('completa aguda + alta demanda → reinserção anatômica favorecida (moderada) e via em controvérsia', () => {
    const r = run(agudaAlta);
    expect(op(r, 'reparo_anatomico')).toMatchObject({ forca: 'moderada', sentido: 'favorece' });
    expect(op(r, 'incisao_unica')!.forca).toBe('controversa');
    expect(op(r, 'incisao_dupla')!.forca).toBe('controversa');
    expect(op(r, 'nao_operatorio')).toBeUndefined();
    expect(tr(r, 'DBR.B2.TECNICA')).toBe('nao_disparou');
    expect(aviso(r, 'DBR.N1.HOOK_ANORMAL')).toBeDefined();
    expect(r.opcoes.every((o) => o.forca !== 'forte')).toBe(true);
  });

  test('prioridade de supinação alta basta mesmo com demanda desconhecida (any com verdadeiro)', () => {
    const r = run({ tipo_ruptura: 'completa', dias_desde_lesao: 10, prioridade_supinacao: 'alta' });
    expect(tr(r, 'DBR.A1.OPERATORIO')).toBe('disparou');
  });

  test('completa aguda + baixa demanda + déficit aceito → não operatório presente, mas em controvérsia com o reparo', () => {
    const r = run({ tipo_ruptura: 'completa', dias_desde_lesao: 7, demanda_funcional: 'baixa', prioridade_supinacao: 'baixa', aceita_deficit_supinacao: true });
    expect(tr(r, 'DBR.A1.NAO_OPERATORIO')).toBe('disparou');
    expect(tr(r, 'DBR.A1.ZC_BAIXA_DEMANDA')).toBe('disparou');
    expect(tr(r, 'DBR.A1.OPERATORIO')).toBe('nao_disparou');
    expect(op(r, 'nao_operatorio')!.forca).toBe('controversa');
    expect(op(r, 'reparo_anatomico')!.forca).toBe('controversa');
  });

  test('completa crônica → técnica (4 alternativas), expectativa e não operatório informativo; sem regras de A1', () => {
    const r = run({ tipo_ruptura: 'completa', dias_desde_lesao: 60, demanda_funcional: 'alta', hook_test: 'anormal', lacerto_fibroso: 'roto' });
    expect(tr(r, 'DBR.A1.OPERATORIO')).toBe('nao_disparou');
    for (const o of ['reparo_alta_flexao', 'aumento_lacerto', 'aloenxerto', 'autoenxerto']) expect(op(r, o)!.forca).toBe('controversa');
    expect(op(r, 'planejar_enxerto')).toMatchObject({ forca: 'fraca', sentido: 'favorece' });
    for (const a of ['DBR.B1.EXPECTATIVA', 'DBR.B3.NAO_OPERATORIO', 'DBR.B2.LACERTO_ROTO']) expect(aviso(r, a), a).toBeDefined();
  });

  test('enxerto: hook anormal com 55 dias não dispara; com 56 dispara', () => {
    const base = { tipo_ruptura: 'completa', hook_test: 'anormal' };
    expect(tr(run({ ...base, dias_desde_lesao: 55 }), 'DBR.B1.ENXERTO_HOOK_ANORMAL')).toBe('nao_disparou');
    expect(tr(run({ ...base, dias_desde_lesao: 56 }), 'DBR.B1.ENXERTO_HOOK_ANORMAL')).toBe('disparou');
  });

  test('hook normal → RM favorecida (fraca); com lacerto íntegro → aviso de sensibilidade 45%', () => {
    const r = run({ hook_test: 'normal', lacerto_fibroso: 'integro' });
    expect(op(r, 'complementar_rm')).toMatchObject({ forca: 'fraca', sentido: 'favorece' });
    expect(aviso(r, 'DBR.N1.LACERTO_INTEGRO')!.texto).toContain('45%');
    expect(aviso(run({ hook_test: 'normal_doloroso' }), 'DBR.N1.HOOK_DOLOROSO')).toBeDefined();
  });

  test('parcial >50% → reparo em controvérsia; <50% → não operatório inicial em controvérsia; 50% exato não dispara nenhum', () => {
    const acima = run({ tipo_ruptura: 'parcial', pct_ruptura_parcial_rm: 70 });
    expect(tr(acima, 'DBR.C2.PCT_ACIMA_50')).toBe('disparou');
    expect(op(acima, 'reparo_parcial')!.forca).toBe('controversa');
    const abaixo = run({ tipo_ruptura: 'parcial', pct_ruptura_parcial_rm: 30 });
    expect(tr(abaixo, 'DBR.C2.PCT_ABAIXO_50')).toBe('disparou');
    expect(op(abaixo, 'nao_operatorio_inicial')!.forca).toBe('controversa');
    const cinquenta = run({ tipo_ruptura: 'parcial', pct_ruptura_parcial_rm: 50 });
    expect(tr(cinquenta, 'DBR.C2.PCT_ACIMA_50')).toBe('nao_disparou');
    expect(tr(cinquenta, 'DBR.C2.PCT_ABAIXO_50')).toBe('nao_disparou');
  });

  test('parcial com demanda alta/baixa acrescenta motivos, mas a zona cinzenta mantém controvérsia', () => {
    const alta = run({ tipo_ruptura: 'parcial', demanda_funcional: 'alta' });
    expect(op(alta, 'reparo_parcial')!.motivos.map((m) => m.regra)).toContain('DBR.C2.DEMANDA_ALTA');
    expect(op(alta, 'reparo_parcial')!.forca).toBe('controversa');
    const baixa = run({ tipo_ruptura: 'parcial', demanda_funcional: 'baixa' });
    expect(op(baixa, 'nao_operatorio_inicial')!.motivos.map((m) => m.regra)).toContain('DBR.C2.DEMANDA_BAIXA');
  });

  test('modificadores (A2) são avisos e não mexem nas opções', () => {
    const r = run({ ...agudaAlta, idade: 70, dpoc: true, obesidade_classe: 'II', diabetes: true, tabagismo: 'ex' });
    for (const a of ['DBR.A2.IDADE', 'DBR.A2.DPOC', 'DBR.A2.OBESIDADE_II', 'DBR.A2.DIABETES', 'DBR.A2.EX_TABAGISTA']) expect(aviso(r, a), a).toBeDefined();
    expect(aviso(r, 'DBR.A2.IDADE')!.texto).toContain('70 anos');
    expect(op(r, 'reparo_anatomico')!.motivos.map((m) => m.regra)).toEqual(['DBR.A1.OPERATORIO']);
    // obesidade III e tabagismo atual: sem dado verificado na spec
    const r2 = run({ ...agudaAlta, obesidade_classe: 'III', tabagismo: 'atual' });
    expect(tr(r2, 'DBR.A2.OBESIDADE_II')).toBe('nao_disparou');
    expect(tr(r2, 'DBR.A2.EX_TABAGISTA')).toBe('nao_disparou');
  });

  test('via dupla com restrição a AINE → aviso de cautela, sem dose', () => {
    const r = run({ via_planejada: 'dupla', restricao_aine: true });
    expect(aviso(r, 'DBR.A5.RESTRICAO_AINE')).toBeDefined();
    expect(JSON.stringify(r.opcoes)).not.toMatch(/\bmg\b/);
    expect(tr(run({ via_planejada: 'unica' }), 'DBR.A5.PROFILAXIA_OH')).toBe('nao_disparou');
  });

  test('tendinopatia fica fora do escopo', () => {
    const r = run({ tipo_ruptura: 'tendinopatia' });
    expect(r.foraDeEscopo.map((f) => f.id)).toEqual(['DBR.ESC.TENDINOPATIA']);
    expect(r.opcoes).toEqual([]);
  });
});

describe('parâmetro do corte crônico', () => {
  const e = { tipo_ruptura: 'completa', demanda_funcional: 'alta' };

  test('padrão 21: 21 dias = aguda; 22 dias = crônica', () => {
    const d21 = run({ ...e, dias_desde_lesao: 21 });
    expect(tr(d21, 'DBR.A1.OPERATORIO')).toBe('disparou');
    expect(tr(d21, 'DBR.B2.TECNICA')).toBe('nao_disparou');
    const d22 = run({ ...e, dias_desde_lesao: 22 });
    expect(tr(d22, 'DBR.A1.OPERATORIO')).toBe('nao_disparou');
    expect(tr(d22, 'DBR.B2.TECNICA')).toBe('disparou');
    expect(d22.parametros).toEqual([expect.objectContaining({ id: LIMIAR_CRONICA_PARAM, valor: 21, origem: 'padrao', status: 'pendente_decisao_cirurgiao' })]);
  });

  test('cirurgião configura 41 (≥6 semanas): 30 dias volta a ser aguda; 42 dias é crônica', () => {
    const ctx = { parametros: { [LIMIAR_CRONICA_PARAM]: 41 } };
    const d30 = run({ ...e, dias_desde_lesao: 30 }, ctx);
    expect(tr(d30, 'DBR.A1.OPERATORIO')).toBe('disparou');
    expect(tr(d30, 'DBR.B2.TECNICA')).toBe('nao_disparou');
    expect(d30.parametros![0]).toMatchObject({ valor: 41, origem: 'contexto' });
    const d42 = run({ ...e, dias_desde_lesao: 42 }, ctx);
    expect(tr(d42, 'DBR.B2.TECNICA')).toBe('disparou');
  });

  test('o mesmo caso muda de ramo conforme o parâmetro (28 × padrão)', () => {
    const entrada = { ...e, dias_desde_lesao: 25 };
    expect(tr(run(entrada), 'DBR.B2.TECNICA')).toBe('disparou');
    expect(tr(run(entrada, { parametros: { [LIMIAR_CRONICA_PARAM]: 28 } }), 'DBR.B2.TECNICA')).toBe('nao_disparou');
  });

  test('parâmetro fora da faixa, não inteiro ou desconhecido → ClinicalGuardError', () => {
    expect(() => run(e, { parametros: { [LIMIAR_CRONICA_PARAM]: 14 } })).toThrow(ClinicalGuardError);
    expect(() => run(e, { parametros: { [LIMIAR_CRONICA_PARAM]: 60 } })).toThrow(ClinicalGuardError);
    expect(() => run(e, { parametros: { [LIMIAR_CRONICA_PARAM]: 25.5 } })).toThrow(ClinicalGuardError);
    expect(() => run(e, { parametros: { outro: 1 } })).toThrow(ClinicalGuardError);
  });

  test('sem dias: ramos A e B ficam indeterminados, e os dias aparecem como faltantes', () => {
    const r = run(e);
    expect(tr(r, 'DBR.A1.OPERATORIO')).toBe('indeterminada');
    expect(tr(r, 'DBR.B2.TECNICA')).toBe('indeterminada');
    expect(r.faltantes.map((f) => f.entrada)).toContain('dias_desde_lesao');
  });
});

describe('zonas cinzentas', () => {
  test.each(GRAY_ZONES)('$regra → opções controversas com alternativas', ({ regra, entrada, opcoes }) => {
    const r = run(entrada);
    expect(tr(r, regra)).toBe('disparou');
    for (const o of opcoes) {
      const res = op(r, o)!;
      expect(res.forca, o).toBe('controversa');
      expect(res.sentido, o).toBe('alternativa');
      const c = res.controversias.find((x) => x.regra === regra)!;
      expect(c.alternativas.map((a) => a.opcao).sort()).toEqual([...opcoes].sort());
      for (const a of c.alternativas) expect(a.referencias.length).toBeGreaterThan(0);
    }
  });
});

describe('classificação temporal: informativa, nunca opção de tratamento', () => {
  test('nenhuma opção do algoritmo é uma definição de "crônica"', () => {
    expect(def.opcoes.some((o) => /cr[ôo]nica/i.test(o.rotulo) || o.id.startsWith('def_'))).toBe(false);
    const regra = def.regras.find((x) => x.id === 'DBR.N2.TEMPO')!;
    expect(regra.aviso).toBe(true);
    expect(regra.efeitos).toEqual([]);
  });

  test('10 dias: as três definições concordam (aguda) → sem aviso temporal e sem opções de definição', () => {
    const r = run({ tipo_ruptura: 'completa', dias_desde_lesao: 10 });
    expect(tr(r, 'DBR.N2.TEMPO')).toBe('nao_disparou');
    expect(aviso(r, 'DBR.N2.TEMPO')).toBeUndefined();
    expect(r.opcoes.some((o) => o.opcao.startsWith('def_'))).toBe(false);
  });

  test.each([22, 28, 30, 41])('%i dias: definições divergem → aviso informativo com as três definições', (dias) => {
    const r = run({ tipo_ruptura: 'completa', dias_desde_lesao: dias });
    const a = aviso(r, 'DBR.N2.TEMPO')!;
    expect(a.texto).toContain(`Lesão de ${dias} dias`);
    for (const d of ['>21 dias', '>4 semanas', '≥6 semanas']) expect(a.texto).toContain(d);
    expect(a.referencias).toEqual(expect.arrayContaining(['Kelly2000', 'Greco2026', 'Schmidt2022']));
    expect(r.opcoes.some((o) => o.opcao.startsWith('def_'))).toBe(false);
  });

  test.each([0, 21, 42, 90])('%i dias: no corte mais curto ou a partir do mais longo, as definições concordam → sem aviso', (dias) => {
    expect(tr(run({ tipo_ruptura: 'completa', dias_desde_lesao: dias }), 'DBR.N2.TEMPO')).toBe('nao_disparou');
  });

  test('ruptura parcial ou dias ausentes: sem aviso temporal', () => {
    expect(tr(run({ tipo_ruptura: 'parcial', dias_desde_lesao: 30 }), 'DBR.N2.TEMPO')).toBe('nao_disparou');
    expect(tr(run({ tipo_ruptura: 'completa' }), 'DBR.N2.TEMPO')).toBe('indeterminada');
  });
});

describe('aviso de confiabilidade do % na RM', () => {
  test('aparece em toda parcial e sempre que um % é informado', () => {
    expect(aviso(run({ tipo_ruptura: 'parcial' }), 'DBR.C1.AVISO_RM')!.texto).toContain('κ 0,27');
    expect(aviso(run({ pct_ruptura_parcial_rm: 40 }), 'DBR.C1.AVISO_RM')).toBeDefined();
  });

  test('toda regra que usa o % traz o aviso no próprio motivo', () => {
    const usam = def.regras.filter((r) => !r.aviso && camposDe(r.quando).includes('pct_ruptura_parcial_rm'));
    expect(usam.length).toBeGreaterThan(0);
    for (const r of usam) expect(r.motivo, r.id).toContain('κ 0,27');
    const res = run({ tipo_ruptura: 'parcial', pct_ruptura_parcial_rm: 70 });
    expect(op(res, 'reparo_parcial')!.motivos.find((m) => m.regra === 'DBR.C2.PCT_ACIMA_50')!.texto).toContain('κ 0,27');
  });

  test('completa sem %: o aviso não dispara', () => {
    expect(aviso(run({ tipo_ruptura: 'completa', pct_ruptura_parcial_rm: undefined }), 'DBR.C1.AVISO_RM')).toBeUndefined();
  });
});

describe('entradas ausentes nunca disparam regras', () => {
  test('entrada vazia: nenhuma regra dispara, nenhuma opção, nenhum aviso', () => {
    const r = run({});
    expect(disparou(r)).toEqual([]);
    expect(r.opcoes).toEqual([]);
    expect(r.avisos).toEqual([]);
    expect(r.trace.every((t) => t.resultado === 'indeterminada')).toBe(true);
  });

  test('retirar entradas lidas por uma regra nunca a faz disparar por falta de dado (todas as regras cobertas)', () => {
    const casos: Record<string, unknown>[] = [
      { ...agudaAlta, idade: 70, dpoc: true, obesidade_classe: 'II', diabetes: true, tabagismo: 'ex', retracao_cm: 8, via_planejada: 'dupla', restricao_aine: true, workers_comp: true },
      { tipo_ruptura: 'completa', dias_desde_lesao: 100, hook_test: 'normal', lacerto_fibroso: 'roto', retracao_cm: 8 },
      { tipo_ruptura: 'completa', dias_desde_lesao: 5, demanda_funcional: 'baixa', prioridade_supinacao: 'baixa', aceita_deficit_supinacao: true, hook_test: 'normal_doloroso', lacerto_fibroso: 'integro' },
      { tipo_ruptura: 'parcial', pct_ruptura_parcial_rm: 70, demanda_funcional: 'alta', workers_comp: true },
      { tipo_ruptura: 'parcial', pct_ruptura_parcial_rm: 30, demanda_funcional: 'baixa' },
      { tipo_ruptura: 'completa', dias_desde_lesao: 60, hook_test: 'anormal' },
      { tipo_ruptura: 'completa', dias_desde_lesao: 30 },
    ];
    const cobertas = new Set<string>();
    for (const caso of casos) {
      for (const id of disparou(run(caso))) {
        cobertas.add(id);
        const regra = def.regras.find((x) => x.id === id)!;
        for (const campo of camposDe(regra.quando)) {
          if (!(campo in caso)) continue;
          const sem = { ...caso };
          delete sem[campo];
          const t = run(sem).trace.find((x) => x.regra === id)!;
          // Só pode continuar disparando por outro ramo de um "any", sem ler o campo retirado
          if (t.resultado === 'disparou') {
            expect(JSON.stringify(regra.quando), `${id} sem ${campo}`).toContain('"any"');
            expect(Object.keys(t.valores), `${id} sem ${campo}`).not.toContain(campo);
          }
        }
        const semNenhum = { ...caso };
        for (const campo of camposDe(regra.quando)) delete semNenhum[campo];
        expect(tr(run(semNenhum), id), `${id} sem nenhuma entrada`).not.toBe('disparou');
      }
    }
    expect([...cobertas].sort()).toEqual(def.regras.map((r) => r.id).sort());
  });
});

describe('mapeamento payload → entrada', () => {
  const payload = (dados: Record<string, unknown>, comum: Record<string, unknown> = {}) => ({
    avaliacaoPreop: { comum, patologias: [{ codigo: 'EL_DBR', schema: 'EL_DBR.diagnosis.v1', dados }] },
  });

  test('traduz campos do bloco EL_DBR e comuns, com proveniência', () => {
    const { entrada, proveniencia } = mapearEntradaBicepsDistal(
      payload(
        { dias_desde_lesao_preop: 12, tipo_rm: 'parcial', partial_pct_rm: 60, retracao_cm_rm: 2, lacerto_integro_rm: true, hook_test: false, ocupacao_demanda: 'bracal', necessidade_forca_supinacao: true },
        { tabagismo: 'ex_tabagista', diabetes: false, lado_dominante: 'R', nivel_atividade: 'sedentario' },
      ),
      { idade: 52, lado: 'Direito' },
    );
    expect(entrada).toEqual({
      dias_desde_lesao: 12, tipo_ruptura: 'parcial', hook_test: 'normal', pct_ruptura_parcial_rm: 60, retracao_cm: 2,
      lacerto_fibroso: 'integro', ocupacao: 'manual_pesado', demanda_funcional: 'alta', prioridade_supinacao: 'alta',
      tabagismo: 'ex', diabetes: false, membro_dominante: true, idade: 52,
    });
    expect(proveniencia.dias_desde_lesao).toEqual({ de: 'payload', caminho: 'avaliacaoPreop[EL_DBR].dias_desde_lesao_preop' });
    expect(proveniencia.demanda_funcional.de).toBe('derivada');
    expect(proveniencia.idade.de).toBe('paciente');
    expect(proveniencia.lacerto_fibroso.nota).toContain('RM');
    expect(Object.keys(proveniencia).sort()).toEqual(Object.keys(entrada).sort());
    // a entrada mapeada é aceita pelo motor
    expect(() => run(entrada)).not.toThrow();
  });

  test('dias derivados de data_lesao × data_avaliacao quando o campo de dias falta', () => {
    const { entrada, proveniencia } = mapearEntradaBicepsDistal(payload({ data_lesao: '2026-08-01' }, { data_avaliacao: '2026-09-12' }));
    expect(entrada.dias_desde_lesao).toBe(42);
    expect(proveniencia.dias_desde_lesao.de).toBe('derivada');
  });

  test('data de avaliação anterior à lesão não vira 0: fica ausente', () => {
    const { entrada } = mapearEntradaBicepsDistal(payload({ data_lesao: '2026-09-12' }, { data_avaliacao: '2026-08-01' }));
    expect('dias_desde_lesao' in entrada).toBe(false);
  });

  test('campos ausentes ficam ausentes (nunca 0/false); ambidestro, recreativo e lado desconhecido → sem dado', () => {
    const { entrada, proveniencia } = mapearEntradaBicepsDistal(payload({}, { lado_dominante: 'ambidestro', nivel_atividade: 'recreativo' }), { lado: 'Direito' });
    expect(entrada).toEqual({});
    expect(proveniencia).toEqual({});
    expect(mapearEntradaBicepsDistal({}).entrada).toEqual({});
    expect(mapearEntradaBicepsDistal(payload({}, { lado_dominante: 'R' })).entrada).toEqual({});
  });

  test('demanda: ocupação do bloco EL_DBR tem prioridade sobre o nível de atividade comum', () => {
    expect(mapearEntradaBicepsDistal(payload({ ocupacao_demanda: 'sedentario' }, { nivel_atividade: 'competitivo' })).entrada.demanda_funcional).toBe('baixa');
    const soComum = mapearEntradaBicepsDistal(payload({}, { nivel_atividade: 'competitivo' }));
    expect(soComum.entrada.demanda_funcional).toBe('alta');
    expect(soComum.proveniencia.demanda_funcional.caminho).toBe('avaliacaoPreop.comum.nivel_atividade');
  });

  test('hook_test positivo → anormal; lacerto não íntegro → roto; lado esquerdo não dominante', () => {
    const { entrada } = mapearEntradaBicepsDistal(payload({ hook_test: true, lacerto_integro_rm: false }, { lado_dominante: 'R' }), { lado: 'L' });
    expect(entrada).toMatchObject({ hook_test: 'anormal', lacerto_fibroso: 'roto', membro_dominante: false });
  });

  test('caso completo de ponta a ponta: payload → sugestões', () => {
    const { entrada } = mapearEntradaBicepsDistal(
      payload({ data_lesao: '2026-09-10', tipo_rm: 'completa', hook_test: true, ocupacao_demanda: 'bracal' }, { data_avaliacao: '2026-09-20' }),
    );
    const r = run(entrada);
    expect(op(r, 'reparo_anatomico')).toMatchObject({ forca: 'moderada', sentido: 'favorece' });
    expect(r.rotulo).toBe('Sugestão');
  });
});
