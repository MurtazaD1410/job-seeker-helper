import { useState } from "react";
import { Check, Copy, Loader2, Sparkles, TriangleAlert, X } from "lucide-react";
import { FIELD_LABEL } from "@/lib/outreach";
import { NOTE_LIMIT, type Analysis, type CoverPrefs, type Outreach, type OutreachField } from "@/lib/schema";
import type { JobDraft, Settings } from "@/lib/storage";
import type { AnalysisStatus } from "../hooks/useAnalysis";
import { Elapsed } from "../components/Elapsed";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Textarea } from "../components/ui/textarea";

interface Props {
  settings: Settings;
  job: JobDraft;
  analysis: Analysis | null;
  pack: Outreach | null;
  prefs: CoverPrefs;
  setPrefs: (patch: Partial<CoverPrefs>) => void;
  status: AnalysisStatus;
  onGenerate: (recipient: string) => void;
  onEdit: (field: OutreachField, value: string) => void;
  onCancel: () => void;
  goSettings: () => void;
  goJob: () => void;
}

const SELECT = "h-9 rounded-md border border-input bg-background px-2 text-sm";

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
    <Button size="sm" variant="secondary" onClick={() => void copy()} title={state === "error" ? "Couldn't access the clipboard. Select the text and copy it manually." : undefined}>
      {state === "copied" ? <Check /> : <Copy />} {state === "error" ? "Copy failed" : label}
    </Button>
  );
}

/** One message: an editable box with a character counter (red when over `limit`) and a Copy button. */
function Message({
  title,
  hint,
  value,
  limit,
  extra,
  onChange
}: {
  title: string;
  hint: string;
  value: string;
  limit?: number;
  extra?: boolean;
  onChange: (v: string) => void;
}) {
  const over = limit !== undefined && value.length > limit;
  return (
    <section className="flex flex-col gap-1.5" aria-label={title}>
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-medium">
          {title}
          {extra && <span className="ml-2 text-xs font-normal text-muted-foreground">extra</span>}
        </h3>
        {limit !== undefined && (
          <span className={`text-xs tabular-nums ${over ? "font-medium text-destructive" : "text-muted-foreground"}`} aria-live="polite">
            {value.length}/{limit}
          </span>
        )}
      </div>
      <p className="text-xs text-muted-foreground">{hint}</p>
      <Textarea value={value} rows={Math.max(3, Math.ceil(value.length / 46))} onChange={(e) => onChange(e.target.value)} aria-invalid={over} />
      <div>
        <CopyButton text={value} />
      </div>
    </section>
  );
}

export function LinkedInTab({ settings, job, analysis, pack, prefs, setPrefs, status, onGenerate, onEdit, onCancel, goSettings, goJob }: Props) {
  const [recipient, setRecipient] = useState(pack?.recipient ?? "");
  const running = status.state === "running";
  const missing = !settings.apiKey ? "API key" : !settings.baseResume.trim() ? "base resume" : null;
  const noJob = job.description.trim().length < 50;

  return (
    <div className="flex flex-col gap-4">
      <div className="text-sm">
        <div className="font-medium">
          {job.title || "No job selected"}
          {job.company ? ` at ${job.company}` : ""}
        </div>
        {noJob && (
          <p className="text-xs text-muted-foreground">
            Add a job description on the{" "}
            <button type="button" onClick={goJob} className="cursor-pointer underline">
              Job tab
            </button>{" "}
            first.
          </p>
        )}
        {analysis && <p className="text-xs text-muted-foreground">Uses the keywords from your latest analysis.</p>}
      </div>

      <label className="flex flex-col gap-1.5 text-sm font-medium">
        Who is it for? <span className="font-normal text-muted-foreground">optional, e.g. "Anna, Engineering Manager"</span>
        <Input value={recipient} maxLength={120} onChange={(e) => setRecipient(e.target.value)} placeholder="Name and role" />
      </label>

      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Tone
          <select className={SELECT} value={prefs.tone} onChange={(e) => setPrefs({ tone: e.target.value as CoverPrefs["tone"] })}>
            <option value="formal">Formal</option>
            <option value="friendly">Friendly</option>
          </select>
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Language
          <select className={SELECT} value={prefs.language} onChange={(e) => setPrefs({ language: e.target.value as CoverPrefs["language"] })}>
            <option value="auto">Match the job posting</option>
            <option value="en">English</option>
            <option value="de">German</option>
          </select>
        </label>
      </div>

      <div className="flex flex-wrap gap-2">
        {running ? (
          <Button variant="outline" onClick={onCancel}>
            <X /> Cancel
          </Button>
        ) : (
          <Button onClick={() => onGenerate(recipient)} disabled={!!missing || noJob}>
            <Sparkles /> {pack ? "Regenerate" : "Write messages"}
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
            {status.note || "Writing your messages with Gemini…"} <Elapsed />
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
        <div className={`flex flex-col gap-5 border-t border-border pt-4 ${running ? "opacity-60" : ""}`} aria-label="LinkedIn messages">
          <div className="text-xs text-muted-foreground">
            {pack.tone === "formal" ? "Formal" : "Friendly"} · {pack.language === "de" ? "German" : "English"}
            {pack.recipient ? ` · for ${pack.recipient}` : ""}
            {pack.job_title ? ` · ${pack.job_title}` : ""}
            {pack.company ? ` at ${pack.company}` : ""}
          </div>

          {pack.warnings.length > 0 && (
            <ul role="alert" className="flex list-disc flex-col gap-1 rounded-lg border border-border bg-card p-3 pl-7 text-sm text-warning">
              {pack.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          )}

          <Message
            title={FIELD_LABEL.connection_note}
            hint="Send with your connection request, before you apply."
            value={pack.connection_note}
            limit={NOTE_LIMIT}
            onChange={(v) => onEdit("connection_note", v)}
          />

          <section className="flex flex-col gap-1.5" aria-label="Email">
            <h3 className="text-sm font-medium">Email: interest in the company</h3>
            <p className="text-xs text-muted-foreground">For a direct mail to someone at the company.</p>
            <Input value={pack.email_subject} aria-label="Email subject" onChange={(e) => onEdit("email_subject", e.target.value)} />
            <Textarea value={pack.email_body} rows={Math.max(8, Math.ceil(pack.email_body.length / 46))} aria-label="Email body" onChange={(e) => onEdit("email_body", e.target.value)} />
            <div className="flex flex-wrap gap-2">
              <CopyButton text={pack.email_subject} label="Copy subject" />
              <CopyButton text={pack.email_body} label="Copy body" />
            </div>
          </section>

          <Message
            title={FIELD_LABEL.followup_note}
            hint="Send after you have submitted the application."
            value={pack.followup_note}
            limit={NOTE_LIMIT}
            onChange={(v) => onEdit("followup_note", v)}
          />

          <Message
            title={FIELD_LABEL.accepted_message}
            hint="Send once they accept your connection request."
            value={pack.accepted_message}
            extra
            onChange={(v) => onEdit("accepted_message", v)}
          />

          <Message
            title={FIELD_LABEL.referral_request}
            hint="For a current employee who isn't the hiring contact."
            value={pack.referral_request}
            extra
            onChange={(v) => onEdit("referral_request", v)}
          />

          <p className="text-xs text-muted-foreground">Read each message before sending. It only uses facts from your resume, extra facts and the job posting.</p>
        </div>
      )}
    </div>
  );
}
