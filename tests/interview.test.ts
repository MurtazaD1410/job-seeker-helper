import { describe, expect, it, vi } from "vitest";
import { generateInterview, interviewToText, isThinDescription, validateInterview } from "@/lib/interview";
import { InterviewPrefsSchema, type InterviewPrefs } from "@/lib/schema";
import { DEFAULT_SETTINGS } from "@/lib/storage";

const ctx = { knownText: "React 18 Acme", userText: "React developer", unsupported: ["Golang"] };
const prefs = (o: Partial<InterviewPrefs> = {}): InterviewPrefs => ({ language: "auto", model: "", ...o });

const q = (o: Record<string, unknown> = {}) => ({
  category: "technical",
  question: "How do you structure a React app?",
  why_asked: "Checks experience.",
  talking_points: ["Used React at Acme"],
  ...o
});
const star = { situation: "A", task: "B", action: "C", result: "D" };
const good = (o: Record<string, unknown> = {}) => ({
  pitch: "I am a React developer with several years of frontend experience, and I like clean interfaces.",
  questions: [q(), q({ category: "behavioral", question: "Tell me about a conflict.", star })],
  gaps: [{ skill: "Golang", likely_question: "Have you used Golang?", honest_answer: "Not yet, but I learn quickly.", study: ["Tour of Go"] }],
  ask_them: ["How is the team organised?"],
  study_list: [{ topic: "React", why: "Core of the role" }],
  ...o
});

describe("isThinDescription", () => {
  it("treats empty and very short descriptions as thin", () => {
    expect(isThinDescription("")).toBe(true);
    expect(isThinDescription("React dev, 3 days remote")).toBe(true);
    expect(isThinDescription("x".repeat(500))).toBe(false);
  });
});

describe("validateInterview", () => {
  it("accepts a clean response and keeps STAR only for behavioral questions", () => {
    const { fields, warnings } = validateInterview(good({ questions: [q({ star }), q({ category: "behavioral", question: "Tell me about a conflict.", star })] }), ctx);
    expect(warnings).toEqual([]);
    expect(fields.questions[0].star).toBeUndefined();
    expect(fields.questions[1].star).toEqual(star);
    expect(fields.gaps).toHaveLength(1);
  });

  it("drops broken items but fails when no question is usable", () => {
    const { fields } = validateInterview(good({ questions: [q(), { nonsense: true }, q({ question: "x" })] }), ctx);
    expect(fields.questions).toHaveLength(1);
    expect(() => validateInterview(good({ questions: [{ nonsense: true }] }), ctx)).toThrow(/usable/);
    expect(() => validateInterview({ pitch: 5 }, ctx)).toThrow(/structure/);
  });

  it("fails on a leftover redaction placeholder", () => {
    expect(() => validateInterview(good({ pitch: "Write me at [email-1] or call, I am a React developer for years." }), ctx)).toThrow(/placeholder/);
  });

  it("warns about invented numbers and about unsupported skills in the pitch, but not in the gaps section", () => {
    const { warnings } = validateInterview(good({ pitch: "I have 12 years of Golang experience and I build React apps every day." }), ctx);
    expect(warnings.join("\n")).toMatch(/"12"/);
    expect(warnings.join("\n")).toMatch(/Golang/);
    expect(validateInterview(good(), ctx).warnings).toEqual([]);
  });
});

describe("InterviewPrefsSchema", () => {
  it("falls back to auto for bad stored values", () => {
    expect(InterviewPrefsSchema.parse({ language: "fr", model: 3 })).toEqual({ language: "auto", model: "" });
  });
});

function settings(o: Record<string, unknown> = {}) {
  return { ...DEFAULT_SETTINGS, apiKey: "K", baseResume: "DE Lebenslauf React", baseResumeEn: "EN resume React developer", redactContact: true, ...o };
}
const reply = (data: unknown) => async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(data) }] } }] }), { status: 200 });
const bodyOf = (f: unknown) => JSON.parse((vi.mocked(f as typeof fetch).mock.calls[0][1] as RequestInit).body as string);

describe("generateInterview", () => {
  const englishJob = { title: "Frontend Developer", company: "Acme", description: "We are looking for you to join our team. You will build React apps with our team. ".repeat(8), url: "" };

  it("uses the pro model and the resume that matches the job language", async () => {
    const fetchImpl = vi.fn(reply(good())) as unknown as typeof fetch;
    const r = await generateInterview({ settings: settings(), job: englishJob, analysis: null, notes: "", prefs: prefs(), fetchImpl });
    expect(r).toMatchObject({ language: "en", thin: false, model: "gemini-3.8-pro", company: "Acme" });
    expect(vi.mocked(fetchImpl).mock.calls[0][0] as string).toContain("gemini-3.8-pro:generateContent");
    const prompt = bodyOf(fetchImpl).contents[0].parts[0].text as string;
    expect(prompt).toContain("EN resume React developer");
    expect(prompt).not.toContain("DE Lebenslauf");
  });

  it("works without a job description, from the title and notes, and says so", async () => {
    const fetchImpl = vi.fn(reply(good())) as unknown as typeof fetch;
    const job = { title: "Frontend Entwickler", company: "Acme", description: "", url: "" };
    const r = await generateInterview({ settings: settings(), job, analysis: null, notes: "Wir arbeiten mit React und der Kunde ist eine Bank.", prefs: prefs({ language: "de" }), fetchImpl });
    expect(r).toMatchObject({ thin: true, language: "de" });
    const prompt = bodyOf(fetchImpl).contents[0].parts[0].text as string;
    expect(prompt).toContain("none given");
    expect(prompt).toContain("der Kunde ist eine Bank");
  });

  it("needs a title or notes, a key and a resume", async () => {
    const empty = { title: "", company: "", description: "", url: "" };
    const base = { job: empty, analysis: null, notes: "", prefs: prefs() };
    await expect(generateInterview({ ...base, settings: settings() })).rejects.toThrow(/job title/);
    await expect(generateInterview({ ...base, settings: settings({ apiKey: "" }), notes: "x" })).rejects.toThrow(/API key/);
    await expect(generateInterview({ ...base, settings: settings({ baseResume: "" }), notes: "x" })).rejects.toThrow(/resume/);
  });
});

describe("interviewToText", () => {
  it("includes every section", () => {
    const { fields } = validateInterview(good(), ctx);
    const text = interviewToText({ ...fields, warnings: [], language: "en", thin: false, model: "m", job_title: "Dev", company: "Acme", created_at: 1 });
    for (const part of ["Dev @ Acme", "Tell me about yourself", "1. How do you structure", "STAR:", "Golang", "Questions to ask them", "Study list"]) {
      expect(text).toContain(part);
    }
  });
});
