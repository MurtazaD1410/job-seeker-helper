import {
  AnalysisSchema,
  CoverLetterSchema,
  CoverPrefsSchema,
  SuggestionStateSchema,
  type Analysis,
  type CoverLetter,
  type CoverPrefs,
  type SuggestionStates
} from "./schema";

export const DEFAULT_MODEL = "gemini-3.8-flash";

export interface Settings {
  apiKey: string;
  model: string;
  baseResume: string;
  baseCoverLetter: string;
  extraFacts: string;
  /** Attitude, not skills: willingness to learn. Never counts as evidence for a hard skill. */
  learningNote: string;
  /** File name templates for exports; {company} and {role} are filled in, the extension is added. */
  resumeFileName: string;
  coverFileName: string;
  /** Names of the files in the Overleaf project (e.g. "resume.tex"); empty = use whatever file is open. */
  resumeOverleafFile: string;
  coverOverleafFile: string;
  /** Overleaf project ids (from the project URL); empty = the tab selected in the Overleaf bar. */
  resumeOverleafProject: string;
  coverOverleafProject: string;
  redactContact: boolean;
}

export const DEFAULT_RESUME_FILE_NAME = "Murtaza_Dhariwala_Lebenslauf_{company}";
export const DEFAULT_COVER_FILE_NAME = "Murtaza_Dhariwala_Anschreiben_{company}";

export const DEFAULT_LEARNING_NOTE =
  "I'm motivated and ready to learn any skill or technology that goes along with my current stack (for example Go or similar languages and tools), and I pick up new tools quickly.";

export const DEFAULT_SETTINGS: Settings = {
  apiKey: "",
  model: DEFAULT_MODEL,
  baseResume: "",
  baseCoverLetter: "",
  extraFacts: "",
  learningNote: DEFAULT_LEARNING_NOTE,
  resumeFileName: DEFAULT_RESUME_FILE_NAME,
  coverFileName: DEFAULT_COVER_FILE_NAME,
  resumeOverleafFile: "",
  coverOverleafFile: "",
  resumeOverleafProject: "",
  coverOverleafProject: "",
  redactContact: true
};

const KEY = "settings";

// Merge over defaults and coerce types, so a missing or corrupted stored value never breaks the panel.
export function normalizeSettings(raw: unknown): Settings {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const str = (k: keyof Settings) => (typeof r[k] === "string" ? (r[k] as string) : "");
  return {
    apiKey: str("apiKey"),
    model: str("model").trim() || DEFAULT_MODEL,
    baseResume: str("baseResume"),
    baseCoverLetter: str("baseCoverLetter"),
    extraFacts: str("extraFacts"),
    // Unset (existing installs) gets the default paragraph; an empty string means the user cleared it.
    learningNote: typeof r.learningNote === "string" ? r.learningNote : DEFAULT_LEARNING_NOTE,
    resumeFileName: str("resumeFileName").trim() || DEFAULT_RESUME_FILE_NAME,
    coverFileName: str("coverFileName").trim() || DEFAULT_COVER_FILE_NAME,
    resumeOverleafFile: str("resumeOverleafFile").trim(),
    coverOverleafFile: str("coverOverleafFile").trim(),
    resumeOverleafProject: str("resumeOverleafProject").trim(),
    coverOverleafProject: str("coverOverleafProject").trim(),
    redactContact: typeof r.redactContact === "boolean" ? r.redactContact : DEFAULT_SETTINGS.redactContact
  };
}

export async function loadSettings(): Promise<Settings> {
  const stored = await chrome.storage.local.get(KEY);
  return normalizeSettings(stored[KEY]);
}

export async function saveSettings(s: Settings): Promise<Settings> {
  const clean = normalizeSettings({ ...s, apiKey: s.apiKey.trim() });
  await chrome.storage.local.set({ [KEY]: clean });
  return clean;
}

export interface JobDraft {
  title: string;
  company: string;
  description: string;
  url: string;
}

export const EMPTY_JOB: JobDraft = { title: "", company: "", description: "", url: "" };

const JOB_KEY = "jobDraft";

export function normalizeJobDraft(raw: unknown): JobDraft {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const str = (k: keyof JobDraft) => (typeof r[k] === "string" ? (r[k] as string) : "");
  return { title: str("title"), company: str("company"), description: str("description"), url: str("url") };
}

export async function loadJobDraft(): Promise<JobDraft> {
  const stored = await chrome.storage.local.get(JOB_KEY);
  return normalizeJobDraft(stored[JOB_KEY]);
}

export async function saveJobDraft(j: JobDraft): Promise<void> {
  await chrome.storage.local.set({ [JOB_KEY]: normalizeJobDraft(j) });
}

const ANALYSIS_KEY = "analysis";

// Re-validated on load: storage is outside the type system.
export async function loadAnalysis(): Promise<Analysis | null> {
  const stored = await chrome.storage.local.get(ANALYSIS_KEY);
  const parsed = AnalysisSchema.safeParse(stored[ANALYSIS_KEY]);
  return parsed.success ? parsed.data : null;
}

export async function saveAnalysis(a: Analysis): Promise<void> {
  await chrome.storage.local.set({ [ANALYSIS_KEY]: a });
}

const STATE_KEY = "suggestionState";

/** Stored progress for the analysis run `createdAt`; empty if none or if it belongs to an older run. */
export function normalizeSuggestionState(raw: unknown, createdAt: number): SuggestionStates {
  const parsed = SuggestionStateSchema.safeParse(raw);
  return parsed.success && parsed.data.created_at === createdAt ? parsed.data.items : {};
}

export async function loadSuggestionState(createdAt: number): Promise<SuggestionStates> {
  const stored = await chrome.storage.local.get(STATE_KEY);
  return normalizeSuggestionState(stored[STATE_KEY], createdAt);
}

export async function saveSuggestionState(createdAt: number, items: SuggestionStates): Promise<void> {
  await chrome.storage.local.set({ [STATE_KEY]: { created_at: createdAt, items } });
}

const COVER_KEY = "coverLetter";
const COVER_PREFS_KEY = "coverPrefs";

export async function loadCoverLetter(): Promise<CoverLetter | null> {
  const stored = await chrome.storage.local.get(COVER_KEY);
  const parsed = CoverLetterSchema.safeParse(stored[COVER_KEY]);
  return parsed.success ? parsed.data : null;
}

export async function saveCoverLetter(c: CoverLetter): Promise<void> {
  await chrome.storage.local.set({ [COVER_KEY]: c });
}

export async function loadCoverPrefs(): Promise<CoverPrefs> {
  const stored = await chrome.storage.local.get(COVER_PREFS_KEY);
  return CoverPrefsSchema.parse(stored[COVER_PREFS_KEY] ?? {});
}

export async function saveCoverPrefs(p: CoverPrefs): Promise<void> {
  await chrome.storage.local.set({ [COVER_PREFS_KEY]: p });
}

/**
 * Forgets everything about the current job: the description, the analysis, the suggestion progress and the
 * cover letter draft. Settings, your master texts, the cover letter tone/language and any PDF-build backup
 * are deliberately kept.
 */
export async function clearJobData(): Promise<void> {
  await chrome.storage.local.remove([JOB_KEY, ANALYSIS_KEY, STATE_KEY, COVER_KEY]);
}
