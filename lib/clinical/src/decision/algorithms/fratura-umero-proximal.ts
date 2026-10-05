/**
 * Fratura do úmero proximal em adultos: RASCUNHO do apoio à decisão.
 *
 * Fonte única: spec verificada "spec-fratura-umero-proximal.md" v0.1 (28/09/2026), PubMed (resumos).
 * Regras de codificação:
 * - Só entram números marcados como verificados no resumo. Tudo o que a spec marca como
 *   "requer texto completo" fica FORA das regras: detalhes de Neer 1970 (I e II), corte ">2 mm" da
 *   dobradiça de Hertel, limiar da tuberosidade maior de Platzer 2008, limiares de Tingart 2003 e de
 *   Krappinger 2011. Essas medidas são só registradas (entradas sem regra).
 * - "Deslocada" (Neer >1 cm ou >45°) é resposta do cirurgião (ou partes de Neer); nunca é calculada de mm.
 * - Zonas cinzentas (ZC-A…ZC-H) listam alternativas com a mesma força e não escolhem vencedora.
 * - N9 (preditores de isquemia/falha da fixação, DTI) é só informativo: regras de aviso, sem efeito em opções.
 * - Limiares em aberto (spec §7) são PARÂMETROS com o padrão da spec, marcados como pendentes.
 * - Não registrado em registry.ts nem no versions.lock.json nesta fase (rascunho).
 */
import type { ClinicalPayload } from '../../surgery/payload';
import { preopFor } from '../../surgery/payload';
import type { AlgorithmDef, Cond, OrigemEntrada } from '../types';
import { AVISO_NIVEIS_EVIDENCIA } from '../vocab';

export const FX_UMERO_PROXIMAL_CODIGO = 'SH_FX_PROX_HUM';

/** Mensagem fixa do N7 (spec §4): exibida sempre no ramo de adultos ≥ parâmetro de idade, baixa energia, colo cirúrgico deslocado. */
export const MENSAGEM_FIXA_IDOSO =
  'Para a maioria das fraturas deslocadas do úmero proximal em adultos mais velhos, há EVIDÊNCIA DE ALTA CERTEZA '
  + 'de que a cirurgia NÃO produz função melhor que o tratamento não operatório em 1 e 2 anos (Cochrane 2022, '
  + 'PMID 35727196), com resultado mantido em 5 anos (PROFHER, PMID 28249980). A cirurgia pode aumentar '
  + 'reoperações (RR 2,06; GRADE baixo).';

/** Caminho no payload v2 dos campos do schema SH_FX_PROX_HUM.diagnosis.v1. */
const PAYLOAD = `avaliacaoPreop[${FX_UMERO_PROXIMAL_CODIGO}].`;
const doPayload = (campo: string): OrigemEntrada => ({ de: 'payload', caminho: PAYLOAD + campo });
const MANUAL: OrigemEntrada = { de: 'manual' };

// ---- Condições reutilizadas (dados serializáveis) ----
const SEM_LUXACAO: Cond = { campo: 'fratura_luxacao', op: '==', valor: 'nenhuma' };
const COM_LUXACAO: Cond = { campo: 'fratura_luxacao', op: 'in', valores: ['anterior', 'posterior'] };
const SEM_HEAD_SPLIT: Cond = { campo: 'head_split', op: '==', valor: false };
const DESLOCADA: Cond = { campo: 'deslocada', op: '==', valor: true };
const TM_ISOLADA: Cond = {
  all: [{ campo: 'neer_partes', op: '==', valor: 2 }, { campo: 'segmentos_deslocados', op: 'contem', valor: 'tuberosidade_maior' }],
};
const COLO_CIRURGICO: Cond = { campo: 'segmentos_deslocados', op: 'contem', valor: 'colo_cirurgico' };
/** Chegou ao N5: sem luxação, sem head-split, deslocada, não é TM isolada. */
const BASE_N5: Cond = { all: [SEM_LUXACAO, SEM_HEAD_SPLIT, DESLOCADA, { not: TM_ISOLADA }] };
/** N5 "sim": idade ≥ parâmetro E baixa energia. */
const POP_IDOSA: Cond = {
  all: [BASE_N5, { campo: 'idade', op: '>=', param: 'idade_populacao_evidencia' }, { campo: 'mecanismo_energia', op: '==', valor: 'baixa' }],
};
/** N7: população idosa com colo cirúrgico deslocado (população dos ECR). */
const N7: Cond = { all: [POP_IDOSA, COLO_CIRURGICO] };
const N8: Cond = { all: [N7, { campo: 'neer_partes', op: '>=', valor: 3 }] };
/** DelPhi (PMID 31977825): população 65–85 anos, cirurgia já escolhida. */
const DELPHI: Cond = {
  all: [N8, { campo: 'idade', op: '>=', valor: 65 }, { campo: 'idade', op: '<=', valor: 85 }, { campo: 'cirurgia_escolhida', op: '==', valor: true }],
};

export const FX_UMERO_PROXIMAL: AlgorithmDef = {
  id: 'FX_UMERO_PROXIMAL',
  versao: '0.1.2',
  patologias: [FX_UMERO_PROXIMAL_CODIGO],
  titulo: 'Fratura do úmero proximal em adultos (rascunho)',
  escopo: 'Adultos com fratura do úmero proximal. Rascunho a partir da spec verificada v0.1; '
    + 'separa a população dos ECR (idosos, baixa energia, colo cirúrgico deslocado) das demais.',
  foraDeEscopo: [
    { id: 'N0.EXPOSTA', texto: 'Fratura exposta: fora do escopo do algoritmo; manejo individualizado (excluída dos ECR; PROFHER-2, PMID 37055816).', quando: { campo: 'fratura_exposta', op: '==', valor: true } },
    { id: 'N0.NEUROVASCULAR', texto: 'Lesão neurovascular: fora do escopo do algoritmo; manejo individualizado (excluída dos ECR; PROFHER-2, PMID 37055816).', quando: { campo: 'lesao_neurovascular', op: '==', valor: true } },
    { id: 'N0.PATOLOGICA', texto: 'Fratura patológica (não osteoporótica): fora do escopo do algoritmo; manejo individualizado (excluída dos ECR; PROFHER-2, PMID 37055816).', quando: { campo: 'fratura_patologica', op: '==', valor: true } },
    { id: 'N0.POLITRAUMA', texto: 'Politrauma: fora do escopo do algoritmo; manejo individualizado (excluído dos ECR; PROFHER-2, PMID 37055816).', quando: { campo: 'politrauma', op: '==', valor: true } },
  ],
  entradas: [
    { id: 'idade', rotulo: 'Idade', def: { tipo: 'numero', unidade: 'anos', min: 0, max: 120, inteiro: true }, origem: { de: 'paciente', campo: 'idade' }, momento: 'preop' },
    { id: 'mecanismo_energia', rotulo: 'Energia do trauma', def: { tipo: 'enum', valores: ['baixa', 'alta'], rotulos: { baixa: 'Baixa energia', alta: 'Alta energia' } }, origem: MANUAL, momento: 'preop' },
    { id: 'deslocada', rotulo: 'Fratura deslocada (critério de Neer: >1 cm ou >45°, avaliado pelo cirurgião)', def: { tipo: 'booleano' }, origem: MANUAL, momento: 'preop', critica: true },
    { id: 'neer_partes', rotulo: 'Partes de Neer', def: { tipo: 'numero', min: 1, max: 4, inteiro: true }, origem: doPayload('neer_partes'), momento: 'preop' },
    { id: 'segmentos_deslocados', rotulo: 'Segmentos deslocados', def: { tipo: 'lista', valores: ['colo_cirurgico', 'colo_anatomico', 'tuberosidade_maior', 'tuberosidade_menor'], rotulos: { colo_cirurgico: 'Colo cirúrgico', colo_anatomico: 'Colo anatômico', tuberosidade_maior: 'Tuberosidade maior', tuberosidade_menor: 'Tuberosidade menor' } }, origem: MANUAL, momento: 'preop' },
    { id: 'fratura_luxacao', rotulo: 'Fratura-luxação', def: { tipo: 'enum', valores: ['nenhuma', 'anterior', 'posterior'], rotulos: { nenhuma: 'Nenhuma', anterior: 'Anterior', posterior: 'Posterior' } }, origem: doPayload('fratura_luxacao'), momento: 'preop', critica: true },
    { id: 'head_split', rotulo: 'Head-split / fratura da superfície articular', def: { tipo: 'booleano' }, origem: doPayload('head_split'), momento: 'preop', critica: true },
    { id: 'ao_ota', rotulo: 'Classificação AO/OTA', def: { tipo: 'enum', valores: ['11A1', '11A2', '11A3', '11B1', '11B2', '11B3', '11C1', '11C2', '11C3'], rotulos: { '11A1': '11-A1', '11A2': '11-A2', '11A3': '11-A3', '11B1': '11-B1', '11B2': '11-B2', '11B3': '11-B3', '11C1': '11-C1', '11C2': '11-C2', '11C3': '11-C3' } }, origem: doPayload('ao_ota'), momento: 'preop' },
    { id: 'cirurgia_escolhida', rotulo: 'Cirurgião já optou por tratamento cirúrgico', def: { tipo: 'booleano' }, origem: MANUAL, momento: 'preop' },
    { id: 'fratura_exposta', rotulo: 'Fratura exposta', def: { tipo: 'booleano' }, origem: doPayload('fratura_exposta'), momento: 'preop' },
    { id: 'lesao_neurovascular', rotulo: 'Lesão neurovascular', def: { tipo: 'booleano' }, origem: doPayload('lesao_neurovascular'), momento: 'preop' },
    { id: 'fratura_patologica', rotulo: 'Fratura patológica (não osteoporótica)', def: { tipo: 'booleano' }, origem: MANUAL, momento: 'preop' },
    { id: 'politrauma', rotulo: 'Politrauma', def: { tipo: 'booleano' }, origem: doPayload('politrauma'), momento: 'preop' },
    { id: 'hertel_calcar_mm', rotulo: 'Extensão metafisária posteromedial (calcar)', def: { tipo: 'numero', unidade: 'mm', min: 0, max: 100 }, origem: doPayload('extensao_metafisaria_posteromedial_mm'), momento: 'preop' },
    { id: 'dobradica_medial_rompida', rotulo: 'Dobradiça medial rompida (avaliação do cirurgião)', def: { tipo: 'booleano' }, origem: MANUAL, momento: 'preop' },
    { id: 'cominuicao_medial', rotulo: 'Cominução medial (calcar)', def: { tipo: 'booleano' }, origem: doPayload('cominuicao_calcar'), momento: 'preop' },
    { id: 'dti', rotulo: 'Deltoid Tuberosity Index (DTI)', def: { tipo: 'numero', min: 0, max: 10 }, origem: doPayload('deltoid_tuberosity_index'), momento: 'preop' },
    // Só registro: nenhuma regra lê estas entradas (limiar ausente ou "requer texto completo").
    { id: 'dobradica_medial_desviada_mm', rotulo: 'Desvio da dobradiça medial (só registro)', def: { tipo: 'numero', unidade: 'mm', min: 0, max: 100 }, origem: doPayload('dobradica_medial_desviada_mm'), momento: 'preop' },
    { id: 'desvio_tuberosidade_maior_mm', rotulo: 'Desvio da tuberosidade maior (só registro)', def: { tipo: 'numero', unidade: 'mm', min: 0, max: 100 }, origem: doPayload('desvio_tuberosidade_maior_mm'), momento: 'preop' },
    { id: 'espessura_cortical_mm', rotulo: 'Espessura cortical combinada (só registro)', def: { tipo: 'numero', unidade: 'mm', min: 0, max: 30 }, origem: doPayload('espessura_cortical_combinada_mm'), momento: 'preop' },
    { id: 'dias_desde_lesao', rotulo: 'Dias desde a lesão (só registro)', def: { tipo: 'numero', unidade: 'dias', min: 0, max: 3650 }, origem: doPayload('dias_desde_lesao'), momento: 'preop' },
    { id: 'asa', rotulo: 'ASA (só registro)', def: { tipo: 'numero', min: 1, max: 5, inteiro: true }, origem: doPayload('asa'), momento: 'preop' },
    { id: 'demanda_funcional', rotulo: 'Demanda funcional (só registro; sem escala validada)', def: { tipo: 'enum', valores: ['baixa', 'moderada', 'alta'], rotulos: { baixa: 'Baixa', moderada: 'Moderada', alta: 'Alta' } }, origem: MANUAL, momento: 'preop' },
  ],
  parametros: [
    {
      id: 'idade_populacao_evidencia',
      rotulo: 'Idade mínima da população de evidência (ECR de idosos)',
      unidade: 'anos', min: 0, max: 120, inteiro: true,
      padrao: 60,
      status: 'pendente_decisao_cirurgiao',
      nota: 'Pendente de decisão do cirurgião (spec §7.1). A evidência usa ≥60 (NITEP; Cochrane "mainly ≥60"), '
        + '≥65 (Boons; PROFHER-2; DelPhi 65–85), >70 (Sebastiá-Forcada) e ≥80 (Lopiz). A spec adota 60 por ser o piso '
        + 'da maioria das evidências. Nenhum estudo valida um corte etário para decidir o tratamento.',
      referencias: [{ ref: 'Handoll2022' }, { ref: 'Launonen2019' }, { ref: 'Boons2012' }, { ref: 'Fraser2020' }, { ref: 'SebastiaForcada2014' }, { ref: 'Lopiz2019' }],
    },
    {
      id: 'limiar_dti',
      rotulo: 'Limiar do DTI para DMO local baixa (informativo)',
      min: 0, max: 10,
      padrao: 1.44,
      status: 'pendente_decisao_cirurgiao',
      nota: 'Pendente de decisão do cirurgião (spec §7.3). Spross 2015: corte 1,44 (AUC 0,87; S 0,88; E 0,80); valores '
        + '"consistentemente <1,4" sinalizam DMO local baixa. Só informa; não modifica as opções.',
      referencias: [{ ref: 'Spross2015' }],
    },
  ],
  opcoes: [
    { id: 'nao_operatorio', rotulo: 'Tratamento não operatório (tipoia + reabilitação)', naoCirurgica: true },
    { id: 'reducao_fixacao', rotulo: 'Redução e fixação' },
    { id: 'placa_bloqueada', rotulo: 'Fixação com placa bloqueada' },
    { id: 'haste_intramedular', rotulo: 'Haste intramedular' },
    { id: 'fixacao_tuberosidade', rotulo: 'Fixação da tuberosidade maior (aberta ou percutânea)' },
    { id: 'artroplastia', rotulo: 'Artroplastia (tipo a definir)' },
    { id: 'artroplastia_reversa', rotulo: 'Artroplastia reversa (RSA)' },
    { id: 'hemiartroplastia', rotulo: 'Hemiartroplastia (HA)' },
  ],
  regras: [
    // ---- N1: fratura-luxação → ZC-A ----
    {
      id: 'N1.ZC_A.FRATURA_LUXACAO',
      titulo: 'ZC-A: fratura-luxação',
      quando: COM_LUXACAO,
      efeitos: [
        { opcao: 'reducao_fixacao', efeito: 'favorece', forca: 'fraca' },
        { opcao: 'artroplastia', efeito: 'favorece', forca: 'fraca' },
      ],
      motivo: 'Fratura-luxação ({fratura_luxacao}): fora da população dos ECR; só há séries de casos. As alternativas são apresentadas sem escolha.',
      referencias: [{ ref: 'Handoll2022', nota: 'evidência de ECR ausente/insuficiente para fratura-luxação' }, { ref: 'Robinson2007' }, { ref: 'Jiang2026' }],
      controversia: {
        nota: 'Zona cinzenta A (força global fraca): sem ECR; a escolha depende de idade e viabilidade da cabeça, a critério do cirurgião.',
        alternativas: [
          { opcao: 'reducao_fixacao', argumento: 'Redução aberta + fixação: série de fratura-luxação posterior complexa com Constant mediano 83,5 em 2 anos (n=26); redução em 3 passos em 16/16 luxações posteriores bloqueadas (n=16).', referencias: [{ ref: 'Robinson2007' }, { ref: 'Jiang2026' }] },
          { opcao: 'artroplastia', argumento: 'Artroplastia: alternativa conforme idade e viabilidade da cabeça; sem ECR nesta população (Cochrane).', referencias: [{ ref: 'Handoll2022' }] },
        ],
      },
    },
    // ---- N2: head-split → ZC-B ----
    {
      id: 'N2.ZC_B.HEAD_SPLIT',
      titulo: 'ZC-B: head-split / superfície articular',
      quando: { all: [SEM_LUXACAO, { campo: 'head_split', op: '==', valor: true }] },
      efeitos: [
        { opcao: 'reducao_fixacao', efeito: 'favorece', forca: 'fraca' },
        { opcao: 'artroplastia', efeito: 'favorece', forca: 'fraca' },
      ],
      motivo: 'Head-split: fora da população dos ECR. As alternativas são apresentadas sem escolha.',
      referencias: [{ ref: 'Handoll2022', nota: 'evidência ausente para fraturas da superfície articular' }, { ref: 'Hertel2004', nota: 'head-split: preditor fraco de isquemia (acurácia 0,49)' }],
      controversia: {
        nota: 'Zona cinzenta B (força global fraca): sem ECR.',
        alternativas: [
          { opcao: 'reducao_fixacao', argumento: 'Fixação: sem ECR; head-split é preditor fraco de isquemia intraoperatória (acurácia 0,49).', referencias: [{ ref: 'Hertel2004' }] },
          { opcao: 'artroplastia', argumento: 'Artroplastia: sem ECR nesta população (Cochrane).', referencias: [{ ref: 'Handoll2022' }] },
        ],
      },
    },
    // ---- N3: não deslocada → S1 ----
    {
      id: 'N3.S1.NAO_DESLOCADA',
      titulo: 'S1: fratura não deslocada / minimamente deslocada',
      quando: { all: [SEM_LUXACAO, SEM_HEAD_SPLIT, { campo: 'deslocada', op: '==', valor: false }] },
      efeitos: [{ opcao: 'nao_operatorio', efeito: 'favorece', forca: 'fraca' }],
      motivo: 'Fratura não deslocada: a literatura favorece o tratamento não operatório (tipoia + reabilitação). Cerca de metade das fraturas é minimamente deslocada; prática consensual, sem ECR de cirurgia vs não cirurgia neste subgrupo (força fraca a moderada na spec; codificada como fraca).',
      referencias: [{ ref: 'CourtBrown2001Epi', nota: 'metade das fraturas minimamente deslocadas (n=1.027)' }],
    },
    // ---- N4: TM isolada deslocada → ZC-C ----
    {
      id: 'N4.ZC_C.TM_ISOLADA',
      titulo: 'ZC-C: fratura isolada da tuberosidade maior, deslocada',
      quando: { all: [SEM_LUXACAO, SEM_HEAD_SPLIT, DESLOCADA, TM_ISOLADA] },
      efeitos: [
        { opcao: 'nao_operatorio', efeito: 'favorece', forca: 'fraca' },
        { opcao: 'fixacao_tuberosidade', efeito: 'favorece', forca: 'fraca' },
      ],
      motivo: 'Tuberosidade maior isolada deslocada: nenhum limiar em mm validado; a literatura diverge.',
      referencias: [{ ref: 'Ryan2022' }, { ref: 'Platzer2008' }, { ref: 'Handoll2022', nota: 'evidência ausente para 2 partes da tuberosidade' }],
      controversia: {
        nota: 'Zona cinzenta C (controversa): nenhum limiar em mm validado para a tuberosidade maior.',
        alternativas: [
          { opcao: 'nao_operatorio', argumento: 'Não operatório com desvio de 5–10 mm e >10 mm teve ADM final igual à de 0–5 mm (retrospectivo, n=93); não sustenta a "regra dos 5 mm".', referencias: [{ ref: 'Ryan2022' }] },
          { opcao: 'fixacao_tuberosidade', argumento: 'Fixação com resultado melhor que o não operatório em TM deslocada (52 operados vs 9 controles).', referencias: [{ ref: 'Platzer2008' }] },
        ],
      },
    },
    // ---- N6: jovem (< parâmetro) ou alta energia → ZC-D ----
    {
      id: 'N6.ZC_D.JOVEM_OU_ALTA_ENERGIA',
      titulo: 'ZC-D: idade abaixo da população de evidência ou alta energia',
      quando: {
        all: [BASE_N5, { any: [{ campo: 'idade', op: '<', param: 'idade_populacao_evidencia' }, { campo: 'mecanismo_energia', op: '==', valor: 'alta' }] }],
      },
      efeitos: [
        { opcao: 'placa_bloqueada', efeito: 'favorece', forca: 'fraca' },
        { opcao: 'haste_intramedular', efeito: 'favorece', forca: 'fraca' },
        { opcao: 'nao_operatorio', efeito: 'favorece', forca: 'fraca' },
      ],
      motivo: 'Idade {idade}, energia {mecanismo_energia}: fora da população dos ECR (evidência ausente para esta população). As alternativas são apresentadas sem escolha.',
      referencias: [
        { ref: 'Handoll2022', nota: 'evidência ausente para <60 anos e alta energia' },
        { ref: 'BastianHertel2008', nota: '8 de 10 cabeças isquêmicas não evoluíram para necrose (21–60 anos)' },
        { ref: 'Owsley2008', nota: 'complicação radiográfica 22% nos <60 vs 57% nos >60' },
      ],
      controversia: {
        nota: 'Zona cinzenta D (força global fraca): sem ECR nesta população. A spec registra que a preservação da cabeça é favorecida quando a redução e a estabilidade são possíveis.',
        alternativas: [
          { opcao: 'placa_bloqueada', argumento: 'Placa: menos complicações radiográficas nos <60 anos (22% vs 57%) numa série de um cirurgião; isquemia inicial nem sempre evolui para necrose.', referencias: [{ ref: 'Owsley2008' }, { ref: 'BastianHertel2008' }] },
          { opcao: 'haste_intramedular', argumento: 'Haste: sem ECR nesta população; meta-análise (outra população) com função igual à placa e menos cut-out.', referencias: [{ ref: 'Handoll2022' }, { ref: 'Chang2026' }] },
          { opcao: 'nao_operatorio', argumento: 'Não operatório: sem ECR nesta população (Cochrane).', referencias: [{ ref: 'Handoll2022' }] },
        ],
      },
    },
    // ---- N7: população idosa, colo cirúrgico deslocado ----
    {
      id: 'N7.MENSAGEM_FIXA',
      titulo: 'Mensagem fixa: adultos mais velhos com fratura deslocada do colo cirúrgico',
      quando: N7,
      efeitos: [],
      aviso: true,
      motivo: MENSAGEM_FIXA_IDOSO,
      referencias: [
        { ref: 'Handoll2022', nota: 'função em 1 e 2 anos: SMD 0,10 e 0,06 (GRADE alto); reoperação RR 2,06 (GRADE baixo)' },
        { ref: 'Handoll2017', nota: 'PROFHER: sem diferença em 3, 4 e 5 anos' },
        { ref: 'Rangan2015', nota: 'PROFHER: OSS igual em 2 anos' },
      ],
    },
    {
      id: 'N7.FORA_POPULACAO',
      titulo: 'Fratura deslocada sem colo cirúrgico em adulto mais velho',
      quando: { all: [POP_IDOSA, { not: COLO_CIRURGICO }] },
      efeitos: [],
      aviso: true,
      motivo: 'Fratura deslocada sem envolvimento do colo cirúrgico: fora da população dos ECR (idosos, baixa energia, colo cirúrgico deslocado). Cautela ao extrapolar a evidência.',
      referencias: [{ ref: 'Handoll2022', nota: 'população dos ECR: fratura deslocada envolvendo o colo cirúrgico' }],
    },
    {
      id: 'N7.S2.DUAS_PARTES',
      titulo: 'S2: adulto mais velho, 2 partes do colo cirúrgico',
      quando: { all: [N7, { campo: 'neer_partes', op: '==', valor: 2 }] },
      efeitos: [{ opcao: 'nao_operatorio', efeito: 'favorece', forca: 'forte' }],
      motivo: 'Idade {idade}, 2 partes do colo cirúrgico: a literatura favorece considerar primeiro o tratamento não operatório (DASH em 2 anos sem diferença; cirurgia não melhorou o desfecho mesmo com translação maior).',
      referencias: [
        { ref: 'Launonen2019', nota: 'NITEP (≥60, 2 partes): DASH 18,5 vs 17,4 em 2 anos' },
        { ref: 'Handoll2022' },
        { ref: 'CourtBrown2001Translacao', nota: 'cirurgia não melhorou o desfecho, independentemente da translação' },
      ],
    },
    {
      id: 'N7.ZC_E.FIXACAO_DUAS_PARTES',
      titulo: 'ZC-E: fixação escolhida, 2 partes',
      quando: { all: [N7, { campo: 'neer_partes', op: '==', valor: 2 }, { campo: 'cirurgia_escolhida', op: '==', valor: true }] },
      efeitos: [
        { opcao: 'placa_bloqueada', efeito: 'favorece', forca: 'fraca' },
        { opcao: 'haste_intramedular', efeito: 'favorece', forca: 'fraca' },
      ],
      motivo: 'Cirurgia já escolhida em 2 partes: placa e haste com função igual; as alternativas são apresentadas sem escolha.',
      referencias: [{ ref: 'Handoll2022', nota: 'placa vs haste: função sem diferença (GRADE baixo)' }, { ref: 'Chang2026' }],
      controversia: {
        nota: 'Zona cinzenta E (força global fraca).',
        alternativas: [
          { opcao: 'placa_bloqueada', argumento: 'Placa bloqueada: função igual à haste (Cochrane, GRADE baixo).', referencias: [{ ref: 'Handoll2022' }] },
          { opcao: 'haste_intramedular', argumento: 'Haste: função igual; menor protrusão/cut-out em 2 partes (OR 0,12; IC 0,01–0,98; 6 ECR, 421 pacientes).', referencias: [{ ref: 'Chang2026' }] },
        ],
      },
    },
    // ---- N8: adulto mais velho, 3–4 partes ----
    {
      id: 'N8.ZC_F.OITENTA_MAIS',
      titulo: 'ZC-F: ≥80 anos, 3–4 partes',
      quando: { all: [N8, { campo: 'idade', op: '>=', valor: 80 }] },
      efeitos: [
        { opcao: 'nao_operatorio', efeito: 'favorece', forca: 'fraca' },
        { opcao: 'artroplastia_reversa', efeito: 'favorece', forca: 'fraca' },
      ],
      motivo: 'Idade {idade}, {neer_partes} partes: a literatura diverge entre não operatório e RSA.',
      referencias: [{ ref: 'Lopiz2019' }, { ref: 'Lopiz2024' }],
      controversia: {
        nota: 'Zona cinzenta F (controversa). População do ECR: ≥80 anos, 3–4 partes.',
        alternativas: [
          { opcao: 'nao_operatorio', argumento: '12 meses: Constant 61,7 (RSA) vs 55,7 (não operatório), P=0,071; só a dor foi melhor com RSA (ECR n=59; moderada para benefício mínimo em 1 ano).', referencias: [{ ref: 'Lopiz2019' }] },
          { opcao: 'artroplastia_reversa', argumento: '~7,5 anos: Constant 62 vs 51 (P=0,039) a favor da RSA, com 29 de 62 avaliados (perda de >50% do seguimento; fraca).', referencias: [{ ref: 'Lopiz2024' }] },
        ],
      },
    },
    {
      id: 'N8.S3.AO_C2_CIRURGIA',
      titulo: 'S3: 65–85 anos, AO 11-C2, cirurgia já escolhida',
      quando: { all: [DELPHI, { campo: 'ao_ota', op: '==', valor: '11C2' }] },
      efeitos: [{ opcao: 'artroplastia_reversa', efeito: 'favorece', forca: 'moderada' }],
      motivo: 'AO 11-C2 com cirurgia já escolhida: entre as opções cirúrgicas, a RSA mostrou função superior à placa em 2 anos (Constant +18,7 em C2). A comparação com o não operatório continua na zona cinzenta G.',
      referencias: [{ ref: 'Fraser2020', nota: 'DelPhi (65–85 anos): C2, diferença 18,7 no Constant' }],
    },
    {
      id: 'N8.ZC_H.AO_B2_CIRURGIA',
      titulo: 'ZC-H: 65–85 anos, AO 11-B2, cirurgia já escolhida',
      quando: { all: [DELPHI, { campo: 'ao_ota', op: '==', valor: '11B2' }] },
      efeitos: [
        { opcao: 'artroplastia_reversa', efeito: 'favorece', forca: 'fraca' },
        { opcao: 'placa_bloqueada', efeito: 'favorece', forca: 'fraca' },
      ],
      motivo: 'AO 11-B2 com cirurgia já escolhida: diferença não significativa entre RSA e placa.',
      referencias: [{ ref: 'Fraser2020', nota: 'B2: diferença 7,6 (IC −3,8 a 19,1; NS)' }],
      controversia: {
        nota: 'Zona cinzenta H (força global fraca): em B2 a diferença entre RSA e placa não foi significativa.',
        alternativas: [
          { opcao: 'artroplastia_reversa', argumento: 'RSA: Constant 7,6 pontos maior em B2, IC −3,8 a 19,1 (não significativo).', referencias: [{ ref: 'Fraser2020' }] },
          { opcao: 'placa_bloqueada', argumento: 'Placa: sem diferença significativa em relação à RSA em B2.', referencias: [{ ref: 'Fraser2020' }] },
        ],
      },
    },
    {
      id: 'N8.ZC_G.TRES_QUATRO_PARTES',
      titulo: 'ZC-G: adulto mais velho, 3–4 partes',
      quando: N8,
      efeitos: [
        { opcao: 'nao_operatorio', efeito: 'favorece', forca: 'fraca' },
        { opcao: 'placa_bloqueada', efeito: 'favorece', forca: 'fraca' },
        { opcao: 'artroplastia_reversa', efeito: 'favorece', forca: 'fraca' },
        { opcao: 'hemiartroplastia', efeito: 'favorece', forca: 'fraca' },
      ],
      motivo: 'Idade {idade}, {neer_partes} partes: não operatório com evidência forte de função não inferior; entre as opções cirúrgicas a evidência é fraca a moderada. As alternativas são apresentadas sem escolha.',
      referencias: [{ ref: 'Handoll2022' }, { ref: 'Olerud2011Placa' }, { ref: 'Olerud2011HA' }, { ref: 'Boons2012' }, { ref: 'SebastiaForcada2014' }, { ref: 'Fraser2020' }],
      controversia: {
        nota: 'Zona cinzenta G: forte para "não operatório não é inferior em função"; fraca a moderada entre as opções cirúrgicas.',
        alternativas: [
          { opcao: 'nao_operatorio', argumento: 'Função igual à da cirurgia em 1 e 2 anos (Cochrane, GRADE alto; 66% eram 3–4 partes).', referencias: [{ ref: 'Handoll2022' }] },
          { opcao: 'placa_bloqueada', argumento: '3 partes: tendência a favor da placa sem significância (Constant 61 vs 58, P=0,64), com 30% de reoperações (ECR n=60).', referencias: [{ ref: 'Olerud2011Placa' }] },
          { opcao: 'artroplastia_reversa', argumento: 'RSA melhor que HA em ECR >70 anos (Constant 56,1 vs 40,0), mas GRADE muito baixo na síntese; RSA melhor que placa em AO C2 (DelPhi).', referencias: [{ ref: 'SebastiaForcada2014' }, { ref: 'Handoll2022' }, { ref: 'Fraser2020' }] },
          { opcao: 'hemiartroplastia', argumento: '4 partes: qualidade de vida melhor que o não operatório num ECR (EQ-5D 0,81 vs 0,65), igual em outro (Constant/SST em 12 meses).', referencias: [{ ref: 'Olerud2011HA' }, { ref: 'Boons2012' }] },
        ],
      },
    },
    // ---- N9: módulo informativo (nunca mexe em opções) ----
    {
      id: 'N9.INFO.HERTEL',
      titulo: 'Informativo: preditores de isquemia (Hertel)',
      quando: {
        all: [DESLOCADA, {
          any: [
            { campo: 'hertel_calcar_mm', op: '<', valor: 8 },
            { campo: 'dobradica_medial_rompida', op: '==', valor: true },
            { campo: 'segmentos_deslocados', op: 'contem', valor: 'colo_anatomico' },
          ],
        }],
      },
      efeitos: [],
      aviso: true,
      motivo: 'Preditores de ISQUEMIA intraoperatória presentes (calcar <8 mm, dobradiça medial rompida ou colo anatômico; Hertel, moderada). A relação com NECROSE clínica é controversa. Informação, não critério de decisão.',
      referencias: [
        { ref: 'Hertel2004', nota: 'calcar <8 mm (acurácia 0,84); dobradiça rompida (0,79)' },
        { ref: 'BastianHertel2008', nota: 'isquemia inicial não prediz necrose' },
        { ref: 'Ismailov2026', nota: 'pós-placa: calcar <8 mm não se associou a NAV/falha; colo anatômico, sim' },
      ],
    },
    {
      id: 'N9.INFO.DTI',
      titulo: 'Informativo: DMO local baixa (DTI)',
      quando: { all: [DESLOCADA, { campo: 'dti', op: '<', param: 'limiar_dti' }] },
      efeitos: [],
      aviso: true,
      motivo: 'DTI {dti} abaixo do limiar configurado: marcador de DMO local baixa (moderada como marcador, fraca como critério de tratamento). Idade e DMO local são preditores de falha da fixação. Informação, não critério de decisão.',
      referencias: [{ ref: 'Spross2015' }, { ref: 'Krappinger2011', nota: 'preditores qualitativos; limiares numéricos requerem texto completo' }],
    },
    {
      id: 'N9.INFO.SUPORTE_MEDIAL',
      titulo: 'Informativo: cominução medial',
      quando: { all: [DESLOCADA, { campo: 'cominuicao_medial', op: '==', valor: true }] },
      efeitos: [],
      aviso: true,
      motivo: 'Cominução medial: o suporte medial se associa à manutenção da redução após placa (perda de altura 1,2 vs 5,8 mm). Informação, não critério de decisão.',
      referencias: [{ ref: 'Gardner2007' }, { ref: 'Krappinger2011', nota: 'restauração do suporte cortical medial como preditor (qualitativo)' }],
    },
    {
      id: 'N9.INFO.PLACA_ACIMA_60',
      titulo: 'Informativo: complicações da placa acima de 60 anos',
      quando: { all: [DESLOCADA, { campo: 'idade', op: '>', valor: 60 }] },
      efeitos: [],
      aviso: true,
      motivo: 'Se a placa for considerada: cut-out em 43% dos >60 anos numa série de um cirurgião (fraca); perfuração intraoperatória de parafuso em 14% numa série multicêntrica (moderada). Informação, não critério de decisão.',
      referencias: [{ ref: 'Owsley2008', nota: 'subgrupo >60 anos do próprio estudo' }, { ref: 'Sudkamp2009' }],
    },
    // ---- Consistência dos dados ----
    {
      id: 'DADOS.DESLOCAMENTO_INCONSISTENTE',
      titulo: 'Deslocamento incoerente com as partes de Neer',
      quando: {
        any: [
          { all: [{ campo: 'deslocada', op: '==', valor: false }, { campo: 'neer_partes', op: '>=', valor: 2 }] },
          { all: [{ campo: 'deslocada', op: '==', valor: true }, { campo: 'neer_partes', op: '==', valor: 1 }] },
        ],
      },
      efeitos: [],
      aviso: true,
      motivo: 'Cautela: "fratura deslocada" = {deslocada} não confere com {neer_partes} parte(s) de Neer. Revise os dados.',
      referencias: [{ ref: 'Launonen2019', nota: 'definição operacional "more than 1 cm or 45 degrees"' }, { ref: 'Neer1970', nota: 'convenção classificatória; requer texto completo' }],
    },
  ],
  referencias: [
    { id: 'Handoll2022', citacao: 'Handoll HH, Elliott J, Thillemann TM, Aluko P, Brorson S. Interventions for treating proximal humeral fractures in adults. Cochrane Database Syst Rev. 2022;6:CD000434.', pmid: '35727196', doi: '10.1002/14651858.CD000434.pub5', nivel: 'I', tipo: 'revisao_sistematica' },
    { id: 'Rangan2015', citacao: 'Rangan A, Handoll H, Brealey S, et al. Surgical vs nonsurgical treatment of adults with displaced fractures of the proximal humerus: the PROFHER randomized clinical trial. JAMA. 2015;313(10):1037-47.', pmid: '25756440', doi: '10.1001/jama.2015.1629', nivel: 'I', tipo: 'ECR' },
    { id: 'Handoll2017', citacao: 'Handoll HH, Keding A, Corbacho B, et al. Five-year follow-up results of the PROFHER trial. Bone Joint J. 2017;99-B(3):383-392.', pmid: '28249980', doi: '10.1302/0301-620X.99B3.BJJ-2016-1028', nivel: 'I', tipo: 'ECR' },
    { id: 'Launonen2019', citacao: 'Launonen AP, Sumrein BO, Reito A, et al. Operative versus non-operative treatment for 2-part proximal humerus fracture: a multicenter randomized controlled trial (NITEP). PLoS Med. 2019;16(7):e1002855.', pmid: '31318863', doi: '10.1371/journal.pmed.1002855', nivel: 'I', tipo: 'ECR' },
    { id: 'Fraser2020', citacao: 'Fraser AN, Bjørdal J, Wagle TM, et al. Reverse shoulder arthroplasty is superior to plate fixation at 2 years for displaced proximal humeral fractures in the elderly (DelPhi). J Bone Joint Surg Am. 2020;102(6):477-485.', pmid: '31977825', doi: '10.2106/JBJS.19.01071', nivel: 'I', tipo: 'ECR' },
    { id: 'Lopiz2019', citacao: 'Lopiz Y, Alcobía-Díaz B, Galán-Olleros M, et al. Reverse shoulder arthroplasty versus nonoperative treatment for 3- or 4-part proximal humeral fractures in elderly patients: a prospective randomized controlled trial. J Shoulder Elbow Surg. 2019;28(12):2259-2271.', pmid: '31500986', doi: '10.1016/j.jse.2019.06.024', nivel: 'II', tipo: 'ECR' },
    { id: 'Lopiz2024', citacao: 'Lopiz Y, et al. Long-term outcomes of reverse shoulder arthroplasty versus nonoperative treatment for 3- or 4-part proximal humeral fractures: results from a prior RCT. J Shoulder Elbow Surg. 2025;34(6):1463-1470.', pmid: '39579859', doi: '10.1016/j.jse.2024.09.032', nivel: 'II', tipo: 'ECR' },
    { id: 'SebastiaForcada2014', citacao: 'Sebastiá-Forcada E, Cebrián-Gómez R, Lizaur-Utrilla A, Gil-Guillén V. Reverse shoulder arthroplasty versus hemiarthroplasty for acute proximal humeral fractures. A blinded, randomized, controlled, prospective study. J Shoulder Elbow Surg. 2014;23(10):1419-26.', pmid: '25086490', doi: '10.1016/j.jse.2014.06.035', nivel: 'II', tipo: 'ECR' },
    { id: 'Olerud2011Placa', citacao: 'Olerud P, Ahrengart L, Ponzer S, et al. Internal fixation versus nonoperative treatment of displaced 3-part proximal humeral fractures in elderly patients: a randomized controlled trial. J Shoulder Elbow Surg. 2011;20(5):747-55.', pmid: '21435907', doi: '10.1016/j.jse.2010.12.018', nivel: 'II', tipo: 'ECR' },
    { id: 'Olerud2011HA', citacao: 'Olerud P, Ahrengart L, Ponzer S, et al. Hemiarthroplasty versus nonoperative treatment of displaced 4-part proximal humeral fractures in elderly patients: a randomized controlled trial. J Shoulder Elbow Surg. 2011;20(7):1025-33.', pmid: '21783385', doi: '10.1016/j.jse.2011.04.016', nivel: 'II', tipo: 'ECR' },
    { id: 'Boons2012', citacao: 'Boons HW, Goosen JH, van Grinsven S, et al. Hemiarthroplasty for humeral four-part fractures for patients 65 years and older: a randomized controlled trial. Clin Orthop Relat Res. 2012;470(12):3483-91.', pmid: '22895694', doi: '10.1007/s11999-012-2531-0', nivel: 'II', tipo: 'ECR' },
    { id: 'Chang2026', citacao: 'Chang CW, Yu HH, Lin CH, et al. Locking plate versus intramedullary nailing in displaced proximal humerus fractures: a meta-analysis of randomized controlled trials. J Orthop Sci. 2026.', pmid: '42660696', doi: '10.1016/j.jos.2026.07.017', nivel: 'I', tipo: 'metanalise' },
    { id: 'CourtBrown2001Epi', citacao: 'Court-Brown CM, Garg A, McQueen MM. The epidemiology of proximal humeral fractures. Acta Orthop Scand. 2001;72(4):365-71.', pmid: '11580125', doi: '10.1080/000164701753542023', nivel: 'II', tipo: 'coorte' },
    { id: 'CourtBrown2001Translacao', citacao: 'Court-Brown CM, Garg A, McQueen MM. The translated two-part fracture of the proximal humerus. Epidemiology and outcome in the older patient. J Bone Joint Surg Br. 2001;83(6):799-804.', pmid: '11521917', doi: '10.1302/0301-620x.83b6.11401', nivel: 'III', tipo: 'coorte' },
    { id: 'Hertel2004', citacao: 'Hertel R, Hempfing A, Stiehler M, Leunig M. Predictors of humeral head ischemia after intracapsular fracture of the proximal humerus. J Shoulder Elbow Surg. 2004;13(4):427-33.', pmid: '15220884', doi: '10.1016/j.jse.2004.01.034', nivel: 'II', tipo: 'coorte' },
    { id: 'BastianHertel2008', citacao: 'Bastian JD, Hertel R. Initial post-fracture humeral head ischemia does not predict development of necrosis. J Shoulder Elbow Surg. 2008;17(1):2-8.', pmid: '18308202', doi: '10.1016/j.jse.2007.03.026', nivel: 'III', tipo: 'coorte' },
    { id: 'Ismailov2026', citacao: 'Ismailov S, Bacaksiz T, Maden M, et al. Does the Hertel criteria correlate with postoperative avascular necrosis and failure in proximal humerus fractures? Eur J Trauma Emerg Surg. 2026;52(1).', pmid: '41843140', doi: '10.1007/s00068-026-03148-x', nivel: 'III', tipo: 'coorte' },
    { id: 'Spross2015', citacao: 'Spross C, Kaestle N, Benninger E, et al. Deltoid Tuberosity Index: a simple radiographic tool to assess local bone quality in proximal humerus fractures. Clin Orthop Relat Res. 2015;473(9):3038-45.', pmid: '25910780', doi: '10.1007/s11999-015-4322-x', nivel: 'III', tipo: 'coorte' },
    { id: 'Krappinger2011', citacao: 'Krappinger D, Bizzotto N, Riedmann S, et al. Predicting failure after surgical fixation of proximal humerus fractures. Injury. 2011;42(11):1283-8.', pmid: '21310406', doi: '10.1016/j.injury.2011.01.017', nivel: 'III', tipo: 'coorte' },
    { id: 'Gardner2007', citacao: 'Gardner MJ, Weil Y, Barker JU, et al. The importance of medial support in locked plating of proximal humerus fractures. J Orthop Trauma. 2007;21(3):185-91.', pmid: '17473755', doi: '10.1097/BOT.0b013e3180333094', nivel: 'III', tipo: 'coorte' },
    { id: 'Owsley2008', citacao: 'Owsley KC, Gorczyca JT. Fracture displacement and screw cutout after open reduction and locked plate fixation of proximal humeral fractures. J Bone Joint Surg Am. 2008;90(2):233-40.', pmid: '18245580', doi: '10.2106/JBJS.F.01351', nivel: 'IV', tipo: 'serie_casos' },
    { id: 'Sudkamp2009', citacao: 'Südkamp N, Bayer J, Hepp P, et al. Open reduction and internal fixation of proximal humeral fractures with use of the locking proximal humerus plate. J Bone Joint Surg Am. 2009;91(6):1320-8.', pmid: '19487508', doi: '10.2106/JBJS.H.00006', nivel: 'IV', tipo: 'serie_casos' },
    { id: 'Ryan2022', citacao: 'Ryan DJ, Zuckerman JD, Egol KA. Fact or fiction: the "5 mm Rule" in greater tuberosity fractures of the proximal humerus. Eur J Orthop Surg Traumatol. 2023;33(6):2309-2315.', pmid: '36346475', doi: '10.1007/s00590-022-03427-4', nivel: 'III', tipo: 'coorte' },
    { id: 'Platzer2008', citacao: 'Platzer P, Thalhammer G, Oberleitner G, et al. Displaced fractures of the greater tuberosity: a comparison of operative and nonoperative treatment. J Trauma. 2008;65(4):843-8.', pmid: '18349710', doi: '10.1097/01.ta.0000233710.42698.3f', nivel: 'III', tipo: 'coorte' },
    { id: 'Robinson2007', citacao: 'Robinson CM, Akhtar A, Mitchell M, Beavis C. Complex posterior fracture-dislocation of the shoulder. Epidemiology, injury patterns, and results of operative treatment. J Bone Joint Surg Am. 2007;89(7):1454-66.', pmid: '17606784', doi: '10.2106/JBJS.F.01214', nivel: 'IV', tipo: 'serie_casos' },
    { id: 'Jiang2026', citacao: 'Jiang Z, Xiang Y, Lei C, et al. Three-step reduction for locked posterior fracture-dislocation of the shoulder. Injury. 2026;57(11):113679.', pmid: '42731145', doi: '10.1016/j.injury.2026.113679', nivel: 'IV', tipo: 'serie_casos' },
    { id: 'Neer1970', citacao: 'Neer CS 2nd. Displaced proximal humeral fractures. I. Classification and evaluation. J Bone Joint Surg Am. 1970;52(6):1077-89.', pmid: '5455339', nivel: 'V', tipo: 'opiniao' },
  ],
  avisosGerais: [
    'Rascunho, não revisado pelo cirurgião. Apoio à decisão baseado em literatura. A decisão final é do cirurgião com o paciente.',
    'A evidência forte (ECR e Cochrane) vem de adultos mais velhos, trauma de baixa energia e fratura deslocada do colo cirúrgico; não se aplica a jovens com alta energia, fratura-luxação, head-split ou tuberosidade maior isolada.',
    AVISO_NIVEIS_EVIDENCIA,
  ],
  referenciasGerais: [{ ref: 'Handoll2022' }],
};

// ---- Mapeamento payload → entradas ----

/** Respostas do cirurgião que o schema de diagnóstico não guarda. */
export interface RespostasManuaisFxUmeroProximal {
  mecanismo_energia?: 'baixa' | 'alta' | null;
  deslocada?: boolean | null;
  segmentos_deslocados?: string[] | null;
  fratura_patologica?: boolean | null;
  dobradica_medial_rompida?: boolean | null;
  cirurgia_escolhida?: boolean | null;
  demanda_funcional?: 'baixa' | 'moderada' | 'alta' | null;
}

export interface EntradaMapeada {
  /** Entrada pronta para `evaluate` (só chaves com valor; ausente fica ausente, nunca 0/false). */
  entrada: Record<string, unknown>;
  /** De onde veio cada valor presente. */
  proveniencia: Record<string, OrigemEntrada>;
}

function presente(v: unknown): boolean {
  if (v === undefined || v === null) return false;
  if (typeof v === 'string') return v.trim() !== '';
  if (Array.isArray(v)) return v.length > 0; // lista vazia = sem resposta
  return true;
}

/**
 * Monta a entrada do algoritmo a partir do payload v2 (`avaliacaoPreop`, via `preopFor`), da idade do
 * paciente e das respostas manuais. Não converte mm em critério: "deslocada" vem do cirurgião ou, na
 * falta da resposta, das partes de Neer (≥2 partes = deslocada, por definição da classificação).
 */
export function mapearEntradaFxUmeroProximal(
  payload: Pick<ClinicalPayload, 'avaliacaoPreop'>,
  extra: { idade?: number | null; manual?: RespostasManuaisFxUmeroProximal } = {},
): EntradaMapeada {
  const entrada: Record<string, unknown> = {};
  const proveniencia: Record<string, OrigemEntrada> = {};
  const dados = preopFor(payload, FX_UMERO_PROXIMAL_CODIGO)?.dados ?? {};
  const manual = (extra.manual ?? {}) as Record<string, unknown>;

  for (const e of FX_UMERO_PROXIMAL.entradas) {
    const o = e.origem;
    let v: unknown;
    if (o.de === 'payload') v = dados[o.caminho.slice(PAYLOAD.length)];
    else if (o.de === 'paciente') v = o.campo === 'idade' ? extra.idade : undefined;
    else if (o.de === 'manual') v = manual[e.id];
    if (presente(v)) {
      entrada[e.id] = Array.isArray(v) ? [...v] : v;
      proveniencia[e.id] = o;
    }
  }

  // "deslocada" sem resposta manual: deriva das partes de Neer (classificação do cirurgião, não de mm)
  if (!('deslocada' in entrada) && typeof entrada.neer_partes === 'number') {
    entrada.deslocada = entrada.neer_partes >= 2;
    proveniencia.deslocada = { de: 'derivada', funcao: 'neer_partes >= 2', dependeDe: ['neer_partes'] };
  }
  return { entrada, proveniencia };
}
