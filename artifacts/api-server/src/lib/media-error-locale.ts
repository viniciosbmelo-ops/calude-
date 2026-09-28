import type { SupportedLocale } from "./locale";
import { message, type MessageKey } from "./locale-catalog";

const KNOWN_MEDIA_ERRORS: Record<string, MessageKey> = {
  "Arquivo enviado não encontrado": "uploadedFileNotFound",
  "Arquivo excede o tamanho máximo permitido": "uploadedFileTooLarge",
  "Tamanho do arquivo não corresponde ao upload autorizado": "uploadedFileSizeMismatch",
  "Tipo real do arquivo não corresponde ao upload autorizado": "uploadedFileTypeMismatch",
};

export function localizedKnownMediaError(locale: SupportedLocale, error: string): string {
  const key = KNOWN_MEDIA_ERRORS[error];
  if (key) return message(locale, key);
  return error;
}