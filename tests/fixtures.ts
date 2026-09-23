import { ReportInput } from '../src/clinical/report/reportEngine';

export const coreRight = {
  surgery_date: '2026-09-23',
  side: 'R',
  hospital: 'Hospital Exemplo',
  assistants: [{ name: 'Dr. Auxiliar Teste', crm: '00000-ES', role: 'first_assistant' }],
  anesthesia: { type: 'general_plus_block', block: 'interscalene', controlled_hypotension: true, target_map_mmHg: 65 },
  positioning: 'beach_chair',
  beach_chair_angle_deg: 70,
  approach: ['arthroscopic'],
  portals: ['posterior', 'anterior', 'lateral'],
  antibiotic: { drug: 'cefazolina', dose: '2 g', minutes_before_incision: 30 },
  tranexamic_acid: { dose_mg: 1000, route: 'iv' },
  skin_prep: 'chlorhexidine_alcohol',
  start_time: '2026-09-23T10:00:00-03:00',
  end_time: '2026-09-23T11:25:00-03:00',
  preop_dx: ['SH_RCT_FULL', 'SH_BICEPS'],
  postop_dx: ['SH_RCT_FULL', 'SH_BICEPS', 'SH_AC_OA'],
  immobilization: 'sling_abduction_15'
};

export const multiProcedure: ReportInput = {
  region: 'shoulder',
  patient: { name: 'Paciente Teste', record_number: '12345' },
  surgeon: { name: 'Dr. Vinicios Barreto Melo', crm: '13416-ES' },
  core: coreRight,
  arthroscopic_map: [
    { structure_code: 'GH_SSP_ART', status: 'treated', finding_text: 'rotura de espessura total' },
    { structure_code: 'GH_CART_HUM', status: 'normal' },
    { structure_code: 'GH_LHB', status: 'treated', finding_text: 'tendinopatia com rotura parcial de 40%' },
    { structure_code: 'GH_CART_GLEN', status: 'normal' },
    { structure_code: 'GH_LAB_POST', status: 'not_evaluated' }
  ],
  procedures: [
    { pathology_code: 'SH_BICEPS', sequence: 2, schema_version: 1, data: { lhb_tendinopathy: 'partial_tear', lhb_partial_tear_pct: 40, procedure: 'tenodesis', tenodesis_site: 'suprapectoral_arthroscopic', tenodesis_fixation: 'anchor' } },
    { pathology_code: 'SH_RCT_FULL', sequence: 1, schema_version: 1, data: { tendons: ['SSP', 'ISP'], tear_type: 'full_thickness', size_ap_mm: 28, retraction_ml_mm: 22, patte: 2, tear_shape: 'L', tissue_quality: 'fair', mobility: 'reducible_with_tension', releases: ['bursal', 'articular_capsular'], footprint_prep: 'light_abrasion', marrow_stimulation: true, margin_convergence_sutures: 2, procedure: 'transosseous_equivalent_knotless', medial_row_anchors: 2, lateral_row_anchors: 2, suture_config: 'medial_knotless', repair_coverage: 'complete', repair_tension: 'acceptable' } },
    { pathology_code: 'SH_AC_OA', sequence: 3, schema_version: 1, data: { procedure: 'distal_clavicle_excision', resection_mm: 7.5 } }
  ],
  implants: [
    { manufacturer: 'Fabricante A', model: 'Âncora all-suture', size: '2,6 mm', lot: 'L123', quantity: 2, location: 'fileira medial' },
    { manufacturer: 'Fabricante A', model: 'Âncora knotless PEEK', size: '4,75 mm', lot: 'L456', quantity: 2, location: 'fileira lateral' },
    { manufacturer: 'Fabricante B', model: 'Âncora tenodese', lot: 'L789', quantity: 1 }
  ],
  postop_plan: 'Protocolo de reparo do manguito rotador (padrão).'
};
