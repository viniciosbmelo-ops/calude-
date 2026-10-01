/**
 * SH_INST_ANT: instabilidade glenoumeral anterior. RASCUNHO (status de governança fica no banco).
 *
 * Fonte: especificação verificada "spec-instabilidade-anterior.md" v1.0 (2026-09-28). Só entram como regra
 * os números e critérios que a especificação marca como verificados no resumo/metadados do PubMed.
 * Itens marcados "requer texto completo" NÃO viram regra: pesos por item do ISIS (o ISIS entra como total
 * informado pelo cirurgião), critério clínico de hiperlaxidade, derivação do GT e do GTIMS, pesos do PIT e
 * faixas de GBL incluídas em Haroun 2020 / Hurley 2020.
 *
 * Zonas cinzentas ZC-A…ZC-F são regras com `controversia`: listam as alternativas, cada uma com sua
 * evidência, e o motor marca todas como "controversa". Nenhuma é escolhida.
 *
 * Decisões abertas do cirurgião (seção 6 da especificação) viram PARÂMETROS com o padrão proposto e
 * status 'pendente_decisao_cirurgiao'.
 *
 * O nível de evidência de cada referência foi atribuído a partir do desenho de estudo descrito na
 * especificação (resumo); conferir na revisão do rascunho.
 */
import { ClinicalGuardError } from '../../errors';
import { glenoidBoneLossPct, glenoidTrack, trackStatus } from '../../instability/metrics';
import { preopFor, type ClinicalPayload } from '../../surgery/payload';
import type { AlgorithmDef, Cond, EntradaDef, Proveniencia, RegraDef } from '../types';
import { AVISO_NIVEIS_EVIDENCIA } from '../vocab';
import { idadeEmAnos } from '../mapping';

export const SH_INST_ANT_CODIGO = 'SH_INST_ANT';
const P = `avaliacaoPreop[${SH_INST_ANT_CODIGO}]`;

// ---- Condições reutilizadas ----
const naoFalhaCoracoide: Cond = { campo: 'tipo_episodio', op: '!=', valor: 'falha_pos_transferencia_coracoide' };
const episodioPrimario: Cond = { campo: 'tipo_episodio', op: 'in', valores: ['primeiro_episodio', 'recorrente'] };
const gblAbaixoCritico: Cond = { campo: 'gbl_pct', op: '<', param: 'gbl_critico_pct' };

const TIPO_EPISODIO = ['primeiro_episodio', 'recorrente', 'falha_pos_estabilizacao_partes_moles', 'falha_pos_transferencia_coracoide'] as const;
const LESOES = ['bankart', 'bony_bankart', 'perthes', 'alpsa', 'glad', 'hagl', 'slap_extension'] as const;

const entradas: EntradaDef[] = [
  { id: 'idade', rotulo: 'Idade na data da cirurgia/avaliação', def: { tipo: 'numero', unidade: 'anos', min: 5, max: 100, inteiro: true }, origem: { de: 'paciente', campo: 'dataNascimento' }, momento: 'preop' },
  { id: 'tipo_episodio', rotulo: 'Tipo de episódio', def: { tipo: 'enum', valores: TIPO_EPISODIO, rotulos: {
    primeiro_episodio: 'Primeiro episódio', recorrente: 'Recorrente',
    falha_pos_estabilizacao_partes_moles: 'Falha após estabilização de partes moles', falha_pos_transferencia_coracoide: 'Falha após transferência do coracoide (Latarjet/Bristow)',
  } }, origem: { de: 'derivada', funcao: 'tipoEpisodio(episodes, prior_surgery, n_cirurgias_estabilizacao_previas)', dependeDe: [] }, momento: 'preop' },
  { id: 'instabilidade_voluntaria', rotulo: 'Instabilidade voluntária', def: { tipo: 'booleano' }, origem: { de: 'payload', caminho: `${P}.voluntary` }, momento: 'preop' },
  { id: 'esporte_competitivo', rotulo: 'Esporte competitivo', def: { tipo: 'booleano' }, origem: { de: 'payload', caminho: `${P}.sport_competitive` }, momento: 'preop' },
  { id: 'esporte_contato_ou_arremesso', rotulo: 'Esporte de contato ou com arremesso/elevação forçada', def: { tipo: 'booleano' }, origem: { de: 'payload', caminho: `${P}.sport_contact_or_forced_overhead` }, momento: 'preop' },
  { id: 'hiperlaxidade', rotulo: 'Hiperlaxidade (critério clínico do ISIS: requer texto completo; cirurgião decide)', def: { tipo: 'booleano' }, origem: { de: 'payload', caminho: `${P}.hyperlaxity` }, momento: 'preop' },
  { id: 'n_luxacoes', rotulo: 'Número de luxações pré-operatórias', def: { tipo: 'numero', min: 0, max: 1000, inteiro: true }, origem: { de: 'payload', caminho: `${P}.n_luxacoes` }, momento: 'preop' },
  { id: 'meses_desde_primeiro_episodio', rotulo: 'Tempo desde o 1º episódio', def: { tipo: 'numero', unidade: 'meses', min: 0, max: 1200 }, origem: { de: 'payload', caminho: `${P}.meses_desde_primeiro_episodio` }, momento: 'preop' },
  { id: 'epilepsia', rotulo: 'Epilepsia', def: { tipo: 'booleano' }, origem: { de: 'payload', caminho: `${P}.epilepsy` }, momento: 'preop' },
  { id: 'lesoes_partes_moles', rotulo: 'Lesões de partes moles na imagem', def: { tipo: 'lista', valores: LESOES, rotulos: {
    bankart: 'Bankart', bony_bankart: 'Bankart ósseo', perthes: 'Perthes', alpsa: 'ALPSA', glad: 'GLAD', hagl: 'HAGL', slap_extension: 'Extensão para SLAP',
  } }, origem: { de: 'payload', caminho: `${P}.soft_tissue_lesions` }, momento: 'preop' },
  { id: 'D_mm', rotulo: 'Diâmetro da glenoide inferior (D)', def: { tipo: 'numero', unidade: 'mm', min: 15, max: 40 }, origem: { de: 'payload', caminho: `${P}.D_mm` }, momento: 'preop' },
  { id: 'd_mm', rotulo: 'Largura do defeito glenoidal (d)', def: { tipo: 'numero', unidade: 'mm', min: 0, max: 20 }, origem: { de: 'payload', caminho: `${P}.d_mm` }, momento: 'preop' },
  { id: 'hsi_mm', rotulo: 'Intervalo de Hill-Sachs (HSI)', def: { tipo: 'numero', unidade: 'mm', min: 0, max: 50 }, origem: { de: 'payload', caminho: `${P}.hsi_mm` }, momento: 'preop' },
  { id: 'gbl_pct', rotulo: 'Perda óssea glenoidal (GBL)', def: { tipo: 'numero', unidade: '%', min: 0, max: 100 }, origem: { de: 'derivada', funcao: 'glenoidBoneLossPct(D_mm, d_mm) | gbl_pct_direto', dependeDe: ['D_mm', 'd_mm'] }, momento: 'preop' },
  { id: 'gt_mm', rotulo: 'Glenoid track (GT = 0,83·D − d)', def: { tipo: 'numero', unidade: 'mm', min: -20, max: 40 }, origem: { de: 'derivada', funcao: 'glenoidTrack(D_mm, d_mm)', dependeDe: ['D_mm', 'd_mm'] }, momento: 'preop' },
  { id: 'track_status', rotulo: 'Status do track', def: { tipo: 'enum', valores: ['on_track', 'off_track'], rotulos: { on_track: 'On-track', off_track: 'Off-track' } }, origem: { de: 'derivada', funcao: 'trackStatus(gt_mm, hsi_mm)', dependeDe: ['gt_mm', 'hsi_mm'] }, momento: 'preop' },
  { id: 'dtd_mm', rotulo: 'Distância até o track (DTD = GT − HSI; positiva quando on-track)', def: { tipo: 'numero', unidade: 'mm', min: -50, max: 40 }, origem: { de: 'derivada', funcao: 'trackStatus(gt_mm, hsi_mm).margin_mm', dependeDe: ['gt_mm', 'hsi_mm'] }, momento: 'preop' },
  { id: 'hill_sachs_presente', rotulo: 'Hill-Sachs presente na imagem', def: { tipo: 'booleano' }, origem: { de: 'manual' }, momento: 'preop' },
  { id: 'isis_total', rotulo: 'ISIS total (informado pelo cirurgião)', def: { tipo: 'numero', unidade: 'pontos', min: 0, max: 10, inteiro: true }, origem: { de: 'manual' }, momento: 'preop' },
];

const regras: RegraDef[] = [
  // ---- N2: primeiro episódio ----
  {
    id: 'N2A.PEDIATRICO',
    titulo: 'Primeiro episódio em ≤19 anos',
    quando: { all: [{ campo: 'tipo_episodio', op: '==', valor: 'primeiro_episodio' }, { campo: 'idade', op: '<=', valor: 19 }] },
    efeitos: [{ opcao: 'bankart_artro', efeito: 'favorece', forca: 'moderada' }],
    motivo: 'Primeiro episódio aos {idade} (população ≤19 anos): recorrência de 43,5% com tratamento conservador contra 20,8% com cirurgia primária (OR 9,55); amostras mistas (primeiro episódio e recorrentes, luxação e subluxação). Em adolescentes (RM, n = 181): 74,6% com alguma perda óssea, 41,4% com DTD <10 mm e 7,2% off-track (coorte única, evidência fraca). A literatura favorece discutir estabilização primária; seguir com os dados de imagem.',
    referencias: [{ ref: 'Khoshaba2026', nota: 'PED ≤19; conservador 43,5% vs cirurgia 20,8%; OR 9,55' }, { ref: 'Arvesen2026', nota: 'Achados de imagem em adolescentes; ORs predizem perda óssea bipolar, não recorrência' }],
  },
  {
    id: 'N2B.ZC_E',
    titulo: 'Zona cinzenta E: primeiro episódio em adulto sem perda óssea significativa',
    quando: { all: [
      { campo: 'tipo_episodio', op: '==', valor: 'primeiro_episodio' },
      { campo: 'idade', op: '>', valor: 19 },
      { campo: 'gbl_pct', op: '<', param: 'gbl_zc_a_inferior_pct' },
    ] },
    efeitos: [
      { opcao: 'bankart_artro', efeito: 'favorece', forca: 'forte' },
      { opcao: 'conservador', efeito: 'favorece', forca: 'forte' },
    ],
    motivo: 'Primeiro episódio aos {idade}, GBL {gbl_pct} abaixo do limite inferior da zona cinzenta A. Estabilização primária e tratamento conservador são alternativas; a escolha é do cirurgião e do paciente.',
    referencias: [{ ref: 'Belk2023' }, { ref: 'ViragTulassay2026' }, { ref: 'Boutros2026' }],
    controversia: {
      nota: 'Zona cinzenta E: evidência forte de menor recorrência com estabilização primária, mas as fontes não trazem critério validado de quem operar no primeiro episódio. Os ECR têm idade média de ~23 anos e predomínio de homens ativos. Decisão do cirurgião e do paciente (D6).',
      alternativas: [
        { opcao: 'bankart_artro', argumento: 'Estabilização artroscópica primária: recorrência de 6,3% contra 46,6% sem cirurgia (5 ECR nível 1, n = 259); na NMA de 19 ECR, Bankart artroscópico superior (P-score 0,9994) sem perda óssea significativa.', referencias: [{ ref: 'Belk2023' }, { ref: 'ViragTulassay2026' }] },
        { opcao: 'conservador', argumento: 'Tratamento conservador: opção sem critério de seleção validado nos resumos; se escolhido, imobilização em rotação interna e externa são equivalentes na recorrência (p = 0,41), sem diferença clinicamente relevante no WOSI.', referencias: [{ ref: 'Boutros2026' }] },
      ],
    },
  },

  // ---- N3: perda óssea glenoidal ----
  {
    id: 'N3.GBL_CRITICA',
    titulo: 'Perda glenoidal crítica',
    quando: { all: [naoFalhaCoracoide, { campo: 'gbl_pct', op: '>=', param: 'gbl_critico_pct' }] },
    efeitos: [
      { opcao: 'latarjet', efeito: 'favorece', forca: 'forte' },
      { opcao: 'bankart_artro', efeito: 'desfavorece', forca: 'forte' },
    ],
    motivo: 'GBL {gbl_pct}, no limiar de perda glenoidal crítica (parâmetro configurável) ou acima. Com defeito ósseo significativo, recorrência após Bankart artroscópico de 67% contra 4% (89% contra 6,5% em atletas de contato); defeito ≥21% reduz a estabilidade após Bankart (cadavérico); glenoide em pera invertida com ≥25–27% de perda; ≥25% descrito como consenso de enxerto ósseo; no quartil ≥20%, falha de 27,8% contra 7,3% (militares). A literatura favorece aumento ósseo glenoidal (Latarjet/bloco ósseo); cautela com Bankart artroscópico isolado.',
    referencias: [
      { ref: 'Burkhart2000', nota: '67% vs 4%; contato 89% vs 6,5% (n = 194)' },
      { ref: 'Itoi2000', nota: 'Defeito ≥21% (cadavérico)' },
      { ref: 'Lo2004', nota: 'Pera invertida ≥25–27%; limiar cadavérico 28,8%' },
      { ref: 'DiGiacomo2014', nota: '≥25% → enxerto ósseo' },
      { ref: 'Shaha2015', nota: 'Quartil ≥20%: 27,8% vs 7,3% [MIL]' },
    ],
    justificativaForca: 'Força "forte" atribuída pela especificação (L1): biomecânica e coortes convergentes, sem ECR.',
  },
  {
    id: 'N3.GBL_CRITICA.OFF_TRACK',
    titulo: 'Latarjet com Hill-Sachs off-track: remplissage associado',
    quando: { all: [naoFalhaCoracoide, { campo: 'gbl_pct', op: '>=', param: 'gbl_critico_pct' }, { campo: 'track_status', op: '==', valor: 'off_track' }] },
    efeitos: [],
    aviso: true,
    motivo: 'Perda crítica com Hill-Sachs off-track: a associação de remplissage ao Latarjet aparece só em opinião (editorial: desnecessária) e em série sem controle (n = 40, sem recorrência em 2 anos). Evidência fraca; decisão do cirurgião (D8).',
    referencias: [{ ref: 'Sheean2021' }, { ref: 'Nair2025' }],
  },
  {
    id: 'N3.ZC_A',
    titulo: 'Zona cinzenta A: GBL entre o limite inferior e o limiar crítico',
    quando: { all: [naoFalhaCoracoide, { campo: 'gbl_pct', op: '>=', param: 'gbl_zc_a_inferior_pct' }, gblAbaixoCritico] },
    efeitos: [
      { opcao: 'latarjet', efeito: 'favorece', forca: 'moderada' },
      { opcao: 'bankart_remplissage', efeito: 'favorece', forca: 'moderada' },
      { opcao: 'bankart_artro', efeito: 'favorece', forca: 'fraca' },
      { opcao: 'estabilizacao_dinamica', efeito: 'favorece', forca: 'fraca' },
    ],
    motivo: 'GBL {gbl_pct}, entre o limite inferior da zona cinzenta A e o limiar de perda glenoidal crítica (ambos parâmetros configuráveis). Avaliar também o track (N4) e o ISIS (N5), exibidos ao lado.',
    referencias: [
      { ref: 'Masud2023', nota: 'NMA: Latarjet < Bankart na faixa de 10–20% (p = 0,0016); 0–10% semelhantes' },
      { ref: 'Trasolini2022', nota: 'Limiares críticos de 10–15% com imagem avançada' },
      { ref: 'Shaha2015', nota: '>13,5%: WOSI de resultado ruim [MIL]' },
      { ref: 'Dickens2017', nota: '3/3 recidivas com >13,5% [FUT]' },
      { ref: 'Gracitelli2022', nota: '>13,5% sem associação com recorrência (p = 0,21)' },
      { ref: 'Cognetti2023', nota: '≥17%: aumento ósseo em 89% (descritivo)' },
    ],
    controversia: {
      nota: 'Zona cinzenta A: a literatura discorda sobre o ponto de corte inferior (10% ou 13,5%) e sobre a conduta; o limiar superior também diverge. Sub-faixas: 10–<13,5%: NMA mostra Latarjet superior ao Bankart na faixa de 10–20% como bloco único, sem dado separado (moderada). 13,5–<20%: pior WOSI em militares, 3/3 recidivas em futebol americano universitário, sem associação em série brasileira (controversa). ≥17%: cirurgiões militares escolhem aumento ósseo em 89% (descritivo, fraca). O algoritmo não escolhe entre as alternativas.',
      alternativas: [
        { opcao: 'latarjet', argumento: 'Latarjet/bloco ósseo: menor recorrência que o Bankart na faixa de 10–20% (NMA, moderada). Limite: mais complicações maiores que Bankart + remplissage (RR 7,37; 8,6% contra 0,5%).', referencias: [{ ref: 'Masud2023' }, { ref: 'Haroun2020' }, { ref: 'Hurley2020' }] },
        { opcao: 'bankart_remplissage', argumento: 'Bankart + remplissage (se houver Hill-Sachs): recorrência semelhante à do Latarjet em lesão engajante com GBL subcrítica (moderada) e menor que a do Bankart isolado (forte). Limite: os estudos comparativos não estratificam 13,5–20% (faixas de GBL incluídas requerem texto completo).', referencias: [{ ref: 'Haroun2020' }, { ref: 'Hurley2020' }, { ref: 'Pawlus2025' }, { ref: 'Ahmed2024' }, { ref: 'VillarrealEspinosa2024' }] },
        { opcao: 'bankart_artro', argumento: 'Bankart isolado: aceitável em baixo risco (ISIS 0–3: recorrência de 15,4%; moderada). Limites: pior resultado funcional acima de 13,5% em militares; maior recorrência com GBL de 10–20%.', referencias: [{ ref: 'vanBlommestein2024' }, { ref: 'Shaha2015' }, { ref: 'Masud2023' }] },
        { opcao: 'estabilizacao_dinamica', argumento: 'Estabilização dinâmica anterior + Bankart: 8% de recorrência em 3 séries clínicas (100 ombros, GBL de 8–10%; fraca). Os autores alertam contra o uso com off-track ou GBL de ~20%.', referencias: [{ ref: 'Ahmed2026' }] },
      ],
    },
  },

  // ---- N4: Hill-Sachs e glenoid track ----
  {
    id: 'N4.OFF_TRACK.BANKART_ISOLADO',
    titulo: 'Off-track: falha do Bankart isolado',
    quando: { all: [naoFalhaCoracoide, { campo: 'track_status', op: '==', valor: 'off_track' }] },
    efeitos: [{ opcao: 'bankart_artro', efeito: 'desfavorece', forca: 'forte' }],
    motivo: 'Hill-Sachs off-track (HSI {hsi_mm} > GT {gt_mm}): falha do Bankart isolado em 75% contra 8% on-track (militares, RM; VPP 75% contra 44% para GBL >20%); revisão em 33% contra 6% (OR 8,3); meta-análises com RR 3,24, OR 5,53 e OR 4,35, e OR 2,9–8,9 em 3 de 4 análises multivariadas. Ressalvas: sem associação em série brasileira (p = 0,109) e sem papel na decisão real de cirurgiões militares. Cautela com Bankart artroscópico isolado.',
    referencias: [
      { ref: 'Shaha2016', nota: '75% vs 8% [MIL, n = 57]' },
      { ref: 'Locher2016', nota: 'Revisão 33% vs 6%; OR 8,3 (n = 100)' },
      { ref: 'Verweij2021' }, { ref: 'Zhang2022' }, { ref: 'Bulleit2024' }, { ref: 'SanchezCruz2026' },
      { ref: 'Gracitelli2022', nota: 'Contra: sem associação (p = 0,109)' },
      { ref: 'Cognetti2023', nota: 'Contra: off-track não influenciou a decisão (descritivo)' },
    ],
    justificativaForca: 'Força "forte" atribuída pela especificação (L6): meta-análises concordantes de estudos observacionais, com a ressalva de confiabilidade da medida do track.',
  },
  {
    id: 'N4.ZC_B',
    titulo: 'Zona cinzenta B: off-track com perda glenoidal subcrítica',
    quando: { all: [naoFalhaCoracoide, gblAbaixoCritico, { campo: 'track_status', op: '==', valor: 'off_track' }] },
    efeitos: [
      { opcao: 'bankart_remplissage', efeito: 'favorece', forca: 'moderada' },
      { opcao: 'latarjet', efeito: 'favorece', forca: 'moderada' },
      { opcao: 'latarjet_remplissage', efeito: 'favorece', forca: 'fraca' },
    ],
    motivo: 'Off-track com GBL {gbl_pct} abaixo do limiar crítico. Exibir ao lado, sem decidir: GBL (se na faixa de 10–20%, ver NMA), epilepsia e ISIS.',
    referencias: [{ ref: 'Haroun2020' }, { ref: 'Hurley2020' }, { ref: 'Masud2023' }, { ref: 'Nair2025' }],
    controversia: {
      nota: 'Zona cinzenta B: Bankart + remplissage e Latarjet têm recorrência equivalente (RR 0,72; IC 0,37–1,41; 9,8% contra 7,0%, p = 0,39) e perfis de complicação diferentes. O Bankart isolado não entra como alternativa. Decisão do cirurgião (D9).',
      alternativas: [
        { opcao: 'bankart_remplissage', argumento: 'Bankart + remplissage: recorrência comparável à do Latarjet (RR 0,72, n.s.), com menos complicações maiores (moderada).', referencias: [{ ref: 'Haroun2020' }, { ref: 'Hurley2020' }] },
        { opcao: 'latarjet', argumento: 'Latarjet: recorrência comparável, mais complicações maiores (RR 7,37; 8,6% contra 0,5%); a NMA favorece o Latarjet quando a GBL é de 10–20% (moderada).', referencias: [{ ref: 'Haroun2020' }, { ref: 'Hurley2020' }, { ref: 'Masud2023' }] },
        { opcao: 'latarjet_remplissage', argumento: 'Latarjet + remplissage: série de 40 pacientes sem recorrência em 2 anos, sem grupo controle (fraca).', referencias: [{ ref: 'Nair2025' }] },
      ],
    },
  },
  {
    id: 'N4.ZC_C',
    titulo: 'Zona cinzenta C: on-track "near-track"',
    quando: { all: [naoFalhaCoracoide, gblAbaixoCritico, { campo: 'track_status', op: '==', valor: 'on_track' }, { campo: 'dtd_mm', op: '<', param: 'near_track_dtd_mm' }] },
    efeitos: [
      { opcao: 'bankart_artro', efeito: 'favorece', forca: 'fraca' },
      { opcao: 'bankart_remplissage', efeito: 'favorece', forca: 'fraca' },
    ],
    motivo: 'On-track com DTD {dtd_mm}, abaixo do limiar near-track (parâmetro configurável).',
    referencias: [{ ref: 'Li2021' }, { ref: 'Verweij2023' }, { ref: 'Dadoo2026' }, { ref: 'Lin2023' }, { ref: 'Charles2025' }],
    controversia: {
      nota: 'Zona cinzenta C: resultados preditivos opostos. DTD <8 mm prediz falha (AUC 0,73; 0,84 em ≥20 anos; 0,69 em <20 anos; n = 173). Em militares, DTD sem poder preditivo (AUC 0,49; n = 80). Em 10 anos, DTD sem associação com recorrência (p = 0,59), mas near-track associado a revisão (p = 0,02). O escore PIT pode apoiar a discussão (faixas 0–3, 4–8, 9–13 e ≥14; recorrência de 2,2% a 51,3%), mas os pesos dos itens requerem texto completo e não são calculados aqui.',
      alternativas: [
        { opcao: 'bankart_artro', argumento: 'Bankart isolado: conduta histórica para on-track; em 10 anos, 31% com ≥1 recorrência em on-track com GBL <20% (n = 55; moderada/fraca).', referencias: [{ ref: 'Dadoo2026' }] },
        { opcao: 'bankart_remplissage', argumento: 'Bankart + remplissage: recorrência de 4,2% contra 66,7% em atletas de contato com DTD <10 mm (subgrupo pequeno, retrospectivo); o remplissage reduz 8 pontos no escore PIT (moderada/fraca).', referencias: [{ ref: 'Lin2023' }, { ref: 'Charles2025' }] },
      ],
    },
  },
  {
    id: 'L7.CONFIABILIDADE_TRACK',
    titulo: 'Confiabilidade da medida do track',
    quando: { campo: 'track_status', op: 'in', valores: ['on_track', 'off_track'] },
    efeitos: [],
    aviso: true,
    motivo: 'Status do track calculado: {track_status}. Na TC-3D, a concordância interavaliador foi "fair" (α = 0,368) e a acurácia de 65% contra o teste artroscópico dinâmico (n = 49). Registrar a modalidade e o método de medida.',
    referencias: [{ ref: 'Rashid2024' }],
  },

  // ---- N5: risco do paciente (ISIS informado + fatores isolados) ----
  {
    id: 'N5.ISIS_ALTO',
    titulo: 'ISIS acima do corte alto',
    quando: { all: [episodioPrimario, { campo: 'isis_total', op: '>', param: 'isis_corte_alto' }] },
    efeitos: [
      { opcao: 'bankart_artro', efeito: 'desfavorece', forca: 'forte' },
      { opcao: 'latarjet', efeito: 'favorece', forca: 'moderada' },
    ],
    motivo: 'ISIS {isis_total}, acima do corte alto do ISIS (parâmetro configurável): recorrência de 70% no estudo original (n = 131; recorrência global de 14,5%) e de 71,4% na validação externa (n = 99); meta-análise com RR 4,88. Os autores originais sugerem Bristow-Latarjet. Cautela com Bankart artroscópico isolado.',
    referencias: [{ ref: 'Balg2007' }, { ref: 'vanBlommestein2024' }, { ref: 'Verweij2021' }],
    justificativaForca: 'Força "forte" atribuída pela especificação (L14) à associação de ISIS >6 com alta recorrência: estudo original, validação externa e meta-análise concordantes.',
  },
  {
    id: 'N5.ZC_D',
    titulo: 'Zona cinzenta D: ISIS intermediário',
    quando: { all: [
      episodioPrimario,
      { campo: 'isis_total', op: '>', param: 'isis_corte_baixo' },
      { campo: 'isis_total', op: '<=', param: 'isis_corte_alto' },
    ] },
    efeitos: [
      { opcao: 'bankart_artro', efeito: 'favorece', forca: 'fraca' },
      { opcao: 'bankart_remplissage', efeito: 'favorece', forca: 'moderada' },
      { opcao: 'latarjet', efeito: 'favorece', forca: 'fraca' },
    ],
    motivo: 'ISIS {isis_total}, entre os cortes baixo e alto do ISIS (parâmetros configuráveis).',
    referencias: [{ ref: 'vanBlommestein2024' }, { ref: 'Chen2021' }, { ref: 'Verweij2021' }, { ref: 'Trasolini2022' }, { ref: 'SanchezCruz2026' }],
    controversia: {
      nota: 'Zona cinzenta D: recorrência de 40,7% com ISIS 4–6 contra 15,4% com 0–3; os autores da validação apontam decisão compartilhada. O corte ótimo varia: ≥4 pela curva ROC (n = 222), >3 com RR 3,28, cortes preditivos de 2–4 em revisão sistemática; uma meta-análise de 2026 aponta não depender de cortes rígidos.',
      alternativas: [
        { opcao: 'bankart_artro', argumento: 'Bankart isolado: ISIS ≤6 fica abaixo do corte do estudo original; na faixa 4–6, recorrência de 40,7%.', referencias: [{ ref: 'Balg2007' }, { ref: 'vanBlommestein2024' }] },
        { opcao: 'bankart_remplissage', argumento: 'Bankart + remplissage (se houver Hill-Sachs): menor recorrência que o Bankart isolado (OR 0,11; OR 9,36; OR 4,22; 3,2% contra 16,8%; forte).', referencias: [{ ref: 'Pawlus2025' }, { ref: 'Ahmed2024' }, { ref: 'VillarrealEspinosa2024' }, { ref: 'Hurley2020' }] },
        { opcao: 'latarjet', argumento: 'Latarjet: cortes mais baixos (≥4; >3 com RR 3,28) já separam maior risco de recidiva após Bankart.', referencias: [{ ref: 'Chen2021' }, { ref: 'Verweij2021' }, { ref: 'Trasolini2022' }] },
      ],
    },
  },
  {
    id: 'N5.ISIS_BAIXO',
    titulo: 'ISIS baixo, GBL <10% e sem lesão bipolar relevante',
    quando: { all: [
      episodioPrimario,
      { campo: 'isis_total', op: '<=', param: 'isis_corte_baixo' },
      { campo: 'gbl_pct', op: '<', valor: 10 },
      { any: [
        { campo: 'hill_sachs_presente', op: '==', valor: false },
        { all: [{ campo: 'track_status', op: '==', valor: 'on_track' }, { campo: 'dtd_mm', op: '>=', param: 'near_track_dtd_mm' }] },
      ] },
    ] },
    efeitos: [{ opcao: 'bankart_artro', efeito: 'favorece', forca: 'moderada' }],
    motivo: 'ISIS {isis_total} (faixa baixa), GBL {gbl_pct} (<10%), sem Hill-Sachs ou on-track fora da faixa near-track: recorrência de 15,4% com ISIS 0–3; procedimentos semelhantes com GBL de 0–10% (NMA). A literatura favorece Bankart artroscópico isolado.',
    referencias: [{ ref: 'vanBlommestein2024' }, { ref: 'Masud2023' }],
  },
  {
    id: 'N5.ZC_F.CONTATO',
    titulo: 'Zona cinzenta F: esporte de contato como modificador',
    quando: { all: [episodioPrimario, { campo: 'esporte_contato_ou_arremesso', op: '==', valor: true }] },
    efeitos: [{ opcao: 'bankart_artro', efeito: 'desfavorece', forca: 'fraca' }],
    motivo: 'Esporte de contato ou com arremesso/elevação forçada: modificador de risco controverso, sem peso automático fora do ISIS.',
    referencias: [{ ref: 'Zhang2022' }, { ref: 'Verweij2021' }, { ref: 'SanchezCruz2026' }],
    controversia: {
      nota: 'Zona cinzenta F: as meta-análises divergem sobre o esporte de contato como fator de recidiva após Bankart. Exibido como modificador, sem peso automático fora do ISIS (D10).',
      alternativas: [
        { opcao: 'bankart_artro', argumento: 'Associação com recidiva: OR 1,65 (significativa).', referencias: [{ ref: 'SanchezCruz2026' }] },
        { opcao: 'bankart_artro', argumento: 'Sem associação: OR 1,54 (p = 0,07, n.s.); associação não confirmada em outra meta-análise.', referencias: [{ ref: 'Zhang2022' }, { ref: 'Verweij2021' }] },
      ],
    },
  },
  {
    id: 'N5.ZC_F.HIPERLAXIDADE',
    titulo: 'Zona cinzenta F: hiperlaxidade como modificador',
    quando: { all: [episodioPrimario, { campo: 'hiperlaxidade', op: '==', valor: true }] },
    efeitos: [{ opcao: 'bankart_artro', efeito: 'desfavorece', forca: 'fraca' }],
    motivo: 'Hiperlaxidade (critério clínico do ISIS requer texto completo; cirurgião decide): modificador de risco controverso, sem peso automático fora do ISIS.',
    referencias: [{ ref: 'Zhang2022' }, { ref: 'Verweij2021' }, { ref: 'SanchezCruz2026' }],
    controversia: {
      nota: 'Zona cinzenta F: as meta-análises divergem sobre a hiperlaxidade como fator de recidiva após Bankart. Exibida como modificador, sem peso automático fora do ISIS (D10).',
      alternativas: [
        { opcao: 'bankart_artro', argumento: 'Associação com recidiva: OR 4,55 (significativa).', referencias: [{ ref: 'Zhang2022' }] },
        { opcao: 'bankart_artro', argumento: 'Sem associação: não confirmada em uma meta-análise; OR 1,76 (n.s.) em outra.', referencias: [{ ref: 'Verweij2021' }, { ref: 'SanchezCruz2026' }] },
      ],
    },
  },
  {
    id: 'N5.RISCO.IDADE',
    titulo: 'Fator isolado: idade <20 anos',
    quando: { campo: 'idade', op: '<', valor: 20 },
    efeitos: [],
    aviso: true,
    motivo: 'Idade {idade} (<20 anos): fator de recidiva após Bankart (RR 2,02 para ≤20; OR 4,24; 27,0% contra 13,3%; OR 2,14). Evidência forte.',
    referencias: [{ ref: 'Verweij2021' }, { ref: 'Zhang2022' }, { ref: 'Bulleit2024' }, { ref: 'SanchezCruz2026' }],
  },
  {
    id: 'N5.RISCO.ESPORTE_COMPETITIVO',
    titulo: 'Fator isolado: esporte competitivo',
    quando: { campo: 'esporte_competitivo', op: '==', valor: true },
    efeitos: [],
    aviso: true,
    motivo: 'Esporte competitivo: fator de recidiva após Bankart (RR 2,40; OR 2,73). Evidência forte.',
    referencias: [{ ref: 'Verweij2021' }, { ref: 'SanchezCruz2026' }],
  },
  {
    id: 'N5.RISCO.LUXACOES',
    titulo: 'Fator isolado: mais de uma luxação pré-operatória',
    quando: { campo: 'n_luxacoes', op: '>', valor: 1 },
    efeitos: [],
    aviso: true,
    motivo: '{n_luxacoes} luxações pré-operatórias (>1): fator de recidiva após Bankart (RR 2,02). Evidência moderada (1 meta-análise).',
    referencias: [{ ref: 'Verweij2021' }],
  },
  {
    id: 'N5.RISCO.ATRASO',
    titulo: 'Fator isolado: mais de 6 meses desde o 1º episódio',
    quando: { campo: 'meses_desde_primeiro_episodio', op: '>', valor: 6 },
    efeitos: [],
    aviso: true,
    motivo: '{meses_desde_primeiro_episodio} desde o 1º episódio (>6 meses): fator de recidiva após Bankart (RR 2,86). Evidência moderada (1 meta-análise).',
    referencias: [{ ref: 'Verweij2021' }],
  },
  {
    id: 'N5.RISCO.ALPSA',
    titulo: 'Fator isolado: lesão ALPSA',
    quando: { campo: 'lesoes_partes_moles', op: 'contem', valor: 'alpsa' },
    efeitos: [],
    aviso: true,
    motivo: 'Lesão ALPSA: fator de recidiva após Bankart (RR 1,90). Evidência moderada (1 meta-análise).',
    referencias: [{ ref: 'Verweij2021' }],
  },

  // ---- N6, N8, N9, N10 ----
  {
    id: 'N6.BANKART_OSSEO',
    titulo: 'Subgrupo Bankart ósseo',
    quando: { campo: 'lesoes_partes_moles', op: 'contem', valor: 'bony_bankart' },
    efeitos: [],
    aviso: true,
    motivo: 'Bankart ósseo: a escolha entre fixação artroscópica e Latarjet dependeu da GBL e do fragmento, com limiar de 10% (n = 290; descritivo, sem superioridade demonstrada; fraca). Um vídeo técnico cita <13,5% como limiar para fixação artroscópica (opinião).',
    referencias: [{ ref: 'Spinello2025' }, { ref: 'Sciarretti2026' }],
  },
  {
    id: 'N8.FALHA_PARTES_MOLES',
    titulo: 'Falha após estabilização de partes moles',
    quando: { campo: 'tipo_episodio', op: '==', valor: 'falha_pos_estabilizacao_partes_moles' },
    efeitos: [{ opcao: 'latarjet', efeito: 'favorece', forca: 'moderada' }],
    motivo: 'Falha após estabilização de partes moles: considerar Latarjet de revisão. Recorrência após Latarjet de 17,5% com estabilização prévia contra 5,1% no primário (meta-análise; moderada); coorte de revisão com 1 recorrência em 17 contra 1 em 43 no primário e OSI marginalmente pior (n pequeno; fraca). Reavaliar GBL e track com os dados atuais.',
    referencias: [{ ref: 'Bulleit2025' }, { ref: 'Konstantinou2025' }],
  },
  {
    id: 'N9.FALHA_CORACOIDE',
    titulo: 'Falha após transferência do coracoide',
    quando: { campo: 'tipo_episodio', op: '==', valor: 'falha_pos_transferencia_coracoide' },
    efeitos: [{ opcao: 'bankart_artro', efeito: 'favorece', forca: 'fraca' }],
    motivo: 'Falha após Latarjet/Bristow: em série de 15 pacientes tratados com estabilização artroscópica de partes moles, 93% tinham Bankart não reparado; 1 redeslocamento, 86% de retorno ao esporte e 2 paralisias axilares (fraca). Enxerto ósseo alternativo aparece só em relato de caso e não é regra.',
    referencias: [{ ref: 'Hoshika2025' }],
  },
  {
    id: 'N10.EPILEPSIA',
    titulo: 'Epilepsia',
    quando: { campo: 'epilepsia', op: '==', valor: true },
    efeitos: [],
    aviso: true,
    motivo: 'Epilepsia: recorrência após Latarjet de 16,7% contra 2,5% (7/42 contra 3/119; moderada); 90% das lesões off-track contra 30% sem epilepsia, com Hill-Sachs maiores (n = 50; fraca). O controle das crises não aparece nos resumos; decisão do cirurgião (D11).',
    referencias: [{ ref: 'Bulleit2025' }, { ref: 'Bige2025' }],
  },
];

export const INSTABILIDADE_ANTERIOR: AlgorithmDef = {
  id: 'SH_INST_ANT',
  versao: '0.1.1',
  patologias: [SH_INST_ANT_CODIGO],
  titulo: 'Instabilidade glenoumeral anterior: apoio à decisão cirúrgica (rascunho)',
  escopo: 'Instabilidade glenoumeral anterior traumática unidirecional (primeiro episódio, recorrente, falha após estabilização de partes moles ou após transferência do coracoide). Instabilidade posterior, multidirecional e voluntária ficam fora.',
  foraDeEscopo: [
    { id: 'ESC.VOLUNTARIA', texto: 'Instabilidade voluntária: fora do escopo deste algoritmo (instabilidade anterior traumática unidirecional).', quando: { campo: 'instabilidade_voluntaria', op: '==', valor: true } },
  ],
  entradas,
  parametros: [
    {
      id: 'gbl_critico_pct', rotulo: 'Limiar de perda glenoidal crítica', unidade: '%', min: 10, max: 35, padrao: 20,
      status: 'pendente_decisao_cirurgiao',
      nota: 'Pendente de decisão do cirurgião (D1). GBL a partir da qual a perda é tratada como crítica. Padrão proposto 20%; alternativas da literatura: 21% (cadavérico), 25% (consenso descrito em 2014), 25–27% (pera invertida), "20–25%" (histórico, militares).',
      referencias: [{ ref: 'Itoi2000' }, { ref: 'Lo2004' }, { ref: 'DiGiacomo2014' }, { ref: 'Shaha2015' }],
    },
    {
      id: 'gbl_zc_a_inferior_pct', rotulo: 'Limite inferior da zona cinzenta A', unidade: '%', min: 0, max: 20, padrao: 10,
      status: 'pendente_decisao_cirurgiao',
      nota: 'Pendente de decisão do cirurgião (D2). Abaixo deste valor a GBL não entra na zona cinzenta A. Padrão proposto 10% (NMA; revisão sistemática); alternativa 13,5% (militares; futebol americano universitário).',
      referencias: [{ ref: 'Masud2023' }, { ref: 'Trasolini2022' }, { ref: 'Shaha2015' }, { ref: 'Dickens2017' }],
    },
    {
      id: 'near_track_dtd_mm', rotulo: 'Limiar near-track (DTD)', unidade: 'mm', min: 0, max: 20, padrao: 8,
      status: 'pendente_decisao_cirurgiao',
      nota: 'Pendente de decisão do cirurgião (D4). On-track com DTD abaixo deste valor entra na zona cinzenta C. Padrão proposto 8 mm (AUC 0,73); alternativa 10 mm (subgrupos de outras séries); há quem trate o DTD como variável contínua ou não o use.',
      referencias: [{ ref: 'Li2021' }, { ref: 'Lin2023' }, { ref: 'Charles2025' }, { ref: 'Verweij2023' }, { ref: 'Dadoo2026' }],
    },
    {
      id: 'isis_corte_alto', rotulo: 'Corte alto do ISIS (ISIS acima deste valor)', unidade: 'pontos', min: 0, max: 10, inteiro: true, padrao: 6,
      status: 'pendente_decisao_cirurgiao',
      nota: 'Pendente de decisão do cirurgião (D7). ISIS acima deste valor dispara a faixa alta. Padrão proposto >6 (estudo original; validação externa; meta-análise).',
      referencias: [{ ref: 'Balg2007' }, { ref: 'vanBlommestein2024' }, { ref: 'Verweij2021' }],
    },
    {
      id: 'isis_corte_baixo', rotulo: 'Corte baixo do ISIS (ISIS até este valor)', unidade: 'pontos', min: 0, max: 10, inteiro: true, padrao: 3,
      status: 'pendente_decisao_cirurgiao',
      nota: 'Pendente de decisão do cirurgião (D7). ISIS até este valor é a faixa baixa; acima dele e até o corte alto, zona cinzenta D. Padrão proposto 3 (faixas 0–3 e 4–6); cortes da literatura: ≥4 (ROC), >3 (RR 3,28), 2–4 (revisão sistemática).',
      referencias: [{ ref: 'vanBlommestein2024' }, { ref: 'Chen2021' }, { ref: 'Verweij2021' }, { ref: 'Trasolini2022' }],
    },
  ],
  opcoes: [
    { id: 'bankart_artro', rotulo: 'Estabilização artroscópica de partes moles (Bankart) isolada', procedimentosIntraop: ['arthroscopic_bankart'] },
    { id: 'bankart_remplissage', rotulo: 'Bankart artroscópico + remplissage', procedimentosIntraop: ['bankart_plus_remplissage'] },
    { id: 'latarjet', rotulo: 'Aumento ósseo glenoidal (Latarjet / bloco ósseo)', procedimentosIntraop: ['latarjet_open', 'latarjet_arthroscopic', 'bone_block_iliac_crest', 'bone_block_distal_tibia', 'bone_block_other'] },
    { id: 'latarjet_remplissage', rotulo: 'Latarjet + remplissage' },
    { id: 'estabilizacao_dinamica', rotulo: 'Estabilização dinâmica anterior + Bankart' },
    { id: 'conservador', rotulo: 'Tratamento conservador (imobilização e reabilitação)', naoCirurgica: true },
  ],
  regras,
  referencias: [
    { id: 'Balg2007', citacao: 'Balg F, Boileau P. J Bone Joint Surg Br. 2007;89(11):1470-7.', pmid: '17998184', doi: '10.1302/0301-620X.89B11.18962', nivel: 'III', tipo: 'caso_controle' },
    { id: 'Yamamoto2007', citacao: 'Yamamoto N, Itoi E, et al. J Shoulder Elbow Surg. 2007;16(5):649-56.', pmid: '17644006', doi: '10.1016/j.jse.2006.12.012', nivel: 'V', tipo: 'biomecanico' },
    { id: 'DiGiacomo2014', citacao: 'Di Giacomo G, Itoi E, Burkhart SS. Arthroscopy. 2014;30(1):90-8.', pmid: '24384275', doi: '10.1016/j.arthro.2013.10.004', nivel: 'V', tipo: 'opiniao' },
    { id: 'Burkhart2000', citacao: 'Burkhart SS, De Beer JF. Arthroscopy. 2000;16(7):677-94.', pmid: '11027751', doi: '10.1053/jars.2000.17715', nivel: 'IV', tipo: 'serie_casos' },
    { id: 'Shaha2015', citacao: 'Shaha JS, et al. Am J Sports Med. 2015;43(7):1719-25.', pmid: '25883168', doi: '10.1177/0363546515578250', nivel: 'III', tipo: 'coorte' },
    { id: 'Itoi2000', citacao: 'Itoi E, et al. J Bone Joint Surg Am. 2000;82(1):35-46.', pmid: '10653082', doi: '10.2106/00004623-200001000-00005', nivel: 'V', tipo: 'biomecanico' },
    { id: 'Lo2004', citacao: 'Lo IK, Parten PM, Burkhart SS. Arthroscopy. 2004;20(2):169-74.', pmid: '14760350', doi: '10.1016/j.arthro.2003.11.036', nivel: 'V', tipo: 'biomecanico' },
    { id: 'Shaha2016', citacao: 'Shaha JS, et al. J Bone Joint Surg Am. 2016;98(22):1918-23.', pmid: '27852909', doi: '10.2106/JBJS.15.01099', nivel: 'III', tipo: 'coorte' },
    { id: 'Locher2016', citacao: 'Locher J, et al. Arthroscopy. 2016;32(10):1993-9.', pmid: '27161511', doi: '10.1016/j.arthro.2016.03.005', nivel: 'III', tipo: 'coorte' },
    { id: 'Dickens2017', citacao: 'Dickens JF, et al. Am J Sports Med. 2017;45(8):1769-75.', pmid: '28474965', doi: '10.1177/0363546517704184', nivel: 'III', tipo: 'coorte' },
    { id: 'Li2021', citacao: 'Li RT, et al. J Bone Joint Surg Am. 2021;103(11):961-7.', pmid: '33764924', doi: '10.2106/JBJS.20.00917', nivel: 'III', tipo: 'coorte' },
    { id: 'Verweij2023', citacao: 'Verweij LPE, et al. J Shoulder Elbow Surg. 2023;32(4):e145-52.', pmid: '36368476', doi: '10.1016/j.jse.2022.10.003', nivel: 'III', tipo: 'coorte' },
    { id: 'Lin2023', citacao: 'Lin A, et al. J Shoulder Elbow Surg. 2023;32(6S):S99-105.', pmid: '36828289', doi: '10.1016/j.jse.2023.02.011', nivel: 'III', tipo: 'coorte' },
    { id: 'Charles2025', citacao: 'Charles S, et al. Arthroscopy. 2025;41(10):3857-68.', pmid: '40414467', doi: '10.1016/j.arthro.2025.04.023', nivel: 'III', tipo: 'coorte' },
    { id: 'Dadoo2026', citacao: 'Dadoo S, et al. Orthop J Sports Med. 2026;14(4).', pmid: '41948442', doi: '10.1177/23259671261430742', nivel: 'III', tipo: 'coorte' },
    { id: 'Gracitelli2022', citacao: 'Gracitelli MEC, et al. Rev Bras Ortop. 2022;57(4):612-8.', pmid: '35966420', doi: '10.1055/s-0041-1741022', nivel: 'III', tipo: 'coorte' },
    { id: 'Rashid2024', citacao: 'Rashid MS, et al. Orthop J Sports Med. 2024;12(2).', pmid: '38390400', doi: '10.1177/23259671241226943', nivel: 'III', tipo: 'coorte' },
    { id: 'Mazzocca2025', citacao: 'Mazzocca JL, et al. Video J Sports Med. 2025;5(6).', pmid: '41283073', doi: '10.1177/26350254251364295', nivel: 'V', tipo: 'opiniao' },
    { id: 'vanBlommestein2024', citacao: 'van Blommestein MYH, et al. Knee Surg Sports Traumatol Arthrosc. 2024;32(8):2152-60.', pmid: '38720406', doi: '10.1002/ksa.12235', nivel: 'III', tipo: 'coorte' },
    { id: 'Chen2021', citacao: 'Chen KH, et al. Knee Surg Sports Traumatol Arthrosc. 2021;29(1):250-6.', pmid: '32253482', doi: '10.1007/s00167-020-05955-0', nivel: 'III', tipo: 'coorte' },
    { id: 'Verweij2021', citacao: 'Verweij LPE, et al. Knee Surg Sports Traumatol Arthrosc. 2021;29(12):4004-14.', pmid: '34420117', doi: '10.1007/s00167-021-06704-7', nivel: 'III', tipo: 'metanalise' },
    { id: 'Trasolini2022', citacao: 'Trasolini NA, et al. Am J Sports Med. 2022;50(13):3705-13.', pmid: '34591717', doi: '10.1177/03635465211038712', nivel: 'IV', tipo: 'revisao_sistematica' },
    { id: 'Zhang2022', citacao: 'Zhang M, et al. J Orthop Surg Res. 2022;17(1):113.', pmid: '35184753', doi: '10.1186/s13018-022-03011-w', nivel: 'III', tipo: 'metanalise' },
    { id: 'Bulleit2024', citacao: 'Bulleit CH, et al. J Shoulder Elbow Surg. 2024;33(11):2539-49.', pmid: '38852707', doi: '10.1016/j.jse.2024.04.017', nivel: 'III', tipo: 'metanalise' },
    { id: 'SanchezCruz2026', citacao: 'Sánchez Cruz D, et al. J ISAKOS. 2026;18:101113.', pmid: '41966481', doi: '10.1016/j.jisako.2026.101113', nivel: 'III', tipo: 'metanalise' },
    { id: 'Bulleit2025', citacao: 'Bulleit CH, et al. J Shoulder Elbow Surg. 2025;34(5):1305-12.', pmid: '39528041', doi: '10.1016/j.jse.2024.08.054', nivel: 'III', tipo: 'metanalise' },
    { id: 'Masud2023', citacao: 'Masud S, et al. J Shoulder Elbow Surg. 2023;32(11):e531-47.', pmid: '37541334', doi: '10.1016/j.jse.2023.07.004', nivel: 'III', tipo: 'metanalise' },
    { id: 'Pawlus2025', citacao: 'Pawłuś N, et al. Am J Sports Med. 2025;53(3):717-26.', pmid: '38742747', doi: '10.1177/03635465241249492', nivel: 'III', tipo: 'metanalise' },
    { id: 'Ahmed2024', citacao: 'Ahmed AF, et al. J Shoulder Elbow Surg. 2024;33(8):1836-46.', pmid: '38499236', doi: '10.1016/j.jse.2024.01.045', nivel: 'III', tipo: 'metanalise' },
    { id: 'VillarrealEspinosa2024', citacao: 'Villarreal-Espinosa JB, et al. Knee Surg Sports Traumatol Arthrosc. 2024;32(2):243-56.', pmid: '38258962', doi: '10.1002/ksa.12054', nivel: 'III', tipo: 'metanalise' },
    { id: 'Haroun2020', citacao: 'Haroun HK, et al. J Shoulder Elbow Surg. 2020;29(10):2163-74.', pmid: '32807370', doi: '10.1016/j.jse.2020.04.032', nivel: 'III', tipo: 'revisao_sistematica' },
    { id: 'Hurley2020', citacao: 'Hurley ET, et al. J Shoulder Elbow Surg. 2020;29(12):2487-94.', pmid: '32650087', doi: '10.1016/j.jse.2020.06.021', nivel: 'III', tipo: 'metanalise' },
    { id: 'Belk2023', citacao: 'Belk JW, et al. Am J Sports Med. 2023;51(6):1634-43.', pmid: '35148222', doi: '10.1177/03635465211065403', nivel: 'I', tipo: 'metanalise' },
    { id: 'ViragTulassay2026', citacao: 'Virág-Tulassay EÉ, et al. J Orthop Translat. 2026;56:101007.', pmid: '41836574', doi: '10.1016/j.jot.2025.09.011', nivel: 'I', tipo: 'metanalise' },
    { id: 'Boutros2026', citacao: 'Boutros M, et al. Phys Sportsmed. 2026;54(4):251-65.', pmid: '41843404', doi: '10.1080/00913847.2026.2647715', nivel: 'I', tipo: 'metanalise' },
    { id: 'Khoshaba2026', citacao: 'Khoshaba R, et al. Cureus. 2026;18(1):e101704.', pmid: '41700290', doi: '10.7759/cureus.101704', nivel: 'III', tipo: 'metanalise' },
    { id: 'Arvesen2026', citacao: 'Arvesen JE, et al. Am J Sports Med. 2026.', pmid: '42770535', doi: '10.1177/03635465261483327', nivel: 'III', tipo: 'coorte' },
    { id: 'Cognetti2023', citacao: 'Cognetti DJ, et al. Arthrosc Sports Med Rehabil. 2023;5(2):e403-9.', pmid: '37101867', doi: '10.1016/j.asmr.2023.01.007', nivel: 'IV', tipo: 'coorte' },
    { id: 'Spinello2025', citacao: 'Spinello P, et al. J Shoulder Elbow Surg. 2025;34(7):1681-91.', pmid: '39716616', doi: '10.1016/j.jse.2024.10.019', nivel: 'IV', tipo: 'coorte' },
    { id: 'Colson2026', citacao: 'Colson CB, et al. Orthop J Sports Med. 2026;14(5).', pmid: '42117061', doi: '10.1177/23259671261436437', nivel: 'IV', tipo: 'revisao_sistematica' },
    { id: 'Konstantinou2025', citacao: 'Konstantinou E, et al. Orthop J Sports Med. 2025;13(6).', pmid: '40546994', doi: '10.1177/23259671251343807', nivel: 'III', tipo: 'coorte' },
    { id: 'Hoshika2025', citacao: 'Hoshika S, et al. JSES Int. 2025;9(3):619-24.', pmid: '40486776', doi: '10.1016/j.jseint.2024.12.019', nivel: 'IV', tipo: 'serie_casos' },
    { id: 'Bige2025', citacao: 'Bige B, et al. J Shoulder Elbow Surg. 2025;34(4):937-43.', pmid: '39111686', doi: '10.1016/j.jse.2024.06.006', nivel: 'III', tipo: 'caso_controle' },
    { id: 'Nair2025', citacao: 'Nair AV, et al. JSES Int. 2025;9(4):1009-14.', pmid: '40703425', doi: '10.1016/j.jseint.2025.01.015', nivel: 'IV', tipo: 'serie_casos' },
    { id: 'Ahmed2026', citacao: 'Ahmed AF, et al. Int Orthop. 2026;50(1):159-69.', pmid: '41247526', doi: '10.1007/s00264-025-06674-2', nivel: 'IV', tipo: 'revisao_sistematica' },
    { id: 'Sheean2021', citacao: 'Sheean AJ. Arthroscopy. 2021;37(8):2462-4.', pmid: '34353556', doi: '10.1016/j.arthro.2021.05.049', nivel: 'V', tipo: 'opiniao' },
    { id: 'Sciarretti2026', citacao: 'Sciarretti N, et al. Video J Sports Med. 2026;6(4).', pmid: '42437046', doi: '10.1177/26350254251408434', nivel: 'V', tipo: 'opiniao' },
  ],
  avisosGerais: [
    'Rascunho não revisado pelo cirurgião. Sugestão baseada em literatura; a decisão é do cirurgião.',
    'Parâmetros pendentes de decisão do cirurgião: limiar de GBL crítica, limite inferior da zona cinzenta A, limiar near-track e cortes do ISIS usam o padrão proposto pela especificação.',
    'ISIS: informar o total. A pontuação por item requer o texto completo do estudo original e não é calculada aqui.',
    'Glenoid track calculado como 0,83·D − d (fórmula citada em vídeo técnico; a derivação original requer texto completo) e DTD = GT − HSI, positiva quando on-track. Coeficiente e convenção de sinal pendentes de decisão do cirurgião (D5).',
    'Populações: parte dos números vem de coortes militares ou de futebol americano universitário; a transposição para civis é decisão do cirurgião (D13). A definição de recorrência varia entre as fontes (só luxação, ou luxação + subluxação + apreensão).',
    'Aconselhamento: artrose radiográfica em 40,7% (IC 32,6–49,2) com seguimento médio de 139 meses, grau ≥II em 10,5%; Bankart artroscópico 47,2% e Latarjet 30,3%, com intervalos sobrepostos e sem diferença significativa afirmada no resumo.',
    AVISO_NIVEIS_EVIDENCIA,
  ],
  referenciasGerais: [{ ref: 'Colson2026' }, { ref: 'Mazzocca2025' }, { ref: 'DiGiacomo2014' }, { ref: 'Yamamoto2007' }],
};

// ---------------------------------------------------------------------------------------------
// Mapeamento payload → entrada do algoritmo
// ---------------------------------------------------------------------------------------------

export interface ConflitoEntrada {
  entrada: string;
  /** Valor usado (do payload ou derivado). */
  usado: unknown;
  /** Valor descartado e de onde vinha. */
  descartado: unknown;
  origemDescartada: Proveniencia;
}

export interface EntradaMapeada {
  entrada: Record<string, unknown>;
  proveniencia: Record<string, Proveniencia>;
  conflitos: ConflitoEntrada[];
}

export interface OpcoesMapeamento {
  /** Data de nascimento do paciente (AAAA-MM-DD). */
  dataNascimento?: string;
  /** Data de referência para a idade (cirurgia ou avaliação, AAAA-MM-DD). Padrão: avaliacaoPreop.comum.data_avaliacao. */
  dataReferencia?: string;
  /** Valores digitados no painel de apoio. Não sobrescrevem o payload: divergência vai para `conflitos`. */
  manual?: Record<string, unknown>;
}

/** Idade em anos completos entre duas datas ISO (mesma função do mapeamento no servidor). */
export { idadeEmAnos };

const presente = (v: unknown) => v !== undefined && v !== null && !(typeof v === 'string' && v.trim() === '');

/**
 * Tipo de episódio a partir do bloco pré-operatório. Sem dado suficiente → undefined (nunca um padrão).
 * prior_surgery: latarjet → falha após coracoide; Bankart aberto/artroscópico → falha de partes moles;
 * 'other' → indeterminado. Sem cirurgia prévia (ou 0 cirurgias): episodes 'first' → primeiro episódio,
 * '2_to_5'/'gt_5' → recorrente. Um primeiro episódio não tem estabilização prévia que possa ter falhado.
 */
export function tipoEpisodio(d: Record<string, unknown>): (typeof TIPO_EPISODIO)[number] | undefined {
  const prior = d.prior_surgery;
  if (prior === 'latarjet') return 'falha_pos_transferencia_coracoide';
  if (prior === 'arthroscopic_bankart' || prior === 'open_bankart') return 'falha_pos_estabilizacao_partes_moles';
  if (prior === 'other') return undefined;
  if (d.episodes === 'first') return 'primeiro_episodio';
  const semCirurgia = prior === 'none' || d.n_cirurgias_estabilizacao_previas === 0;
  if (semCirurgia && (d.episodes === '2_to_5' || d.episodes === 'gt_5')) return 'recorrente';
  return undefined;
}

/** Campos do SH_INST_ANT.diagnosis.v2 copiados como estão (id da entrada → campo do schema). */
const DIRETOS: [string, string][] = [
  ['instabilidade_voluntaria', 'voluntary'],
  ['esporte_competitivo', 'sport_competitive'],
  ['esporte_contato_ou_arremesso', 'sport_contact_or_forced_overhead'],
  ['hiperlaxidade', 'hyperlaxity'],
  ['n_luxacoes', 'n_luxacoes'],
  ['meses_desde_primeiro_episodio', 'meses_desde_primeiro_episodio'],
  ['epilepsia', 'epilepsy'],
  ['lesoes_partes_moles', 'soft_tissue_lesions'],
  ['D_mm', 'D_mm'],
  ['d_mm', 'd_mm'],
  ['hsi_mm', 'hsi_mm'],
];

/**
 * Monta a entrada do algoritmo a partir do payload clínico v2 (`avaliacaoPreop`, via `preopFor`) e do
 * paciente, com a proveniência de cada valor. Campo ausente fica ausente (nunca 0 nem false).
 * Medida implausível (D, d, HSI) → ClinicalGuardError, como em `instability/metrics.ts`.
 */
export function entradaInstabilidadeAnterior(
  payload: Pick<ClinicalPayload, 'avaliacaoPreop'>,
  opts: OpcoesMapeamento = {},
): EntradaMapeada {
  const d: Record<string, unknown> = preopFor(payload, SH_INST_ANT_CODIGO)?.dados ?? {};
  const entrada: Record<string, unknown> = {};
  const proveniencia: Record<string, Proveniencia> = {};
  const set = (id: string, v: unknown, de: Proveniencia) => {
    if (!presente(v)) return;
    entrada[id] = v;
    proveniencia[id] = de;
  };

  for (const [id, campo] of DIRETOS) set(id, d[campo], 'payload');

  const dataRef = opts.dataReferencia ?? (payload.avaliacaoPreop?.comum?.data_avaliacao as string | undefined);
  set('idade', idadeEmAnos(opts.dataNascimento, dataRef), 'paciente');
  set('tipo_episodio', tipoEpisodio(d), 'derivada');

  const temDd = typeof d.D_mm === 'number' && typeof d.d_mm === 'number';
  const conflitos: ConflitoEntrada[] = [];
  if (temDd) {
    const gbl = glenoidBoneLossPct(d.D_mm as number, d.d_mm as number);
    set('gbl_pct', gbl, 'derivada');
    if (typeof d.gbl_pct_direto === 'number' && d.gbl_pct_direto !== gbl) {
      conflitos.push({ entrada: 'gbl_pct', usado: gbl, descartado: d.gbl_pct_direto, origemDescartada: 'payload' });
    }
    const gt = glenoidTrack(d.D_mm as number, d.d_mm as number);
    set('gt_mm', gt, 'derivada');
    if (typeof d.hsi_mm === 'number') {
      const t = trackStatus(gt, d.hsi_mm);
      set('track_status', t.track, 'derivada');
      set('dtd_mm', t.margin_mm, 'derivada');
    }
  } else {
    set('gbl_pct', d.gbl_pct_direto, 'payload');
  }

  const declaradas = new Set(INSTABILIDADE_ANTERIOR.entradas.map((e) => e.id));
  for (const [id, v] of Object.entries(opts.manual ?? {})) {
    if (!declaradas.has(id)) throw new ClinicalGuardError('DS_UNKNOWN_INPUT', `Entrada "${id}" não pertence ao algoritmo ${INSTABILIDADE_ANTERIOR.id}.`, id);
    if (!presente(v)) continue;
    if (id in entrada) {
      if (JSON.stringify(entrada[id]) !== JSON.stringify(v)) {
        conflitos.push({ entrada: id, usado: entrada[id], descartado: v, origemDescartada: 'manual' });
      }
      continue;
    }
    set(id, v, 'manual');
  }
  return { entrada, proveniencia, conflitos };
}
