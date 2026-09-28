import { useCallback, useEffect, useRef, useState } from "react";

export type JoiaVoiceStatus =
  | "idle"
  | "requesting"
  | "listening"
  | "stopping"
  | "transcribing";

export type VoiceMessageKey =
  | "microphoneUnsupported"
  | "microphonePermissionDenied"
  | "microphoneDeviceUnavailable"
  | "microphoneStartError"
  | "microphoneRecordingError"
  | "microphoneNoSpeech"
  | "microphoneNoAudio"
  | "microphoneTranscriptionError";

export interface SpeechResultLike {
  isFinal: boolean;
  [index: number]: { transcript: string };
}

export interface SpeechResultEventLike {
  resultIndex: number;
  results: ArrayLike<SpeechResultLike>;
}

export interface SpeechErrorEventLike {
  error?: string;
}

export interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: SpeechResultEventLike) => void) | null;
  onerror: ((event: SpeechErrorEventLike) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}

export type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

export interface MediaRecorderDataEventLike {
  data: Blob;
}

export interface MediaRecorderErrorEventLike {
  error?: unknown;
}

export interface MediaRecorderLike {
  mimeType: string;
  state: string;
  ondataavailable: ((event: MediaRecorderDataEventLike) => void) | null;
  onerror: ((event: MediaRecorderErrorEventLike) => void) | null;
  onstop: (() => void) | null;
  start(timeslice?: number): void;
  stop(): void;
}

export type MediaRecorderConstructor = {
  new (stream: MediaStream, options?: { mimeType?: string }): MediaRecorderLike;
  isTypeSupported?: (mimeType: string) => boolean;
};

export interface JoiaVoiceControllerOptions {
  locale: string;
  getMessage: (key: VoiceMessageKey) => string;
  onStatusChange?: (status: JoiaVoiceStatus) => void;
  onInterimText?: (text: string) => void;
  onText?: (text: string) => void;
  onError?: (key: VoiceMessageKey) => void;
  getUserMedia?: ((constraints: MediaStreamConstraints) => Promise<MediaStream>) | null;
  speechRecognition?: SpeechRecognitionConstructor | null;
  mediaRecorder?: MediaRecorderConstructor | null;
  appleMobile?: boolean;
  fetch?: typeof fetch;
}

const AUDIO_MIME_TYPES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
  "audio/x-m4a",
  "audio/ogg;codecs=opus",
] as const;

const MAX_SPEECH_RESTARTS = 3;
const SPEECH_RESTART_DELAY_MS = 80;
const SPEECH_STOP_FALLBACK_MS = 1_000;

const noop = () => undefined;

function browserSpeechRecognition(): SpeechRecognitionConstructor | null {
  if (typeof window === "undefined") return null;
  const browserWindow = window as Window & {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };
  return browserWindow.SpeechRecognition ?? browserWindow.webkitSpeechRecognition ?? null;
}

function browserMediaRecorder(): MediaRecorderConstructor | null {
  if (typeof globalThis === "undefined") return null;
  return ((globalThis as typeof globalThis & {
    MediaRecorder?: MediaRecorderConstructor;
  }).MediaRecorder) ?? null;
}

function browserGetUserMedia(): JoiaVoiceControllerOptions["getUserMedia"] {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) return null;
  return navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
}

export function isAppleMobileBrowser(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

/**
 * Pick the MIME type before constructing the recorder. Safari commonly
 * supports MP4 while Chromium commonly supports WebM; passing a MIME that
 * the browser cannot encode makes the MediaRecorder constructor throw.
 */
export function getSupportedAudioMimeType(
  MediaRecorderClass: MediaRecorderConstructor | null,
): string | undefined {
  if (!MediaRecorderClass?.isTypeSupported) return undefined;
  for (const mimeType of AUDIO_MIME_TYPES) {
    try {
      if (MediaRecorderClass.isTypeSupported(mimeType)) return mimeType;
    } catch {
      // Some older Safari versions throw for an unknown MIME instead of
      // returning false. Try the next candidate or the browser default.
    }
  }
  return undefined;
}

/**
 * Keep the upload filename aligned with the MIME accepted by the server and
 * by OpenAI. Codec parameters are intentionally ignored.
 */
export function audioFilenameForMimeType(mimeType: string): string {
  const baseMimeType = mimeType.toLowerCase().split(";")[0]?.trim();
  const extension = baseMimeType === "audio/mp4" || baseMimeType === "audio/x-m4a"
    ? "m4a"
    : baseMimeType === "audio/mpeg" || baseMimeType === "audio/mp3" || baseMimeType === "audio/mpga"
      ? "mp3"
      : baseMimeType === "audio/wav" || baseMimeType === "audio/x-wav"
        ? "wav"
        : baseMimeType === "audio/ogg"
          ? "ogg"
          : "webm";
  return `joia-audio.${extension}`;
}

type VoiceSession = {
  id: number;
  kind: "speech" | "recorder";
  stopRequested: boolean;
  commitOnStop: boolean;
  cancelled: boolean;
  failed: boolean;
  finalText: string;
  interimText: string;
  finalResultIndexes: Set<number>;
  recognition: SpeechRecognitionLike | null;
  recognitionEnded: boolean;
  recorder: MediaRecorderLike | null;
  stream: MediaStream | null;
  chunks: Blob[];
  mimeType: string;
  restartAttempts: number;
  restartTimer: ReturnType<typeof setTimeout> | null;
  stopFallbackTimer: ReturnType<typeof setTimeout> | null;
  transcriptionAbort: AbortController | null;
};

function stopTracks(stream: MediaStream | null): void {
  if (!stream) return;
  for (const track of stream.getTracks()) {
    try {
      track.stop();
    } catch {
      // A track can already be stopped by the browser during teardown.
    }
  }
}

function errorName(error: unknown): string {
  return typeof DOMException !== "undefined" && error instanceof DOMException
    ? error.name
    : typeof error === "object" && error !== null && "name" in error
      ? String((error as { name?: unknown }).name)
      : "";
}

export class JoiaVoiceController {
  private options: JoiaVoiceControllerOptions;
  private session: VoiceSession | null = null;
  private nextSessionId = 0;
  private status: JoiaVoiceStatus = "idle";
  private disposed = false;

  constructor(options: JoiaVoiceControllerOptions) {
    this.options = options;
  }

  update(options: Partial<JoiaVoiceControllerOptions>): void {
    this.options = { ...this.options, ...options };
  }

  getStatus(): JoiaVoiceStatus {
    return this.status;
  }

  start(): void {
    if (this.disposed) return;
    if (this.session) this.cancelSession(this.session);

    const session: VoiceSession = {
      id: ++this.nextSessionId,
      kind: "speech",
      stopRequested: false,
      commitOnStop: true,
      cancelled: false,
      failed: false,
      finalText: "",
      interimText: "",
      finalResultIndexes: new Set(),
      recognition: null,
      recognitionEnded: false,
      recorder: null,
      stream: null,
      chunks: [],
      mimeType: "",
      restartAttempts: 0,
      restartTimer: null,
      stopFallbackTimer: null,
      transcriptionAbort: null,
    };
    this.session = session;
    this.setStatus("requesting");
    this.emitInterim("");

    const speechRecognition = this.getSpeechRecognition();
    const mediaRecorder = this.getMediaRecorder();
    const getUserMedia = this.getGetUserMedia();
    const appleMobile = this.options.appleMobile ?? isAppleMobileBrowser();
    const recorderAvailable = Boolean(mediaRecorder && getUserMedia);

    if ((appleMobile || !speechRecognition) && recorderAvailable) {
      session.kind = "recorder";
      void this.beginRecorder(session, mediaRecorder!, getUserMedia!);
      return;
    }

    if (speechRecognition) {
      this.beginSpeech(session, speechRecognition, appleMobile);
      return;
    }

    if (recorderAvailable) {
      session.kind = "recorder";
      void this.beginRecorder(session, mediaRecorder!, getUserMedia!);
      return;
    }

    this.finishSession(session);
    this.reportError("microphoneUnsupported");
  }

  stop(options: { commit?: boolean } = {}): void {
    const session = this.session;
    if (!session || this.disposed) return;

    const commit = options.commit !== false;
    if (commit && session.stopRequested) return;
    session.stopRequested = true;
    session.commitOnStop = commit;

    if (!commit) {
      this.cancelSession(session);
      return;
    }

    if (session.kind === "recorder") {
      if (session.recorder?.state === "recording") {
        this.setStatus("stopping");
        try {
          session.recorder.stop();
        } catch {
          this.failRecorder(session, "microphoneRecordingError");
        }
      } else if (this.status === "requesting") {
        // Permission is still pending. There is no recorder to stop, and a
        // later permission result must not start one.
        this.cancelSession(session);
      }
      return;
    }

    this.setStatus("stopping");
    this.clearSpeechTimers(session);
    if (session.recognition) {
      try {
        session.recognition.stop();
      } catch {
        this.finishSpeech(session, commit);
      }
      session.stopFallbackTimer = setTimeout(() => {
        if (this.isCurrent(session)) this.finishSpeech(session, commit);
      }, SPEECH_STOP_FALLBACK_MS);
    } else {
      this.finishSpeech(session, commit);
    }
  }

  cancel(options: { notify?: boolean } = {}): void {
    if (this.session) this.cancelSession(this.session, options.notify !== false);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.session) this.cancelSession(this.session, false);
    this.options = {
      ...this.options,
      onStatusChange: noop,
      onInterimText: noop,
      onText: noop,
      onError: noop,
    };
  }

  private getSpeechRecognition(): SpeechRecognitionConstructor | null {
    return this.options.speechRecognition !== undefined
      ? this.options.speechRecognition
      : browserSpeechRecognition();
  }

  private getMediaRecorder(): MediaRecorderConstructor | null {
    return this.options.mediaRecorder !== undefined
      ? this.options.mediaRecorder
      : browserMediaRecorder();
  }

  private getGetUserMedia(): JoiaVoiceControllerOptions["getUserMedia"] {
    return this.options.getUserMedia !== undefined
      ? this.options.getUserMedia
      : browserGetUserMedia();
  }

  private beginSpeech(
    session: VoiceSession,
    SpeechRecognitionClass: SpeechRecognitionConstructor,
    appleMobile: boolean,
  ): void {
    let recognition: SpeechRecognitionLike;
    try {
      recognition = new SpeechRecognitionClass();
    } catch {
      this.finishSession(session);
      this.reportError("microphoneStartError");
      return;
    }

    session.recognition = recognition;
    recognition.lang = this.options.locale === "es" ? "es-ES" : "pt-BR";
    // iOS WebKit is more reliable with one utterance. Desktop recognition
    // may end by itself, so onend below retries only a bounded number of times.
    recognition.continuous = !appleMobile;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    recognition.onresult = (event) => {
      if (!this.isCurrent(session)) return;
      let interim = "";
      const firstResult = Math.max(0, event.resultIndex ?? 0);
      for (let i = firstResult; i < event.results.length; i += 1) {
        const result = event.results[i];
        const transcript = result?.[0]?.transcript?.trim();
        if (!transcript) continue;
        if (result.isFinal) {
          if (!session.finalResultIndexes.has(i)) {
            session.finalResultIndexes.add(i);
            session.finalText = `${session.finalText} ${transcript}`.trim();
          }
        } else {
          interim = `${interim} ${transcript}`.trim();
        }
      }
      session.interimText = interim;
      this.emitInterim(`${session.finalText} ${interim}`.trim());
    };

    recognition.onerror = (event) => {
      if (!this.isCurrent(session)) return;
      if (event.error === "aborted" && session.stopRequested) return;
      session.failed = true;
      this.reportError(this.speechErrorKey(event.error));
      this.finishSpeech(session, true);
    };

    recognition.onend = () => {
      if (!this.isCurrent(session)) return;
      session.recognitionEnded = true;
      if (session.stopRequested || session.failed) {
        this.finishSpeech(session, session.commitOnStop);
        return;
      }
      if (session.restartAttempts >= MAX_SPEECH_RESTARTS) {
        session.failed = true;
        this.reportError("microphoneStartError");
        this.finishSpeech(session, true);
        return;
      }

      session.restartAttempts += 1;
      session.restartTimer = setTimeout(() => {
        session.restartTimer = null;
        if (!this.isCurrent(session) || session.stopRequested || session.failed) return;
        session.finalResultIndexes.clear();
        try {
          recognition.start();
        } catch {
          if (session.restartAttempts >= MAX_SPEECH_RESTARTS) {
            session.failed = true;
            this.reportError("microphoneStartError");
            this.finishSpeech(session, true);
          } else {
            recognition.onend?.();
          }
        }
      }, SPEECH_RESTART_DELAY_MS);
    };

    try {
      recognition.start();
      if (this.isCurrent(session)) this.setStatus("listening");
    } catch {
      this.finishSession(session);
      this.reportError("microphoneStartError");
    }
  }

  private async beginRecorder(
    session: VoiceSession,
    MediaRecorderClass: MediaRecorderConstructor,
    getUserMedia: (constraints: MediaStreamConstraints) => Promise<MediaStream>,
  ): Promise<void> {
    let stream: MediaStream;
    try {
      stream = await getUserMedia({ audio: true });
    } catch (error) {
      if (this.isCurrent(session) && !session.cancelled) {
        this.finishSession(session);
        this.reportError(this.mediaPermissionErrorKey(error));
      }
      return;
    }

    if (!this.isCurrent(session) || session.stopRequested || session.cancelled) {
      stopTracks(stream);
      return;
    }

    const supportedMimeType = getSupportedAudioMimeType(MediaRecorderClass);
    let recorder: MediaRecorderLike;
    try {
      recorder = supportedMimeType
        ? new MediaRecorderClass(stream, { mimeType: supportedMimeType })
        : new MediaRecorderClass(stream);
    } catch {
      stopTracks(stream);
      this.finishSession(session);
      this.reportError("microphoneStartError");
      return;
    }

    if (!this.isCurrent(session) || session.stopRequested || session.cancelled) {
      stopTracks(stream);
      return;
    }

    session.stream = stream;
    session.recorder = recorder;
    session.mimeType = supportedMimeType ?? recorder.mimeType ?? "";
    recorder.ondataavailable = (event) => {
      if (this.isCurrent(session) && !session.cancelled && event.data.size > 0) {
        session.chunks.push(event.data);
      }
    };
    recorder.onerror = () => {
      if (!this.isCurrent(session)) return;
      this.failRecorder(session, "microphoneRecordingError");
    };
    recorder.onstop = () => {
      this.finishRecorder(session, recorder);
    };

    try {
      recorder.start(250);
      if (this.isCurrent(session)) this.setStatus("listening");
    } catch {
      this.failRecorder(session, "microphoneStartError");
    }
  }

  private failRecorder(session: VoiceSession, key: VoiceMessageKey): void {
    if (!this.isCurrent(session)) return;
    stopTracks(session.stream);
    session.stream = null;
    session.recorder = null;
    session.chunks = [];
    this.finishSession(session);
    this.reportError(key);
  }

  private finishRecorder(session: VoiceSession, recorder: MediaRecorderLike): void {
    stopTracks(session.stream);
    session.stream = null;
    if (!this.isCurrent(session) || session.cancelled || this.disposed) return;

    session.recorder = null;
    const mimeType = session.mimeType || recorder.mimeType || "audio/webm";
    const blob = new Blob(session.chunks, { type: mimeType });
    session.chunks = [];
    if (!blob.size) {
      this.finishSession(session);
      this.reportError("microphoneNoAudio");
      return;
    }

    this.setStatus("transcribing");
    void this.transcribeRecorderBlob(session, blob, mimeType);
  }

  private async transcribeRecorderBlob(
    session: VoiceSession,
    blob: Blob,
    mimeType: string,
  ): Promise<void> {
    const fetcher = this.options.fetch ?? fetch;
    const abortController = new AbortController();
    session.transcriptionAbort = abortController;
    const form = new FormData();
    form.append("audio", blob, audioFilenameForMimeType(mimeType));
    form.append("locale", this.options.locale === "es" ? "es" : "pt-BR");

    try {
      const response = await fetcher("/api/agent/transcribe", {
        method: "POST",
        credentials: "same-origin",
        body: form,
        signal: abortController.signal,
      });
      let payload: { text?: unknown } = {};
      try {
        payload = await response.json() as { text?: unknown };
      } catch {
        // Treat a non-JSON response as a transcription failure below.
      }
      // Cancellation can happen while the server is still responding. Do
      // not let a stale response report an error or affect a newer session.
      if (!this.isCurrent(session)) return;
      if (!response.ok) {
        this.finishSession(session);
        this.reportError(response.status === 422 ? "microphoneNoSpeech" : "microphoneTranscriptionError");
        return;
      }
      const text = typeof payload.text === "string" ? payload.text.trim() : "";
      if (!text) {
        this.finishSession(session);
        this.reportError("microphoneNoSpeech");
        return;
      }
      if (!this.isCurrent(session)) return;
      this.options.onText?.(text);
      this.finishSession(session);
    } catch {
      if (!this.isCurrent(session) || session.cancelled || this.disposed) return;
      this.finishSession(session);
      this.reportError("microphoneTranscriptionError");
    }
  }

  private finishSpeech(session: VoiceSession, commit: boolean): void {
    if (!this.isCurrent(session)) return;
    this.clearSpeechTimers(session);
    const text = session.finalText.trim();
    const recognition = session.recognition;
    if (recognition) {
      recognition.onresult = null;
      recognition.onerror = null;
      recognition.onend = null;
      if (!session.recognitionEnded) {
        try {
          recognition.stop();
        } catch {
          // Recognition may already be stopping/ended; callbacks are
          // detached above so this cannot produce a stale result.
        }
      }
    }
    this.session = null;
    session.recognition = null;
    this.emitInterim("");
    this.setStatus("idle");
    if (commit && text) this.options.onText?.(text);
  }

  private finishSession(session: VoiceSession): void {
    if (!this.isCurrent(session)) return;
    this.clearSpeechTimers(session);
    if (session.transcriptionAbort) {
      session.transcriptionAbort.abort();
      session.transcriptionAbort = null;
    }
    this.session = null;
    stopTracks(session.stream);
    session.stream = null;
    session.recorder = null;
    session.recognition = null;
    session.chunks = [];
    this.emitInterim("");
    this.setStatus("idle");
  }

  private cancelSession(session: VoiceSession, notify = true): void {
    if (this.session !== session) return;
    session.cancelled = true;
    session.stopRequested = true;
    this.clearSpeechTimers(session);
    session.transcriptionAbort?.abort();
    session.transcriptionAbort = null;

    const recognition = session.recognition;
    const recorder = session.recorder;
    if (recognition) {
      recognition.onresult = null;
      recognition.onerror = null;
      recognition.onend = null;
      try {
        recognition.stop();
      } catch {
        // The recognition service can already have ended.
      }
    }
    if (recorder) {
      recorder.ondataavailable = null;
      recorder.onerror = null;
      recorder.onstop = null;
      if (recorder.state === "recording") {
        try {
          recorder.stop();
        } catch {
          // Tracks are still stopped below.
        }
      }
    }
    stopTracks(session.stream);
    session.stream = null;
    session.recognition = null;
    session.recorder = null;
    session.chunks = [];
    this.session = null;
    if (notify && !this.disposed) {
      this.emitInterim("");
      this.setStatus("idle");
    } else {
      this.status = "idle";
    }
  }

  private clearSpeechTimers(session: VoiceSession): void {
    if (session.restartTimer) clearTimeout(session.restartTimer);
    if (session.stopFallbackTimer) clearTimeout(session.stopFallbackTimer);
    session.restartTimer = null;
    session.stopFallbackTimer = null;
  }

  private isCurrent(session: VoiceSession): boolean {
    return !this.disposed && this.session === session && !session.cancelled;
  }

  private setStatus(status: JoiaVoiceStatus): void {
    this.status = status;
    if (!this.disposed) this.options.onStatusChange?.(status);
  }

  private emitInterim(text: string): void {
    if (!this.disposed) this.options.onInterimText?.(text);
  }

  private reportError(key: VoiceMessageKey): void {
    if (!this.disposed) this.options.onError?.(key);
  }

  private mediaPermissionErrorKey(error: unknown): VoiceMessageKey {
    switch (errorName(error)) {
      case "NotAllowedError":
      case "SecurityError":
        return "microphonePermissionDenied";
      case "NotFoundError":
      case "OverconstrainedError":
        return "microphoneDeviceUnavailable";
      default:
        return "microphoneStartError";
    }
  }

  private speechErrorKey(error: string | undefined): VoiceMessageKey {
    switch (error) {
      case "not-allowed":
      case "service-not-allowed":
        return "microphonePermissionDenied";
      case "audio-capture":
        return "microphoneDeviceUnavailable";
      case "no-speech":
        return "microphoneNoSpeech";
      default:
        return "microphoneStartError";
    }
  }
}

export interface UseJoiaVoiceOptions {
  locale: string;
  getMessage: (key: VoiceMessageKey) => string;
  onText: (text: string) => void;
}

export function useJoiaVoice(options: UseJoiaVoiceOptions) {
  const [status, setStatus] = useState<JoiaVoiceStatus>("idle");
  const [interimText, setInterimText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const controllerRef = useRef<JoiaVoiceController | null>(null);

  if (!controllerRef.current) {
    controllerRef.current = new JoiaVoiceController({
      locale: options.locale,
      getMessage: options.getMessage,
      onStatusChange: setStatus,
      onInterimText: setInterimText,
      onText: options.onText,
      onError: (key) => setError(options.getMessage(key)),
    });
  }
  const controller = controllerRef.current;
  controller.update({
    locale: options.locale,
    getMessage: options.getMessage,
    onText: options.onText,
    onError: (key) => setError(options.getMessage(key)),
  });

  useEffect(() => () => {
    // React StrictMode intentionally runs effect cleanup before its second
    // setup. Cancel the active session without disabling this reusable
    // controller; a real unmount is also safe because stale callbacks fail
    // the session identity check.
    controller.cancel({ notify: false });
  }, [controller]);

  const start = useCallback(() => {
    setError(null);
    controller.start();
  }, [controller]);
  const stop = useCallback(() => controller.stop({ commit: true }), [controller]);
  const cancel = useCallback(() => controller.cancel(), [controller]);

  return {
    isListening: status === "requesting" || status === "listening" || status === "stopping",
    isTranscribing: status === "transcribing",
    interimText,
    micError: error,
    start,
    stop,
    cancel,
  };
}