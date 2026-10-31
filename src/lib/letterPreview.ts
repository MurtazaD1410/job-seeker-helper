// A readable, editable view of a LaTeX cover letter.
//
// The letter is handled line by line. A line is "prose" (editable) only when turning it into plain text and
// back gives exactly the same LaTeX; everything else (header boxes, \vspace, \today, \begin{...}) is layout,
// shown read-only and never rewritten. Editing one line changes that line only, and its trailing \par or \\
// and its indentation are kept, so the rest of the document stays byte for byte the same.

export type PreviewLine =
  | { kind: "text"; index: number; text: string }
  | { kind: "fixed"; index: number; text: string }
  | { kind: "gap" };

const NBSP = " ";

const ESCAPES: Record<string, string> = {
  "&": "\\&",
  "%": "\\%",
  _: "\\_",
  "#": "\\#",
  $: "\\$",
  "{": "\\{",
  "}": "\\}",
  "\\": "\\textbackslash{}",
  "^": "\\^{}",
  "~": "\\textasciitilde{}",
  [NBSP]: "~"
};

/** Plain text (with **bold** and *italic*) to LaTeX. */
export function toLatex(display: string): string {
  const escaped = display.replace(/\s*\n\s*/g, " ").replace(/[&%_#${}\\^~ ]/g, (c) => ESCAPES[c]);
  return escaped.replace(/\*\*([^*]+?)\*\*/g, "\\textbf{$1}").replace(/\*([^*]+?)\*/g, "\\textit{$1}");
}

/** LaTeX prose to plain text. The inverse of toLatex for the cases it handles. */
export function toDisplay(latex: string): string {
  return latex
    .replace(/\\textbf\{([^{}]*)\}/g, "**$1**")
    .replace(/\\(?:textit|emph)\{([^{}]*)\}/g, "*$1*")
    .replace(/~/g, NBSP)
    .replace(/\\textbackslash\{\}/g, "\\")
    .replace(/\\textasciitilde\{\}/g, "~")
    .replace(/\\\^\{\}/g, "^")
    .replace(/\\([&%_#$])/g, "$1")
    .replace(/\\\{/g, "{")
    .replace(/\\\}/g, "}");
}

// indentation (and a list bullet), the text, trailing \par / \\ markers, trailing whitespace
const LINE = /^(\s*(?:\\item\s+)?)(.*?)((?:\s*(?:\\par\b|\\\\(?:\[[^\]]*\])?))*)(\s*)$/;
const HAS_COMMENT = /(^|[^\\])%/;

interface Parts {
  lead: string;
  content: string;
  tail: string;
  ws: string;
}

/** Splits a line into its parts when it is plain prose, otherwise null. */
function proseParts(raw: string): Parts | null {
  if (HAS_COMMENT.test(raw)) return null;
  const m = LINE.exec(raw);
  if (!m) return null;
  const [, lead, content, tail, ws] = m;
  if (!/[\p{L}\p{N}]/u.test(content)) return null;
  // The guarantee: showing it as plain text and writing it back must reproduce the original exactly.
  if (toLatex(toDisplay(content)) !== content) return null;
  return { lead, content, tail, ws };
}

const DROP_WITH_ARGS =
  /\\(?:vspace|hspace|setlength|addtolength|definecolor|color|pagestyle|thispagestyle|usepackage|fontsize|rule)\*?(?:\[[^\]]*\])?(?:\{[^{}]*\})*/g;

/** Best-effort text of a layout line, for showing it read-only. */
function visibleText(raw: string): string {
  return raw
    .replace(/(^|[^\\])%.*$/, "$1")
    .replace(/\\(?:begin|end)\{[^{}]*\}(?:\[[^\]]*\])?(?:\{[^{}]*\})?/g, " ")
    .replace(DROP_WITH_ARGS, " ")
    .replace(/\\href\{[^{}]*\}\{([^{}]*)\}/g, "$1")
    .replace(/\\today\b/g, "(today's date)")
    .replace(/\\\\(?:\[[^\]]*\])?/g, " ")
    .replace(/\\([&%_#$])/g, "$1")
    .replace(/\\[a-zA-Z@]+\*?/g, " ")
    .replace(/https?:\/\/\S+|mailto:\S+/g, " ")
    .replace(/[{}]/g, " ")
    .replace(/~/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function bodyRange(lines: string[]): [number, number] | null {
  const start = lines.findIndex((l) => l.includes("\\begin{document}"));
  if (start === -1) return null;
  let end = lines.length;
  for (let i = lines.length - 1; i > start; i--) {
    if (lines[i].includes("\\end{document}")) {
      end = i;
      break;
    }
  }
  return [start + 1, end];
}

/** The letter as a list of lines for display. Empty if there is no document body. */
export function parseLetter(latex: string): PreviewLine[] {
  const lines = latex.split("\n");
  const range = bodyRange(lines);
  if (!range) return [];
  const out: PreviewLine[] = [];
  const gap = () => {
    if (out.length && out[out.length - 1].kind !== "gap") out.push({ kind: "gap" });
  };
  for (let i = range[0]; i < range[1]; i++) {
    const raw = lines[i];
    if (!raw.trim() || /^\s*%/.test(raw)) {
      if (!raw.trim()) gap();
      continue;
    }
    const prose = proseParts(raw);
    if (prose) {
      out.push({ kind: "text", index: i, text: toDisplay(prose.content) });
      continue;
    }
    const text = visibleText(raw);
    if (text) out.push({ kind: "fixed", index: i, text });
  }
  while (out.length && out[out.length - 1].kind === "gap") out.pop();
  return out;
}

/** Replaces the text of one prose line, leaving everything else of the document untouched. */
export function applyLineEdit(latex: string, index: number, text: string): string {
  const lines = latex.split("\n");
  const raw = lines[index];
  const parts = raw === undefined ? null : proseParts(raw);
  if (!parts) return latex;
  lines[index] = parts.lead + toLatex(text.trim()) + parts.tail + parts.ws;
  return lines.join("\n");
}
