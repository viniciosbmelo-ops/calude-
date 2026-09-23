/**
 * Catálogo de patologias DocSholder v1 (seção 4 da especificação).
 * Fonte única para: seed SQL, dxlist do relatório, árvore de seleção na UI.
 * `intraop` = id do schema de registro intraoperatório quando já implementado.
 */
export type Region = 'shoulder' | 'elbow';

export interface PathologyDef {
  code: string;
  region: Region;
  name_pt: string;
  parent?: string;
  intraop?: string;
  diagnosis?: string;
  report_template?: string;
  proms_default?: string[];
  default_protocol_code?: string;
}

export const PATHOLOGIES: PathologyDef[] = [
  // ---------- OMBRO ----------
  { code: 'SH_RCT', region: 'shoulder', name_pt: 'Lesão do manguito rotador', intraop: 'SH_RCT.intraop.v1', report_template: 'SH_RCT.v1', proms_default: ['ASES', 'SANE', 'CONSTANT'], default_protocol_code: 'PROT_RCR_STANDARD' },
  { code: 'SH_RCT_TENDINOPATHY', region: 'shoulder', name_pt: 'Tendinopatia do manguito rotador', parent: 'SH_RCT', intraop: 'SH_RCT.intraop.v1', report_template: 'SH_RCT.v1' },
  { code: 'SH_RCT_PARTIAL', region: 'shoulder', name_pt: 'Rotura parcial do manguito rotador', parent: 'SH_RCT', intraop: 'SH_RCT.intraop.v1', report_template: 'SH_RCT.v1' },
  { code: 'SH_RCT_FULL', region: 'shoulder', name_pt: 'Rotura completa do manguito rotador', parent: 'SH_RCT', intraop: 'SH_RCT.intraop.v1', report_template: 'SH_RCT.v1' },
  { code: 'SH_RCT_MASSIVE', region: 'shoulder', name_pt: 'Rotura maciça do manguito rotador', parent: 'SH_RCT', intraop: 'SH_RCT.intraop.v1', report_template: 'SH_RCT.v1', default_protocol_code: 'PROT_RCR_MASSIVE' },
  { code: 'SH_RCT_SUBSCAP', region: 'shoulder', name_pt: 'Lesão do subescapular', parent: 'SH_RCT', intraop: 'SH_RCT.intraop.v1', report_template: 'SH_RCT.v1' },
  { code: 'SH_RCT_REVISION', region: 'shoulder', name_pt: 'Re-rotura do manguito rotador (revisão)', parent: 'SH_RCT', intraop: 'SH_RCT.intraop.v1', report_template: 'SH_RCT.v1' },
  { code: 'SH_INST_ANT', region: 'shoulder', name_pt: 'Instabilidade glenoumeral anterior', diagnosis: 'SH_INST_ANT.diagnosis.v1', intraop: 'SH_INST_ANT.intraop.v1', report_template: 'SH_INST_ANT.v1', proms_default: ['SANE', 'ROWE'], default_protocol_code: 'PROT_BANKART' },
  { code: 'SH_INST_POST', region: 'shoulder', name_pt: 'Instabilidade glenoumeral posterior' },
  { code: 'SH_INST_MDI', region: 'shoulder', name_pt: 'Instabilidade multidirecional do ombro' },
  { code: 'SH_BICEPS', region: 'shoulder', name_pt: 'Lesão do cabo longo do bíceps', intraop: 'SH_BICEPS.intraop.v1', report_template: 'SH_BICEPS.v1', proms_default: ['ASES', 'SANE'], default_protocol_code: 'PROT_BICEPS_TENODESIS' },
  { code: 'SH_SLAP', region: 'shoulder', name_pt: 'Lesão SLAP', parent: 'SH_BICEPS', intraop: 'SH_BICEPS.intraop.v1', report_template: 'SH_BICEPS.v1', default_protocol_code: 'PROT_SLAP_REPAIR' },
  { code: 'SH_AC_DISL', region: 'shoulder', name_pt: 'Luxação acromioclavicular', intraop: 'SH_AC_DISL.intraop.v1', report_template: 'SH_AC_DISL.v1', proms_default: ['ASES', 'SANE'], default_protocol_code: 'PROT_AC_RECON' },
  { code: 'SH_AC_OA', region: 'shoulder', name_pt: 'Artrose acromioclavicular', intraop: 'SH_AC_DISL.intraop.v1', report_template: 'SH_AC_DISL.v1', default_protocol_code: 'PROT_DCE' },
  { code: 'SH_STIFF', region: 'shoulder', name_pt: 'Capsulite adesiva / rigidez do ombro' },
  { code: 'SH_CALC', region: 'shoulder', name_pt: 'Tendinite calcária do manguito rotador' },
  { code: 'SH_OA_GH', region: 'shoulder', name_pt: 'Artrose glenoumeral', intraop: 'SH_ARTHROPLASTY.intraop.v1', report_template: 'SH_ARTHROPLASTY.v1' },
  { code: 'SH_CTA', region: 'shoulder', name_pt: 'Artropatia do manguito rotador', intraop: 'SH_ARTHROPLASTY.intraop.v1', report_template: 'SH_ARTHROPLASTY.v1' },
  { code: 'SH_ARTHROPLASTY', region: 'shoulder', name_pt: 'Artroplastia do ombro', intraop: 'SH_ARTHROPLASTY.intraop.v1', report_template: 'SH_ARTHROPLASTY.v1', proms_default: ['ASES', 'SANE', 'CONSTANT'], default_protocol_code: 'PROT_RSA' },
  { code: 'SH_FX_PROX_HUM', region: 'shoulder', name_pt: 'Fratura do úmero proximal' },
  { code: 'SH_FX_CLAV', region: 'shoulder', name_pt: 'Fratura da clavícula' },
  { code: 'SH_FX_SCAP', region: 'shoulder', name_pt: 'Fratura da escápula / glenoide' },
  { code: 'SH_PEC_MAJOR', region: 'shoulder', name_pt: 'Rotura do peitoral maior' },
  { code: 'SH_SS_NEURO', region: 'shoulder', name_pt: 'Neuropatia do nervo supraescapular' },
  { code: 'SH_SCAP_DYSK', region: 'shoulder', name_pt: 'Discinesia escapular' },
  { code: 'SH_SC_JOINT', region: 'shoulder', name_pt: 'Lesão da articulação esternoclavicular' },
  // ---------- COTOVELO ----------
  { code: 'EL_LAT_EPI', region: 'elbow', name_pt: 'Epicondilite lateral' },
  { code: 'EL_MED_EPI', region: 'elbow', name_pt: 'Epicondilite medial' },
  { code: 'EL_UCL', region: 'elbow', name_pt: 'Lesão do ligamento colateral ulnar (medial)' },
  { code: 'EL_PLRI', region: 'elbow', name_pt: 'Instabilidade rotatória posterolateral' },
  { code: 'EL_DISL', region: 'elbow', name_pt: 'Luxação do cotovelo' },
  { code: 'EL_DBR', region: 'elbow', name_pt: 'Rotura do tendão distal do bíceps', intraop: 'EL_DBR.intraop.v1', report_template: 'EL_DBR.v1', proms_default: ['SANE', 'MEPS'], default_protocol_code: 'PROT_DISTAL_BICEPS' },
  { code: 'EL_TRICEPS', region: 'elbow', name_pt: 'Rotura do tendão do tríceps' },
  { code: 'EL_CUBITAL', region: 'elbow', name_pt: 'Neuropatia ulnar no cotovelo' },
  { code: 'EL_STIFF', region: 'elbow', name_pt: 'Rigidez do cotovelo' },
  { code: 'EL_OA', region: 'elbow', name_pt: 'Artrose do cotovelo' },
  { code: 'EL_OCD', region: 'elbow', name_pt: 'Osteocondrite dissecante do capítulo' },
  { code: 'EL_FX_RH', region: 'elbow', name_pt: 'Fratura da cabeça/colo do rádio' },
  { code: 'EL_FX_OLEC', region: 'elbow', name_pt: 'Fratura do olécrano' },
  { code: 'EL_FX_DH', region: 'elbow', name_pt: 'Fratura do úmero distal' },
  { code: 'EL_FX_COR', region: 'elbow', name_pt: 'Fratura do processo coronoide' },
  { code: 'EL_TERRIBLE_TRIAD', region: 'elbow', name_pt: 'Tríade terrível do cotovelo' },
  { code: 'EL_MONTEGGIA', region: 'elbow', name_pt: 'Fratura-luxação de Monteggia' },
  { code: 'EL_BURSITIS', region: 'elbow', name_pt: 'Bursite olecraniana' }
];

export const PATHOLOGY_BY_CODE: ReadonlyMap<string, PathologyDef> = new Map(PATHOLOGIES.map((p) => [p.code, p]));

export function pathologyName(code: string): string {
  const p = PATHOLOGY_BY_CODE.get(code);
  if (!p) throw new Error(`Código de patologia desconhecido: ${code}`);
  return p.name_pt;
}

/** Estruturas do mapa artroscópico (seção 5). */
export const ARTHRO_STRUCTURES: Record<Region, Record<string, string>> = {
  shoulder: {
    GH_CART_HUM: 'cartilagem da cabeça umeral',
    GH_CART_GLEN: 'cartilagem glenoidal',
    GH_LAB_SUP: 'labrum superior / âncora bicipital',
    GH_LAB_ANT: 'labrum anterior / anteroinferior',
    GH_LAB_POST: 'labrum posterior',
    GH_IGHL: 'ligamento glenoumeral inferior / recesso axilar',
    GH_MGHL: 'ligamento glenoumeral médio',
    GH_LHB: 'cabo longo do bíceps intra-articular',
    GH_PULLEY: 'polia bicipital',
    GH_SSC: 'subescapular',
    GH_SSP_ART: 'supraespinal (face articular)',
    GH_ISP_ART: 'infraespinal (face articular)',
    GH_HS: 'cabeça umeral posterolateral (Hill-Sachs)',
    GH_SYNOV: 'sinóvia / intervalo rotador',
    GH_LOOSE: 'corpos livres',
    SA_BURSA: 'bursa subacromial',
    SA_ACROM: 'acrômio / ligamento coracoacromial',
    SA_CUFF_BURS: 'manguito rotador (face bursal)',
    SA_AC: 'articulação acromioclavicular (face inferior)'
  },
  elbow: {
    EL_ANT_CAPS: 'cápsula anterior',
    EL_CORONOID: 'processo coronoide / fossa coronoide',
    EL_RH: 'cabeça do rádio',
    EL_CAPIT: 'capítulo',
    EL_TROCH: 'tróclea',
    EL_LAT_GUTTER: 'goteira lateral / plica posterolateral',
    EL_MED_GUTTER: 'goteira medial / ligamento colateral ulnar',
    EL_OLEC: 'olécrano / fossa olecraniana',
    EL_LOOSE: 'corpos livres',
    EL_SYNOV: 'sinóvia'
  }
};
