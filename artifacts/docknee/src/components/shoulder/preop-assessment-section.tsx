/**
 * Avaliação pré-operatória: formulário (registro de procedimento) e leitura (página da cirurgia).
 * Campos, opções e faixas vêm dos schemas do núcleo; nada aqui interpreta os valores.
 */
import { ClipboardList, Pencil } from "lucide-react";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ALL_SCHEMAS, PATHOLOGY_BY_CODE, PREOP_COMMON_SCHEMA, semCamposDoCadastro, type PreopAssessment, type Region } from "@workspace/clinical/web";
import { PatientClinicalSummary } from "@/components/patient-clinical-fields";
import { patientEditHref } from "@/lib/patient-clinical";
import { useScopedTranslations } from "@/lib/i18n";
import { surgeryShoulderMessages } from "@/locales/surgery-shoulder";
import { SchemaForm, fieldLabel, unitOf, validateWith, valueLabel } from "./schema-form";
import type { PreopBlock, PreopState } from "./preop-assessment";

type Obj = Record<string, any>;
const SCHEMA_BY_ID = new Map(ALL_SCHEMAS.map((s) => [(s as Obj).$id as string, s as Obj]));

/** Pendências (tipo e faixa) dos campos comuns e dos sub-blocos visíveis. */
export function preopIssueCount(state: PreopState, blocks: readonly PreopBlock[]): number {
  return validateWith(PREOP_COMMON_SCHEMA, state.comum).length
    + blocks.reduce((n, b) => n + validateWith(b.schema, state.bySchema[b.schema] ?? {}).length, 0);
}

/** Lado dominante, tabagismo, diabetes e nível de atividade: só leitura, do cadastro do paciente. */
function PatientProfileReadOnly({ patient }: { patient: { id: number } | undefined }) {
  const t = useScopedTranslations(surgeryShoulderMessages);
  return (
    <div className="space-y-2 rounded-lg border border-border bg-muted/20 p-3" data-testid="preop-patient-profile">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold">{t("preopPatientProfile")}</p>
        {patient && (
          <Link href={patientEditHref(patient.id)} className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
            <Pencil className="h-3 w-3" />{t("preopEditPatient")}
          </Link>
        )}
      </div>
      <p className="text-xs text-muted-foreground">{t("preopPatientProfileHelp")}</p>
      {patient ? <PatientClinicalSummary patient={patient} /> : <p className="text-sm text-muted-foreground">{t("preopSelectPatient")}</p>}
    </div>
  );
}

export function PreopAssessmentForm({ blocks, state, onChange, side, region, patient }: {
  blocks: readonly PreopBlock[]; state: PreopState; onChange(s: PreopState): void; side: string; region: Region;
  /** Paciente selecionado (resposta da API), para exibir o perfil clínico do cadastro. */
  patient?: { id: number };
}) {
  const t = useScopedTranslations(surgeryShoulderMessages);
  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">{t("preopHelp")}</p>
      <PatientProfileReadOnly patient={patient} />
      <div className="space-y-3">
        <p className="text-sm font-semibold">{t("preopCommon")}</p>
        <SchemaForm schema={SCHEMA_BY_ID.get(PREOP_COMMON_SCHEMA)!} value={state.comum} side={side} region={region}
          onChange={(v) => onChange({ ...state, comum: v })} />
      </div>
      {blocks.length === 0 && <p className="text-sm text-muted-foreground">{t("preopNoBlock")}</p>}
      {blocks.map((b) => (
        <div key={b.schema} className="space-y-3 border-t pt-4" data-preop-block={b.schema}>
          <p className="text-sm font-semibold">{t("preopBlockTitle", { name: PATHOLOGY_BY_CODE.get(b.codigo)?.name_pt ?? b.codigo })}</p>
          <SchemaForm schema={SCHEMA_BY_ID.get(b.schema)!} value={state.bySchema[b.schema] ?? {}} side={side} region={region}
            onChange={(v) => onChange({ ...state, bySchema: { ...state.bySchema, [b.schema]: v } })} />
        </div>
      ))}
    </div>
  );
}

function formatValue(name: string, v: unknown, yesNo: (b: boolean) => string): string {
  if (typeof v === "boolean") return yesNo(v);
  if (Array.isArray(v)) return v.map((x) => valueLabel(name, x)).join(", ");
  if (typeof v === "object" && v !== null) {
    return Object.entries(v as Obj).map(([k, x]) => `${fieldLabel(k)} ${formatValue(k, x, yesNo)}`).join(" · ");
  }
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)) return v.split("-").reverse().join("/");
  if (typeof v === "number") {
    const unit = unitOf(name);
    return `${String(v).replace(".", ",")}${unit ? (unit === "°" || unit === "%" ? unit : ` ${unit}`) : ""}`;
  }
  return valueLabel(name, v);
}

function FieldList({ schemaId, data, yesNo }: { schemaId: string; data: Obj; yesNo: (b: boolean) => string }) {
  const order = Object.keys(SCHEMA_BY_ID.get(schemaId)?.properties ?? {});
  const entries = Object.entries(data).filter(([, v]) => v !== undefined && v !== "")
    .sort(([a], [b]) => (order.indexOf(a) + 1 || 999) - (order.indexOf(b) + 1 || 999));
  return (
    <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
      {entries.map(([k, v]) => (
        <div key={k} className="min-w-0">
          <dt className="text-xs text-muted-foreground">{fieldLabel(k)}</dt>
          <dd className="break-words">{formatValue(k, v, yesNo)}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Leitura na página da cirurgia: só os campos preenchidos. Nada é exibido sem o bloco (registros v1). */
export function PreopAssessmentView({ value }: { value: PreopAssessment | undefined }) {
  const t = useScopedTranslations(surgeryShoulderMessages);
  if (!value) return null;
  const yesNo = (b: boolean) => (b ? t("yes") : t("no"));
  // Registros antigos podem ter campos que agora são do cadastro do paciente: não são exibidos aqui
  const comum = semCamposDoCadastro(value.comum ?? {});
  const hasCommon = Object.keys(comum).length > 0;
  return (
    <Card className="min-w-0 shadow-sm" data-testid="preop-assessment-view">
      <CardHeader className="pb-2">
        <CardTitle className="text-lg flex items-center gap-2"><ClipboardList className="h-4 w-4 text-primary" /> {t("preopTitle")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {hasCommon && <FieldList schemaId={PREOP_COMMON_SCHEMA} data={comum} yesNo={yesNo} />}
        {(value.patologias ?? []).map((e) => (
          <div key={e.schema} className={hasCommon ? "space-y-2 border-t pt-4" : "space-y-2"}>
            <p className="text-sm font-semibold">{t("preopBlockTitle", { name: PATHOLOGY_BY_CODE.get(e.codigo)?.name_pt ?? e.codigo })}</p>
            <FieldList schemaId={e.schema} data={e.dados} yesNo={yesNo} />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
