import { describe, expect, it } from "vitest";
import {
  transcriptionErrorMessage,
  transcriptionFileExtension,
  transcriptionLocale,
} from "./audio-format";

describe("JoIA transcription audio contract", () => {
  it("maps browser MIME values to OpenAI-compatible extensions", () => {
    expect(transcriptionFileExtension("audio/mp4;codecs=mp4a.40.2")).toBe("m4a");
    expect(transcriptionFileExtension("audio/webm;codecs=opus")).toBe("webm");
    expect(transcriptionFileExtension("audio/mpeg")).toBe("mp3");
    expect(transcriptionFileExtension("video/webm")).toBeNull();
  });

  it("normalizes locale and localizes route errors", () => {
    expect(transcriptionLocale("es")).toBe("es");
    expect(transcriptionLocale("pt-BR")).toBe("pt-BR");
    expect(transcriptionErrorMessage("es", "unsupported")).toContain("compatible");
    expect(transcriptionErrorMessage("pt-BR", "empty")).toContain("fala");
  });
});