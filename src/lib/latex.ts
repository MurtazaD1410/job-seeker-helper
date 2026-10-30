import { diffWordsWithSpace } from "diff";

const SPECIAL: Record<string, string> = {
  "\\": "\\textbackslash{}",
  "&": "\\&",
  "%": "\\%",
  $: "\\$",
  "#": "\\#",
  _: "\\_",
  "{": "\\{",
  "}": "\\}",
  "~": "\\textasciitilde{}",
  "^": "\\textasciicircum{}"
};

/** Escapes plain text so it is safe to put into LaTeX body text. */
export function escapeLatex(text: string): string {
  return text.replace(/[\\&%$#_{}~^]/g, (c) => SPECIAL[c]);
}

// --- Locating a snippet in the resume ---------------------------------------------------------

export type Located =
  | { kind: "exact" | "fuzzy"; start: number; end: number }
  | { kind: "ambiguous"; count: number }
  | { kind: "none" };

/** Indices of every (possibly overlapping) occurrence of `needle`. */
function indicesOf(haystack: string, needle: string): number[] {
  const out: number[] = [];
  if (!needle) return out;
  for (let i = haystack.indexOf(needle); i !== -1; i = haystack.indexOf(needle, i + 1)) out.push(i);
  return out;
}

/** Collapses whitespace runs to one space; `map[i]` is the index in `text` of normalised char `i`. */
function normalizeWithMap(text: string): { norm: string; map: number[] } {
  let norm = "";
  const map: number[] = [];
  let inSpace = false;
  for (let i = 0; i < text.length; i++) {
    if (/\s/.test(text[i])) {
      if (!inSpace) {
        norm += " ";
        map.push(i);
      }
      inSpace = true;
    } else {
      norm += text[i];
      map.push(i);
      inSpace = false;
    }
  }
  return { norm, map };
}

/**
 * Finds `original` in `resume`. An exact, unique match wins. If there is none, retries ignoring
 * differences in whitespace (line breaks, indentation) and reports it as "fuzzy". Several matches
 * are "ambiguous" and never guessed at. start/end always refer to the real resume text.
 */
export function locate(resume: string, original: string): Located {
  if (!original.trim()) return { kind: "none" };

  const exact = indicesOf(resume, original);
  if (exact.length === 1) return { kind: "exact", start: exact[0], end: exact[0] + original.length };
  if (exact.length > 1) return { kind: "ambiguous", count: exact.length };

  const needle = normalizeWithMap(original).norm.trim();
  if (!needle) return { kind: "none" };
  const { norm, map } = normalizeWithMap(resume);
  const hits = indicesOf(norm, needle);
  if (hits.length === 0) return { kind: "none" };
  if (hits.length > 1) return { kind: "ambiguous", count: hits.length };
  return { kind: "fuzzy", start: map[hits[0]], end: map[hits[0] + needle.length - 1] + 1 };
}

// --- Sanity-checking replacement LaTeX --------------------------------------------------------

interface Stats {
  braceNet: number;
  braceMin: number;
  dollars: number;
  percents: number;
  ampersands: number;
  hashes: number;
  underscores: number;
  envs: Map<string, number>; // \begin{x} minus \end{x}
}

function stats(text: string): Stats {
  const s: Stats = { braceNet: 0, braceMin: 0, dollars: 0, percents: 0, ampersands: 0, hashes: 0, underscores: 0, envs: new Map() };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "\\") {
      const env = /^\\(begin|end)\{([^}]*)\}/.exec(text.slice(i));
      if (env) s.envs.set(env[2], (s.envs.get(env[2]) ?? 0) + (env[1] === "begin" ? 1 : -1));
      i++; // skip the escaped character (\& \% \\ ...) or the first letter of a command
      continue;
    }
    if (c === "{") s.braceNet++;
    else if (c === "}") {
      s.braceNet--;
      s.braceMin = Math.min(s.braceMin, s.braceNet);
    } else if (c === "$") s.dollars++;
    else if (c === "%") s.percents++;
    else if (c === "&") s.ampersands++;
    else if (c === "#") s.hashes++;
    else if (c === "_") s.underscores++;
  }
  return s;
}

/**
 * Checks that `replacement` does not make the document worse than `original`: same brace balance,
 * same environments, and no additional unescaped special characters. Returns a problem
 * description, or null if it looks fine. Heuristic, not a LaTeX parser.
 */
export function checkReplacement(original: string, replacement: string): string | null {
  if (!replacement.trim()) return "replacement is empty";
  const o = stats(original);
  const r = stats(replacement);
  if (r.braceNet !== o.braceNet || r.braceMin < o.braceMin) return "unbalanced braces";
  if (r.dollars % 2 !== o.dollars % 2) return "unbalanced $";
  if (r.percents > o.percents) return "unescaped % (would comment out the rest of the line)";
  if (r.ampersands > o.ampersands) return "unescaped &";
  if (r.hashes > o.hashes) return "unescaped #";
  if (r.underscores > o.underscores) return "unescaped _";
  const envs = new Set([...o.envs.keys(), ...r.envs.keys()]);
  for (const e of envs) if ((r.envs.get(e) ?? 0) !== (o.envs.get(e) ?? 0)) return `mismatched \\begin/\\end{${e}}`;
  return null;
}

/** Number-like tokens in `text` (e.g. "40%", "3,5", "2021"), trailing punctuation removed. */
export function numberTokens(text: string): string[] {
  return (text.match(/\d[\d.,]*%?/g) ?? []).map((t) => t.replace(/[.,]+$/, ""));
}

// --- Diffing ----------------------------------------------------------------------------------

export interface DiffPart {
  value: string;
  added?: boolean;
  removed?: boolean;
}

/** Word-level diff between an original snippet and its replacement (whitespace-preserving). */
export function diffSnippet(original: string, replacement: string): DiffPart[] {
  return diffWordsWithSpace(original, replacement).map(({ value, added, removed }) => ({ value, added, removed }));
}

/** Number of "double backslash" line breaks in a LaTeX snippet. */
export const countLineBreaks = (s: string): number => (s.match(/\\\\/g) ?? []).length;
