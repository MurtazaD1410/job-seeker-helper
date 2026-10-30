import { useState } from "react";
import { FileDown, Loader2, TriangleAlert } from "lucide-react";
import { samePreamble } from "@/lib/overleaf";
import type { OverleafApi, DocTarget } from "../hooks/useOverleaf";
import type { PdfBuilder } from "../hooks/usePdfBuilder";
import { ConfirmDialog } from "./ConfirmDialog";
import { Button } from "./ui/button";

const eol = (s: string) => s.replace(/\r\n?/g, "\n").trim();

interface Props {
  /** "resume" or "cover letter": used in texts and to match results to the right button. */
  label: string;
  /** The tailored LaTeX to compile. */
  tailored: string;
  /** Your master text from Settings. */
  master: string;
  doc: DocTarget;
  /** The Overleaf tab's title (for the backup record), or undefined if no tab is open. */
  tabTitle: string | undefined;
  /** Name of the PDF to save. */
  fileName: string;
  overleaf: OverleafApi;
  builder: PdfBuilder;
  disabled?: boolean;
}

// "Build PDF": writes the tailored LaTeX into the Overleaf file, compiles, saves the PDF and puts the file back.
export function BuildPdfButton({ label, tailored, master, doc, tabTitle, fileName, overleaf, builder, disabled }: Props) {
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState("");
  const [confirm, setConfirm] = useState<{ current: string; differs: boolean; looksRight: boolean } | null>(null);
  const [restoreTo, setRestoreTo] = useState<"master" | "current">("master");

  const running = builder.state.phase === "running";
  const mine = builder.state.phase === "running" || builder.state.phase === "done" ? builder.state.label === label : false;

  async function start() {
    setError("");
    setChecking(true);
    const r = await overleaf.callFor(doc, { op: "read" });
    setChecking(false);
    if (!r.ok || r.op !== "read") {
      setError(`${r.ok ? "Unexpected reply from Overleaf." : r.error} Use Download .tex instead.`);
      return;
    }
    setRestoreTo("master");
    setConfirm({ current: r.text, differs: eol(r.text) !== eol(master), looksRight: samePreamble(master, r.text) });
  }

  function go() {
    if (!confirm) return;
    const target = restoreTo === "master" ? master : confirm.current;
    setConfirm(null);
    void builder.run({
      label,
      doc,
      fileName,
      tailored,
      restoreTo: target,
      meta: { project: doc.project, file: doc.file, title: tabTitle ?? "" }
    });
  }

  return (
    <>
      <Button
        size="sm"
        variant="secondary"
        disabled={disabled || running || checking || !tabTitle || !master.trim()}
        onClick={() => void start()}
        title={!tabTitle ? `Open your ${label}'s Overleaf project in a tab to build a PDF.` : undefined}
      >
        {checking || (running && mine) ? <Loader2 className="animate-spin" /> : <FileDown />} Build PDF
      </Button>

      {error && (
        <p role="alert" className="basis-full text-xs text-destructive">
          {error}
        </p>
      )}
      {builder.state.phase === "running" && mine && (
        <p role="status" className="basis-full text-xs text-muted-foreground">
          {builder.state.step}
        </p>
      )}
      {builder.state.phase === "done" && mine && <BuildResult state={builder.state} onClose={builder.clearResult} />}

      <ConfirmDialog
        open={confirm !== null}
        title={`Build the ${label} PDF in Overleaf?`}
        confirmLabel="Build PDF"
        onCancel={() => setConfirm(null)}
        onConfirm={go}
      >
        <p>
          This temporarily puts the tailored {label} into the open Overleaf file, compiles it, downloads the PDF as <b>{fileName}</b>, and then restores the
          file. Ctrl+Z in Overleaf also works. Please keep the Overleaf tab and its PDF preview open until it finishes.
        </p>
        {confirm && !confirm.looksRight && (
          <p className="font-medium text-warning">The open Overleaf file doesn't look like your {label}: its preamble differs from your master. Check that the right project and file are selected.</p>
        )}
        {confirm?.differs ? (
          <fieldset className="flex flex-col gap-1.5">
            <legend className="mb-1 text-foreground">The open file differs from your master. Afterwards, put back:</legend>
            <label className="flex items-start gap-2">
              <input type="radio" name="restore" checked={restoreTo === "master"} onChange={() => setRestoreTo("master")} className="mt-0.5" />
              <span>My master {label} from Settings</span>
            </label>
            <label className="flex items-start gap-2">
              <input type="radio" name="restore" checked={restoreTo === "current"} onChange={() => setRestoreTo("current")} className="mt-0.5" />
              <span>What is in Overleaf right now</span>
            </label>
          </fieldset>
        ) : (
          <p>The open file matches your master, so that is what will be restored.</p>
        )}
      </ConfirmDialog>
    </>
  );
}

function BuildResult({ state, onClose }: { state: Extract<PdfBuilder["state"], { phase: "done" }>; onClose: () => void }) {
  const { outcome, fileName } = state;
  const ok = !!outcome.pdf || outcome.browserDownload;
  return (
    <div role={outcome.error || outcome.restoreError ? "alert" : "status"} className="flex basis-full flex-col gap-1 rounded-md border border-border bg-background p-2 text-xs">
      {outcome.pdf && <p className="text-success">PDF saved as {fileName}.</p>}
      {outcome.browserDownload && (
        <p className="text-warning">Overleaf downloaded the PDF itself as output.pdf, because it couldn't be fetched directly. Rename it to {fileName}.</p>
      )}
      {ok && outcome.logErrors && <p className="text-warning">Overleaf reported {outcome.logErrors} error(s) in its log. The PDF was built anyway, so check it.</p>}
      {outcome.error && <p className="text-destructive">{outcome.error}</p>}
      {outcome.restored && <p className="text-muted-foreground">Your Overleaf file is back to how it was.</p>}
      {outcome.restoreError && (
        <p className="flex items-start gap-1.5 text-destructive">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
          <span>Couldn't restore your Overleaf file: {outcome.restoreError} A backup is saved. Use "Restore now" in the banner at the top, or press Ctrl+Z in Overleaf.</span>
        </p>
      )}
      <button type="button" onClick={onClose} className="w-fit cursor-pointer text-muted-foreground underline">
        Dismiss
      </button>
    </div>
  );
}

// Shown at the top of the panel when a build left a backup behind (e.g. the panel was closed mid-build).
export function PendingRestoreBanner({ builder }: { builder: PdfBuilder }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!builder.pending || builder.state.phase === "running") return null;

  async function restore() {
    setBusy(true);
    setError("");
    const e = await builder.restorePending();
    setBusy(false);
    if (e) setError(e);
  }

  return (
    <div role="alert" className="flex flex-col gap-2 border-b border-border bg-card p-3 text-sm">
      <p className="text-warning">
        An earlier PDF build didn't finish restoring your Overleaf file{builder.pending.title ? ` (${builder.pending.title})` : ""}. It may still contain the
        tailored text.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={() => void restore()} disabled={busy}>
          {busy && <Loader2 className="animate-spin" />} Restore now
        </Button>
        <Button size="sm" variant="ghost" onClick={() => void builder.dismissPending()} disabled={busy}>
          Dismiss
        </Button>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
