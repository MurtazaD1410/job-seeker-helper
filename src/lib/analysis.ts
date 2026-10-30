import { checkReplacement, countLineBreaks, locate, numberTokens } from "./latex";
import { generateJson, type GenerateJsonOptions, type RetryInfo } from "./gemini";
import { buildAnalysisPrompt, ANALYSIS_SYSTEM_INSTRUCTION } from "./prompts";
import { redactContact } from "./redact";
import {
  ANALYSIS_RESPONSE_SCHEMA,
  KeywordSchema,
  RawResponseSchema,
  SuggestionSchema,
  type Analysis,
  type Dropped,
  type Keyword,
  type Suggestion
} from "./schema";
import type { JobDraft, Settings } from "./storage";

const clampScore = (n: number) => Math.min(100, Math.max(0, Math.round(n)));

/**
 * Validates Gemini's output against the real resume. Never trusts the model:
 *  - items that don't match the schema are dropped
 *  - `original` must be found exactly once (exact, or whitespace-normalised and marked "fuzzy"); the
 *    stored `original` is always the real resume text, so find-and-replace works later
 *  - replacement LaTeX must not break braces, environments or add unescaped special characters
 *  - no new numbers (possible invented metrics) and no coverage of "missing_not_supported" keywords
 *  - overlapping suggestions are dropped
 */
export function validateAnalysis(
  raw: unknown,
  ctx: { resume: string; extraFacts: string }
): Pick<Analysis, "keywords" | "suggestions" | "score_before" | "score_after" | "dropped"> {
  const top = RawResponseSchema.safeParse(raw);
  if (!top.success) throw new Error("Gemini's answer didn't have the expected structure. Try again.");

  const dropped: Dropped[] = [];

  const keywords: Keyword[] = [];
  const seenTerms = new Set<string>();
  top.data.keywords.forEach((item, i) => {
    const k = KeywordSchema.safeParse(item);
    const label = k.success ? k.data.term : `#${i + 1}`;
    if (!k.success) return void dropped.push({ kind: "keyword", id: label, reason: "invalid format" });
    const key = k.data.term.toLowerCase();
    if (seenTerms.has(key)) return void dropped.push({ kind: "keyword", id: label, reason: "duplicate" });
    seenTerms.add(key);
    keywords.push(k.data);
  });
  const unsupported = new Map(keywords.filter((k) => k.status === "missing_not_supported").map((k) => [k.term.toLowerCase(), k.term]));

  const knownText = `${ctx.resume}\n${ctx.extraFacts}`;
  const accepted: { s: Suggestion; start: number; end: number }[] = [];
  const seenIds = new Set<string>();

  top.data.suggestions.forEach((item, i) => {
    const p = SuggestionSchema.safeParse(item);
    if (!p.success) return void dropped.push({ kind: "suggestion", id: `#${i + 1}`, reason: "invalid format" });
    const s = p.data;
    const drop = (reason: string) => void dropped.push({ kind: "suggestion", id: s.id, reason });

    if (seenIds.has(s.id)) return drop("duplicate id");
    seenIds.add(s.id);

    const hit = s.keywords_covered.map((k) => unsupported.get(k.toLowerCase())).find(Boolean);
    if (hit) return drop(`covers "${hit}", which your resume doesn't support`);

    const loc = locate(ctx.resume, s.original);
    if (loc.kind === "none") return drop("original text not found in your resume");
    if (loc.kind === "ambiguous") return drop(`original text found ${loc.count} times (ambiguous)`);

    const original = ctx.resume.slice(loc.start, loc.end);
    if (s.replacement === original) return drop("replacement is identical to the original");

    const problem = checkReplacement(original, s.replacement);
    if (problem) return drop(`invalid LaTeX: ${problem}`);

    if (countLineBreaks(s.replacement) < countLineBreaks(original)) return drop("lost a line break (double backslash)");

    const newNumber = numberTokens(s.replacement).find((t) => !knownText.includes(t));
    if (newNumber) return drop(`introduces "${newNumber}", which isn't in your resume (possible invented metric)`);

    if (accepted.some((a) => loc.start < a.end && a.start < loc.end)) return drop("overlaps another suggestion");

    accepted.push({ s: { ...s, original, match: loc.kind }, start: loc.start, end: loc.end });
  });

  accepted.sort((a, b) => a.start - b.start);
  const suggestions = accepted.map((a) => a.s);

  const before = clampScore(top.data.score_before);
  // Dropped suggestions can't contribute, and a "after" below "before" makes no sense.
  const after = suggestions.length ? Math.max(before, clampScore(top.data.score_after)) : before;

  return { keywords, suggestions, score_before: before, score_after: after, dropped };
}

export interface AnalyzeOptions {
  settings: Settings;
  job: JobDraft;
  signal?: AbortSignal;
  onRetry?: (info: RetryInfo) => void;
  fetchImpl?: GenerateJsonOptions["fetchImpl"];
  sleep?: GenerateJsonOptions["sleep"];
}

export async function analyzeJob({ settings, job, ...rest }: AnalyzeOptions): Promise<Analysis> {
  if (!settings.apiKey) throw new Error("Add your Gemini API key in Settings first.");
  if (!settings.baseResume.trim()) throw new Error("Add your base resume (LaTeX) in Settings first.");
  if (!job.description.trim()) throw new Error("Paste or grab a job description first.");

  // Redaction applies to what is sent; validation always runs against the real resume.
  const hide = settings.redactContact ? redactContact : (t: string) => t;
  const response = await generateJson({
    apiKey: settings.apiKey,
    model: settings.model,
    system: ANALYSIS_SYSTEM_INSTRUCTION,
    prompt: buildAnalysisPrompt({
      jobTitle: job.title,
      company: job.company,
      jobDescription: job.description,
      resume: hide(settings.baseResume),
      extraFacts: hide(settings.extraFacts),
      learningNote: hide(settings.learningNote)
    }),
    responseSchema: ANALYSIS_RESPONSE_SCHEMA,
    ...rest
  });

  const validated = validateAnalysis(response, { resume: settings.baseResume, extraFacts: settings.extraFacts });
  return {
    ...validated,
    model: settings.model,
    job_title: job.title,
    company: job.company,
    created_at: Date.now()
  };
}
