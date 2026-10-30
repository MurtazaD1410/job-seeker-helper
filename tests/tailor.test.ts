import { describe, expect, it } from "vitest";
import { buildFileName, companySlug, slug } from "@/lib/fileName";
import type { Suggestion } from "@/lib/schema";
import { tailorResume } from "@/lib/tailor";

const MASTER = String.raw`\section{Experience}
\resumeItem{Built REST APIs in Python.} \\
\resumeItem{Led a team of 4 engineers.}
\section{Skills}
Python, TypeScript
`;

const sug = (id: string, original: string, replacement: string): Suggestion => ({
  id,
  section: "S",
  original,
  replacement,
  reason: "",
  keywords_covered: [],
  match: "exact"
});

describe("tailorResume", () => {
  it("applies suggestions to the master without touching the rest", () => {
    const r = tailorResume(MASTER, [
      sug("s2", "Python, TypeScript", "Python, TypeScript, Redux"),
      sug("s1", String.raw`\resumeItem{Built REST APIs in Python.} \\`, String.raw`\resumeItem{Built and documented REST APIs in Python.} \\`)
    ]);
    expect(r.failed).toEqual([]);
    expect(r.problem).toBeNull();
    expect(r.applied.map((s) => s.id)).toEqual(["s1", "s2"]);
    expect(r.latex).toBe(String.raw`\section{Experience}
\resumeItem{Built and documented REST APIs in Python.} \\
\resumeItem{Led a team of 4 engineers.}
\section{Skills}
Python, TypeScript, Redux
`);
  });

  it("treats $ in a replacement literally", () => {
    const r = tailorResume(MASTER, [sug("s1", "Python, TypeScript", String.raw`Python, TypeScript, saved \$5 ($&)`)]);
    expect(r.latex).toContain(String.raw`saved \$5 ($&)`);
  });

  it("reports suggestions whose original no longer matches or overlaps, and applies the rest", () => {
    const r = tailorResume(MASTER, [
      sug("gone", "text that was edited away", "x"),
      sug("a", "Led a team of 4", "Led 4"),
      sug("b", "team of 4 engineers", "squad"),
      sug("ok", "Python, TypeScript", "Python")
    ]);
    expect(r.applied.map((s) => s.id)).toEqual(["a", "ok"]);
    expect(r.failed.map((f) => [f.suggestion.id, f.reason])).toEqual([
      ["gone", "its original text no longer matches your master resume"],
      ["b", "it overlaps another suggestion"]
    ]);
  });

  it("returns the master unchanged when nothing applies, and flags a broken combined result", () => {
    expect(tailorResume(MASTER, []).latex).toBe(MASTER);
    const broken = tailorResume(MASTER, [sug("s1", "Python, TypeScript", String.raw`\textbf{Python`)]);
    expect(broken.problem).toMatch(/braces/);
  });
});

describe("file names", () => {
  it("slugs umlauts and symbols", () => {
    expect(slug("Müller & Söhne — Köln")).toBe("Mueller_Soehne_Koeln");
    expect(slug("  ")).toBe("");
  });

  it("drops legal forms from company names", () => {
    expect(companySlug("admeritia GmbH")).toBe("admeritia");
    expect(companySlug("Acme Inc.")).toBe("Acme");
    expect(companySlug("Foo Bar GmbH & Co. KG")).toBe("Foo_Bar");
    expect(companySlug("SE")).toBe("SE");
  });

  it("builds the requested names", () => {
    const job = { company: "admeritia GmbH", role: "Studentische Hilfskraft im Software Development" };
    expect(buildFileName("Murtaza_Dhariwala_Lebenslauf_{company}", job, "tex")).toBe("Murtaza_Dhariwala_Lebenslauf_admeritia.tex");
    expect(buildFileName("Murtaza_Dhariwala_Anschreiben_{company}", job, "pdf")).toBe("Murtaza_Dhariwala_Anschreiben_admeritia.pdf");
    expect(buildFileName("CV_{company}_{role}", job, "tex")).toBe("CV_admeritia_Studentische_Hilfskraft_im_Software_Deve.tex");
  });

  it("falls back for a missing company and sanitises the template itself", () => {
    expect(buildFileName("Name_{company}", { company: "", role: "" }, "tex")).toBe("Name_Company.tex");
    expect(buildFileName("a/b: c*{company}?", { company: "X", role: "" }, "tex")).toBe("a_b_c_X.tex");
    expect(buildFileName("   ", { company: "X", role: "" }, "tex")).toBe("document.tex");
  });
});
