import { useState } from "react";
import { Check, Loader2, Sparkles, TriangleAlert, Wand2, X } from "lucide-react";
import { grabFromActiveTab, SOURCE_LABEL } from "@/lib/grabJob";
import { hasFact } from "@/lib/facts";
import type { Analysis } from "@/lib/schema";
import type { JobDraft, Settings } from "@/lib/storage";
import type { AnalysisStatus } from "../hooks/useAnalysis";
import { Elapsed } from "../components/Elapsed";
import { KeywordChips } from "../components/KeywordChips";
import { ScoreCard } from "../components/ScoreCard";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Textarea } from "../components/ui/textarea";

interface Props {
  job: JobDraft;
  setJob: (patch: Partial<JobDraft>) => void;
  settings: Settings;
  analysis: Analysis | null;
  status: AnalysisStatus;
  onAnalyse: () => void;
  onCancel: () => void;
  onAddFact: (term: string, detail: string) => Promise<void>;
  goSettings: () => void;
  goResume: () => void;
}

type Notice = { kind: "ok" | "error"; text: string } | null;

const MIN_DESCRIPTION = 50;

export function JobTab({ job, setJob, settings, analysis, status, onAnalyse, onCancel, onAddFact, goSettings, goResume }: Props) {
  const [grabbing, setGrabbing] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const running = status.state === "running";

  const missingSetup = !settings.apiKey ? "API key" : !settings.baseResume.trim() ? "base resume" : null;
  const tooShort = job.description.trim().length < MIN_DESCRIPTION;

  async function grab() {
    setGrabbing(true);
    setNotice(null);
    try {
      const r = await grabFromActiveTab();
      // A new page means a new job: take detected title/company, keep what's there if nothing was found.
      setJob({
        description: r.text,
        title: r.title || job.title,
        company: r.company || job.company,
        url: r.url
      });
      setNotice({
        kind: "ok",
        text: `Grabbed ${r.text.length.toLocaleString()} characters from ${SOURCE_LABEL[r.source]}. Review and edit before analysing.`
      });
    } catch (e) {
      setNotice({ kind: "error", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setGrabbing(false);
    }
  }

  // Skills confirmed from a chip that the current analysis still lists as unsupported.
  const pendingFacts = analysis
    ? analysis.keywords.filter((k) => k.status === "missing_not_supported" && hasFact(settings.extraFacts, k.term)).length
    : 0;

  const counts = analysis && {
    present: analysis.keywords.filter((k) => k.status === "present").length,
    addable: analysis.keywords.filter((k) => k.status === "missing_but_supported").length,
    unsupported: analysis.keywords.filter((k) => k.status === "missing_not_supported").length
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Job title</span>
          <Input value={job.title} onChange={(e) => setJob({ title: e.target.value })} placeholder="Auto-detected" />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Company</span>
          <Input value={job.company} onChange={(e) => setJob({ company: e.target.value })} placeholder="Auto-detected" />
        </label>
      </div>

      <label className="flex flex-col gap-1.5">
        <span className="flex items-center justify-between text-sm font-medium">
          Job description
          <span className="text-xs font-normal text-muted-foreground">{job.description.length.toLocaleString()} chars</span>
        </span>
        <Textarea
          rows={12}
          value={job.description}
          onChange={(e) => setJob({ description: e.target.value })}
          placeholder="Paste the job description here, or use “Grab from page”."
        />
      </label>

      {notice && (
        <p
          role={notice.kind === "error" ? "alert" : "status"}
          className={`flex items-start gap-2 text-sm ${notice.kind === "error" ? "text-destructive" : "text-success"}`}
        >
          {notice.kind === "error" ? <TriangleAlert className="mt-0.5 size-4 shrink-0" /> : <Check className="mt-0.5 size-4 shrink-0" />}
          <span>{notice.text}</span>
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={grab} disabled={grabbing || running}>
          {grabbing ? <Loader2 className="animate-spin" /> : <Wand2 />}
          Grab from page
        </Button>
        <Button
          variant="ghost"
          onClick={() => {
            setJob({ title: "", company: "", description: "", url: "" });
            setNotice(null);
          }}
          disabled={running || (!job.title && !job.company && !job.description)}
        >
          Clear
        </Button>
        {running ? (
          <Button variant="outline" onClick={onCancel} className="ml-auto">
            <X /> Cancel
          </Button>
        ) : (
          <Button onClick={onAnalyse} disabled={!!missingSetup || tooShort} className="ml-auto">
            <Sparkles /> Analyse
          </Button>
        )}
      </div>

      {missingSetup && (
        <p className="text-sm text-muted-foreground">
          Add your {missingSetup} in{" "}
          <button type="button" onClick={goSettings} className="cursor-pointer underline">
            Settings
          </button>{" "}
          to analyse.
        </p>
      )}

      {running && (
        <p role="status" className="flex items-start gap-2 text-sm text-muted-foreground">
          <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin" />
          <span>
            {status.note || "Analysing with Gemini… this can take up to a minute."} <Elapsed />
          </span>
        </p>
      )}
      {status.state === "error" && (
        <p role="alert" className="flex items-start gap-2 text-sm text-destructive">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" />
          <span>{status.message}</span>
        </p>
      )}

      {analysis && counts && (
        <section className={`flex flex-col gap-4 border-t border-border pt-4 ${running ? "opacity-60" : ""}`} aria-label="Analysis result">
          <div className="text-xs text-muted-foreground">
            {analysis.job_title || "Analysis"}
            {analysis.company ? ` at ${analysis.company}` : ""} · {analysis.keywords.length} keywords: {counts.present} in resume,{" "}
            {counts.addable} can be added, {counts.unsupported} not supported
          </div>

          <ScoreCard before={analysis.score_before} after={analysis.score_after} />
          <KeywordChips keywords={analysis.keywords} extraFacts={settings.extraFacts} onAddFact={onAddFact} />

          {pendingFacts > 0 && (
            <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card p-3 text-sm">
              <span className="min-w-0 flex-1">
                {pendingFacts} skill{pendingFacts === 1 ? "" : "s"} added to your facts. Analyse again to get suggestions for {pendingFacts === 1 ? "it" : "them"}.
              </span>
              <Button size="sm" onClick={onAnalyse} disabled={running}>
                <Sparkles /> Re-analyse
              </Button>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3 text-sm">
            <Button size="sm" variant="secondary" onClick={goResume}>
              {analysis.suggestions.length} suggestion{analysis.suggestions.length === 1 ? "" : "s"} ready
            </Button>
            {analysis.suggestions.length > 0 && <span className="text-xs text-muted-foreground">Review them in the Resume tab.</span>}
          </div>

          {analysis.dropped.length > 0 && (
            <details className="text-xs text-muted-foreground">
              <summary className="cursor-pointer">
                {analysis.dropped.length} item{analysis.dropped.length === 1 ? "" : "s"} discarded by validation
              </summary>
              <ul className="mt-2 flex list-disc flex-col gap-1 pl-4">
                {analysis.dropped.map((d, i) => (
                  <li key={`${d.id}-${i}`}>
                    {d.kind} <span className="font-mono">{d.id}</span>: {d.reason}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </section>
      )}
    </div>
  );
}
