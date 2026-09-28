/**
 * MIME/extension contract shared by the AI assistant transcription route and its
 * browser recorder. Codec parameters are removed because browsers commonly
 * submit values such as audio/webm;codecs=opus.
 */
const MIME_TO_EXTENSION: Record<string, string> = {
  "audio/webm": "webm",
  "audio/mp4": "m4a",
  "audio/x-m4a": "m4a",
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/mpga": "mp3",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/ogg": "ogg",
};

export function transcriptionFileExtension(mimeType: string): string | null {
  const baseMimeType = mimeType.toLowerCase().split(";")[0]?.trim() ?? "";
  return MIME_TO_EXTENSION[baseMimeType] ?? null;
}

export function transcriptionLocale(value: unknown): "es" | "pt-BR" {
  return value === "es" ? "es" : "pt-BR";
}

export function transcriptionErrorMessage(
  locale: "es" | "pt-BR",
  kind: "missing" | "unsupported" | "empty" | "failed",
): string {
  if (locale === "es") {
    switch (kind) {
      case "missing":
        return "No se recibió audio.";
      case "unsupported":
        return "Formato de audio no compatible.";
      case "empty":
        return "No fue posible identificar el habla.";
      default:
        return "No fue posible transcribir el audio ahora.";
    }
  }

  switch (kind) {
    case "missing":
      return "Áudio não recebido.";
    case "unsupported":
      return "Formato de áudio não suportado.";
    case "empty":
      return "Não foi possível identificar a fala.";
    default:
      return "Não foi possível transcrever o áudio agora.";
  }
}