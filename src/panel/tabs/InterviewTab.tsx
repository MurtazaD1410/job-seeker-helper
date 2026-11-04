import { useState } from "react";
import { Check, Copy, Loader2, Sparkles, TriangleAlert, X } from "lucide-react";
import { defaultAnswerModel } from "@/lib/answers";
import { interviewToText, isThinDescription } from "@/lib/interview";
import type { InterviewPack, InterviewPrefs, InterviewQuestion } from "@/lib/schema";
import type { JobDraft, Settings } from "@/lib/storage";
import type { AnalysisStatus } from "../hooks/useAnalysis";
import { Elapsed } from "../components/Elapsed";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Textarea } from "../components/ui/textarea";

interface Props {
  settings: Settings;
  job: JobDraft;
  pack: InterviewPack | null;
  notes: string;
  setNotes: (v: string) => void;
  prefs: InterviewPrefs;
  setPrefs: (patch: Partial<InterviewPrefs>) => void;
  status: AnalysisStatus;
  onGenerate: () => void;
  onCancel: () => void;
  goSettings: () => void;
  goJob: () => void;
}

const SELECT = "h-9 rounded-md border border-input bg-background px-2 text-sm";
const CATEGORY_LABEL: Record<InterviewQuestion["category"], string> = { technical: "Technical", behavioral: "Behavioral", role: "Role and company" };

function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [state, setState] = useState<"idle" | "copied" | "error">("idle");
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setState("copied");
    } catch {
      setState("error");
    }
  }
  return (
    <Button size="sm" variant="outline" onClick={() => void copy()} title={state === "error" ? "Couldn't access the clipboard. Select the text and copy it manually." : undefined}>
      {state === "copied" ? <Check /> : <Copy />} {state === "error" ? "Copy failed" : label}
    </Button>
  );
}

function Section({ title, copyText, children }: { title: string; copyText?: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3 rounded-lg border border-border bg-card p-3" aria-label={title}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{title}</h3>
        {copyText && <CopyButton text={copyText} />}
      </div>
      {children}
    </section>
  );
}

function Points({ items }: { items: string[] }) {
  if (!items.length) return null;
  return (
    <ul className="flex list-disc flex-col gap-1 pl-5 text-sm">
      {items.map((t) => (
        <li key={t}>{t}</li>
      ))}
    </ul>
  );
}

function QuestionCard({ q, index }: { q: InterviewQuestion; index: number }) {
  return (
    <div className="flex flex-col gap-2 border-t border-border pt-3 first:border-t-0 first:pt-0">
      <div className="text-xs text-muted-foreground">{CATEGORY_LABEL[q.category]}</div>
      <p className="text-sm font-medium">
        {index + 1}. {q.question}
      </p>
      {q.why_asked && <p className="text-xs text-muted-foreground">{q.why_asked}</p>}
      <Points items={q.talking_points} />
      {q.star && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-md bg-muted/50 p-2 text-sm">
          {(["situation", "task", "action", "result"] as const).map((k) => (
            <div key={k} className="contents">
              <dt className="text-xs font-medium uppercase text-muted-foreground">{k}</dt>
              <dd>{q.star![k]}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

export function InterviewTab({ settings, job, pack, notes, setNotes, prefs, setPrefs, status, onGenerate, onCancel, goSettings, goJob }: Props) {
  const running = status.state === "running";
  const missing = !settings.apiKey ? "API key" : !settings.baseResume.trim() ? "base resume" : null;
  const hasInput = !!(job.title.trim() || job.description.trim() || notes.trim());
  const thin = isThinDescription(job.description);
  const autoModel = defaultAnswerModel(settings.model);
  const byCategory = pack ? (["technical", "behavioral", "role"] as const).map((c) => ({ c, items: pack.questions.filter((q) => q.category === c) })) : [];

  return (
    <div className="flex flex-col gap-4">
      <div className="text-sm">
        <div className="font-medium">
          {job.title || "No job selected"}
          {job.company ? ` at ${job.company}` : ""}
        </div>
        <p className="text-xs text-muted-foreground">
          Builds a prep pack from your resume, the job description and your notes below. Set the job title and company on the{" "}
          <button type="button" onClick={goJob} className="cursor-pointer underline">
            Job tab
          </button>
          .
        </p>
      </div>

      {thin && (
        <p className="rounded-md border border-border bg-card p-2 text-xs text-muted-foreground">
          {job.description.trim()
            ? "The job description is short, so the questions will be less targeted."
            : "No job description. The questions will be typical for the role and your resume, not for this company. Paste what you remember in the notes below to sharpen them."}
        </p>
      )}

      <label className="flex flex-col gap-1.5 text-sm font-medium">
        Your notes about this job <span className="font-normal text-muted-foreground">optional</span>
        <Textarea
          value={notes}
          rows={5}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="What you remember of the posting (tasks, tech stack, requirements), what was said in a call, who you speak to…"
        />
      </label>

      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Language
          <select className={SELECT} value={prefs.language} onChange={(e) => setPrefs({ language: e.target.value as InterviewPrefs["language"] })}>
            <option value="auto">Match the job</option>
            <option value="de">German</option>
            <option value="en">English</option>
          </select>
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Model <span className="font-normal text-muted-foreground">empty = {autoModel}</span>
          <Input value={prefs.model} onChange={(e) => setPrefs({ model: e.target.value })} placeholder={autoModel} spellCheck={false} />
        </label>
      </div>

      <div className="flex flex-wrap gap-2">
        {running ? (
          <Button variant="outline" onClick={onCancel}>
            <X /> Cancel
          </Button>
        ) : (
          <Button onClick={onGenerate} disabled={!!missing || !hasInput}>
            <Sparkles /> {pack ? "Regenerate prep" : "Prepare interview"}
          </Button>
        )}
        {pack && <CopyButton text={interviewToText(pack)} label="Copy everything" />}
      </div>

      {missing && (
        <p className="text-sm text-muted-foreground">
          Add your {missing} in{" "}
          <button type="button" onClick={goSettings} className="cursor-pointer underline">
            Settings
          </button>{" "}
          first.
        </p>
      )}
      {!missing && !hasInput && <p className="text-sm text-muted-foreground">Add a job title on the Job tab, or a few notes above.</p>}
      {running && (
        <p role="status" className="flex items-start gap-2 text-sm text-muted-foreground">
          <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin" />
          <span>
            {status.note || "Preparing your interview with Gemini. This can take a minute…"} <Elapsed />
          </span>
        </p>
      )}
      {status.state === "error" && (
        <p role="alert" className="flex items-start gap-2 text-sm text-destructive">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" />
          <span>{status.message}</span>
        </p>
      )}

      {pack && (
        <div className="flex flex-col gap-4 border-t border-border pt-4">
          <div className="text-xs text-muted-foreground">
            {pack.language === "de" ? "German" : "English"} · {pack.model}
            {pack.thin ? " · generic for the role (no full job description)" : ""}
          </div>

          {pack.warnings.length > 0 && (
            <ul role="alert" className="flex list-disc flex-col gap-1 pl-5 text-xs text-warning">
              {pack.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          )}

          <Section title="Tell me about yourself" copyText={pack.pitch}>
            <p className="whitespace-pre-wrap text-sm">{pack.pitch}</p>
          </Section>

          <Section title={`Likely questions (${pack.questions.length})`}>
            {byCategory
              .filter((g) => g.items.length)
              .map((g) => (
                <div key={g.c} className="flex flex-col gap-3">
                  {g.items.map((q) => (
                    <QuestionCard key={q.question} q={q} index={pack.questions.indexOf(q)} />
                  ))}
                </div>
              ))}
          </Section>

          {pack.gaps.length > 0 && (
            <Section title="Addressing gaps honestly">
              {pack.gaps.map((g) => (
                <div key={g.skill} className="flex flex-col gap-1.5 border-t border-border pt-3 first:border-t-0 first:pt-0">
                  <div className="text-xs font-medium uppercase text-muted-foreground">{g.skill}</div>
                  <p className="text-sm font-medium">{g.likely_question}</p>
                  <p className="whitespace-pre-wrap text-sm">{g.honest_answer}</p>
                  <Points items={g.study} />
                </div>
              ))}
            </Section>
          )}

          {pack.ask_them.length > 0 && (
            <Section title="Questions to ask them" copyText={pack.ask_them.map((a) => `- ${a}`).join("\n")}>
              <Points items={pack.ask_them} />
            </Section>
          )}

          {pack.study_list.length > 0 && (
            <Section title="Study list" copyText={pack.study_list.map((s) => `- ${s.topic}${s.why ? `: ${s.why}` : ""}`).join("\n")}>
              <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-sm">
                {pack.study_list.map((s) => (
                  <li key={s.topic}>
                    <span className="font-medium">{s.topic}</span>
                    {s.why && <span className="text-muted-foreground"> · {s.why}</span>}
                  </li>
                ))}
              </ol>
            </Section>
          )}

          <p className="text-xs text-muted-foreground">Read everything before you rely on it. It only uses facts from your resume, extra facts, notes and the job posting.</p>
        </div>
      )}
    </div>
  );
}
