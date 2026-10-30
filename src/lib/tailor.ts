import { checkReplacement, locate } from "./latex";
import type { Suggestion } from "./schema";

export interface TailorResult {
  /** The master resume with every applicable suggestion applied. */
  latex: string;
  applied: Suggestion[];
  failed: { suggestion: Suggestion; reason: string }[];
  /** Set if the combined result looks structurally broken (should not happen if each edit is valid). */
  problem: string | null;
}

/**
 * Builds the tailored resume locally: each suggestion's `original` must still match the master
 * resume exactly once, and suggestions may not overlap. Offsets are applied back to front, so they
 * stay valid. The master text itself is never modified.
 */
export function tailorResume(master: string, suggestions: Suggestion[]): TailorResult {
  const placed: { s: Suggestion; start: number; end: number }[] = [];
  const failed: TailorResult["failed"] = [];

  for (const s of suggestions) {
    const loc = locate(master, s.original);
    if (loc.kind !== "exact") {
      const reason = loc.kind === "ambiguous" ? "its original text now appears more than once" : "its original text no longer matches your master resume";
      failed.push({ suggestion: s, reason });
    } else if (placed.some((p) => loc.start < p.end && p.start < loc.end)) {
      failed.push({ suggestion: s, reason: "it overlaps another suggestion" });
    } else {
      placed.push({ s, start: loc.start, end: loc.end });
    }
  }

  let latex = master;
  for (const p of [...placed].sort((a, b) => b.start - a.start)) {
    latex = latex.slice(0, p.start) + p.s.replacement + latex.slice(p.end);
  }

  return {
    latex,
    applied: placed.sort((a, b) => a.start - b.start).map((p) => p.s),
    failed,
    problem: placed.length ? checkReplacement(master, latex) : null
  };
}
