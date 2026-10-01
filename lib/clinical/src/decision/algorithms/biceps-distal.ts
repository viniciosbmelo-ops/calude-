/**
 * Apoio à decisão: ruptura do tendão distal do bíceps (EL_DBR). RASCUNHO.
 *
 * Fonte única: spec verificada "spec-biceps-distal.md" v1.0 (conferida no PubMed em 2026-09-28).
 * Só entram números e critérios que a spec marca como verificados. O que a spec marca como
 * "requer texto completo" (dose do AINE, ranking biomecânico de fixação) não vira regra e não é exibido.
 * Nenhuma dose de medicamento aparece aqui.
 *
 * Nenhum nó chega a "forte" (não há ECR operatório × não operatório, nem em lesões crônicas ou parciais).
 * Zonas cinzentas (◆ na spec) são regras com `controversia` e alternativas lado a lado, sem vencedor:
 * classificação temporal (N2), A1-ZC, A3, A5, B2, C2 e D1.
 *
 * O corte "crônica" é o PARÂMETRO `limiar_cronica_dias` (a entrada guarda os dias crus).
 * Níveis de evidência das referências: atribuídos pelo desenho do estudo descrito na spec
 * (a spec não traz o nível); conferir na revisão do cirurgião.
 */
import type { ClinicalPayload } from '../../surgery/payload';
import { preopFor } from '../../surgery/payload';
import type { AlgorithmDef, Cond, Proveniencia } from '../types';

export const BICEPS_DISTAL_CODIGO = 'EL_DBR';
export const LIMIAR_CRONICA_PARAM = 'limiar_cronica_dias';

// ---- Condições reutilizadas ----
const COMPLETA: Cond = { campo: 'tipo_ruptura', op: '==', valor: 'completa' };
const PARCIAL: Cond = { campo: 'tipo_ruptura', op: '==', valor: 'parcial' };
const COMPLETA_OU_PARCIAL: Cond = { campo: 'tipo_ruptura', op: 'in', valores: ['completa', 'parcial'] };
/** Aguda/precoce: dias ≤ corte configurado. */
const AGUDA: Cond = { campo: 'dias_desde_lesao', op: '<=', param: LIMIAR_CRONICA_PARAM };
/** Tardia/crônica: dias > corte configurado. */
const CRONICA: Cond = { campo: 'dias_desde_lesao', op: '>', param: LIMIAR_CRONICA_PARAM };
const HOOK_NORMAL: Cond = { campo: 'hook_test', op: 'in', valores: ['normal', 'normal_doloroso'] };

const AVISO_RM_PCT = 'A estimativa do % rompido por RM é pouco reprodutível (concordância entre observadores κ 0,27; 0,43 com a incidência FABS).';

export const BICEPS_DISTAL: AlgorithmDef = {
  id: 'EL_DBR_APOIO',
  versao: '0.1.0',
  patologias: [BICEPS_DISTAL_CODIGO],
  titulo: 'Ruptura do tendão distal do bíceps (rascunho)',
  escopo: 'Suspeita ou diagnóstico de ruptura completa (aguda ou tardia/crônica) ou parcial do tendão distal do bíceps, do diagnóstico ao pós-operatório.',
  foraDeEscopo: [
    {
      id: 'DBR.ESC.TENDINOPATIA',
      texto: 'Tendinopatia sem ruptura: fora do escopo deste algoritmo.',
      quando: { campo: 'tipo_ruptura', op: '==', valor: 'tendinopatia' },
    },
  ],
  parametros: [
    {
      id: LIMIAR_CRONICA_PARAM,
      rotulo: 'Corte para ruptura completa tardia/crônica',
      unidade: 'dias',
      min: 21,
      max: 41,
      inteiro: true,
      padrao: 21,
      status: 'pendente_decisao_cirurgiao',
      nota: 'Ruptura completa tratada como tardia/crônica quando os dias desde a lesão passam deste valor. '
        + 'Definições da literatura: >21 dias (21), >4 semanas (28) ou ≥6 semanas (41). '
        + 'Padrão provisório de 21 dias, pendente de decisão do cirurgião ou do serviço.',
      referencias: [{ ref: 'Kelly2000' }, { ref: 'Haverstock2017' }, { ref: 'Carlier2023' }, { ref: 'Greco2026' }, { ref: 'Schmidt2022' }],
    },
  ],
  entradas: [
    { id: 'dias_desde_lesao', rotulo: 'Dias desde a lesão', def: { tipo: 'numero', unidade: 'dias', min: 0, max: 3650 }, origem: { de: 'payload', caminho: 'avaliacaoPreop.EL_DBR.dias_desde_lesao_preop' }, momento: 'preop' },
    { id: 'tipo_ruptura', rotulo: 'Tipo de ruptura', def: { tipo: 'enum', valores: ['completa', 'parcial', 'tendinopatia', 'indeterminada'] }, origem: { de: 'payload', caminho: 'avaliacaoPreop.EL_DBR.tipo_rm' }, momento: 'preop' },
    { id: 'hook_test', rotulo: 'Hook test', def: { tipo: 'enum', valores: ['anormal', 'normal', 'normal_doloroso', 'nao_realizado'] }, origem: { de: 'payload', caminho: 'avaliacaoPreop.EL_DBR.hook_test' }, momento: 'preop' },
    { id: 'pct_ruptura_parcial_rm', rotulo: '% estimado de ruptura parcial na RM', def: { tipo: 'numero', unidade: '%', min: 0, max: 100 }, origem: { de: 'payload', caminho: 'avaliacaoPreop.EL_DBR.partial_pct_rm' }, momento: 'preop' },
    { id: 'rm_incidencia_fabs', rotulo: 'RM com incidência FABS', def: { tipo: 'booleano' }, origem: { de: 'manual' }, momento: 'preop' },
    { id: 'retracao_cm', rotulo: 'Retração na RM', def: { tipo: 'numero', unidade: 'cm', min: 0, max: 30 }, origem: { de: 'payload', caminho: 'avaliacaoPreop.EL_DBR.retracao_cm_rm' }, momento: 'preop' },
    { id: 'lacerto_fibroso', rotulo: 'Lacerto fibroso', def: { tipo: 'enum', valores: ['integro', 'roto', 'indeterminado'] }, origem: { de: 'payload', caminho: 'avaliacaoPreop.EL_DBR.lacerto_integro_rm' }, momento: 'preop' },
    { id: 'membro_dominante', rotulo: 'Lesão no membro dominante', def: { tipo: 'booleano' }, origem: { de: 'derivada', funcao: 'lado_dominante × lado da cirurgia', dependeDe: [] }, momento: 'preop' },
    { id: 'ocupacao', rotulo: 'Ocupação', def: { tipo: 'enum', valores: ['manual_pesado', 'atleta', 'sedentario', 'outro'] }, origem: { de: 'payload', caminho: 'avaliacaoPreop.EL_DBR.ocupacao_demanda' }, momento: 'preop' },
    { id: 'demanda_funcional', rotulo: 'Demanda funcional', def: { tipo: 'enum', valores: ['alta', 'baixa'] }, origem: { de: 'derivada', funcao: 'ocupacao_demanda ou nivel_atividade', dependeDe: [] }, momento: 'preop' },
    { id: 'prioridade_supinacao', rotulo: 'Prioridade do paciente para supinação', def: { tipo: 'enum', valores: ['alta', 'baixa', 'nao_informada'] }, origem: { de: 'payload', caminho: 'avaliacaoPreop.EL_DBR.necessidade_forca_supinacao' }, momento: 'preop' },
    { id: 'aceita_deficit_supinacao', rotulo: 'Paciente aceita o déficit de supinação', def: { tipo: 'booleano' }, origem: { de: 'manual' }, momento: 'preop' },
    { id: 'idade', rotulo: 'Idade', def: { tipo: 'numero', unidade: 'anos', min: 0, max: 120, inteiro: true }, origem: { de: 'paciente', campo: 'idade' }, momento: 'preop' },
    { id: 'tabagismo', rotulo: 'Tabagismo', def: { tipo: 'enum', valores: ['nunca', 'ex', 'atual'] }, origem: { de: 'payload', caminho: 'avaliacaoPreop.comum.tabagismo' }, momento: 'preop' },
    { id: 'diabetes', rotulo: 'Diabetes', def: { tipo: 'booleano' }, origem: { de: 'payload', caminho: 'avaliacaoPreop.comum.diabetes' }, momento: 'preop' },
    { id: 'dpoc', rotulo: 'DPOC', def: { tipo: 'booleano' }, origem: { de: 'manual' }, momento: 'preop' },
    { id: 'obesidade_classe', rotulo: 'Obesidade (classe)', def: { tipo: 'enum', valores: ['nao', 'I', 'II', 'III'] }, origem: { de: 'manual' }, momento: 'preop' },
    { id: 'asa', rotulo: 'ASA', def: { tipo: 'numero', min: 1, max: 5, inteiro: true }, origem: { de: 'manual' }, momento: 'preop' },
    { id: 'restricao_aine', rotulo: 'Restrição ao uso de AINE', def: { tipo: 'booleano' }, origem: { de: 'manual' }, momento: 'preop' },
    { id: 'workers_comp', rotulo: 'Afastamento/indenização por acidente de trabalho', def: { tipo: 'booleano' }, origem: { de: 'manual' }, momento: 'preop' },
    { id: 'via_planejada', rotulo: 'Via de acesso escolhida pelo cirurgião', def: { tipo: 'enum', valores: ['unica', 'dupla', 'nao_definida'] }, origem: { de: 'manual' }, momento: 'preop' },
  ],
  opcoes: [
    { id: 'complementar_rm', rotulo: 'Complementar a investigação com RM', naoCirurgica: true },
    { id: 'reparo_anatomico', rotulo: 'Reinserção anatômica', procedimentosIntraop: ['single_incision_repair', 'double_incision_repair'] },
    { id: 'nao_operatorio', rotulo: 'Tratamento não operatório', naoCirurgica: true },
    { id: 'incisao_unica', rotulo: 'Incisão única anterior', procedimentosIntraop: ['single_incision_repair'] },
    { id: 'incisao_dupla', rotulo: 'Dupla incisão', procedimentosIntraop: ['double_incision_repair'] },
    { id: 'profilaxia_oh_aine', rotulo: 'Profilaxia de ossificação heterotópica com AINE' },
    { id: 'sem_profilaxia_oh', rotulo: 'Sem profilaxia de rotina de ossificação heterotópica' },
    { id: 'planejar_enxerto', rotulo: 'Planejar disponibilidade de enxerto' },
    { id: 'reparo_alta_flexao', rotulo: 'Reparo direto em flexão (até 90°)' },
    { id: 'aumento_lacerto', rotulo: 'Aumento com lacerto fibroso' },
    { id: 'aloenxerto', rotulo: 'Reconstrução com aloenxerto', procedimentosIntraop: ['graft_reconstruction'] },
    { id: 'autoenxerto', rotulo: 'Reconstrução com autoenxerto', procedimentosIntraop: ['graft_reconstruction'] },
    { id: 'nao_operatorio_inicial', rotulo: 'Não operatório inicial (observação, fisioterapia ou injeção) com reavaliação', naoCirurgica: true },
    { id: 'reparo_parcial', rotulo: 'Completar a ruptura e reinserção anatômica', procedimentosIntraop: ['single_incision_repair', 'double_incision_repair'] },
    { id: 'imobilizacao_inicial', rotulo: 'Imobilização inicial no pós-operatório', naoCirurgica: true },
    { id: 'mobilizacao_precoce', rotulo: 'Mobilização precoce no pós-operatório', naoCirurgica: true },
    { id: 'def_cronica_21d', rotulo: 'Definição de crônica: >21 dias', naoCirurgica: true },
    { id: 'def_cronica_4sem', rotulo: 'Definição de crônica: >4 semanas', naoCirurgica: true },
    { id: 'def_cronica_6sem', rotulo: 'Definição de crônica: ≥6 semanas', naoCirurgica: true },
  ],
  regras: [
    // ---------- N1: confirmação diagnóstica ----------
    {
      id: 'DBR.N1.HOOK_ANORMAL', titulo: 'Hook test anormal',
      quando: { campo: 'hook_test', op: '==', valor: 'anormal' },
      efeitos: [], aviso: true,
      motivo: 'Hook test anormal: a favor de ruptura completa. A acurácia diverge entre as séries: sensibilidade e especificidade de 100% (n=45) × sensibilidade de 78% em todas as lesões, 83% nas completas e 30% nas parciais (n=202).',
      referencias: [{ ref: 'ODriscoll2007', nota: 'sens./espec. 100%/100%, n=45' }, { ref: 'Luokkala2019', nota: 'sens. 78/83/30%, n=202' }],
    },
    {
      id: 'DBR.N1.HOOK_NORMAL', titulo: 'Hook test normal não exclui ruptura',
      quando: HOOK_NORMAL,
      efeitos: [{ opcao: 'complementar_rm', efeito: 'favorece', forca: 'fraca' }],
      motivo: 'Hook test normal não exclui ruptura, sobretudo com lacerto íntegro. Sugestão: a literatura favorece complementar com RM quando o diagnóstico ainda não foi confirmado por imagem.',
      referencias: [{ ref: 'Luokkala2019', nota: 'hook normal não exclui ruptura' }, { ref: 'Vishwanathan2021', nota: 'RM (revisão narrativa)' }],
    },
    {
      id: 'DBR.N1.HOOK_DOLOROSO', titulo: 'Hook test normal e doloroso',
      quando: { campo: 'hook_test', op: '==', valor: 'normal_doloroso' },
      efeitos: [], aviso: true,
      motivo: 'Hook test normal com dor: sugere lesão parcial.',
      referencias: [{ ref: 'ODriscoll2007' }],
    },
    {
      id: 'DBR.N1.LACERTO_INTEGRO', titulo: 'Hook test normal com lacerto íntegro',
      quando: { all: [HOOK_NORMAL, { campo: 'lacerto_fibroso', op: '==', valor: 'integro' }] },
      efeitos: [], aviso: true,
      motivo: 'Cautela: com o lacerto fibroso íntegro, a sensibilidade do hook test caiu para 45% (n=202).',
      referencias: [{ ref: 'Luokkala2019', nota: 'sensibilidade 45% com lacerto íntegro' }],
    },

    // ---------- N2 ◆: classificação temporal ----------
    {
      id: 'DBR.N2.TEMPO', titulo: 'Classificação temporal da ruptura completa',
      quando: { all: [COMPLETA, { campo: 'dias_desde_lesao', op: '>=', valor: 0 }] },
      efeitos: [
        { opcao: 'def_cronica_21d', efeito: 'favorece', forca: 'fraca' },
        { opcao: 'def_cronica_4sem', efeito: 'favorece', forca: 'fraca' },
        { opcao: 'def_cronica_6sem', efeito: 'favorece', forca: 'fraca' },
      ],
      motivo: 'Lesão de {dias_desde_lesao}. Não existe definição única de "crônica": >21 dias, >4 semanas ou ≥6 semanas. Em série de via dupla (n=74), complicações de 24% com <10 dias, 38% com 10–21 dias e 41% com >21 dias. O corte aplicado pelo sistema é o parâmetro configurado pelo cirurgião.',
      referencias: [{ ref: 'Kelly2000', nota: 'estratos <10 d, 10–21 d, >21 d' }],
      controversia: {
        nota: 'Não há definição única de ruptura crônica. O sistema guarda os dias e mostra as definições sem escolher entre elas. A disponibilidade de enxerto para lesões >6 semanas (43% dos cirurgiões em survey) é prática, não limiar clínico.',
        alternativas: [
          { opcao: 'def_cronica_21d', argumento: '>21 dias = tardia/crônica.', referencias: [{ ref: 'Kelly2000' }, { ref: 'Haverstock2017' }, { ref: 'Carlier2023' }] },
          { opcao: 'def_cronica_4sem', argumento: '>4 semanas = crônica (nota técnica, n=6).', referencias: [{ ref: 'Greco2026' }] },
          { opcao: 'def_cronica_6sem', argumento: '≥6 semanas = crônica.', referencias: [{ ref: 'Schmidt2022' }, { ref: 'Rosenthal2023', nota: 'prática de survey, não limiar' }] },
        ],
      },
    },

    // ---------- A1: ruptura completa aguda, operatório × não operatório ----------
    {
      id: 'DBR.A1.OPERATORIO', titulo: 'Completa aguda com alta demanda ou prioridade de supinação',
      quando: { all: [COMPLETA, AGUDA, { any: [{ campo: 'demanda_funcional', op: '==', valor: 'alta' }, { campo: 'prioridade_supinacao', op: '==', valor: 'alta' }] }] },
      efeitos: [{ opcao: 'reparo_anatomico', efeito: 'favorece', forca: 'moderada' }],
      motivo: 'Sugestão: considerar reinserção anatômica; a literatura mostra melhor força de supinação e escores com cirurgia. Meta-análise (2402 operados × 79 não operados): operatório superior em força de flexão (diferença média 25,67%) e de supinação (27,56%), DASH (−7,81) e MEPS (+7,41). Sem cirurgia, supinação mediana de 63% × 92% em série com controles históricos.',
      referencias: [{ ref: 'Looney2022' }, { ref: 'Freeman2009' }, { ref: 'Vishwanathan2021' }],
    },
    {
      id: 'DBR.A1.NAO_OPERATORIO', titulo: 'Completa aguda, baixa demanda, déficit aceito',
      quando: { all: [COMPLETA, AGUDA, { campo: 'demanda_funcional', op: '==', valor: 'baixa' }, { campo: 'prioridade_supinacao', op: '==', valor: 'baixa' }, { campo: 'aceita_deficit_supinacao', op: '==', valor: true }] },
      efeitos: [{ opcao: 'nao_operatorio', efeito: 'favorece', forca: 'fraca' }],
      motivo: 'O tratamento não operatório é opção aceitável; espere déficit de supinação (mediana ~63% do contralateral em uma série) com escores funcionais satisfatórios (DASH 10,90 em não operados, n=15).',
      referencias: [{ ref: 'Freeman2009' }, { ref: 'Vishwanathan2021' }, { ref: 'Saini2026' }],
    },
    {
      id: 'DBR.A1.ZC_BAIXA_DEMANDA', titulo: 'Operar ou não em baixa demanda (zona cinzenta)',
      quando: { all: [COMPLETA, AGUDA, { campo: 'demanda_funcional', op: '==', valor: 'baixa' }, { campo: 'prioridade_supinacao', op: 'in', valores: ['baixa', 'nao_informada'] }] },
      efeitos: [
        { opcao: 'reparo_anatomico', efeito: 'favorece', forca: 'fraca' },
        { opcao: 'nao_operatorio', efeito: 'favorece', forca: 'fraca' },
      ],
      motivo: 'Ruptura completa aguda em paciente de baixa demanda: decisão compartilhada. O déficit de supinação sem cirurgia é consistente; o déficit de flexão diverge entre as fontes; o ganho nos escores com cirurgia é real, mas pequeno.',
      referencias: [{ ref: 'Looney2022' }, { ref: 'Freeman2009' }, { ref: 'Saini2026' }],
      controversia: {
        nota: 'Decisão compartilhada. O peso da dominância do membro não é quantificado por nenhum estudo verificado: fica com o cirurgião.',
        alternativas: [
          { opcao: 'reparo_anatomico', argumento: 'Operatório superior em força de supinação (27,56%) e flexão (25,67%), DASH −7,81 e MEPS +7,41 (meta-análise; não operados 100% homens, n=79).', referencias: [{ ref: 'Looney2022' }] },
          { opcao: 'nao_operatorio', argumento: 'Supinação mediana 63% × 92% e flexão 93% × 95% (sem diferença significativa) em 20 rupturas; DASH 10,90 e déficit de flexão 16,4% em não operados (n=15).', referencias: [{ ref: 'Freeman2009' }, { ref: 'Saini2026' }] },
        ],
      },
    },

    // ---------- A2: modificadores de risco (não bloqueiam a cirurgia) ----------
    {
      id: 'DBR.A2.IDADE', titulo: 'Idade ≥65 anos',
      quando: { all: [COMPLETA, AGUDA, { campo: 'idade', op: '>=', valor: 65 }] },
      efeitos: [], aviso: true,
      motivo: 'Idade {idade}: em coorte pareada (163 × 163), sem diferença em complicação maior (6,1% × 6,7%) nem em rerruptura (3,1% × 3,7%) entre ≥65 anos e mais jovens. A idade isolada não impediu o reparo em paciente selecionado.',
      referencias: [{ ref: 'Dib2026' }],
    },
    {
      id: 'DBR.A2.DPOC', titulo: 'DPOC',
      quando: { all: [COMPLETA, AGUDA, { campo: 'dpoc', op: '==', valor: true }] },
      efeitos: [], aviso: true,
      motivo: 'Cautela: DPOC associada a complicação cirúrgica em 30 dias (RR 21,98; NSQIP). Taxas absolutas baixas (0,5%); dados só de 30 dias.',
      referencias: [{ ref: 'Goedderz2022' }],
    },
    {
      id: 'DBR.A2.OBESIDADE_II', titulo: 'Obesidade classe II',
      quando: { all: [COMPLETA, AGUDA, { campo: 'obesidade_classe', op: '==', valor: 'II' }] },
      efeitos: [], aviso: true,
      motivo: 'Cautela: obesidade classe II associada a complicação cirúrgica em 30 dias (RR 4,12; NSQIP). Taxas absolutas baixas (0,5%); dados só de 30 dias.',
      referencias: [{ ref: 'Goedderz2022' }],
    },
    {
      id: 'DBR.A2.DIABETES', titulo: 'Diabetes',
      quando: { all: [COMPLETA, AGUDA, { campo: 'diabetes', op: '==', valor: true }] },
      efeitos: [], aviso: true,
      motivo: 'Cautela: diabetes associado a readmissão em 30 dias (RR 4,24; NSQIP). Taxas absolutas baixas (0,5%); dados só de 30 dias.',
      referencias: [{ ref: 'Goedderz2022' }],
    },
    {
      id: 'DBR.A2.EX_TABAGISTA', titulo: 'Ex-tabagista',
      quando: { all: [COMPLETA, AGUDA, { campo: 'tabagismo', op: '==', valor: 'ex' }] },
      efeitos: [], aviso: true,
      motivo: 'Em pacientes operados, força de supinação de 93,2% em ex-fumantes × 99,5% em não fumantes (p=0,009).',
      referencias: [{ ref: 'Kallhovd2025' }],
    },

    // ---------- A3 ◆: via de acesso ----------
    {
      id: 'DBR.A3.VIA', titulo: 'Via de acesso: incisão única × dupla (zona cinzenta)',
      quando: COMPLETA,
      efeitos: [
        { opcao: 'incisao_unica', efeito: 'favorece', forca: 'moderada' },
        { opcao: 'incisao_dupla', efeito: 'favorece', forca: 'moderada' },
      ],
      motivo: 'Via de acesso: veja o quadro comparativo (incisão única × dupla). Decisão do cirurgião. DASH e escores sem diferença (diferença mínima de −1,08 em uma meta-análise). Em survey, 70% usam incisão única e 30% dupla: é prática, não evidência.',
      referencias: [{ ref: 'Castioni2020' }, { ref: 'Grewal2012' }, { ref: 'Awad2025' }, { ref: 'Rosenthal2023', nota: 'preferência em survey' }],
      controversia: {
        nota: 'Troca entre nervos sensitivos (NCLA/NRS) e OH/sinostose; a força de flexão é conflitante entre o ECR e a meta-análise. NIP: sem diferença em uma revisão (2,2% × 1,2%) e RR 0,48 em outra.',
        alternativas: [
          {
            opcao: 'incisao_unica',
            argumento: 'Menos OH (1,3% × 2,7%; OR 0,43; RR 0,51) e sinostose (RR 0,07); mais flexão (+8,18°) e pronação (+4,29°); força isométrica de flexão +6% na meta-análise. Cautela: mais lesão do NCLA (19,5% × 5,2%; OR 4,24; RR 4,45; no ECR 19/47 × 3/43) e do NRS (4,8% × 2,5%; RR 2,74).',
            referencias: [{ ref: 'Hurley2022' }, { ref: 'Castioni2020' }, { ref: 'Awad2025' }, { ref: 'Grewal2012' }],
          },
          {
            opcao: 'incisao_dupla',
            argumento: 'No ECR, flexão isométrica final 104% × 94% (única diferença de desfecho; âncoras na incisão única × túneis na dupla); menos complicações totais (16,1% × 23,1%). Cautela: mais OH e sinostose (2,8%; OR 19).',
            referencias: [{ ref: 'Grewal2012' }, { ref: 'Hurley2022' }, { ref: 'Ford2018' }],
          },
        ],
      },
    },

    // ---------- A4: fixação (informativo) ----------
    {
      id: 'DBR.A4.FIXACAO', titulo: 'Fixação (informativo)',
      quando: COMPLETA,
      efeitos: [], aviso: true,
      motivo: 'Botão cortical + parafuso de interferência: falha precoce de 1,2% (2/170) em série. No ECR, as 4 rerrupturas foram por não adesão ou retrauma, sem atribuição à técnica. Comparação biomecânica entre fixações não exibida nesta versão.',
      referencias: [{ ref: 'Cusick2014' }, { ref: 'Grewal2012' }],
    },

    // ---------- A5 ◆: profilaxia de OH (só na via dupla) ----------
    {
      id: 'DBR.A5.PROFILAXIA_OH', titulo: 'Profilaxia de OH na via dupla (zona cinzenta)',
      quando: { campo: 'via_planejada', op: '==', valor: 'dupla' },
      efeitos: [
        { opcao: 'profilaxia_oh_aine', efeito: 'favorece', forca: 'fraca' },
        { opcao: 'sem_profilaxia_oh', efeito: 'favorece', forca: 'fraca' },
      ],
      motivo: 'Profilaxia de OH com AINE: dado de série sem controle; decisão do cirurgião.',
      referencias: [{ ref: 'Anakwenze2011' }],
      controversia: {
        nota: 'Única fonte verificada é uma série sem grupo controle. O esquema de dose da série requer o texto completo e não é exibido.',
        alternativas: [
          { opcao: 'profilaxia_oh_aine', argumento: 'Série de 34 casos com dupla incisão e 6 semanas de indometacina: nenhum caso de OH, sem grupo controle.', referencias: [{ ref: 'Anakwenze2011' }] },
          { opcao: 'sem_profilaxia_oh', argumento: 'Sem comparação controlada que mostre benefício; OH de 2,7% na via dupla em revisão.', referencias: [{ ref: 'Anakwenze2011' }, { ref: 'Hurley2022' }] },
        ],
      },
    },
    {
      id: 'DBR.A5.RESTRICAO_AINE', titulo: 'Restrição a AINE com via dupla',
      quando: { all: [{ campo: 'via_planejada', op: '==', valor: 'dupla' }, { campo: 'restricao_aine', op: '==', valor: true }] },
      efeitos: [], aviso: true,
      motivo: 'Cautela: restrição ao uso de AINE registrada; considerar na alternativa de profilaxia de OH com AINE.',
      referencias: [{ ref: 'Anakwenze2011' }],
    },

    // ---------- B: ruptura completa tardia/crônica ----------
    {
      id: 'DBR.B1.EXPECTATIVA', titulo: 'Reparabilidade e complicações na lesão tardia',
      quando: { all: [COMPLETA, CRONICA] },
      efeitos: [], aviso: true,
      motivo: 'Reparo primário tardio (>21 dias) com desfecho funcional semelhante ao agudo em duas séries (16 × 48; 75 × 135, força de flexão 89% e supinação 77% nos dois grupos). Complicações: a literatura diverge (63% × 29%, 90% parestesias transitórias; 47% com ≥6 semanas; 41% com >21 dias; em outra série, iguais e com mais OH no grupo agudo).',
      referencias: [{ ref: 'Haverstock2017' }, { ref: 'Carlier2023' }, { ref: 'Schmidt2022' }, { ref: 'Kelly2000' }],
    },
    {
      id: 'DBR.B1.ENXERTO_HOOK_ANORMAL', titulo: 'Hook test anormal e ≥8 semanas',
      quando: { all: [COMPLETA, { campo: 'hook_test', op: '==', valor: 'anormal' }, { campo: 'dias_desde_lesao', op: '>=', valor: 56 }] },
      efeitos: [{ opcao: 'planejar_enxerto', efeito: 'favorece', forca: 'fraca' }],
      motivo: 'Hook test positivo + ≥8 semanas ({dias_desde_lesao}): em uma série, >75% precisaram de aloenxerto. Planeje a disponibilidade de enxerto.',
      referencias: [{ ref: 'Luokkala2019' }],
    },
    {
      id: 'DBR.B1.ENXERTO_HOOK_NORMAL', titulo: 'Hook test normal e ≥12 semanas',
      quando: { all: [COMPLETA, HOOK_NORMAL, { campo: 'dias_desde_lesao', op: '>=', valor: 84 }] },
      efeitos: [], aviso: true,
      motivo: 'Hook test negativo: na mesma série, ~20% precisaram de reconstrução com aloenxerto mesmo após 12 semanas.',
      referencias: [{ ref: 'Luokkala2019' }],
    },
    {
      id: 'DBR.B1.RETRACAO', titulo: 'Retração ≥7 cm (descritivo)',
      quando: { all: [COMPLETA, { campo: 'retracao_cm', op: '>=', valor: 7 }] },
      efeitos: [], aviso: true,
      motivo: 'Retração de {retracao_cm}: o padrão turtle neck (≥7 cm) associou-se a lacerto roto (100% × 37%), sem diferença significativa de reparabilidade (n=37). 7 cm é ponto descritivo de classificação, não limiar de enxerto.',
      referencias: [{ ref: 'Boonrod2022' }],
    },
    {
      id: 'DBR.B2.TECNICA', titulo: 'Técnica na lesão crônica (zona cinzenta)',
      quando: { all: [COMPLETA, CRONICA] },
      efeitos: [
        { opcao: 'reparo_alta_flexao', efeito: 'favorece', forca: 'fraca' },
        { opcao: 'aumento_lacerto', efeito: 'favorece', forca: 'fraca' },
        { opcao: 'aloenxerto', efeito: 'favorece', forca: 'fraca' },
        { opcao: 'autoenxerto', efeito: 'favorece', forca: 'fraca' },
      ],
      motivo: 'Opções: reparo direto em flexão (até 90°), aumento com lacerto (se íntegro), aloenxerto ou autoenxerto. Desfechos semelhantes; complicações maiores com autoenxerto (34% × 14%) e fixação weave (34% × onlay 9%). MEPS 86–100 com qualquer técnica (22 estudos, n=236, sem nível I/II).',
      referencias: [{ ref: 'Litowski2021' }, { ref: 'Synovec2022' }],
      controversia: {
        nota: 'Quatro alternativas sem ordem de preferência. Quanta flexão aceitar no intraoperatório é decisão do cirurgião (a literatura descreve até 90°).',
        alternativas: [
          { opcao: 'reparo_alta_flexao', argumento: 'Reinserção anatômica com o cotovelo em >60° até 90°: n=23 (19 crônicas), enxerto em 1, MEPS 100 em todos; flexão média necessária de 64° e complicações de 47% em ≥6 semanas sem enxerto (n=30).', referencias: [{ ref: 'MorreyME2014' }, { ref: 'Schmidt2022' }, { ref: 'Saini2026' }] },
          { opcao: 'aumento_lacerto', argumento: 'Se o lacerto estiver íntegro: 12/12 sem complicação; n=4, MEPS 95, ganho de até 2,5 cm; em cadáver, carga de falha menor que a do tendão nativo (377 × 462 N). Os autores sugerem US pré-operatório para avaliar o lacerto.', referencias: [{ ref: 'Caputo2016' }, { ref: 'Fontana2016' }, { ref: 'LeVasseur2022' }] },
          { opcao: 'aloenxerto', argumento: 'Complicações de 14% × 34% com autoenxerto (revisão sistemática); eventos adversos 7% × 19% no reparo direto (ajustado OR 0,35, sem significância).', referencias: [{ ref: 'Litowski2021' }, { ref: 'Luokkala2021' }] },
          { opcao: 'autoenxerto', argumento: 'Sem diferença em ADM, força e escores; mais de 50% das complicações do autoenxerto vêm da área doadora.', referencias: [{ ref: 'Litowski2021' }, { ref: 'Synovec2022' }] },
        ],
      },
    },
    {
      id: 'DBR.B2.LACERTO_ROTO', titulo: 'Lacerto roto na lesão crônica',
      quando: { all: [COMPLETA, CRONICA, { campo: 'lacerto_fibroso', op: '==', valor: 'roto' }] },
      efeitos: [], aviso: true,
      motivo: 'Cautela: lacerto fibroso registrado como roto; a alternativa de aumento com lacerto pressupõe lacerto íntegro.',
      referencias: [{ ref: 'Caputo2016' }, { ref: 'Fontana2016' }],
    },
    {
      id: 'DBR.B3.NAO_OPERATORIO', titulo: 'Não operatório na lesão crônica',
      quando: { all: [COMPLETA, CRONICA] },
      efeitos: [], aviso: true,
      motivo: 'Não operatório na lesão crônica: os dados de déficit (supinação mediana 63% × 92%; perda média de ~40% da supinação em n=3) vêm de séries que incluem tratamento tardio ou nenhum; DASH 10,90 em não operados (n=15).',
      referencias: [{ ref: 'Freeman2009' }, { ref: 'Morrey1985' }, { ref: 'Saini2026' }],
    },

    // ---------- C: ruptura parcial ----------
    {
      id: 'DBR.C1.AVISO_RM', titulo: 'Confiabilidade do % na RM',
      quando: { any: [PARCIAL, { campo: 'pct_ruptura_parcial_rm', op: '>=', valor: 0 }] },
      efeitos: [], aviso: true,
      motivo: `Cautela: ${AVISO_RM_PCT}`,
      referencias: [{ ref: 'Plusch2025' }],
    },
    {
      id: 'DBR.C2.TRATAMENTO', titulo: 'Tratamento inicial da ruptura parcial (zona cinzenta)',
      quando: PARCIAL,
      efeitos: [
        { opcao: 'nao_operatorio_inicial', efeito: 'favorece', forca: 'fraca' },
        { opcao: 'reparo_parcial', efeito: 'favorece', forca: 'fraca' },
      ],
      motivo: `Parcial: opções de não operatório inicial com reavaliação, ou reparo. Não operatório: sucesso de 47% aos 6 meses; 55,7% dos que tentaram acabaram operados; nenhuma parcial progrediu para completa; tentar antes não piorou a satisfação após a cirurgia. Duração mínima do não operatório não definida na literatura: reavaliação a critério do cirurgião. ${AVISO_RM_PCT}`,
      referencias: [{ ref: 'Jansen2025' }, { ref: 'Bauer2018' }, { ref: 'Behun2016' }, { ref: 'Plusch2025' }],
      controversia: {
        nota: 'Não há comparação controlada. Mais coerente com não operatório inicial: baixa demanda, % baixo ou incerto. Mais coerente com reparo: alta demanda, % >50% na RM, falha do não operatório.',
        alternativas: [
          { opcao: 'nao_operatorio_inicial', argumento: 'Sucesso de 47% aos 6 meses (injeção 50%, fisioterapia 46%, observação 46%); operar depois de falhar funcionou.', referencias: [{ ref: 'Jansen2025' }, { ref: 'Bauer2018' }] },
          { opcao: 'reparo_parcial', argumento: '94% de resultados satisfatórios (n=86); QuickDASH mediano 2,3 (n=74); 95% dos cirurgiões em survey operariam parcial sintomática confirmada na imagem.', referencias: [{ ref: 'Behun2016' }, { ref: 'Schmidt2023' }, { ref: 'Rosenthal2023' }] },
        ],
      },
    },
    {
      id: 'DBR.C2.PCT_ACIMA_50', titulo: 'Parcial >50% na RM',
      quando: { all: [PARCIAL, { campo: 'pct_ruptura_parcial_rm', op: '>', valor: 50 }] },
      efeitos: [{ opcao: 'reparo_parcial', efeito: 'favorece', forca: 'fraca' }],
      motivo: `Ruptura parcial estimada em {pct_ruptura_parcial_rm} na RM. Tear >50% na RM foi preditor de falha do não operatório em uma série (OR 3,0; n=132). ${AVISO_RM_PCT}`,
      referencias: [{ ref: 'Bauer2018' }, { ref: 'Bain2008' }, { ref: 'Plusch2025' }],
      controversia: {
        nota: 'Limiar de 50% controverso: opinião e uma série a favor; outra série não encontrou influência do grau.',
        alternativas: [
          { opcao: 'reparo_parcial', argumento: '>50% prediz falha do não operatório (OR 3,0); em opinião, >50% → completar a ruptura e reparar.', referencias: [{ ref: 'Bauer2018' }, { ref: 'Bain2008' }] },
          { opcao: 'nao_operatorio_inicial', argumento: 'O grau da lesão não influenciou o sucesso do não operatório (n=78).', referencias: [{ ref: 'Jansen2025' }] },
        ],
      },
    },
    {
      id: 'DBR.C2.PCT_ABAIXO_50', titulo: 'Parcial <50% na RM',
      quando: { all: [PARCIAL, { campo: 'pct_ruptura_parcial_rm', op: '<', valor: 50 }] },
      efeitos: [{ opcao: 'nao_operatorio_inicial', efeito: 'favorece', forca: 'fraca' }],
      motivo: `Ruptura parcial estimada em {pct_ruptura_parcial_rm} na RM. Em opinião de especialistas, <50% → não operatório ou desbridamento. ${AVISO_RM_PCT}`,
      referencias: [{ ref: 'Bain2008' }, { ref: 'Plusch2025' }],
      controversia: {
        nota: 'Limiar de 50% controverso; a evidência para <50% é opinião.',
        alternativas: [
          { opcao: 'nao_operatorio_inicial', argumento: 'Opinião: <50% → não operatório ou desbridamento; o grau não influenciou o sucesso do não operatório (n=78).', referencias: [{ ref: 'Bain2008' }, { ref: 'Jansen2025' }] },
          { opcao: 'reparo_parcial', argumento: '55,7% dos que tentaram o não operatório acabaram operados (n=132).', referencias: [{ ref: 'Bauer2018' }] },
        ],
      },
    },
    {
      id: 'DBR.C2.DEMANDA_ALTA', titulo: 'Parcial com alta demanda',
      quando: { all: [PARCIAL, { campo: 'demanda_funcional', op: '==', valor: 'alta' }] },
      efeitos: [{ opcao: 'reparo_parcial', efeito: 'favorece', forca: 'fraca' }],
      motivo: 'Ocupação de alta demanda: melhor recuperação percebida com cirurgia (OR 11,58) em uma série; revisões descrevem o operatório como frequente sobretudo em alta demanda.',
      referencias: [{ ref: 'Bauer2018' }, { ref: 'Sebastiani2026' }],
    },
    {
      id: 'DBR.C2.DEMANDA_BAIXA', titulo: 'Parcial com baixa demanda',
      quando: { all: [PARCIAL, { campo: 'demanda_funcional', op: '==', valor: 'baixa' }] },
      efeitos: [{ opcao: 'nao_operatorio_inicial', efeito: 'favorece', forca: 'fraca' }],
      motivo: 'Baixa demanda: revisões descrevem o não operatório inicial como abordagem comum.',
      referencias: [{ ref: 'Sebastiani2026' }],
    },
    {
      id: 'DBR.C3.RESULTADOS', titulo: 'Resultados cirúrgicos na parcial (informativo)',
      quando: PARCIAL,
      efeitos: [], aviso: true,
      motivo: 'Reparo da parcial: 94% de resultados satisfatórios, NCLA 17%, NIP 6% (n=86); QuickDASH mediano 2,3, complicações 34%, a maioria neuropraxias (n=74). Não operatório: menos força, menos complicações e satisfação semelhante ou maior.',
      referencias: [{ ref: 'Behun2016' }, { ref: 'Schmidt2023' }, { ref: 'Hopper2024' }],
    },

    // ---------- D1 ◆: pós-operatório ----------
    {
      id: 'DBR.D1.REABILITACAO', titulo: 'Imobilização × mobilização precoce (zona cinzenta)',
      quando: COMPLETA_OU_PARCIAL,
      efeitos: [
        { opcao: 'imobilizacao_inicial', efeito: 'favorece', forca: 'moderada' },
        { opcao: 'mobilizacao_precoce', efeito: 'favorece', forca: 'moderada' },
      ],
      motivo: 'Reabilitação: meta-análises não mostram diferença de rerruptura entre imobilização e mobilização precoce (evidência de baixa qualidade).',
      referencias: [{ ref: 'Schonweger2026' }, { ref: 'Simpson2025' }],
      controversia: {
        nota: 'Protocolo pós-operatório e tipo de imobilizador são decisão do cirurgião. Em survey, 14% (gesso), 29% (tala/órtese), 49% (tipoia) e 100% (sem imobilização) dos cirurgiões já viram alguma rerruptura: não são taxas de rerruptura.',
        alternativas: [
          { opcao: 'imobilizacao_inicial', argumento: '50 estudos, 1577 pacientes: sem diferença em rerruptura, DASH ou força; o tipo de imobilizador (tala, tipoia, órtese articulada) não importou.', referencias: [{ ref: 'Schonweger2026' }, { ref: 'Rosenthal2023' }] },
          { opcao: 'mobilizacao_precoce', argumento: '26 estudos, 1114 pacientes: sem diferença clinicamente significativa; cautela: menos pronação e supinação com mobilização precoce.', referencias: [{ ref: 'Simpson2025' }] },
        ],
      },
    },
    {
      id: 'DBR.D1.WORKERS_COMP', titulo: 'Acidente de trabalho e rerruptura',
      quando: { all: [COMPLETA_OU_PARCIAL, { campo: 'workers_comp', op: '==', valor: true }] },
      efeitos: [], aviso: true,
      motivo: 'Cautela: rerrupturas associadas a contração forçada precoce (<4 semanas), acidente de trabalho com indenização e não adesão ao protocolo.',
      referencias: [{ ref: 'Li2023' }, { ref: 'Grewal2012' }],
    },

    // ---------- E: complicações esperadas (consentimento) ----------
    {
      id: 'DBR.E.COMPLICACOES', titulo: 'Complicações esperadas (consentimento)',
      quando: COMPLETA,
      efeitos: [], aviso: true,
      motivo: 'Coorte de 970 reparos: complicação maior 7,5%; reoperação 4,5%; rerruptura 1,6%; NIP 1,9%; sinostose 1,0%; OH/perda de ADM com reoperação 0,9%; infecção profunda 0,5%; SDRC 0,6%.',
      referencias: [{ ref: 'Ford2018' }],
    },
  ],
  referencias: [
    { id: 'Rosenthal2023', citacao: 'Rosenthal R, Ting RS, Sher D. J Shoulder Elbow Surg. 2023;32(10):e495-e503.', pmid: '37414354', doi: '10.1016/j.jse.2023.05.034', nivel: 'V', tipo: 'opiniao' },
    { id: 'Boonrod2022', citacao: 'Boonrod A, et al. The Turtle Neck Sign. Orthop J Sports Med. 2022;10(1).', pmid: '35071656', doi: '10.1177/23259671211065030', nivel: 'IV', tipo: 'serie_casos' },
    { id: 'Looney2022', citacao: 'Looney AM, et al. J Shoulder Elbow Surg. 2022;31(4):e169-e189.', pmid: '34999236', doi: '10.1016/j.jse.2021.12.001', nivel: 'III', tipo: 'metanalise' },
    { id: 'Ford2018', citacao: 'Ford SE, et al. J Shoulder Elbow Surg. 2018;27(10):1898-1906.', pmid: '30139681', doi: '10.1016/j.jse.2018.06.028', nivel: 'III', tipo: 'coorte' },
    { id: 'Cusick2014', citacao: 'Cusick MC, et al. J Shoulder Elbow Surg. 2014;23(10):1532-6.', pmid: '25220201', doi: '10.1016/j.jse.2014.04.013', nivel: 'IV', tipo: 'serie_casos' },
    { id: 'Awad2025', citacao: 'Awad G, et al. Shoulder Elbow. 2025;18(4).', pmid: '41446035', doi: '10.1177/17585732251399838', nivel: 'III', tipo: 'metanalise' },
    { id: 'Hurley2022', citacao: 'Hurley ET, et al. Bull Hosp Jt Dis (2013). 2022;80(3):270-276.', pmid: '36030447', nivel: 'III', tipo: 'revisao_sistematica' },
    { id: 'Anakwenze2011', citacao: 'Anakwenze OA, et al. Orthopedics. 2011;34(11):e724-9.', pmid: '22049953', doi: '10.3928/01477447-20110922-10', nivel: 'IV', tipo: 'serie_casos' },
    { id: 'Behun2016', citacao: 'Behun MA, et al. J Hand Surg Am. 2016;41(7):e175-89.', pmid: '27212410', doi: '10.1016/j.jhsa.2016.04.019', nivel: 'IV', tipo: 'revisao_sistematica' },
    { id: 'Synovec2022', citacao: 'Synovec JD, et al. JSES Rev Rep Tech. 2022;2(3):323-331.', pmid: '37588857', doi: '10.1016/j.xrrt.2022.02.007', nivel: 'IV', tipo: 'revisao_sistematica' },
    { id: 'LeVasseur2022', citacao: 'LeVasseur MR, et al. Am J Sports Med. 2022;50(3):725-730.', pmid: '34986047', doi: '10.1177/03635465211065450', nivel: 'V', tipo: 'biomecanico' },
    { id: 'Fontana2016', citacao: 'Fontana M, et al. Musculoskelet Surg. 2016;100(Suppl 1):85-88.', pmid: '27900711', doi: '10.1007/s12306-016-0435-y', nivel: 'IV', tipo: 'serie_casos' },
    { id: 'Caputo2016', citacao: 'Caputo AE, et al. J Shoulder Elbow Surg. 2016;25(7):1189-94.', pmid: '27066965', doi: '10.1016/j.jse.2016.02.005', nivel: 'IV', tipo: 'serie_casos' },
    { id: 'Vishwanathan2021', citacao: 'Vishwanathan K, Soni K. J Clin Orthop Trauma. 2021;19:132-138.', pmid: '34099972', doi: '10.1016/j.jcot.2021.05.012', nivel: 'V', tipo: 'opiniao' },
    { id: 'Saini2026', citacao: 'Saini J, et al. JSES Rev Rep Tech. 2026;6(3):100728.', pmid: '42016542', doi: '10.1016/j.xrrt.2026.100728', nivel: 'III', tipo: 'coorte' },
    { id: 'Dib2026', citacao: 'Dib A, et al. J Shoulder Elbow Surg. 2026.', pmid: '42128288', doi: '10.1016/j.jse.2026.04.054', nivel: 'III', tipo: 'coorte' },
    { id: 'Castioni2020', citacao: 'Castioni D, et al. Bone Joint J. 2020;102-B(12):1608-1617.', pmid: '33249900', doi: '10.1302/0301-620X.102B12.BJJ-2020-0822.R2', nivel: 'III', tipo: 'metanalise' },
    { id: 'Grewal2012', citacao: 'Grewal R, et al. J Bone Joint Surg Am. 2012;94(13):1166-74.', pmid: '22760383', doi: '10.2106/JBJS.K.00436', nivel: 'I', tipo: 'ECR' },
    { id: 'Litowski2021', citacao: 'Litowski ML, et al. JSES Int. 2021;5(1):24-30.', pmid: '33554159', doi: '10.1016/j.jseint.2020.09.010', nivel: 'IV', tipo: 'revisao_sistematica' },
    { id: 'Sebastiani2026', citacao: 'Sebastiani RS, et al. JSES Rev Rep Tech. 2026;6(3):100770.', pmid: '42305929', doi: '10.1016/j.xrrt.2026.100770', nivel: 'V', tipo: 'opiniao' },
    { id: 'Schonweger2026', citacao: 'Schönweger F, et al. EFORT Open Rev. 2026;11(7):849-858.', pmid: '42383714', doi: '10.1530/EOR-2025-0152', nivel: 'IV', tipo: 'metanalise' },
    { id: 'Morrey1985', citacao: 'Morrey BF, Askew LJ, An KN, Dobyns JH. Rupture of the distal tendon of the biceps brachii. A biomechanical study. J Bone Joint Surg Am. 1985;67(3):418-21.', pmid: '3972866', nivel: 'IV', tipo: 'serie_casos' },
    { id: 'Freeman2009', citacao: 'Freeman CR, et al. Nonoperative treatment of distal biceps tendon ruptures compared with a historical control group. J Bone Joint Surg Am. 2009;91(10):2329-34.', pmid: '19797566', doi: '10.2106/JBJS.H.01150', nivel: 'III', tipo: 'coorte' },
    { id: 'MorreyME2014', citacao: 'Morrey ME, Abdel MP, Sanchez-Sotelo J, Morrey BF. Primary repair of retracted distal biceps tendon ruptures in extreme flexion. J Shoulder Elbow Surg. 2014;23(5):679-85.', pmid: '24745316', doi: '10.1016/j.jse.2013.12.030', nivel: 'IV', tipo: 'serie_casos' },
    { id: 'ODriscoll2007', citacao: "O'Driscoll SW, et al. The hook test for distal biceps tendon avulsion. Am J Sports Med. 2007;35(11):1865-9.", pmid: '17687121', doi: '10.1177/0363546507305016', nivel: 'III', tipo: 'coorte' },
    { id: 'Luokkala2019', citacao: 'Luokkala T, et al. Hook test sensitivity and need for graft reconstruction. Shoulder Elbow. 2019;12(4):294-298.', pmid: '32788933', doi: '10.1177/1758573219847146', nivel: 'III', tipo: 'coorte' },
    { id: 'Kelly2000', citacao: "Kelly EW, Morrey BF, O'Driscoll SW. Complications of repair of the distal biceps tendon with the modified two-incision technique. J Bone Joint Surg Am. 2000;82(11):1575-81.", pmid: '11097447', doi: '10.2106/00004623-200011000-00010', nivel: 'IV', tipo: 'serie_casos' },
    { id: 'Haverstock2017', citacao: 'Haverstock J, et al. Delayed repair of distal biceps tendon ruptures is successful. J Shoulder Elbow Surg. 2017;26(6):1031-1036.', pmid: '28526421', doi: '10.1016/j.jse.2017.02.025', nivel: 'III', tipo: 'coorte' },
    { id: 'Carlier2023', citacao: 'Carlier Y, Pierreux PA. Primary repair of acute versus chronic ruptures. Orthop Traumatol Surg Res. 2023;109(5):103559.', pmid: '36690325', doi: '10.1016/j.otsr.2023.103559', nivel: 'III', tipo: 'coorte' },
    { id: 'Schmidt2022', citacao: 'Schmidt GJ, et al. Primary Repair of Chronic Distal Biceps Tendon Tears. Hand (N Y). 2022;19(1):38-43.', pmid: '35815641', doi: '10.1177/15589447221107691', nivel: 'IV', tipo: 'serie_casos' },
    { id: 'Greco2026', citacao: 'Greco A, et al. Tech Hand Up Extrem Surg. 2026;30(2).', pmid: '41943616', doi: '10.1097/BTH.0000000000000556', nivel: 'V', tipo: 'opiniao' },
    { id: 'Bauer2018', citacao: 'Bauer TM, Wong JC, Lazarus MD. Is nonoperative management of partial distal biceps tears really successful? J Shoulder Elbow Surg. 2018;27(4):720-725.', pmid: '29396100', doi: '10.1016/j.jse.2017.12.010', nivel: 'III', tipo: 'coorte' },
    { id: 'Bain2008', citacao: 'Bain GI, Johnson LJ, Turner PC. Treatment of partial distal biceps tendon tears. Sports Med Arthrosc Rev. 2008;16(3):154-61.', pmid: '18703975', doi: '10.1097/JSA.0b013e318183eb60', nivel: 'V', tipo: 'opiniao' },
    { id: 'Plusch2025', citacao: 'Plusch K, et al. Reliability of classifying percentage of tearing on MRI. Hand (N Y). 2025;21(7):1174-1177.', pmid: '40654308', doi: '10.1177/15589447251352005', nivel: 'III', tipo: 'coorte' },
    { id: 'Jansen2025', citacao: 'Jansen N, et al. Conservative treatment strategies for partial tears. J Shoulder Elbow Surg. 2025;35(1):331-337.', pmid: '40441406', doi: '10.1016/j.jse.2025.04.017', nivel: 'III', tipo: 'coorte' },
    { id: 'Hopper2024', citacao: 'Hopper HM, et al. Orthop Rev (Pavia). 2024;16:116367.', pmid: '39006104', doi: '10.52965/001c.116367', nivel: 'IV', tipo: 'revisao_sistematica' },
    { id: 'Schmidt2023', citacao: 'Schmidt GJ, et al. Clinical outcomes of surgical repair for partial tears. J Hand Surg Am. 2023;49(9):930.e1-e8.', pmid: '36604201', doi: '10.1016/j.jhsa.2022.11.015', nivel: 'IV', tipo: 'serie_casos' },
    { id: 'Kallhovd2025', citacao: 'Kallhovd G, et al. Acute repair single vs double incision. Shoulder Elbow. 2025;18(3):583-590.', pmid: '40635971', doi: '10.1177/17585732251352745', nivel: 'III', tipo: 'coorte' },
    { id: 'Simpson2025', citacao: 'Simpson ER, et al. Early vs delayed mobilization. Am J Sports Med. 2025;53(13):3261-3274.', pmid: '40108749', doi: '10.1177/03635465251317207', nivel: 'III', tipo: 'metanalise' },
    { id: 'Luokkala2021', citacao: 'Luokkala T, et al. Distal biceps repairs and reconstructions: demographics and complications. Arch Orthop Trauma Surg. 2021;142(7):1351-1357.', pmid: '33484314', doi: '10.1007/s00402-021-03750-1', nivel: 'III', tipo: 'coorte' },
    { id: 'Goedderz2022', citacao: 'Goedderz C, et al. Short-term complications (NSQIP). Clin Shoulder Elb. 2022;25(1):36-41.', pmid: '35045595', doi: '10.5397/cise.2021.00472', nivel: 'III', tipo: 'coorte' },
    { id: 'Li2023', citacao: 'Li J, et al. SPOC repair long-term complications. JSES Int. 2023;7(6):2547-2552.', pmid: '37969532', doi: '10.1016/j.jseint.2023.07.016', nivel: 'IV', tipo: 'serie_casos' },
  ],
  avisosGerais: [
    'Rascunho, não revisado pelo cirurgião.',
    'Nenhuma sugestão atinge força forte: não há ECR comparando operatório × não operatório, nem ECR em lesões crônicas ou parciais.',
    'O peso da dominância do membro não é quantificado por nenhum estudo verificado: decisão do cirurgião.',
    'Dados de comorbidades (DPOC, obesidade, diabetes) cobrem só 30 dias.',
  ],
  referenciasGerais: [{ ref: 'Looney2022' }, { ref: 'Grewal2012' }],
};

// ---------------------------------------------------------------------------
// Mapeamento payload → entrada do motor
// ---------------------------------------------------------------------------

export interface ProvenienciaCampo {
  de: Proveniencia;
  /** Caminho no payload (ou campos de origem, se derivada). */
  caminho?: string;
  /** Regra de tradução aplicada, quando houver. */
  nota?: string;
}

export interface EntradaBicepsDistal {
  /** Pronta para `evaluate(BICEPS_DISTAL, entrada)`. Campo sem dado fica AUSENTE (nunca 0/false). */
  entrada: Record<string, unknown>;
  proveniencia: Record<string, ProvenienciaCampo>;
}

export interface ContextoBicepsDistal {
  /** Idade do paciente (cadastro). */
  idade?: number;
  /** Lado da cirurgia (coluna da cirurgia): 'Direito' | 'Esquerdo' ou 'R' | 'L'. */
  lado?: string;
}

const P_DBR = `avaliacaoPreop.patologias[${BICEPS_DISTAL_CODIGO}].dados`;
const P_COMUM = 'avaliacaoPreop.comum';

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isDate = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

function diasEntre(de: string, ate: string): number | undefined {
  const [a, b] = [de, ate].map((s) => {
    const [y, m, d] = s.split('-').map(Number);
    return Date.UTC(y, m - 1, d);
  });
  if (!Number.isFinite(a) || !Number.isFinite(b)) return undefined;
  const dias = Math.round((b - a) / 86_400_000);
  return dias >= 0 ? dias : undefined;
}

const OCUPACAO: Record<string, string> = { bracal: 'manual_pesado', atleta: 'atleta', sedentario: 'sedentario' };
const DEMANDA_OCUPACAO: Record<string, 'alta' | 'baixa'> = { bracal: 'alta', atleta: 'alta', sedentario: 'baixa' };
/** 'recreativo' não tem tradução segura → fica ausente. */
const DEMANDA_ATIVIDADE: Record<string, 'alta' | 'baixa'> = { competitivo: 'alta', trabalhador_bracal: 'alta', sedentario: 'baixa' };
const TABAGISMO: Record<string, string> = { nunca: 'nunca', ex_tabagista: 'ex', atual: 'atual' };
const TIPOS = ['completa', 'parcial', 'tendinopatia'];

function ladoCodigo(l: string | undefined): 'R' | 'L' | undefined {
  if (l === 'R' || l === 'Direito') return 'R';
  if (l === 'L' || l === 'Esquerdo') return 'L';
  return undefined;
}

/**
 * Lê o bloco pré-operatório (payload v2) de EL_DBR + campos comuns + contexto do paciente.
 * Determinístico, sem relógio: `dias_desde_lesao` vem do campo gravado ou, na falta dele,
 * de `data_lesao` × `data_avaliacao`. Nada é inventado: sem dado, sem campo.
 * Entradas manuais (DPOC, obesidade, ASA, FABS, via planejada etc.) não vêm do payload.
 */
export function mapearEntradaBicepsDistal(
  payload: Pick<ClinicalPayload, 'avaliacaoPreop'>,
  ctx: ContextoBicepsDistal = {},
): EntradaBicepsDistal {
  const entrada: Record<string, unknown> = {};
  const proveniencia: Record<string, ProvenienciaCampo> = {};
  const set = (id: string, v: unknown, p: ProvenienciaCampo) => {
    entrada[id] = v;
    proveniencia[id] = p;
  };
  const d: Record<string, unknown> = preopFor(payload, BICEPS_DISTAL_CODIGO)?.dados ?? {};
  const c: Record<string, unknown> = payload.avaliacaoPreop?.comum ?? {};

  // Dias desde a lesão
  if (isNum(d.dias_desde_lesao_preop) && d.dias_desde_lesao_preop >= 0) {
    set('dias_desde_lesao', d.dias_desde_lesao_preop, { de: 'payload', caminho: `${P_DBR}.dias_desde_lesao_preop` });
  } else if (isDate(d.data_lesao) && isDate(c.data_avaliacao)) {
    const dias = diasEntre(d.data_lesao, c.data_avaliacao);
    if (dias !== undefined) {
      set('dias_desde_lesao', dias, { de: 'derivada', caminho: `${P_DBR}.data_lesao, ${P_COMUM}.data_avaliacao`, nota: 'data_avaliacao − data_lesao' });
    }
  }

  if (typeof d.tipo_rm === 'string' && TIPOS.includes(d.tipo_rm)) {
    set('tipo_ruptura', d.tipo_rm, { de: 'payload', caminho: `${P_DBR}.tipo_rm` });
  }
  if (typeof d.hook_test === 'boolean') {
    set('hook_test', d.hook_test ? 'anormal' : 'normal', { de: 'payload', caminho: `${P_DBR}.hook_test`, nota: 'sim (positivo) → anormal; não → normal' });
  }
  if (isNum(d.partial_pct_rm)) set('pct_ruptura_parcial_rm', d.partial_pct_rm, { de: 'payload', caminho: `${P_DBR}.partial_pct_rm` });
  if (isNum(d.retracao_cm_rm)) set('retracao_cm', d.retracao_cm_rm, { de: 'payload', caminho: `${P_DBR}.retracao_cm_rm` });
  if (typeof d.lacerto_integro_rm === 'boolean') {
    set('lacerto_fibroso', d.lacerto_integro_rm ? 'integro' : 'roto', { de: 'payload', caminho: `${P_DBR}.lacerto_integro_rm`, nota: 'fonte: RM' });
  }

  // Ocupação e demanda: primeiro a ocupação do bloco EL_DBR, depois o nível de atividade comum
  const oc = typeof d.ocupacao_demanda === 'string' ? d.ocupacao_demanda : undefined;
  if (oc && OCUPACAO[oc]) set('ocupacao', OCUPACAO[oc], { de: 'payload', caminho: `${P_DBR}.ocupacao_demanda`, nota: 'bracal → manual_pesado' });
  const na = typeof c.nivel_atividade === 'string' ? c.nivel_atividade : undefined;
  if (oc && DEMANDA_OCUPACAO[oc]) {
    set('demanda_funcional', DEMANDA_OCUPACAO[oc], { de: 'derivada', caminho: `${P_DBR}.ocupacao_demanda`, nota: 'bracal/atleta → alta; sedentario → baixa' });
  } else if (na && DEMANDA_ATIVIDADE[na]) {
    set('demanda_funcional', DEMANDA_ATIVIDADE[na], { de: 'derivada', caminho: `${P_COMUM}.nivel_atividade`, nota: 'competitivo/trabalhador_bracal → alta; sedentario → baixa; recreativo → sem dado' });
  }

  if (typeof d.necessidade_forca_supinacao === 'boolean') {
    set('prioridade_supinacao', d.necessidade_forca_supinacao ? 'alta' : 'baixa', { de: 'payload', caminho: `${P_DBR}.necessidade_forca_supinacao`, nota: 'sim → alta; não → baixa' });
  }

  // Comuns
  if (typeof c.tabagismo === 'string' && TABAGISMO[c.tabagismo]) {
    set('tabagismo', TABAGISMO[c.tabagismo], { de: 'payload', caminho: `${P_COMUM}.tabagismo` });
  }
  if (typeof c.diabetes === 'boolean') set('diabetes', c.diabetes, { de: 'payload', caminho: `${P_COMUM}.diabetes` });
  const ladoOp = ladoCodigo(ctx.lado);
  if (ladoOp && (c.lado_dominante === 'R' || c.lado_dominante === 'L')) {
    set('membro_dominante', c.lado_dominante === ladoOp, { de: 'derivada', caminho: `${P_COMUM}.lado_dominante × lado da cirurgia`, nota: 'ambidestro → sem dado' });
  }

  // Paciente
  if (isNum(ctx.idade) && Number.isInteger(ctx.idade) && ctx.idade >= 0) set('idade', ctx.idade, { de: 'paciente', caminho: 'idade' });

  return { entrada, proveniencia };
}
