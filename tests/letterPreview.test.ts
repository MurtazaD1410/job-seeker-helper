import { describe, expect, it } from "vitest";
import { applyLineEdit, parseLetter, toDisplay, toLatex } from "@/lib/letterPreview";

// Same shape as a real letter: header boxes, a layout-only title, date line, greeting directly above the
// first paragraph, paragraphs separated by blank lines, and a closing with \\ and \par.
const LETTER = String.raw`\documentclass{article}
\usepackage{hyperref}
%%%% Set Margins
\usepackage[margin=1cm]{geometry}

\begin{document}
%%%%%%% HEADER
\begin{center}
    \begin{minipage}[b]{0.24\textwidth}
            \large (+49)15755337922 \\
            \large \href{mailto:max@example.com}{max@example.com}
    \end{minipage}%
    \begin{minipage}[b]{0.5\textwidth}
            \centering
            {\Huge Max Mustermann} \\ %
            \vspace{0.1cm}
    \end{minipage}
\vspace{-0.15cm}
{\color{UI_blue} \hrulefill}
\end{center}

\justify
\setlength{\parindent}{0pt}
\vspace{0.2cm}
\begin{center}
    {\color{UI_blue} \Large{Application as Working Student}}\end{center}

Date: \today \par \vspace{-0.1cm}


Sehr geehrte Damen und Herren,\par
ich arbeite bei R\&D mit React und \textbf{TypeScript}. Das Ergebnis: 100\% Zufriedenheit.

Zweiter Absatz mit Tilde Dr.~Meier.

\raggedright
Mit freundlichen Grüßen,\\
Max Mustermann\par

\end{document}
`;

const texts = (latex: string) => parseLetter(latex).filter((l) => l.kind === "text");

describe("toDisplay / toLatex", () => {
  it("round-trips common prose", () => {
    for (const c of [String.raw`R\&D at 50\% of \_ and \#1`, String.raw`a \textbf{bold} and \textit{it} word`, "Dr.~Meier", String.raw`\$5`]) {
      expect(toLatex(toDisplay(c))).toBe(c);
    }
  });

  it("escapes what you type", () => {
    expect(toLatex("R&D 50% a_b #1 $5")).toBe(String.raw`R\&D 50\% a\_b \#1 \$5`);
    expect(toLatex("a **bold** and *italic*")).toBe(String.raw`a \textbf{bold} and \textit{italic}`);
    expect(toLatex("curly {x} and back\\slash")).toBe(String.raw`curly \{x\} and back\textbackslash{}slash`);
    expect(toLatex("one\ntwo")).toBe("one two");
  });

  it("shows a LaTeX tilde as a non-breaking space and writes it back", () => {
    expect(toDisplay("Dr.~Meier")).toBe("Dr.\u00a0Meier");
    expect(toLatex("Dr.\u00a0Meier")).toBe("Dr.~Meier");
  });
});

describe("parseLetter", () => {
  it("makes the prose editable and keeps layout read-only", () => {
    const lines = parseLetter(LETTER);
    expect(texts(LETTER).map((l) => l.text)).toEqual([
      "Sehr geehrte Damen und Herren,",
      "ich arbeite bei R&D mit React und **TypeScript**. Das Ergebnis: 100% Zufriedenheit.",
      "Zweiter Absatz mit Tilde Dr.\u00a0Meier.",
      "Mit freundlichen Grüßen,",
      "Max Mustermann"
    ]);
    const fixed = lines.filter((l) => l.kind === "fixed").map((l) => l.text);
    expect(fixed).toContain("(+49)15755337922");
    expect(fixed).toContain("max@example.com");
    expect(fixed).toContain("Max Mustermann");
    expect(fixed).toContain("Application as Working Student");
    expect(fixed).toContain("Date: (today's date)");
  });

  it("hides comments, commands without text and the preamble", () => {
    const all = parseLetter(LETTER).map((l) => (l.kind === "gap" ? "" : l.text)).join("\n");
    expect(all).not.toMatch(/documentclass|geometry|HEADER|vspace|setlength|begin|0\.24/);
  });

  it("does not offer lines that wouldn't survive an edit", () => {
    const tricky = String.raw`\begin{document}
Has a {brace} group.
Has a \today inside.
Has a % comment
Has *stars* literally.
\end{document}`;
    expect(texts(tricky)).toEqual([]);
  });

  it("returns nothing without a document body", () => {
    expect(parseLetter("just text")).toEqual([]);
  });
});

describe("applyLineEdit", () => {
  const index = (needle: string) => {
    const l = texts(LETTER).find((t) => t.kind === "text" && t.text.startsWith(needle));
    if (!l || l.kind !== "text") throw new Error("not found");
    return l.index;
  };

  it("changes only that line", () => {
    const next = applyLineEdit(LETTER, index("ich arbeite"), "ich arbeite bei Acme mit React & Vue, 90% Tests.");
    const before = LETTER.split("\n");
    const after = next.split("\n");
    expect(after).toHaveLength(before.length);
    const changed = after.map((l, i) => (l === before[i] ? -1 : i)).filter((i) => i >= 0);
    expect(changed).toEqual([index("ich arbeite")]);
    expect(after[changed[0]]).toBe(String.raw`ich arbeite bei Acme mit React \& Vue, 90\% Tests.`);
  });

  it("keeps a trailing \\par, \\\\ and spaces", () => {
    const greeting = applyLineEdit(LETTER, index("Sehr geehrte"), "Hallo Team,");
    expect(greeting).toContain("Hallo Team,\\par\n");
    // (the fixture has no trailing spaces, so add them here)
    const spaced = LETTER.replace("Grüßen,\\\\\n", "Grüßen,\\\\  \n");
    const closing = applyLineEdit(spaced, index("Mit freundlichen"), "Viele Grüße,");
    expect(closing).toContain("Viele Grüße,\\\\  \n");
  });

  it("is a no-op for an unchanged line and for layout lines", () => {
    const l = texts(LETTER)[1];
    if (l.kind !== "text") throw new Error();
    expect(applyLineEdit(LETTER, l.index, l.text)).toBe(LETTER);
    const layout = LETTER.split("\n").findIndex((x) => x.includes("\\vspace{0.1cm}"));
    expect(applyLineEdit(LETTER, layout, "hacked")).toBe(LETTER);
  });

  it("writes bold back as \\textbf and the result is still a valid document", () => {
    const next = applyLineEdit(LETTER, index("Zweiter"), "Zweiter **wichtiger** Absatz");
    expect(next).toContain("\\textbf{wichtiger}");
    expect(next.startsWith("\\documentclass{article}")).toBe(true);
    expect(next.trimEnd().endsWith("\\end{document}")).toBe(true);
    // braces stay balanced
    expect((next.match(/\{/g) ?? []).length).toBe((next.match(/\}/g) ?? []).length);
  });

  it("can't be used to inject commands", () => {
    const next = applyLineEdit(LETTER, index("Zweiter"), "x \\input{/etc/passwd} {");
    expect(next).not.toContain("\\input{");
    expect(next).toContain("\\textbackslash{}input\\{/etc/passwd\\} \\{");
  });

  it("keeps CRLF line endings", () => {
    const crlf = LETTER.replace(/\n/g, "\r\n");
    const l = texts(crlf).find((t) => t.kind === "text" && t.text.startsWith("Zweiter"));
    if (!l || l.kind !== "text") throw new Error();
    const next = applyLineEdit(crlf, l.index, "Neu");
    expect(next).toContain("Neu\r\n");
    expect(next.split("\r\n")).toHaveLength(crlf.split("\r\n").length);
  });

  it("re-parses after an edit with the new text", () => {
    const next = applyLineEdit(LETTER, index("Zweiter"), "Neuer Absatz");
    expect(texts(next).map((t) => (t.kind === "text" ? t.text : ""))).toContain("Neuer Absatz");
  });
});
