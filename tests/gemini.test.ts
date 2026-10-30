import { describe, expect, it, vi } from "vitest";
import {
  backoffMs,
  extractResponseText,
  generateJson,
  GeminiError,
  isCancelled,
  listModels,
  parseJsonText,
  retryDelayMs,
  thinkingModes
} from "@/lib/gemini";
import { analyzeJob } from "@/lib/analysis";
import { DEFAULT_SETTINGS } from "@/lib/storage";

const ok = (text: string) =>
  new Response(JSON.stringify({ candidates: [{ finishReason: "STOP", content: { parts: [{ text }] } }] }), { status: 200 });
const err = (status: number, message: string, extra: object = {}, headers: HeadersInit = {}) =>
  new Response(JSON.stringify({ error: { message, ...extra } }), { status, headers });

const base = { apiKey: "KEY", model: "m", system: "s", prompt: "p", responseSchema: {} };
const noSleep = () => Promise.resolve();

describe("extractResponseText / parseJsonText", () => {
  it("joins parts, skipping thought parts", () => {
    const data = { candidates: [{ content: { parts: [{ text: "x", thought: true }, { text: '{"a":' }, { text: "1}" }] } }] };
    expect(extractResponseText(data)).toBe('{"a":1}');
  });
  it("explains blocked prompts, truncation and empty answers", () => {
    expect(() => extractResponseText({ promptFeedback: { blockReason: "SAFETY" } })).toThrow(/blocked.*SAFETY/);
    expect(() => extractResponseText({ candidates: [{ finishReason: "MAX_TOKENS", content: { parts: [{ text: "{" }] } }] })).toThrow(/cut off/);
    expect(() => extractResponseText({ candidates: [{ content: { parts: [] } }] })).toThrow(/empty/);
  });
  it("parses fenced JSON and rejects garbage", () => {
    expect(parseJsonText('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(() => parseJsonText("not json")).toThrow(/malformed/);
  });
});

describe("retry timing", () => {
  it("reads Retry-After and RetryInfo", () => {
    expect(retryDelayMs(new Headers({ "retry-after": "7" }), undefined)).toBe(7000);
    expect(retryDelayMs(undefined, { error: { details: [{ retryDelay: "12.2s" }] } })).toBe(12200);
    expect(retryDelayMs(undefined, {})).toBeUndefined();
  });
  it("backs off exponentially", () => {
    expect([1, 2, 3].map((n) => backoffMs(n, () => 0))).toEqual([2000, 4000, 8000]);
  });
});

describe("generateJson", () => {
  it("sends the key as a header, JSON mode and a system instruction", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(ok('{"a":1}'));
    await expect(generateJson({ ...base, fetchImpl })).resolves.toEqual({ a: 1 });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toContain("/models/m:generateContent");
    expect(url).not.toContain("KEY");
    expect(init.headers["x-goog-api-key"]).toBe("KEY");
    const body = JSON.parse(init.body);
    expect(body.generationConfig.responseMimeType).toBe("application/json");
    expect(body.systemInstruction.parts[0].text).toBe("s");
  });

  it("limits thinking in the form the model family expects, falling back through the other forms", async () => {
    expect(thinkingModes("gemini-3.8-flash", "low")).toEqual([{ thinkingLevel: "low" }, { thinkingBudget: 512 }, undefined]);
    expect(thinkingModes("gemini-2.5-flash", "low")[0]).toEqual({ thinkingBudget: 512 });
    expect(thinkingModes("gemini-2.5-pro", "low")[0]).toEqual({ thinkingBudget: 128 });

    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(err(400, "Thinking level is not supported for this model"))
      .mockResolvedValueOnce(err(400, "thinking_budget is not supported"))
      .mockResolvedValueOnce(ok('{"a":1}'));
    await expect(generateJson({ ...base, model: "gemini-3.8-flash", fetchImpl })).resolves.toEqual({ a: 1 });
    const cfg = (i: number) => JSON.parse(fetchImpl.mock.calls[i][1].body).generationConfig.thinkingConfig;
    expect(cfg(0)).toEqual({ thinkingLevel: "low" });
    expect(cfg(1)).toEqual({ thinkingBudget: 512 });
    expect(cfg(2)).toBeUndefined();
  });

  it("retries 429 using the server's delay and reports it", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(err(429, "quota", { details: [{ retryDelay: "3s" }] }))
      .mockResolvedValueOnce(ok('{"a":1}'));
    const sleep = vi.fn(noSleep);
    const onRetry = vi.fn();
    await expect(generateJson({ ...base, fetchImpl, sleep, onRetry })).resolves.toEqual({ a: 1 });
    expect(sleep).toHaveBeenCalledWith(3000, undefined);
    expect(onRetry).toHaveBeenCalledWith(expect.objectContaining({ attempt: 1, waitMs: 3000 }));
  });

  it("retries 503 and malformed JSON with backoff, then gives up after 4 attempts", async () => {
    const fetchImpl = vi.fn().mockImplementation(async () => err(503, "overloaded"));
    const sleep = vi.fn(noSleep);
    await expect(generateJson({ ...base, fetchImpl, sleep })).rejects.toThrow(/temporarily unavailable/);
    expect(fetchImpl).toHaveBeenCalledTimes(4);
    expect(sleep).toHaveBeenCalledTimes(3);

    const flaky = vi.fn().mockResolvedValueOnce(ok("not json")).mockResolvedValueOnce(ok('{"b":2}'));
    await expect(generateJson({ ...base, fetchImpl: flaky, sleep: noSleep })).resolves.toEqual({ b: 2 });
  });

  it("does not wait out a long rate-limit window", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(err(429, "quota", { details: [{ retryDelay: "45s" }] }));
    const sleep = vi.fn(noSleep);
    await expect(generateJson({ ...base, fetchImpl, sleep })).rejects.toThrow(/rate limit.*45s/i);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("maps client errors to readable messages without retrying", async () => {
    const cases: [Response, RegExp][] = [
      [err(400, "API key not valid. Please pass a valid API key."), /API key/],
      [err(403, "denied"), /Check it in Settings/],
      [err(404, "models/m is not found"), /Model "m" was not found/],
      [err(400, "Unsupported schema"), /rejected the request: Unsupported schema/]
    ];
    for (const [res, re] of cases) {
      const fetchImpl = vi.fn().mockResolvedValue(res);
      await expect(generateJson({ ...base, fetchImpl, sleep: noSleep })).rejects.toThrow(re);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    }
  });

  it("reports network failures and supports cancellation", async () => {
    const down = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(generateJson({ ...base, fetchImpl: down, sleep: noSleep })).rejects.toThrow(/internet connection/);
    expect(down).toHaveBeenCalledTimes(4);

    const ctrl = new AbortController();
    ctrl.abort();
    const fetchImpl = vi.fn();
    const e = await generateJson({ ...base, fetchImpl, signal: ctrl.signal }).catch((x) => x);
    expect(isCancelled(e)).toBe(true);
    expect(e).toBeInstanceOf(GeminiError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("analyzeJob", () => {
  const settings = {
    ...DEFAULT_SETTINGS,
    apiKey: "KEY",
    baseResume: String.raw`mail: jane@x.io \resumeItem{Built APIs in Python.}`,
    extraFacts: "Call me on +49 171 1234567"
  };
  const job = { title: "Dev", company: "Acme", description: "Python developer wanted ".repeat(5), url: "" };
  const modelAnswer = {
    keywords: [{ term: "Python", importance: "must-have", category: "hard skill", status: "present" }],
    suggestions: [
      {
        id: "s1",
        section: "Exp",
        original: String.raw`\resumeItem{Built APIs in Python.}`,
        replacement: String.raw`\resumeItem{Built and documented APIs in Python.}`,
        reason: "r",
        keywords_covered: ["Python"]
      }
    ],
    score_before: 70,
    score_after: 80
  };

  it("redacts what it sends, but validates against the real resume", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(ok(JSON.stringify(modelAnswer)));
    const a = await analyzeJob({ settings, job, fetchImpl });
    const sent = JSON.parse(fetchImpl.mock.calls[0][1].body).contents[0].parts[0].text as string;
    expect(sent).not.toContain("jane@x.io");
    expect(sent).not.toContain("1234567");
    expect(sent).toContain("[email]");
    expect(a.suggestions).toHaveLength(1);
    expect(a.model).toBe(settings.model);
  });

  it("sends everything unredacted when redaction is off", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(ok(JSON.stringify(modelAnswer)));
    await analyzeJob({ settings: { ...settings, redactContact: false }, job, fetchImpl });
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body).contents[0].parts[0].text).toContain("jane@x.io");
  });

  it("refuses to run without a key, resume or description", async () => {
    await expect(analyzeJob({ settings: { ...settings, apiKey: "" }, job })).rejects.toThrow(/API key/);
    await expect(analyzeJob({ settings: { ...settings, baseResume: " " }, job })).rejects.toThrow(/resume/);
    await expect(analyzeJob({ settings, job: { ...job, description: "" } })).rejects.toThrow(/job description/);
  });
});

describe("analyzeJob learning note", () => {
  it("sends the note in its own block and tells the model it is not evidence for skills", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      ok(JSON.stringify({ keywords: [], suggestions: [], score_before: 50, score_after: 50 }))
    );
    const settings = { ...DEFAULT_SETTINGS, apiKey: "K", baseResume: "\item x", learningNote: "Keen to learn Go" };
    await analyzeJob({ settings, job: { title: "", company: "", description: "d".repeat(60), url: "" }, fetchImpl });
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(body.contents[0].parts[0].text).toContain("<learning_note>\nKeen to learn Go\n</learning_note>");
    expect(body.systemInstruction.parts[0].text).toMatch(/never evidence for a hard skill/);
  });
});

describe("listModels", () => {
  const page = (models: object[], next?: string) =>
    new Response(JSON.stringify({ models, nextPageToken: next }), { status: 200 });
  const m = (name: string, methods = ["generateContent"]) => ({ name: `models/${name}`, supportedGenerationMethods: methods });

  it("returns generateContent text models across pages, without the models/ prefix", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(page([m("gemini-b-flash"), m("text-embedding-x", ["embedContent"]), m("gemini-imagen-x")], "t2"))
      .mockResolvedValueOnce(page([m("gemini-a-flash-lite"), m("gemini-b-flash")]));
    await expect(listModels("KEY", fetchImpl)).resolves.toEqual(["gemini-b-flash", "gemini-a-flash-lite"]);
    expect(fetchImpl.mock.calls[0][1].headers["x-goog-api-key"]).toBe("KEY");
    expect(fetchImpl.mock.calls[1][0]).toContain("pageToken=t2");
  });

  it("explains a rejected key", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(err(400, "API key not valid"));
    await expect(listModels("bad", fetchImpl)).rejects.toThrow(/API key/);
  });
});
