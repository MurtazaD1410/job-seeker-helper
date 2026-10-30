import { describe, expect, it } from "vitest";
import { checkReplacement, diffSnippet, escapeLatex, locate, numberTokens } from "@/lib/latex";

const RESUME = String.raw`\section{Experience}
\resumeItem{Built REST APIs in Python and
    deployed them on AWS.}
\resumeItem{Wrote unit tests.}
\resumeItem{Wrote unit tests.}
`;

describe("escapeLatex", () => {
  it("escapes LaTeX special characters", () => {
    expect(escapeLatex("R&D 50% #1 a_b $5 {x} ~ ^")).toBe(
      String.raw`R\&D 50\% \#1 a\_b \$5 \{x\} \textasciitilde{} \textasciicircum{}`
    );
  });
  it("escapes backslashes without double-escaping", () => {
    expect(escapeLatex("a\\b")).toBe("a\\textbackslash{}b");
  });
});

describe("locate", () => {
  it("finds a unique exact match", () => {
    const orig = String.raw`\resumeItem{Built REST APIs in Python and
    deployed them on AWS.}`;
    const r = locate(RESUME, orig);
    expect(r.kind).toBe("exact");
    if (r.kind === "exact") expect(RESUME.slice(r.start, r.end)).toBe(orig);
  });

  it("reports repeated text as ambiguous", () => {
    expect(locate(RESUME, String.raw`\resumeItem{Wrote unit tests.}`)).toEqual({ kind: "ambiguous", count: 2 });
  });

  it("falls back to whitespace-normalised matching and maps back to real offsets", () => {
    const r = locate(RESUME, String.raw`\resumeItem{Built REST APIs in Python and deployed them on AWS.}`);
    expect(r.kind).toBe("fuzzy");
    if (r.kind === "fuzzy") {
      expect(RESUME.slice(r.start, r.end)).toBe(String.raw`\resumeItem{Built REST APIs in Python and
    deployed them on AWS.}`);
    }
  });

  it("tolerates surrounding whitespace in the needle", () => {
    const r = locate(RESUME, `\n  \\section{Experience}  \n`);
    expect(r.kind).toBe("fuzzy");
    if (r.kind === "fuzzy") expect(RESUME.slice(r.start, r.end)).toBe("\\section{Experience}");
  });

  it("does not match different words and rejects empty input", () => {
    expect(locate(RESUME, "Built GraphQL APIs")).toEqual({ kind: "none" });
    expect(locate(RESUME, "   ")).toEqual({ kind: "none" });
  });
});

describe("checkReplacement", () => {
  const orig = String.raw`\textbf{Python} \& SQL`;

  it("accepts a well-formed rewrite", () => {
    expect(checkReplacement(orig, String.raw`\textbf{Python}, \textit{pandas} \& SQL`)).toBeNull();
  });
  it("rejects unbalanced braces", () => {
    expect(checkReplacement(orig, String.raw`\textbf{Python \& SQL`)).toMatch(/braces/);
    expect(checkReplacement(orig, String.raw`}Python{ \& SQL`)).toMatch(/braces/);
  });
  it("rejects new unescaped special characters but allows ones that were already there", () => {
    expect(checkReplacement("plain", "R&D")).toMatch(/&/);
    expect(checkReplacement("plain", "saved 40% cost")).toMatch(/%/);
    expect(checkReplacement("plain", "snake_case")).toMatch(/_/);
    expect(checkReplacement("plain", "item #3")).toMatch(/#/);
    expect(checkReplacement("a & b", "a & c")).toBeNull();
  });
  it("accepts escaped specials", () => {
    expect(checkReplacement("plain", String.raw`R\&D, 40\%, a\_b, \#3, \$5`)).toBeNull();
  });
  it("rejects an odd number of dollar signs", () => {
    expect(checkReplacement("plain", "costs $5")).toMatch(/\$/);
    expect(checkReplacement("plain", "$x^2$")).toBeNull();
  });
  it("rejects mismatched environments and empty text", () => {
    expect(checkReplacement("x", String.raw`\begin{itemize} \item a`)).toMatch(/itemize/);
    expect(checkReplacement("x", "  ")).toMatch(/empty/);
  });
});

describe("numberTokens", () => {
  it("extracts numbers and percentages", () => {
    expect(numberTokens("Cut costs by 40% in 2021, 3,5 FTE.")).toEqual(["40%", "2021", "3,5"]);
  });
});

describe("diffSnippet", () => {
  it("marks only the changed words", () => {
    const parts = diffSnippet(String.raw`\item Built APIs in Python`, String.raw`\item Designed APIs in Python and Go`);
    expect(parts.filter((p) => p.removed).map((p) => p.value)).toEqual(["Built"]);
    expect(parts.filter((p) => p.added).map((p) => p.value.trim())).toEqual(["Designed", "and Go"]);
  });

  it("reconstructs both texts exactly", () => {
    const a = String.raw`\textbf{Python}  and
SQL`;
    const b = String.raw`\textbf{Python}, SQL and Docker`;
    const parts = diffSnippet(a, b);
    expect(parts.filter((p) => !p.added).map((p) => p.value).join("")).toBe(a);
    expect(parts.filter((p) => !p.removed).map((p) => p.value).join("")).toBe(b);
  });

  it("returns no changes for identical text", () => {
    expect(diffSnippet("same", "same").some((p) => p.added || p.removed)).toBe(false);
  });
});
