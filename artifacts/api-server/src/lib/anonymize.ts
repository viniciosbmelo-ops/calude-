const PREPOSITIONS = new Set(["de", "da", "do", "dos", "das", "e", "em", "di", "della"]);

/**
 * Converts a full patient name to initials only (LGPD — admin context).
 * "Djane Cavalcanti da Silva" → "D.C.S."
 * Prepositions (de, da, do, dos, das, e) are skipped.
 */
export function toInitials(name: string | null | undefined): string {
  if (!name) return "—";
  return name
    .trim()
    .split(/\s+/)
    .filter(w => w.length > 0 && !PREPOSITIONS.has(w.toLowerCase()))
    .map(w => w[0]!.toUpperCase() + ".")
    .join("");
}
