import { useState } from "react";
import { Check, Copy, Loader2, Sparkles, Trash2, TriangleAlert, X } from "lucide-react";
import { defaultAnswerModel, LENGTH_LABEL, LEVEL_LABEL } from "@/lib/answers";
import { listModels } from "@/lib/gemini";
import { LENGTHS, LEVELS, type Answer, type AnswerPrefs } from "@/lib/schema";
import type { JobDraft, Settings } from "@/lib/storage";
import type { AnalysisStatus } from "../hooks/useAnalysis";
import { Elapsed } from "../components/Elapsed";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Textarea } from "../components/ui/textarea";

interface Props {
  settings: Settings;
  job: JobDraft;
  items: Answer[];
  prefs: AnswerPrefs;
  setPrefs: (patch: Partial<AnswerPrefs>) => void;
  status: AnalysisStatus;
  /** Resolves to true when an answer was added. */
  onAsk: (question: string) => Promise<boolean>;
  onEdit: (id: string, value: string) => void;
  onRemove: (id: string) => void;
  onCancel: () => void;
  goSettings: () => void;
}

const SELECT = "h-9 rounded-md border border-input bg-background px-2 text-sm";

function CopyButton({ text }: { text: string }) {
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
    <Button size="sm" onClick={() => void copy()} title={state === "error" ? "Couldn't access the clipboard. Select the text and copy it manually." : undefined}>
      {state === "copied" ? <Check /> : <Copy />} {state === "error" ? "Copy failed" : "Copy answer"}
    </Button>
  );
}

function AnswerCard({ a, maxChars, onEdit, onRemove }: { a: Answer; maxChars: number; onEdit: (v: string) => void; onRemove: () => void }) {
  const over = maxChars > 0 && a.answer.length > maxChars;
  return (
    <section className="flex flex-col gap-2 rounded-lg border border-border bg-card p-3" aria-label="Answer">
      <p className="whitespace-pre-wrap text-sm font-medium">{a.question}</p>
      <div className="text-xs text-muted-foreground">
        {a.language === "de" ? "German" : "English"} · {a.level.toUpperCase()} · {a.model}
      </div>
      {a.warnings.length > 0 && (
        <ul role="alert" className="flex list-disc flex-col gap-1 pl-5 text-xs text-warning">
          {a.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}
      <Textarea value={a.answer} rows={Math.max(5, Math.ceil(a.answer.length / 46))} onChange={(e) => onEdit(e.target.value)} aria-label="Answer text" aria-invalid={over} />
      <div className="flex flex-wrap items-center gap-2">
        <CopyButton text={a.answer} />
        <Button size="sm" variant="ghost" onClick={onRemove} title="Remove this answer">
          <Trash2 /> Remove
        </Button>
        <span className={`ml-auto text-xs tabular-nums ${over ? "font-medium text-destructive" : "text-muted-foreground"}`} aria-live="polite">
          {a.answer.length}
          {maxChars ? `/${maxChars}` : ""} characters
        </span>
      </div>
    </section>
  );
}

export function AnswersTab({ settings, job, items, prefs, setPrefs, status, onAsk, onEdit, onRemove, onCancel, goSettings }: Props) {
  const [question, setQuestion] = useState("");
  const [models, setModels] = useState<string[]>([]);
  const [modelsError, setModelsError] = useState("");
  const [loadingModels, setLoadingModels] = useState(false);
  const running = status.state === "running";
  const missing = !settings.apiKey ? "API key" : !settings.baseResume.trim() ? "base resume" : null;
  const autoModel = defaultAnswerModel(settings.model);

  async function loadModels() {
    setLoadingModels(true);
    setModelsError("");
    try {
      const ids = await listModels(settings.apiKey.trim());
      setModels(ids);
      if (!ids.length) setModelsError("No text models are available for this key.");
    } catch (e) {
      setModelsError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingModels(false);
    }
  }

  async function ask() {
    if (await onAsk(question)) setQuestion("");
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="text-sm">
        <div className="font-medium">
          {job.title || "No job selected"}
          {job.company ? ` at ${job.company}` : ""}
        </div>
        <p className="text-xs text-muted-foreground">
          Paste a question from an application form. The answer uses your resume, your extra facts and{" "}
          {job.description.trim() ? "the job description on the Job tab" : "the job description, if you add one on the Job tab"}.
        </p>
      </div>

      <label className="flex flex-col gap-1.5 text-sm font-medium">
        Question
        <Textarea
          value={question}
          rows={4}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Welche praktischen Erfahrungen bringen Sie in der webbasierten Frontend-Entwicklung mit?"
        />
      </label>

      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Language
          <select className={SELECT} value={prefs.language} onChange={(e) => setPrefs({ language: e.target.value as AnswerPrefs["language"] })}>
            <option value="auto">Match the question</option>
            <option value="de">German</option>
            <option value="en">English</option>
          </select>
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Language level
          <select className={SELECT} value={prefs.level} onChange={(e) => setPrefs({ level: e.target.value as AnswerPrefs["level"] })}>
            {LEVELS.map((l) => (
              <option key={l} value={l}>
                {LEVEL_LABEL[l]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Length
          <select className={SELECT} value={prefs.length} onChange={(e) => setPrefs({ length: e.target.value as AnswerPrefs["length"] })}>
            {LENGTHS.map((l) => (
              <option key={l} value={l}>
                {LENGTH_LABEL[l]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Character limit <span className="font-normal text-muted-foreground">0 = none</span>
          <Input
            type="number"
            min={0}
            max={20000}
            step={50}
            value={prefs.maxChars || ""}
            placeholder="e.g. 1000"
            onChange={(e) => setPrefs({ maxChars: Math.max(0, Math.min(20000, Math.floor(Number(e.target.value)) || 0)) })}
          />
        </label>
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Model <span className="font-normal text-muted-foreground">empty = {autoModel}. A pro model writes better German.</span>
          <Input value={prefs.model} onChange={(e) => setPrefs({ model: e.target.value })} placeholder={autoModel} spellCheck={false} />
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" disabled={!settings.apiKey || loadingModels} onClick={() => void loadModels()}>
            {loadingModels ? <Loader2 className="animate-spin" /> : null} Show available models
          </Button>
          {models.length > 0 && (
            <select
              aria-label="Available models"
              className={SELECT}
              value={models.includes(prefs.model) ? prefs.model : ""}
              onChange={(e) => e.target.value && setPrefs({ model: e.target.value })}
            >
              <option value="">Pick one of {models.length}…</option>
              {models.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          )}
        </div>
        {modelsError && (
          <p role="alert" className="text-xs text-destructive">
            {modelsError}
          </p>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        {running ? (
          <Button variant="outline" onClick={onCancel}>
            <X /> Cancel
          </Button>
        ) : (
          <Button onClick={() => void ask()} disabled={!!missing || !question.trim()}>
            <Sparkles /> Write answer
          </Button>
        )}
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
      {running && (
        <p role="status" className="flex items-start gap-2 text-sm text-muted-foreground">
          <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin" />
          <span>
            {status.note || "Writing your answer with Gemini…"} <Elapsed />
          </span>
        </p>
      )}
      {status.state === "error" && (
        <p role="alert" className="flex items-start gap-2 text-sm text-destructive">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" />
          <span>{status.message}</span>
        </p>
      )}

      {items.length > 0 && (
        <div className="flex flex-col gap-4 border-t border-border pt-4" aria-label="Answers">
          {items.map((a) => (
            <AnswerCard key={a.id} a={a} maxChars={prefs.maxChars} onEdit={(v) => onEdit(a.id, v)} onRemove={() => onRemove(a.id)} />
          ))}
          <p className="text-xs text-muted-foreground">Read each answer before sending. It only uses facts from your resume, extra facts and the job posting.</p>
        </div>
      )}
    </div>
  );
}
