import { defaultAnswerModel } from "./answers";
import { guessLanguage } from "./coverLetter";
import { hasFact } from "./facts";
import { generateJson, type GenerateJsonOptions, type RetryInfo } from "./gemini";
import { numberTokens } from "./latex";
import { buildInterviewPrompt, INTERVIEW_SYSTEM_INSTRUCTION } from "./prompts";
import { redactContact, TOKEN } from "./redact";
import { resumeFor } from "./resume";
import {
  INTERVIEW_RESPONSE_SCHEMA,
  InterviewGapSchema,
  InterviewQuestionSchema,
  InterviewRawSchema,
  InterviewStudySchema,
  type Analysis,
  type InterviewGap,
  type InterviewPack,
  type InterviewPrefs,
  type InterviewQuestion,
  type InterviewStudy,
  type Language
} from "./schema";
import type { JobDraft, Settings } from "./storage";

/** Below this many characters a description is treated as missing (a title or a few remembered lines). */
export const THIN_DESCRIPTION = 400;

export const isThinDescription = (description: string) => description.trim().length < THIN_DESCRIPTION;

export interface InterviewContext {
  /** Everything a number may come from (user documents, posting, notes). */
  knownText: string;
  /** Only what the user wrote themselves: resume, facts, learning note. */
  userText: string;
  /** Keywords the candidate has no evidence for. */
  unsupported: string[];
}

type Fields = Pick<InterviewPack, "pitch" | "questions" | "gaps" | "ask_them" | "study_list">;

function parseItems<T>(items: unknown[], schema: { safeParse: (v: unknown) => { success: true; data: T } | { success: false } }): T[] {
  const out: T[] = [];
  for (const item of items) {
    const p = schema.safeParse(item);
    if (p.success) out.push(p.data);
  }
  return out;
}

const starText = (q: InterviewQuestion) => (q.star ? Object.values(q.star) : []);

/**
 * Checks the model's output item by item. A broken item is dropped, no usable questions or a leftover
 * redaction placeholder is a hard failure, and unverifiable claims come back as warnings.
 */
export function validateInterview(raw: unknown, ctx: InterviewContext): { fields: Fields; warnings: string[] } {
  const top = InterviewRawSchema.safeParse(raw);
  if (!top.success) throw new Error("Gemini's answer didn't have the expected structure. Try again.");

  const questions: InterviewQuestion[] = parseItems(top.data.questions, InterviewQuestionSchema).map((q) => ({
    ...q,
    // A STAR outline only makes sense for behavioral questions.
    star: q.category === "behavioral" ? q.star : undefined
  }));
  if (!questions.length) throw new Error("Gemini didn't return any usable interview questions. Try again.");
  const gaps: InterviewGap[] = parseItems(top.data.gaps, InterviewGapSchema);
  const study_list: InterviewStudy[] = parseItems(top.data.study_list, InterviewStudySchema);
  const ask_them = top.data.ask_them.filter((s): s is string => typeof s === "string" && s.trim().length > 0).map((s) => s.trim());
  const fields: Fields = { pitch: top.data.pitch, questions, gaps, ask_them, study_list };

  const leftover = JSON.stringify(fields).match(TOKEN);
  if (leftover) throw new Error(`Gemini's text contains an unresolved placeholder (${leftover[0]}). Try again.`);

  // What the candidate would say about themselves. Gap and study sections name missing skills on purpose.
  const selfClaims = [fields.pitch, ...questions.flatMap((q) => [...q.talking_points, ...starText(q)])];
  const claims = [...selfClaims, ...gaps.map((g) => g.honest_answer)].join("\n");

  const warnings: string[] = [];
  const unknown = [...new Set(numberTokens(claims).filter((t) => !ctx.knownText.includes(t)))].slice(0, 5);
  for (const t of unknown) {
    warnings.push(`Contains "${t}", which isn't in your resume, facts, notes or the job description. Check it's true.`);
  }
  const lower = selfClaims.join("\n").toLowerCase();
  const own = ctx.userText.toLowerCase();
  for (const term of ctx.unsupported) {
    const t = term.toLowerCase();
    if (t.length >= 3 && lower.includes(t) && !own.includes(t)) {
      warnings.push(`The pitch or a talking point mentions "${term}", which your resume doesn't show. Remove it unless it only says you're willing to learn it.`);
    }
  }
  return { fields, warnings };
}

export interface InterviewOptions {
  settings: Settings;
  job: JobDraft;
  analysis: Analysis | null;
  /** Your own notes about the job: what you remember of the posting, what was said in a call. */
  notes: string;
  prefs: InterviewPrefs;
  signal?: AbortSignal;
  onRetry?: (info: RetryInfo) => void;
  fetchImpl?: GenerateJsonOptions["fetchImpl"];
  sleep?: GenerateJsonOptions["sleep"];
}

export async function generateInterview(o: InterviewOptions): Promise<InterviewPack> {
  const { settings, job, analysis, prefs } = o;
  const notes = o.notes.trim();
  if (!settings.apiKey) throw new Error("Add your Gemini API key in Settings first.");
  if (!settings.baseResume.trim()) throw new Error("Add your base resume (LaTeX) in Settings first.");
  if (!job.title.trim() && !job.description.trim() && !notes) {
    throw new Error("Add at least a job title (Job tab) or a few notes about the job first.");
  }

  const language: Language = prefs.language === "auto" ? guessLanguage(`${job.description}\n${notes}\n${job.title}`) : prefs.language;
  const model = prefs.model.trim() || defaultAnswerModel(settings.model);
  const resume = resumeFor(settings, language);
  const hide = settings.redactContact ? redactContact : (t: string) => t;

  const keywords = [...(analysis?.keywords ?? [])].sort((a, b) => Number(b.importance === "must-have") - Number(a.importance === "must-have"));
  const supported = keywords.filter((k) => k.status !== "missing_not_supported" || hasFact(settings.extraFacts, k.term));
  const unsupported = keywords.filter((k) => !supported.includes(k));

  const raw = await generateJson({
    apiKey: settings.apiKey,
    model,
    system: INTERVIEW_SYSTEM_INSTRUCTION,
    prompt: buildInterviewPrompt({
      jobTitle: job.title,
      company: job.company,
      jobDescription: job.description,
      notes: hide(notes),
      resume: hide(resume.text),
      extraFacts: hide(settings.extraFacts),
      learningNote: hide(settings.learningNote),
      supportedKeywords: supported.slice(0, 10).map((k) => k.term),
      unsupportedKeywords: unsupported.map((k) => k.term),
      language
    }),
    responseSchema: INTERVIEW_RESPONSE_SCHEMA,
    temperature: 0.5,
    thinkingLevel: "medium",
    maxOutputTokens: 16384,
    signal: o.signal,
    onRetry: o.onRetry,
    fetchImpl: o.fetchImpl,
    sleep: o.sleep
  });

  const userText = [resume.text, settings.baseResume, settings.extraFacts, settings.learningNote].join("\n");
  const { fields, warnings } = validateInterview(raw, {
    knownText: `${userText}\n${job.description}\n${job.title}\n${job.company}\n${notes}`,
    userText,
    unsupported: unsupported.map((k) => k.term)
  });

  return {
    ...fields,
    warnings,
    language,
    thin: isThinDescription(job.description),
    model,
    job_title: job.title,
    company: job.company,
    created_at: Date.now()
  };
}

/** The whole pack as plain text, for copying into a notes app or printing. */
export function interviewToText(p: InterviewPack): string {
  const de = p.language === "de";
  const h = {
    pitch: de ? "Über mich (Pitch)" : "Tell me about yourself",
    q: de ? "Wahrscheinliche Fragen" : "Likely questions",
    gaps: de ? "Lücken ehrlich ansprechen" : "Addressing gaps honestly",
    ask: de ? "Fragen an das Team" : "Questions to ask them",
    study: de ? "Zum Auffrischen" : "Study list"
  };
  const out: string[] = [`${p.job_title}${p.company ? ` @ ${p.company}` : ""}`.trim(), "", h.pitch, p.pitch, "", h.q];
  p.questions.forEach((q, i) => {
    out.push(`${i + 1}. ${q.question}`);
    if (q.why_asked) out.push(`   ${q.why_asked}`);
    q.talking_points.forEach((t) => out.push(`   - ${t}`));
    if (q.star) out.push(`   STAR: ${q.star.situation} ${q.star.task} ${q.star.action} ${q.star.result}`);
  });
  if (p.gaps.length) {
    out.push("", h.gaps);
    p.gaps.forEach((g) => {
      out.push(`- ${g.skill}: ${g.likely_question}`, `  ${g.honest_answer}`);
      g.study.forEach((s) => out.push(`  > ${s}`));
    });
  }
  if (p.ask_them.length) out.push("", h.ask, ...p.ask_them.map((a) => `- ${a}`));
  if (p.study_list.length) out.push("", h.study, ...p.study_list.map((s) => `- ${s.topic}${s.why ? `: ${s.why}` : ""}`));
  return out.join("\n");
}
