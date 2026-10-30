import { describe, expect, it } from "vitest";
import { DEFAULT_LEARNING_NOTE, DEFAULT_MODEL, normalizeSettings, normalizeSuggestionState } from "@/lib/storage";

describe("normalizeSettings", () => {
  it("returns defaults for missing or invalid input", () => {
    for (const raw of [undefined, null, 42, "x"]) {
      const s = normalizeSettings(raw);
      expect(s.model).toBe(DEFAULT_MODEL);
      expect(s.apiKey).toBe("");
      expect(s.redactContact).toBe(true);
    }
  });

  it("keeps valid values and falls back on blank model or wrong types", () => {
    const s = normalizeSettings({ apiKey: "k", model: "  ", baseResume: 5, redactContact: false });
    expect(s.apiKey).toBe("k");
    expect(s.model).toBe(DEFAULT_MODEL);
    expect(s.baseResume).toBe("");
    expect(s.redactContact).toBe(false);
  });
});

describe("normalizeSuggestionState", () => {
  const stored = { created_at: 5, items: { s1: { status: "copied" }, s2: { status: "failed", error: "nope" } } };

  it("returns the items for the matching analysis run", () => {
    expect(normalizeSuggestionState(stored, 5)).toEqual(stored.items);
  });
  it("ignores state from another run, or corrupted state", () => {
    expect(normalizeSuggestionState(stored, 6)).toEqual({});
    expect(normalizeSuggestionState({ created_at: 5, items: { s1: { status: "bogus" } } }, 5)).toEqual({});
    expect(normalizeSuggestionState(undefined, 5)).toEqual({});
  });
});

describe("learningNote setting", () => {
  it("defaults when unset, but keeps an empty string the user cleared", () => {
    expect(normalizeSettings({}).learningNote).toBe(DEFAULT_LEARNING_NOTE);
    expect(normalizeSettings({ learningNote: "" }).learningNote).toBe("");
    expect(normalizeSettings({ learningNote: "Keen on Rust" }).learningNote).toBe("Keen on Rust");
  });
});

describe("file name settings", () => {
  it("default to the requested patterns and fall back when blank", () => {
    expect(normalizeSettings({}).resumeFileName).toBe("Murtaza_Dhariwala_Lebenslauf_{company}");
    expect(normalizeSettings({}).coverFileName).toBe("Murtaza_Dhariwala_Anschreiben_{company}");
    expect(normalizeSettings({ resumeFileName: "  ", coverFileName: "CL_{company}" })).toMatchObject({
      resumeFileName: "Murtaza_Dhariwala_Lebenslauf_{company}",
      coverFileName: "CL_{company}"
    });
  });
});
