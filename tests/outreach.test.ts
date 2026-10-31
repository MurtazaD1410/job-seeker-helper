import { describe, expect, it, vi } from "vitest";
import { generateOutreach, overLimit, validateOutreach } from "@/lib/outreach";
import { clearJobData, loadOutreach, saveOutreach, saveSettings, loadSettings } from "@/lib/storage";
import { DEFAULT_SETTINGS } from "@/lib/storage";
import type { Outreach } from "@/lib/schema";

const good = {
  connection_note: "Hi Anna, I'm a React developer and the Frontend role at Acme caught my eye. Happy to connect.",
  email_subject: "Interest in the Frontend role at Acme",
  email_body: "Hello Anna,\n\nI'm a React developer and I'd like to learn more about Acme.\n\nBest regards,\nMax",
  followup_note: "Hi Anna, I just applied for the Frontend role at Acme. My React background fits well. Thank you!",
  accepted_message: "Thanks for connecting, Anna. I applied for the Frontend role. Could we talk for 15 minutes?",
  referral_request: "Hi, I'm interested in the Frontend team. Could you share your view on it in two minutes?"
};
const ctx = { knownText: "React 18 Acme", userText: "React developer", unsupported: ["Golang"] };

describe("validateOutreach", () => {
  it("accepts a complete answer with no warnings", () => {
    expect(validateOutreach(good, ctx).warnings).toEqual([]);
  });

  it("rejects a malformed answer", () => {
    expect(() => validateOutreach({ ...good, email_body: "" }, ctx)).toThrow(/expected structure/);
    expect(() => validateOutreach({ connection_note: "x" }, ctx)).toThrow(/expected structure/);
  });

  it("rejects leftover redaction placeholders", () => {
    expect(() => validateOutreach({ ...good, email_body: "Write to [email-1]" }, ctx)).toThrow(/placeholder/);
  });

  it("warns about invented numbers and unsupported skills", () => {
    const { warnings } = validateOutreach({ ...good, connection_note: "I led 12 engineers and use Golang daily." }, ctx);
    expect(warnings.join("\n")).toMatch(/"12"/);
    expect(warnings.join("\n")).toMatch(/Golang/);
  });

  it("finds notes over the 300 character limit", () => {
    expect(overLimit({ connection_note: "a".repeat(301), followup_note: "b".repeat(300) })).toEqual(["connection_note"]);
  });
});

function settings() {
  return { ...DEFAULT_SETTINGS, apiKey: "K", baseResume: "React developer, Max Mustermann", extraFacts: "", redactContact: true };
}
const job = { title: "Frontend", company: "Acme", description: "We need React 18. ".repeat(10), url: "" };
const reply = (o: object) => async () =>
  new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(o) }] } }] }), { status: 200 });

describe("generateOutreach", () => {
  it("returns the messages with the chosen tone and language", async () => {
    const fetchImpl = vi.fn(reply(good)) as unknown as typeof fetch;
    const r = await generateOutreach({ settings: settings(), job, analysis: null, tone: "friendly", language: "en", recipient: " Anna ", fetchImpl });
    expect(r).toMatchObject({ connection_note: good.connection_note, tone: "friendly", language: "en", recipient: "Anna", company: "Acme" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("asks once for a shorter version when a note is too long, and uses it", async () => {
    const long = { ...good, connection_note: "x".repeat(320) };
    const fetchImpl = vi.fn().mockImplementationOnce(reply(long)).mockImplementationOnce(reply(good)) as unknown as typeof fetch;
    const r = await generateOutreach({ settings: settings(), job, analysis: null, tone: "formal", language: "en", fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(r.connection_note).toBe(good.connection_note);
    const body = String((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[1][1].body);
    expect(body).toMatch(/connection_note \(320 characters\)/);
  });

  it("keeps the first answer if the retry is unusable", async () => {
    const long = { ...good, followup_note: "y".repeat(350) };
    const fetchImpl = vi.fn().mockImplementationOnce(reply(long)).mockImplementationOnce(reply({ nope: 1 })) as unknown as typeof fetch;
    const r = await generateOutreach({ settings: settings(), job, analysis: null, tone: "formal", language: "en", fetchImpl, sleep: async () => {} });
    expect(r.followup_note).toHaveLength(350);
  });

  it("never sends the candidate's email or phone", async () => {
    const fetchImpl = vi.fn(reply(good)) as unknown as typeof fetch;
    const s = { ...settings(), baseResume: "Max Mustermann max@example.com +49 170 1234567" };
    await generateOutreach({ settings: s, job, analysis: null, tone: "formal", language: "en", fetchImpl });
    const body = String((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
    expect(body).not.toContain("max@example.com");
    expect(body).not.toContain("1234567");
  });

  it("explains what's missing", async () => {
    await expect(generateOutreach({ settings: { ...settings(), apiKey: "" }, job, analysis: null, tone: "formal", language: "en" })).rejects.toThrow(/API key/);
    await expect(generateOutreach({ settings: settings(), job: { ...job, description: " " }, analysis: null, tone: "formal", language: "en" })).rejects.toThrow(/job description/);
  });
});

describe("outreach storage", () => {
  it("is stored and removed by clearJobData", async () => {
    const data: Record<string, unknown> = {};
    vi.stubGlobal("chrome", {
      storage: {
        local: {
          get: async (k: string) => (k in data ? { [k]: data[k] } : {}),
          set: async (o: Record<string, unknown>) => void Object.assign(data, o),
          remove: async (k: string | string[]) => void (Array.isArray(k) ? k : [k]).forEach((x) => delete data[x])
        }
      }
    });
    await saveSettings({ ...(await loadSettings()), apiKey: "KEY" });
    const pack: Outreach = { ...good, warnings: [], tone: "formal", language: "en", recipient: "", model: "m", job_title: "F", company: "Acme", created_at: 1 };
    await saveOutreach(pack);
    expect(await loadOutreach()).toEqual(pack);
    await clearJobData();
    expect(await loadOutreach()).toBeNull();
    expect(await loadSettings()).toMatchObject({ apiKey: "KEY" });
    vi.unstubAllGlobals();
  });
});
