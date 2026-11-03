import { describe, expect, it } from "vitest";
import { resumeFor } from "@/lib/resume";
import { normalizeSettings } from "@/lib/storage";

const base = { baseResume: "DE text", baseResumeEn: "EN text", resumeOverleafFileEn: "en.tex", resumeOverleafFile: "de.tex" };

describe("resumeFor", () => {
  it("picks the German resume for German postings", () => {
    const r = resumeFor(normalizeSettings(base), "de");
    expect(r).toMatchObject({ language: "de", text: "DE text", file: "de.tex" });
  });
  it("picks the English resume for English postings", () => {
    const r = resumeFor(normalizeSettings(base), "en");
    expect(r).toMatchObject({ language: "en", text: "EN text", file: "en.tex" });
    expect(r.fileName).toContain("Resume");
  });
  it("falls back to the German resume while no English one is set", () => {
    const r = resumeFor(normalizeSettings({ baseResume: "DE text" }), "en");
    expect(r).toMatchObject({ language: "de", text: "DE text" });
  });
});
