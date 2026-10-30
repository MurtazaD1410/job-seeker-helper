import { generateText, type GenerateJsonOptions, type RetryInfo } from "./gemini";
import { hasFact } from "./facts";
import { checkReplacement, countLineBreaks, numberTokens } from "./latex";
import { buildCoverPrompt, COVER_SYSTEM_INSTRUCTION } from "./prompts";
import { makeRedactor, TOKEN } from "./redact";
import { CoverResponseSchema, type Analysis, type CoverLetter, type Language, type Tone } from "./schema";
import type { JobDraft, Settings } from "./storage";

const BEGIN_DOC = "\\begin{document}";
const END_DOC = "\\end{document}";
const normalizeSpace = (s: string) => s.replace(/\s+/g, " ").trim();

/** Best guess whether a job posting is German or English, by common function words. */
export function guessLanguage(text: string): Language {
  const de = text.match(/\b(und|der|die|das|wir|sie|du|dein|deine|mit|für|bei|oder|nicht|ein|eine|aufgaben|profil|kenntnisse|erfahrung|unser|unsere)\b/gi)?.length ?? 0;
  const en = text.match(/\b(the|and|you|your|we|with|for|our|or|not|an|experience|skills|team|will|are)\b/gi)?.length ?? 0;
  return de > en ? "de" : "en";
}

/**
 * The model answers in plain text, <summary>…</summary><latex>…</latex>, so LaTeX backslashes arrive
 * exactly as written (in JSON they have to be doubled, and a collapsed "\\\\" breaks line breaks).
 */
export function parseCoverResponse(text: string): { latex: string; summary: string } {
  const tag = (name: string) => new RegExp(`<${name}>\\s*([\\s\\S]*?)\\s*</${name}>`, "i").exec(text)?.[1];
  let latex = tag("latex");
  if (latex === undefined) {
    // No tags: accept a bare document.
    const start = text.indexOf("\\documentclass");
    const end = text.lastIndexOf(END_DOC);
    if (start !== -1 && end > start) latex = text.slice(start, end + END_DOC.length);
  }
  if (!latex?.trim()) throw new Error("Gemini's answer didn't contain a letter. Try again.");
  return { latex, summary: tag("summary") ?? "" };
}

// Numbers that are part of LaTeX commands or dimensions (0.5cm, \vspace{2pt}) are not claims.
function plainNumbers(latex: string): string[] {
  const stripped = latex
    .replace(/\\[a-zA-Z@]+\*?/g, " ")
    .replace(/\d+(?:[.,]\d+)?\s?(?:pt|em|ex|cm|mm|in|bp|sp|pc)\b/g, " ");
  return numberTokens(stripped);
}

export interface ValidatedLetter {
  latex: string;
  warnings: string[];
}

/**
 * Validates the model's letter against the base letter. Hard failures throw (broken LaTeX, leftover
 * placeholders, wrong structure). Softer issues come back as warnings the user should look at.
 * The preamble is always taken from the base letter, so it can't be altered by the model.
 */
export function validateCoverLetter(
  raw: unknown,
  ctx: {
    baseLetter: string;
    restore: (s: string) => string;
    /** Everything the letter's numbers may come from (user documents plus the job posting). */
    knownText: string;
    /** Only what the user wrote themselves: resume, facts, learning note, old letter. */
    userText?: string;
    /** Keywords the candidate has no evidence for. */
    unsupported?: string[];
  }
): ValidatedLetter {
  const parsed = CoverResponseSchema.safeParse(raw);
  if (!parsed.success) throw new Error("Gemini's answer didn't have the expected structure. Try again.");

  const warnings: string[] = [];
  let latex = parsed.data.latex
    .replace(/^\s*```(?:latex|tex)?\s*/i, "")
    .replace(/\s*```\s*$/, "")
    .trim();

  latex = ctx.restore(latex);
  const leftover = latex.match(TOKEN);
  if (leftover) throw new Error(`Gemini's letter contains an unresolved placeholder (${leftover[0]}). Try again.`);

  const baseIdx = ctx.baseLetter.indexOf(BEGIN_DOC);
  if (baseIdx !== -1) {
    const basePreamble = ctx.baseLetter.slice(0, baseIdx);
    const idx = latex.indexOf(BEGIN_DOC);
    if (idx === -1) throw new Error("Gemini's letter is missing \\begin{document}. Try again.");
    if (normalizeSpace(latex.slice(0, idx)) !== normalizeSpace(basePreamble)) {
      warnings.push("Gemini changed the preamble, so your original preamble was restored.");
    }
    latex = basePreamble + latex.slice(idx);
  }

  const problem = checkReplacement(ctx.baseLetter, latex);
  if (problem) throw new Error(`Gemini's letter has a LaTeX problem (${problem}). Try again.`);

  if (countLineBreaks(latex) < countLineBreaks(ctx.baseLetter)) {
    warnings.push("Some line breaks (\\\\) from your original are missing, so the layout may differ. Check the changes view.");
  }

  // Compare the letter itself, not the preamble (which is identical by construction).
  const bodyOf = (s: string) => (s.includes(BEGIN_DOC) ? s.slice(s.indexOf(BEGIN_DOC)) : s);
  const ratio = bodyOf(latex).length / Math.max(1, bodyOf(ctx.baseLetter).length);
  if (ratio < 0.6) warnings.push("The letter is much shorter than your original. Check that nothing was cut off.");
  if (ratio > 2) warnings.push("The letter is much longer than your original. It may not fit on one page.");
  if (normalizeSpace(latex) === normalizeSpace(ctx.baseLetter)) warnings.push("The letter is identical to your original.");

  const unknown = [...new Set(plainNumbers(latex).filter((t) => !ctx.knownText.includes(t)))].slice(0, 5);
  for (const t of unknown) {
    warnings.push(`Contains "${t}", which isn't in your resume, facts, letter or the job description. Check it's true.`);
  }

  // Skills the candidate has no evidence for may appear at most as willingness to learn.
  const lower = latex.toLowerCase();
  const own = (ctx.userText ?? "").toLowerCase();
  for (const term of ctx.unsupported ?? []) {
    const t = term.toLowerCase();
    if (t.length >= 3 && lower.includes(t) && !own.includes(t)) {
      warnings.push(`Mentions "${term}", which your resume doesn't show. That's fine only if it says you're willing to learn it. Otherwise remove it.`);
    }
  }

  return { latex, warnings };
}

export interface CoverOptions {
  settings: Settings;
  job: JobDraft;
  analysis: Analysis | null;
  tone: Tone;
  language: Language | "auto";
  signal?: AbortSignal;
  onRetry?: (info: RetryInfo) => void;
  fetchImpl?: GenerateJsonOptions["fetchImpl"];
  sleep?: GenerateJsonOptions["sleep"];
}

export async function generateCoverLetter(o: CoverOptions): Promise<CoverLetter> {
  const { settings, job, analysis } = o;
  if (!settings.apiKey) throw new Error("Add your Gemini API key in Settings first.");
  if (!settings.baseCoverLetter.trim()) throw new Error("Add your base cover letter (LaTeX) in Settings first.");
  if (!job.description.trim()) throw new Error("Paste or grab a job description on the Job tab first.");

  const language: Language = o.language === "auto" ? guessLanguage(job.description) : o.language;

  // One redactor for all texts so the same contact detail always gets the same token, and the
  // letter's real details can be put back into the model's output.
  const redactor = settings.redactContact ? makeRedactor() : null;
  const hide = redactor ? redactor.redact : (t: string) => t;
  const restore = redactor ? redactor.restore : (t: string) => t;

  // Keywords the candidate has evidence for (including skills confirmed from a chip) vs. not.
  const keywords = [...(analysis?.keywords ?? [])].sort((a, b) => Number(b.importance === "must-have") - Number(a.importance === "must-have"));
  const supported = keywords.filter((k) => k.status !== "missing_not_supported" || hasFact(settings.extraFacts, k.term));
  const unsupported = keywords.filter((k) => !supported.includes(k));

  const answer = await generateText({
    apiKey: settings.apiKey,
    model: settings.model,
    system: COVER_SYSTEM_INSTRUCTION,
    prompt: buildCoverPrompt({
      jobTitle: job.title,
      company: job.company,
      jobDescription: job.description,
      baseLetter: hide(settings.baseCoverLetter),
      resume: hide(settings.baseResume),
      extraFacts: hide(settings.extraFacts),
      learningNote: hide(settings.learningNote),
      supportedKeywords: supported.slice(0, 10).map((k) => k.term),
      unsupportedKeywords: unsupported.map((k) => k.term),
      tone: o.tone,
      language
    }),
    signal: o.signal,
    onRetry: o.onRetry,
    fetchImpl: o.fetchImpl,
    sleep: o.sleep
  });

  const response = parseCoverResponse(answer);
  const userText = [settings.baseResume, settings.extraFacts, settings.learningNote, settings.baseCoverLetter].join("\n");
  const knownText = `${userText}\n${job.description}\n${job.title}\n${job.company}`;
  const { latex, warnings } = validateCoverLetter(response, {
    baseLetter: settings.baseCoverLetter,
    restore,
    knownText,
    userText,
    unsupported: unsupported.map((k) => k.term)
  });

  return {
    latex,
    summary: restore(response.summary).trim().slice(0, 2000),
    warnings,
    tone: o.tone,
    language,
    model: settings.model,
    job_title: job.title,
    company: job.company,
    created_at: Date.now()
  };
}
