import { base64ToBytes, type BridgeCommand, type BridgeResult } from "./overleaf";
import type { PendingRestore } from "./pendingRestore";

export interface BuildDeps {
  /** Runs a command on the document's Overleaf file (the right tab and file are handled by the caller). */
  call: (cmd: BridgeCommand) => Promise<BridgeResult>;
  savePending: (p: PendingRestore | null) => Promise<void>;
  onStep?: (step: string) => void;
  sleep?: (ms: number) => Promise<void>;
  /** Pause after writing, so Overleaf has synced the change to its server before compiling. */
  syncDelayMs?: number;
}

export interface BuildInput {
  /** The tailored LaTeX to compile. */
  tailored: string;
  /** What the file must contain afterwards (the master, or whatever was there before). */
  restoreTo: string;
  meta: Pick<PendingRestore, "project" | "file" | "title">;
}

export interface BuildOutcome {
  pdf: Uint8Array | null;
  /** Overleaf's own link downloaded the PDF (as output.pdf); we couldn't fetch the bytes ourselves. */
  browserDownload: boolean;
  /** Error count shown on Overleaf's "View logs" button, if any. */
  logErrors: string;
  error: string | null;
  /** The file is back to `restoreTo` (or was never changed). */
  restored: boolean;
  restoreError: string | null;
}

const eol = (s: string) => s.replace(/\r\n?/g, "\n");
const message = (r: BridgeResult): string => (r.ok ? "Unexpected reply from Overleaf." : r.error);

/**
 * Builds a PDF through Overleaf and puts the file back:
 *  1. save a backup record, 2. write the tailored text, 3. compile and fetch the PDF,
 *  4. restore the file and check it, 5. start a compile so the preview matches the restored file.
 * Step 4 runs whether or not the compile worked. If it fails, the backup record is kept for recovery.
 */
export async function buildPdf(deps: BuildDeps, input: BuildInput): Promise<BuildOutcome> {
  const step = deps.onStep ?? (() => {});
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const out: BuildOutcome = { pdf: null, browserDownload: false, logErrors: "", error: null, restored: false, restoreError: null };

  step("Saving a backup of your original…");
  await deps.savePending({ ...input.meta, text: input.restoreTo, saved_at: Date.now() });

  step("Writing the tailored version into Overleaf…");
  const write = await deps.call({ op: "replace", text: input.tailored });
  if (!write.ok || write.op !== "replace") {
    // The replace is all-or-nothing, so the file is untouched.
    out.error = message(write);
    out.restored = true;
    await deps.savePending(null);
    return out;
  }
  await sleep(deps.syncDelayMs ?? 2500);

  step("Compiling in Overleaf (up to a minute or two)…");
  const compiled = await deps.call({ op: "compile", download: true });
  if (!compiled.ok || compiled.op !== "compile") {
    out.error = message(compiled);
  } else {
    out.logErrors = compiled.logBadge;
    if (compiled.pdfBase64) {
      try {
        out.pdf = base64ToBytes(compiled.pdfBase64);
      } catch {
        out.error = "The PDF arrived damaged. Try again.";
      }
    } else if (compiled.via === "browser") {
      out.browserDownload = true;
    } else {
      out.error = "No PDF came back from Overleaf.";
    }
  }

  step("Restoring your original file…");
  const restore = await deps.call({ op: "replace", text: input.restoreTo });
  if (!restore.ok || restore.op !== "replace") {
    out.restoreError = message(restore);
  } else {
    const check = await deps.call({ op: "read" });
    if (check.ok && check.op === "read" && eol(check.text) === eol(input.restoreTo)) {
      out.restored = true;
      await deps.savePending(null);
      // Refresh the preview so it shows the restored file again (does nothing if a compile is running).
      await deps.call({ op: "compile", download: false });
    } else {
      out.restoreError = check.ok && check.op === "read" ? "The restored file doesn't match the backup." : message(check);
    }
  }
  return out;
}
