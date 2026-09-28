import type { RehabProtocol } from "@workspace/db";

export interface ProtocolFollowupDef {
  title: string;
  week: number;
  assessments: string[];
}

export interface ProtocolPhaseDef {
  phase: number;
  label: string;
  weeks: [number, number];
  followups: ProtocolFollowupDef[];
  progression_criteria?: string;
  notes?: string;
}

export interface ProtocolDefinition {
  start_reference: "surgery_date" | "treatment_start";
  references?: string[];
  phases: ProtocolPhaseDef[];
}

export interface FollowupPreview {
  phase: number;
  title: string;
  requiredAssessments: string[];
  dueDate: string; // YYYY-MM-DD
}

function addWeeks(dateISO: string, weeks: number): string {
  const [y, m, d] = dateISO.split("-").map(Number);
  const dt = new Date(Date.UTC(y!, (m! - 1), d!));
  dt.setUTCDate(dt.getUTCDate() + weeks * 7);
  return dt.toISOString().slice(0, 10);
}

export function getProtocolDefinition(protocol: RehabProtocol): ProtocolDefinition {
  return protocol.definition as unknown as ProtocolDefinition;
}

/**
 * Gera o PREVIEW do cronograma de follow-ups a partir do protocolo.
 * Nada é persistido aqui — persistência só no confirm-protocol.
 */
export function generateFollowupsPreview(
  protocol: RehabProtocol,
  startDateISO: string,
): FollowupPreview[] {
  const definition = getProtocolDefinition(protocol);
  return definition.phases.flatMap((phase) =>
    phase.followups.map((f) => ({
      phase: phase.phase,
      title: `${f.title} — ${phase.label}`,
      requiredAssessments: f.assessments,
      dueDate: addWeeks(startDateISO, f.week),
    })),
  );
}
