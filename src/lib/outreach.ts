import { guessLanguage } from "./coverLetter";
import { hasFact } from "./facts";
import { generateJson, type GenerateJsonOptions, type RetryInfo } from "./gemini";
import { numberTokens } from "./latex";
import { buildOutreachPrompt, OUTREACH_SYSTEM_INSTRUCTION } from "./prompts";
import { redactContact, TOKEN } from "./redact";
import {
  LIMITED_FIELDS,
  NOTE_LIMIT,
  OUTREACH_FIELDS,
  OUTREACH_RESPONSE_SCHEMA,
  OutreachResponseSchema,
  type Analysis,
  type Language,
  type Outreach,
  type OutreachResponse,
  type Tone
} from "./schema";
import type { JobDraft, Settings } from "./storage";

export const FIELD_LABEL: Record<(typeof OUTREACH_FIELDS)[number], string> = {
  connection_note: "Connection note",
  email_subject: "Email subject",
  email_body: "Email",
  followup_note: "Follow-up note",
  accepted_message: "After they accept",
  referral_request: "Referral request"
};

/** Fields that are longer than LinkedIn allows for a connection note. */
export function overLimit(r: Pick<OutreachResponse, (typeof LIMITED_FIELDS)[number]>): (typeof LIMITED_FIELDS)[number][] {
  return LIMITED_FIELDS.filter((f) => r[f].length > NOTE_LIMIT);
}

export interface OutreachContext {
  /** Everything the messages' numbers may come from (user documents plus the job posting). */
  knownText: string;
  /** Only what the user wrote themselves: resume, facts, learning note. */
  userText: string;
  /** Keywords the candidate has no evidence for. */
  unsupported: string[];
}

/**
 * Checks the model's messages. Leftover redaction placeholders are a hard failure; everything else
 * comes back as a warning the user should look at. Length is not a warning: the panel shows a live counter.
 */
export function validateOutreach(raw: unknown, ctx: OutreachContext): { fields: OutreachResponse; warnings: string[] } {
  const parsed = OutreachResponseSchema.safeParse(raw);
  if (!parsed.success) throw new Error("Gemini's answer didn't have the expected structure. Try again.");
  const fields = parsed.data;

  const all = OUTREACH_FIELDS.map((f) => fields[f]).join("\n");
  const leftover = all.match(TOKEN);
  if (leftover) throw new Error(`Gemini's text contains an unresolved placeholder (${leftover[0]}). Try again.`);

  const warnings: string[] = [];
  // "a 15-minute chat" is an ask, not a claim about the candidate.
  const claims = all.replace(/\d+[\s-]*(?:minutes?|min|minuten)(?![\p{L}])/giu, " ");
  const unknown = [...new Set(numberTokens(claims).filter((t) => !ctx.knownText.includes(t)))].slice(0, 5);
  for (const t of unknown) {
    warnings.push(`Contains "${t}", which isn't in your resume, facts or the job description. Check it's true.`);
  }

  const lower = all.toLowerCase();
  const own = ctx.userText.toLowerCase();
  for (const term of ctx.unsupported) {
    const t = term.toLowerCase();
    if (t.length >= 3 && lower.includes(t) && !own.includes(t)) {
      warnings.push(`Mentions "${term}", which your resume doesn't show. Remove it unless it only says you're willing to learn it.`);
    }
  }

  return { fields, warnings };
}

export interface OutreachOptions {
  settings: Settings;
  job: JobDraft;
  analysis: Analysis | null;
  tone: Tone;
  language: Language | "auto";
  recipient?: string;
  signal?: AbortSignal;
  onRetry?: (info: RetryInfo) => void;
  fetchImpl?: GenerateJsonOptions["fetchImpl"];
  sleep?: GenerateJsonOptions["sleep"];
}

export async function generateOutreach(o: OutreachOptions): Promise<Outreach> {
  const { settings, job, analysis } = o;
  if (!settings.apiKey) throw new Error("Add your Gemini API key in Settings first.");
  if (!settings.baseResume.trim()) throw new Error("Add your base resume (LaTeX) in Settings first.");
  if (!job.description.trim()) throw new Error("Paste or grab a job description on the Job tab first.");

  const language: Language = o.language === "auto" ? guessLanguage(job.description) : o.language;
  const recipient = (o.recipient ?? "").trim().slice(0, 120);

  // Nothing here has to be put back into the output, so the one-way redaction is enough.
  const hide = settings.redactContact ? redactContact : (t: string) => t;

  const keywords = [...(analysis?.keywords ?? [])].sort((a, b) => Number(b.importance === "must-have") - Number(a.importance === "must-have"));
  const supported = keywords.filter((k) => k.status !== "missing_not_supported" || hasFact(settings.extraFacts, k.term));
  const unsupported = keywords.filter((k) => !supported.includes(k));

  const prompt = buildOutreachPrompt({
    jobTitle: job.title,
    company: job.company,
    jobDescription: job.description,
    resume: hide(settings.baseResume),
    extraFacts: hide(settings.extraFacts),
    learningNote: hide(settings.learningNote),
    supportedKeywords: supported.slice(0, 10).map((k) => k.term),
    unsupportedKeywords: unsupported.map((k) => k.term),
    tone: o.tone,
    language,
    recipient
  });
  const call = (extra = "") =>
    generateJson({
      apiKey: settings.apiKey,
      model: settings.model,
      system: OUTREACH_SYSTEM_INSTRUCTION,
      prompt: prompt + extra,
      responseSchema: OUTREACH_RESPONSE_SCHEMA,
      signal: o.signal,
      onRetry: o.onRetry,
      fetchImpl: o.fetchImpl,
      sleep: o.sleep
    });

  let raw = await call();

  // Models often overshoot a character limit. Ask once for a shorter version before giving up.
  const first = OutreachResponseSchema.safeParse(raw);
  if (first.success) {
    const long = overLimit(first.data);
    if (long.length) {
      const detail = long.map((f) => `${f} (${first.data[f].length} characters)`).join(", ");
      const retry = await call(
        `\n\nYour previous answer was too long: ${detail}. Return the complete JSON again, with every limited field at most ${NOTE_LIMIT - 20} characters including spaces. Keep the other fields.`
      );
      if (OutreachResponseSchema.safeParse(retry).success) raw = retry;
    }
  }

  const userText = [settings.baseResume, settings.extraFacts, settings.learningNote].join("\n");
  const { fields, warnings } = validateOutreach(raw, {
    knownText: `${userText}\n${job.description}\n${job.title}\n${job.company}`,
    userText,
    unsupported: unsupported.map((k) => k.term)
  });

  return {
    ...fields,
    warnings,
    tone: o.tone,
    language,
    recipient,
    model: settings.model,
    job_title: job.title,
    company: job.company,
    created_at: Date.now()
  };
}
