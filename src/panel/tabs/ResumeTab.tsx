import { useMemo, useState } from "react";
import { Loader2, RotateCcw, SquarePen, TriangleAlert } from "lucide-react";
import { buildFileName } from "@/lib/fileName";
import { locate } from "@/lib/latex";
import { OUTCOME_MESSAGE } from "@/lib/overleaf";
import { resumeFor } from "@/lib/resume";
import { tailorResume } from "@/lib/tailor";
import type { Analysis, Suggestion, SuggestionStates } from "@/lib/schema";
import type { Settings } from "@/lib/storage";
import type { OverleafApi } from "../hooks/useOverleaf";
import type { PdfBuilder } from "../hooks/usePdfBuilder";
import { BuildPdfButton } from "../components/BuildPdf";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { ExportCard } from "../components/ExportCard";
import { OverleafTarget } from "../components/OverleafTarget";
import { SuggestionCard } from "../components/SuggestionCard";
import { Button } from "../components/ui/button";

interface Props {
  analysis: Analysis | null;
  settings: Settings;
  states: SuggestionStates;
  setState: (id: string, entry: SuggestionStates[string] | null) => void;
  overleaf: OverleafApi;
  builder: PdfBuilder;
  goJob: () => void;
}

export function ResumeTab({ analysis, settings, states, setState, overleaf, builder, goJob }: Props) {
  const [copyError, setCopyError] = useState("");
  const [applying, setApplying] = useState(false);
  const [applyNote, setApplyNote] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  // Set when suggestions couldn't be placed because the open file differs from the master.
  const [mismatch, setMismatch] = useState(false);
  const [confirmReset, setConfirmReset] = useState<{ thenApply: boolean } | null>(null);

  // The master the analysis was written against (German or English, depending on the posting).
  const master = resumeFor(settings, analysis?.language ?? "de");

  // Suggestions are only safe to apply while their original still matches the base resume exactly.
  const staleIds = useMemo(() => {
    const out = new Set<string>();
    for (const s of analysis?.suggestions ?? []) if (locate(master.text, s.original).kind !== "exact") out.add(s.id);
    return out;
  }, [analysis, master.text]);

  // The tailored resume: master + every suggestion that wasn't skipped.
  const tailored = useMemo(() => {
    const included = (analysis?.suggestions ?? []).filter((s) => states[s.id]?.status !== "skipped");
    return tailorResume(master.text, included);
  }, [analysis, states, master.text]);

  if (!analysis) {
    return (
      <div className="flex flex-col items-start gap-3 text-sm text-muted-foreground">
        <p>No analysis yet. Analyse a job description first and your suggestions will show up here.</p>
        <Button size="sm" variant="secondary" onClick={goJob}>
          Go to Job
        </Button>
      </div>
    );
  }

  const doc = { project: master.project, file: master.file };
  const docTab = overleaf.tabFor(doc.project);

  if (analysis.suggestions.length === 0) {
    // Nothing to change, but you may still want the PDF of your master, named for this company and role.
    return (
      <div className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">
          No honest edits were found for this job
          {analysis.dropped.some((d) => d.kind === "suggestion") ? ", and some suggestions were discarded by validation (see the Job tab)" : ""}. Your resume
          already covers what it can.
        </p>
        <OverleafTarget overleaf={overleaf} />
        <ExportCard
          title="Resume (unchanged)"
          summary="No edits needed. Export your master resume as is."
          fileName={buildFileName(master.fileName, { company: analysis.company, role: analysis.job_title }, "tex")}
          latex={master.text}
          original={master.text}
          disabled={!master.text.trim()}
          issues={[]}
        >
          <BuildPdfButton
            label="resume"
            tailored={master.text}
            master={master.text}
            doc={doc}
            tabTitle={docTab?.title}
            fileName={buildFileName(master.fileName, { company: analysis.company, role: analysis.job_title }, "pdf")}
            overleaf={overleaf}
            builder={builder}
          />
        </ExportCard>
      </div>
    );
  }

  const list = analysis.suggestions;
  const count = (st: string) => list.filter((s) => states[s.id]?.status === st).length;
  const canApply = !!docTab && !applying;
  const applicable = list.filter((s) => !staleIds.has(s.id) && states[s.id]?.status !== "skipped" && states[s.id]?.status !== "applied");

  async function copy(s: Suggestion) {
    setCopyError("");
    try {
      await navigator.clipboard.writeText(s.replacement);
      if (states[s.id]?.status !== "applied") setState(s.id, { status: "copied" });
    } catch {
      setCopyError("Couldn't access the clipboard. Select the replacement text in the card and copy it manually.");
    }
  }

  // One call = one CodeMirror transaction = one undo step in Overleaf.
  async function apply(targets: Suggestion[]) {
    if (!targets.length) return;
    setApplying(true);
    setApplyNote(null);
    setMismatch(false);
    const r = await overleaf.callFor(doc, {
      op: "apply",
      edits: targets.map((s) => ({ id: s.id, original: s.original, replacement: s.replacement }))
    });
    setApplying(false);

    if (!r.ok || r.op !== "apply") {
      const error = r.ok ? "Unexpected reply from Overleaf." : r.error;
      for (const s of targets) setState(s.id, { status: "failed", error });
      setApplyNote({ kind: "error", text: error });
      return;
    }
    let ok = 0;
    for (const o of r.outcomes) {
      if (o.status === "applied") {
        ok++;
        setState(o.id, { status: "applied" });
      } else {
        setState(o.id, { status: "failed", error: OUTCOME_MESSAGE[o.status] });
      }
    }
    const failed = r.outcomes.length - ok;
    setMismatch(r.outcomes.some((o) => o.status === "not-found"));
    setApplyNote({
      kind: failed ? "error" : "ok",
      text: `${ok} applied in Overleaf${failed ? `, ${failed} failed (use Copy for those)` : ""}. Press Ctrl+Z in Overleaf to undo.`
    });
    overleaf.recheck();
  }

  // Suggestions are written against the master, so the open file has to match it. This overwrites the open
  // file with the master (Ctrl+Z undoes it) and, if asked, applies every suggestion that is still wanted.
  async function resetToMaster(thenApply: boolean) {
    setConfirmReset(null);
    setApplying(true);
    setApplyNote(null);
    const r = await overleaf.callFor(doc, { op: "replace", text: master.text });
    setApplying(false);
    if (!r.ok || r.op !== "replace") {
      setApplyNote({ kind: "error", text: `${r.ok ? "Unexpected reply from Overleaf." : r.error} Nothing was changed.` });
      return;
    }
    setMismatch(false);
    // What had been applied is gone from the file now.
    for (const s of list) if (states[s.id]?.status === "applied") setState(s.id, null);
    overleaf.recheck();
    if (thenApply) {
      await apply(list.filter((s) => !staleIds.has(s.id) && states[s.id]?.status !== "skipped"));
    } else {
      setApplyNote({ kind: "ok", text: "The Overleaf file now matches your master resume. Press Ctrl+Z in Overleaf to undo." });
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <OverleafTarget overleaf={overleaf} />
      <p className="text-xs text-muted-foreground">
        Using your {master.language === "en" ? "English" : "German"} resume
        {master.language === "de" && analysis.language === "en" ? " (no English resume in Settings yet)" : ""}. Apply goes to: {docTab ? docTab.title : "no open Overleaf project (check Settings)"}
        {doc.file ? ` · ${doc.file}` : " · the open file"}
      </p>

      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1 text-sm">
          <div className="font-medium">
            {list.length} suggestion{list.length === 1 ? "" : "s"}
          </div>
          <div className="text-xs text-muted-foreground">
            {count("copied")} copied · {count("applied")} applied · {count("skipped")} skipped
          </div>
        </div>
        <Button
          size="sm"
          disabled={!canApply || applicable.length === 0}
          onClick={() => void apply(applicable)}
          title={!docTab ? "Open your resume's Overleaf project in a tab to apply. Copy always works." : undefined}
        >
          {applying ? <Loader2 className="animate-spin" /> : <SquarePen />} Apply all
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={!canApply}
          onClick={() => setConfirmReset({ thenApply: false })}
          title={!docTab ? "Open your resume's Overleaf project in a tab first." : "Overwrite the open Overleaf file with your master resume"}
        >
          <RotateCcw /> Reset to master
        </Button>
      </div>

      {applyNote && (
        <p role={applyNote.kind === "error" ? "alert" : "status"} className={`text-sm ${applyNote.kind === "error" ? "text-destructive" : "text-success"}`}>
          {applyNote.text}
        </p>
      )}

      {mismatch && (
        <div className="flex flex-col items-start gap-2 rounded-lg border border-border bg-card p-3 text-sm">
          <p>The open Overleaf file doesn't match the master resume in your Settings, so some suggestions couldn't be placed.</p>
          <Button size="sm" disabled={!canApply} onClick={() => setConfirmReset({ thenApply: true })}>
            <RotateCcw /> Overwrite with master, then apply
          </Button>
        </div>
      )}

      <ExportCard
        title="Tailored resume"
        summary={`${tailored.applied.length} of ${list.length} suggestion${list.length === 1 ? "" : "s"} included. Skipped ones are left out.`}
        fileName={buildFileName(master.fileName, { company: analysis.company, role: analysis.job_title }, "tex")}
        latex={tailored.latex}
        original={master.text}
        disabled={tailored.applied.length === 0}
        issues={[
          ...tailored.failed.map((f) => `${f.suggestion.section || f.suggestion.id} was left out: ${f.reason}.`),
          ...(tailored.problem ? [`The combined result looks broken (${tailored.problem}). Check it before using it.`] : [])
        ]}
      >
        <BuildPdfButton
          label="resume"
          tailored={tailored.latex}
          master={master.text}
          doc={doc}
          tabTitle={docTab?.title}
          fileName={buildFileName(master.fileName, { company: analysis.company, role: analysis.job_title }, "pdf")}
          overleaf={overleaf}
          builder={builder}
          disabled={tailored.applied.length === 0}
        />
      </ExportCard>

      {copyError && (
        <p role="alert" className="flex items-start gap-2 text-sm text-destructive">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" />
          <span>{copyError}</span>
        </p>
      )}

      <ConfirmDialog
        open={confirmReset !== null}
        title="Overwrite the open Overleaf file with your master?"
        confirmLabel={confirmReset?.thenApply ? "Overwrite and apply" : "Overwrite"}
        busy={applying}
        onCancel={() => setConfirmReset(null)}
        onConfirm={() => void resetToMaster(confirmReset?.thenApply ?? false)}
      >
        <p>
          This replaces the whole content of {doc.file || "the open file"} in {docTab?.title ?? "Overleaf"} with the master resume from your Settings
          {confirmReset?.thenApply ? ", then applies your suggestions" : ""}. Ctrl+Z in Overleaf undoes it.
        </p>
        <p className="font-medium text-warning">Anything in that file that isn't in your master is lost. Make sure it's saved, for example in your backup file.</p>
      </ConfirmDialog>

      {list.map((s, i) => (
        <SuggestionCard
          key={s.id}
          suggestion={s}
          index={i}
          state={states[s.id]}
          stale={staleIds.has(s.id)}
          canApply={canApply}
          onCopy={() => void copy(s)}
          onSkip={() => setState(s.id, { status: "skipped" })}
          onRestore={() => setState(s.id, null)}
          onApply={() => void apply([s])}
        />
      ))}
    </div>
  );
}
