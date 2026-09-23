/**
 * Checklist pré-assinatura (seção 6.3). BLOCKER impede assinar; WARNING exige confirmação.
 */
import { PATHOLOGY_BY_CODE } from '../catalog/pathologies';

export type Severity = 'BLOCKER' | 'WARNING';
export interface CheckIssue {
  rule: string;
  severity: Severity;
  message_pt: string;
}

export interface PresignInput {
  episode_side: 'R' | 'L';
  core: {
    side: 'R' | 'L';
    postop_dx?: string[];
    start_time?: string;
    end_time?: string;
    antibiotic?: { drug?: string; minutes_before_incision?: number };
  };
  procedures: { pathology_code: string; data: Record<string, any> }[];
  implants: { category: string; lot?: string }[];
  arthroscopic_map: { structure_code: string; status: string; finding_text?: string; justification?: string }[];
}

export function runPresignChecklist(i: PresignInput): { canSign: boolean; issues: CheckIssue[] } {
  const issues: CheckIssue[] = [];
  const add = (rule: string, severity: Severity, message_pt: string) => issues.push({ rule, severity, message_pt });

  if (i.core.side !== i.episode_side) add('SIDE_MISMATCH', 'BLOCKER', 'Lado da cirurgia diferente do lado do episódio.');

  if (!i.core.postop_dx || i.core.postop_dx.length === 0) add('POSTOP_DX_EMPTY', 'BLOCKER', 'Diagnóstico pós-operatório não preenchido.');
  for (const c of i.core.postop_dx ?? []) if (!PATHOLOGY_BY_CODE.has(c)) add('POSTOP_DX_UNKNOWN', 'BLOCKER', `Diagnóstico desconhecido: ${c}`);

  if (i.procedures.length === 0) add('NO_PROCEDURE', 'BLOCKER', 'Nenhum procedimento registrado.');

  for (const [idx, imp] of i.implants.entries()) {
    if (!imp.lot || imp.lot.trim() === '') {
      if (imp.category === 'prosthesis_component') add('PROSTHESIS_NO_LOT', 'BLOCKER', `Componente protético #${idx + 1} sem lote.`);
      else add('IMPLANT_NO_LOT', 'WARNING', `Implante #${idx + 1} sem lote.`);
    }
  }

  for (const m of i.arthroscopic_map) {
    if (m.status === 'lesion' && !m.justification) {
      add('LESION_WITHOUT_ACTION', 'WARNING', `Lesão registrada em ${m.structure_code} sem conduta documentada — confirmar conduta expectante.`);
    }
  }

  if (i.core.start_time && i.core.end_time) {
    const min = (Date.parse(i.core.end_time) - Date.parse(i.core.start_time)) / 60000;
    if (!Number.isFinite(min) || min <= 0) add('TIME_INVALID', 'BLOCKER', 'Horário de término anterior ou igual ao início.');
    else if (min < 5 || min > 360) add('TIME_IMPLAUSIBLE', 'WARNING', `Tempo cirúrgico de ${Math.round(min)} min — conferir digitação.`);
  }

  if (i.core.antibiotic?.drug && i.core.antibiotic.minutes_before_incision === undefined) {
    add('ANTIBIOTIC_NO_TIME', 'WARNING', 'Antibiótico sem horário em relação à incisão.');
  }

  return { canSign: !issues.some((x) => x.severity === 'BLOCKER'), issues };
}
