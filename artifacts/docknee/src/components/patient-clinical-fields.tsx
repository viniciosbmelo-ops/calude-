/**
 * Perfil clínico do paciente (lado dominante, tabagismo, diabetes, nível de atividade):
 * campos do cadastro (novo paciente e edição) e leitura (prontuário e formulário da cirurgia).
 */
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useScopedTranslations } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { operationalPatientRecordMessages } from "@/locales/operational-patient-record";
import {
  PATIENT_CLINICAL_FIELDS, PATIENT_CLINICAL_LABEL_KEYS, PATIENT_CLINICAL_OPTIONS, PATIENT_CLINICAL_VALUE_KEYS,
  patientClinicalDisplay, type PatientClinicalForm,
} from "@/lib/patient-clinical";

type MsgKey = keyof (typeof operationalPatientRecordMessages)["pt-BR"];
const NONE = "_none";

export function PatientClinicalFields({ value, onChange, idPrefix }: {
  value: PatientClinicalForm; onChange(next: PatientClinicalForm): void; idPrefix: string;
}) {
  const tr = useScopedTranslations(operationalPatientRecordMessages);
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3" data-testid="patient-clinical-fields">
      {PATIENT_CLINICAL_FIELDS.map((field) => {
        const id = `${idPrefix}-${field}`;
        const keys = PATIENT_CLINICAL_VALUE_KEYS[field] as Record<string, MsgKey>;
        return (
          <div key={field} className="space-y-1.5 min-w-0">
            <Label htmlFor={id} className="text-sm font-medium">{tr(PATIENT_CLINICAL_LABEL_KEYS[field])}</Label>
            <Select value={value[field] || NONE} onValueChange={(v) => onChange({ ...value, [field]: v === NONE ? "" : v })}>
              <SelectTrigger id={id}><SelectValue placeholder={tr("select")} /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>{tr("clearSelection")}</SelectItem>
                {PATIENT_CLINICAL_OPTIONS[field].map((opt) => (
                  <SelectItem key={opt} value={opt}>{tr(keys[opt])}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        );
      })}
    </div>
  );
}

/** Leitura: os quatro campos, com "Não informado" quando vazio. */
export function PatientClinicalSummary({ patient, className }: { patient: unknown; className?: string }) {
  const tr = useScopedTranslations(operationalPatientRecordMessages);
  return (
    <dl className={cn("grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-sm", className)} data-testid="patient-clinical-summary">
      {patientClinicalDisplay(patient).map((item) => (
        <div key={item.field} className="min-w-0">
          <dt className="text-xs text-muted-foreground">{tr(item.labelKey as MsgKey)}</dt>
          <dd className={cn("break-words", !item.valueKey && "text-muted-foreground")}>
            {item.valueKey ? tr(item.valueKey as MsgKey) : tr("notInformed")}
          </dd>
        </div>
      ))}
    </dl>
  );
}
