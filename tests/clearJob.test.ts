import { afterEach, describe, expect, it, vi } from "vitest";
import { clearJobData, saveAnalysis, saveCoverLetter, saveJobDraft, saveSettings, saveSuggestionState, saveCoverPrefs, loadAnalysis, loadCoverLetter, loadJobDraft, loadSuggestionState, loadCoverPrefs, loadSettings } from "@/lib/storage";
import { savePendingRestore, loadPendingRestore } from "@/lib/pendingRestore";
import type { Analysis, CoverLetter } from "@/lib/schema";

// A tiny in-memory chrome.storage.local.
function fakeStorage() {
  const data: Record<string, unknown> = {};
  vi.stubGlobal("chrome", {
    storage: {
      local: {
        get: async (key: string | string[]) => {
          const keys = Array.isArray(key) ? key : [key];
          return Object.fromEntries(keys.filter((k) => k in data).map((k) => [k, data[k]]));
        },
        set: async (obj: Record<string, unknown>) => void Object.assign(data, obj),
        remove: async (key: string | string[]) => void (Array.isArray(key) ? key : [key]).forEach((k) => delete data[k])
      }
    }
  });
  return data;
}

afterEach(() => vi.unstubAllGlobals());

const analysis: Analysis = {
  keywords: [],
  suggestions: [],
  score_before: 50,
  score_after: 60,
  dropped: [],
  model: "m",
  job_title: "Dev",
  company: "Acme",
  created_at: 42
};
const letter: CoverLetter = {
  latex: "x",
  summary: "",
  warnings: [],
  tone: "formal",
  language: "de",
  model: "m",
  job_title: "Dev",
  company: "Acme",
  created_at: 43
};

describe("clearJobData", () => {
  it("removes the job, analysis, suggestion progress and cover letter draft, and nothing else", async () => {
    fakeStorage();
    await saveSettings({ ...(await loadSettings()), apiKey: "KEY", baseResume: "MASTER" });
    await saveCoverPrefs({ tone: "friendly", language: "en" });
    await savePendingRestore({ text: "backup", project: "p", file: "main.tex", title: "CV", saved_at: 1 });
    await saveJobDraft({ title: "Dev", company: "Acme", description: "d".repeat(80), url: "https://x" });
    await saveAnalysis(analysis);
    await saveSuggestionState(42, { s1: { status: "copied" } });
    await saveCoverLetter(letter);

    await clearJobData();

    // gone
    expect(await loadJobDraft()).toEqual({ title: "", company: "", description: "", url: "" });
    expect(await loadAnalysis()).toBeNull();
    expect(await loadSuggestionState(42)).toEqual({});
    expect(await loadCoverLetter()).toBeNull();
    // kept
    expect(await loadSettings()).toMatchObject({ apiKey: "KEY", baseResume: "MASTER" });
    expect(await loadCoverPrefs()).toEqual({ tone: "friendly", language: "en" });
    expect(await loadPendingRestore()).toMatchObject({ text: "backup" });
  });

  it("is harmless when there is nothing to clear", async () => {
    fakeStorage();
    await expect(clearJobData()).resolves.toBeUndefined();
  });
});
