import { describe, expect, it, vi } from "vitest";
import {
  AssistantVoiceController,
  type MediaRecorderLike,
  type SpeechRecognitionLike,
  audioFilenameForMimeType,
  getSupportedAudioMimeType,
} from "../components/ai-assistant/voice-controller";

function fakeStream() {
  const tracks = [{ stop: vi.fn() }];
  return {
    stream: {
      getTracks: () => tracks,
    } as unknown as MediaStream,
    tracks,
  };
}

function controllerOptions(overrides: Partial<ConstructorParameters<typeof AssistantVoiceController>[0]> = {}) {
  return {
    locale: "pt-BR",
    getMessage: (key: string) => key,
    onStatusChange: vi.fn(),
    onInterimText: vi.fn(),
    onText: vi.fn(),
    onError: vi.fn(),
    ...overrides,
  };
}

class FakeSpeechRecognition implements SpeechRecognitionLike {
  static instance: FakeSpeechRecognition | null = null;
  lang = "";
  continuous = false;
  interimResults = false;
  maxAlternatives = 0;
  onresult: SpeechRecognitionLike["onresult"] = null;
  onerror: SpeechRecognitionLike["onerror"] = null;
  onend: SpeechRecognitionLike["onend"] = null;
  start = vi.fn();
  stop = vi.fn();

  constructor() {
    FakeSpeechRecognition.instance = this;
  }
}

class FakeMediaRecorder implements MediaRecorderLike {
  static instance: FakeMediaRecorder | null = null;
  static isTypeSupported = vi.fn((mimeType: string) => mimeType === "audio/mp4");
  mimeType = "audio/mp4";
  state = "inactive";
  ondataavailable: MediaRecorderLike["ondataavailable"] = null;
  onerror: MediaRecorderLike["onerror"] = null;
  onstop: MediaRecorderLike["onstop"] = null;
  start = vi.fn(() => {
    this.state = "recording";
  });
  stop = vi.fn(() => {
    this.state = "inactive";
    this.onstop?.();
  });

  constructor() {
    FakeMediaRecorder.instance = this;
  }
}

describe("AI assistant voice lifecycle", () => {
  it("commits one final speech result that arrives after stop", () => {
    const options = controllerOptions({
      speechRecognition: FakeSpeechRecognition,
      appleMobile: false,
    });
    const controller = new AssistantVoiceController(options);
    controller.start();
    const recognition = FakeSpeechRecognition.instance!;

    recognition.onresult?.({
      resultIndex: 0,
      results: [{ isFinal: false, 0: { transcript: "pergunta" } }],
    });
    controller.stop();
    // WebKit can deliver the final result between stop() and onend.
    recognition.onresult?.({
      resultIndex: 0,
      results: [{ isFinal: true, 0: { transcript: "pergunta final" } }],
    });
    recognition.onend?.();
    recognition.onresult?.({
      resultIndex: 0,
      results: [{ isFinal: true, 0: { transcript: "pergunta final" } }],
    });

    expect(options.onText).toHaveBeenCalledTimes(1);
    expect(options.onText).toHaveBeenCalledWith("pergunta final");
    expect(controller.getStatus()).toBe("idle");
  });

  it("does not commit a speech event that arrives after close cancellation", () => {
    const options = controllerOptions({
      speechRecognition: FakeSpeechRecognition,
      appleMobile: false,
    });
    const controller = new AssistantVoiceController(options);
    controller.start();
    const recognition = FakeSpeechRecognition.instance!;
    const lateResult = recognition.onresult!;
    controller.cancel();
    lateResult({
      resultIndex: 0,
      results: [{ isFinal: true, 0: { transcript: "texto tardio" } }],
    });

    expect(options.onText).not.toHaveBeenCalled();
    expect(controller.getStatus()).toBe("idle");
  });

  it("can be started again after lifecycle cleanup cancellation", () => {
    const options = controllerOptions({
      speechRecognition: FakeSpeechRecognition,
      appleMobile: false,
    });
    const controller = new AssistantVoiceController(options);
    controller.start();
    const firstRecognition = FakeSpeechRecognition.instance!;
    controller.cancel({ notify: false });
    expect(controller.getStatus()).toBe("idle");

    controller.start();
    const secondRecognition = FakeSpeechRecognition.instance!;
    expect(secondRecognition).not.toBe(firstRecognition);
    expect(secondRecognition.start).toHaveBeenCalledTimes(1);
    expect(firstRecognition.stop).toHaveBeenCalledTimes(1);
    controller.cancel({ notify: false });
  });

  it("bounds unexpected desktop recognition restarts", () => {
    vi.useFakeTimers();
    try {
      const options = controllerOptions({
        speechRecognition: FakeSpeechRecognition,
        appleMobile: false,
      });
      const controller = new AssistantVoiceController(options);
      controller.start();
      const recognition = FakeSpeechRecognition.instance!;

      for (let attempt = 0; attempt < 4; attempt += 1) {
        recognition.onend?.();
        vi.advanceTimersByTime(80);
      }

      expect(recognition.start).toHaveBeenCalledTimes(4);
      expect(options.onError).toHaveBeenCalledWith("microphoneStartError");
      expect(controller.getStatus()).toBe("idle");
    } finally {
      vi.useRealTimers();
    }
  });

  it("cancels a pending permission request and stops its late stream", async () => {
    const permission = {} as {
      resolve?: (stream: MediaStream) => void;
    };
    const options = controllerOptions({
      appleMobile: true,
      mediaRecorder: FakeMediaRecorder,
      getUserMedia: () => new Promise<MediaStream>(resolve => {
        permission.resolve = resolve;
      }),
    });
    const controller = new AssistantVoiceController(options);
    controller.start();
    controller.cancel();

    const lateStream = fakeStream();
    permission.resolve!(lateStream.stream);
    await Promise.resolve();

    expect(lateStream.tracks[0]!.stop).toHaveBeenCalledTimes(1);
    expect(FakeMediaRecorder.instance).toBeNull();
    expect(options.onText).not.toHaveBeenCalled();
    expect(controller.getStatus()).toBe("idle");
  });

  it("stops tracks, posts the selected MIME with its extension, and commits transcription", async () => {
    const stream = fakeStream();
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = init?.body as FormData;
      const audio = body.get("audio") as Blob & { name?: string };
      expect(audio.type).toBe("audio/mp4");
      expect(audio.name).toBe("assistente-audio.m4a");
      expect(body.get("locale")).toBe("pt-BR");
      return new Response(JSON.stringify({ text: "texto transcrito" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    const options = controllerOptions({
      locale: "pt-BR",
      appleMobile: true,
      mediaRecorder: FakeMediaRecorder,
      getUserMedia: async () => stream.stream,
      fetch: fetcher,
    });
    const controller = new AssistantVoiceController(options);
    controller.start();
    await Promise.resolve();
    await Promise.resolve();
    const recorder = FakeMediaRecorder.instance!;
    recorder.ondataavailable?.({
      data: new Blob(["audio bytes"], { type: "audio/mp4" }),
    });
    controller.stop();
    await Promise.resolve();
    await Promise.resolve();
    await new Promise<void>(resolve => setTimeout(resolve, 0));

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(stream.tracks[0]!.stop).toHaveBeenCalledTimes(1);
    expect(options.onText).toHaveBeenCalledWith("texto transcrito");
  });

  it("ignores cancelled non-OK and empty transcription responses", async () => {
    for (const response of [
      new Response(JSON.stringify({ error: "failed" }), { status: 502 }),
      new Response(JSON.stringify({}), { status: 200 }),
    ]) {
      const stream = fakeStream();
      let resolveResponse: ((value: Response) => void) | undefined;
      const fetcher = vi.fn(() => new Promise<Response>(resolve => {
        resolveResponse = resolve;
      }));
      const options = controllerOptions({
        appleMobile: true,
        mediaRecorder: FakeMediaRecorder,
        getUserMedia: async () => stream.stream,
        fetch: fetcher,
      });
      const controller = new AssistantVoiceController(options);
      controller.start();
      await Promise.resolve();
      await Promise.resolve();
      const recorder = FakeMediaRecorder.instance!;
      recorder.ondataavailable?.({
        data: new Blob(["audio bytes"], { type: "audio/mp4" }),
      });
      controller.stop();
      expect(fetcher).toHaveBeenCalledTimes(1);
      controller.cancel();
      resolveResponse!(response);
      await Promise.resolve();
      await Promise.resolve();
      await new Promise<void>(resolve => setTimeout(resolve, 0));

      expect(options.onError).not.toHaveBeenCalled();
      expect(options.onText).not.toHaveBeenCalled();
    }
  });

  it("does not upload an empty recording and reports a recording-specific error", async () => {
    const stream = fakeStream();
    const fetcher = vi.fn();
    const options = controllerOptions({
      appleMobile: true,
      mediaRecorder: FakeMediaRecorder,
      getUserMedia: async () => stream.stream,
      fetch: fetcher,
    });
    const controller = new AssistantVoiceController(options);
    controller.start();
    await Promise.resolve();
    await Promise.resolve();
    controller.stop();
    await Promise.resolve();

    expect(fetcher).not.toHaveBeenCalled();
    expect(options.onError).toHaveBeenCalledWith("microphoneNoAudio");
    expect(stream.tracks[0]!.stop).toHaveBeenCalledTimes(1);
  });

  it("distinguishes denied permission from a missing microphone", async () => {
    const deniedOptions = controllerOptions({
      appleMobile: true,
      mediaRecorder: FakeMediaRecorder,
      getUserMedia: async () => {
        throw Object.assign(new Error("denied"), { name: "NotAllowedError" });
      },
    });
    const denied = new AssistantVoiceController(deniedOptions);
    denied.start();
    await Promise.resolve();
    expect(deniedOptions.onError).toHaveBeenCalledWith("microphonePermissionDenied");

    const missingOptions = controllerOptions({
      appleMobile: true,
      mediaRecorder: FakeMediaRecorder,
      getUserMedia: async () => {
        throw Object.assign(new Error("missing"), { name: "NotFoundError" });
      },
    });
    const missing = new AssistantVoiceController(missingOptions);
    missing.start();
    await Promise.resolve();
    expect(missingOptions.onError).toHaveBeenCalledWith("microphoneDeviceUnavailable");
  });

  it("stops physical recognition capture after an error and detaches late events", () => {
    const options = controllerOptions({
      speechRecognition: FakeSpeechRecognition,
      appleMobile: false,
    });
    const controller = new AssistantVoiceController(options);
    controller.start();
    const recognition = FakeSpeechRecognition.instance!;
    const lateResult = recognition.onresult!;

    recognition.onerror?.({ error: "network" });
    lateResult({
      resultIndex: 0,
      results: [{ isFinal: true, 0: { transcript: "late" } }],
    });

    expect(recognition.stop).toHaveBeenCalledTimes(1);
    expect(options.onError).toHaveBeenCalledWith("microphoneStartError");
    expect(options.onText).not.toHaveBeenCalled();
    expect(controller.getStatus()).toBe("idle");
  });

  it("uses the stop fallback to end recognition that never emits onend", () => {
    vi.useFakeTimers();
    try {
      const options = controllerOptions({
        speechRecognition: FakeSpeechRecognition,
        appleMobile: false,
      });
      const controller = new AssistantVoiceController(options);
      controller.start();
      const recognition = FakeSpeechRecognition.instance!;
      controller.stop();
      vi.advanceTimersByTime(1_000);

      expect(recognition.stop).toHaveBeenCalledTimes(2);
      expect(controller.getStatus()).toBe("idle");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("AI assistant audio format contract", () => {
  it("prefers a supported Safari MIME and derives the backend filename", () => {
    expect(getSupportedAudioMimeType(FakeMediaRecorder)).toBe("audio/mp4");
    expect(audioFilenameForMimeType("audio/mp4;codecs=mp4a.40.2")).toBe("assistente-audio.m4a");
    expect(audioFilenameForMimeType("audio/webm;codecs=opus")).toBe("assistente-audio.webm");
  });
});