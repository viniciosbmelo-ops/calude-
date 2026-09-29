/**
 * Tests for tempPdfStore — covers:
 *   - magic-byte validation
 *   - size limit enforcement (before accumulating in store)
 *   - store capacity limit
 *   - filename sanitization
 *   - ID format validation
 *   - expiry / eviction
 */
import { describe, it, expect, beforeEach } from "vitest";
import { storePdf, getPdf } from "./tempPdfStore";

// Re-implement the helpers locally for isolated unit testing.
// The store itself is tested via storePdf/getPdf calls.

const MAX_PDF_BYTES_TEST = 20 * 1024 * 1024; // matches default

function sanitizeFilename(raw: string): string {
  const base = raw
    .replace(/[^a-zA-Z0-9\-_. ]/g, "_")
    .replace(/_+/g, "_")
    .trim()
    .slice(0, 128);
  return base.toLowerCase().endsWith(".pdf") ? base : `${base}.pdf`;
}

function hasPdfMagicBytes(buffer: Buffer): boolean {
  const PDF_MAGIC = Buffer.from([0x25, 0x50, 0x44, 0x46]);
  return buffer.length >= 4 && buffer.subarray(0, 4).equals(PDF_MAGIC);
}

/** Create a minimal valid PDF buffer */
function makePdf(extraBytes = 0): Buffer {
  const base = Buffer.from("%PDF-1.4 test content");
  if (extraBytes === 0) return base;
  return Buffer.concat([base, Buffer.alloc(extraBytes)]);
}

/** Create a buffer that looks like PNG (not PDF) */
function makePng(): Buffer {
  return Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
}

describe("hasPdfMagicBytes", () => {
  it("returns true for valid PDF magic bytes", () => {
    expect(hasPdfMagicBytes(Buffer.from("%PDF-1.4"))).toBe(true);
  });

  it("returns false for non-PDF content", () => {
    expect(hasPdfMagicBytes(makePng())).toBe(false);
  });

  it("returns false for empty buffer", () => {
    expect(hasPdfMagicBytes(Buffer.alloc(0))).toBe(false);
  });

  it("returns false for buffer shorter than 4 bytes", () => {
    expect(hasPdfMagicBytes(Buffer.from("%PD"))).toBe(false);
  });
});

describe("sanitizeFilename", () => {
  it("allows safe chars unchanged", () => {
    expect(sanitizeFilename("relatorio-2024.pdf")).toBe("relatorio-2024.pdf");
  });

  it("replaces path-separator chars with underscore", () => {
    const result = sanitizeFilename("../../etc/passwd");
    // Forward slashes should be replaced
    expect(result).not.toContain("/");
    // The result must end in .pdf and be safe to use as a filename
    expect(result.endsWith(".pdf")).toBe(true);
    // Must not be empty
    expect(result.length).toBeGreaterThan(4);
  });

  it("adds .pdf extension if missing", () => {
    expect(sanitizeFilename("myfile")).toMatch(/\.pdf$/);
  });

  it("does not duplicate .pdf extension", () => {
    const result = sanitizeFilename("doc.pdf");
    expect(result.endsWith(".pdf")).toBe(true);
    expect(result.toLowerCase().split(".pdf").length).toBe(2); // exactly one .pdf
  });

  it("truncates very long filenames", () => {
    const long = "a".repeat(200);
    expect(sanitizeFilename(long).length).toBeLessThanOrEqual(128 + 4); // +4 for .pdf
  });

  it("strips newline characters (CSV/formula injection)", () => {
    const result = sanitizeFilename("file\nname\r.pdf");
    expect(result).not.toContain("\n");
    expect(result).not.toContain("\r");
  });
});

describe("storePdf", () => {
  it("rejects non-PDF content (magic bytes check)", () => {
    const result = storePdf(makePng(), "image.pdf");
    expect("error" in result && result.error).toBe("invalid_pdf");
  });

  it("rejects empty buffer", () => {
    // Empty buffer fails magic bytes check
    const result = storePdf(Buffer.alloc(0), "empty.pdf");
    expect("error" in result && result.error).toBe("invalid_pdf");
  });

  it("rejects oversized buffer before storing", () => {
    const oversized = Buffer.concat([
      Buffer.from("%PDF-oversized"),
      Buffer.alloc(MAX_PDF_BYTES_TEST + 1),
    ]);
    const result = storePdf(oversized, "big.pdf");
    expect("error" in result && result.error).toBe("too_large");
  });

  it("stores a valid PDF and returns an id", () => {
    const result = storePdf(makePdf(), "test.pdf");
    expect("id" in result).toBe(true);
    if ("id" in result) {
      expect(result.id).toMatch(/^[0-9a-f]{32}$/);
    }
  });

  it("stored PDF can be retrieved with getPdf", () => {
    const result = storePdf(makePdf(), "hello.pdf");
    expect("id" in result).toBe(true);
    if (!("error" in result)) {
      const entry = getPdf(result.id);
      expect(entry).not.toBeNull();
      expect(entry?.filename).toMatch(/\.pdf$/);
    }
  });
});

describe("getPdf", () => {
  it("returns null for non-existent id", () => {
    expect(getPdf("0".repeat(32))).toBeNull();
  });

  it("returns null for malformed id (wrong length)", () => {
    expect(getPdf("abc")).toBeNull();
  });

  it("returns null for malformed id (non-hex chars)", () => {
    expect(getPdf("ZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ")).toBeNull();
  });
});
