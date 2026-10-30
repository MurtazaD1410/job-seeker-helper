import { describe, expect, it, vi } from "vitest";
import { generateCoverLetter, guessLanguage, parseCoverResponse, validateCoverLetter } from "@/lib/coverLetter";
import { makeRedactor } from "@/lib/redact";
import { DEFAULT_SETTINGS } from "@/lib/storage";

const PREAMBLE = String.raw`\documentclass{letter}
\usepackage[utf8]{inputenc}
`;
const BASE = `${PREAMBLE}\\begin{document}
\\begin{letter}{Acme GmbH}
\\opening{Dear Sir or Madam,}
I am a developer with 3 years of Python experience and I enjoy building APIs.
Contact: jane@example.com
\\closing{Best regards}
\\end{letter}
\\end{document}`;

const ctx = (over: Partial<Parameters<typeof validateCoverLetter>[1]> = {}) => ({
  baseLetter: BASE,
  restore: (s: string) => s,
  knownText: `${BASE}\nPython APIs`,
  ...over
});
const resp = (latex: string, summary = "tailored") => ({ latex, summary });
const withBody = (body: string, preamble = PREAMBLE) =>
  `${preamble}\\begin{document}\n\\begin{letter}{Acme GmbH}\n\\opening{Dear Sir or Madam,}\n${body}\n\\closing{Best regards}\n\\end{letter}\n\\end{document}`;

describe("guessLanguage", () => {
  it("detects German and English postings", () => {
    expect(guessLanguage("Das erwartet dich bei uns: Unterstützung unserer Entwickler und Pflege der Dokumentation")).toBe("de");
    expect(guessLanguage("You will work with our team and your experience with Python is a plus")).toBe("en");
    expect(guessLanguage("")).toBe("en");
  });
});

describe("makeRedactor", () => {
  it("gives each distinct value one stable token and restores it", () => {
    const r = makeRedactor();
    const a = r.redact("mail jane@example.com, again jane@example.com, other bob@example.org, +49 171 1234567");
    expect(a).toBe("mail [email-1], again [email-1], other [email-2], [phone-1]");
    expect(r.redact("jane@example.com")).toBe("[email-1]");
    expect(r.restore("To [email-2] / [phone-1] / [email-9]")).toBe("To bob@example.org / +49 171 1234567 / [email-9]");
  });

  it("restores postcode lines without losing the prefix", () => {
    const r = makeRedactor();
    const t = "Musterstraße 12, 10115 Berlin";
    expect(r.restore(r.redact(t))).toBe(t);
  });
});

describe("validateCoverLetter", () => {
  it("accepts a well-formed letter", () => {
    const r = validateCoverLetter(resp(withBody("I am a developer with 3 years of Python experience and love building APIs for Acme.")), ctx());
    expect(r.warnings).toEqual([]);
    expect(r.latex.startsWith(PREAMBLE)).toBe(true);
  });

  it("strips code fences", () => {
    const body = withBody("I build APIs in Python for teams like yours at Acme.");
    const r = validateCoverLetter(resp("```latex\n" + body + "\n```"), ctx());
    expect(r.latex.startsWith("\\documentclass")).toBe(true);
    expect(r.latex.endsWith("\\end{document}")).toBe(true);
  });

  it("restores the base preamble when the model changed it, and warns", () => {
    const changed = withBody("I build APIs in Python for Acme.", "\\documentclass{article}\n\\usepackage{evil}\n");
    const r = validateCoverLetter(resp(changed), ctx());
    expect(r.latex.startsWith(PREAMBLE)).toBe(true);
    expect(r.latex).not.toContain("evil");
    expect(r.warnings).toContain("Gemini changed the preamble, so your original preamble was restored.");
  });

  it("does not warn about harmless whitespace differences in the preamble", () => {
    const r = validateCoverLetter(resp(withBody("I build APIs in Python for Acme.", PREAMBLE.replace("\n", "\n\n"))), ctx());
    expect(r.warnings.some((w) => /preamble/.test(w))).toBe(false);
  });

  it("restores contact details and rejects leftover placeholders", () => {
    const restore = (s: string) => s.replace("[email-1]", "jane@example.com");
    const ok = validateCoverLetter(resp(withBody("I build Python APIs. Contact: [email-1]")), ctx({ restore }));
    expect(ok.latex).toContain("Contact: jane@example.com");
    expect(() => validateCoverLetter(resp(withBody("Write to [email-7] or [phone]")), ctx({ restore }))).toThrow(/placeholder/);
  });

  it("rejects broken LaTeX and a missing \\begin{document}", () => {
    expect(() => validateCoverLetter(resp(withBody("I build \\textbf{Python APIs")), ctx())).toThrow(/LaTeX problem.*braces/);
    expect(() => validateCoverLetter(resp(withBody("Great R&D work in Python")), ctx())).toThrow(/unescaped &/);
    expect(() => validateCoverLetter(resp("Dear Sir or Madam, I am a Python developer. ".repeat(3)), ctx())).toThrow(/begin\{document\}/);
  });

  it("warns about numbers that aren't in the user's documents, but not about LaTeX dimensions", () => {
    const body = String.raw`I build Python APIs, grew revenue by 40\%, led 12 engineers.
\vspace{0.5cm}`;
    const r = validateCoverLetter(resp(withBody(body)), ctx());
    expect(r.warnings.filter((w) => w.startsWith("Contains"))).toHaveLength(2);
    expect(r.warnings.join(" ")).toContain('"40"');
    expect(r.warnings.join(" ")).toContain('"12"');
    expect(r.warnings.join(" ")).not.toContain("0.5");
  });

  it("warns on a letter that is far shorter, or unchanged", () => {
    expect(validateCoverLetter(resp(withBody("Hi.")), ctx()).warnings.join(" ")).toMatch(/shorter/);
    expect(validateCoverLetter(resp(BASE), ctx()).warnings.join(" ")).toMatch(/identical/);
  });

  it("rejects a wrongly shaped response", () => {
    expect(() => validateCoverLetter({ latex: "short" }, ctx())).toThrow(/expected structure/);
    expect(() => validateCoverLetter(null, ctx())).toThrow();
  });
});

describe("generateCoverLetter", () => {
  // The model answers in plain text with tags, not JSON.
  const ok = (obj: { latex: string; summary: string }) =>
    new Response(
      JSON.stringify({
        candidates: [{ finishReason: "STOP", content: { parts: [{ text: `<summary>\n${obj.summary}\n</summary>\n<latex>\n${obj.latex}\n</latex>` }] } }]
      }),
      { status: 200 }
    );
  const settings = {
    ...DEFAULT_SETTINGS,
    apiKey: "KEY",
    baseResume: String.raw`\resumeItem{Built APIs in Python.} jane@example.com`,
    baseCoverLetter: BASE,
    extraFacts: "Experience with Docker."
  };
  const job = { title: "Dev", company: "Acme", description: "We need Python and Redux. ".repeat(5), url: "" };
  const analysis = {
    keywords: [
      { term: "Python", importance: "must-have", category: "tool", status: "present" },
      { term: "Docker", importance: "nice-to-have", category: "tool", status: "missing_not_supported" },
      { term: "Redux", importance: "must-have", category: "tool", status: "missing_not_supported" }
    ],
    suggestions: [],
    score_before: 50,
    score_after: 50,
    dropped: [],
    model: "m",
    job_title: "Dev",
    company: "Acme",
    created_at: 1
  } as const;

  it("sends redacted text and tone/language, separates unsupported keywords, and restores contact details", async () => {
    const answer = withBody("I build Python APIs and I am keen to learn Redux. Contact: [email-1]");
    const fetchImpl = vi.fn().mockResolvedValue(ok({ latex: answer, summary: "Used [email-1]" }));
    const r = await generateCoverLetter({
      settings,
      job,
      analysis: analysis as never,
      tone: "friendly",
      language: "de",
      fetchImpl
    });
    const prompt = JSON.parse(fetchImpl.mock.calls[0][1].body).contents[0].parts[0].text as string;
    expect(prompt).not.toContain("jane@example.com");
    expect(prompt).toContain("[email-1]");
    expect(prompt).toContain("Tone: friendly");
    expect(prompt).toContain("Language: German");
    expect(prompt).toContain("Supported keywords to weave in (most important first): Python, Docker");
    expect(prompt).toContain("Do not claim: Redux");
    expect(r.latex).toContain("Contact: jane@example.com");
    expect(r.summary).toBe("Used jane@example.com");
    expect(r.language).toBe("de");
  });

  it("resolves 'auto' language from the job posting", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(ok({ latex: withBody("I build Python APIs for Acme."), summary: "" }));
    const r = await generateCoverLetter({ settings, job: { ...job, description: "Wir suchen dich für unser Team: Deine Aufgaben und dein Profil. ".repeat(3) }, analysis: null, tone: "formal", language: "auto", fetchImpl });
    expect(r.language).toBe("de");
  });

  it("asks for plain text, not JSON, so backslashes in line breaks survive untouched", async () => {
    const base = String.raw`${PREAMBLE}\begin{document}
\begin{center}
  \large (+49) 1 \\
  {\Huge Jane} \\
\end{center}
Sehr geehrte Damen und Herren,\par
Ich bin Entwickler mit Python.\\
Mit freundlichen Grüßen,\\
Jane
\end{document}`;
    const tailored = base.replace("Ich bin Entwickler mit Python.", "Ich entwickle gern APIs mit Python für Acme.");
    const fetchImpl = vi.fn().mockResolvedValue(ok({ latex: tailored, summary: "x" }));
    const r = await generateCoverLetter({ settings: { ...settings, baseCoverLetter: base }, job, analysis: null, tone: "formal", language: "de", fetchImpl });
    const sent = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(sent.generationConfig.responseMimeType).toBeUndefined();
    expect(sent.generationConfig.responseSchema).toBeUndefined();
    expect(r.latex).toBe(tailored);
    expect((r.latex.match(/\\\\/g) ?? []).length).toBe(4);
    expect(r.warnings.some((w) => /line breaks/.test(w))).toBe(false);
  });

  it("refuses without a key, base letter or job description", async () => {
    await expect(generateCoverLetter({ settings: { ...settings, apiKey: "" }, job, analysis: null, tone: "formal", language: "en" })).rejects.toThrow(/API key/);
    await expect(generateCoverLetter({ settings: { ...settings, baseCoverLetter: " " }, job, analysis: null, tone: "formal", language: "en" })).rejects.toThrow(/cover letter/);
    await expect(generateCoverLetter({ settings, job: { ...job, description: "" }, analysis: null, tone: "formal", language: "en" })).rejects.toThrow(/job description/);
  });
});

describe("parseCoverResponse", () => {
  it("reads the tagged answer and keeps backslashes exactly", () => {
    const text = String.raw`<summary>
- tailored
</summary>
<latex>
\begin{document}
Line one \\
Line two\\
\end{document}
</latex>`;
    const r = parseCoverResponse(text);
    expect(r.summary).toBe("- tailored");
    expect(r.latex).toBe(String.raw`\begin{document}
Line one \\
Line two\\
\end{document}`);
  });

  it("falls back to a bare document, and rejects an answer without a letter", () => {
    const bare = String.raw`Here you go:\n\documentclass{letter}\begin{document}Hi\end{document} thanks`;
    expect(parseCoverResponse(bare).latex).toBe(String.raw`\documentclass{letter}\begin{document}Hi\end{document}`);
    expect(() => parseCoverResponse("Sorry, I can't do that.")).toThrow(/didn't contain a letter/);
  });
});

describe("validateCoverLetter: line breaks and unsupported skills", () => {
  const base = String.raw`${PREAMBLE}\begin{document}
Hello \\
World \\
\end{document}`;
  const c = (over = {}) => ({ baseLetter: base, restore: (s: string) => s, knownText: base, userText: base, ...over });

  it("warns when line breaks from the original are missing", () => {
    const lost = String.raw`${PREAMBLE}\begin{document}
Hello \
World \\
\end{document}`;
    expect(validateCoverLetter({ latex: lost, summary: "" }, c()).warnings.join(" ")).toMatch(/line breaks/);
  });

  it("warns about mentioning a skill the resume doesn't show, but not one it does", () => {
    const body = String.raw`${PREAMBLE}\begin{document}
Hello, I used Redux and Docker daily. \\
World \\
\end{document}`;
    const w = validateCoverLetter(
      { latex: body, summary: "" },
      c({ unsupported: ["Redux", "Docker", "Go"], userText: `${base} Docker` })
    ).warnings.join(" ");
    expect(w).toContain('Mentions "Redux"');
    expect(w).not.toContain("Docker");
    expect(w).not.toContain('"Go"');
  });
});

describe("prompt text", () => {
  it("contains real LaTeX backslashes, not control characters or dropped escapes", async () => {
    const { COVER_SYSTEM_INSTRUCTION, ANALYSIS_SYSTEM_INSTRUCTION } = await import("@/lib/prompts");
    for (const p of [COVER_SYSTEM_INSTRUCTION, ANALYSIS_SYSTEM_INSTRUCTION]) {
      expect(p).not.toMatch(/[\x00-\x08\x0b\x0c\x0e-\x1f]/); // e.g. "\b" in "\begin" becoming a backspace
      expect(p).toContain(String.raw`\&`);
    }
    expect(COVER_SYSTEM_INSTRUCTION).toContain(String.raw`\begin{document}`);
    expect(COVER_SYSTEM_INSTRUCTION).toContain(String.raw`\\ for a line break`);
  });
});
