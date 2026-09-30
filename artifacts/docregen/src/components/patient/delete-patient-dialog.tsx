import * as React from "react";
import { useState, type ReactNode } from "react";
import { ApiError, useDeletePatient, type PatientDeleteBlocked } from "@workspace/docregen-api-client-react";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { useScopedTranslations } from "@/lib/i18n";
import { lgpdMessages } from "@/locales/lgpd";
import { operationalPatientRecordMessages } from "@/locales/operational-patient-record";

type Phase = "confirm" | "blocked" | "anonymize";

function blockedMessage(error: unknown): string | null {
  if (!(error instanceof ApiError) || error.status !== 409) return null;
  const data = error.data as Partial<PatientDeleteBlocked> | null;
  return typeof data?.error === "string" && data.error ? data.error : "";
}

/**
 * "Excluir paciente": hard delete only works for a patient without clinical
 * records (the API answers 409 otherwise — 20-year retention, Lei 13.787/2018).
 * When blocked, the dialog explains why and offers "Anonimizar dados
 * identificáveis" (with its own confirmation) instead.
 */
export function DeletePatientDialog({
  patientId,
  trigger,
  onDeleted,
  onAnonymize,
  onError,
}: {
  patientId: number;
  trigger: ReactNode;
  onDeleted: () => void | Promise<void>;
  onAnonymize: () => void | Promise<void>;
  onError: () => void;
}) {
  const tl = useScopedTranslations(lgpdMessages);
  const tr = useScopedTranslations(operationalPatientRecordMessages);
  const deleteMutation = useDeletePatient();
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>("confirm");
  const [blockedText, setBlockedText] = useState("");
  const [busy, setBusy] = useState(false);

  const onOpenChange = (next: boolean) => {
    setOpen(next);
    if (next) {
      setPhase("confirm");
      setBlockedText("");
    }
  };

  const confirmDelete = () => {
    deleteMutation.mutate(
      { id: patientId },
      {
        onSuccess: async () => {
          setOpen(false);
          await onDeleted();
        },
        onError: (error) => {
          const blocked = blockedMessage(error);
          if (blocked === null) {
            setOpen(false);
            onError();
            return;
          }
          setBlockedText(blocked || tl("deleteBlockedFallback"));
          setPhase("blocked");
        },
      },
    );
  };

  const confirmAnonymize = async () => {
    setBusy(true);
    try {
      await onAnonymize();
      setOpen(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger>
      <AlertDialogContent>
        {phase === "confirm" && (
          <>
            <AlertDialogHeader>
              <AlertDialogTitle>{tl("deleteTitle")}</AlertDialogTitle>
              <AlertDialogDescription>{tl("deleteDescription")}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{tl("cancel")}</AlertDialogCancel>
              <Button variant="destructive" onClick={confirmDelete} disabled={deleteMutation.isPending}>
                {tr("delete")}
              </Button>
            </AlertDialogFooter>
          </>
        )}
        {phase === "blocked" && (
          <>
            <AlertDialogHeader>
              <AlertDialogTitle>{tl("deleteBlockedTitle")}</AlertDialogTitle>
              <AlertDialogDescription data-testid="delete-blocked-message">{blockedText}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{tl("cancel")}</AlertDialogCancel>
              <Button onClick={() => setPhase("anonymize")}>{tl("anonymize")}</Button>
            </AlertDialogFooter>
          </>
        )}
        {phase === "anonymize" && (
          <>
            <AlertDialogHeader>
              <AlertDialogTitle>{tl("anonymizeTitle")}</AlertDialogTitle>
              <AlertDialogDescription>{tl("anonymizeDescription")}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{tl("cancel")}</AlertDialogCancel>
              <Button onClick={confirmAnonymize} disabled={busy}>{tl("anonymizeConfirm")}</Button>
            </AlertDialogFooter>
          </>
        )}
      </AlertDialogContent>
    </AlertDialog>
  );
}
