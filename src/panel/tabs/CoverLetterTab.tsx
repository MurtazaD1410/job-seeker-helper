import { useState } from "react";
import { Check, Copy, Download, Loader2, SquarePen, Sparkles, TriangleAlert, X } from "lucide-react";
import { downloadText } from "@/lib/download";
import { buildFileName } from "@/lib/fileName";
import { samePreamble } from "@/lib/overleaf";
import type { Analysis, CoverLetter, CoverPrefs } from "@/lib/schema";
import type { JobDraft, Settings } from "@/lib/storage";
import type { AnalysisStatus } from "../hooks/useAnalysis";
import type { OverleafApi } from "../hooks/useOverleaf";
import type { PdfBuilder } from "../hooks/usePdfBuilder";
import { BuildPdfButton } from "../components/BuildPdf";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { OverleafTarget } from "../components/OverleafTarget";
import { DiffView } from "../components/DiffView";
import { toPlainText } from "@/lib/letterPreview";
import { LetterPreview } from "../components/LetterPreview";
import { Elapsed } from "../components/Elapsed";
import { Button } from "../components/ui/button";

interface Props {
  settings: Settings;
  job: JobDraft;
  analysis: Analysis | null;
  letter: CoverLetter | null;
  prefs: CoverPrefs;
  setPrefs: (patch: Partial<CoverPrefs>) => void;
  status: AnalysisStatus;
  overleaf: OverleafApi;
  builder: PdfBuilder;
  onEdit: (latex: string) => void;
  onGenerate: () => void;
  onCancel: () => void;
  goSettings: () => void;
  goJob: () => void;
}

const SELECT = "h-9 rounded-md border border-input bg-background px-2 text-sm";

export function CoverLetterTab({ settings, job, analysis, letter, prefs, setPrefs, status, overleaf, builder, onEdit, onGenerate, onCancel, goSettings, goJob }: Props) {
  const [view, setView] = useState<"preview" | "text" | "letter" | "diff">("preview");
  const [copied, setCopied] = useState(false);
  const [copiedText, setCopiedText] = useState(false);
  const [copyError, setCopyError] = useState("");
  const running = status.state === "running";
  const [confirm, setConfirm] = useState<{ looksRight: boolean } | null>(null);
  const [applying, setApplying] = useState(false);
  const [applyNote, setApplyNote] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const missing = !settings.apiKey
    ? "API key"
    : !settings.baseCoverLetter.trim()
      ? "base cover letter"
      : !settings.baseResume.trim()
        ? "base resume"
        : null;
  const noJob = job.description.trim().length < 50;
  const doc = { project: settings.coverOverleafProject, file: settings.coverOverleafFile };
  const docTab = overleaf.tabFor(doc.project);
  const fileName = letter ? buildFileName(settings.coverFileName, { company: letter.company, role: letter.job_title }, "tex") : "";

  async function copyPlain() {
    if (!letter) return;
    setCopyError("");
    try {
      await navigator.clipboard.writeText(toPlainText(letter.latex));
      setCopiedText(true);
    } catch {
      setCopyError("Couldn't access the clipboard. Click into the text box, press Ctrl+A and copy it manually.");
    }
  }

  async function copy() {
    if (!letter) return;
    setCopyError("");
    try {
      await navigator.clipboard.writeText(letter.latex);
      setCopied(true);
    } catch {
      setCopyError("Couldn't access the clipboard. Select the text and copy it manually.");
    }
  }

  // Reads the open Overleaf file first, to warn if it doesn't look like the cover letter.
  async function startApply() {
    setApplyNote(null);
    setApplying(true);
    const r = await overleaf.callFor(doc, { op: "read" });
    setApplying(false);
    if (!r.ok || r.op !== "read") {
      setApplyNote({ kind: "error", text: `${r.ok ? "Unexpected reply from Overleaf." : r.error} Use Copy or Download instead.` });
      return;
    }
    setConfirm({ looksRight: samePreamble(settings.baseCoverLetter, r.text) });
  }

  async function confirmApply() {
    if (!letter) return;
    setApplying(true);
    const r = await overleaf.callFor(doc, { op: "replace", text: letter.latex });
    setApplying(false);
    setConfirm(null);
    if (!r.ok || r.op !== "replace") {
      setApplyNote({ kind: "error", text: `${r.ok ? "Unexpected reply from Overleaf." : r.error} Use Copy or Download instead.` });
      return;
    }
    setApplyNote({ kind: "ok", text: "The open Overleaf file now contains the new cover letter. Press Ctrl+Z in Overleaf to undo." });
    overleaf.recheck();
  }

  return (
    <div className="flex flex-col gap-4">
      <OverleafTarget overleaf={overleaf} />
      <p className="text-xs text-muted-foreground">
        Apply goes to: {docTab ? docTab.title : "no open Overleaf project (check Settings)"}
        {doc.file ? ` · ${doc.file}` : " · the open file"}
      </p>

      <div className="text-sm">
        <div className="font-medium">{job.title || "No job selected"}{job.company ? ` at ${job.company}` : ""}</div>
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
          <Button onClick={onGenerate} disabled={!!missing || noJob}>
            <Sparkles /> {letter ? "Regenerate" : "Write cover letter"}
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
            {status.note || "Writing your cover letter with Gemini…"} <Elapsed />
          </span>
        </p>
      )}
      {status.state === "error" && (
        <p role="alert" className="flex items-start gap-2 text-sm text-destructive">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" />
          <span>{status.message}</span>
        </p>
      )}

      {letter && (
        <section className={`flex flex-col gap-3 border-t border-border pt-4 ${running ? "opacity-60" : ""}`} aria-label="Cover letter result">
          <div className="text-xs text-muted-foreground">
            {letter.tone === "formal" ? "Formal" : "Friendly"} · {letter.language === "de" ? "German" : "English"}
            {letter.job_title ? ` · ${letter.job_title}` : ""}
            {letter.company ? ` at ${letter.company}` : ""}
          </div>

          {letter.warnings.length > 0 && (
            <ul role="alert" className="flex list-disc flex-col gap-1 rounded-lg border border-border bg-card p-3 pl-7 text-sm text-warning">
              {letter.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          )}

          {letter.summary && <p className="whitespace-pre-wrap text-sm text-muted-foreground">{letter.summary}</p>}

          <div className="flex gap-1" role="tablist" aria-label="Cover letter view">
            {(["preview", "text", "letter", "diff"] as const).map((v) => (
              <Button key={v} size="sm" variant={view === v ? "secondary" : "ghost"} role="tab" aria-selected={view === v} onClick={() => setView(v)}>
                {v === "preview" ? "Preview" : v === "text" ? "Plain text" : v === "letter" ? "LaTeX" : "Changes vs. your base"}
              </Button>
            ))}
          </div>

          {view === "preview" ? (
            <LetterPreview latex={letter.latex} onChange={onEdit} />
          ) : view === "text" ? (
            <div className="flex flex-col gap-2">
              <textarea
                readOnly
                aria-label="Cover letter as plain text"
                value={toPlainText(letter.latex)}
                onFocus={(e) => e.currentTarget.select()}
                rows={16}
                className="w-full resize-y rounded-md border border-border bg-background p-2 text-sm leading-relaxed"
              />
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" onClick={() => void copyPlain()}>
                  {copiedText ? <Check /> : <Copy />} Copy text
                </Button>
                <span className="text-xs text-muted-foreground">For application forms with a text box. Edit the letter in Preview first.</span>
              </div>
            </div>
          ) : view === "letter" ? (
            <pre className="max-h-[28rem] overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-background p-2 font-mono text-xs leading-relaxed">
              {letter.latex}
            </pre>
          ) : (
            <DiffView original={settings.baseCoverLetter} replacement={letter.latex} />
          )}

          {copyError && (
            <p role="alert" className="text-sm text-destructive">
              {copyError}
            </p>
          )}

          <div className="break-all font-mono text-xs">{fileName}</div>

          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => downloadText(fileName, letter.latex)}>
              <Download /> Download .tex
            </Button>
            <BuildPdfButton
              label="cover letter"
              tailored={letter.latex}
              master={settings.baseCoverLetter}
              doc={doc}
              tabTitle={docTab?.title}
              fileName={buildFileName(settings.coverFileName, { company: letter.company, role: letter.job_title }, "pdf")}
              overleaf={overleaf}
              builder={builder}
            />
            <Button size="sm" variant="secondary" onClick={() => void copy()}>
              {copied ? <Check /> : <Copy />} Copy LaTeX
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!docTab || applying}
              onClick={() => void startApply()}
              title={!docTab ? "Open your cover letter's Overleaf project in a tab to apply. Copy always works." : undefined}
            >
              {applying ? <Loader2 className="animate-spin" /> : <SquarePen />} Apply to Overleaf
            </Button>
          </div>
          {applyNote && (
            <p role={applyNote.kind === "error" ? "alert" : "status"} className={`text-sm ${applyNote.kind === "error" ? "text-destructive" : "text-success"}`}>
              {applyNote.text}
            </p>
          )}
        </section>
      )}

      <ConfirmDialog
        open={confirm !== null}
        title="Replace the open Overleaf file?"
        confirmLabel={confirm && !confirm.looksRight ? "Replace anyway" : "Replace"}
        busy={applying}
        onCancel={() => setConfirm(null)}
        onConfirm={() => void confirmApply()}
      >
        <p>This replaces the whole content of the file that is open in Overleaf with the new cover letter. Ctrl+Z in Overleaf undoes it.</p>
        {confirm && !confirm.looksRight && (
          <p className="font-medium text-warning">
            The open file doesn't look like your cover letter: its preamble differs from your base cover letter. Make sure the right file is open.
          </p>
        )}
      </ConfirmDialog>
    </div>
  );
}
