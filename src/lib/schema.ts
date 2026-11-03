import { z } from "zod";

export const IMPORTANCE = ["must-have", "nice-to-have"] as const;
export const CATEGORY = ["hard skill", "tool", "soft skill", "domain", "language"] as const;
export const STATUS = ["present", "missing_but_supported", "missing_not_supported"] as const;

export type Importance = (typeof IMPORTANCE)[number];
export type Category = (typeof CATEGORY)[number];
export type Status = (typeof STATUS)[number];

// --- What we accept from Gemini. Items are validated one by one so a single bad item doesn't sink the response.

export const KeywordSchema = z.object({
  term: z.string().trim().min(1).max(100),
  importance: z.enum(IMPORTANCE),
  category: z.enum(CATEGORY),
  status: z.enum(STATUS)
});

export const SuggestionSchema = z.object({
  id: z.string().trim().min(1).max(40),
  section: z.string().trim().max(200).default(""),
  // Not trimmed: matching against the resume is whitespace-aware and handled in latex.ts.
  original: z.string().min(1),
  replacement: z.string().min(1),
  reason: z.string().trim().max(1000).default(""),
  keywords_covered: z.array(z.string().trim().min(1)).default([])
});

export const RawResponseSchema = z.object({
  keywords: z.array(z.unknown()),
  suggestions: z.array(z.unknown()),
  score_before: z.coerce.number().finite(),
  score_after: z.coerce.number().finite()
});

// --- What we keep after validating against the resume (also what is persisted).

export const ValidatedSuggestionSchema = SuggestionSchema.extend({
  match: z.enum(["exact", "fuzzy"])
});

export const DroppedSchema = z.object({
  kind: z.enum(["keyword", "suggestion"]),
  id: z.string(),
  reason: z.string()
});

export const AnalysisSchema = z.object({
  keywords: z.array(KeywordSchema),
  suggestions: z.array(ValidatedSuggestionSchema),
  score_before: z.number().min(0).max(100),
  score_after: z.number().min(0).max(100),
  dropped: z.array(DroppedSchema),
  /** Which resume the suggestions were written against. Analyses saved before the English resume existed were German. */
  language: z.enum(["de", "en"]).default("de"),
  model: z.string(),
  job_title: z.string(),
  company: z.string(),
  created_at: z.number()
});

export type Keyword = z.infer<typeof KeywordSchema>;
export type Suggestion = z.infer<typeof ValidatedSuggestionSchema>;
export type Dropped = z.infer<typeof DroppedSchema>;
export type Analysis = z.infer<typeof AnalysisSchema>;

// --- Gemini's structured-output schema (OpenAPI subset). Mirrors the zod schemas above.

export const ANALYSIS_RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    keywords: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          term: { type: "STRING" },
          importance: { type: "STRING", enum: [...IMPORTANCE] },
          category: { type: "STRING", enum: [...CATEGORY] },
          status: { type: "STRING", enum: [...STATUS] }
        },
        required: ["term", "importance", "category", "status"]
      }
    },
    suggestions: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          id: { type: "STRING" },
          section: { type: "STRING" },
          original: { type: "STRING", description: "Verbatim substring of the resume LaTeX" },
          replacement: { type: "STRING", description: "Valid LaTeX replacing `original`" },
          reason: { type: "STRING" },
          keywords_covered: { type: "ARRAY", items: { type: "STRING" } }
        },
        required: ["id", "section", "original", "replacement", "reason", "keywords_covered"]
      }
    },
    score_before: { type: "NUMBER", description: "0-100" },
    score_after: { type: "NUMBER", description: "0-100, if all suggestions were applied" }
  },
  required: ["keywords", "suggestions", "score_before", "score_after"]
} as const;

// --- Per-suggestion progress in the Resume tab, stored per analysis run.

export const CARD_STATUS = ["copied", "skipped", "applied", "failed"] as const;
export type CardStatus = (typeof CARD_STATUS)[number];

export const SuggestionStateSchema = z.object({
  created_at: z.number(),
  items: z.record(z.string(), z.object({ status: z.enum(CARD_STATUS), error: z.string().optional() }))
});
export type SuggestionStates = z.infer<typeof SuggestionStateSchema>["items"];

// --- Cover letter

export const TONES = ["formal", "friendly"] as const;
export const LANGUAGES = ["en", "de"] as const;
export type Tone = (typeof TONES)[number];
export type Language = (typeof LANGUAGES)[number];

export const CoverPrefsSchema = z.object({
  tone: z.enum(TONES).catch("formal"),
  language: z.enum(["auto", ...LANGUAGES]).catch("auto")
});
export type CoverPrefs = z.infer<typeof CoverPrefsSchema>;

export const CoverResponseSchema = z.object({
  latex: z.string().min(50),
  summary: z.string().trim().max(2000).default("")
});

export const CoverLetterSchema = z.object({
  latex: z.string(),
  summary: z.string(),
  warnings: z.array(z.string()),
  tone: z.enum(TONES),
  language: z.enum(LANGUAGES),
  model: z.string(),
  job_title: z.string(),
  company: z.string(),
  created_at: z.number()
});
export type CoverLetter = z.infer<typeof CoverLetterSchema>;

// --- Application questions ("Welche Erfahrungen bringen Sie mit …?")

/** CEFR level the answer is written at: B1 simple, B2 clear, C1 professional. */
export const LEVELS = ["b1", "b2", "c1"] as const;
export const LENGTHS = ["short", "medium", "long"] as const;
export type Level = (typeof LEVELS)[number];
export type Length = (typeof LENGTHS)[number];

export const AnswerPrefsSchema = z.object({
  language: z.enum(["auto", ...LANGUAGES]).catch("auto"),
  level: z.enum(LEVELS).catch("b2"),
  length: z.enum(LENGTHS).catch("medium"),
  /** Empty = the "pro" sibling of the main model (see defaultAnswerModel). */
  model: z.string().catch(""),
  /** 0 = no limit. Many forms cap the answer, e.g. at 1000 characters. */
  maxChars: z.number().int().min(0).max(20000).catch(0)
});
export type AnswerPrefs = z.infer<typeof AnswerPrefsSchema>;

export const AnswerSchema = z.object({
  id: z.string(),
  question: z.string(),
  answer: z.string(),
  warnings: z.array(z.string()),
  language: z.enum(LANGUAGES),
  level: z.enum(LEVELS),
  model: z.string(),
  created_at: z.number()
});
export type Answer = z.infer<typeof AnswerSchema>;

// --- LinkedIn outreach (plain text, so JSON mode is fine here)

/** LinkedIn's limit for the note on a connection request. */
export const NOTE_LIMIT = 300;

export const OUTREACH_FIELDS = [
  "connection_note",
  "email_subject",
  "email_body",
  "followup_note",
  "accepted_message",
  "referral_request"
] as const;
export type OutreachField = (typeof OUTREACH_FIELDS)[number];
/** The fields that have to fit LinkedIn's note limit. */
export const LIMITED_FIELDS = ["connection_note", "followup_note"] as const satisfies readonly OutreachField[];

export const OutreachResponseSchema = z.object({
  connection_note: z.string().trim().min(1),
  email_subject: z.string().trim().min(1).max(200),
  email_body: z.string().trim().min(1),
  followup_note: z.string().trim().min(1),
  accepted_message: z.string().trim().min(1),
  referral_request: z.string().trim().min(1)
});
export type OutreachResponse = z.infer<typeof OutreachResponseSchema>;

export const OUTREACH_RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: Object.fromEntries(OUTREACH_FIELDS.map((f) => [f, { type: "STRING" }])),
  required: [...OUTREACH_FIELDS]
} as const;

export const OutreachSchema = OutreachResponseSchema.extend({
  warnings: z.array(z.string()),
  tone: z.enum(TONES),
  language: z.enum(LANGUAGES),
  recipient: z.string().default(""),
  model: z.string(),
  job_title: z.string(),
  company: z.string(),
  created_at: z.number()
});
export type Outreach = z.infer<typeof OutreachSchema>;
