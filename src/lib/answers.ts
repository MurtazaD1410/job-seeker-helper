import { guessLanguage } from "./coverLetter";
import { hasFact } from "./facts";
import { generateText, type GenerateJsonOptions, type RetryInfo } from "./gemini";
import { numberTokens } from "./latex";
import { ANSWER_SYSTEM_INSTRUCTION, buildAnswerPrompt } from "./prompts";
import { redactContact, TOKEN } from "./redact";
import type { Analysis, Answer, AnswerPrefs, Language, Length, Level } from "./schema";
import type { JobDraft, Settings } from "./storage";

export const LEVEL_LABEL: Record<Level, string> = {
  b1: "B1: simple, short sentences",
  b2: "B2: clear and natural",
  c1: "C1: professional"
};

export const LENGTH_LABEL: Record<Length, string> = {
  short: "Short (about 50 words)",
  medium: "Medium (about 120 words)",
  long: "Long (about 220 words)"
};

const LENGTH_GUIDE: Record<Length, string> = {
  short: "short: 40 to 70 words, one compact paragraph",
  medium: "medium: 90 to 150 words, one or two paragraphs",
  long: "long: 180 to 260 words, two or three short paragraphs"
};

/** The instruction that tells the model how simple (or not) its wording has to be. */
export function levelGuide(level: Level, language: Language): string {
  const de = language === "de";
  switch (level) {
    case "b1":
      return (
        "CEFR B1, simple. Short sentences, mostly under 15 words, one idea each. Common everyday and workplace words, active voice. " +
        "Avoid long nested clauses, noun-heavy phrasing, rare or formal words and idioms." +
        (de ? " In German: no Nominalstil, no Konjunktiv II chains, no Genitiv-Ketten, no Passiv where an active sentence works. Technical terms from the question are fine." : " Technical terms from the question are fine.")
      );
    case "b2":
      return (
        "CEFR B2, clear and natural. Sentences up to about 25 words with some variety and simple connectors. Everyday professional vocabulary. " +
        "No needlessly complicated constructions or rare words." +
        (de ? " In German: normal business German, use a few connectors like außerdem, deshalb, dabei; avoid Behördendeutsch." : "")
      );
    case "c1":
      return "CEFR C1, professional. Fluent, precise, idiomatic business language with varied sentence structure. Still no stuffy or inflated wording.";
  }
}

/** The "pro" sibling of the main model ("gemini-3.8-flash" -> "gemini-3.8-pro"); other names are used as they are. */
export function defaultAnswerModel(main: string): string {
  return /flash/i.test(main) ? main.replace(/flash(-lite)?/i, "pro") : main;
}

/** Strips what a web form can't show: code fences and markdown emphasis or headings. */
export function cleanAnswer(text: string): string {
  return text
    .replace(/^\s*```[a-z]*\s*/i, "")
    .replace(/\s*```\s*$/, "")
    .replace(/\*\*([^*]+?)\*\*/g, "$1")
    .replace(/(^|[\s(])\*([^*\n]+?)\*(?=[\s).,;:!?]|$)/g, "$1$2")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\r\n?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export interface AnswerContext {
  /** Everything the answer's numbers may come from (user documents plus the job posting and question). */
  knownText: string;
  /** Only what the user wrote themselves: resume, facts, learning note. */
  userText: string;
  /** Keywords the candidate has no evidence for. */
  unsupported: string[];
}

/**
 * Checks the model's answer. An empty answer or a leftover redaction placeholder is a hard failure;
 * everything else comes back as a warning the user should look at.
 */
export function validateAnswer(raw: string, ctx: AnswerContext): { answer: string; warnings: string[] } {
  const answer = cleanAnswer(raw);
  if (!answer) throw new Error("Gemini returned an empty answer. Try again.");
  const leftover = answer.match(TOKEN);
  if (leftover) throw new Error(`Gemini's text contains an unresolved placeholder (${leftover[0]}). Try again.`);

  const warnings: string[] = [];
  const unknown = [...new Set(numberTokens(answer).filter((t) => !ctx.knownText.includes(t)))].slice(0, 5);
  for (const t of unknown) {
    warnings.push(`Contains "${t}", which isn't in your resume, facts, the job description or the question. Check it's true.`);
  }
  const lower = answer.toLowerCase();
  const own = ctx.userText.toLowerCase();
  for (const term of ctx.unsupported) {
    const t = term.toLowerCase();
    if (t.length >= 3 && lower.includes(t) && !own.includes(t)) {
      warnings.push(`Mentions "${term}", which your resume doesn't show. Remove it unless it only says you're willing to learn it.`);
    }
  }
  return { answer, warnings };
}

export interface AnswerOptions {
  settings: Settings;
  job: JobDraft;
  analysis: Analysis | null;
  question: string;
  prefs: AnswerPrefs;
  signal?: AbortSignal;
  onRetry?: (info: RetryInfo) => void;
  fetchImpl?: GenerateJsonOptions["fetchImpl"];
  sleep?: GenerateJsonOptions["sleep"];
}

export async function generateAnswer(o: AnswerOptions): Promise<Answer> {
  const { settings, job, analysis, prefs } = o;
  const question = o.question.trim();
  if (!settings.apiKey) throw new Error("Add your Gemini API key in Settings first.");
  if (!settings.baseResume.trim()) throw new Error("Add your base resume (LaTeX) in Settings first.");
  if (!question) throw new Error("Paste the question first.");

  const language: Language = prefs.language === "auto" ? guessLanguage(question) : prefs.language;
  const model = prefs.model.trim() || defaultAnswerModel(settings.model);
  const hide = settings.redactContact ? redactContact : (t: string) => t;

  const keywords = [...(analysis?.keywords ?? [])].sort((a, b) => Number(b.importance === "must-have") - Number(a.importance === "must-have"));
  const supported = keywords.filter((k) => k.status !== "missing_not_supported" || hasFact(settings.extraFacts, k.term));
  const unsupported = keywords.filter((k) => !supported.includes(k));

  const prompt = buildAnswerPrompt({
    question,
    jobTitle: job.title,
    company: job.company,
    jobDescription: job.description,
    resume: hide(settings.baseResume),
    extraFacts: hide(settings.extraFacts),
    learningNote: hide(settings.learningNote),
    supportedKeywords: supported.slice(0, 10).map((k) => k.term),
    unsupportedKeywords: unsupported.map((k) => k.term),
    language,
    levelGuide: levelGuide(prefs.level, language),
    lengthGuide: LENGTH_GUIDE[prefs.length],
    maxChars: prefs.maxChars
  });
  const call = (extra = "") =>
    generateText({
      apiKey: settings.apiKey,
      model,
      system: ANSWER_SYSTEM_INSTRUCTION,
      prompt: prompt + extra,
      temperature: 0.4,
      thinkingLevel: "medium",
      maxOutputTokens: 4096,
      signal: o.signal,
      onRetry: o.onRetry,
      fetchImpl: o.fetchImpl,
      sleep: o.sleep
    });

  let text = cleanAnswer(await call());

  // Models often overshoot a character limit. Ask once for a shorter version before giving up.
  if (prefs.maxChars && text.length > prefs.maxChars) {
    const retry = cleanAnswer(
      await call(
        `\n\nYour previous answer was ${text.length} characters, over the limit. Write it again with at most ${Math.max(20, prefs.maxChars - 30)} characters including spaces. Keep the language level.`
      )
    );
    if (retry && retry.length < text.length) text = retry;
  }

  const userText = [settings.baseResume, settings.extraFacts, settings.learningNote].join("\n");
  const { answer, warnings } = validateAnswer(text, {
    knownText: `${userText}\n${job.description}\n${job.title}\n${job.company}\n${question}`,
    userText,
    unsupported: unsupported.map((k) => k.term)
  });
  if (prefs.maxChars && answer.length > prefs.maxChars) {
    warnings.push(`The answer has ${answer.length} characters, over your limit of ${prefs.maxChars}. Shorten it before pasting.`);
  }

  return { id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, question, answer, warnings, language, level: prefs.level, model, created_at: Date.now() };
}
