/**
 * Apoio à decisão: lesões do manguito rotador (RASCUNHO, não registrado).
 *
 * Fonte única: spec verificada `spec-manguito-rotador.md` v0.1 (2026-09-28), PMIDs conferidos no PubMed.
 * Regras de construção seguidas (spec §0):
 *  - Só entram números que a spec marca como verificados no resumo. Itens "requer texto completo"
 *    (mm de Hamada, definições de Goutallier/Patte/Thomazeau/Fuchs/Ellman em mm, pesos e direção do
 *    escore de Park, força de cada item da CPG AAOS 2025, definição de pseudoparalisia de Collin)
 *    NÃO disparam efeitos: no máximo aparecem em avisos informativos.
 *  - Idade é contínua: nenhuma condição usa idade. As faixas (<70, ≥65, >70, ≥75, ≤45) aparecem só
 *    como população dos estudos.
 *  - Graus (Hamada 1–5, Goutallier 0–4, Patte 1–3, Ellman 1–3) são os registrados pelo cirurgião;
 *    o algoritmo nunca deriva grau de medida em mm.
 *  - Zonas cinzentas (ZC1, ZC1-P, ZC2 e zonas de técnica) têm `controversia` com as alternativas e a
 *    evidência de cada uma; nenhuma escolhe vencedora.
 *
 * Nível de evidência de cada referência: atribuído de forma conservadora a partir do desenho de estudo
 * descrito na spec (§1, §4, §9); a força (forte/moderada/fraca) de cada efeito é a da spec.
 */
import type { ClinicalPayload } from '../../surgery/payload';
import { preopFor } from '../../surgery/payload';
import type {
  AlgorithmDef, CitRef, Cond, EntradaDef, NivelEvidencia, Proveniencia, Referencia, TipoEstudo,
} from '../types';

// ---------------------------------------------------------------------------------------------
// Referências (spec §9). Citações abreviadas; PMID e DOI conforme o PubMed.
// ---------------------------------------------------------------------------------------------
function ref(id: string, citacao: string, pmid: string, doi: string | undefined, nivel: NivelEvidencia, tipo: TipoEstudo): Referencia {
  return doi ? { id, citacao, pmid, doi, nivel, tipo } : { id, citacao, pmid, nivel, tipo };
}

const REFERENCIAS: Referencia[] = [
  // 9.1 Fundacionais
  ref('Goutallier1994', 'Goutallier D, Postel JM, Bernageau J, et al. Fatty muscle degeneration in cuff ruptures. Pre- and postoperative evaluation by CT scan. Clin Orthop Relat Res. 1994;(304):78-83.', '8020238', undefined, 'IV', 'serie_casos'),
  ref('Goutallier2003', 'Goutallier D, Postel JM, Gleyze P, et al. Influence of cuff muscle fatty degeneration on anatomic and functional outcomes after simple suture of full-thickness tears. J Shoulder Elbow Surg. 2003;12(6):550-4.', '14671517', '10.1016/s1058-2746(03)00211-8', 'III', 'coorte'),
  ref('Fuchs1999', 'Fuchs B, Weishaupt D, Zanetti M, et al. Fatty degeneration of the muscles of the rotator cuff: CT versus MRI. J Shoulder Elbow Surg. 1999;8(6):599-605.', '10633896', '10.1016/s1058-2746(99)90097-6', 'III', 'coorte'),
  ref('Hamada1990', 'Hamada K, Fukuda H, Mikasa M, et al. Roentgenographic findings in massive rotator cuff tears. A long-term observation. Clin Orthop Relat Res. 1990;(254):92-6.', '2323152', undefined, 'IV', 'serie_casos'),
  ref('Zanetti1998', 'Zanetti M, Gerber C, Hodler J. Quantitative assessment of the muscles of the rotator cuff with MRI (tangent sign). Invest Radiol. 1998;33(3):163-70.', '9525755', '10.1097/00004424-199803000-00006', 'III', 'coorte'),
  ref('Gladstone2007', 'Gladstone JN, Bishop JY, Lo IK, Flatow EL. Fatty infiltration and atrophy of the rotator cuff do not improve after rotator cuff repair and correlate with poor functional outcome. Am J Sports Med. 2007;35(5):719-28.', '17337727', '10.1177/0363546506297539', 'II', 'coorte'),
  ref('Sugaya2007', 'Sugaya H, Maeda K, Matsuki K, Moriishi J. Repair integrity and functional outcome after arthroscopic double-row rotator cuff repair. J Bone Joint Surg Am. 2007;89(5):953-60.', '17473131', '10.2106/JBJS.F.00512', 'IV', 'serie_casos'),
  ref('Ellman1990', 'Ellman H. Diagnosis and treatment of incomplete rotator cuff tears. Clin Orthop Relat Res. 1990;(254):64-74.', '2182260', undefined, 'IV', 'serie_casos'),
  ref('Collin2014', 'Collin P, Matsumura N, Lädermann A, et al. Relationship between massive chronic rotator cuff tear pattern and loss of active shoulder range of motion. J Shoulder Elbow Surg. 2014;23(8):1195-202.', '24433628', '10.1016/j.jse.2013.11.019', 'III', 'coorte'),
  ref('Metcalfe2022', 'Metcalfe A, Parsons H, Parsons N, et al. Subacromial balloon spacer for irreparable rotator cuff tears (START:REACTS): RCT. Lancet. 2022;399(10339):1954-1963.', '35461618', '10.1016/S0140-6736(22)00652-3', 'I', 'ECR'),
  ref('Verma2022', 'Verma N, Srikumaran U, Roden CM, et al. InSpace implant compared with partial repair for massive rotator cuff tears: RCT. J Bone Joint Surg Am. 2022;104(14):1250-1262.', '35777921', '10.2106/JBJS.21.00667', 'I', 'ECR'),
  ref('Mihata2013', 'Mihata T, Lee TQ, Watanabe C, et al. Clinical results of arthroscopic superior capsule reconstruction for irreparable rotator cuff tears. Arthroscopy. 2013;29(3):459-70.', '23369443', '10.1016/j.arthro.2012.10.022', 'IV', 'serie_casos'),
  ref('Werthel2021', 'Werthel JD, Vigan M, Schoch B, et al. Superior capsular reconstruction: a systematic review and meta-analysis. Orthop Traumatol Surg Res. 2021;107(8S):103072.', '34560311', '10.1016/j.otsr.2021.103072', 'III', 'metanalise'),
  ref('Lauck2025', 'Lauck BJ, Reynolds AW, van der List JP, et al. Lower trapezius tendon transfer for irreparable rotator cuff tears: a systematic review. Arthroscopy. 2025;41(11):4818-4825.e4.', '40349800', '10.1016/j.arthro.2025.04.026', 'IV', 'revisao_sistematica'),
  ref('BaekMA2026', 'Baek CH, Kim JG, Kim BT. Meta-analysis and systematic review of arthroscopic lower trapezius tendon transfer. Shoulder Elbow. 2026.', '42255992', '10.1177/17585732261455827', 'IV', 'metanalise'),
  // 9.2 Apoio
  ref('Gu2023', 'Gu Z, Wu S, Yang Y, et al. Single-row vs double-row repair by tear size: SR/MA. Orthop J Sports Med. 2023;11(8).', '37655249', '10.1177/23259671231180854', 'III', 'metanalise'),
  ref('Zhao2021', 'Zhao J, Luo M, Pan J, et al. Risk factors affecting rotator cuff retear after arthroscopic repair: meta-analysis. J Shoulder Elbow Surg. 2021;30(11):2660-2670.', '34089878', '10.1016/j.jse.2021.05.010', 'III', 'metanalise'),
  ref('Longo2021', 'Longo UG, Carnevale A, Piergentili I, et al. Retear rates after rotator cuff surgery: SR/MA. BMC Musculoskelet Disord. 2021;22(1):749.', '34465332', '10.1186/s12891-021-04634-6', 'III', 'metanalise'),
  ref('McElvany2015', 'McElvany MD, McGoldrick E, Gee AO, et al. Rotator cuff repair: factors associated with repair integrity and clinical outcome. Am J Sports Med. 2015;43(2):491-500.', '24753240', '10.1177/0363546514529644', 'III', 'metanalise'),
  ref('Park2020', 'Park I, Kang JS, Lee HA, et al. A novel reparability assessment scoring system. Orthop J Sports Med. 2020;8(8).', '32844101', '10.1177/2325967120940979', 'III', 'coorte'),
  ref('Naimark2019', 'Naimark M, Trinh T, Robbins C, et al. Effect of muscle quality on operative and nonoperative treatment. Orthop J Sports Med. 2019;7(8).', '31428659', '10.1177/2325967119863010', 'II', 'coorte'),
  ref('Fossati2021', 'Fossati C, Stoppani C, Menon A, et al. Arthroscopic rotator cuff repair in patients over 70: SR. J Orthop Traumatol. 2021;22(1):3.', '33599856', '10.1186/s10195-021-00565-z', 'IV', 'revisao_sistematica'),
  ref('Robinson2013', 'Robinson PM, Wilson J, Dalal S, et al. Rotator cuff repair in patients over 70. Bone Joint J. 2013;95-B(2):199-205.', '23365029', '10.1302/0301-620X.95B2.30246', 'IV', 'serie_casos'),
  ref('Stone2020', 'Stone MA, Ho JC, Kane LT, et al. Midterm outcomes of ARCR in patients ≥75. J Shoulder Elbow Surg. 2020;29(7S):S17-S22.', '32088076', '10.1016/j.jse.2019.11.022', 'IV', 'serie_casos'),
  ref('Kim2025', 'Kim SH, et al. SCR vs RSA in patients ≥65: propensity-matched. Asia Pac J Sports Med Arthrosc Rehabil Technol. 2025;42:54-61.', '41050837', '10.1016/j.asmart.2025.08.001', 'III', 'coorte'),
  ref('Takayama2025', 'Takayama K, Ito H. SCR vs rTSA in pseudoparalysis without OA. J Shoulder Elbow Surg. 2025;34(3):876-885.', '39121946', '10.1016/j.jse.2024.06.017', 'III', 'coorte'),
  ref('Bi2024', 'Bi AS, Anil U, Colasanti CA, et al. Treatments for MIRCT in patients <70: NMA. Am J Sports Med. 2024;52(11):2919-2930.', '38291995', '10.1177/03635465231204623', 'III', 'metanalise'),
  ref('Viswanath2021', 'Viswanath A, Bale S, Trail I. RTSA for irreparable tears without arthritis: SR. J Clin Orthop Trauma. 2021;17:267-272.', '33936948', '10.1016/j.jcot.2021.04.005', 'IV', 'revisao_sistematica'),
  ref('Duralde2012', 'Duralde XA, McClelland WB. Transtendinous repair of Ellman grade III partial articular-sided tears. Arthroscopy. 2012;28(2):160-8.', '22078003', '10.1016/j.arthro.2011.08.286', 'IV', 'serie_casos'),
  ref('Wu2026', 'Wu CL, et al. Torn supraspinatus thickness and radiological predictors of repairability. BMC Musculoskelet Disord. 2026;27(1).', '42129720', '10.1186/s12891-026-09951-2', 'IV', 'coorte'),
  // 9.3 Dossiê (usar só como a spec §1 descreve)
  ref('Ye2026', 'Ye Y, et al. Interpretação da CPG AAOS 2025 (manguito rotador). Zhongguo Xiu Fu Chong Jian Wai Ke Za Zhi. 2026;40(2):197-203.', '41730726', '10.7507/1002-1892.202511084', 'V', 'opiniao'),
  ref('Hurley2026a', 'Hurley ET, et al. Rotator Cuff Tears Part I: consenso. Arthroscopy. 2026.', '42770373', '10.1002/arj.70365', 'V', 'consenso'),
  ref('Hurley2026b', 'Hurley ET, et al. Rotator Cuff Tears Part II: consenso. Arthroscopy. 2026.', '42770381', '10.1002/arj.70366', 'V', 'consenso'),
  ref('Kany2026', 'Kany J, et al. ESSKA-ESA: consenso formal sobre lesões parciais (Parte 2). Knee Surg Sports Traumatol Arthrosc. 2026.', '42766425', '10.1002/ksa.70622', 'V', 'consenso'),
  ref('Mariaux2026', 'Mariaux S, et al. Reparo do manguito em pacientes ≤45 anos. Orthop J Sports Med. 2026;14(9).', '42732273', '10.1177/23259671261476548', 'IV', 'serie_casos'),
  ref('Lara2026', 'Lara PHS, et al. SBCOC: reparo precoce vs tardio em lesões traumáticas. Acta Ortop Bras. 2026;34(spe1):e308952.', '42662982', '10.1590/1413-785220263401e308952', 'III', 'revisao_sistematica'),
  ref('Lee2026', 'Lee SM, et al. Déficits de força pré-operatórios e retear. Arthroscopy. 2026;42(10):1997-2007.', '42504916', '10.1002/arj.70399', 'III', 'coorte'),
  ref('BaekBiceps2026', 'Baek CH, et al. Augmentation com SCR de bíceps no reparo do manguito. Arthrosc Sports Med Rehabil. 2026;8(4):e70007.', '42500152', '10.1002/ars2.70007', 'IV', 'serie_casos'),
  ref('ChangCD2026', 'Chang CD, et al. SCR vs ponte com derme alogênica. Medicine (Baltimore). 2026;105(35):e50320.', '42675771', '10.1097/MD.0000000000050320', 'IV', 'coorte'),
  ref('Adriani2024', 'Adriani M, et al. Reliability of MRI criteria: SR. Am J Sports Med. 2024;52(3):845-858.', '37183988', '10.1177/03635465231166077', 'III', 'revisao_sistematica'),
  ref('Thamrongskulsiri2026', 'Thamrongskulsiri N, et al. SCR vs RSA: meta-analysis. Clin Orthop Surg. 2026;18(3):485-497.', '42226776', '10.4055/cios25259', 'III', 'metanalise'),
  ref('BaekDAH2026', 'Baek CH, et al. LTT com DAH ≥6 vs <6 mm. J Orthop. 2026;77:43-48.', '42179369', '10.1016/j.jor.2026.04.017', 'III', 'coorte'),
  ref('Bayram2026', 'Bayram B, et al. Reparo parcial vs SCR. BMC Musculoskelet Disord. 2026;27(1).', '42323584', '10.1186/s12891-026-10038-1', 'III', 'coorte'),
  ref('ChangHH2026', 'Chang HH, et al. Broken transverse force coupling após LTT. Clin Orthop Surg. 2026;18(3):519-528.', '42226777', '10.4055/cios25317', 'IV', 'coorte'),
  ref('Lim2026', 'Lim JJ, et al. Concentração plaquetária e PRP em lesões parciais: MA. Orthop J Sports Med. 2026;14(9).', '42729508', '10.1177/23259671261480483', 'III', 'metanalise'),
  ref('Sudah2024', 'Sudah SY, et al. Reverse Fragility Index: mobilização precoce vs tardia. HSS J. 2024;20(2):254-260.', '39281999', '10.1177/15563316231157760', 'II', 'revisao_sistematica'),
  ref('Jin2024', 'Jin H, et al. Massive RCT surgical management: NMA de ECRs. Burns Trauma. 2024;12:tkad052.', '38343900', '10.1093/burnst/tkad052', 'II', 'metanalise'),
  ref('Eichinger2026', 'Eichinger JK. Editorial: espessura do enxerto na SCR. Arthroscopy. 2026;42(9):1570-1571.', '42135898', '10.1002/arj.70364', 'V', 'opiniao'),
  ref('BaekLTT5a2026', 'Baek CH, et al. LTT aos 5 anos: MCID/PASS. Arthroscopy. 2026;42(10):1946-1954.', '42323885', '10.1002/arj.70369', 'IV', 'serie_casos'),
  ref('BaekSSC2026', 'Baek CH, et al. LTT com lesão do subescapular. Arthroscopy. 2026;42(9):1506-1514.', '42036362', '10.1002/arj.70188', 'III', 'coorte'),
  ref('BaekLTTBiceps2026', 'Baek CH, et al. Augmentation com bíceps na LTT. Arch Orthop Trauma Surg. 2026;146(1).', '42098555', '10.1007/s00402-026-06290-8', 'III', 'coorte'),
  ref('BaekALDTM2026', 'Baek CH, et al. Lesão da JMT do redondo maior após aLDTM. J Shoulder Elbow Surg. 2026;35(10):e970-e981.', '42069135', '10.1016/j.jse.2026.04.033', 'IV', 'serie_casos'),
  ref('Gou2026', 'Gou X, et al. STR com enxerto híbrido LARS-fáscia lata. JBJS Essent Surg Tech. 2026;16(3).', '42781232', '10.2106/JBJS.ST.25.00032', 'V', 'opiniao'),
  ref('Takayama2026', 'Takayama K, Ito H. Força muscular: RSA vs SCR com fáscia lata. JSES Int. 2026;10(5):101749.', '42438833', '10.1016/j.jseint.2026.101749', 'III', 'coorte'),
  ref('Shekhbihi2024', 'Shekhbihi A, et al. Índice de acetabularização. Eur J Orthop Surg Traumatol. 2024;34(8):4019-4026.', '39302446', '10.1007/s00590-024-04102-6', 'IV', 'serie_casos'),
  ref('Srikumaran2023', 'Srikumaran U, Russo R, Familiari F. Subacromial balloon spacer (comentário). Arthroscopy. 2023;39(3):576-577.', '36740282', '10.1016/j.arthro.2022.11.011', 'V', 'opiniao'),
  ref('Haque2025', 'Haque A, et al. START:REACTS aos 2 anos. Am J Sports Med. 2025;53(6):1291-1298.', '40156172', '10.1177/03635465251326891', 'I', 'ECR'),
  ref('Albishi2026', 'Albishi W, et al. Balão subacromial: benefício limitado. JBJS Rev. 2026;14(2).', '41739950', '10.2106/JBJS.RVW.25.00231', 'V', 'opiniao'),
  ref('Dasari2022', 'Dasari SP, et al. Balão subacromial (técnica cirúrgica). JBJS Essent Surg Tech. 2022;12(2).', '36741038', '10.2106/JBJS.ST.21.00069', 'V', 'opiniao'),
  ref('Rashid2026', 'Rashid MS, Roberts CP. Editorial sobre a LTT. Arthroscopy. 2026;42(9):1515-1516.', '42047459', '10.1002/arj.70195', 'V', 'opiniao'),
  ref('Zhou2023', 'Zhou X, et al. NMA de tratamentos para lesões irreparáveis. Medicine (Baltimore). 2023;102(22):e33832.', '37266652', '10.1097/MD.0000000000033832', 'III', 'metanalise'),
  ref('OConaire2023', 'Ó Conaire E, et al. MIRCT: quem se beneficia de fisioterapia. Int J Environ Res Public Health. 2023;20(7).', '37047860', '10.3390/ijerph20075242', 'V', 'opiniao'),
  ref('Flurin2026', 'Flurin PH, et al. RSA após reparo falho do manguito. Orthop Traumatol Surg Res. 2026;112(3):104575.', '41429270', '10.1016/j.otsr.2025.104575', 'IV', 'serie_casos'),
  ref('Alvarez2026', 'Álvarez de la Cruz J, et al. CSA como fator prognóstico. J Clin Med. 2026;15(12).', '42355609', '10.3390/jcm15124441', 'IV', 'coorte'),
  ref('Rosenblum2024', 'Rosenblum J, et al. Reparo primário de lesões massivas: 2 anos. Arthroscopy. 2024;40(9):2353-2360.', '38428700', '10.1016/j.arthro.2024.02.026', 'IV', 'serie_casos'),
];

const c = (ref: string, nota?: string): CitRef => (nota ? { ref, nota } : { ref });

// ---------------------------------------------------------------------------------------------
// Entradas (spec §3). Nenhuma tem valor padrão: ausente fica ausente.
// ---------------------------------------------------------------------------------------------
const DX = 'avaliacaoPreop.patologias[SH_RCT.diagnosis.v1].dados';
const COMUM = 'avaliacaoPreop.comum';
const pre = (e: Omit<EntradaDef, 'momento'>): EntradaDef => ({ ...e, momento: 'preop' });
const manual = { de: 'manual' } as const;

const ENTRADAS: EntradaDef[] = [
  pre({ id: 'lesao_sintomatica_confirmada', rotulo: 'Lesão sintomática do manguito confirmada por imagem', def: { tipo: 'booleano' }, origem: manual }),
  pre({ id: 'idade', rotulo: 'Idade (contínua; sem corte)', def: { tipo: 'numero', unidade: 'anos', min: 0, max: 120 }, origem: { de: 'paciente', campo: 'idade' } }),
  pre({ id: 'inicio', rotulo: 'Início', def: { tipo: 'enum', valores: ['traumatico_agudo', 'agudo_sobre_cronico', 'degenerativo'] }, origem: { de: 'payload', caminho: `${DX}.inicio` } }),
  pre({ id: 'semanas_desde_lesao', rotulo: 'Semanas desde a lesão', def: { tipo: 'numero', unidade: 'semanas', min: 0, max: 2600 }, origem: { de: 'payload', caminho: `${DX}.semanas_desde_lesao` } }),
  pre({ id: 'duracao_sintomas_meses', rotulo: 'Duração dos sintomas', def: { tipo: 'numero', unidade: 'meses', min: 0, max: 600 }, origem: manual }),
  pre({ id: 'tipo_rotura', rotulo: 'Espessura / tipo da rotura (RM)', def: { tipo: 'enum', valores: ['parcial_articular', 'parcial_bursal', 'parcial_intersticial', 'completa'] }, origem: { de: 'payload', caminho: `${DX}.tipo_rotura_rm` } }),
  pre({ id: 'ellman', rotulo: 'Grau de Ellman (registrado)', def: { tipo: 'numero', min: 1, max: 3, inteiro: true }, origem: { de: 'payload', caminho: `${DX}.ellman_rm` } }),
  pre({ id: 'parcial_profundidade_pct', rotulo: 'Profundidade da lesão parcial', def: { tipo: 'numero', unidade: '% da espessura', min: 0, max: 100 }, origem: manual }),
  pre({ id: 'tendoes', rotulo: 'Tendões envolvidos', def: { tipo: 'lista', valores: ['SSP', 'ISP', 'SSC', 'TM'] }, origem: { de: 'payload', caminho: `${DX}.tendoes_rm` } }),
  pre({ id: 'tamanho_ap_mm', rotulo: 'Tamanho anteroposterior (sagital)', def: { tipo: 'numero', unidade: 'mm', min: 0, max: 100 }, origem: { de: 'payload', caminho: `${DX}.tamanho_ap_mm_rm` } }),
  pre({ id: 'tamanho_coronal_mm', rotulo: 'Tamanho coronal', def: { tipo: 'numero', unidade: 'mm', min: 0, max: 100 }, origem: manual }),
  pre({ id: 'massiva', rotulo: 'Lesão massiva (definição de Rosenblum: ≥2 tendões ou ≥5 cm)', def: { tipo: 'booleano' }, origem: { de: 'derivada', funcao: 'massivaRosenblum', dependeDe: ['tipo_rotura', 'tendoes', 'tamanho_ap_mm', 'tamanho_coronal_mm'] } }),
  pre({ id: 'patte', rotulo: 'Retração de Patte (registrada; descritiva, sem corte)', def: { tipo: 'numero', min: 1, max: 3, inteiro: true }, origem: { de: 'payload', caminho: `${DX}.retracao_patte_rm` } }),
  pre({ id: 'comprimento_coto_mm', rotulo: 'Comprimento do coto', def: { tipo: 'numero', unidade: 'mm', min: 0, max: 60 }, origem: manual }),
  pre({ id: 'goutallier_ssp', rotulo: 'Goutallier do supraespinal (registrado)', def: { tipo: 'numero', min: 0, max: 4, inteiro: true }, origem: { de: 'payload', caminho: `${DX}.goutallier.SSP` } }),
  pre({ id: 'goutallier_isp', rotulo: 'Goutallier do infraespinal (registrado)', def: { tipo: 'numero', min: 0, max: 4, inteiro: true }, origem: { de: 'payload', caminho: `${DX}.goutallier.ISP` } }),
  pre({ id: 'goutallier_ssc', rotulo: 'Goutallier do subescapular (registrado)', def: { tipo: 'numero', min: 0, max: 4, inteiro: true }, origem: { de: 'payload', caminho: `${DX}.goutallier.SSC` } }),
  pre({ id: 'goutallier_tm', rotulo: 'Goutallier do redondo menor (registrado)', def: { tipo: 'numero', min: 0, max: 4, inteiro: true }, origem: { de: 'payload', caminho: `${DX}.goutallier.TM` } }),
  pre({ id: 'gfdi', rotulo: 'GFDI (média de Goutallier SSP/ISP/SSC)', def: { tipo: 'numero', min: 0, max: 4 }, origem: { de: 'derivada', funcao: 'gfdiGoutallier2003', dependeDe: ['goutallier_ssp', 'goutallier_isp', 'goutallier_ssc'] } }),
  pre({ id: 'modalidade_graduacao', rotulo: 'Modalidade da graduação gordurosa', def: { tipo: 'enum', valores: ['TC', 'RM'] }, origem: manual }),
  pre({ id: 'tangent_sign', rotulo: 'Tangent sign positivo', def: { tipo: 'booleano' }, origem: { de: 'payload', caminho: `${DX}.tangent_sign` } }),
  pre({ id: 'dah_mm', rotulo: 'Distância acromioumeral (valor bruto)', def: { tipo: 'numero', unidade: 'mm', min: 0, max: 30 }, origem: { de: 'payload', caminho: `${DX}.distancia_acromioumeral_mm` } }),
  pre({ id: 'hamada', rotulo: 'Grau de Hamada (registrado pelo cirurgião)', def: { tipo: 'numero', min: 1, max: 5, inteiro: true }, origem: { de: 'payload', caminho: `${DX}.hamada` } }),
  pre({ id: 'artrose_glenoumeral', rotulo: 'Artrose glenoumeral', def: { tipo: 'enum', valores: ['ausente', 'leve', 'moderada', 'grave'] }, origem: manual }),
  pre({ id: 'elevacao_ativa_graus', rotulo: 'Elevação ativa (valor bruto)', def: { tipo: 'numero', unidade: 'graus', min: 0, max: 180 }, origem: { de: 'payload', caminho: `${DX}.elevacao_ativa_graus` } }),
  pre({ id: 'elevacao_passiva_graus', rotulo: 'Elevação passiva (valor bruto)', def: { tipo: 'numero', unidade: 'graus', min: 0, max: 180 }, origem: { de: 'payload', caminho: `${DX}.elevacao_passiva_graus` } }),
  pre({ id: 'pseudoparalisia', rotulo: 'Pseudoparalisia (definição do serviço)', def: { tipo: 'booleano' }, origem: { de: 'payload', caminho: `${DX}.pseudoparalisia` } }),
  pre({ id: 'subescapular_status', rotulo: 'Subescapular', def: { tipo: 'enum', valores: ['integro', 'parcial_reparavel', 'completo_reparavel', 'irreparavel'] }, origem: manual }),
  pre({ id: 'redondo_menor_trofismo', rotulo: 'Trofismo do redondo menor', def: { tipo: 'enum', valores: ['normal', 'atrofico'] }, origem: manual }),
  pre({ id: 'deltoide_funcional', rotulo: 'Deltoide / nervo axilar funcional', def: { tipo: 'booleano' }, origem: { de: 'payload', caminho: `${DX}.deltoide_funcional` } }),
  pre({ id: 'nivel_atividade', rotulo: 'Nível de atividade / demanda', def: { tipo: 'enum', valores: ['sedentario', 'recreativo', 'competitivo', 'trabalhador_bracal'] }, origem: { de: 'payload', caminho: `${COMUM}.nivel_atividade` } }),
  pre({ id: 'tabagismo', rotulo: 'Tabagismo', def: { tipo: 'enum', valores: ['nunca', 'ex_tabagista', 'atual'] }, origem: { de: 'payload', caminho: `${COMUM}.tabagismo` } }),
  pre({ id: 'diabetes', rotulo: 'Diabetes', def: { tipo: 'booleano' }, origem: { de: 'payload', caminho: `${COMUM}.diabetes` } }),
  pre({ id: 'imc', rotulo: 'IMC', def: { tipo: 'numero', unidade: 'kg/m²', min: 10, max: 80 }, origem: manual }),
  pre({ id: 'dmo_baixa', rotulo: 'Densidade mineral óssea baixa', def: { tipo: 'booleano' }, origem: manual }),
  pre({ id: 'csa_graus', rotulo: 'Ângulo crítico do ombro (CSA)', def: { tipo: 'numero', unidade: 'graus', min: 0, max: 90 }, origem: manual }),
  pre({ id: 'conservador_meses', rotulo: 'Tratamento conservador realizado', def: { tipo: 'numero', unidade: 'meses', min: 0, max: 600 }, origem: { de: 'payload', caminho: `${DX}.tratamento_conservador_meses` } }),
  pre({ id: 'falha_conservador', rotulo: 'Falha do tratamento conservador', def: { tipo: 'booleano' }, origem: manual }),
  pre({ id: 'reparo_previo', rotulo: 'Cirurgia prévia do manguito', def: { tipo: 'booleano' }, origem: { de: 'payload', caminho: `${DX}.reparo_previo` } }),
  pre({ id: 'reparabilidade_estimada', rotulo: 'Reparabilidade estimada pelo cirurgião (pré-op)', def: { tipo: 'enum', valores: ['provavel_reparavel', 'provavel_irreparavel'] }, origem: manual }),
];

// ---------------------------------------------------------------------------------------------
// Blocos de condição reutilizados (spec §5)
// ---------------------------------------------------------------------------------------------
const PARCIAL: Cond = { campo: 'tipo_rotura', op: 'in', valores: ['parcial_articular', 'parcial_bursal', 'parcial_intersticial'] };
const COMPLETA: Cond = { campo: 'tipo_rotura', op: '==', valor: 'completa' };
/** N3: Hamada ≥3 (grau registrado) ou artrose GU moderada/grave. */
const ARTROPATIA: Cond = { any: [{ campo: 'hamada', op: '>=', valor: 3 }, { campo: 'artrose_glenoumeral', op: 'in', valores: ['moderada', 'grave'] }] };
const SEM_ARTROPATIA: Cond = { not: ARTROPATIA };
const REPARAVEL: Cond = { campo: 'reparabilidade_estimada', op: '==', valor: 'provavel_reparavel' };
const IRREPARAVEL: Cond = { campo: 'reparabilidade_estimada', op: '==', valor: 'provavel_irreparavel' };
const FALHA: Cond = { campo: 'falha_conservador', op: '==', valor: true };
/** Ellman: >50% da espessura (resumo de Ellman 1990; Duralde define o grau III como >50%). */
const MAIS_METADE: Cond = { any: [{ campo: 'parcial_profundidade_pct', op: '>', valor: 50 }, { campo: 'ellman', op: '==', valor: 3 }] };
const ATE_METADE: Cond = { any: [{ campo: 'parcial_profundidade_pct', op: '<=', valor: 50 }, { campo: 'ellman', op: 'in', valores: [1, 2] }] };
const GOUTALLIER_3: Cond = { any: [{ campo: 'goutallier_ssp', op: '>=', valor: 3 }, { campo: 'goutallier_isp', op: '>=', valor: 3 }] };
const all = (...xs: Cond[]): Cond => ({ all: xs });

const PENDENTE = 'Pendente de decisão do cirurgião.';

export const MANGUITO_ROTADOR: AlgorithmDef = {
  id: 'SH_RCT_DECISAO',
  versao: '0.1.0',
  patologias: ['SH_RCT', 'SH_RCT_PARTIAL', 'SH_RCT_FULL', 'SH_RCT_MASSIVE', 'SH_RCT_SUBSCAP', 'SH_RCT_REVISION'],
  titulo: 'Lesões do manguito rotador (rascunho)',
  escopo: 'Lesão sintomática do manguito rotador confirmada por imagem, avaliação pré-operatória. Rascunho a partir da spec verificada v0.1; não revisado.',
  foraDeEscopo: [
    { id: 'ESC.SEM_LESAO', texto: 'Sem lesão sintomática do manguito confirmada por imagem: fora do escopo deste algoritmo.', quando: { campo: 'lesao_sintomatica_confirmada', op: '==', valor: false } },
  ],
  entradas: ENTRADAS,
  parametros: [
    {
      id: 'dah_lacuna_min_mm', rotulo: 'DAH: limite inferior da faixa sem grau de Hamada', unidade: 'mm', min: 0, max: 30, padrao: 5,
      status: 'pendente_decisao_cirurgiao',
      nota: `Lacuna da definição clássica de Hamada (grau 1 >6 mm, grau 2 ≤5 mm; valores em mm requerem texto completo). Padrão da spec: registrar o valor bruto e marcar "grau indeterminado (5–6 mm)". Só gera aviso; nunca deriva grau. Alternativa: Baek 2026 usou 6 mm como convenção de estudo (Hamada 1 ≥6 mm, Hamada 2 <6 mm). ${PENDENTE}`,
      referencias: [c('Hamada1990', 'Cinco graus radiográficos; mm requerem texto completo'), c('BaekDAH2026', 'Convenção do estudo: ≥6 vs <6 mm')],
    },
    {
      id: 'dah_lacuna_max_mm', rotulo: 'DAH: limite superior da faixa sem grau de Hamada', unidade: 'mm', min: 0, max: 30, padrao: 6,
      status: 'pendente_decisao_cirurgiao',
      nota: `Ver dah_lacuna_min_mm. Faixa inclusiva nos dois limites. ${PENDENTE}`,
      referencias: [c('Hamada1990'), c('BaekDAH2026')],
    },
  ],
  opcoes: [
    { id: 'tratamento_conservador', rotulo: 'Tratamento conservador estruturado (reabilitação / fisioterapia)', naoCirurgica: true },
    { id: 'injecao_prp', rotulo: 'Injeção de PRP (lesão parcial, não cirúrgica)', naoCirurgica: true },
    { id: 'reparo_lesao_parcial', rotulo: 'Reparo da lesão parcial', procedimentosIntraop: ['transtendon_repair', 'takedown_and_repair'] },
    { id: 'reparo_transtendao', rotulo: 'Reparo trans-tendão (parcial articular)', procedimentosIntraop: ['transtendon_repair'] },
    { id: 'completar_e_reparar', rotulo: 'Completar a lesão e reparar', procedimentosIntraop: ['takedown_and_repair'] },
    {
      id: 'reparo_artroscopico', rotulo: 'Reparo artroscópico do manguito',
      procedimentosIntraop: ['single_row', 'double_row', 'transosseous_equivalent_knotless', 'transosseous_equivalent_knotted', 'transosseous_true', 'margin_convergence_plus_repair'],
    },
    { id: 'reparo_fileira_simples', rotulo: 'Reparo em fileira simples', procedimentosIntraop: ['single_row'] },
    { id: 'reparo_dupla_fileira', rotulo: 'Reparo em dupla fileira / transósseo equivalente', procedimentosIntraop: ['double_row', 'transosseous_equivalent_knotless', 'transosseous_equivalent_knotted'] },
    { id: 'augmentation', rotulo: 'Reparo com augmentation (patch, enxerto ou bíceps)', procedimentosIntraop: ['graft_augmentation'] },
    { id: 'reparo_parcial', rotulo: 'Reparo parcial (± tenotomia/tenodese do bíceps)', procedimentosIntraop: ['partial_repair'] },
    { id: 'scr', rotulo: 'Reconstrução capsular superior (SCR)', procedimentosIntraop: ['superior_capsular_reconstruction'] },
    { id: 'ltt', rotulo: 'Transferência do trapézio inferior (LTT)', procedimentosIntraop: ['lower_trapezius_transfer'] },
    { id: 'aldtm', rotulo: 'Transferência anterior do grande dorsal (aLDTM)', procedimentosIntraop: ['latissimus_dorsi_transfer'] },
    { id: 'transferencia_peitoral', rotulo: 'Transferência do peitoral maior', procedimentosIntraop: ['pectoralis_major_transfer'] },
    { id: 'balao', rotulo: 'Balão subacromial', procedimentosIntraop: ['balloon_spacer'] },
    { id: 'desbridamento_tenotomia', rotulo: 'Desbridamento + tenotomia do bíceps', procedimentosIntraop: ['debridement_only'] },
    { id: 'rsa', rotulo: 'Artroplastia reversa do ombro' },
    { id: 'ponte_enxerto', rotulo: 'Ponte / reconstrução do tendão com enxerto (graft bridging, STR)' },
  ],
  regras: [
    // ------------------------------------------------------------------ N2 Lesão parcial
    {
      id: 'N2.1', titulo: 'Lesão parcial: conservador estruturado como primeira linha',
      quando: PARCIAL,
      efeitos: [{ opcao: 'tratamento_conservador', efeito: 'favorece', forca: 'moderada' }],
      motivo: 'Lesão parcial: a literatura favorece tratamento conservador estruturado por ≥6 meses antes de cirurgia (ESSKA, grau B). Consenso Parte I: tentativa inicial de reabilitação na maioria das parciais.',
      referencias: [c('Kany2026', 'Grau B: conservador ≥6 m (moderada)'), c('Hurley2026a', 'Reabilitação inicial na maioria das parciais (fraca, nível V)')],
    },
    {
      id: 'N2.1b', titulo: 'Lesão parcial com menos de 6 meses de conservador',
      quando: all(PARCIAL, { campo: 'conservador_meses', op: '<', valor: 6 }),
      efeitos: [], aviso: true,
      motivo: 'Cautela: conservador registrado de {conservador_meses}; na lesão parcial o consenso ESSKA (grau B) usa ≥6 meses antes de cirurgia.',
      referencias: [c('Kany2026', 'Grau B: conservador ≥6 m')],
    },
    {
      id: 'N2.2', titulo: 'Lesão parcial: injeção de PRP como opção não cirúrgica',
      quando: PARCIAL,
      efeitos: [{ opcao: 'injecao_prp', efeito: 'favorece', forca: 'moderada' }],
      motivo: 'Lesão parcial: ESSKA (grau B) a favor de injeção de PRP como opção não cirúrgica. A concentração plaquetária não mudou a dor (comparação entre doses, não PRP vs placebo).',
      referencias: [c('Kany2026', 'Grau B a favor da injeção de PRP'), c('Lim2026', 'Dose de PRP sem efeito sobre a dor')],
    },
    {
      id: 'N2.3', titulo: 'Parcial >50% da espessura após falha do conservador',
      quando: all(PARCIAL, FALHA, MAIS_METADE),
      efeitos: [{ opcao: 'reparo_lesao_parcial', efeito: 'favorece', forca: 'fraca' }],
      motivo: 'Falha do conservador em lesão parcial com mais da metade da espessura (limiar de Ellman): a literatura favorece considerar reparo. A CPG AAOS 2025 traz item específico para parciais de alto grau, cujo conteúdo e força requerem texto completo.',
      referencias: [c('Ellman1990', '>1/2 da espessura em indivíduo ativo: técnicas de reparo (fraca)'), c('Duralde2012', 'Ellman III = >50% da espessura'), c('Ye2026', 'CPG AAOS 2025: força requer texto completo')],
    },
    {
      id: 'ZC.PARCIAL_ARTICULAR', titulo: 'Zona de técnica: parcial articular, trans-tendão vs completar e reparar',
      quando: all({ campo: 'tipo_rotura', op: '==', valor: 'parcial_articular' }, FALHA, MAIS_METADE),
      efeitos: [
        { opcao: 'reparo_transtendao', efeito: 'desfavorece', forca: 'forte' },
        { opcao: 'completar_e_reparar', efeito: 'desfavorece', forca: 'moderada' },
      ],
      motivo: 'Parcial articular: cautela com rigidez no trans-tendão (ESSKA grau A) e com retear ligeiramente maior ao completar e reparar (ESSKA). Retorno ao esporte semelhante.',
      referencias: [c('Kany2026', 'Grau A: mais rigidez com trans-tendão; completar-e-reparar com retear ligeiramente maior')],
      controversia: {
        nota: 'Zona de técnica: cada técnica tem uma cautela própria na mesma fonte; nenhuma é apontada como superior. Decisão do cirurgião.',
        alternativas: [
          { opcao: 'reparo_transtendao', argumento: 'Preserva as fibras íntegras (série de Ellman III); mais rigidez (ESSKA grau A, forte).', referencias: [c('Duralde2012'), c('Kany2026')] },
          { opcao: 'completar_e_reparar', argumento: 'Menos rigidez; retear ligeiramente maior (ESSKA, moderada).', referencias: [c('Kany2026')] },
        ],
      },
    },
    {
      id: 'N2.4', titulo: 'Parcial ≤50% após falha do conservador',
      quando: all(PARCIAL, FALHA, ATE_METADE),
      efeitos: [], aviso: true,
      motivo: 'Lesão parcial até metade da espessura com falha do conservador: sem limiar verificado para sugerir reparo. Decisão individual do cirurgião.',
      referencias: [c('Ellman1990'), c('Kany2026')],
    },

    // ------------------------------------------------------------------ N3/N4 Artropatia
    {
      id: 'N4.1', titulo: 'Artropatia do manguito: artroplastia reversa',
      quando: all(COMPLETA, ARTROPATIA),
      efeitos: [{ opcao: 'rsa', efeito: 'favorece', forca: 'fraca' }],
      motivo: 'Lesão completa com artropatia (Hamada ≥3 registrado ou artrose GU moderada/grave): a literatura favorece considerar artroplastia reversa (afirmação de RS; nenhum ECR verificado).',
      referencias: [c('Viswanath2021', 'RS de 11 estudos (fraca)'), c('Hamada1990', 'Grau 3 = acetabularização (critério morfológico)')],
    },
    {
      id: 'N4.2', titulo: 'Artropatia: cautela com opções preservadoras',
      quando: all(COMPLETA, ARTROPATIA),
      efeitos: [
        { opcao: 'ltt', efeito: 'desfavorece', forca: 'fraca' },
        { opcao: 'scr', efeito: 'desfavorece', forca: 'moderada' },
      ],
      motivo: 'Cautela com opções preservadoras na artropatia: a transferência pressupõe artrose mínima (consenso); a evidência comparativa da SCR exclui artrose avançada, e Hamada ≥3 prediz falha do enxerto.',
      referencias: [c('Hurley2026b', 'Transferência: artrose mínima (nível V)'), c('Thamrongskulsiri2026', 'SCR vs RSA sem artrose avançada (moderada)'), c('ChangCD2026', 'Hamada ≥3 prediz falha do enxerto (fraca, n=24)')],
    },
    {
      id: 'BALAO.ARTROSE', titulo: 'Balão com artrose ou Hamada ≥3',
      quando: all(COMPLETA, ARTROPATIA),
      efeitos: [{ opcao: 'balao', efeito: 'desfavorece', forca: 'fraca' }],
      motivo: 'Cautela com o balão: artrose moderada a grave / Hamada ≥3 está entre as situações desfavoráveis citadas pelas fontes.',
      referencias: [c('Srikumaran2023', 'Artrose moderada a grave (comentário)'), c('Dasari2022', 'Artrose grave (Hamada ≥3): mau candidato (técnica)')],
    },
    {
      id: 'N4.3', titulo: 'Acetabularização: registrar para planejamento',
      quando: all(COMPLETA, { campo: 'hamada', op: '>=', valor: 3 }),
      efeitos: [], aviso: true,
      motivo: 'Hamada {hamada}: registrar o índice de acetabularização para o planejamento (risco de fratura acromial; sem desfecho clínico verificado).',
      referencias: [c('Shekhbihi2024', 'Índice maior em Hamada/Fukuda IVB (fraca)')],
    },

    // ------------------------------------------------------------------ N5 Completa sem artropatia
    {
      id: 'N5A', titulo: 'Traumática aguda: reparo precoce',
      quando: all(COMPLETA, SEM_ARTROPATIA, { campo: 'inicio', op: '==', valor: 'traumatico_agudo' }),
      efeitos: [{ opcao: 'reparo_artroscopico', efeito: 'favorece', forca: 'fraca' }],
      motivo: `Lesão traumática aguda: a literatura favorece considerar reparo o mais cedo possível (certeza muito baixa). "Precoce" varia de 3 semanas a 6 meses: sem definição padronizada (${PENDENTE}) O maior ganho de Constant na traumática vale só para a coorte ≤45 anos. Em paciente de baixa demanda ou clinicamente inapto, o não cirúrgico permanece adequado (consenso).`,
      referencias: [
        c('Lara2026', 'RS de 3 coortes, certeza muito baixa (fraca)'),
        c('Hurley2026a', 'Traumática ou alta demanda: reparo (nível V)'),
        c('Mariaux2026', 'Só ≤45 anos: Constant +30 traumática vs +21 degenerativa'),
      ],
    },
    {
      id: 'N5A.AGUDO_CRONICO', titulo: 'Aguda sobre crônica',
      quando: all(COMPLETA, SEM_ARTROPATIA, { campo: 'inicio', op: '==', valor: 'agudo_sobre_cronico' }),
      efeitos: [], aviso: true,
      motivo: 'Lesão aguda sobre crônica: as fontes separam esta situação da traumática aguda e da degenerativa; a evidência de reparo precoce vem de traumáticas. Sem sugestão automática.',
      referencias: [c('Lara2026', 'Distinguir traumática, degenerativa e aguda sobre degenerada')],
    },
    {
      id: 'N5B', titulo: 'Degenerativa ou crônica: reabilitação inicial',
      quando: all(COMPLETA, SEM_ARTROPATIA, { campo: 'inicio', op: '==', valor: 'degenerativo' }),
      efeitos: [{ opcao: 'tratamento_conservador', efeito: 'favorece', forca: 'fraca' }],
      motivo: `Lesão completa degenerativa: a literatura favorece tentativa inicial de reabilitação e modificação de atividade. A duração do conservador na lesão completa não tem valor verificado (≥6 m só vale para parciais). ${PENDENTE}`,
      referencias: [c('Hurley2026a', 'Reabilitação inicial nas completas crônicas (nível V)')],
    },
    {
      id: 'N5B.FALHA', titulo: 'Degenerativa com falha do conservador',
      quando: all(COMPLETA, SEM_ARTROPATIA, { campo: 'inicio', op: '==', valor: 'degenerativo' }, FALHA),
      efeitos: [{ opcao: 'reparo_artroscopico', efeito: 'favorece', forca: 'fraca' }],
      motivo: 'Falha do conservador ou dor e disfunção persistentes na lesão degenerativa: a literatura favorece considerar cirurgia.',
      referencias: [c('Hurley2026a', 'Reparo após falha do conservador (nível V)')],
    },
    {
      id: 'N5B.ALERTA', titulo: 'Degenerativa: tempo e dano muscular',
      quando: all(COMPLETA, SEM_ARTROPATIA, { campo: 'inicio', op: '==', valor: 'degenerativo' }),
      efeitos: [], aviso: true,
      motivo: 'Cautela: a duração dos sintomas é fator de risco de retear (moderada); a infiltração gordurosa e a atrofia não regrediram após reparo em coorte prospectiva. As fontes sugerem operar lesões amplas antes do dano muscular irreversível.',
      referencias: [c('Zhao2021', 'Duração dos sintomas: fator de retear'), c('Goutallier1994', 'Operar antes de dano irreversível'), c('Gladstone2007', 'Infiltração não regride após reparo (coorte prospectiva)')],
    },

    // ------------------------------------------------------------------ N6 Reparabilidade (fatores, sem veredito)
    {
      id: 'N6.PARK', titulo: 'Itens do escore de Park presentes',
      quando: all(COMPLETA, SEM_ARTROPATIA, { any: [
        { campo: 'tangent_sign', op: '==', valor: true },
        { campo: 'tamanho_coronal_mm', op: '>=', valor: 26 },
        { campo: 'comprimento_coto_mm', op: '<', valor: 15 },
      ] }),
      efeitos: [], aviso: true,
      motivo: 'Há itens do escore de reparabilidade de Park presentes (tangent sign positivo, coronal ≥26 mm ou coto <15 mm). Os pesos de cada item e a direção do item "Goutallier ISP ≤2" requerem texto completo: o escore não é calculado e não gera veredito. A reparabilidade final é intraoperatória.',
      referencias: [c('Park2020', 'Soma <3: reparo completo provável (esp. 95,9%, sens. 51%); pesos requerem texto completo')],
    },
    {
      id: 'N6.TANGENT', titulo: 'Tangent sign positivo',
      quando: all(COMPLETA, { campo: 'tangent_sign', op: '==', valor: true }),
      efeitos: [], aviso: true,
      motivo: 'Tangent sign positivo: pior ganho cirúrgico (≈22 pontos WORC), equivalente ao não cirúrgico em coorte não randomizada; preditor de reparo incompleto (OR 5,97) em lesões >2 cm. Sinal confiável na RM.',
      referencias: [c('Naimark2019', 'Coorte n=157 (fraca a moderada)'), c('Park2020', 'OR 5,97 para reparo incompleto'), c('Zanetti1998', 'Definição do sinal'), c('Adriani2024', 'Confiabilidade na RM')],
    },
    {
      id: 'N6.GORDURA', titulo: 'Infiltração gordurosa acima do grau 1 ou GFDI ≥0,5',
      quando: all(COMPLETA, { any: [
        { campo: 'goutallier_ssp', op: '>', valor: 1 },
        { campo: 'goutallier_isp', op: '>', valor: 1 },
        { campo: 'goutallier_ssc', op: '>', valor: 1 },
        { campo: 'gfdi', op: '>=', valor: 0.5 },
      ] }),
      efeitos: [], aviso: true,
      motivo: 'Infiltração gordurosa registrada acima do grau 1 (ou GFDI ≥0,5): maior probabilidade de retear após sutura simples; GFDI <0,5 foi necessário para retear <25% (estudo único). Infiltração é fator de risco de retear nas meta-análises. Definições dos graus requerem texto completo; vale o grau registrado.',
      referencias: [c('Goutallier2003', 'n=220: > grau 1 → mais retear; GFDI <0,5 (moderada na direção, fraca no corte)'), c('Zhao2021'), c('Longo2021'), c('McElvany2015')],
    },
    {
      id: 'ZC.GOUTALLIER3', titulo: 'Zona cinzenta: Goutallier ≥3 como "irreparável"',
      quando: all(COMPLETA, SEM_ARTROPATIA, GOUTALLIER_3),
      efeitos: [
        { opcao: 'augmentation', efeito: 'favorece', forca: 'fraca' },
        { opcao: 'reparo_parcial', efeito: 'favorece', forca: 'fraca' },
        { opcao: 'scr', efeito: 'favorece', forca: 'fraca' },
      ],
      motivo: 'Goutallier ≥3 (grau registrado) no supraespinal ou infraespinal: tratar como "irreparável" é convenção de estudo radiológico, contradita por reparos com augmentation em Goutallier 3–4.',
      referencias: [c('Wu2026', 'Goutallier >2 = irreparável: convenção, não desfecho (fraca)'), c('BaekBiceps2026', 'Reparo + SCR de bíceps em Patte 2–3 e Goutallier 3–4 (fraca)')],
      controversia: {
        nota: 'Controverso: não há limiar validado de Goutallier (nem de Patte) para reparabilidade. As alternativas abaixo vêm de populações diferentes.',
        alternativas: [
          { opcao: 'augmentation', argumento: 'Lesões reparáveis com Patte 2–3 e Goutallier 3–4: RCR + SCR de bíceps, ASES 41,2→73,6 (n=58).', referencias: [c('BaekBiceps2026')] },
          { opcao: 'reparo_parcial', argumento: 'Sem pseudoparalisia e Goutallier ≥3: reparo parcial ≈ SCR com fáscia lata (n=40).', referencias: [c('Bayram2026'), c('Wu2026')] },
          { opcao: 'scr', argumento: '≈ reparo parcial (n=40); cautela: Goutallier ≥3 prediz falha do enxerto em SCR/ponte (n=24).', referencias: [c('Bayram2026'), c('ChangCD2026')] },
        ],
      },
    },
    {
      id: 'N6.MODALIDADE', titulo: 'Modalidade da graduação gordurosa',
      quando: { campo: 'modalidade_graduacao', op: 'in', valores: ['TC', 'RM'] },
      efeitos: [], aviso: true,
      motivo: 'Graduação gordurosa por {modalidade_graduacao}: a correlação TC×RM é apenas razoável a moderada; graus de modalidades diferentes não são intercambiáveis. A graduação de Goutallier na RM teve confiabilidade não aceitável; tangent sign é mais confiável.',
      referencias: [c('Fuchs1999', 'Correlação TC×RM razoável a moderada'), c('Adriani2024', 'Goutallier na RM: confiabilidade não aceitável')],
    },

    // ------------------------------------------------------------------ N7 Provavelmente reparável
    {
      id: 'N7.1', titulo: 'Provavelmente reparável: reparo artroscópico',
      quando: all(COMPLETA, SEM_ARTROPATIA, REPARAVEL),
      efeitos: [{ opcao: 'reparo_artroscopico', efeito: 'favorece', forca: 'fraca' }],
      motivo: 'Lesão completa estimada como reparável, sem artropatia: a literatura favorece reparo artroscópico sem tensão com cobertura do footprint; técnica conforme o padrão da lesão.',
      referencias: [c('Hurley2026a', 'Consenso Parte I (nível V)')],
    },
    {
      id: 'ZC.TECNICA_MENOR_3CM', titulo: 'Zona de técnica: fileira simples vs dupla em lesão <3 cm',
      quando: all(COMPLETA, SEM_ARTROPATIA, REPARAVEL, { campo: 'tamanho_ap_mm', op: '<', valor: 30 }),
      efeitos: [
        { opcao: 'reparo_fileira_simples', efeito: 'favorece', forca: 'moderada' },
        { opcao: 'reparo_dupla_fileira', efeito: 'favorece', forca: 'moderada' },
      ],
      motivo: 'Lesão de {tamanho_ap_mm} (<3 cm): fileira simples ≈ dupla em escores clínicos.',
      referencias: [c('Gu2023', 'RS de 10 estudos: <3 cm sem diferença clínica (moderada)')],
      controversia: {
        nota: `Zona de técnica: diferença clínica pequena ou ausente abaixo de 3 cm. ${PENDENTE}`,
        alternativas: [
          { opcao: 'reparo_fileira_simples', argumento: '<3 cm: sem diferença clínica em relação à dupla fileira.', referencias: [c('Gu2023')] },
          { opcao: 'reparo_dupla_fileira', argumento: 'Menos retear no conjunto dos estudos; sem diferença clínica <3 cm.', referencias: [c('Gu2023')] },
        ],
      },
    },
    {
      id: 'ZC.TECNICA_3CM_OU_MAIS', titulo: 'Zona de técnica: fileira simples vs dupla em lesão ≥3 cm',
      quando: all(COMPLETA, SEM_ARTROPATIA, REPARAVEL, { campo: 'tamanho_ap_mm', op: '>=', valor: 30 }),
      efeitos: [{ opcao: 'reparo_dupla_fileira', efeito: 'favorece', forca: 'moderada' }],
      motivo: 'Lesão de {tamanho_ap_mm} (≥3 cm): dupla fileira com menos retear e ASES/UCLA um pouco melhores.',
      referencias: [c('Gu2023', '≥3 cm: ASES/UCLA melhores com dupla fileira (moderada no retear)')],
      controversia: {
        nota: `Controverso: a relevância clínica da diferença é discutida (diferenças pequenas; associação da dupla fileira com retear em outra RS, com confundimento provável). ${PENDENTE}`,
        alternativas: [
          { opcao: 'reparo_dupla_fileira', argumento: '≥3 cm: menos retear e ASES/UCLA um pouco melhores.', referencias: [c('Gu2023')] },
          { opcao: 'reparo_fileira_simples', argumento: 'Diferenças clínicas pequenas; em outra RS a dupla fileira se associou a retear (confundimento provável).', referencias: [c('McElvany2015'), c('Gu2023')] },
        ],
      },
    },
    {
      id: 'N7.3', titulo: 'Aconselhamento sobre risco de retear',
      quando: all(COMPLETA, SEM_ARTROPATIA, REPARAVEL),
      efeitos: [], aviso: true,
      motivo: 'Fatores de risco de retear a conferir: idade (contínua), tamanho, infiltração gordurosa, duração dos sintomas, DMO, diabetes, IMC, CSA e DAH (moderada); déficit de força em abdução no plano da escápula e RE (fraca). Referência: retear médio de 26,6%; 5% nas pequenas/médias vs 40% nas grandes/massivas com dupla fileira (série única).',
      referencias: [c('Zhao2021', 'Fatores de retear (moderada)'), c('Lee2026', 'Déficit de força (fraca)'), c('McElvany2015', 'Retear médio 26,6%'), c('Sugaya2007', '5% vs 40% (fraca)')],
    },
    {
      id: 'N7.FATORES_PRESENTES', titulo: 'Fatores metabólicos de retear presentes',
      quando: all(COMPLETA, { any: [{ campo: 'diabetes', op: '==', valor: true }, { campo: 'dmo_baixa', op: '==', valor: true }] }),
      efeitos: [], aviso: true,
      motivo: 'Diabetes e/ou DMO baixa registrados: fatores de risco de retear na meta-análise.',
      referencias: [c('Zhao2021', 'Moderada')],
    },
    {
      id: 'N7.CSA', titulo: 'CSA >40°',
      quando: all(COMPLETA, { campo: 'csa_graus', op: '>', valor: 40 }),
      efeitos: [], aviso: true,
      motivo: 'CSA de {csa_graus}: >40° associado a mais reoperação em lesões crônicas (n=74).',
      referencias: [c('Alvarez2026', 'Fraca')],
    },
    {
      id: 'N7.MASSIVA', titulo: 'Lesão massiva reparável',
      quando: all(COMPLETA, SEM_ARTROPATIA, REPARAVEL, { campo: 'massiva', op: '==', valor: true }),
      efeitos: [], aviso: true,
      motivo: 'Lesão massiva (≥2 tendões ou ≥5 cm, definição de Rosenblum): retear de 40% nas grandes/massivas com dupla fileira em série única; a melhora funcional nas massivas independe do aumento da DAH.',
      referencias: [c('Rosenblum2024', 'Definição usada'), c('Sugaya2007', 'Fraca'), c('Longo2021', 'Direção (moderada)')],
    },
    {
      id: 'ZC.AUGMENTATION', titulo: 'Zona de técnica: augmentation do reparo',
      quando: all(COMPLETA, SEM_ARTROPATIA, REPARAVEL),
      efeitos: [{ opcao: 'augmentation', efeito: 'favorece', forca: 'fraca' }],
      motivo: 'Augmentation do reparo (opcional): patch melhor ranqueado no curto prazo, sem diferença significativa entre intervenções; sem acordo no consenso.',
      referencias: [c('Jin2024', 'NMA de ECRs: sem diferença significativa (fraca a moderada)'), c('BaekBiceps2026', 'SCR de bíceps em Patte 2–3 + Goutallier 3–4 (fraca)')],
      controversia: {
        nota: `Sem consenso sobre augmentation e patch. ${PENDENTE}`,
        alternativas: [
          { opcao: 'augmentation', argumento: 'Patch melhor ranqueado no curto prazo; SCR de bíceps em lesões com Goutallier 3–4.', referencias: [c('Jin2024'), c('BaekBiceps2026')] },
          { opcao: 'reparo_artroscopico', argumento: 'Sem diferença significativa entre intervenções nos ECRs; consenso sem acordo sobre augmentation.', referencias: [c('Jin2024'), c('Hurley2026b')] },
        ],
      },
    },
    {
      id: 'N7.5', titulo: 'PRP adjuvante ao reparo',
      quando: all(COMPLETA, SEM_ARTROPATIA, REPARAVEL),
      efeitos: [], aviso: true,
      motivo: `Cautela: a interpretação da CPG AAOS 2025 restringe PRP como adjuvante do reparo; a força desse item requer texto completo. Na lesão parcial (não cirúrgica), o ESSKA é favorável à injeção: o conflito depende do contexto. ${PENDENTE}`,
      referencias: [c('Ye2026', 'Restrição a PRP no reparo; força requer texto completo'), c('Kany2026', 'Grau B a favor da injeção na parcial')],
    },
    {
      id: 'N7.6', titulo: 'Reabilitação pós-reparo',
      quando: all(COMPLETA, SEM_ARTROPATIA, REPARAVEL),
      efeitos: [], aviso: true,
      motivo: 'Mobilização precoce ≈ tardia na cicatrização em lesões pequenas e médias ("forte" na CPG, mas estatisticamente frágil: RFI mediano 4); a AAOS 2025 enfatiza a mobilização precoce.',
      referencias: [c('Sudah2024', 'RFI mediano 4'), c('Ye2026')],
    },
    {
      id: 'ZC2.REPARAVEL', titulo: 'ZC2: reparo no paciente mais velho (sem corte etário)',
      quando: all(COMPLETA, SEM_ARTROPATIA, REPARAVEL),
      efeitos: [], aviso: true,
      motivo: 'ZC2 (lesão reparável sem artrose): em populações de ≥70 anos, melhora acima do MCID com retear médio de 21,9%; em ≥75 anos, reoperação ou conversão para RSA de 7,2% (~57 meses); retear de 32% em ≥70 anos, com idade associada a retear. Nenhuma fonte verificada favorece RSA primária em lesão reparável sem artrose. As faixas etárias descrevem as populações; a idade não é usada como corte.',
      referencias: [c('Fossati2021', 'RS de 6 estudos (fraca)'), c('Stone2020', 'n=83 (fraca)'), c('Robinson2013', 'n=62 (fraca)')],
    },

    // ------------------------------------------------------------------ N8 Provavelmente irreparável
    {
      id: 'N8.SSC_IRREPARAVEL', titulo: 'Subescapular irreparável: riscos',
      quando: all(COMPLETA, { campo: 'subescapular_status', op: '==', valor: 'irreparavel' }),
      efeitos: [], aviso: true,
      motivo: 'Subescapular irreparável: maior frequência de pseudoparalisia (80% com SSP + SSC completo) e pior resposta à fisioterapia (lesão completa do SSC é o pior preditor).',
      referencias: [c('Collin2014', 'Coorte n=100 (fraca a moderada)'), c('OConaire2023', 'Revisão narrativa (fraca)')],
    },
    {
      id: 'BALAO.SSC', titulo: 'Balão com subescapular irreparável',
      quando: all(COMPLETA, { campo: 'subescapular_status', op: '==', valor: 'irreparavel' }),
      efeitos: [{ opcao: 'balao', efeito: 'desfavorece', forca: 'fraca' }],
      motivo: 'Cautela com o balão: subescapular irreparável é situação desfavorável citada pelas fontes; o ECR favorável ao balão incluiu só SSC íntegro.',
      referencias: [c('Srikumaran2023'), c('Dasari2022'), c('Verma2022', 'População com SSC íntegro')],
    },
    {
      id: 'ZC.SSC_IRREPARAVEL', titulo: 'Zona cinzenta: subescapular irreparável',
      quando: all(COMPLETA, SEM_ARTROPATIA, { campo: 'subescapular_status', op: '==', valor: 'irreparavel' }),
      efeitos: [{ opcao: 'aldtm', efeito: 'favorece', forca: 'fraca' }],
      motivo: 'Subescapular isolado ou anterossuperior irreparável: a aLDTM é uma opção descrita, com lesão da JMT do redondo maior em 23,4% associada a tensão excessiva e ângulo de curvatura baixo.',
      referencias: [c('BaekALDTM2026', 'Série (fraca)')],
      controversia: {
        nota: 'Controverso: peitoral maior sem consenso; artroplastia reversa segue a ZC1. Nenhuma opção tem evidência superior.',
        alternativas: [
          { opcao: 'aldtm', argumento: 'Opção descrita; lesão da JMT do redondo maior em 23,4%.', referencias: [c('BaekALDTM2026')] },
          { opcao: 'transferencia_peitoral', argumento: 'Sem consenso no painel.', referencias: [c('Hurley2026b')] },
          { opcao: 'rsa', argumento: 'Confiável em pacientes mais velhos sem artrose (RS); ver ZC1.', referencias: [c('Viswanath2021')] },
        ],
      },
    },
    {
      id: 'ZC.SSC_REPARAVEL_LTT', titulo: 'Zona cinzenta: LTT com subescapular reparável',
      quando: all(COMPLETA, SEM_ARTROPATIA, IRREPARAVEL, { campo: 'subescapular_status', op: 'in', valores: ['parcial_reparavel', 'completo_reparavel'] }),
      efeitos: [{ opcao: 'ltt', efeito: 'favorece', forca: 'fraca' }],
      motivo: 'Subescapular reparável: reparar junto. Com LTT, PROMs semelhantes e menor ganho de RI.',
      referencias: [c('BaekSSC2026', 'n=75 (fraca)')],
      controversia: {
        nota: 'Controverso: estudos de LTT divergem quanto ao papel do subescapular.',
        alternativas: [
          { opcao: 'ltt', argumento: 'LTT com SSC reparável: PROMs semelhantes, menor ganho de RI (n=75).', referencias: [c('BaekSSC2026')] },
          { opcao: 'ltt', argumento: 'Infiltração gordurosa do SSC (OR 2,751) e rerruptura do tendão transferido predizem não atingir PASS após LTT (n=44).', referencias: [c('ChangHH2026')] },
        ],
      },
    },
    {
      id: 'PSEUDO.DEFINICAO', titulo: 'Pseudoparalisia: definição do serviço',
      quando: { campo: 'pseudoparalisia', op: '==', valor: true },
      efeitos: [], aviso: true,
      motivo: `Pseudoparalisia registrada: a definição operacional (limiar de elevação ativa vs passiva) não é padronizada e requer texto completo da fonte fundacional; registrar a definição usada e os graus brutos de elevação ativa e passiva. ${PENDENTE}`,
      referencias: [c('Collin2014', 'Definição operacional requer texto completo')],
    },
    {
      id: 'BALAO.PSEUDO', titulo: 'Balão com pseudoparalisia',
      quando: all(COMPLETA, { campo: 'pseudoparalisia', op: '==', valor: true }),
      efeitos: [{ opcao: 'balao', efeito: 'desfavorece', forca: 'fraca' }],
      motivo: 'Cautela com o balão: pseudoparalisia é situação desfavorável citada pela fonte técnica.',
      referencias: [c('Dasari2022', 'Mau candidato: pseudoparalisia (técnica, fraca)')],
    },
    {
      id: 'BALAO.AXILAR', titulo: 'Balão com déficit do deltoide / axilar',
      quando: all(COMPLETA, { campo: 'deltoide_funcional', op: '==', valor: false }),
      efeitos: [{ opcao: 'balao', efeito: 'desfavorece', forca: 'fraca' }],
      motivo: 'Cautela com o balão: paralisia axilar é situação desfavorável citada pelas fontes.',
      referencias: [c('Srikumaran2023'), c('Dasari2022')],
    },
    {
      id: 'LTT.DELTOIDE', titulo: 'Transferência com déficit do deltoide',
      quando: all(COMPLETA, { campo: 'deltoide_funcional', op: '==', valor: false }),
      efeitos: [{ opcao: 'ltt', efeito: 'desfavorece', forca: 'fraca' }],
      motivo: 'Cautela com transferência tendínea: o consenso pressupõe deltoide íntegro.',
      referencias: [c('Hurley2026b', 'Nível V')],
    },
    {
      id: 'LTT.REDONDO_MENOR', titulo: 'LTT com redondo menor atrófico',
      quando: all(COMPLETA, IRREPARAVEL, { campo: 'redondo_menor_trofismo', op: '==', valor: 'atrofico' }),
      efeitos: [{ opcao: 'ltt', efeito: 'desfavorece', forca: 'fraca' }],
      motivo: 'Cautela com LTT: o trofismo do redondo menor predisse PASS aos 5 anos; aqui está atrófico.',
      referencias: [c('BaekLTT5a2026', 'n=34 (fraca)')],
    },
    {
      id: 'LTT.TABAGISMO', titulo: 'LTT em tabagista atual',
      quando: all(COMPLETA, IRREPARAVEL, { campo: 'tabagismo', op: '==', valor: 'atual' }),
      efeitos: [{ opcao: 'ltt', efeito: 'desfavorece', forca: 'fraca' }],
      motivo: 'Cautela com LTT: tabagismo associado a não atingir PASS após LTT.',
      referencias: [c('ChangHH2026', 'n=44 (fraca)')],
    },
    {
      id: 'SCR.GOUTALLIER3', titulo: 'SCR com Goutallier ≥3',
      quando: all(COMPLETA, IRREPARAVEL, GOUTALLIER_3),
      efeitos: [{ opcao: 'scr', efeito: 'desfavorece', forca: 'fraca' }],
      motivo: 'Cautela com SCR: Goutallier ≥3 (grau registrado) predisse falha do enxerto em SCR/ponte com derme alogênica (62,5% cicatrizados; n=24).',
      referencias: [c('ChangCD2026', 'Fraca')],
    },
    {
      id: 'ZC1-P', titulo: 'ZC1-P: massiva irreparável com pseudoparalisia, sem artrose',
      quando: all(COMPLETA, SEM_ARTROPATIA, IRREPARAVEL, { campo: 'pseudoparalisia', op: '==', valor: true }),
      efeitos: [
        { opcao: 'rsa', efeito: 'favorece', forca: 'fraca' },
        { opcao: 'scr', efeito: 'favorece', forca: 'fraca' },
      ],
      motivo: 'Irreparável com pseudoparalisia e sem artropatia: RSA e SCR com evidência fraca e semelhante; transferência só com ADM passiva preservada.',
      referencias: [c('Viswanath2021'), c('Takayama2025')],
      controversia: {
        nota: 'Zona cinzenta: todas as opções têm evidência fraca. O software não escolhe.',
        alternativas: [
          { opcao: 'rsa', argumento: 'Confiável em mais velhos (RS); recuperação mais rápida da elevação (~3 vs ~5 meses).', referencias: [c('Viswanath2021'), c('Takayama2025')] },
          { opcao: 'scr', argumento: '≈ RSA aos 2 anos em pseudoparalisia sem artrose (Hamada ≤3), com reabilitação mais longa; pior se SSC irreparável.', referencias: [c('Takayama2025')] },
          { opcao: 'ltt', argumento: 'Só com ADM passiva preservada (critério de consenso, não de pseudoparalisia).', referencias: [c('Hurley2026b')] },
        ],
      },
    },
    {
      id: 'ZC1', titulo: 'ZC1: massiva irreparável sem artrose e sem pseudoparalisia',
      quando: all(COMPLETA, SEM_ARTROPATIA, IRREPARAVEL, { campo: 'pseudoparalisia', op: '==', valor: false }),
      efeitos: [
        { opcao: 'reparo_parcial', efeito: 'favorece', forca: 'fraca' },
        { opcao: 'scr', efeito: 'favorece', forca: 'fraca' },
        { opcao: 'ltt', efeito: 'favorece', forca: 'fraca' },
        { opcao: 'balao', efeito: 'favorece', forca: 'fraca' },
        { opcao: 'desbridamento_tenotomia', efeito: 'favorece', forca: 'fraca' },
        { opcao: 'rsa', efeito: 'favorece', forca: 'fraca' },
        { opcao: 'ponte_enxerto', efeito: 'favorece', forca: 'fraca' },
        { opcao: 'tratamento_conservador', efeito: 'favorece', forca: 'fraca' },
      ],
      motivo: 'Irreparável sem artropatia e sem pseudoparalisia: zona cinzenta; as opções têm evidência de força semelhante ou comparadores diferentes. NMAs globais: sem diferença significativa entre intervenções em ECRs; ranking com LDT + reparo parcial no topo (heterogêneo).',
      referencias: [c('Jin2024', 'NMA de ECRs'), c('Zhou2023', 'Ranking SUCRA (fraca)')],
      controversia: {
        nota: `Zona cinzenta ZC1: o software não escolhe. Considerar SSC, redondo menor, demanda, idade (contínua) e disposição para reabilitação longa. ${PENDENTE}`,
        alternativas: [
          { opcao: 'reparo_parcial', argumento: '≈ SCR com fáscia lata sem pseudoparalisia e Goutallier ≥3 (n=40, fraca); ≈ balão em ECR, MCID 81% vs 83% (forte).', referencias: [c('Bayram2026'), c('Verma2022')] },
          { opcao: 'scr', argumento: 'Cicatrização 76,1%, revisão para RSA 7,1%; ≈ RSA em PROMs com menos complicações (3,5% vs 10,8%); em ≥65 anos, SCR > RSA em ASES/Constant/flexão com falha de cicatrização de 27,3%. Melhor cenário: SSP isolado. Enxerto de 6–8 mm (Mihata). Sem consenso sobre enxerto.', referencias: [c('Werthel2021'), c('Thamrongskulsiri2026'), c('Kim2025'), c('Mihata2013'), c('Eichinger2026'), c('Hurley2026b')] },
          { opcao: 'ltt', argumento: 'Melhora de ADM e PROMs (RS de 15 estudos); cicatrização do enxerto 89,4% (MA); resultado mantido aos 5 anos; Hamada 1 ≈ 2. Consenso: jovem, ativo, ADM passiva preservada, artrose mínima, deltoide íntegro; preferida ao grande dorsal. Augmentation com bíceps não ajuda. Uso ainda debatido.', referencias: [c('Lauck2025'), c('BaekMA2026'), c('BaekLTT5a2026'), c('BaekDAH2026'), c('Hurley2026b'), c('BaekLTTBiceps2026'), c('Rashid2026')] },
          { opcao: 'balao', argumento: 'ECR: pior que desbridamento + tenotomia (Oxford 12 m, p=0,037; aos 24 m p=0,08); ECR: ≈ reparo parcial com SSC íntegro. Conjunto controverso; não é rotina.', referencias: [c('Metcalfe2022'), c('Haque2025'), c('Verma2022'), c('Albishi2026')] },
          { opcao: 'desbridamento_tenotomia', argumento: 'Comparador superior ao balão no ECR (forte vs balão); sem dado verificado de ganho absoluto.', referencias: [c('Metcalfe2022'), c('Haque2025')] },
          { opcao: 'rsa', argumento: '≈ SCR em PROMs com mais complicações; menor ganho de flexão em <70 anos (NMA); confiável em mais velhos, cautela em jovens e com elevação ativa preservada; melhor força de abdução que SCR (67% vs 52%).', referencias: [c('Thamrongskulsiri2026'), c('Bi2024'), c('Viswanath2021'), c('Takayama2026')] },
          { opcao: 'ponte_enxerto', argumento: 'Em <70 anos, ponte com enxerto entre as melhores em ASES e Constant (NMA); técnicas heterogêneas.', referencias: [c('Bi2024'), c('Gou2026')] },
          { opcao: 'tratamento_conservador', argumento: 'Fisioterapia com sucesso de 32–96%; lesão completa do SSC é o pior preditor.', referencias: [c('OConaire2023')] },
        ],
      },
    },
    {
      id: 'ZC2.IRREPARAVEL', titulo: 'ZC2: SCR/preservação vs RSA no paciente mais velho (sem corte etário)',
      quando: all(COMPLETA, SEM_ARTROPATIA, IRREPARAVEL),
      efeitos: [
        { opcao: 'scr', efeito: 'favorece', forca: 'fraca' },
        { opcao: 'rsa', efeito: 'favorece', forca: 'fraca' },
      ],
      motivo: 'Irreparável sem artropatia: SCR/preservação vs RSA. As faixas etárias das fontes (≥65, <70) descrevem populações; a idade é contínua e não é usada como corte.',
      referencias: [c('Kim2025'), c('Takayama2026'), c('Thamrongskulsiri2026'), c('Viswanath2021')],
      controversia: {
        nota: `Zona cinzenta ZC2: o software não escolhe. ${PENDENTE}`,
        alternativas: [
          { opcao: 'scr', argumento: 'População ≥65 anos sem artrose: SCR > RSA em ASES, Constant e flexão; falha de cicatrização da SCR 27,3%. SCR ≈ RSA com menos complicações.', referencias: [c('Kim2025'), c('Thamrongskulsiri2026')] },
          { opcao: 'rsa', argumento: 'Força de abdução melhor (67% vs 52%), com ADM melhor na SCR; RSA confiável em mais velhos.', referencias: [c('Takayama2026'), c('Viswanath2021')] },
        ],
      },
    },
    {
      id: 'ZC2.REVISAO', titulo: 'Reparo prévio falho',
      quando: all(COMPLETA, { campo: 'reparo_previo', op: '==', valor: true }),
      efeitos: [], aviso: true,
      motivo: 'Cirurgia prévia do manguito: RSA após reparo falho com Constant 29→61 e complicações de 12%; resultado pior em mais jovens, sem artrose ou com infraespinal lesado.',
      referencias: [c('Flurin2026', 'n=117 (fraca)')],
    },
    {
      id: 'DAH.LACUNA', titulo: 'DAH na faixa sem grau de Hamada',
      quando: all({ campo: 'dah_mm', op: '>=', param: 'dah_lacuna_min_mm' }, { campo: 'dah_mm', op: '<=', param: 'dah_lacuna_max_mm' }),
      efeitos: [], aviso: true,
      motivo: `DAH de {dah_mm}: faixa sem grau na definição original de Hamada (valores em mm requerem texto completo). Grau indeterminado pela medida; vale o grau registrado pelo cirurgião e a presença de acetabularização. ${PENDENTE}`,
      referencias: [c('Hamada1990'), c('BaekDAH2026', 'Convenção de estudo ≥6 vs <6 mm; LTT semelhante')],
    },
  ],
  referencias: REFERENCIAS,
  avisosGerais: [
    'Sugestão baseada em literatura; não substitui o julgamento clínico. A reparabilidade é confirmada no intraoperatório.',
    'Rascunho: algoritmo gerado da spec verificada v0.1 e ainda não revisado pelo cirurgião.',
    'Idade é contínua: nenhuma sugestão usa corte etário; faixas citadas descrevem as populações dos estudos.',
    'Itens marcados "requer texto completo" (mm de Hamada, definições de Goutallier/Patte/Thomazeau/Fuchs, pesos do escore de Park, força dos itens da CPG AAOS 2025, definição de pseudoparalisia) não geram sugestão automática.',
  ],
  referenciasGerais: [c('Hurley2026a'), c('Hurley2026b')],
};

// ---------------------------------------------------------------------------------------------
// Mapeamento payload/pré-op → entrada do motor
// ---------------------------------------------------------------------------------------------
export interface ProvenienciaCampo {
  origem: Proveniencia;
  /** Caminho no payload, campo do paciente ou função derivada. */
  caminho?: string;
  nota?: string;
}

export interface EntradaMapeada {
  entrada: Record<string, unknown>;
  proveniencia: Record<string, ProvenienciaCampo>;
}

export interface OpcoesMapeamentoManguito {
  /** Código da patologia (qualquer código do grupo SH_RCT usa o mesmo schema de diagnóstico). */
  codigo?: string;
  paciente?: { idade?: number | null };
  /** Entradas informadas manualmente. Só preenchem campos que o payload não trouxe. */
  manual?: Record<string, unknown>;
}

function presente(v: unknown): boolean {
  return v !== undefined && v !== null && !(typeof v === 'string' && v.trim() === '');
}

/** Rosenblum: ≥2 tendões ou ≥5 cm. Lógica de três valores: indeterminado → ausente. */
function massivaRosenblum(e: Record<string, unknown>): boolean | undefined {
  const tipo = e.tipo_rotura;
  if (!presente(tipo)) return undefined;
  if (tipo !== 'completa') return false;
  const crit: (boolean | undefined)[] = [
    Array.isArray(e.tendoes) ? e.tendoes.length >= 2 : undefined,
    typeof e.tamanho_ap_mm === 'number' ? e.tamanho_ap_mm >= 50 : undefined,
    typeof e.tamanho_coronal_mm === 'number' ? e.tamanho_coronal_mm >= 50 : undefined,
  ];
  if (crit.some((x) => x === true)) return true;
  if (crit.every((x) => x === false)) return false;
  return undefined;
}

/** GFDI (Goutallier 2003) = média de SSP, ISP e SSC; só com os três presentes. */
function gfdiGoutallier2003(e: Record<string, unknown>): number | undefined {
  const xs = [e.goutallier_ssp, e.goutallier_isp, e.goutallier_ssc];
  if (!xs.every((x) => typeof x === 'number')) return undefined;
  return Math.round(((xs as number[]).reduce((a, b) => a + b, 0) / 3) * 100) / 100;
}

/**
 * Monta a entrada do algoritmo a partir do payload v2 (`avaliacaoPreop`), da idade do paciente e de
 * entradas manuais. Campo ausente fica ausente (nunca 0/false). Cada campo preenchido registra a proveniência.
 */
export function mapearEntradaManguito(
  payload: Pick<ClinicalPayload, 'avaliacaoPreop'>,
  opts: OpcoesMapeamentoManguito = {},
): EntradaMapeada {
  const entrada: Record<string, unknown> = {};
  const proveniencia: Record<string, ProvenienciaCampo> = {};
  const dx = preopFor(payload, opts.codigo ?? 'SH_RCT')?.dados ?? {};
  const comum = payload.avaliacaoPreop?.comum ?? {};

  const ler = (caminho: string): unknown => {
    const [base, rel] = caminho.startsWith(`${DX}.`) ? [dx, caminho.slice(DX.length + 1)] : [comum, caminho.slice(COMUM.length + 1)];
    let v: unknown = base;
    for (const k of rel.split('.')) v = v !== null && typeof v === 'object' ? (v as Record<string, unknown>)[k] : undefined;
    return v;
  };

  for (const e of MANGUITO_ROTADOR.entradas) {
    if (e.origem.de === 'payload') {
      const v = ler(e.origem.caminho);
      if (presente(v)) {
        entrada[e.id] = v;
        proveniencia[e.id] = { origem: 'payload', caminho: e.origem.caminho };
      }
    } else if (e.origem.de === 'paciente' && e.origem.campo === 'idade' && presente(opts.paciente?.idade)) {
      entrada[e.id] = opts.paciente!.idade;
      proveniencia[e.id] = { origem: 'paciente', caminho: 'idade' };
    }
  }
  for (const [k, v] of Object.entries(opts.manual ?? {})) {
    if (!presente(v) || k in entrada) continue;
    entrada[k] = v;
    proveniencia[k] = { origem: 'manual' };
  }
  if (!('gfdi' in entrada)) {
    const g = gfdiGoutallier2003(entrada);
    if (g !== undefined) {
      entrada.gfdi = g;
      proveniencia.gfdi = { origem: 'derivada', caminho: 'gfdiGoutallier2003', nota: 'Média de Goutallier SSP/ISP/SSC (Goutallier 2003).' };
    }
  }
  if (!('massiva' in entrada)) {
    const m = massivaRosenblum(entrada);
    if (m !== undefined) {
      entrada.massiva = m;
      proveniencia.massiva = { origem: 'derivada', caminho: 'massivaRosenblum', nota: 'Definição de Rosenblum: ≥2 tendões com lesão completa ou ≥5 cm; lesão parcial = não massiva.' };
    }
  }
  return { entrada, proveniencia };
}
