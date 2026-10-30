const API_ROOT = "https://generativelanguage.googleapis.com/v1beta/models";

const MAX_ATTEMPTS = 4;
const TIMEOUT_MS = 180_000;
/** Longest wait we will sit through automatically; beyond this we report the limit instead. */
const MAX_AUTO_WAIT_MS = 30_000;

export class GeminiError extends Error {
  constructor(
    message: string,
    readonly opts: { status?: number; retryable?: boolean; retryAfterMs?: number; cancelled?: boolean } = {}
  ) {
    super(message);
    this.name = "GeminiError";
  }
}

export const isCancelled = (e: unknown) => e instanceof GeminiError && !!e.opts.cancelled;

export interface RetryInfo {
  attempt: number;
  maxAttempts: number;
  waitMs: number;
  reason: string;
}

export interface GenerateJsonOptions {
  apiKey: string;
  model: string;
  system: string;
  prompt: string;
  responseSchema: object;
  temperature?: number;
  maxOutputTokens?: number;
  /** Reasoning effort. Thinking models are slow by default; "low" keeps analysis fast. Dropped automatically if the model rejects it. */
  thinkingLevel?: "minimal" | "low" | "medium" | "high";
  signal?: AbortSignal;
  onRetry?: (info: RetryInfo) => void;
  // Injectable for tests.
  fetchImpl?: typeof fetch;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

const defaultSleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        reject(new GeminiError("Cancelled.", { cancelled: true }));
      },
      { once: true }
    );
  });

/** Wait time requested by the server: Retry-After header or the RetryInfo detail ("12s"). */
export function retryDelayMs(headers: Headers | undefined, body: unknown): number | undefined {
  const header = Number(headers?.get("retry-after"));
  if (Number.isFinite(header) && header > 0) return header * 1000;
  const details = (body as { error?: { details?: { retryDelay?: unknown }[] } } | undefined)?.error?.details;
  for (const d of details ?? []) {
    const m = typeof d?.retryDelay === "string" ? /^(\d+(?:\.\d+)?)s$/.exec(d.retryDelay) : null;
    if (m) return Math.ceil(Number(m[1]) * 1000);
  }
  return undefined;
}

export function backoffMs(attempt: number, random = Math.random): number {
  return 2000 * 2 ** (attempt - 1) + Math.floor(random() * 500);
}

function httpError(status: number, body: unknown, model: string, headers: Headers): GeminiError {
  const apiMsg = (body as { error?: { message?: string } } | undefined)?.error?.message ?? "";
  const retryAfterMs = retryDelayMs(headers, body);
  if (status === 429) {
    const hint = retryAfterMs ? ` Try again in about ${Math.ceil(retryAfterMs / 1000)}s.` : "";
    return new GeminiError(`Gemini rate limit reached (free-tier quota).${hint}`, { status, retryable: true, retryAfterMs });
  }
  if (status >= 500) {
    return new GeminiError(`Gemini is temporarily unavailable (HTTP ${status}).`, { status, retryable: true, retryAfterMs });
  }
  if (status === 404) {
    return new GeminiError(`Model "${model}" was not found. Check the model name in Settings.`, { status });
  }
  if (status === 401 || status === 403 || (status === 400 && /api key/i.test(apiMsg))) {
    return new GeminiError(`Gemini rejected your API key or access (${apiMsg || `HTTP ${status}`}). Check it in Settings.`, { status });
  }
  return new GeminiError(`Gemini rejected the request: ${apiMsg || `HTTP ${status}`}`, { status });
}

/** Pulls the JSON text out of a generateContent response, or throws a readable error. */
export function extractResponseText(data: unknown): string {
  const d = data as {
    promptFeedback?: { blockReason?: string };
    candidates?: { finishReason?: string; content?: { parts?: { text?: string; thought?: boolean }[] } }[];
  };
  const cand = d?.candidates?.[0];
  if (!cand) {
    const reason = d?.promptFeedback?.blockReason;
    throw new GeminiError(
      reason ? `Gemini blocked the request (${reason}).` : "Gemini returned no answer. Try again.",
      { retryable: !reason }
    );
  }
  const text = (cand.content?.parts ?? [])
    .filter((p) => !p.thought)
    .map((p) => p.text ?? "")
    .join("");
  if (cand.finishReason === "SAFETY" || cand.finishReason === "RECITATION") {
    throw new GeminiError(`Gemini stopped the answer (${cand.finishReason}).`);
  }
  if (cand.finishReason === "MAX_TOKENS") {
    throw new GeminiError("Gemini's answer was cut off. Try a shorter job description or resume.");
  }
  if (!text.trim()) throw new GeminiError("Gemini returned an empty answer. Try again.", { retryable: true });
  return text;
}

export function parseJsonText(text: string): unknown {
  const stripped = text.replace(/^\s*```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
  try {
    return JSON.parse(stripped);
  } catch {
    throw new GeminiError("Gemini returned malformed JSON.", { retryable: true });
  }
}

type ThinkingConfig = { thinkingLevel: string } | { thinkingBudget: number } | undefined;

/**
 * Ways to limit reasoning, most likely first. Gemini 2.5 takes a token budget, Gemini 3+ a level;
 * if the model rejects one form we fall back to the next (finally: no limit).
 */
export function thinkingModes(model: string, level: string): ThinkingConfig[] {
  const budget: ThinkingConfig = { thinkingBudget: /pro/i.test(model) ? 128 : 512 };
  const lvl: ThinkingConfig = { thinkingLevel: level };
  return /gemini-2.5/i.test(model) ? [budget, lvl, undefined] : [lvl, budget, undefined];
}

/** One generateContent call in JSON mode, with retry and backoff on 429, 5xx and malformed output. */
async function generate(o: GenerateJsonOptions & { plain?: boolean }): Promise<unknown> {
  const doFetch = o.fetchImpl ?? fetch;
  const sleep = o.sleep ?? defaultSleep;

  const modes = thinkingModes(o.model, o.thinkingLevel ?? "low");
  let mode = 0;
  const attemptOnce = async (): Promise<unknown> => {
    if (o.signal?.aborted) throw new GeminiError("Cancelled.", { cancelled: true });
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    o.signal?.addEventListener("abort", onAbort, { once: true });
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      let res: Response;
      try {
        res = await doFetch(`${API_ROOT}/${encodeURIComponent(o.model)}:generateContent`, {
          method: "POST",
          signal: controller.signal,
          headers: { "Content-Type": "application/json", "x-goog-api-key": o.apiKey },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: o.system }] },
            contents: [{ role: "user", parts: [{ text: o.prompt }] }],
            generationConfig: {
              ...(o.plain ? {} : { responseMimeType: "application/json", responseSchema: o.responseSchema }),
              temperature: o.temperature ?? 0.2,
              maxOutputTokens: o.maxOutputTokens ?? 8192,
              ...(modes[mode] ? { thinkingConfig: modes[mode] } : {})
            }
          })
        });
      } catch (e) {
        if (o.signal?.aborted) throw new GeminiError("Cancelled.", { cancelled: true });
        if (controller.signal.aborted) {
          throw new GeminiError(`Gemini took longer than ${TIMEOUT_MS / 1000}s. Try again or pick a faster model in Settings.`);
        }
        throw new GeminiError("Couldn't reach Gemini. Check your internet connection.", { retryable: true });
      }

      const raw = await res.text();
      let body: unknown;
      try {
        body = JSON.parse(raw);
      } catch {
        body = undefined;
      }
      if (!res.ok) {
        const msg = (body as { error?: { message?: string } } | undefined)?.error?.message ?? "";
        // Not every model accepts every thinkingConfig form: try the next one.
        if (res.status === 400 && mode < modes.length - 1 && /thinking/i.test(msg)) {
          mode++;
          return await attemptOnce();
        }
        throw httpError(res.status, body, o.model, res.headers);
      }
      const text = extractResponseText(body);
      return o.plain ? text : parseJsonText(text);
    } finally {
      clearTimeout(timer);
      o.signal?.removeEventListener("abort", onAbort);
    }
  };

  for (let attempt = 1; ; attempt++) {
    try {
      return await attemptOnce();
    } catch (e) {
      if (!(e instanceof GeminiError) || !e.opts.retryable) throw e;
      const waitMs = e.opts.retryAfterMs ?? backoffMs(attempt);
      // Out of attempts, or the server wants a long pause (e.g. per-minute quota): report instead of hanging.
      if (attempt >= MAX_ATTEMPTS || waitMs > MAX_AUTO_WAIT_MS) throw e;
      o.onRetry?.({ attempt, maxAttempts: MAX_ATTEMPTS, waitMs, reason: e.message });
      await sleep(waitMs, o.signal);
    }
  }
}

interface ModelEntry {
  name?: string;
  supportedGenerationMethods?: string[];
}

// Models that can't answer a text prompt with JSON.
const NOT_TEXT_MODEL = /embed|imagen|veo|tts|image|audio|live|robotics|computer-use/i;

/** IDs of the models this API key can use for generateContent (e.g. "gemini-2.5-flash"), newest names first. */
export async function listModels(apiKey: string, fetchImpl: typeof fetch = fetch): Promise<string[]> {
  const ids = new Set<string>();
  let pageToken = "";
  for (let page = 0; page < 10; page++) {
    let res: Response;
    try {
      res = await fetchImpl(`${API_ROOT}?pageSize=200${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""}`, {
        headers: { "x-goog-api-key": apiKey }
      });
    } catch {
      throw new GeminiError("Couldn't reach Gemini. Check your internet connection.");
    }
    let body: { models?: ModelEntry[]; nextPageToken?: string } | undefined;
    try {
      body = JSON.parse(await res.text());
    } catch {
      body = undefined;
    }
    if (!res.ok) throw httpError(res.status, body, "", res.headers);
    for (const m of body?.models ?? []) {
      const id = m.name?.replace(/^models\//, "");
      if (id && m.supportedGenerationMethods?.includes("generateContent") && !NOT_TEXT_MODEL.test(id)) ids.add(id);
    }
    pageToken = body?.nextPageToken ?? "";
    if (!pageToken) break;
  }
  return [...ids].sort().reverse();
}

export const generateJson = (o: GenerateJsonOptions): Promise<unknown> => generate(o);

/**
 * Plain-text answer, same retry handling. Use it when the output is LaTeX: inside a JSON string every
 * backslash has to be doubled, and models sometimes get that wrong (\\ turns into \).
 */
export async function generateText(o: Omit<GenerateJsonOptions, "responseSchema">): Promise<string> {
  return (await generate({ ...o, responseSchema: {}, plain: true })) as string;
}
