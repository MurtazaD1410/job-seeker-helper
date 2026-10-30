import { describe, expect, it } from "vitest";
import { validateAnalysis } from "@/lib/analysis";
import { AnalysisSchema } from "@/lib/schema";

const RESUME = String.raw`\section{Experience}
\resumeItem{Built REST APIs in Python and
    deployed them on AWS.}
\resumeItem{Led a team of 4 engineers.}
\resumeItem{Wrote unit tests.}
\resumeItem{Wrote unit tests.}
`;
const FACTS = "I have used Docker daily for 3 years.";
const ctx = { resume: RESUME, extraFacts: FACTS };

const kw = (term: string, status = "present", importance = "must-have") => ({
  term,
  importance,
  category: "tool",
  status
});
const sug = (over: Record<string, unknown>) => ({
  id: "s1",
  section: "Experience",
  original: String.raw`\resumeItem{Led a team of 4 engineers.}`,
  replacement: String.raw`\resumeItem{Led and mentored a team of 4 engineers.}`,
  reason: "why",
  keywords_covered: [],
  ...over
});
const resp = (over: Record<string, unknown> = {}) => ({
  keywords: [kw("Python")],
  suggestions: [sug({})],
  score_before: 60,
  score_after: 75,
  ...over
});

describe("validateAnalysis", () => {
  it("accepts a good response and stores the real resume text as original", () => {
    const r = validateAnalysis(resp(), ctx);
    expect(r.suggestions).toHaveLength(1);
    expect(r.suggestions[0].match).toBe("exact");
    expect(r.dropped).toEqual([]);
    expect(r.score_before).toBe(60);
    expect(r.score_after).toBe(75);
  });

  it("marks whitespace-normalised matches fuzzy and rewrites original to the real text", () => {
    const r = validateAnalysis(
      resp({
        suggestions: [
          sug({
            original: String.raw`\resumeItem{Built REST APIs in Python and deployed them on AWS.}`,
            replacement: String.raw`\resumeItem{Built REST APIs in Python and deployed them on AWS and Docker.}`
          })
        ]
      }),
      ctx
    );
    expect(r.suggestions[0].match).toBe("fuzzy");
    expect(RESUME).toContain(r.suggestions[0].original);
  });

  it("drops originals that are missing or ambiguous", () => {
    const r = validateAnalysis(
      resp({
        suggestions: [
          sug({ id: "a", original: "not in resume at all" }),
          sug({ id: "b", original: String.raw`\resumeItem{Wrote unit tests.}`, replacement: String.raw`\resumeItem{Wrote tests.}` })
        ]
      }),
      ctx
    );
    expect(r.suggestions).toEqual([]);
    expect(r.dropped.map((d) => d.id)).toEqual(["a", "b"]);
    expect(r.dropped[1].reason).toMatch(/ambiguous/);
  });

  it("drops invalid LaTeX, no-ops and duplicate ids", () => {
    const r = validateAnalysis(
      resp({
        suggestions: [
          sug({ id: "a", replacement: String.raw`\resumeItem{Led a team of 4 engineers.` }),
          sug({ id: "b", replacement: String.raw`\resumeItem{Led a team of 4 engineers.}` }),
          sug({ id: "c" }),
          sug({ id: "c", original: String.raw`\resumeItem{Wrote unit tests.}` })
        ]
      }),
      ctx
    );
    expect(r.suggestions.map((s) => s.id)).toEqual(["c"]);
    expect(r.dropped.map((d) => d.reason)).toEqual([
      expect.stringMatching(/braces/),
      expect.stringMatching(/identical/),
      "duplicate id"
    ]);
  });

  it("drops suggestions that introduce numbers not in the resume or facts", () => {
    const r = validateAnalysis(
      resp({ suggestions: [sug({ replacement: String.raw`\resumeItem{Led a team of 12 engineers, cutting costs 30\%.}` })] }),
      ctx
    );
    expect(r.suggestions).toEqual([]);
    expect(r.dropped[0].reason).toMatch(/invented metric/);
  });

  it("allows numbers that come from the extra facts", () => {
    const r = validateAnalysis(
      resp({ suggestions: [sug({ replacement: String.raw`\resumeItem{Led a team of 4 engineers; 3 years of daily Docker.}` })] }),
      ctx
    );
    expect(r.suggestions).toHaveLength(1);
  });

  it("drops suggestions that cover an unsupported keyword", () => {
    const r = validateAnalysis(
      resp({
        keywords: [kw("Kubernetes", "missing_not_supported")],
        suggestions: [sug({ keywords_covered: ["kubernetes"] })]
      }),
      ctx
    );
    expect(r.suggestions).toEqual([]);
    expect(r.dropped[0].reason).toMatch(/Kubernetes/);
  });

  it("drops overlapping suggestions and sorts the rest by position", () => {
    const r = validateAnalysis(
      resp({
        suggestions: [
          sug({ id: "late", original: String.raw`\resumeItem{Led a team of 4 engineers.}`, replacement: String.raw`\resumeItem{Led 4 engineers.}` }),
          sug({
            id: "early",
            original: String.raw`\resumeItem{Built REST APIs in Python and
    deployed them on AWS.}`,
            replacement: String.raw`\resumeItem{Built REST APIs in Python on AWS.}`
          }),
          sug({ id: "overlap", original: "Led a team of 4", replacement: "Led 4" })
        ]
      }),
      ctx
    );
    expect(r.suggestions.map((s) => s.id)).toEqual(["early", "late"]);
    expect(r.dropped).toEqual([{ kind: "suggestion", id: "overlap", reason: "overlaps another suggestion" }]);
  });

  it("drops malformed items and duplicate keywords but keeps the rest", () => {
    const r = validateAnalysis(
      resp({
        keywords: [kw("Python"), kw("python"), { term: "X" }, kw("Go", "bogus")],
        suggestions: [42, sug({})]
      }),
      ctx
    );
    expect(r.keywords.map((k) => k.term)).toEqual(["Python"]);
    expect(r.suggestions).toHaveLength(1);
    expect(r.dropped).toHaveLength(4);
  });

  it("clamps scores and never reports an after-score below before, or above before with no suggestions", () => {
    expect(validateAnalysis(resp({ score_before: 140, score_after: 30 }), ctx)).toMatchObject({ score_before: 100, score_after: 100 });
    expect(validateAnalysis(resp({ score_before: 50, score_after: 20 }), ctx).score_after).toBe(50);
    expect(validateAnalysis(resp({ suggestions: [], score_before: 50, score_after: 90 }), ctx).score_after).toBe(50);
    expect(validateAnalysis(resp({ score_before: "55.4", score_after: "70" }), ctx)).toMatchObject({ score_before: 55, score_after: 70 });
  });

  it("rejects responses with the wrong shape", () => {
    expect(() => validateAnalysis({ keywords: "nope" }, ctx)).toThrow(/expected structure/);
    expect(() => validateAnalysis(null, ctx)).toThrow();
    expect(() => validateAnalysis(resp({ score_before: "high" }), ctx)).toThrow();
  });

  it("produces output that satisfies the persisted AnalysisSchema", () => {
    const r = validateAnalysis(resp(), ctx);
    const full = { ...r, model: "m", job_title: "", company: "", created_at: 1 };
    expect(AnalysisSchema.safeParse(full).success).toBe(true);
  });
});

describe("validateAnalysis: line breaks", () => {
  it("drops a replacement that loses a double-backslash line break", () => {
    const resume = String.raw`\resumeItem{Built APIs in Python.} \\
\resumeItem{Wrote tests.}`;
    const r = validateAnalysis(
      {
        keywords: [],
        suggestions: [
          {
            id: "s1",
            section: "x",
            original: String.raw`\resumeItem{Built APIs in Python.} \\`,
            replacement: String.raw`\resumeItem{Built and shipped APIs in Python.}` + " \\",
            reason: "",
            keywords_covered: []
          }
        ],
        score_before: 50,
        score_after: 60
      },
      { resume, extraFacts: "" }
    );
    expect(r.suggestions).toEqual([]);
    expect(r.dropped[0].reason).toMatch(/line break/);
  });
});
