/**
 * Tipos de caso (cards da etapa "Tipo do Caso" do registro de procedimento).
 * Cada tipo agrupa patologias do catálogo; um procedimento é registrado para UMA patologia.
 * Patologias com schema intraoperatório usam formulário estruturado; as demais, descrição livre.
 */
import { PATHOLOGIES, PATHOLOGY_BY_CODE, Region } from './pathologies';

export interface CaseType {
  /** Chave estável gravada em surgeries.tipos_procedimento */
  key: string;
  region: Region;
  label: string;
  desc: string;
  /** Patologias do catálogo cobertas por este tipo (a primeira é o padrão) */
  codes: string[];
  /** Tipo sem patologia de catálogo (ex.: ortobiológicos): sempre descrição livre */
  freeOnly?: boolean;
}

export const CASE_TYPES: CaseType[] = [
  // ---------- OMBRO ----------
  { key: 'SH_CUFF', region: 'shoulder', label: 'Manguito Rotador', desc: 'Reparo, desbridamento, transferências, reconstrução capsular superior', codes: ['SH_RCT', 'SH_RCT_TENDINOPATHY', 'SH_RCT_PARTIAL', 'SH_RCT_FULL', 'SH_RCT_MASSIVE', 'SH_RCT_SUBSCAP', 'SH_RCT_REVISION'] },
  { key: 'SH_INSTABILITY', region: 'shoulder', label: 'Instabilidade', desc: 'Bankart, Latarjet, remplissage, bloqueio ósseo', codes: ['SH_INST_ANT', 'SH_INST_POST', 'SH_INST_MDI'] },
  { key: 'SH_BICEPS_SLAP', region: 'shoulder', label: 'Bíceps e SLAP', desc: 'Tenotomia, tenodese, reparo de SLAP', codes: ['SH_BICEPS', 'SH_SLAP'] },
  { key: 'SH_AC', region: 'shoulder', label: 'Acromioclavicular', desc: 'Luxação AC, ressecção da clavícula distal', codes: ['SH_AC_DISL', 'SH_AC_OA'] },
  { key: 'SH_ARTHROPLASTY', region: 'shoulder', label: 'Artroplastia', desc: 'Anatômica, reversa, hemiartroplastia, revisão', codes: ['SH_ARTHROPLASTY', 'SH_OA_GH', 'SH_CTA'] },
  { key: 'SH_FRACTURE', region: 'shoulder', label: 'Fraturas', desc: 'Úmero proximal, clavícula, escápula e glenoide', codes: ['SH_FX_PROX_HUM', 'SH_FX_CLAV', 'SH_FX_SCAP'] },
  { key: 'SH_STIFF', region: 'shoulder', label: 'Rigidez e Capsulite', desc: 'Liberação capsular, manipulação sob anestesia', codes: ['SH_STIFF'] },
  { key: 'SH_CALC', region: 'shoulder', label: 'Tendinite Calcária', desc: 'Remoção de calcificação, barbotagem', codes: ['SH_CALC'] },
  { key: 'SH_OTHER_TENDON', region: 'shoulder', label: 'Outras Lesões', desc: 'Peitoral maior, nervo supraescapular, esternoclavicular', codes: ['SH_PEC_MAJOR', 'SH_SS_NEURO', 'SH_SC_JOINT', 'SH_SCAP_DYSK'] },
  // ---------- COTOVELO ----------
  { key: 'EL_DISTAL_BICEPS', region: 'elbow', label: 'Bíceps Distal', desc: 'Reinserção por via única ou dupla, reconstrução com enxerto', codes: ['EL_DBR'] },
  { key: 'EL_EPICONDYLITIS', region: 'elbow', label: 'Epicondilites', desc: 'Epicondilite lateral e medial', codes: ['EL_LAT_EPI', 'EL_MED_EPI'] },
  { key: 'EL_INSTABILITY', region: 'elbow', label: 'Instabilidade', desc: 'Ligamento colateral ulnar, rotatória posterolateral, luxação', codes: ['EL_UCL', 'EL_PLRI', 'EL_DISL'] },
  { key: 'EL_STIFF_OA', region: 'elbow', label: 'Rigidez e Artrose', desc: 'Artrólise, desbridamento, osteocondrite', codes: ['EL_STIFF', 'EL_OA', 'EL_OCD'] },
  { key: 'EL_FRACTURE', region: 'elbow', label: 'Fraturas', desc: 'Cabeça do rádio, olécrano, úmero distal, coronoide, tríade terrível', codes: ['EL_FX_RH', 'EL_FX_OLEC', 'EL_FX_DH', 'EL_FX_COR', 'EL_TERRIBLE_TRIAD', 'EL_MONTEGGIA'] },
  { key: 'EL_NERVE_TENDON', region: 'elbow', label: 'Nervo Ulnar e Tríceps', desc: 'Neuropatia ulnar, rotura do tríceps, bursite', codes: ['EL_CUBITAL', 'EL_TRICEPS', 'EL_BURSITIS'] },
  // ---------- AMBAS ----------
  { key: 'SH_ORTHOBIO', region: 'shoulder', label: 'Ortobiológicos', desc: 'PRP, aspirado de medula, enxertos biológicos', codes: [], freeOnly: true },
  { key: 'EL_ORTHOBIO', region: 'elbow', label: 'Ortobiológicos', desc: 'PRP, aspirado de medula, enxertos biológicos', codes: [], freeOnly: true },
  { key: 'SH_OTHER', region: 'shoulder', label: 'Outros Procedimentos', desc: 'Bloqueio, infiltração guiada, desbridamento', codes: [], freeOnly: true },
  { key: 'EL_OTHER', region: 'elbow', label: 'Outros Procedimentos', desc: 'Bloqueio, infiltração guiada, desbridamento', codes: [], freeOnly: true }
];

export const CASE_TYPE_BY_KEY: ReadonlyMap<string, CaseType> = new Map(CASE_TYPES.map((c) => [c.key, c]));

export function caseTypesFor(region: Region): CaseType[] {
  return CASE_TYPES.filter((c) => c.region === region);
}

/** Patologias selecionáveis como diagnóstico na região (raízes e subtipos, na ordem do catálogo). */
export function diagnosesFor(region: Region) {
  return PATHOLOGIES.filter((p) => p.region === region);
}

/** Schema intraoperatório da patologia, ou null quando o registro é por descrição livre. */
export function intraopSchemaId(code: string): string | null {
  return PATHOLOGY_BY_CODE.get(code)?.intraop ?? null;
}

/** Schema da avaliação pré-operatória da patologia (payload `avaliacaoPreop`), ou null quando não há. */
export function diagnosisSchemaId(code: string): string | null {
  return PATHOLOGY_BY_CODE.get(code)?.diagnosis ?? null;
}
