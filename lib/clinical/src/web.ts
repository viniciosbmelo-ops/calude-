/**
 * Ponto de entrada para o NAVEGADOR: só o necessário para as telas.
 * Não inclui o compilador ajv (a CSP de produção proíbe eval) nem o motor de relatório.
 */
export { PATHOLOGIES, PATHOLOGY_BY_CODE, ARTHRO_STRUCTURES, pathologyName } from './catalog/pathologies';
export type { PathologyDef, Region } from './catalog/pathologies';
export { CASE_TYPES, CASE_TYPE_BY_KEY, caseTypesFor, diagnosesFor, intraopSchemaId } from './catalog/caseTypes';
export type { CaseType } from './catalog/caseTypes';
export { ALL_SCHEMAS } from './schemas';
export { toIssues } from './ajvMessages';
export type { ValidationIssue } from './ajvMessages';
export { parseGs1, Gs1ParseError } from './gs1/parser';
export type { Gs1Result } from './gs1/parser';
export { procedureName, diagnosisText, CLINICAL_PAYLOAD_VERSION } from './surgery/payload';
export { IMPLANT_CATEGORIES } from './surgery/payload';
export {
  CORE_OPTIONS_BY_REGION, coreSchemaForRegion, coreRegionIssues, inapplicableCoreFields, withoutInapplicableCore,
  withoutOtherRegionOptions, hasAccessType, isArthroscopic, isOpenOnly
} from './surgery/coreOptions';
export type { ClinicalPayload, ClinicalProcedure, ClinicalImplant, ClinicalMapEntry, IssueGroup } from './surgery/payload';
export { default as LABELS } from './labels.pt.json';
