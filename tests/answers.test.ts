import { describe, expect, it, vi } from "vitest";
import { cleanAnswer, defaultAnswerModel, generateAnswer, levelGuide, validateAnswer } from "@/lib/answers";
import { buildAnswerPrompt } from "@/lib/prompts";
import { AnswerPrefsSchema, type AnswerPrefs } from "@/lib/schema";
import { DEFAULT_SETTINGS } from "@/lib/storage";

const ctx = { knownText: "React 18 Acme", userText: "React developer", unsupported: ["Golang"] };
const prefs = (o: Partial<AnswerPrefs> = {}): AnswerPrefs => ({ language: "auto", level: "b2", length: "medium", model: "", maxChars: 0, ...o });

describe("defaultAnswerModel", () => {
  it("picks the pro sibling of a flash model and keeps other names", () => {
    expect(defaultAnswerModel("gemini-3.8-flash")).toBe("gemini-3.8-pro");
    expect(defaultAnswerModel("gemini-2.5-flash-lite")).toBe("gemini-2.5-pro");
    expect(defaultAnswerModel("gemini-2.5-pro")).toBe("gemini-2.5-pro");
  });
});

describe("levelGuide", () => {
  it("asks for short sentences at B1 and adds German-specific rules only for German", () => {
    expect(levelGuide("b1", "de")).toMatch(/B1/);
    expect(levelGuide("b1", "de")).toMatch(/Nominalstil/);
    expect(levelGuide("b1", "en")).not.toMatch(/Nominalstil/);
    expect(levelGuide("c1", "de")).toMatch(/C1/);
  });
});

describe("cleanAnswer", () => {
  it("removes markdown emphasis, headings and fences", () => {
    expect(cleanAnswer("```\n## Titel\nIch nutze **React** und *Vue*.\n```")).toBe("Titel\nIch nutze React und Vue.");
  });
  it("keeps a lone asterisk and normal text", () => {
    expect(cleanAnswer("5 * 3 bleibt")).toBe("5 * 3 bleibt");
  });
});

describe("validateAnswer", () => {
  it("accepts a clean answer", () => {
    expect(validateAnswer("Ich arbeite mit React 18.", ctx)).toEqual({ answer: "Ich arbeite mit React 18.", warnings: [] });
  });
  it("rejects an empty answer and leftover placeholders", () => {
    expect(() => validateAnswer("  ", ctx)).toThrow(/empty/);
    expect(() => validateAnswer("Mail an [email-1]", ctx)).toThrow(/placeholder/);
  });
  it("warns about invented numbers and unsupported skills", () => {
    const { warnings } = validateAnswer("Ich habe 12 Jahre Golang gemacht.", ctx);
    expect(warnings.join("\n")).toMatch(/"12"/);
    expect(warnings.join("\n")).toMatch(/Golang/);
  });
});

describe("buildAnswerPrompt", () => {
  it("includes the question, the level and the limit", () => {
    const p = buildAnswerPrompt({
      question: "Welche Erfahrungen haben Sie?",
      jobTitle: "Frontend",
      company: "Acme",
      jobDescription: "",
      resume: "R",
      extraFacts: "",
      learningNote: "",
      supportedKeywords: [],
      unsupportedKeywords: [],
      language: "de",
      levelGuide: "CEFR B1",
      lengthGuide: "short",
      maxChars: 500
    });
    expect(p).toContain("<question>\nWelche Erfahrungen haben Sie?\n</question>");
    expect(p).toContain("Language: German");
    expect(p).toContain("CEFR B1");
    expect(p).toContain("at most 500 characters");
  });
});

describe("AnswerPrefsSchema", () => {
  it("falls back to B2, medium and auto for bad stored values", () => {
    expect(AnswerPrefsSchema.parse({ level: "x", length: 3, language: "fr", maxChars: -5 })).toEqual({
      language: "auto",
      level: "b2",
      length: "medium",
      model: "",
      maxChars: 0
    });
  });
});

function settings() {
  return { ...DEFAULT_SETTINGS, apiKey: "K", baseResume: "React developer, Max Mustermann", extraFacts: "", redactContact: true };
}
const job = { title: "Frontend", company: "Acme", description: "We need React 18. ".repeat(10), url: "" };
const reply = (text: string) => async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }), { status: 200 });
const bodyOf = (f: unknown, call = 0) => JSON.parse((vi.mocked(f as typeof fetch).mock.calls[call][1] as RequestInit).body as string);

describe("generateAnswer", () => {
  it("uses the pro model by default, the question's language and the chosen level", async () => {
    const fetchImpl = vi.fn(reply("Ich arbeite seit Jahren mit React.")) as unknown as typeof fetch;
    const r = await generateAnswer({
      settings: settings(),
      job,
      analysis: null,
      question: "Welche praktischen Erfahrungen bringen Sie mit und was wissen Sie über die Firma?",
      prefs: prefs({ level: "b1" }),
      fetchImpl
    });
    expect(r).toMatchObject({ answer: "Ich arbeite seit Jahren mit React.", language: "de", level: "b1", model: "gemini-3.8-pro" });
    const url = vi.mocked(fetchImpl).mock.calls[0][0] as string;
    expect(url).toContain("gemini-3.8-pro:generateContent");
    expect(bodyOf(fetchImpl).contents[0].parts[0].text).toMatch(/CEFR B1/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("uses the model you typed", async () => {
    const fetchImpl = vi.fn(reply("I use React.")) as unknown as typeof fetch;
    const r = await generateAnswer({ settings: settings(), job, analysis: null, question: "What do you know?", prefs: prefs({ model: "my-model" }), fetchImpl });
    expect(r.model).toBe("my-model");
    expect(vi.mocked(fetchImpl).mock.calls[0][0] as string).toContain("my-model:generateContent");
  });

  it("asks once for a shorter answer when over the character limit, and uses it", async () => {
    const fetchImpl = vi.fn().mockImplementationOnce(reply("x".repeat(300))).mockImplementationOnce(reply("Kurz und gut.")) as unknown as typeof fetch;
    const r = await generateAnswer({ settings: settings(), job, analysis: null, question: "Frage?", prefs: prefs({ maxChars: 100 }), fetchImpl });
    expect(r.answer).toBe("Kurz und gut.");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(bodyOf(fetchImpl, 1).contents[0].parts[0].text).toMatch(/over the limit/);
  });

  it("warns when it is still over the limit", async () => {
    const fetchImpl = vi.fn(reply("x".repeat(300))) as unknown as typeof fetch;
    const r = await generateAnswer({ settings: settings(), job, analysis: null, question: "Frage?", prefs: prefs({ maxChars: 100 }), fetchImpl });
    expect(r.warnings.join("\n")).toMatch(/over your limit of 100/);
  });

  it("needs a key, a resume and a question", async () => {
    const base = { job, analysis: null, prefs: prefs() };
    await expect(generateAnswer({ ...base, settings: { ...settings(), apiKey: "" }, question: "Q" })).rejects.toThrow(/API key/);
    await expect(generateAnswer({ ...base, settings: { ...settings(), baseResume: " " }, question: "Q" })).rejects.toThrow(/resume/);
    await expect(generateAnswer({ ...base, settings: settings(), question: "  " })).rejects.toThrow(/question/);
  });

  it("hides contact details from the model", async () => {
    const fetchImpl = vi.fn(reply("Ok.")) as unknown as typeof fetch;
    const s = { ...settings(), baseResume: "Max, max@example.com, +49 157 5533 7922" };
    await generateAnswer({ settings: s, job, analysis: null, question: "Q?", prefs: prefs(), fetchImpl });
    const sent = bodyOf(fetchImpl).contents[0].parts[0].text as string;
    expect(sent).not.toContain("max@example.com");
    expect(sent).toContain("[email]");
  });
});
