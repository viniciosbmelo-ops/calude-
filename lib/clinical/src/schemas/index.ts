/** Índice estático dos schemas (sem leitura de disco — seguro para bundle). */
import s_CORE_SURGERY_v1 from './CORE_SURGERY.v1.json';
import s_EL_DBR_diagnosis_v1 from './EL_DBR.diagnosis.v1.json';
import s_EL_DBR_intraop_v1 from './EL_DBR.intraop.v1.json';
import s_PREOP_COMMON_v1 from './PREOP_COMMON.v1.json';
import s_SH_AC_DISL_intraop_v1 from './SH_AC_DISL.intraop.v1.json';
import s_SH_ARTHROPLASTY_intraop_v1 from './SH_ARTHROPLASTY.intraop.v1.json';
import s_SH_BICEPS_intraop_v1 from './SH_BICEPS.intraop.v1.json';
import s_SH_FX_PROX_HUM_diagnosis_v1 from './SH_FX_PROX_HUM.diagnosis.v1.json';
import s_SH_INST_ANT_diagnosis_v1 from './SH_INST_ANT.diagnosis.v1.json';
import s_SH_INST_ANT_diagnosis_v2 from './SH_INST_ANT.diagnosis.v2.json';
import s_SH_INST_ANT_intraop_v1 from './SH_INST_ANT.intraop.v1.json';
import s_SH_RCT_diagnosis_v1 from './SH_RCT.diagnosis.v1.json';
import s_SH_RCT_intraop_v1 from './SH_RCT.intraop.v1.json';

export const ALL_SCHEMAS: Record<string, unknown>[] = [
  s_CORE_SURGERY_v1, s_EL_DBR_diagnosis_v1, s_EL_DBR_intraop_v1, s_PREOP_COMMON_v1, s_SH_AC_DISL_intraop_v1, s_SH_ARTHROPLASTY_intraop_v1,
  s_SH_BICEPS_intraop_v1, s_SH_FX_PROX_HUM_diagnosis_v1, s_SH_INST_ANT_diagnosis_v1, s_SH_INST_ANT_diagnosis_v2, s_SH_INST_ANT_intraop_v1,
  s_SH_RCT_diagnosis_v1, s_SH_RCT_intraop_v1
];
